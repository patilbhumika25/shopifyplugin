import { Page, Layout, Card, ResourceList, ResourceItem, Text, Badge, EmptyState, BlockStack, InlineStack } from '@shopify/polaris';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const TYPE_LABELS: Record<string, string> = {
    BOGO: '🔖 BOGO',
    FREE_GIFT: '🎁 Free Gift',
    VOLUME: '📊 Volume',
    COMBO: '🧩 Combo',
};

const CONFIG_TYPE_LABELS: Record<string, string> = {
    BASIC: 'Basic',
    CHEAPEST_FREE: 'Cheapest Free',
    DIFFERENT_PRODUCT: 'Different Product',
    MULTI_TIER: 'Multi-Tier',
    MIX_MATCH: 'Mix & Match',
    QUANTITY_LIMITED: 'Quantity Limited',
    VARIANT_SCOPED: 'Variant Scoped',
    PRODUCT_PURCHASE: 'Product Purchase',
    MYSTERY: 'Mystery Gift',
    ORDER_VALUE_CHOICE: 'Tiered Gift',
    TIME_LIMITED: 'Time Limited',
    AUTO_ADD: 'Auto-Add',
    FIXED_BUNDLE: 'Fixed Bundle',
    CART_WIDE: 'Cart-Wide',
    BOGO_DISCOUNT: 'BOGO + Discount',
    BOGO_GIFT: 'BOGO + Gift',
    BUNDLE_GIFT: 'Bundle + Gift',
    SUBSCRIPTION: 'Subscription Gift',
    SUBSCRIPTION_FIRST: '🎁 First-Order Sub Gift',
    ORDER_VALUE_PICK_ONE: '🎯 Gift Choice',
    ORDER_VALUE_MULTI_PICK: '🎁 Multi-Gift Pick',
};

export default function Dashboard() {
    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchOffers = useCallback(async () => {
        try {
            setLoading(true);
            const shop = new URLSearchParams(window.location.search).get('shop') || '';
            const response = await fetch(`/api/offers?shop=${shop}`);
            if (response.ok) {
                const data = await response.json();
                setOffers(data);
            } else if (response.status === 401) {
                const data = await response.json().catch(() => ({}));
                let authShop = new URLSearchParams(window.location.search).get('shop');
                if (!authShop && (window as any).shopify?.config) {
                    authShop = (window as any).shopify.config.shop;
                }
                if (!authShop) authShop = data.shop;

                if (authShop) {
                    window.open(`/api/auth?shop=${authShop}`, '_top');
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOffers();
    }, [fetchOffers]);

    const handleDelete = useCallback(async (id: string) => {
        if (!confirm('Delete this offer? The Shopify discount will also be removed.')) return;
        try {
            const resp = await fetch(`/api/offers/${id}`, { method: 'DELETE' });
            if (resp.ok) {
                fetchOffers();
            }
        } catch (err) {
            console.error(err);
        }
    }, [fetchOffers]);

    const handleStatusToggle = useCallback(async (id: string, currentStatus: string) => {
        const newStatus = currentStatus === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';
        try {
            const resp = await fetch(`/api/offers/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (resp.ok) {
                fetchOffers();
            }
        } catch (err) {
            console.error(err);
        }
    }, [fetchOffers]);

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
        } catch { return dateStr; }
    };

    return (
        <Page
            title="Offer Manager"
            subtitle="Create and manage discount offers for your store"
            primaryAction={{ content: '+ Create Offer', onAction: () => navigate('/offers/new') }}
            secondaryActions={[{ content: '📜 View History', onAction: () => navigate('/history') }]}
        >
            <Layout>
                <Layout.Section>
                    {offers.length === 0 && !loading ? (
                        <Card>
                            <EmptyState
                                heading="Create your first discount offer"
                                action={{ content: 'Create Offer', onAction: () => navigate('/offers/new') }}
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Set up BOGO deals, free gifts, volume pricing, and combo offers that automatically apply at checkout.</p>
                            </EmptyState>
                        </Card>
                    ) : (
                        <Card>
                            <ResourceList
                                resourceName={{ singular: 'offer', plural: 'offers' }}
                                items={offers}
                                loading={loading}
                                idForItem={(item: any) => item.id}
                                renderItem={(item: any) => {
                                    const { id, title, type, configType, status, createdAt, shopifyDiscountId } = item;
                                    const typeLabel = TYPE_LABELS[type] || type;
                                    const subLabel = CONFIG_TYPE_LABELS[configType] || configType || '';
                                    return (
                                        <ResourceItem
                                            id={id}
                                            onClick={() => navigate(`/offers/${id}/edit`)}
                                            shortcutActions={[
                                                {
                                                    content: status === 'ACTIVE' ? '⏸ Deactivate' : '▶ Activate',
                                                    onAction: () => handleStatusToggle(id, status),
                                                },
                                                { content: 'Edit', onAction: () => navigate(`/offers/${id}/edit`) },
                                                { content: 'Delete', onAction: () => handleDelete(id) },
                                            ]}
                                        >
                                            <InlineStack align="space-between" blockAlign="center">
                                                <BlockStack gap="100">
                                                    <Text variant="bodyMd" fontWeight="bold" as="h3">{title}</Text>
                                                    <InlineStack gap="200" wrap>
                                                        <Badge>{typeLabel}</Badge>
                                                        {subLabel && subLabel !== 'Basic' && <Badge tone="info">{subLabel}</Badge>}
                                                        <Badge tone={status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'attention' : 'new'}>
                                                            {status === 'ACTIVE' ? '🟢 Active' : status === 'DRAFT' ? '📝 Draft' : status}
                                                        </Badge>
                                                        {shopifyDiscountId && <Badge tone="success">Synced to Shopify</Badge>}
                                                    </InlineStack>
                                                </BlockStack>
                                                <Text variant="bodySm" as="span" tone="subdued">
                                                    {createdAt ? formatDate(createdAt) : ''}
                                                </Text>
                                            </InlineStack>
                                        </ResourceItem>
                                    );
                                }}
                            />
                        </Card>
                    )}
                </Layout.Section>

                {/* Quick Tips Sidebar */}
                <Layout.Section variant="oneThird">
                    <Card>
                        <BlockStack gap="200">
                            <Text variant="headingSm" as="h3">📋 Quick Guide</Text>
                            <Text variant="bodySm" as="p">
                                <strong>BOGO:</strong> Buy X, Get Y free or discounted
                            </Text>
                            <Text variant="bodySm" as="p">
                                <strong>Free Gift:</strong> Free item when spending over a threshold
                            </Text>
                            <Text variant="bodySm" as="p">
                                <strong>Volume:</strong> Tiered discounts for bulk purchases
                            </Text>
                            <Text variant="bodySm" as="p">
                                <strong>Combo:</strong> Combine multiple discount types
                            </Text>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
