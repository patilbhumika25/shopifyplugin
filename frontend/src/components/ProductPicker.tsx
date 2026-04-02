import { Button, BlockStack, Text, InlineStack, Tag, Card } from '@shopify/polaris';
import { useState, useCallback } from 'react';

interface ProductPickerProps {
    label: string;
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    multiple?: boolean;
    helpText?: string;
    resourceType?: 'product' | 'variant';
}

/**
 * Product Picker component that uses Shopify App Bridge ResourcePicker
 * when embedded in Shopify Admin, or falls back to manual input.
 */
export default function ProductPicker({
    label,
    selectedIds,
    onChange,
    multiple = true,
    helpText,
    resourceType = 'product'
}: ProductPickerProps) {
    const [manualInput, setManualInput] = useState('');
    const [showManualInput, setShowManualInput] = useState(false);

    const openPicker = useCallback(async () => {
        // Check if App Bridge is available (embedded in Shopify Admin)
        if (typeof window !== 'undefined' && (window as any).shopify?.resourcePicker) {
            try {
                const selected = await (window as any).shopify.resourcePicker({
                    type: resourceType === 'variant' ? 'variant' : 'product',
                    multiple,
                    action: 'select',
                    filter: { variants: resourceType === 'variant' },
                });

                if (selected && selected.length > 0) {
                    let ids: string[];
                    if (resourceType === 'variant') {
                        ids = selected.flatMap((item: any) =>
                            item.variants ? item.variants.map((v: any) => v.id) : [item.id]
                        );
                    } else {
                        ids = selected.map((item: any) => item.id);
                    }
                    onChange(multiple ? [...new Set([...selectedIds, ...ids])] : ids);
                }
            } catch (err) {
                console.log('ResourcePicker not available, using manual input');
                setShowManualInput(true);
            }
        } else {
            // Fallback: show manual input
            setShowManualInput(true);
        }
    }, [selectedIds, onChange, multiple, resourceType]);

    const handleRemove = useCallback((idToRemove: string) => {
        onChange(selectedIds.filter(id => id !== idToRemove));
    }, [selectedIds, onChange]);

    const handleAddManual = useCallback(() => {
        const newIds = manualInput
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        if (newIds.length > 0) {
            onChange(multiple ? [...new Set([...selectedIds, ...newIds])] : newIds);
            setManualInput('');
            setShowManualInput(false);
        }
    }, [manualInput, selectedIds, onChange, multiple]);

    const formatId = (id: string) => {
        // Show a friendly version of the GID
        const match = id.match(/\/(\w+)\/(\d+)$/);
        if (match) return `${match[1]} #${match[2]}`;
        return id.length > 30 ? `...${id.slice(-20)}` : id;
    };

    return (
        <BlockStack gap="200">
            <Text variant="bodyMd" fontWeight="semibold" as="p">{label}</Text>
            {helpText && <Text variant="bodySm" as="p" tone="subdued">{helpText}</Text>}

            {selectedIds.length > 0 && (
                <InlineStack gap="200" wrap>
                    {selectedIds.map(id => (
                        <Tag key={id} onRemove={() => handleRemove(id)}>
                            {formatId(id)}
                        </Tag>
                    ))}
                </InlineStack>
            )}

            <InlineStack gap="200">
                <Button onClick={openPicker} size="slim">
                    {selectedIds.length > 0
                        ? `${multiple ? 'Add More' : 'Change'} ${resourceType === 'variant' ? 'Variants' : 'Products'}`
                        : `Select ${resourceType === 'variant' ? 'Variants' : 'Products'}`
                    }
                </Button>
                {selectedIds.length > 0 && (
                    <Button onClick={() => onChange([])} size="slim" tone="critical" variant="plain">
                        Clear All
                    </Button>
                )}
            </InlineStack>

            {showManualInput && (
                <Card>
                    <BlockStack gap="200">
                        <Text variant="bodySm" as="p" tone="subdued">
                            Enter {resourceType} IDs manually (comma-separated):
                        </Text>
                        <textarea
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            placeholder="gid://shopify/ProductVariant/123, gid://shopify/ProductVariant/456"
                            rows={3}
                            style={{
                                width: '100%',
                                padding: '8px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                fontFamily: 'inherit',
                                fontSize: '13px',
                            }}
                        />
                        <InlineStack gap="200">
                            <Button onClick={handleAddManual} size="slim" variant="primary">Add</Button>
                            <Button onClick={() => setShowManualInput(false)} size="slim">Cancel</Button>
                        </InlineStack>
                    </BlockStack>
                </Card>
            )}
        </BlockStack>
    );
}
