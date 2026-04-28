import type { ProviderStatus, UsageMetric, UsageSnapshot } from '../shared/types';

export function formatUsd(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return 'n/a';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function formatUsdPrecise(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return 'n/a';
    if (value > 0 && value < 0.01) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 8,
        }).format(value);
    }
    return formatUsd(value);
}

export function formatUsageUsdMetric(
    value: number | null | undefined,
    label: string,
    tone?: UsageMetric['tone'],
): UsageMetric {
    if (value == null || Number.isNaN(value)) return { label, value: 'n/a', tone };
    if (value > 0 && value < 0.01) {
        return {
            label,
            value: '<$0.01',
            tooltip: formatUsdPrecise(value),
            emphasis: 'dotted',
            tone,
        };
    }
    return { label, value: formatUsd(value), tone };
}

export function snapshot(input: {
    providerId: string;
    status: ProviderStatus;
    summary: string;
    metrics: UsageMetric[];
    raw: unknown;
    spendUsd?: number | null;
    remainingUsd?: number | null;
    usagePercent?: number | null;
}): UsageSnapshot {
    return {
        id: crypto.randomUUID(),
        providerId: input.providerId,
        capturedAt: new Date().toISOString(),
        status: input.status,
        summary: input.summary,
        metrics: input.metrics,
        raw: input.raw,
        spendUsd: input.spendUsd ?? null,
        remainingUsd: input.remainingUsd ?? null,
        usagePercent: input.usagePercent ?? null,
    };
}

export function redact(value: string): string {
    if (value.length < 10) return '***';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function parseMoneyValues(text: string): number[] {
    return [...text.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g)].map((match) => Number(match[1].replaceAll(',', '')));
}

export function parsePercentValues(text: string): number[] {
    return [...text.matchAll(/([0-9]{1,3}(?:\.[0-9]+)?)\s?%/g)]
        .map((match) => Number(match[1]))
        .filter((value) => value >= 0 && value <= 100);
}
