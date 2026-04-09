import { FormLayout, TextField, Select, Button, BlockStack, Text, Divider, Card, InlineStack } from '@shopify/polaris';
import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import ProductPicker from '../ProductPicker';

const FREE_GIFT_SUB_TYPES = [
    { label: 'Basic (Min Spend → Free Gift)', value: 'BASIC' },
    { label: 'Gift on Specific Product Purchase', value: 'PRODUCT_PURCHASE' },
    { label: 'Gift on Subscription Purchase', value: 'SUBSCRIPTION' },
    { label: '🎁 Gift on First Subscription Order Only', value: 'SUBSCRIPTION_FIRST' },
    { label: 'Mystery Gift (Random from Pool)', value: 'MYSTERY' },
    { label: 'Order Value Gift Choice (Tiered)', value: 'ORDER_VALUE_CHOICE' },
    { label: '🎯 Gift Choice on Order Value (Customer Picks 1)', value: 'ORDER_VALUE_PICK_ONE' },
    { label: '🎁 Multi-Gift Pick (Customer Picks N of M)', value: 'ORDER_VALUE_MULTI_PICK' },
    { label: 'Multi-Choice (Pick X of Y Gifts)', value: 'MULTI_CHOICE' },
    { label: 'Time-Limited Free Gift', value: 'TIME_LIMITED' },
    { label: 'Auto-Add Gift (Cart Transform)', value: 'AUTO_ADD' },
];

interface GiftTier {
    minimumSpend: string;
    giftVariantId: string;
}

export interface FreeGiftFormHandle {
    getConfig: () => { configType: string;[key: string]: any };
}

const FreeGiftForm = forwardRef<FreeGiftFormHandle, { initialConfig?: any }>(({ initialConfig }, ref) => {
    const [subType, setSubType] = useState('BASIC');

    // Basic / TimeLimited / AutoAdd
    const [minSpend, setMinSpend] = useState('25');
    const [minQuantity, setMinQuantity] = useState('2');
    const [giftVariantIdList, setGiftVariantIdList] = useState<string[]>([]);

    // ProductPurchase
    const [triggerProductIdList, setTriggerProductIdList] = useState<string[]>([]);

    // Mystery / MultiChoice / PickOne / MultiPick
    const [giftVariantIdsList, setGiftVariantIdsList] = useState<string[]>([]);

    // OrderValueChoice tiers
    const [tiers, setTiers] = useState<GiftTier[]>([
        { minimumSpend: '20', giftVariantId: '' },
        { minimumSpend: '50', giftVariantId: '' },
    ]);

    // TimeLimited
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // MultiChoice / MultiPick
    const [maxGifts, setMaxGifts] = useState('2');

    // Pre-fill from initialConfig when editing
    useEffect(() => {
        if (!initialConfig) return;
        setSubType(initialConfig.configType || 'BASIC');
        if (initialConfig.minimumSpend) setMinSpend(String(initialConfig.minimumSpend));
        if (initialConfig.minQuantity) setMinQuantity(String(initialConfig.minQuantity));
        if (initialConfig.giftVariantId) setGiftVariantIdList([initialConfig.giftVariantId]);
        if (initialConfig.triggerProductId) setTriggerProductIdList([initialConfig.triggerProductId]);
        if (initialConfig.giftVariantIds) setGiftVariantIdsList(initialConfig.giftVariantIds);
        if (initialConfig.startDate) setStartDate(initialConfig.startDate);
        if (initialConfig.endDate) setEndDate(initialConfig.endDate);
        if (initialConfig.tiers) setTiers(initialConfig.tiers.map((t: any) => ({
            minimumSpend: String(t.minimumSpend),
            giftVariantId: t.giftVariantId || '',
        })));
        if (initialConfig.maxGifts) setMaxGifts(String(initialConfig.maxGifts));
    }, [initialConfig]);

    const addTier = useCallback(() => {
        setTiers(prev => [...prev, { minimumSpend: '', giftVariantId: '' }]);
    }, []);

    const removeTier = useCallback((index: number) => {
        setTiers(prev => prev.filter((_, i) => i !== index));
    }, []);

    const updateTier = useCallback((index: number, field: keyof GiftTier, value: string) => {
        setTiers(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
    }, []);

    const buildConfig = useCallback(() => {
        const base = { configType: subType };

        switch (subType) {
            case 'BASIC':
                return { ...base, minimumSpend: parseFloat(minSpend), giftVariantId: giftVariantIdList[0] || '' };
            case 'PRODUCT_PURCHASE':
                return { ...base, triggerProductId: triggerProductIdList[0] || '', giftVariantId: giftVariantIdList[0] || '' };
            case 'MYSTERY':
                return {
                    ...base,
                    minQuantity: parseInt(minQuantity, 10),
                    giftVariantIds: giftVariantIdsList,
                };
            case 'ORDER_VALUE_CHOICE':
                return {
                    ...base,
                    tiers: tiers.map(t => ({
                        minimumSpend: parseFloat(t.minimumSpend),
                        giftVariantId: t.giftVariantId.trim(),
                    })),
                };
            case 'TIME_LIMITED':
                return {
                    ...base,
                    minimumSpend: parseFloat(minSpend),
                    giftVariantId: giftVariantIdList[0] || '',
                    startDate,
                    endDate,
                };
            case 'AUTO_ADD':
                return { ...base, minimumSpend: parseFloat(minSpend), giftVariantId: giftVariantIdList[0] || '' };
            case 'SUBSCRIPTION':
                return { ...base, giftVariantId: giftVariantIdList[0] || '' };
            case 'SUBSCRIPTION_FIRST':
                return { ...base, giftVariantId: giftVariantIdList[0] || '' };
            case 'MULTI_CHOICE':
                return {
                    ...base,
                    minimumSpend: parseFloat(minSpend),
                    giftVariantIds: giftVariantIdsList,
                    maxGifts: parseInt(maxGifts, 10),
                };
            case 'ORDER_VALUE_PICK_ONE':
                return {
                    ...base,
                    minimumSpend: parseFloat(minSpend),
                    giftVariantIds: giftVariantIdsList,
                };
            case 'ORDER_VALUE_MULTI_PICK':
                return {
                    ...base,
                    minimumSpend: parseFloat(minSpend),
                    giftVariantIds: giftVariantIdsList,
                    maxGifts: parseInt(maxGifts, 10),
                };
            default:
                return base;
        }
    }, [subType, minSpend, minQuantity, giftVariantIdList, triggerProductIdList, giftVariantIdsList, tiers, startDate, endDate, maxGifts]);

    useImperativeHandle(ref, () => ({ getConfig: buildConfig }), [buildConfig]);

    return (
        <BlockStack gap="400">
            <Select
                label="Free Gift Sub-Type"
                options={FREE_GIFT_SUB_TYPES}
                value={subType}
                onChange={setSubType}
                helpText="Select the gift trigger behavior"
            />
            <Divider />

            {/* ── BASIC ─────────────────────────────────── */}
            {subType === 'BASIC' && (
                <FormLayout>
                    <TextField type="number" label="Cart Minimum Spend" value={minSpend} onChange={setMinSpend} autoComplete="off" />
                    <ProductPicker label="Gift Product" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" helpText="The free gift item" />
                </FormLayout>
            )}

            {/* ── PRODUCT PURCHASE ──────────────────────── */}
            {subType === 'PRODUCT_PURCHASE' && (
                <FormLayout>
                    <ProductPicker label="Trigger Product" selectedIds={triggerProductIdList} onChange={setTriggerProductIdList} multiple={false} helpText="Gift unlocks when this product is in cart" />
                    <ProductPicker label="Gift Product" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" helpText="The free gift item" />
                </FormLayout>
            )}

            {/* ── MYSTERY ───────────────────────────────── */}
            {subType === 'MYSTERY' && (
                <FormLayout>
                    <TextField type="number" label="Minimum Items in Cart" value={minQuantity} onChange={setMinQuantity} autoComplete="off" helpText="e.g., set to 2 so that when the customer adds 2 products, a mystery gift is triggered" />
                    <ProductPicker label="Mystery Gift Pool" selectedIds={giftVariantIdsList} onChange={setGiftVariantIdsList} resourceType="variant" helpText="A random gift from this pool will be auto-added to the cart" />
                </FormLayout>
            )}

            {/* ── ORDER VALUE CHOICE ────────────────────── */}
            {subType === 'ORDER_VALUE_CHOICE' && (
                <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Gift Tiers</Text>
                    <Text variant="bodySm" as="p" tone="subdued">Define spending thresholds — higher spend unlocks better gifts.</Text>
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
                                        <TextField type="number" label="Min Spend" value={tier.minimumSpend} onChange={(v) => updateTier(index, 'minimumSpend', v)} autoComplete="off" />
                                        <TextField label="Gift Variant ID" value={tier.giftVariantId} onChange={(v) => updateTier(index, 'giftVariantId', v)} autoComplete="off" />
                                    </FormLayout.Group>
                                </FormLayout>
                            </BlockStack>
                        </Card>
                    ))}
                    <Button onClick={addTier}>+ Add Tier</Button>
                </BlockStack>
            )}

            {/* ── TIME LIMITED ──────────────────────────── */}
            {subType === 'TIME_LIMITED' && (
                <FormLayout>
                    <TextField type="number" label="Cart Minimum Spend" value={minSpend} onChange={setMinSpend} autoComplete="off" />
                    <ProductPicker label="Gift Product" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" />
                    <FormLayout.Group>
                        <TextField type="date" label="Start Date" value={startDate} onChange={setStartDate} autoComplete="off" />
                        <TextField type="date" label="End Date" value={endDate} onChange={setEndDate} autoComplete="off" />
                    </FormLayout.Group>
                </FormLayout>
            )}

            {/* ── AUTO ADD ─────────────────────────────── */}
            {subType === 'AUTO_ADD' && (
                <FormLayout>
                    <TextField type="number" label="Cart Minimum Spend" value={minSpend} onChange={setMinSpend} autoComplete="off" />
                    <ProductPicker label="Gift Product (auto-added)" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" helpText="Requires a Cart Transform extension to auto-add this item" />
                </FormLayout>
            )}

            {/* ── SUBSCRIPTION ──────────────────────────── */}
            {subType === 'SUBSCRIPTION' && (
                <FormLayout>
                    <ProductPicker label="Gift Product" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" helpText="This gift becomes free when ANY subscription item is in the cart" />
                </FormLayout>
            )}

            {/* ── SUBSCRIPTION FIRST ────────────────────── */}
            {subType === 'SUBSCRIPTION_FIRST' && (
                <FormLayout>
                    <Text variant="bodySm" as="p" tone="subdued">
                        This gift is applied <strong>only on the customer's very first subscription order</strong>. Renewal orders will not receive the gift.
                    </Text>
                    <ProductPicker label="Gift Product" selectedIds={giftVariantIdList} onChange={setGiftVariantIdList} multiple={false} resourceType="variant" helpText="The free welcome gift — given once per customer on their first subscription purchase" />
                </FormLayout>
            )}

            {/* ── MULTI CHOICE ──────────────────────────── */}
            {subType === 'MULTI_CHOICE' && (
                <FormLayout>
                    <TextField type="number" label="Cart Minimum Spend" value={minSpend} onChange={setMinSpend} autoComplete="off" />
                    <ProductPicker label="Gift Pool (all options)" selectedIds={giftVariantIdsList} onChange={setGiftVariantIdsList} resourceType="variant" helpText="Customer can pick from these gifts" />
                    <TextField type="number" label="Max Gifts Customer Can Pick" value={maxGifts} onChange={setMaxGifts} autoComplete="off" helpText="e.g., 2 means 'pick any 2 out of the pool'" />
                </FormLayout>
            )}

            {/* ── ORDER VALUE PICK ONE ──────────────────── */}
            {subType === 'ORDER_VALUE_PICK_ONE' && (
                <FormLayout>
                    <Text variant="bodySm" as="p" tone="subdued">
                        When the customer's cart reaches the minimum spend, a <strong>Gift Picker widget</strong> appears
                        on the storefront letting them choose exactly <strong>1 free gift</strong> from the options below.
                        Add the <strong>"Gift Picker Widget"</strong> App Embed block in your Theme Customizer and
                        configure the same gift products there for the display UI.
                    </Text>
                    <TextField
                        type="number"
                        label="Minimum Cart Spend"
                        value={minSpend}
                        onChange={setMinSpend}
                        autoComplete="off"
                        helpText="Gift picker appears when cart total meets this amount"
                    />
                    <ProductPicker
                        label="Gift Options (customer picks 1)"
                        selectedIds={giftVariantIdsList}
                        onChange={setGiftVariantIdsList}
                        resourceType="variant"
                        helpText="Add 2-4 gift variants. The Shopify Function will discount whichever one the customer adds to cart."
                    />
                </FormLayout>
            )}

            {/* ── ORDER VALUE MULTI PICK ────────────────── */}
            {subType === 'ORDER_VALUE_MULTI_PICK' && (
                <FormLayout>
                    <Text variant="bodySm" as="p" tone="subdued">
                        Customer reaches spend threshold → a <strong>Multi-Gift Picker widget</strong> lets them
                        select <strong>up to N gifts</strong> from a pool of options you define.
                        Add the <strong>"Multi-Gift Picker Widget"</strong> App Embed block in your Theme Customizer
                        and configure the same gift products there.
                    </Text>
                    <TextField
                        type="number"
                        label="Minimum Cart Spend"
                        value={minSpend}
                        onChange={setMinSpend}
                        autoComplete="off"
                        helpText="Widget appears when cart total meets this amount"
                    />
                    <ProductPicker
                        label="Gift Pool (all options)"
                        selectedIds={giftVariantIdsList}
                        onChange={setGiftVariantIdsList}
                        resourceType="variant"
                        helpText="Add 3-6 gift variants the customer can choose from"
                    />
                    <TextField
                        type="number"
                        label="Max Gifts Customer Can Pick"
                        value={maxGifts}
                        onChange={setMaxGifts}
                        autoComplete="off"
                        helpText="e.g., 2 means 'pick any 2 out of the pool'. Must be less than total gift options."
                    />
                </FormLayout>
            )}
        </BlockStack>
    );
});

FreeGiftForm.displayName = 'FreeGiftForm';
export default FreeGiftForm;
