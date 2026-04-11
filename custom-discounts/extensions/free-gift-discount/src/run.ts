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
  minimumSpend: number;
  giftVariantId: string;
};

type ProductPurchaseConfig = BaseConfig & {
  triggerProductId: string;
  giftVariantId: string;
};

type MysteryConfig = BaseConfig & {
  minQuantity: number;       // min cart items to trigger (e.g. 2)
  giftVariantIds: string[];  // pool of possible gifts
};

type OrderValueChoiceConfig = BaseConfig & {
  tiers: { minimumSpend: number; giftVariantId: string }[];
};

type TimeLimitedConfig = BaseConfig & {
  minimumSpend: number;
  giftVariantId: string;
  startDate: string;  // ISO date string
  endDate: string;
};

type AutoAddConfig = BaseConfig & {
  minimumSpend: number;
  giftVariantId: string;
};

type SubscriptionConfig = BaseConfig & {
  giftVariantId: string;
};

type SubscriptionFirstConfig = BaseConfig & {
  giftVariantId: string;
};

type MultiChoiceConfig = BaseConfig & {
  minimumSpend: number;
  giftVariantIds: string[];  // pool of gifts the customer can choose from
  maxGifts: number;          // how many they can pick (e.g., 2)
};

type OrderValuePickOneConfig = BaseConfig & {
  minimumSpend: number;
  giftVariantIds: string[];  // pool of gift options the customer picks from (exactly 1)
};

type OrderValueMultiPickConfig = BaseConfig & {
  minimumSpend: number;
  giftVariantIds: string[];  // pool of gift options
  maxGifts: number;          // how many the customer can pick (e.g., 2 out of 4)
};

type Configuration =
  | BasicConfig
  | ProductPurchaseConfig
  | MysteryConfig
  | OrderValueChoiceConfig
  | TimeLimitedConfig
  | AutoAddConfig
  | SubscriptionConfig
  | SubscriptionFirstConfig
  | MultiChoiceConfig
  | OrderValuePickOneConfig
  | OrderValueMultiPickConfig;

// ── Helpers ──────────────────────────────────────────────────────────
function normalizeGid(id: string): string {
  if (!id) return "";
  const match = id.match(/\/(\d+)$/);
  return match ? match[1] : id;
}

function gidMatch(storedId: string, cartId: string): boolean {
  return normalizeGid(storedId) === normalizeGid(cartId);
}

function findGiftInCart(input: RunInput, giftVariantId: string): Target | null {
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      if (gidMatch(variantId, giftVariantId)) {
        return { productVariant: { id: variantId, quantity: 1 } };
      }
    }
  }
  return null;
}

function cartSubtotal(input: RunInput, excludeVariantIds: string[] = []): number {
  let total = 0;
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      const isExcluded = excludeVariantIds.some(id => gidMatch(id, variantId));
      if (!isExcluded) {
        const costPerItem = parseFloat((line as any).cost?.amountPerQuantity?.amount ?? "0");
        total += costPerItem * line.quantity;
      }
    }
  }
  return total;
}

function makeGiftDiscount(targets: Target[], message: string): FunctionRunResult {
  return {
    discounts: [{
      targets,
      value: { percentage: { value: "100.0" } },
      message,
    }],
    discountApplicationStrategy: DiscountApplicationStrategy.First,
  };
}

// ── Handlers ─────────────────────────────────────────────────────────

function handleBasic(config: BasicConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumSpend || !config.giftVariantId) return EMPTY_DISCOUNT;
  if (cartSubtotal(input, [config.giftVariantId]) < config.minimumSpend) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, config.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Free Gift Applied!");
}

function handleProductPurchase(config: ProductPurchaseConfig, input: RunInput): FunctionRunResult {
  if (!config.triggerProductId || !config.giftVariantId) return EMPTY_DISCOUNT;

  // Check if the trigger product is in the cart
  let triggerFound = false;
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const productId = (line.merchandise as any).product?.id ?? "";
      if (gidMatch(productId, config.triggerProductId)) {
        triggerFound = true;
        break;
      }
    }
  }

  if (!triggerFound) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, config.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Free Gift with Purchase!");
}

function handleMystery(config: MysteryConfig, input: RunInput): FunctionRunResult {
  if (!config.minQuantity || !config.giftVariantIds?.length) return EMPTY_DISCOUNT;

  // Count total items in cart, excluding gift variants
  let totalItems = 0;
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = (line.merchandise as any).id;
      if (!config.giftVariantIds.some(id => gidMatch(id, variantId))) {
        totalItems += line.quantity;
      }
    }
  }

  if (totalItems < config.minQuantity) return EMPTY_DISCOUNT;

  // Pick whichever mystery gift variant is actually in the cart
  for (const giftId of config.giftVariantIds) {
    const target = findGiftInCart(input, giftId);
    if (target) {
      return makeGiftDiscount([target], "Mystery Gift Applied!");
    }
  }

  return EMPTY_DISCOUNT;
}

function handleOrderValueChoice(config: OrderValueChoiceConfig, input: RunInput): FunctionRunResult {
  if (!config.tiers?.length) return EMPTY_DISCOUNT;

  // Exclude all gift variants from the subtotal so gifts don't inflate the total
  const allGiftIds = config.tiers.map(t => t.giftVariantId).filter(Boolean);
  const subtotal = cartSubtotal(input, allGiftIds);

  // Sort tiers descending by minimumSpend to find the best qualifying tier
  const sortedTiers = [...config.tiers].sort((a, b) => b.minimumSpend - a.minimumSpend);
  const matchedTier = sortedTiers.find(t => subtotal >= t.minimumSpend);

  if (!matchedTier) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, matchedTier.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Gift Choice Unlocked!");
}

function handleTimeLimited(config: TimeLimitedConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumSpend || !config.giftVariantId) return EMPTY_DISCOUNT;

  // Note: Shopify Functions run in a sandboxed WASM environment. 
  // Date.now() may not be available. We do our best-effort check here.
  // In production, the active/inactive state should also be managed via the admin API
  // (e.g., only deploying the discount within the valid window).
  try {
    const now = new Date();
    if (config.startDate && now < new Date(config.startDate)) return EMPTY_DISCOUNT;
    if (config.endDate && now > new Date(config.endDate)) return EMPTY_DISCOUNT;
  } catch {
    // If date parsing fails, proceed (safeguard)
  }

  if (cartSubtotal(input, [config.giftVariantId]) < config.minimumSpend) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, config.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Limited-Time Free Gift!");
}

function handleAutoAdd(config: AutoAddConfig, input: RunInput): FunctionRunResult {
  // Auto-add behavior requires Cart Transform API which is a separate extension type.
  // For the discount function, we treat this identically to BASIC — if the gift is in 
  // the cart (added by a Cart Transform), we discount it 100%.
  if (!config.minimumSpend || !config.giftVariantId) return EMPTY_DISCOUNT;
  if (cartSubtotal(input, [config.giftVariantId]) < config.minimumSpend) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, config.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Free Gift Auto-Applied!");
}

function handleSubscription(config: SubscriptionConfig, input: RunInput): FunctionRunResult {
  if (!config.giftVariantId) return EMPTY_DISCOUNT;

  // Check if ANY cart line has a selling plan (subscription)
  let hasSubscription = false;
  for (const line of input.cart.lines) {
    if ((line as any).sellingPlanAllocation?.sellingPlan?.id) {
      hasSubscription = true;
      break;
    }
  }

  if (!hasSubscription) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, config.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Free Gift with Subscription!");
}

function handleSubscriptionFirst(config: SubscriptionFirstConfig, input: RunInput): FunctionRunResult {
  if (!config.giftVariantId) return EMPTY_DISCOUNT;

  // Only apply on the customer's very first order (numberOfOrders === 0)
  const numberOfOrders = (input.cart as any).buyerIdentity?.customer?.numberOfOrders ?? null;
  // If customer info is not available (guest), we allow the gift (best-effort)
  if (numberOfOrders !== null && numberOfOrders > 0) return EMPTY_DISCOUNT;

  // Must have at least one subscription item in the cart
  let hasSubscription = false;
  for (const line of input.cart.lines) {
    if ((line as any).sellingPlanAllocation?.sellingPlan?.id) {
      hasSubscription = true;
      break;
    }
  }
  if (!hasSubscription) return EMPTY_DISCOUNT;

  const target = findGiftInCart(input, config.giftVariantId);
  if (!target) return EMPTY_DISCOUNT;

  return makeGiftDiscount([target], "Welcome Gift — Free on First Subscription!");
}

function handleMultiChoice(config: MultiChoiceConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumSpend || !config.giftVariantIds?.length) return EMPTY_DISCOUNT;
  if (cartSubtotal(input, config.giftVariantIds) < config.minimumSpend) return EMPTY_DISCOUNT;

  const maxGifts = config.maxGifts || 1;
  const targets: Target[] = [];

  // Find whichever gift variants from the pool are actually in the cart
  for (const giftId of config.giftVariantIds) {
    if (targets.length >= maxGifts) break;
    const target = findGiftInCart(input, giftId);
    if (target) {
      targets.push(target);
    }
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  return makeGiftDiscount(targets, `Pick Your Gifts (${targets.length}/${maxGifts})!`);
}

// ── Main Entry Point ─────────────────────────────────────────────────

function handleOrderValuePickOne(config: OrderValuePickOneConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumSpend || !config.giftVariantIds?.length) return EMPTY_DISCOUNT;

  // Exclude all gift variants from the subtotal calculation
  const subtotal = cartSubtotal(input, config.giftVariantIds);
  if (subtotal < config.minimumSpend) return EMPTY_DISCOUNT;

  // Discount whichever single gift the customer chose (first one found in cart)
  for (const giftId of config.giftVariantIds) {
    const target = findGiftInCart(input, giftId);
    if (target) {
      return makeGiftDiscount([target], "Your Free Gift — Enjoy!");
    }
  }

  return EMPTY_DISCOUNT;
}

function handleOrderValueMultiPick(config: OrderValueMultiPickConfig, input: RunInput): FunctionRunResult {
  if (!config.minimumSpend || !config.giftVariantIds?.length) return EMPTY_DISCOUNT;

  const subtotal = cartSubtotal(input, config.giftVariantIds);
  if (subtotal < config.minimumSpend) return EMPTY_DISCOUNT;

  const maxGifts = config.maxGifts || 1;
  const targets: Target[] = [];

  // Discount up to maxGifts items from the gift pool that the customer has added
  for (const giftId of config.giftVariantIds) {
    if (targets.length >= maxGifts) break;
    const target = findGiftInCart(input, giftId);
    if (target) targets.push(target);
  }

  if (!targets.length) return EMPTY_DISCOUNT;

  return makeGiftDiscount(targets, `Your ${targets.length} Free Gift${targets.length > 1 ? 's' : ''} — Enjoy!`);
}

export function run(input: RunInput): FunctionRunResult {
  const raw = input?.discountNode?.metafield?.value ?? "{}";
  const configuration: Configuration = JSON.parse(raw);
  const configType = (configuration as any).configType ?? "BASIC";

  switch (configType) {
    case "BASIC":
      return handleBasic(configuration as BasicConfig, input);
    case "PRODUCT_PURCHASE":
      return handleProductPurchase(configuration as ProductPurchaseConfig, input);
    case "MYSTERY":
      return handleMystery(configuration as MysteryConfig, input);
    case "ORDER_VALUE_CHOICE":
      return handleOrderValueChoice(configuration as OrderValueChoiceConfig, input);
    case "TIME_LIMITED":
      return handleTimeLimited(configuration as TimeLimitedConfig, input);
    case "AUTO_ADD":
      return handleAutoAdd(configuration as AutoAddConfig, input);
    case "SUBSCRIPTION":
      return handleSubscription(configuration as SubscriptionConfig, input);
    case "SUBSCRIPTION_FIRST":
      return handleSubscriptionFirst(configuration as SubscriptionFirstConfig, input);
    case "MULTI_CHOICE":
      return handleMultiChoice(configuration as MultiChoiceConfig, input);
    case "ORDER_VALUE_PICK_ONE":
      return handleOrderValuePickOne(configuration as OrderValuePickOneConfig, input);
    case "ORDER_VALUE_MULTI_PICK":
      return handleOrderValueMultiPick(configuration as OrderValueMultiPickConfig, input);
    default:
      return handleBasic(configuration as BasicConfig, input);
  }
}