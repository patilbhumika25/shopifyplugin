import { Page, Layout, Card, Form, FormLayout, TextField, Select, Button, Banner, BlockStack, Text, InlineStack, Modal, Spinner } from '@shopify/polaris';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import BogoForm, { type BogoFormHandle } from './forms/BogoForm';
import FreeGiftForm, { type FreeGiftFormHandle } from './forms/FreeGiftForm';
import VolumeForm, { type VolumeFormHandle } from './forms/VolumeForm';
import ComboForm, { type ComboFormHandle } from './forms/ComboForm';

type FormHandle = BogoFormHandle | FreeGiftFormHandle | VolumeFormHandle | ComboFormHandle;

export default function CreateOffer() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEditMode = Boolean(id);

    const [title, setTitle] = useState('');
    const [type, setType] = useState('BOGO');
    const [status, setStatus] = useState('ACTIVE');
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(isEditMode);
    const [existingConfig, setExistingConfig] = useState<any>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    const formRef = useRef<FormHandle>(null);

    // Load existing offer data when editing
    useEffect(() => {
        if (!id) return;

        async function loadOffer() {
            try {
                const resp = await fetch(`/api/offers/${id}`);
                if (!resp.ok) {
                    if (resp.status === 404) {
                        setErrorMessage('Offer not found');
                    } else {
                        throw new Error('Failed to load offer');
                    }
                    setInitialLoading(false);
                    return;
                }
                const offer = await resp.json();
                setTitle(offer.title);
                setType(offer.type);
                setStatus(offer.status || 'ACTIVE');
                try {
                    setExistingConfig(JSON.parse(offer.configurationJson));
                } catch {
                    setExistingConfig(null);
                }
                setInitialLoading(false);
            } catch (err: any) {
                setErrorMessage(err.message);
                setInitialLoading(false);
            }
        }
        loadOffer();
    }, [id]);

    const handleSubmit = useCallback(async () => {
        if (!formRef.current) return;
        setLoading(true);
        setErrorMessage('');
        setSuccessMessage('');

        // Validate title
        if (!title.trim()) {
            setErrorMessage('Please enter an offer title.');
            setLoading(false);
            return;
        }

        const config = formRef.current.getConfig();

        // Validate config has required fields
        if (!config.configType) {
            setErrorMessage('Please select a sub-type for this offer.');
            setLoading(false);
            return;
        }

        // Check for NaN values in numeric fields
        const numericValues = Object.entries(config).filter(([_, v]) => typeof v === 'number');
        const hasNaN = numericValues.some(([, v]) => isNaN(v as number));
        if (hasNaN) {
            setErrorMessage('Please fill in all required numeric fields with valid numbers.');
            setLoading(false);
            return;
        }

        try {
            const shop = new URLSearchParams(window.location.search).get('shop') || '';
            const url = isEditMode ? `/api/offers/${id}` : '/api/offers';
            const method = isEditMode ? 'PUT' : 'POST';

            const resp = await fetch(`${url}?shop=${shop}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    type,
                    status,
                    configType: config.configType,
                    configurationJson: config,
                }),
            });
            if (!resp.ok) {
                if (resp.status === 401) {
                    const shop = new URLSearchParams(window.location.search).get('shop');
                    window.open(`/api/auth?shop=${shop}`, '_top');
                    return;
                }
                const data = await resp.json().catch(() => ({}));
                throw new Error(data.error || `Failed to ${isEditMode ? 'update' : 'create'} offer`);
            }
            if (isEditMode) {
                setSuccessMessage('Offer updated successfully!');
                setTimeout(() => navigate('/'), 1500);
            } else {
                navigate('/');
            }
        } catch (err: any) {
            setErrorMessage(err.message);
        } finally {
            setLoading(false);
        }
    }, [title, type, status, navigate, id, isEditMode]);

    const handleDelete = useCallback(async () => {
        try {
            setLoading(true);
            const resp = await fetch(`/api/offers/${id}`, { method: 'DELETE' });
            if (resp.ok) {
                navigate('/');
            }
        } catch (err: any) {
            setErrorMessage(err.message);
        } finally {
            setLoading(false);
            setShowDeleteModal(false);
        }
    }, [id, navigate]);

    if (initialLoading) {
        return (
            <Page title="Loading...">
                <Layout>
                    <Layout.Section>
                        <Card>
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                                <Spinner size="large" />
                            </div>
                        </Card>
                    </Layout.Section>
                </Layout>
            </Page>
        );
    }

    return (
        <Page
            backAction={{ content: 'Offers', onAction: () => navigate('/') }}
            title={isEditMode ? `Edit Offer` : 'Create New Offer'}
            subtitle={isEditMode ? title : undefined}
            primaryAction={isEditMode ? {
                content: 'Delete Offer',
                destructive: true,
                onAction: () => setShowDeleteModal(true),
            } : undefined}
        >
            <Layout>
                <Layout.Section>
                    {errorMessage && <Banner tone="critical" onDismiss={() => setErrorMessage('')}><p>{errorMessage}</p></Banner>}
                    {successMessage && <Banner tone="success" onDismiss={() => setSuccessMessage('')}><p>{successMessage}</p></Banner>}

                    <Card>
                        <Form onSubmit={handleSubmit}>
                            <FormLayout>
                                <TextField
                                    label="Offer Title"
                                    value={title}
                                    onChange={setTitle}
                                    autoComplete="off"
                                    placeholder="e.g., Buy 2 Get 1 Free, Summer Sale Bundle"
                                    helpText="This name will appear in your Shopify Discounts list"
                                />

                                <Select
                                    label="Offer Type"
                                    options={[
                                        { label: '🔖 Buy X, Get Y (BOGO)', value: 'BOGO' },
                                        { label: '🎁 Free Gift on Order Value', value: 'FREE_GIFT' },
                                        { label: '📊 Volume Pricing (Tiered Discount)', value: 'VOLUME' },
                                        { label: '🧩 Combo / Hybrid Offer', value: 'COMBO' },
                                    ]}
                                    value={type}
                                    onChange={setType}
                                    disabled={isEditMode}
                                    helpText={isEditMode ? "Type cannot be changed after creation" : undefined}
                                />

                                {isEditMode && (
                                    <Select
                                        label="Status"
                                        options={[
                                            { label: '🟢 Active', value: 'ACTIVE' },
                                            { label: '📝 Draft', value: 'DRAFT' },
                                            { label: '📦 Archived', value: 'ARCHIVED' },
                                        ]}
                                        value={status}
                                        onChange={setStatus}
                                    />
                                )}

                                {type === 'BOGO' && <BogoForm ref={formRef as React.Ref<BogoFormHandle>} initialConfig={existingConfig} />}
                                {type === 'FREE_GIFT' && <FreeGiftForm ref={formRef as React.Ref<FreeGiftFormHandle>} initialConfig={existingConfig} />}
                                {type === 'VOLUME' && <VolumeForm ref={formRef as React.Ref<VolumeFormHandle>} initialConfig={existingConfig} />}
                                {type === 'COMBO' && <ComboForm ref={formRef as React.Ref<ComboFormHandle>} initialConfig={existingConfig} />}

                                <InlineStack gap="300">
                                    <Button submit variant="primary" loading={loading}>
                                        {isEditMode ? 'Update Offer' : 'Save Offer'}
                                    </Button>
                                    <Button onClick={() => navigate('/')}>Cancel</Button>
                                </InlineStack>
                            </FormLayout>
                        </Form>
                    </Card>
                </Layout.Section>

                {/* Help Sidebar */}
                <Layout.Section variant="oneThird">
                    <Card>
                        <BlockStack gap="200">
                            <Text variant="headingSm" as="h3">💡 How it works</Text>
                            <Text variant="bodySm" as="p">
                                When you save an offer, a <strong>Shopify Discount</strong> is automatically created.
                                The discount runs at checkout using Shopify Functions.
                            </Text>
                            <Text variant="bodySm" as="p">
                                You can view your discounts in <strong>Shopify Admin → Discounts</strong>.
                            </Text>
                        </BlockStack>
                    </Card>
                    {type === 'BOGO' && (
                        <Card>
                            <BlockStack gap="200">
                                <Text variant="headingSm" as="h3">🔖 BOGO Types</Text>
                                <Text variant="bodySm" as="p"><strong>Basic:</strong> Buy X items, get Y items free/discounted</Text>
                                <Text variant="bodySm" as="p"><strong>Cheapest Free:</strong> Add N items, cheapest is free</Text>
                                <Text variant="bodySm" as="p"><strong>Multi-Tier:</strong> Multiple buy/get tiers</Text>
                            </BlockStack>
                        </Card>
                    )}
                </Layout.Section>
            </Layout>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <Modal
                    open={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title="Delete this offer?"
                    primaryAction={{
                        content: 'Delete',
                        destructive: true,
                        onAction: handleDelete,
                        loading,
                    }}
                    secondaryActions={[{
                        content: 'Cancel',
                        onAction: () => setShowDeleteModal(false),
                    }]}
                >
                    <Modal.Section>
                        <Text as="p">
                            This will permanently delete the offer "{title}" and remove the associated Shopify discount.
                            This action cannot be undone.
                        </Text>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
}
