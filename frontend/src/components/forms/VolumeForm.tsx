import { FormLayout, TextField, Select, Button, BlockStack, Text, Divider, Card, InlineStack } from '@shopify/polaris';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import ProductPicker from '../ProductPicker';

const VOLUME_SUB_TYPES = [
    { label: 'Basic (Min Qty → % Off)', value: 'BASIC' },
    { label: 'Multi-Tier Percentage Discounts', value: 'MULTI_TIER' },
    { label: 'Fixed Price Bundle (Single Tier)', value: 'FIXED_BUNDLE' },
    { label: 'Multi-Tier Fixed Price (e.g. Buy 2 for ₹999, Buy 4 for ₹1,899)', value: 'MULTI_TIER_FIXED' },
    { label: 'Mix & Match Volume Pricing', value: 'MIX_MATCH' },
    { label: 'Cart-Wide Volume Pricing', value: 'CART_WIDE' },
];

interface VolumeTier {
    minQty: string;
    discountPercentage: string;
    eligibleVariantIds: string[];
}

interface FixedTier {
    bundleQuantity: string;
    fixedPrice: string;
    eligibleVariantIds: string[];
}

export interface VolumeFormHandle {
    getConfig: () => { configType: string;[key: string]: any };
}

const VolumeForm = forwardRef<VolumeFormHandle, { initialConfig?: any }>(({ initialConfig }, ref) => {
    const [subType, setSubType] = useState('BASIC');

    // Basic / CartWide
    const [minQty, setMinQty] = useState('3');
    const [discountPct, setDiscountPct] = useState('15');

    // FixedBundle
    const [bundleQty, setBundleQty] = useState('3');
    const [fixedPrice, setFixedPrice] = useState('99');

    // MultiTier
    const [tiers, setTiers] = useState<VolumeTier[]>([
        { minQty: '3', discountPercentage: '10', eligibleVariantIds: [] },
        { minQty: '5', discountPercentage: '20', eligibleVariantIds: [] },
        { minQty: '10', discountPercentage: '30', eligibleVariantIds: [] },
    ]);

    // MixMatch
    const [eligibleIdsList, setEligibleIdsList] = useState<string[]>([]);

    // MultiTierFixed
    const [fixedTiers, setFixedTiers] = useState<FixedTier[]>([
        { bundleQuantity: '2', fixedPrice: '999', eligibleVariantIds: [] },
        { bundleQuantity: '4', fixedPrice: '1899', eligibleVariantIds: [] },
    ]);

    // Pre-fill from initialConfig
    useEffect(() => {
        if (!initialConfig) return;
        setSubType(initialConfig.configType || 'BASIC');
        if (initialConfig.minimumQuantity) setMinQty(String(initialConfig.minimumQuantity));
        if (initialConfig.discountPercentage) setDiscountPct(String(initialConfig.discountPercentage));
        if (initialConfig.bundleQuantity) setBundleQty(String(initialConfig.bundleQuantity));
        if (initialConfig.fixedPrice) setFixedPrice(String(initialConfig.fixedPrice));
        if (initialConfig.eligibleProductIds) setEligibleIdsList(initialConfig.eligibleProductIds);
        if (initialConfig.tiers) {
            // Detect which tier format: percentage tiers vs fixed price tiers
            if (initialConfig.tiers[0]?.fixedPrice !== undefined) {
                setFixedTiers(initialConfig.tiers.map((t: any) => ({
                    bundleQuantity: String(t.bundleQuantity),
                    fixedPrice: String(t.fixedPrice),
                    eligibleVariantIds: t.eligibleVariantIds || [],
                })));
            } else {
                setTiers(initialConfig.tiers.map((t: any) => ({
                    minQty: String(t.minQty),
                    discountPercentage: String(t.discountPercentage),
                    eligibleVariantIds: t.eligibleVariantIds || [],
                })));
            }
        }
    }, [initialConfig]);

    const addTier = useCallback(() => {
        setTiers(prev => [...prev, { minQty: '', discountPercentage: '', eligibleVariantIds: [] }]);
    }, []);

    const removeTier = useCallback((index: number) => {
        setTiers(prev => prev.filter((_, i) => i !== index));
    }, []);

    const updateTier = useCallback((index: number, field: keyof VolumeTier, value: any) => {
        setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
    }, []);

    const addFixedTier = useCallback(() => {
        setFixedTiers(prev => [...prev, { bundleQuantity: '', fixedPrice: '', eligibleVariantIds: [] }]);
    }, []);

    const removeFixedTier = useCallback((index: number) => {
        setFixedTiers(prev => prev.filter((_, i) => i !== index));
    }, []);

    const updateFixedTier = useCallback((index: number, field: keyof FixedTier, value: any) => {
        setFixedTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
    }, []);

    const buildConfig = useCallback(() => {
        const base = { configType: subType };

        switch (subType) {
            case 'BASIC':
            case 'CART_WIDE':
                return {
                    ...base,
                    minimumQuantity: parseInt(minQty, 10),
                    discountPercentage: parseInt(discountPct, 10),
                };
            case 'MULTI_TIER':
                return {
                    ...base,
                    tiers: tiers.map(t => ({
                        minQty: parseInt(t.minQty, 10),
                        discountPercentage: parseInt(t.discountPercentage, 10),
                        eligibleVariantIds: t.eligibleVariantIds,
                    })),
                };
            case 'FIXED_BUNDLE':
                return {
                    ...base,
                    bundleQuantity: parseInt(bundleQty, 10),
                    fixedPrice: parseFloat(fixedPrice),
                };
            case 'MULTI_TIER_FIXED':
                return {
                    ...base,
                    tiers: fixedTiers.map(t => ({
                        bundleQuantity: parseInt(t.bundleQuantity, 10),
                        fixedPrice: parseFloat(t.fixedPrice),
                        eligibleVariantIds: t.eligibleVariantIds,
                    })),
                };
            case 'MIX_MATCH':
                return {
                    ...base,
                    eligibleProductIds: eligibleIdsList,
                    minimumQuantity: parseInt(minQty, 10),
                    discountPercentage: parseInt(discountPct, 10),
                };
            default:
                return base;
        }
    }, [subType, minQty, discountPct, bundleQty, fixedPrice, tiers, fixedTiers, eligibleIdsList]);

    useImperativeHandle(ref, () => ({ getConfig: buildConfig }), [buildConfig]);

    return (
        <BlockStack gap="400">
            <Select
                label="Volume Pricing Sub-Type"
                options={VOLUME_SUB_TYPES}
                value={subType}
                onChange={setSubType}
                helpText="Select the volume discount behavior"
            />
            <Divider />

            {/* ── BASIC / CART_WIDE ─────────────────────── */}
            {(subType === 'BASIC' || subType === 'CART_WIDE') && (
                <FormLayout>
                    <TextField type="number" label="Minimum Quantity" value={minQty} onChange={setMinQty} autoComplete="off" />
                    <TextField type="number" label="Discount %" value={discountPct} onChange={setDiscountPct} autoComplete="off" />
                </FormLayout>
            )}

            {/* ── MULTI-TIER ───────────────────────────── */}
            {subType === 'MULTI_TIER' && (
                <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Volume Tiers</Text>
                    <Text variant="bodySm" as="p" tone="subdued">Higher quantities unlock bigger discounts. Best matching tier applies.</Text>
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
                                        <TextField type="number" label="Min Qty" value={tier.minQty} onChange={(v) => updateTier(index, 'minQty', v)} autoComplete="off" />
                                        <TextField type="number" label="Discount %" value={tier.discountPercentage} onChange={(v) => updateTier(index, 'discountPercentage', v)} autoComplete="off" />
                                    </FormLayout.Group>
                                    <ProductPicker 
                                        label="Eligible Variants (Optional)" 
                                        selectedIds={tier.eligibleVariantIds} 
                                        onChange={(ids) => updateTier(index, 'eligibleVariantIds', ids)}
                                        resourceType="variant"
                                        helpText="If left empty, tier applies to all variants."
                                        multiple={true}
                                    />
                                </FormLayout>
                            </BlockStack>
                        </Card>
                    ))}
                    <Button onClick={addTier}>+ Add Tier</Button>
                </BlockStack>
            )}

            {/* ── FIXED BUNDLE ─────────────────────────── */}
            {subType === 'FIXED_BUNDLE' && (
                <FormLayout>
                    <TextField type="number" label="Bundle Quantity" value={bundleQty} onChange={setBundleQty} autoComplete="off" helpText="Number of items in the bundle" />
                    <TextField type="number" label="Fixed Bundle Price ($)" value={fixedPrice} onChange={setFixedPrice} autoComplete="off" helpText="Total price for the bundle (e.g. 3 for $99)" />
                </FormLayout>
            )}

            {/* ── MULTI-TIER FIXED ──────────────────────── */}
            {subType === 'MULTI_TIER_FIXED' && (
                <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Fixed Price Tiers</Text>
                    <Text variant="bodySm" as="p" tone="subdued">Define multiple bundle tiers — the best matching quantity applies at checkout (e.g. Buy 2 for ₹999, Buy 4 for ₹1,899).</Text>
                    {fixedTiers.map((tier, index) => (
                        <Card key={index}>
                            <BlockStack gap="200">
                                <InlineStack align="space-between">
                                    <Text variant="bodySm" fontWeight="semibold" as="span">Tier {index + 1}</Text>
                                    {fixedTiers.length > 1 && (
                                        <Button variant="plain" tone="critical" onClick={() => removeFixedTier(index)}>Remove</Button>
                                    )}
                                </InlineStack>
                                <FormLayout>
                                    <FormLayout.Group>
                                        <TextField type="number" label="Bundle Quantity" value={tier.bundleQuantity} onChange={(v) => updateFixedTier(index, 'bundleQuantity', v)} autoComplete="off" helpText="e.g. 2" />
                                        <TextField type="number" label="Fixed Price (₹)" value={tier.fixedPrice} onChange={(v) => updateFixedTier(index, 'fixedPrice', v)} autoComplete="off" helpText="e.g. 999" />
                                    </FormLayout.Group>
                                    <ProductPicker 
                                        label="Eligible Variants (Optional)" 
                                        selectedIds={tier.eligibleVariantIds} 
                                        onChange={(ids) => updateFixedTier(index, 'eligibleVariantIds', ids)}
                                        resourceType="variant"
                                        helpText="If left empty, tier applies to all variants."
                                        multiple={true}
                                    />
                                </FormLayout>
                            </BlockStack>
                        </Card>
                    ))}
                    <Button onClick={addFixedTier}>+ Add Tier</Button>
                </BlockStack>
            )}

            {/* ── MIX & MATCH ──────────────────────────── */}
            {subType === 'MIX_MATCH' && (
                <FormLayout>
                    <ProductPicker
                        label="Eligible Products"
                        selectedIds={eligibleIdsList}
                        onChange={setEligibleIdsList}
                        helpText="Volume discount only applies to items from these products"
                    />
                    <TextField type="number" label="Minimum Quantity" value={minQty} onChange={setMinQty} autoComplete="off" />
                    <TextField type="number" label="Discount %" value={discountPct} onChange={setDiscountPct} autoComplete="off" />
                </FormLayout>
            )}
        </BlockStack>
    );
});

VolumeForm.displayName = 'VolumeForm';
export default VolumeForm;
