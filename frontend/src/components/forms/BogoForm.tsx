import { FormLayout, TextField, Select, Button, InlineStack, BlockStack, Text, Divider, Card, Banner } from '@shopify/polaris';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import ProductPicker from '../ProductPicker';

const BOGO_SUB_TYPES = [
    { label: 'Basic (Buy X Get Y)', value: 'BASIC' },
    { label: 'Cheapest Item Free', value: 'CHEAPEST_FREE' },
    { label: 'Buy X, Get Different Product Y', value: 'DIFFERENT_PRODUCT' },
    { label: 'Multi-Tier BOGO', value: 'MULTI_TIER' },
    { label: 'Mix & Match (Same Collection/Group)', value: 'MIX_MATCH' },
    { label: 'Mix & Match (Buy from Collection A, Get Collection B)', value: 'MIX_MATCH_BOGO' },
    { label: 'Quantity-Limited BOGO', value: 'QUANTITY_LIMITED' },
    { label: 'Variant / Product Scoped BOGO', value: 'VARIANT_SCOPED' },
    { label: 'BOGO on Specific Variants / Collections', value: 'COLLECTION_VARIANT_SCOPED' },
];

interface Tier {
    buyQuantity: string;
    getQuantity: string;
    discountPercentage: string;
}

export interface BogoFormHandle {
    getConfig: () => { configType: string;[key: string]: any };
}

const BogoForm = forwardRef<BogoFormHandle, { initialConfig?: any }>(({ initialConfig }, ref) => {
    const [subType, setSubType] = useState('BASIC');

    // Basic / QuantityLimited / VariantScoped fields
    const [buyQty, setBuyQty] = useState('2');
    const [getQty, setGetQty] = useState('1');
    const [discountType, setDiscountType] = useState('PERCENTAGE');
    const [discountValue, setDiscountValue] = useState('100');
    const [maxApplications, setMaxApplications] = useState('1');

    // CheapestFree
    const [minQty, setMinQty] = useState('3');

    // DifferentProduct (now using arrays for ProductPicker)
    const [buyVariantIdsList, setBuyVariantIdsList] = useState<string[]>([]);
    const [getVariantIdList, setGetVariantIdList] = useState<string[]>([]);

    // MultiTier
    const [tiers, setTiers] = useState<Tier[]>([
        { buyQuantity: '2', getQuantity: '1', discountPercentage: '50' },
        { buyQuantity: '4', getQuantity: '2', discountPercentage: '100' },
    ]);

    // MixMatch / VariantScoped (now using arrays)
    const [eligibleIdsList, setEligibleIdsList] = useState<string[]>([]);

    // Basic product scope (optional — for "Same Product" BOGO)
    const [basicProductIds, setBasicProductIds] = useState<string[]>([]);

    // MixMatchBogo: separate "buy" (Collection A) and "get" (Collection B) product lists
    const [mixMatchBuyProductIds, setMixMatchBuyProductIds] = useState<string[]>([]);
    const [mixMatchGetProductIds, setMixMatchGetProductIds] = useState<string[]>([]);

    // CollectionVariantScoped: products (categories) + variants (sizes/colors)
    const [scopedProductIds, setScopedProductIds] = useState<string[]>([]);
    const [scopedVariantIds, setScopedVariantIds] = useState<string[]>([]);

    // Pre-fill from initialConfig when editing
    useEffect(() => {
        if (!initialConfig) return;
        setSubType(initialConfig.configType || 'BASIC');
        if (initialConfig.buyQuantity) setBuyQty(String(initialConfig.buyQuantity));
        if (initialConfig.getQuantity) setGetQty(String(initialConfig.getQuantity));
        if (initialConfig.discountType) setDiscountType(initialConfig.discountType);
        if (initialConfig.discountValue !== undefined) {
            setDiscountValue(String(initialConfig.discountValue));
        } else if (initialConfig.discountPercentage !== undefined) {
            setDiscountValue(String(initialConfig.discountPercentage));
        }
        if (initialConfig.maxApplications) setMaxApplications(String(initialConfig.maxApplications));
        if (initialConfig.minimumQuantity) setMinQty(String(initialConfig.minimumQuantity));
        if (initialConfig.buyVariantIds) setBuyVariantIdsList(initialConfig.buyVariantIds);
        if (initialConfig.getVariantId) setGetVariantIdList([initialConfig.getVariantId]);
        if (initialConfig.eligibleProductIds) setEligibleIdsList(initialConfig.eligibleProductIds);
        if (initialConfig.eligibleVariantIds) setEligibleIdsList(initialConfig.eligibleVariantIds);
        // Restore basic product scope
        if (initialConfig.configType === 'BASIC' && initialConfig.eligibleProductIds) {
            setBasicProductIds(initialConfig.eligibleProductIds);
        }
        // MIX_MATCH_BOGO: restore buy/get product lists
        if (initialConfig.configType === 'MIX_MATCH_BOGO') {
            if (initialConfig.buyProductIds) setMixMatchBuyProductIds(initialConfig.buyProductIds);
            if (initialConfig.getProductIds) setMixMatchGetProductIds(initialConfig.getProductIds);
        }
        // COLLECTION_VARIANT_SCOPED: restore scoped products + variants
        if (initialConfig.configType === 'COLLECTION_VARIANT_SCOPED') {
            if (initialConfig.scopedProductIds) setScopedProductIds(initialConfig.scopedProductIds);
            if (initialConfig.scopedVariantIds) setScopedVariantIds(initialConfig.scopedVariantIds);
        }
        if (initialConfig.tiers) setTiers(initialConfig.tiers.map((t: any) => ({
            buyQuantity: String(t.buyQuantity),
            getQuantity: String(t.getQuantity),
            discountPercentage: String(t.discountPercentage),
        })));
    }, [initialConfig]);

    const addTier = useCallback(() => {
        setTiers(prev => [...prev, { buyQuantity: '', getQuantity: '', discountPercentage: '' }]);
    }, []);

    const removeTier = useCallback((index: number) => {
        setTiers(prev => prev.filter((_, i) => i !== index));
    }, []);

    const updateTier = useCallback((index: number, field: keyof Tier, value: string) => {
        setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
    }, []);

    // Build config JSON whenever the form needs to submit
    const buildConfig = useCallback(() => {
        const base = { configType: subType };

        switch (subType) {
            case 'BASIC':
                return {
                    ...base,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                    // Only include when merchant selected specific products
                    ...(basicProductIds.length > 0 ? { eligibleProductIds: basicProductIds } : {}),
                };
            case 'CHEAPEST_FREE':
                return {
                    ...base,
                    minimumQuantity: parseInt(minQty, 10),
                };
            case 'DIFFERENT_PRODUCT':
                return {
                    ...base,
                    buyVariantIds: buyVariantIdsList,
                    getVariantId: getVariantIdList[0] || '',
                    getVariantIds: getVariantIdList,
                    buyQuantity: parseInt(buyQty, 10),
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                };
            case 'MULTI_TIER':
                return {
                    ...base,
                    tiers: tiers.map(t => ({
                        buyQuantity: parseInt(t.buyQuantity, 10),
                        getQuantity: parseInt(t.getQuantity, 10),
                        discountPercentage: parseInt(t.discountPercentage, 10),
                    })),
                };
            case 'MIX_MATCH':
                return {
                    ...base,
                    eligibleProductIds: eligibleIdsList,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                };
            case 'MIX_MATCH_BOGO':
                return {
                    ...base,
                    buyProductIds: mixMatchBuyProductIds,
                    getProductIds: mixMatchGetProductIds,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    discountType: 'PERCENTAGE',
                    discountValue: 100,
                    discountPercentage: 100,
                };
            case 'QUANTITY_LIMITED':
                return {
                    ...base,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                    maxApplications: parseInt(maxApplications, 10),
                };
            case 'VARIANT_SCOPED':
                return {
                    ...base,
                    eligibleVariantIds: eligibleIdsList,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                };
            case 'COLLECTION_VARIANT_SCOPED':
                return {
                    ...base,
                    scopedProductIds: scopedProductIds,
                    scopedVariantIds: scopedVariantIds,
                    buyQuantity: parseInt(buyQty, 10),
                    getQuantity: parseInt(getQty, 10),
                    discountType: discountType,
                    discountValue: parseInt(discountValue, 10),
                    discountPercentage: discountType === 'PERCENTAGE' ? parseInt(discountValue, 10) : 0,
                };
            default:
                return base;
        }
    }, [subType, buyQty, getQty, discountType, discountValue, maxApplications, minQty, buyVariantIdsList, getVariantIdList, tiers, eligibleIdsList, basicProductIds, mixMatchBuyProductIds, mixMatchGetProductIds, scopedProductIds, scopedVariantIds]);

    useImperativeHandle(ref, () => ({
        getConfig: buildConfig,
    }), [buildConfig]);

    const handleSubTypeChange = useCallback((value: string) => {
        setSubType(value);
    }, []);

    return (
        <BlockStack gap="400">
            <Select
                label="BOGO Sub-Type"
                options={BOGO_SUB_TYPES}
                value={subType}
                onChange={handleSubTypeChange}
                helpText="Select the specific BOGO behavior"
            />

            <Divider />

            {/* ── BASIC ─────────────────────────────────────── */}
            {subType === 'BASIC' && (
                <FormLayout>
                    <ProductPicker
                        label="Restrict to Specific Products (optional)"
                        selectedIds={basicProductIds}
                        onChange={setBasicProductIds}
                        helpText="Leave empty to apply to all products in the cart. Select specific products to enable 'Same Product' BOGO — the deal will trigger independently per product."
                    />
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity (Free)" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
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
                        />
                    </FormLayout.Group>
                </FormLayout>
            )}

            {/* ── CHEAPEST FREE ────────────────────────────── */}
            {subType === 'CHEAPEST_FREE' && (
                <FormLayout>
                    <TextField type="number" label="Minimum Items in Cart" value={minQty} onChange={setMinQty} autoComplete="off" helpText="Customer must have at least this many items; the cheapest one becomes free" />
                </FormLayout>
            )}

            {/* ── DIFFERENT PRODUCT ────────────────────────── */}
            {subType === 'DIFFERENT_PRODUCT' && (
                <FormLayout>
                    <ProductPicker
                        label="Buy Products (customer must buy these)"
                        selectedIds={buyVariantIdsList}
                        onChange={setBuyVariantIdsList}
                        resourceType="variant"
                        helpText="Select the products the customer needs to buy"
                    />
                    <TextField type="number" label="Required Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                    <ProductPicker
                        label="Get Product (the discounted items)"
                        selectedIds={getVariantIdList}
                        onChange={setGetVariantIdList}
                        multiple={true}
                        resourceType="variant"
                        helpText="Select the product(s) the customer gets discounted"
                    />
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
                            label={discountType === 'PERCENTAGE' ? "Discount % on 'Get' Item" : "Total Package Price (₹)"}
                            value={discountValue}
                            onChange={setDiscountValue}
                            autoComplete="off"
                        />
                    </FormLayout.Group>
                </FormLayout>
            )}

            {/* ── MULTI-TIER ───────────────────────────────── */}
            {subType === 'MULTI_TIER' && (
                <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Discount Tiers</Text>
                    <Text variant="bodySm" as="p" tone="subdued">Define multiple tiers — the best matching tier applies at checkout.</Text>
                    {tiers.map((tier, index) => (
                        <Card key={index}>
                            <BlockStack gap="200">
                                <InlineStack align="space-between">
                                    <Text variant="bodySm" fontWeight="semibold" as="span">Tier {index + 1}</Text>
                                    {tiers.length > 1 && (
                                        <Button variant="plain" tone="critical" onClick={() => removeTier(index)}>Remove</Button>
                                    )}
                                </InlineStack>
                                <FormLayout>
                                    <FormLayout.Group>
                                        <TextField type="number" label="Buy Qty" value={tier.buyQuantity} onChange={(v) => updateTier(index, 'buyQuantity', v)} autoComplete="off" />
                                        <TextField type="number" label="Get Qty" value={tier.getQuantity} onChange={(v) => updateTier(index, 'getQuantity', v)} autoComplete="off" />
                                        <TextField type="number" label="Discount %" value={tier.discountPercentage} onChange={(v) => updateTier(index, 'discountPercentage', v)} autoComplete="off" />
                                    </FormLayout.Group>
                                </FormLayout>
                            </BlockStack>
                        </Card>
                    ))}
                    <Button onClick={addTier}>+ Add Tier</Button>
                </BlockStack>
            )}

            {/* ── MIX & MATCH ──────────────────────────────── */}
            {subType === 'MIX_MATCH' && (
                <FormLayout>
                    <ProductPicker
                        label="Eligible Products"
                        selectedIds={eligibleIdsList}
                        onChange={setEligibleIdsList}
                        helpText="Products from any of these count toward the BOGO threshold"
                    />
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
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
                        />
                    </FormLayout.Group>
                </FormLayout>
            )}

            {/* ── MIX & MATCH BOGO (Cross-Collection) ───────── */}
            {subType === 'MIX_MATCH_BOGO' && (
                <FormLayout>
                    <ProductPicker
                        label="Collection A — Buy Products"
                        selectedIds={mixMatchBuyProductIds}
                        onChange={setMixMatchBuyProductIds}
                        helpText="Customer must buy from these products (Collection A)"
                    />
                    <TextField type="number" label="Buy Quantity (from Collection A)" value={buyQty} onChange={setBuyQty} autoComplete="off" helpText="How many items the customer must buy from Collection A" />
                    <Divider />
                    <ProductPicker
                        label="Collection B — Free Products"
                        selectedIds={mixMatchGetProductIds}
                        onChange={setMixMatchGetProductIds}
                        helpText="Customer gets free item(s) from these products (Collection B)"
                    />
                    <TextField type="number" label="Get Quantity (Free from Collection B)" value={getQty} onChange={setGetQty} autoComplete="off" helpText="How many items the customer gets free from Collection B" />
                    <Banner tone="info">
                        <p>Buy any <strong>{buyQty}</strong> from Collection A → Get <strong>{getQty}</strong> free from Collection B</p>
                    </Banner>
                </FormLayout>
            )}

            {/* ── QUANTITY LIMITED ─────────────────────────── */}
            {subType === 'QUANTITY_LIMITED' && (
                <FormLayout>
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
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
                        />
                    </FormLayout.Group>
                    <TextField type="number" label="Max Applications per Cart" value={maxApplications} onChange={setMaxApplications} autoComplete="off" helpText="Limit how many times this BOGO can trigger in a single cart" />
                </FormLayout>
            )}

            {/* ── VARIANT SCOPED ──────────────────────────── */}
            {subType === 'VARIANT_SCOPED' && (
                <FormLayout>
                    <ProductPicker
                        label="Eligible Variants"
                        selectedIds={eligibleIdsList}
                        onChange={setEligibleIdsList}
                        resourceType="variant"
                        helpText="BOGO only applies to these specific product variants"
                    />
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
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
                        />
                    </FormLayout.Group>
                </FormLayout>
            )}

            {/* ── COLLECTION / VARIANT SCOPED BOGO ─────────── */}
            {subType === 'COLLECTION_VARIANT_SCOPED' && (
                <FormLayout>
                    <Text variant="headingSm" as="h3">Scope by Products (Categories / Collections)</Text>
                    <ProductPicker
                        label="Eligible Products (optional)"
                        selectedIds={scopedProductIds}
                        onChange={setScopedProductIds}
                        helpText="Select products from specific categories. All variants of these products will be eligible."
                    />
                    <Divider />
                    <Text variant="headingSm" as="h3">Scope by Specific Variants (Sizes / Colors)</Text>
                    <ProductPicker
                        label="Eligible Variants (optional)"
                        selectedIds={scopedVariantIds}
                        onChange={setScopedVariantIds}
                        resourceType="variant"
                        helpText="Select specific variants (e.g. Large, Red, Pack of 6). Only these variants will be eligible."
                    />
                    <Divider />
                    <FormLayout.Group>
                        <TextField type="number" label="Buy Quantity" value={buyQty} onChange={setBuyQty} autoComplete="off" />
                        <TextField type="number" label="Get Quantity (Free)" value={getQty} onChange={setGetQty} autoComplete="off" />
                    </FormLayout.Group>
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
                        />
                    </FormLayout.Group>
                    <Banner tone="info">
                        <p>BOGO applies <strong>only</strong> to the selected products and/or variants. At least one scope must be selected.</p>
                    </Banner>
                </FormLayout>
            )}
        </BlockStack>
    );
});

BogoForm.displayName = 'BogoForm';
export default BogoForm;
export { BOGO_SUB_TYPES };
