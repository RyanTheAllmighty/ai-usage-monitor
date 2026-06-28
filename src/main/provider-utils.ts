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

export interface OpenCodeUsageWindow {
    status: string | null;
    resetInSec: number | null;
    usagePercent: number | null;
}

export interface OpenCodeGoSubscription {
    mine: boolean | null;
    useBalance: boolean | null;
    rollingUsage: OpenCodeUsageWindow;
    weeklyUsage: OpenCodeUsageWindow;
    monthlyUsage: OpenCodeUsageWindow;
}

export interface OpenCodeBilling {
    customerID: string | null;
    balance: number | null;
    subscriptionPlan: string | null;
    subscriptionID: string | null;
    liteSubscriptionID: string | null;
    monthlyLimit: number | null;
    monthlyUsage: number | null;
}

export interface OpenCodeUsageItem {
    id: string;
    timeCreated: string;
    timeUpdated: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWrite5mTokens: number | null;
    cost: number;
    sessionID: string;
    keyID: string;
    enrichment: { plan: string } | null;
}

export interface OpenCodeWorkspace {
    id: string;
    name: string;
    slug: string | null;
}

export interface OpenCodeSsrData {
    workspaceId: string;
    userEmail: string | null;
    billing: OpenCodeBilling | null;
    goSubscription: OpenCodeGoSubscription | null;
    usage: OpenCodeUsageItem[];
    workspaces: OpenCodeWorkspace[];
}

export function emptyOpenCodeUsageWindow(): OpenCodeUsageWindow {
    return { status: null, resetInSec: null, usagePercent: null };
}

export function emptyOpenCodeGoSubscription(): OpenCodeGoSubscription {
    return {
        mine: null,
        useBalance: null,
        rollingUsage: emptyOpenCodeUsageWindow(),
        weeklyUsage: emptyOpenCodeUsageWindow(),
        monthlyUsage: emptyOpenCodeUsageWindow(),
    };
}

export function emptyOpenCodeBilling(): OpenCodeBilling {
    return {
        customerID: null,
        balance: null,
        subscriptionPlan: null,
        subscriptionID: null,
        liteSubscriptionID: null,
        monthlyLimit: null,
        monthlyUsage: null,
    };
}

export function normalizeOpenCodeSsrData(input: {
    workspaceId: string;
    userEmail?: string | null;
    billing?: Record<string, unknown> | null;
    goSubscription?: Record<string, unknown> | null;
    usage?: Array<Record<string, unknown>> | null;
    workspaces?: ReadonlyArray<Record<string, unknown> | OpenCodeWorkspace> | null;
}): OpenCodeSsrData {
    const billing = input.billing ? normalizeOpenCodeBilling(input.billing) : null;
    const goSubscription = input.goSubscription ? normalizeOpenCodeGoSubscription(input.goSubscription) : null;
    const usage = Array.isArray(input.usage) ? input.usage.map(normalizeOpenCodeUsageItem) : [];
    const workspaces = Array.isArray(input.workspaces)
        ? input.workspaces
              .map((item) => normalizeOpenCodeWorkspace(item))
              .filter((item): item is OpenCodeWorkspace => item !== null)
        : [];
    return {
        workspaceId: input.workspaceId,
        userEmail: typeof input.userEmail === 'string' ? input.userEmail : null,
        billing,
        goSubscription,
        usage,
        workspaces,
    };
}

function normalizeOpenCodeBilling(input: Record<string, unknown>): OpenCodeBilling {
    return {
        customerID: readString(input.customerID),
        balance: readFiniteNumber(input.balance),
        subscriptionPlan: readString(input.subscriptionPlan) ?? null,
        subscriptionID: readString(input.subscriptionID) ?? null,
        liteSubscriptionID: readString(input.liteSubscriptionID) ?? null,
        monthlyLimit: readFiniteNumber(input.monthlyLimit),
        monthlyUsage: readFiniteNumber(input.monthlyUsage),
    };
}

function normalizeOpenCodeGoSubscription(input: Record<string, unknown>): OpenCodeGoSubscription {
    return {
        mine: typeof input.mine === 'boolean' ? input.mine : null,
        useBalance: typeof input.useBalance === 'boolean' ? input.useBalance : null,
        rollingUsage: normalizeOpenCodeUsageWindow(input.rollingUsage),
        weeklyUsage: normalizeOpenCodeUsageWindow(input.weeklyUsage),
        monthlyUsage: normalizeOpenCodeUsageWindow(input.monthlyUsage),
    };
}

function normalizeOpenCodeUsageWindow(value: unknown): OpenCodeUsageWindow {
    const empty = emptyOpenCodeUsageWindow();
    if (!value || typeof value !== 'object') return empty;
    const record = value as Record<string, unknown>;
    return {
        status: readString(record.status) ?? null,
        resetInSec: readFiniteNumber(record.resetInSec),
        usagePercent: readFiniteNumber(record.usagePercent),
    };
}

function normalizeOpenCodeUsageItem(value: unknown): OpenCodeUsageItem {
    const record = (value ?? {}) as Record<string, unknown>;
    const enrichment =
        record.enrichment && typeof record.enrichment === 'object'
            ? (record.enrichment as Record<string, unknown>)
            : null;
    return {
        id: readString(record.id) ?? '',
        timeCreated: readString(record.timeCreated) ?? '',
        timeUpdated: readString(record.timeUpdated) ?? '',
        model: readString(record.model) ?? '',
        provider: readString(record.provider) ?? '',
        inputTokens: readFiniteNumber(record.inputTokens) ?? 0,
        outputTokens: readFiniteNumber(record.outputTokens) ?? 0,
        cacheReadTokens: readFiniteNumber(record.cacheReadTokens) ?? 0,
        cacheWrite5mTokens: readFiniteNumber(record.cacheWrite5mTokens),
        cost: readFiniteNumber(record.cost) ?? 0,
        sessionID: readString(record.sessionID) ?? '',
        keyID: readString(record.keyID) ?? '',
        enrichment: enrichment && typeof enrichment.plan === 'string' ? { plan: enrichment.plan } : null,
    };
}

function normalizeOpenCodeWorkspace(value: unknown): OpenCodeWorkspace | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const id = readString(record.id);
    if (!id) return null;
    return {
        id,
        name: readString(record.name) ?? id,
        slug: readString(record.slug) ?? null,
    };
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export interface OpenCodeParsedSnapshot {
    status: 'healthy' | 'warning';
    summary: string;
    metrics: UsageMetric[];
    spendUsd: number | null;
    remainingUsd: number | null;
    usagePercent: number | null;
}

const OPENCODE_GO_LOW_WARNING_PERCENT = 15;
const OPENCODE_USAGE_COST_MICRO = 1_000_000;

export function parseOpenCodeSsrData(
    data: OpenCodeSsrData,
    options: { alertCreditRemaining?: number | null } = {},
): OpenCodeParsedSnapshot {
    const metrics: UsageMetric[] = [];
    const summaryParts: string[] = [];

    const balance = data.billing?.balance ?? null;
    if (balance != null) {
        const danger = options.alertCreditRemaining != null && balance <= options.alertCreditRemaining;
        metrics.push(formatUsageUsdMetric(balance, 'Zen balance', danger ? 'warning' : 'good'));
        summaryParts.push(`${formatUsdPrecise(balance)} Zen balance`);
    }

    const spendUsd = sumOpenCodeUsageSpend(data.usage);
    if (spendUsd != null && spendUsd > 0) {
        metrics.push(formatUsageUsdMetric(spendUsd, 'Recent spend', 'neutral'));
        metrics.push(formatUsageUsdMetric(spendUsd, 'Zen debit', 'neutral'));
        summaryParts.push(`${formatUsdPrecise(spendUsd)} recent spend`);
    }

    const remainingPercentages: number[] = [];
    if (data.goSubscription?.mine) {
        const rolling = remainingPercentFromUsed(data.goSubscription.rollingUsage.usagePercent);
        const weekly = remainingPercentFromUsed(data.goSubscription.weeklyUsage.usagePercent);
        const monthly = remainingPercentFromUsed(data.goSubscription.monthlyUsage.usagePercent);
        if (rolling != null) {
            metrics.push({
                label: 'Go 5-hour remaining',
                value: `${rolling.toFixed(1)}%`,
                tone: rolling <= OPENCODE_GO_LOW_WARNING_PERCENT ? 'warning' : 'good',
                tooltip: formatOpenCodeResetTooltip(data.goSubscription.rollingUsage.resetInSec),
            });
            remainingPercentages.push(rolling);
        }
        if (weekly != null) {
            metrics.push({
                label: 'Go weekly remaining',
                value: `${weekly.toFixed(1)}%`,
                tone: weekly <= OPENCODE_GO_LOW_WARNING_PERCENT ? 'warning' : 'good',
                tooltip: formatOpenCodeResetTooltip(data.goSubscription.weeklyUsage.resetInSec),
            });
            remainingPercentages.push(weekly);
        }
        if (monthly != null) {
            metrics.push({
                label: 'Go monthly remaining',
                value: `${monthly.toFixed(1)}%`,
                tone: monthly <= OPENCODE_GO_LOW_WARNING_PERCENT ? 'warning' : 'good',
                tooltip: formatOpenCodeResetTooltip(data.goSubscription.monthlyUsage.resetInSec),
            });
            remainingPercentages.push(monthly);
        }
        const lowest = remainingPercentages.length ? Math.min(...remainingPercentages) : null;
        if (lowest != null) {
            summaryParts.push(`${lowest.toFixed(0)}% lowest Go quota remaining`);
        }
    } else {
        metrics.push({ label: 'Go', value: 'Not subscribed', tone: 'neutral' });
    }

    const balanceDanger =
        balance != null && options.alertCreditRemaining != null && balance <= options.alertCreditRemaining;
    const lowestGo = remainingPercentages.length ? Math.min(...remainingPercentages) : null;
    const quotaWarning = lowestGo != null && lowestGo <= OPENCODE_GO_LOW_WARNING_PERCENT;
    const status: 'healthy' | 'warning' = balanceDanger || quotaWarning ? 'warning' : 'healthy';

    return {
        status,
        summary: summaryParts.length ? summaryParts.join(' · ') : 'OpenCode usage collected from dashboard',
        metrics: metrics.length ? metrics : [{ label: 'Usage', value: 'No data found', tone: 'neutral' }],
        spendUsd: spendUsd ?? (balance != null ? 0 : null),
        remainingUsd: balance,
        usagePercent: lowestGo != null ? Math.max(0, Math.min(100, 100 - lowestGo)) : null,
    };
}

function remainingPercentFromUsed(usedPercent: number | null | undefined): number | null {
    if (usedPercent == null || !Number.isFinite(usedPercent)) return null;
    return Math.max(0, Math.min(100, 100 - usedPercent));
}

function formatOpenCodeResetTooltip(resetInSec: number | null | undefined): string | undefined {
    if (resetInSec == null || !Number.isFinite(resetInSec)) return undefined;
    if (resetInSec <= 0) return 'Resets now';
    return `Resets ${new Date(Date.now() + resetInSec * 1000).toLocaleString()}`;
}

export function sumOpenCodeUsageSpend(usage: ReadonlyArray<OpenCodeUsageItem>): number | null {
    if (!usage.length) return null;
    let totalMicro = 0;
    for (const item of usage) {
        if (item.cost > 0) totalMicro += item.cost;
    }
    if (totalMicro <= 0) return 0;
    return totalMicro / OPENCODE_USAGE_COST_MICRO;
}

export function openCodeSsrDataIsEmpty(data: OpenCodeSsrData): boolean {
    return data.billing == null && data.goSubscription == null && data.usage.length === 0;
}
