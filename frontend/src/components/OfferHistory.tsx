import { Page, Layout, Card, Text, Badge, BlockStack, InlineStack, Spinner, Thumbnail, SkeletonThumbnail } from '@shopify/polaris';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const TYPE_LABELS: Record<string, string> = {
    BOGO: '🔖 BOGO',
    FREE_GIFT: '🎁 Free Gift',
    VOLUME: '📊 Volume',
    COMBO: '🧩 Combo',
};

const ACTION_LABELS: Record<string, { label: string; tone: 'success' | 'info' | 'attention' | 'critical' | 'new' }> = {
    CREATED: { label: '✨ Created', tone: 'success' },
    UPDATED: { label: '✏️ Updated', tone: 'info' },
    DELETED: { label: '🗑️ Deleted', tone: 'critical' },
    SYNCED: { label: '🔗 Synced to Shopify', tone: 'success' },
    STATUS_CHANGED: { label: '🔄 Status Changed', tone: 'attention' },
    ERROR: { label: '⚠️ Error', tone: 'critical' },
};

interface Stats {
    total: number;
    active: number;
    synced: number;
    byType: Record<string, number>;
}

interface Activity {
    id: string;
    action: string;
    details: string | null;
    createdAt: string;
    offer: {
        id: string;
        title: string;
        type: string;
        configType: string;
        status: string;
    };
}

interface ProductInfo {
    title: string;
    imageUrl: string | null;
    altText: string;
}

export default function OfferHistory() {
    const navigate = useNavigate();
    const [activities, setActivities] = useState<Activity[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [offers, setOffers] = useState<any[]>([]);
    const [productImages, setProductImages] = useState<Record<string, ProductInfo>>({});
    const [imagesLoading, setImagesLoading] = useState(false);

    // Extract product/variant IDs from config
    const getProductsFromConfig = useCallback((configJson: string) => {
        try {
            const config = JSON.parse(configJson);
            const ids: string[] = [];
            if (config.buyVariantIds) ids.push(...config.buyVariantIds);
            if (config.getVariantId) ids.push(config.getVariantId);
            if (config.eligibleProductIds) ids.push(...config.eligibleProductIds);
            if (config.eligibleVariantIds) ids.push(...config.eligibleVariantIds);
            if (config.giftVariantId) ids.push(config.giftVariantId);
            if (config.giftVariantIds) ids.push(...config.giftVariantIds);
            if (config.triggerProductId) ids.push(config.triggerProductId);
            if (config.targetVariantId) ids.push(config.targetVariantId);
            return [...new Set(ids.filter(Boolean))];
        } catch { return []; }
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [actRes, statsRes, offersRes] = await Promise.all([
                fetch('/api/activities'),
                fetch('/api/offers/stats'),
                fetch('/api/offers'),
            ]);
            if (actRes.ok) setActivities(await actRes.json());
            if (statsRes.ok) setStats(await statsRes.json());
            if (offersRes.ok) {
                const offersData = await offersRes.json();
                setOffers(offersData);

                // Collect all product IDs from all offers to fetch images
                const allIds: string[] = [];
                offersData.forEach((offer: any) => {
                    const ids = getProductsFromConfig(offer.configurationJson);
                    allIds.push(...ids);
                });

                // Fetch product images from Shopify
                const uniqueIds = [...new Set(allIds)];
                if (uniqueIds.length > 0) {
                    setImagesLoading(true);
                    try {
                        const imgResp = await fetch('/api/products/images', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ids: uniqueIds }),
                        });
                        if (imgResp.ok) {
                            setProductImages(await imgResp.json());
                        }
                    } catch (err) {
                        console.error('Failed to load product images:', err);
                    } finally {
                        setImagesLoading(false);
                    }
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [getProductsFromConfig]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const formatDate = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } catch { return dateStr; }
    };

    const timeAgo = (dateStr: string) => {
        const now = Date.now();
        const then = new Date(dateStr).getTime();
        const diff = now - then;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    if (loading) {
        return (
            <Page title="Loading...">
                <Layout><Layout.Section>
                    <Card><div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Spinner size="large" /></div></Card>
                </Layout.Section></Layout>
            </Page>
        );
    }

    return (
        <Page
            backAction={{ content: 'Dashboard', onAction: () => navigate('/') }}
            title="Offer History & Stats"
            subtitle="View activity log, product coverage, and discount details"
        >
            <Layout>
                {/* Stats Cards */}
                <Layout.Section>
                    <InlineStack gap="400" wrap>
                        <Card>
                            <BlockStack gap="100">
                                <Text variant="bodySm" as="p" tone="subdued">Total Offers</Text>
                                <Text variant="headingLg" as="h2">{stats?.total ?? 0}</Text>
                            </BlockStack>
                        </Card>
                        <Card>
                            <BlockStack gap="100">
                                <Text variant="bodySm" as="p" tone="subdued">Active</Text>
                                <Text variant="headingLg" as="h2" tone="success">{stats?.active ?? 0}</Text>
                            </BlockStack>
                        </Card>
                        <Card>
                            <BlockStack gap="100">
                                <Text variant="bodySm" as="p" tone="subdued">Synced to Shopify</Text>
                                <Text variant="headingLg" as="h2">{stats?.synced ?? 0}</Text>
                            </BlockStack>
                        </Card>
                        {stats?.byType && Object.entries(stats.byType).map(([type, count]) => (
                            <Card key={type}>
                                <BlockStack gap="100">
                                    <Text variant="bodySm" as="p" tone="subdued">{TYPE_LABELS[type] || type}</Text>
                                    <Text variant="headingLg" as="h2">{count}</Text>
                                </BlockStack>
                            </Card>
                        ))}
                    </InlineStack>
                </Layout.Section>

                {/* Offers with Product Images */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingSm" as="h3">📦 Offers & Products</Text>
                            {offers.length === 0 ? (
                                <Text variant="bodySm" as="p" tone="subdued">No offers created yet.</Text>
                            ) : (
                                <BlockStack gap="300">
                                    {offers.map(offer => {
                                        const productIds = getProductsFromConfig(offer.configurationJson);
                                        return (
                                            <div
                                                key={offer.id}
                                                style={{
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #e1e3e5',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => navigate(`/offers/${offer.id}/edit`)}
                                            >
                                                <BlockStack gap="200">
                                                    {/* Offer Header */}
                                                    <InlineStack align="space-between" blockAlign="center">
                                                        <BlockStack gap="050">
                                                            <Text variant="bodyMd" fontWeight="bold" as="h4">{offer.title}</Text>
                                                            <InlineStack gap="200">
                                                                <Badge>{TYPE_LABELS[offer.type] || offer.type}</Badge>
                                                                <Badge tone={offer.status === 'ACTIVE' ? 'success' : offer.status === 'DRAFT' ? 'attention' : 'new'}>
                                                                    {offer.status === 'ACTIVE' ? '🟢 Active' : offer.status === 'DRAFT' ? '📝 Draft' : offer.status}
                                                                </Badge>
                                                                {offer.shopifyDiscountId && <Badge tone="success">Synced</Badge>}
                                                            </InlineStack>
                                                        </BlockStack>
                                                        <Text variant="bodySm" as="span" tone="subdued">
                                                            {formatDate(offer.createdAt)}
                                                        </Text>
                                                    </InlineStack>

                                                    {/* Product Images */}
                                                    {productIds.length > 0 ? (
                                                        <BlockStack gap="100">
                                                            <Text variant="bodySm" as="p" tone="subdued">
                                                                Products ({productIds.length}):
                                                            </Text>
                                                            <InlineStack gap="300" wrap>
                                                                {productIds.map(pid => {
                                                                    const info = productImages[pid];
                                                                    return (
                                                                        <InlineStack key={pid} gap="200" blockAlign="center">
                                                                            {imagesLoading ? (
                                                                                <SkeletonThumbnail size="small" />
                                                                            ) : info?.imageUrl ? (
                                                                                <Thumbnail
                                                                                    source={info.imageUrl}
                                                                                    alt={info.altText || info.title}
                                                                                    size="small"
                                                                                />
                                                                            ) : (
                                                                                <div style={{
                                                                                    width: '40px',
                                                                                    height: '40px',
                                                                                    background: '#f1f2f4',
                                                                                    borderRadius: '4px',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    justifyContent: 'center',
                                                                                    fontSize: '12px',
                                                                                    color: '#8c9196',
                                                                                }}>
                                                                                    📷
                                                                                </div>
                                                                            )}
                                                                            <Text variant="bodySm" as="span">
                                                                                {info?.title || pid.match(/\/(\d+)$/)?.[1] || 'Product'}
                                                                            </Text>
                                                                        </InlineStack>
                                                                    );
                                                                })}
                                                            </InlineStack>
                                                        </BlockStack>
                                                    ) : (
                                                        <Text variant="bodySm" as="p" tone="subdued">
                                                            Applies to all products in store
                                                        </Text>
                                                    )}
                                                </BlockStack>
                                            </div>
                                        );
                                    })}
                                </BlockStack>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Activity Log */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="300">
                            <Text variant="headingSm" as="h3">📜 Activity Log</Text>
                            {activities.length === 0 ? (
                                <Text variant="bodySm" as="p" tone="subdued">
                                    No activity yet. Activities are logged when you create, edit, or deactivate offers.
                                </Text>
                            ) : (
                                <BlockStack gap="200">
                                    {activities.map(activity => {
                                        const actionInfo = ACTION_LABELS[activity.action] || { label: activity.action, tone: 'new' as const };
                                        let details = '';
                                        try {
                                            if (activity.details) {
                                                const d = JSON.parse(activity.details);
                                                if (d.message) details = d.message;
                                                else if (d.oldStatus && d.newStatus) details = `${d.oldStatus} → ${d.newStatus}`;
                                            }
                                        } catch { /* ignore */ }

                                        return (
                                            <div key={activity.id} style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '10px 0',
                                                borderBottom: '1px solid #e1e3e5',
                                            }}>
                                                <Badge tone={actionInfo.tone}>{actionInfo.label}</Badge>
                                                <BlockStack gap="050">
                                                    <Text variant="bodySm" fontWeight="semibold" as="span">
                                                        {activity.offer?.title || 'Deleted Offer'}
                                                    </Text>
                                                    {details && (
                                                        <Text variant="bodySm" as="span" tone="subdued">{details}</Text>
                                                    )}
                                                </BlockStack>
                                                <div style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                                                    <Text variant="bodySm" as="span" tone="subdued">
                                                        {timeAgo(activity.createdAt)}
                                                    </Text>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </BlockStack>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
