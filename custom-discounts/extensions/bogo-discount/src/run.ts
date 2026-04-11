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

type BaseConfig = {
  configType: string;
  discountType?: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue?: number;
};

type BasicConfig = BaseConfig & {
  buyQuantity: number;
  getQuantity: number;
  discountPercentage: number;
  // Optional: restrict to specific products/variants for "Same Product" BOGO
  eligibleProductIds?: string[];
  eligibleVariantIds?: string[];
};

type CheapestFreeConfig = BaseConfig & {
  minimumQuantity: number;
};

type DifferentProductConfig = BaseConfig & {
  buyVariantIds: string[];
  getVariantId?: string;
  getVariantIds?: string[];
  buyQuantity: number;
  discountPercentage: number;
};

type MultiTierConfig = BaseConfig & {
  tiers: { buyQuantity: number; getQuantity: number; discountPercentage: number }[];
};

type MixMatchConfig = BaseConfig & {
  eligibleProductIds: string[];
  buyQuantity: number;
  getQuantity: number;
  discountPercentage: number;
};

type MixMatchBogoConfig = BaseConfig & {
  buyProductIds: string[];
  getProductIds: string[];
  buyQuantity: number;
  getQuantity: number;
  discountPercentage: number;
};

type QuantityLimitedConfig = BaseConfig & {
  buyQuantity: number;
  getQuantity: number;
  discountPercentage: number;
  maxApplications: number;
};

type VariantScopedConfig = BaseConfig & {
  eligibleVariantIds: string[];
  buyQuantity: number;
  getQuantity: number;
  discountPercentage: number;
};

type CollectionVariantScopedConfig = BaseConfig & {
  scopedProductIds?: string[];
  scopedVariantIds?: string[];
  buyQuantity: number;
  getQuantity: number;
  discountPercentage: number;
};

type Configuration =
  | BasicConfig
  | CheapestFreeConfig
  | DifferentProductConfig
  | MultiTierConfig
  | MixMatchConfig
  | MixMatchBogoConfig
  | QuantityLimitedConfig
  | VariantScopedConfig
  | CollectionVariantScopedConfig;

// ── Helper: extract variant info from a cart line ─────────────────────

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

// Normalize a Shopify GID or numeric ID to just the numeric part for comparison.
// Handles: "gid://shopify/Product/12345", "gid://shopify/ProductVariant/12345", "12345"
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
  const { buyQuantity, getQuantity, discountPercentage } = config;
  if (!buyQuantity || !getQuantity || !discountPercentage) return EMPTY_DISCOUNT;

  const hasProductFilter = (config.eligibleProductIds?.length ?? 0) > 0;
  const hasVariantFilter = (config.eligibleVariantIds?.length ?? 0) > 0;

  // ── Same-Product / Scoped mode ────────────────────────────────────────
  // When specific products or variants are provided, evaluate BOGO independently
  // for EACH matching product/variant so "Buy 1 Shirt Get 1 Shirt Free" works
  // even when other products are in the cart.
  if (hasProductFilter || hasVariantFilter) {
    const lines = extractLines(input);

    // Group eligible lines by productId (or variantId for variant-scoped)
    const groupKey = (l: LineInfo) => hasVariantFilter ? l.variantId : l.productId;
    const isEligible = (l: LineInfo) =>
      hasVariantFilter
        ? config.eligibleVariantIds!.some(id => gidMatch(id, l.variantId))
        : config.eligibleProductIds!.some(id => gidMatch(id, l.productId));

    const groups = new Map<string, LineInfo[]>();
    for (const l of lines) {
      if (!isEligible(l)) continue;
      const key = groupKey(l);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(l);
    }

    if (groups.size === 0) return EMPTY_DISCOUNT;

    const allTargets: Target[] = [];

    for (const groupLines of groups.values()) {
      const totalGroupQty = groupLines.reduce((s, l) => s + l.quantity, 0);
      const timesTriggered = Math.floor(totalGroupQty / (buyQuantity + getQuantity));
      if (timesTriggered === 0) continue;

      const itemsToDiscount = timesTriggered * getQuantity;
      let discountedCount = 0;

      // Discount cheapest items first within this group
      const sorted = [...groupLines].sort((a, b) => a.pricePerItem - b.pricePerItem);
      for (const l of sorted) {
        if (discountedCount >= itemsToDiscount) break;
        const qty = Math.min(l.quantity, itemsToDiscount - discountedCount);
        allTargets.push({ productVariant: { id: l.variantId, quantity: qty } });
        discountedCount += qty;
      }
    }

    if (!allTargets.length) return EMPTY_DISCOUNT;

    const pct = config.discountValue !== undefined ? config.discountValue : (discountPercentage || 0);
    return {
      discounts: [{ targets: allTargets, value: { percentage: { value: pct.toString() } }, message: "BOGO Applied!" }],
      discountApplicationStrategy: DiscountApplicationStrategy.First,
    };
  }

  // ── Cart-wide mode (no product filter) ───────────────────────────────
  let totalEligibleQuantity = 0;
  input.cart.lines.forEach(line => { totalEligibleQuantity += line.quantity; });

  const timesTriggered = Math.floor(totalEligibleQuantity / (buyQuantity + getQuantity));
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const itemsToDiscount = timesTriggered * getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort lines ascending by price so we discount cheapest items first
  const sortedLines = [...input.cart.lines].sort((a, b) => {
    const priceA = parseFloat((a as any).cost?.amountPerQuantity?.amount ?? "0");
    const priceB = parseFloat((b as any).cost?.amountPerQuantity?.amount ?? "0");
    return priceA - priceB;
  });

  for (const line of sortedLines) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(line.quantity, remaining);
    if (line.merchandise.__typename === "ProductVariant") {
      targets.push({ productVariant: { id: (line.merchandise as any).id, quantity: qty } });
      discountedItemsCount += qty;
    }
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  let valueObj: any = {};
  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;

  if (isFixedAmount) {
    let targetTotalCost = 0;
    for (const t of targets) {
      const vId = t.productVariant?.id;
      const qty = t.productVariant?.quantity || 0;
      const line = input.cart.lines.find(l => l.merchandise.__typename === "ProductVariant" && (l.merchandise as any).id === vId);
      if (line) {
        targetTotalCost += parseFloat((line as any).cost?.amountPerQuantity?.amount ?? "0") * qty;
      }
    }
    const reqDiscount = targetTotalCost - (config.discountValue || 0);
    if (reqDiscount <= 0) return EMPTY_DISCOUNT;
    valueObj = { fixedAmount: { amount: reqDiscount.toFixed(2), appliesToEachItem: false } };
  } else {
    const pct = config.discountValue !== undefined ? config.discountValue : (discountPercentage || 0);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{ targets, value: valueObj, message: "BOGO Applied!" }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleCheapestFree(config: CheapestFreeConfig, input: RunInput): FunctionRunResult {
  const { minimumQuantity } = config;
  if (!minimumQuantity) return EMPTY_DISCOUNT;

  const lines = extractLines(input);
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  if (totalQty < minimumQuantity) return EMPTY_DISCOUNT;

  // Expand lines into individual items with prices, then sort ascending by price
  const items: { variantId: string; price: number }[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.quantity; i++) {
      items.push({ variantId: l.variantId, price: l.pricePerItem });
    }
  }
  items.sort((a, b) => a.price - b.price);

  // The cheapest item gets 100% off
  const cheapestVariantId = items[0].variantId;

  return {
    discounts: [{
      targets: [{ productVariant: { id: cheapestVariantId, quantity: 1 } }],
      value: { percentage: { value: "100.0" } },
      message: "Cheapest item is FREE!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleDifferentProduct(config: DifferentProductConfig, input: RunInput): FunctionRunResult {
  const { buyVariantIds, getVariantId, getVariantIds, buyQuantity, discountPercentage } = config;
  const targetGetIds = getVariantIds && getVariantIds.length > 0 ? getVariantIds : (getVariantId ? [getVariantId] : []);
  if (!targetGetIds.length || !buyQuantity) return EMPTY_DISCOUNT;

  const lines = extractLines(input);

  // Count how many qualifying "buy" items are in the cart
  let buyCount = 0;
  for (const l of lines) {
    // If buyVariantIds is empty or omitted, ALL items in the cart (except the get variants) qualify towards "Buy"
    const isBuyMatch = !buyVariantIds?.length || buyVariantIds.some(id => gidMatch(id, l.variantId));
    if (isBuyMatch) {
      // Don't count the free item itself towards the buy requirement unless it specifically matches
      if (!buyVariantIds?.length && targetGetIds.some(id => gidMatch(id, l.variantId))) continue;
      buyCount += l.quantity;
    }
  }

  if (buyCount < buyQuantity) return EMPTY_DISCOUNT;

  // Find all "get" variants in the cart
  const getLines = lines.filter(l => targetGetIds.some(id => gidMatch(id, l.variantId)));
  if (!getLines.length) return EMPTY_DISCOUNT;

  // Sort ascending by price
  const sortedGetLines = [...getLines].sort((a, b) => a.pricePerItem - b.pricePerItem);

  const timesTriggered = Math.floor(buyCount / buyQuantity);
  const potentialGetTotal = sortedGetLines.reduce((sum, l) => sum + l.quantity, 0);
  const qtyToDiscount = Math.min(timesTriggered, potentialGetTotal);

  let valueObj: any = {};
  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;
  const targets: Target[] = [];
  
  let discountedSoFar = 0;
  for (const l of sortedGetLines) {
      if (discountedSoFar >= qtyToDiscount) break;
      const q = Math.min(l.quantity, qtyToDiscount - discountedSoFar);
      targets.push({ productVariant: { id: l.variantId, quantity: q } });
      discountedSoFar += q;
  }

  if (isFixedAmount) {
    let targetTotalCost = 0;
    for (const t of targets) {
       const vId = t.productVariant?.id;
       const q = t.productVariant?.quantity || 0;
       const matchL = sortedGetLines.find(x => x.variantId === vId);
       if (matchL) targetTotalCost += matchL.pricePerItem * q;
    }
    const reqDiscount = targetTotalCost - (config.discountValue || 0);
    if (reqDiscount <= 0) return EMPTY_DISCOUNT;
    valueObj = { fixedAmount: { amount: reqDiscount.toFixed(2), appliesToEachItem: false } };
  } else {
    const pct = config.discountValue !== undefined ? config.discountValue : (discountPercentage ?? 100);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{
      targets: targets,
      value: valueObj,
      message: "Buy X Get Y Applied!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleMultiTier(config: MultiTierConfig, input: RunInput): FunctionRunResult {
  const { tiers } = config;
  if (!tiers?.length) return EMPTY_DISCOUNT;

  let totalQty = 0;
  input.cart.lines.forEach(line => { totalQty += line.quantity; });

  // Sort tiers descending by buyQuantity so the highest matching tier is picked first
  const sortedTiers = [...tiers].sort((a, b) => b.buyQuantity - a.buyQuantity);
  const matchedTier = sortedTiers.find(t => totalQty >= (t.buyQuantity + t.getQuantity));

  if (!matchedTier) return EMPTY_DISCOUNT;

  const timesTriggered = Math.floor(totalQty / (matchedTier.buyQuantity + matchedTier.getQuantity));
  const itemsToDiscount = timesTriggered * matchedTier.getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort lines ascending by price so we discount cheapest items first
  const sortedLines = [...input.cart.lines].sort((a, b) => {
    const priceA = parseFloat((a as any).cost?.amountPerQuantity?.amount ?? "0");
    const priceB = parseFloat((b as any).cost?.amountPerQuantity?.amount ?? "0");
    return priceA - priceB;
  });

  for (const line of sortedLines) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(line.quantity, remaining);
    if (line.merchandise.__typename === "ProductVariant") {
      targets.push({ productVariant: { id: (line.merchandise as any).id, quantity: qty } });
      discountedItemsCount += qty;
    }
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  return {
    discounts: [{
      targets,
      value: { percentage: { value: matchedTier.discountPercentage.toString() } },
      message: `Multi-Tier BOGO: ${matchedTier.discountPercentage}% Off!`,
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleMixMatch(config: MixMatchConfig, input: RunInput): FunctionRunResult {
  const { eligibleProductIds, buyQuantity, getQuantity, discountPercentage } = config;
  if (!eligibleProductIds?.length || !buyQuantity || !getQuantity) return EMPTY_DISCOUNT;

  const lines = extractLines(input);

  // Filter to lines whose product ID is in the eligible set
  const eligibleLines = lines.filter(l => eligibleProductIds.some(id => gidMatch(id, l.productId)));
  const eligibleQty = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);

  const timesTriggered = Math.floor(eligibleQty / (buyQuantity + getQuantity));
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const itemsToDiscount = timesTriggered * getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort eligible lines ascending by price so we discount cheapest items first
  const sortedEligible = [...eligibleLines].sort((a, b) => a.pricePerItem - b.pricePerItem);

  for (const l of sortedEligible) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(l.quantity, remaining);
    targets.push({ productVariant: { id: l.variantId, quantity: qty } });
    discountedItemsCount += qty;
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  let valueObj: any = {};
  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;

  if (isFixedAmount) {
    let targetTotalCost = 0;
    for (const t of targets) {
      const vId = t.productVariant?.id;
      const qty = t.productVariant?.quantity || 0;
      const lineMatch = sortedEligible.find(l => l.variantId === vId);
      if (lineMatch) {
        targetTotalCost += lineMatch.pricePerItem * qty;
      }
    }
    const reqDiscount = targetTotalCost - (config.discountValue || 0);
    if (reqDiscount <= 0) return EMPTY_DISCOUNT;
    valueObj = { fixedAmount: { amount: reqDiscount.toFixed(2), appliesToEachItem: false } };
  } else {
    const pct = config.discountValue !== undefined ? config.discountValue : (discountPercentage ?? 100);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{
      targets,
      value: valueObj,
      message: "Mix & Match BOGO Applied!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleMixMatchBogo(config: MixMatchBogoConfig, input: RunInput): FunctionRunResult {
  const { buyProductIds, getProductIds, buyQuantity, getQuantity } = config;
  if (!buyProductIds?.length || !getProductIds?.length || !buyQuantity || !getQuantity) return EMPTY_DISCOUNT;

  const lines = extractLines(input);

  // Count items from Collection A (buy products) — use GID normalization to handle format differences
  const buyLines = lines.filter(l => buyProductIds.some(id => gidMatch(id, l.productId)));
  const buyQty = buyLines.reduce((sum, l) => sum + l.quantity, 0);

  if (buyQty < buyQuantity) return EMPTY_DISCOUNT;

  const timesTriggered = Math.floor(buyQty / buyQuantity);

  // Find items from Collection B (get products) — must NOT overlap with buy items
  const getLines = lines.filter(l =>
    getProductIds.some(id => gidMatch(id, l.productId)) &&
    !buyProductIds.some(id => gidMatch(id, l.productId))
  );
  // If no get-only lines exist, allow overlap (buy and get can be same product)
  const effectiveGetLines = getLines.length > 0
    ? getLines
    : lines.filter(l => getProductIds.some(id => gidMatch(id, l.productId)));

  if (effectiveGetLines.length === 0) return EMPTY_DISCOUNT;

  const itemsToDiscount = timesTriggered * getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort Collection B lines ascending by price → discount cheapest first
  const sortedGetLines = [...effectiveGetLines].sort((a, b) => a.pricePerItem - b.pricePerItem);

  for (const l of sortedGetLines) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(l.quantity, remaining);
    targets.push({ productVariant: { id: l.variantId, quantity: qty } });
    discountedItemsCount += qty;
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  return {
    discounts: [{
      targets,
      value: { percentage: { value: "100.0" } },
      message: "Mix & Match BOGO: Free item from Collection B!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleQuantityLimited(config: QuantityLimitedConfig, input: RunInput): FunctionRunResult {
  const { buyQuantity, getQuantity, discountPercentage, maxApplications } = config;
  if (!buyQuantity || !getQuantity || !discountPercentage) return EMPTY_DISCOUNT;

  let totalQty = 0;
  input.cart.lines.forEach(line => { totalQty += line.quantity; });

  let timesTriggered = Math.floor(totalQty / (buyQuantity + getQuantity));
  if (maxApplications && maxApplications > 0) {
    timesTriggered = Math.min(timesTriggered, maxApplications);
  }
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const itemsToDiscount = timesTriggered * getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort lines ascending by price so we discount cheapest items first
  const sortedLines = [...input.cart.lines].sort((a, b) => {
    const priceA = parseFloat((a as any).cost?.amountPerQuantity?.amount ?? "0");
    const priceB = parseFloat((b as any).cost?.amountPerQuantity?.amount ?? "0");
    return priceA - priceB;
  });

  for (const line of sortedLines) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(line.quantity, remaining);
    if (line.merchandise.__typename === "ProductVariant") {
      targets.push({ productVariant: { id: (line.merchandise as any).id, quantity: qty } });
      discountedItemsCount += qty;
    }
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  let valueObj: any = {};
  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;

  if (isFixedAmount) {
    let targetTotalCost = 0;
    for (const t of targets) {
      const vId = t.productVariant?.id;
      const qty = t.productVariant?.quantity || 0;
      const line = input.cart.lines.find(l => l.merchandise.__typename === "ProductVariant" && (l.merchandise as any).id === vId);
      if (line) {
        targetTotalCost += parseFloat((line as any).cost?.amountPerQuantity?.amount ?? "0") * qty;
      }
    }
    const reqDiscount = targetTotalCost - (config.discountValue || 0);
    if (reqDiscount <= 0) return EMPTY_DISCOUNT;
    valueObj = { fixedAmount: { amount: reqDiscount.toFixed(2), appliesToEachItem: false } };
  } else {
    const pct = config.discountValue !== undefined ? config.discountValue : (discountPercentage || 0);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{
      targets,
      value: valueObj,
      message: "BOGO Applied (Limited)!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleVariantScoped(config: VariantScopedConfig, input: RunInput): FunctionRunResult {
  const { eligibleVariantIds, buyQuantity, getQuantity, discountPercentage } = config;
  if (!eligibleVariantIds?.length || !buyQuantity || !getQuantity) return EMPTY_DISCOUNT;

  const lines = extractLines(input);
  const eligibleLines = lines.filter(l => eligibleVariantIds.some(id => gidMatch(id, l.variantId)));
  const eligibleQty = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);

  const timesTriggered = Math.floor(eligibleQty / (buyQuantity + getQuantity));
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const itemsToDiscount = timesTriggered * getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort eligible lines ascending by price so we discount cheapest items first
  const sortedEligible = [...eligibleLines].sort((a, b) => a.pricePerItem - b.pricePerItem);

  for (const l of sortedEligible) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(l.quantity, remaining);
    targets.push({ productVariant: { id: l.variantId, quantity: qty } });
    discountedItemsCount += qty;
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  let valueObj: any = {};
  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;

  if (isFixedAmount) {
    let targetTotalCost = 0;
    for (const t of targets) {
      const vId = t.productVariant?.id;
      const qty = t.productVariant?.quantity || 0;
      const lineMatch = sortedEligible.find(l => l.variantId === vId);
      if (lineMatch) {
        targetTotalCost += lineMatch.pricePerItem * qty;
      }
    }
    const reqDiscount = targetTotalCost - (config.discountValue || 0);
    if (reqDiscount <= 0) return EMPTY_DISCOUNT;
    valueObj = { fixedAmount: { amount: reqDiscount.toFixed(2), appliesToEachItem: false } };
  } else {
    const pct = config.discountValue !== undefined ? config.discountValue : (discountPercentage || 0);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{
      targets,
      value: valueObj,
      message: "BOGO Applied!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

function handleCollectionVariantScoped(config: CollectionVariantScopedConfig, input: RunInput): FunctionRunResult {
  const { scopedProductIds, scopedVariantIds, buyQuantity, getQuantity } = config;
  if ((!scopedProductIds?.length && !scopedVariantIds?.length) || !buyQuantity || !getQuantity) return EMPTY_DISCOUNT;

  const lines = extractLines(input);

  // A line is eligible if its product matches scopedProductIds OR its variant matches scopedVariantIds
  // Use GID normalization to handle format differences between stored IDs and cart line IDs
  const eligibleLines = lines.filter(l => {
    const matchProduct = scopedProductIds?.length
      ? scopedProductIds.some(id => gidMatch(id, l.productId))
      : false;
    const matchVariant = scopedVariantIds?.length
      ? scopedVariantIds.some(id => gidMatch(id, l.variantId))
      : false;
    return matchProduct || matchVariant;
  });

  const eligibleQty = eligibleLines.reduce((sum, l) => sum + l.quantity, 0);
  const timesTriggered = Math.floor(eligibleQty / (buyQuantity + getQuantity));
  if (timesTriggered === 0) return EMPTY_DISCOUNT;

  const itemsToDiscount = timesTriggered * getQuantity;
  let discountedItemsCount = 0;
  const targets: Target[] = [];

  // Sort ascending by price — discount cheapest first
  const sortedEligible = [...eligibleLines].sort((a, b) => a.pricePerItem - b.pricePerItem);

  for (const l of sortedEligible) {
    if (discountedItemsCount >= itemsToDiscount) break;
    const remaining = itemsToDiscount - discountedItemsCount;
    const qty = Math.min(l.quantity, remaining);
    targets.push({ productVariant: { id: l.variantId, quantity: qty } });
    discountedItemsCount += qty;
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  let valueObj: any = {};
  const isFixedAmount = config.discountType === "FIXED_AMOUNT" && config.discountValue !== undefined;

  if (isFixedAmount) {
    let targetTotalCost = 0;
    for (const t of targets) {
      const vId = t.productVariant?.id;
      const qty = t.productVariant?.quantity || 0;
      const lineMatch = sortedEligible.find(l => l.variantId === vId);
      if (lineMatch) {
        targetTotalCost += lineMatch.pricePerItem * qty;
      }
    }
    const reqDiscount = targetTotalCost - (config.discountValue || 0);
    if (reqDiscount <= 0) return EMPTY_DISCOUNT;
    valueObj = { fixedAmount: { amount: reqDiscount.toFixed(2), appliesToEachItem: false } };
  } else {
    const pct = config.discountValue !== undefined ? config.discountValue : (config.discountPercentage || 0);
    valueObj = { percentage: { value: pct.toString() } };
  }

  return {
    discounts: [{
      targets,
      value: valueObj,
      message: "BOGO Applied (Scoped)!",
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
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
    case "CHEAPEST_FREE":
      return handleCheapestFree(configuration as CheapestFreeConfig, input);
    case "DIFFERENT_PRODUCT":
      return handleDifferentProduct(configuration as DifferentProductConfig, input);
    case "MULTI_TIER":
      return handleMultiTier(configuration as MultiTierConfig, input);
    case "MIX_MATCH":
      return handleMixMatch(configuration as MixMatchConfig, input);
    case "MIX_MATCH_BOGO":
      return handleMixMatchBogo(configuration as MixMatchBogoConfig, input);
    case "QUANTITY_LIMITED":
      return handleQuantityLimited(configuration as QuantityLimitedConfig, input);
    case "VARIANT_SCOPED":
      return handleVariantScoped(configuration as VariantScopedConfig, input);
    case "COLLECTION_VARIANT_SCOPED":
      return handleCollectionVariantScoped(configuration as CollectionVariantScopedConfig, input);
    default:
      return handleBasic(configuration as BasicConfig, input);
  }
}