import { FormLayout, TextField, Select, BlockStack, Divider, Text, Banner } from '@shopify/polaris';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import ProductPicker from '../ProductPicker';

const COMBO_SUB_TYPES = [
    { label: 'Basic (Qty Threshold + Variant Discount)', value: 'BASIC' },
    { label: 'BOGO + Extra Discount Combo', value: 'BOGO_DISCOUNT' },
    { label: 'BOGO + Free Gift', value: 'BOGO_GIFT' },
    { label: 'Bundle + Free Gift', value: 'BUNDLE_GIFT' },
    { label: 'Bundle + Gift (Fixed Price Bundle)', value: 'BUNDLE_PRICE_GIFT' },
];

export interface ComboFormHandle {
    getConfig: () => { configType: string;[key: string]: any };
}

const ComboForm = forwardRef<ComboFormHandle, { initialConfig?: any }>(({ initialConfig }, ref) => {
    const [subType, setSubType] = useState('BASIC');

    // Basic
    const [minQty, setMinQty] = useState('2');
    const [targetVariantList, setTargetVariantList] = useState<string[]>([]);

    // Global Discount Type for applicable combos
    const [discountType, setDiscountType] = useState('PERCENTAGE'); // PERCENTAGE or FIXED_AMOUNT
    const [discountValue, setDiscountValue] = useState('50'); // Shared field for % or ₹ amount

    // BogoDiscount
    const [buyQty, setBuyQty] = useState('2');
    const [getQty, setGetQty] = useState('1');
    const [bogoDiscountPct, setBogoDiscountPct] = useState('100');
    const [additionalDiscountPct, setAdditionalDiscountPct] = useState('10');

    // BogoGift / BundleGift
    const [giftVariantIdList, setGiftVariantIdList] = useState<string[]>([]);
    const [giftVariantIdsList, setGiftVariantIdsList] = useState<string[]>([]); // mystery pool
    const [bundleQty, setBundleQty] = useState('3');

    // BundlePriceGift
    const [bundleProductIds, setBundleProductIds] = useState<string[]>([]);
    const [bundlePrice, setBundlePrice] = useState('1499');

    // Pre-fill from initialConfig
    useEffect(() => {
        if (!initialConfig) return;
        setSubType(initialConfig.configType || 'BASIC');
        if (initialConfig.minimumQuantity) setMinQty(String(initialConfig.minimumQuantity));
        if (initialConfig.targetVariantId) setTargetVariantList([initialConfig.targetVariantId]);
        if (initialConfig.discountType) setDiscountType(initialConfig.discountType);
        if (initialConfig.discountValue !== undefined) {
            setDiscountValue(String(initialConfig.discountValue));
        } else if (initialConfig.discountPercentage !== undefined) {
            // Fallback for older configs
            setDiscountValue(String(initialConfig.discountPercentage));
        }
        if (initialConfig.buyQuantity) setBuyQty(String(initialConfig.buyQuantity));
        if (initialConfig.getQuantity) setGetQty(String(initialConfig.getQuantity));
        if (initialConfig.bogoDiscountPercentage) setBogoDiscountPct(String(initialConfig.bogoDiscountPercentage));
        if (initialConfig.additionalDiscountPercentage) setAdditionalDiscountPct(String(initialConfig.additionalDiscountPercentage));
        if (initialConfig.giftVariantId) setGiftVariantIdList([initialConfig.giftVariantId]);
        if (initialConfig.giftVariantIds) setGiftVariantIdsList(initialConfig.giftVariantIds);
        if (initialConfig.bundleQuantity) setBundleQty(String(initialConfig.bundleQuantity));
        if (initialConfig.bundleProductIds) setBundleProductIds(initialConfig.bundleProductIds);
        if (initialConfig.bundlePrice !== undefined) setBundlePrice(String(initialConfig.bundlePrice));
    }, [initialConfig]);

    const buildConfig = useCallback(() => {
        const base = { configType: subType };

        switch (subType) {
            case 'BASIC':
                return {
                    ...base,
                    minimumQuantity: parseInt(minQty, 10),
                    targetVariantId: targetVariantList[0] || '',
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    // Backwards compatibility for older function logic before redeploy
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                };
            case 'BOGO_DISCOUNT':
                return {
                    ...base,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    bogoDiscountPercentage: parseInt(bogoDiscountPct, 10),
                    additionalDiscountPercentage: parseInt(additionalDiscountPct, 10),
                };
            case 'BOGO_GIFT':
                return {
                    ...base,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    // Use pool if merchant added multiple, else single gift
                    ...(giftVariantIdsList.length > 0
                        ? { giftVariantIds: giftVariantIdsList }
                        : { giftVariantId: giftVariantIdList[0] || '' }
                    ),
                };
            case 'BUNDLE_GIFT':
                return {
                    ...base,
                    bundleQuantity: parseInt(bundleQty, 10),
                    giftVariantId: giftVariantIdList[0] || '',
                };
            case 'BUNDLE_PRICE_GIFT':
                return {
                    ...base,
                    bundleProductIds: bundleProductIds,
                    bundleQuantity: parseInt(bundleQty, 10),
                    bundlePrice: parseInt(bundlePrice, 10),
                    giftVariantId: giftVariantIdList[0] || '',
                };
            default:
                return base;
        }
    }, [subType, minQty, targetVariantList, discountType, discountValue, buyQty, getQty, bogoDiscountPct, additionalDiscountPct, giftVariantIdList, giftVariantIdsList, bundleQty, bundleProductIds, bundlePrice]);

    useImperativeHandle(ref, () => ({ getConfig: buildConfig }), [buildConfig]);

    return (
        <BlockStack gap="400">
            <Select
                label="Combo Sub-Type"
                options={COMBO_SUB_TYPES}
                value={subType}
                onChange={setSubType}
                helpText="Select the combo discount behavior"
            />
            <Divider />

            {/* ── BASIC ─────────────────────────────────── */}
            {subType === 'BASIC' && (
                <FormLayout>
                    <TextField type="number" label="Minimum Cart Quantity" value={minQty} onChange={setMinQty} autoComplete="off" />
                    <ProductPicker label="Target Variant to Discount" selectedIds={targetVariantList} onChange={setTargetVariantList} multiple={false} resourceType="variant" />

                    <FormLayout.Group>
                        <Select
                            label="Discount Type"
                            options={[
                                { label: 'Percentage Off (%)', value: 'PERCENTAGE' },
                                { label: 'Fixed Package Price (₹)', value: 'FIXED_AMOUNT' }
                            ]}
                            value={discountType}
                            onChange={setDiscountType}
                        />
                        <TextField
                            type="number"
                            label={discountType === 'PERCENTAGE' ? "Discount %" : "Total Package Price (₹)"}
                            value={discountValue}
                            onChange={setDiscountValue}
                            autoComplete="off"
                            helpText={discountType === 'FIXED_AMOUNT' ? "Forces the targeted items to exactly this total price (e.g., Buy 2 for ₹999)" : ""}
                        />
                    </FormLayout.Group>
                </FormLayout>
            )}

            {/* ── BOGO + DISCOUNT ────────────────────────── */}
            {subType === 'BOGO_DISCOUNT' && (
                <FormLayout>
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
                    <TextField type="number" label="BOGO Discount % (on 'Get' items)" value={bogoDiscountPct} onChange={setBogoDiscountPct} autoComplete="off" />
                    <TextField type="number" label="Additional % Off (on ALL items)" value={additionalDiscountPct} onChange={setAdditionalDiscountPct} autoComplete="off" helpText="Extra discount applied to the entire cart on top of BOGO" />
                </FormLayout>
            )}

            {/* ── BOGO + GIFT ───────────────────────────── */}
            {subType === 'BOGO_GIFT' && (
                <FormLayout>
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity (Free)" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
                    <ProductPicker
                        label="Specific Gift Product"
                        selectedIds={giftVariantIdList}
                        onChange={setGiftVariantIdList}
                        multiple={false}
                        resourceType="variant"
                        helpText="For a single specific gift. Leave empty if using Mystery Pool below."
                    />
                    <ProductPicker
                        label="Mystery Gift Pool (optional)"
                        selectedIds={giftVariantIdsList}
                        onChange={setGiftVariantIdsList}
                        resourceType="variant"
                        helpText="Add multiple products here for a mystery gift — whichever one is in the customer's cart gets 100% off. This overrides the Specific Gift above."
                    />
                </FormLayout>
            )}


            {/* ── BUNDLE + GIFT ─────────────────────────── */}
            {subType === 'BUNDLE_GIFT' && (
                <FormLayout>
                    <TextField type="number" label="Bundle Quantity (non-gift items)" value={bundleQty} onChange={setBundleQty} autoComplete="off" helpText="Buy this many items and the gift becomes free" />
                    <ProductPicker label="Gift Product" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" />
                </FormLayout>
            )}

            {/* ── BUNDLE + GIFT (Fixed Price Bundle) ──────── */}
            {subType === 'BUNDLE_PRICE_GIFT' && (
                <FormLayout>
                    <Text variant="headingSm" as="h3">Bundle Products</Text>
                    <ProductPicker
                        label="Bundle Products (optional)"
                        selectedIds={bundleProductIds}
                        onChange={setBundleProductIds}
                        helpText="Select the products that form the bundle. Leave empty to count all cart items."
                    />
                    <FormLayout.Group>
                        <TextField type="number" label="Bundle Quantity" value={bundleQty} onChange={setBundleQty} autoComplete="off" helpText="How many items the customer must buy" />
                        <TextField type="number" label="Bundle Price (₹)" value={bundlePrice} onChange={setBundlePrice} autoComplete="off" helpText="Fixed total price for the bundle (e.g., ₹1499)" />
                    </FormLayout.Group>
                    <Divider />
                    <Text variant="headingSm" as="h3">Free Gift</Text>
                    <ProductPicker
                        label="Gift Product"
                        selectedIds={giftVariantIdList}
                        onChange={setGiftVariantIdList}
                        multiple={false}
                        resourceType="variant"
                        helpText="This product will be added free when the bundle is purchased"
                    />
                    <Banner tone="info">
                        <p>Buy <strong>{bundleQty}</strong> products for <strong>₹{bundlePrice}</strong> + get a <strong>free gift</strong></p>
                    </Banner>
                </FormLayout>
            )}
        </BlockStack>
    );
});

ComboForm.displayName = 'ComboForm';
export default ComboForm;
