import type {
  RunInput,
  FunctionRunResult,
  Target
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

// ── Configuration Types ──────────────────────────────────────────────

type BaseConfig = { configType: string };

type BasicConfig = BaseConfig & {
  minimumQuantity: number;
  discountPercentage: number;
  applyInMultiples?: boolean;
};

type MultiTierConfig = BaseConfig & {
  tiers: { minQty: number; maxQty?: number; discountPercentage: number; eligibleVariantIds?: string[] }[];
};

type FixedBundleConfig = BaseConfig & {
  bundleQuantity: number;
  fixedPrice: number;  // total price for the bundle
};

type MultiTierFixedConfig = BaseConfig & {
  tiers: { bundleQuantity: number; fixedPrice: number; eligibleVariantIds?: string[] }[];
};

type MixMatchConfig = BaseConfig & {
  eligibleProductIds: string[];
  minimumQuantity: number;
  discountPercentage: number;
  applyInMultiples?: boolean;
};

type CartWideConfig = BaseConfig & {
  minimumQuantity: number;
  discountPercentage: number;
  applyInMultiples?: boolean;
};

type Configuration = BasicConfig | MultiTierConfig | FixedBundleConfig | MultiTierFixedConfig | MixMatchConfig | CartWideConfig;

// ── Helpers ──────────────────────────────────────────────────────────

interface LineInfo {
  variantId: string;
  productId: string;
  quantity: number;
  pricePerItem: number;
}

function extractLines(input: RunInput): LineInfo[] {
  const lines: LineInfo[] = [];
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const merch = line.merchandise as any;
      lines.push({
        variantId: merch.id,
        productId: merch.product?.id ?? "",
        quantity: line.quantity,
        pricePerItem: parseFloat((line as any).cost?.amountPerQuantity?.amount ?? "0"),
      });
    }
  }
  return lines;
}

function allCartTargets(input: RunInput): Target[] {
  const targets: Target[] = [];
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      targets.push({
        productVariant: { id: (line.merchandise as any).id, quantity: line.quantity },
      });
    }
  }
  return targets;
}

function totalCartQuantity(input: RunInput): number {
  let total = 0;
  for (const line of input.cart.lines) total += line.quantity;
  return total;
}

function getTargets(eligibleLines: LineInfo[], totalEligibleQty: number, minQty: number, applyInMultiples?: boolean): Target[] {
  if (applyInMultiples) {
    const numToDiscount = Math.floor(totalEligibleQty / minQty) * minQty;
    // Sort descending by price to discount highest price items first
    const sortedLines = [...eligibleLines].sort((a, b) => b.pricePerItem - a.pricePerItem);
    
    let counted = 0;
    const targets: Target[] = [];
    for (const l of sortedLines) {
      if (counted >= numToDiscount) break;
      const qty = Math.min(l.quantity, numToDiscount - counted);
      if (qty > 0) {
          targets.push({ productVariant: { id: l.variantId, quantity: qty } });
          counted += qty;
      }
    }
    return targets;
  } else {
    // Normal volume behavior: apply to everything
    return eligibleLines.map(l => ({
      productVariant: { id: l.variantId, quantity: l.quantity },
    }));
  }
}

// ── Handlers ─────────────────────────────────────────────────────────

function handleBasic(config: BasicConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumQuantity || !config.discountPercentage) return EMPTY_DISCOUNT;
  
  const totalQty = totalCartQuantity(input);
  if (totalQty < config.minimumQuantity) return EMPTY_DISCOUNT;

  const targets = getTargets(extractLines(input), totalQty, config.minimumQuantity, config.applyInMultiples);
  if (!targets.length) return EMPTY_DISCOUNT;

  return {
    discounts: [{
      targets,
      value: { percentage: { value: config.discountPercentage.toString() } },
      message: `Volume Discount: ${config.discountPercentage}% Off!`,
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleMultiTier(config: MultiTierConfig, input: RunInput): FunctionRunResult {
  if (!config.tiers?.length) return EMPTY_DISCOUNT;

  // Sort descending by minQty to find the best matching tier
  const sortedTiers = [...config.tiers].sort((a, b) => b.minQty - a.minQty);
  const allLines = extractLines(input);

  for (const tier of sortedTiers) {
    const hasVariants = tier.eligibleVariantIds && tier.eligibleVariantIds.length > 0;
    
    // Determine which lines are eligible for this tier
    const eligibleLines = hasVariants 
      ? allLines.filter(l => tier.eligibleVariantIds!.includes(l.variantId))
      : allLines;

    const tierQty = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);

    if (tierQty >= tier.minQty) {
      const maxAllowed = tier.maxQty ?? tierQty;
      const targets: Target[] = [];
      let counted = 0;

      // Sort descending by price to discount highest price items first
      const sortedLines = [...eligibleLines].sort((a, b) => b.pricePerItem - a.pricePerItem);

      for (const l of sortedLines) {
        if (counted >= maxAllowed) break;
        const qty = Math.min(l.quantity, maxAllowed - counted);
        if (qty > 0) {
          targets.push({ productVariant: { id: l.variantId, quantity: qty } });
          counted += qty;
        }
      }

      if (!targets.length) continue;

      return {
        discounts: [{
          targets,
          value: { percentage: { value: tier.discountPercentage.toString() } },
          message: `Volume Tier: ${tier.discountPercentage}% Off!`,
        }],
        discountApplicationStrategy: DiscountApplicationStrategy.First,
      };
    }
  }

  return EMPTY_DISCOUNT;
}

function handleFixedBundle(config: FixedBundleConfig, input: RunInput): FunctionRunResult {
  if (!config.bundleQuantity || !config.fixedPrice) return EMPTY_DISCOUNT;

  const totalQty = totalCartQuantity(input);
  if (totalQty < config.bundleQuantity) return EMPTY_DISCOUNT;

  // Calculate the natural total for the first `bundleQuantity` items
  const lines = extractLines(input);
  let naturalTotal = 0;
  let counted = 0;
  const targets: Target[] = [];

  for (const l of lines) {
    if (counted >= config.bundleQuantity) break;
    const qty = Math.min(l.quantity, config.bundleQuantity - counted);
    naturalTotal += l.pricePerItem * qty;
    targets.push({ productVariant: { id: l.variantId, quantity: qty } });
    counted += qty;
  }

  if (naturalTotal <= config.fixedPrice || !targets.length) return EMPTY_DISCOUNT;

  // Calculate the percentage discount needed to bring naturalTotal down to fixedPrice
  const discountAmount = naturalTotal - config.fixedPrice;

  return {
    discounts: [{
      targets,
      value: { fixedAmount: { amount: discountAmount.toString(), appliesToEachItem: false } },
      message: `Bundle Deal: ${config.bundleQuantity} items for ₹${config.fixedPrice}!`,
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleMixMatch(config: MixMatchConfig, input: RunInput): FunctionRunResult {
  if (!config.eligibleProductIds?.length || !config.minimumQuantity || !config.discountPercentage) {
    return EMPTY_DISCOUNT;
  }

  const lines = extractLines(input);
  const eligibleLines = lines.filter(l => config.eligibleProductIds.includes(l.productId));
  const eligibleQty = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);

  if (eligibleQty < config.minimumQuantity) return EMPTY_DISCOUNT;

  const targets = getTargets(eligibleLines, eligibleQty, config.minimumQuantity, config.applyInMultiples);

  if (!targets.length) return EMPTY_DISCOUNT;

  return {
    discounts: [{
      targets,
      value: { percentage: { value: config.discountPercentage.toString() } },
      message: `Mix & Match Volume: ${config.discountPercentage}% Off!`,
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleMultiTierFixed(config: MultiTierFixedConfig, input: RunInput): FunctionRunResult {
  if (!config.tiers?.length) return EMPTY_DISCOUNT;

  const allLines = extractLines(input);

  // Sort tiers descending by bundleQuantity to find the best matching tier
  const sortedTiers = [...config.tiers].sort((a, b) => b.bundleQuantity - a.bundleQuantity);

  for (const tier of sortedTiers) {
    const hasVariants = tier.eligibleVariantIds && tier.eligibleVariantIds.length > 0;
    const eligibleLines = hasVariants 
      ? allLines.filter(l => tier.eligibleVariantIds!.includes(l.variantId))
      : allLines;

    const tierQty = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);

    if (tierQty >= tier.bundleQuantity) {
      // Calculate natural total for the first bundleQuantity items
      let naturalTotal = 0;
      let counted = 0;
      const targets: Target[] = [];

      for (const l of eligibleLines) {
        if (counted >= tier.bundleQuantity) break;
        const qty = Math.min(l.quantity, tier.bundleQuantity - counted);
        naturalTotal += l.pricePerItem * qty;
        targets.push({ productVariant: { id: l.variantId, quantity: qty } });
        counted += qty;
      }

      if (naturalTotal <= tier.fixedPrice || !targets.length) continue;

      const discountAmount = naturalTotal - tier.fixedPrice;

      return {
        discounts: [{
          targets,
          value: { fixedAmount: { amount: discountAmount.toString(), appliesToEachItem: false } },
          message: `Bundle Deal: ${tier.bundleQuantity} for ₹${tier.fixedPrice}!`,
        }],
        discountApplicationStrategy: DiscountApplicationStrategy.First,
      };
    }
  }

  return EMPTY_DISCOUNT;
}

function handleCartWide(config: CartWideConfig, input: RunInput): FunctionRunResult {
  // Cart-wide is functionally identical to BASIC for the discount function,
  // but the admin UI distinguishes it as "total cart quantity, not per-line".
  return handleBasic(config as BasicConfig, input);
}

// ── Main Entry Point ─────────────────────────────────────────────────

export function run(input: RunInput): FunctionRunResult {
  const raw = input?.discountNode?.metafield?.value ?? "{}";
  const configuration: Configuration = JSON.parse(raw);
  const configType = (configuration as any).configType ?? "BASIC";

  switch (configType) {
    case "BASIC":
      return handleBasic(configuration as BasicConfig, input);
    case "MULTI_TIER":
      return handleMultiTier(configuration as MultiTierConfig, input);
    case "FIXED_BUNDLE":
      return handleFixedBundle(configuration as FixedBundleConfig, input);
    case "MULTI_TIER_FIXED":
      return handleMultiTierFixed(configuration as MultiTierFixedConfig, input);
    case "MIX_MATCH":
      return handleMixMatch(configuration as MixMatchConfig, input);
    case "CART_WIDE":
      return handleCartWide(configuration as CartWideConfig, input);
    default:
      return handleBasic(configuration as BasicConfig, input);
  }
}