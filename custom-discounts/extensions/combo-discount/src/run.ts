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
  targetVariantId: string;
  discountType?: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue?: number;
  discountPercentage?: number; // legacy fallback
};

type BogoDiscountConfig = BaseConfig & {
  buyQuantity: number;
  getQuantity: number;
  bogoDiscountPercentage: number;  // % off on the "get" items
  additionalDiscountPercentage: number;  // extra % off on all items
};

type BogoGiftConfig = BaseConfig & {
  buyQuantity: number;
  getQuantity: number;
  giftVariantId?: string;   // single gift (backwards compatible)
  giftVariantIds?: string[]; // mystery pool — picks whichever is in cart
};

type BundleGiftConfig = BaseConfig & {
  bundleQuantity: number;  // buy N items
  giftVariantId: string;   // gift becomes free
};

type BundlePriceGiftConfig = BaseConfig & {
  bundleProductIds?: string[];  // optional: specific products in the bundle
  bundleQuantity: number;       // how many items form the bundle
  bundlePrice: number;          // fixed total price for the bundle (e.g. 1499)
  giftVariantId: string;        // gift becomes free
};

type Configuration = BasicConfig | BogoDiscountConfig | BogoGiftConfig | BundleGiftConfig | BundlePriceGiftConfig;

// ── Helpers ──────────────────────────────────────────────────────────

function totalCartQuantity(input: RunInput): number {
  let total = 0;
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      total += line.quantity;
    }
  }
  return total;
}

function normalizeGid(id: string): string {
  if (!id) return "";
  const match = id.match(/\/(\d+)$/);
  return match ? match[1] : id;
}

function gidMatch(storedId: string, cartId: string): boolean {
  return normalizeGid(storedId) === normalizeGid(cartId);
}

// ── Handlers ─────────────────────────────────────────────────────────

function handleBasic(config: BasicConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumQuantity || !config.targetVariantId || !config.discountPercentage) {
    return EMPTY_DISCOUNT;
  }

  if (totalCartQuantity(input) < config.minimumQuantity) return EMPTY_DISCOUNT;

  const targets: Target[] = [];
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      if (gidMatch(variantId, config.targetVariantId)) {
        targets.push({ productVariant: { id: variantId, quantity: line.quantity } });
      }
    }
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  // Calculate either Percentage or Fixed Amount
  let valueObj: any = {};

  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;

  if (isFixedAmount) {
    // Collect the exact total cost of the targeted items
    let targetTotalCost = 0;
    for (const line of input.cart.lines) {
      if (line.merchandise.__typename === "ProductVariant" && gidMatch((line.merchandise as any).id, config.targetVariantId)) {
        const itemPrice = parseFloat((line as any).cost?.amountPerQuantity?.amount ?? "0");
        targetTotalCost += itemPrice * line.quantity;
      }
    }

    const targetPrice = config.discountValue || 0;
    const requiredDiscountAmount = targetTotalCost - targetPrice;

    // If the items already cost less than the fixed package price, don't discount
    if (requiredDiscountAmount <= 0) return EMPTY_DISCOUNT;

    valueObj = {
      fixedAmount: {
        amount: requiredDiscountAmount.toFixed(2),
        appliesToEachItem: false
      }
    };
  } else {
    // Fallback to percentage
    const pct = config.discountValue !== undefined ? config.discountValue : (config.discountPercentage || 0);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{
      targets,
      value: valueObj,
      message: "Combo Deal Applied!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleBogoDiscount(config: BogoDiscountConfig, input: RunInput): FunctionRunResult {
  const { buyQuantity, getQuantity, bogoDiscountPercentage, additionalDiscountPercentage } = config;
  if (!buyQuantity || !getQuantity || !bogoDiscountPercentage) return EMPTY_DISCOUNT;

  const totalQty = totalCartQuantity(input);
  const timesTriggered = Math.floor(totalQty / (buyQuantity + getQuantity));
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const discounts: FunctionRunResult["discounts"] = [];

  const bogoItemsCount = timesTriggered * getQuantity;
  const buyItemsCount = timesTriggered * buyQuantity;

  let getNeeded = bogoItemsCount;
  let buyNeeded = buyItemsCount;

  const bogoTargets: Target[] = [];
  const extraTargets: Target[] = [];

  // Sort lines ascending by price so we discount cheapest items first
  const sortedLines = [...input.cart.lines]
    .filter(l => l.merchandise.__typename === "ProductVariant")
    .sort((a, b) => {
      const priceA = parseFloat((a as any).cost?.amountPerQuantity?.amount ?? "0");
      const priceB = parseFloat((b as any).cost?.amountPerQuantity?.amount ?? "0");
      return priceA - priceB;
    });

  // Track the available quantity for each line item
  const availableItems = sortedLines.map(line => ({
    variantId: (line.merchandise as any).id,
    quantity: line.quantity
  }));

  // 1. Allocate "Get" items (Take from the cheapest end first)
  for (let i = 0; i < availableItems.length && getNeeded > 0; i++) {
    const item = availableItems[i];
    const take = Math.min(item.quantity, getNeeded);
    if (take > 0) {
      bogoTargets.push({ productVariant: { id: item.variantId, quantity: take } });
      item.quantity -= take;
      getNeeded -= take;
    }
  }

  // 2. Allocate "Buy" items (Take from the most expensive end first)
  // These items are required to qualify for the BOGO, so they receive NO discount.
  for (let i = availableItems.length - 1; i >= 0 && buyNeeded > 0; i--) {
    const item = availableItems[i];
    const take = Math.min(item.quantity, buyNeeded);
    if (take > 0) {
      item.quantity -= take;
      buyNeeded -= take;
    }
  }

  // 3. Allocate any remaining items to Extra Targets
  // These are the "3rd products" and beyond that aren't part of a BOGO pair
  for (const item of availableItems) {
    if (item.quantity > 0) {
      extraTargets.push({ productVariant: { id: item.variantId, quantity: item.quantity } });
    }
  }

  // Push the BOGO discount
  if (bogoTargets.length) {
    discounts.push({
      targets: bogoTargets,
      // @ts-ignore
      value: { percentage: { value: (bogoDiscountPercentage ?? 100).toString() } },
      message: "BOGO Combo!",
    });
  }

  // Push the Additional Extra Discount
  if (extraTargets.length && additionalDiscountPercentage && additionalDiscountPercentage > 0) {
    discounts.push({
      targets: extraTargets,
      // @ts-ignore
      value: { percentage: { value: additionalDiscountPercentage.toString() } },
      message: `Extra ${additionalDiscountPercentage}% Off!`,
    });
  }

  if (!discounts.length) return EMPTY_DISCOUNT;

  return {
    discounts,
    discountApplicationStrategy: DiscountApplicationStrategy.All,
  };
}

function handleBogoGift(config: BogoGiftConfig, input: RunInput): FunctionRunResult {
  const { buyQuantity, getQuantity } = config;

  // Support both single giftVariantId and mystery pool giftVariantIds
  const giftPool: string[] = (config.giftVariantIds?.length
    ? config.giftVariantIds
    : config.giftVariantId
      ? [config.giftVariantId]
      : []) as string[];

  if (!buyQuantity || !getQuantity || !giftPool.length) return EMPTY_DISCOUNT;

  const totalQty = totalCartQuantity(input);
  const timesTriggered = Math.floor(totalQty / (buyQuantity + getQuantity));
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const discounts: FunctionRunResult["discounts"] = [];

  // 1. BOGO: discount "get" items 100%
  const bogoItemsToDiscount = timesTriggered * getQuantity;
  let discountedCount = 0;
  const bogoTargets: Target[] = [];

  // Sort lines ascending by price so we discount cheapest items first
  const sortedLines = [...input.cart.lines].sort((a, b) => {
    const priceA = parseFloat((a as any).cost?.amountPerQuantity?.amount ?? "0");
    const priceB = parseFloat((b as any).cost?.amountPerQuantity?.amount ?? "0");
    return priceA - priceB;
  });

  for (const line of sortedLines) {
    if (discountedCount >= bogoItemsToDiscount) break;
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      // Skip gift variants from BOGO calculation
      if (giftPool.some(id => gidMatch(id, variantId))) continue;
      const remaining = bogoItemsToDiscount - discountedCount;
      const qty = Math.min(line.quantity, remaining);
      bogoTargets.push({ productVariant: { id: variantId, quantity: qty } });
      discountedCount += qty;
    }
  }

  if (bogoTargets.length) {
    discounts.push({
      targets: bogoTargets,
      // @ts-ignore
      value: { percentage: { value: "100.0" } },
      message: "BOGO Applied!",
    });
  }

  // 2. Gift: discount whichever gift variant from the pool is in the cart
  for (const giftId of giftPool) {
    for (const line of input.cart.lines) {
      if (line.merchandise.__typename === "ProductVariant") {
        const variantId = (line.merchandise as any).id;
        if (gidMatch(variantId, giftId)) {
          discounts.push({
            targets: [{ productVariant: { id: variantId, quantity: 1 } }],
            // @ts-ignore
            value: { percentage: { value: "100.0" } },
            message: "Free Gift!",
          });
          break; // Only apply each unique gift variant once
        }
      }
    }
  }

  if (!discounts.length) return EMPTY_DISCOUNT;

  return {
    discounts,
    discountApplicationStrategy: DiscountApplicationStrategy.All,
  };
}

function handleBundleGift(config: BundleGiftConfig, input: RunInput): FunctionRunResult {
  const { bundleQuantity, giftVariantId } = config;
  if (!bundleQuantity || !giftVariantId) return EMPTY_DISCOUNT;

  // Count non-gift items
  let nonGiftQty = 0;
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      if (!gidMatch(variantId, giftVariantId)) {
        nonGiftQty += line.quantity;
      }
    }
  }

  if (nonGiftQty < bundleQuantity) return EMPTY_DISCOUNT;

  // Find the gift in cart and discount it 100%
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      if (gidMatch(variantId, giftVariantId)) {
        return {
          discounts: [{
            targets: [{ productVariant: { id: variantId, quantity: 1 } }],
            value: { percentage: { value: "100.0" } },
            message: "Bundle Gift Applied!",
          }],
          discountApplicationStrategy: DiscountApplicationStrategy.First,
        };
      }
    }
  }

  return EMPTY_DISCOUNT;
}

function handleBundlePriceGift(config: BundlePriceGiftConfig, input: RunInput): FunctionRunResult {
  const { bundleProductIds, bundleQuantity, bundlePrice, giftVariantId } = config;
  if (!bundleQuantity || !bundlePrice || !giftVariantId) return EMPTY_DISCOUNT;

  const hasBundleFilter = bundleProductIds && bundleProductIds.length > 0;

  // Collect bundle-eligible lines (exclude gift)
  interface LineInfo {
    variantId: string;
    productId: string;
    quantity: number;
    pricePerItem: number;
  }
  const bundleLines: LineInfo[] = [];
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      const productId = (line.merchandise as any).product?.id ?? "";
      if (gidMatch(variantId, giftVariantId)) continue; // skip gift
      if (hasBundleFilter && !bundleProductIds!.some(id => gidMatch(id, productId))) continue;
      bundleLines.push({
        variantId,
        productId,
        quantity: line.quantity,
        pricePerItem: parseFloat((line as any).cost?.amountPerQuantity?.amount ?? "0"),
      });
    }
  }

  const totalBundleQty = bundleLines.reduce((s, l) => s + l.quantity, 0);
  if (totalBundleQty < bundleQuantity) return EMPTY_DISCOUNT;

  const discounts: FunctionRunResult["discounts"] = [];

  // 1. Fixed bundle price discount — calculate total cost of bundle items and discount to bundlePrice
  //    We take the first `bundleQuantity` items (cheapest first) as the bundle
  const sorted = [...bundleLines].sort((a, b) => a.pricePerItem - b.pricePerItem);
  let bundleItemsNeeded = bundleQuantity;
  let bundleTotalCost = 0;
  const bundleTargets: { id: string; quantity: number; cost: number }[] = [];

  for (const l of sorted) {
    if (bundleItemsNeeded <= 0) break;
    const qty = Math.min(l.quantity, bundleItemsNeeded);
    bundleTotalCost += l.pricePerItem * qty;
    bundleTargets.push({ id: l.variantId, quantity: qty, cost: l.pricePerItem * qty });
    bundleItemsNeeded -= qty;
  }

  const requiredDiscount = bundleTotalCost - bundlePrice;
  if (requiredDiscount > 0) {
    const targets: Target[] = bundleTargets.map(t => ({
      productVariant: { id: t.id, quantity: t.quantity }
    }));
    discounts.push({
      targets,
      // @ts-ignore
      value: { fixedAmount: { amount: requiredDiscount.toFixed(2), appliesToEachItem: false } },
      message: `Bundle Deal: ${bundleQuantity} for ₹${bundlePrice}!`,
    });
  }

  // 2. Free gift — 100% off on the gift variant if it's in the cart
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      if (gidMatch(variantId, giftVariantId)) {
        discounts.push({
          targets: [{ productVariant: { id: variantId, quantity: 1 } }],
          // @ts-ignore
          value: { percentage: { value: "100.0" } },
          message: "Free Gift with Bundle!",
        });
        break;
      }
    }
  }

  if (!discounts.length) return EMPTY_DISCOUNT;

  return {
    discounts,
    discountApplicationStrategy: DiscountApplicationStrategy.All,
  };
}

// ── Main Entry Point ─────────────────────────────────────────────────

export function run(input: RunInput): FunctionRunResult {
  const raw = input?.discountNode?.metafield?.value ?? "{}";
  const configuration: Configuration = JSON.parse(raw);
  const configType = (configuration as any).configType ?? "BASIC";

  switch (configType) {
    case "BASIC":
      return handleBasic(configuration as BasicConfig, input);
    case "BOGO_DISCOUNT":
      return handleBogoDiscount(configuration as BogoDiscountConfig, input);
    case "BOGO_GIFT":
      return handleBogoGift(configuration as BogoGiftConfig, input);
    case "BUNDLE_GIFT":
      return handleBundleGift(configuration as BundleGiftConfig, input);
    case "BUNDLE_PRICE_GIFT":
      return handleBundlePriceGift(configuration as BundlePriceGiftConfig, input);
    default:
      return handleBasic(configuration as BasicConfig, input);
  }
}