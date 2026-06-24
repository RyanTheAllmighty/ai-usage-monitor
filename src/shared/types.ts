export type ProviderKind = 'openai-api' | 'openrouter' | 'groq' | 'codex' | 'opencode';
export type ProviderSource = 'api' | 'portal';
export type ProviderStatus = 'healthy' | 'warning' | 'error' | 'needs-login' | 'syncing' | 'unknown';

export interface ProviderRecord {
    id: string;
    kind: ProviderKind;
    name: string;
    source: ProviderSource;
    refreshIntervalMinutes: number;
    alertCreditRemaining: number | null;
    alertMonthlySpend: number | null;
    createdAt: string;
    updatedAt: string;
    lastSyncedAt: string | null;
    status: ProviderStatus;
    statusMessage: string | null;
    hasSecret: boolean;
    alertSuppressed: boolean;
}

export interface UsageMetric {
    label: string;
    value: string;
    tooltip?: string;
    emphasis?: 'dotted';
    tone?: 'neutral' | 'good' | 'warning' | 'danger';
}

export interface UsageSnapshot {
    id: string;
    providerId: string;
    capturedAt: string;
    status: ProviderStatus;
    summary: string;
    metrics: UsageMetric[];
    raw: unknown;
    spendUsd: number | null;
    remainingUsd: number | null;
    usagePercent: number | null;
}

export interface ProviderWithSnapshot extends ProviderRecord {
    latestSnapshot: UsageSnapshot | null;
}

export interface SettingsRecord {
    startAtLogin: boolean;
    launchMinimized: boolean;
    notificationsEnabled: boolean;
    theme: 'dark' | 'light' | 'system';
    defaultRefreshIntervalMinutes: number;
    defaultHistoryDays: number;
    codexCreditExpiryWarningDays: number;
    developmentMode: boolean;
}

export interface DeveloperLogEntry {
    id: string;
    createdAt: string;
    providerId: string | null;
    providerName: string | null;
    providerKind: ProviderKind | null;
    level: 'debug' | 'info' | 'warning' | 'error';
    event: string;
    source: 'api' | 'portal' | 'system';
    method: string | null;
    url: string | null;
    statusCode: number | null;
    durationMs: number | null;
    message: string | null;
    request: unknown;
    response: unknown;
}

export interface AppState {
    providers: ProviderWithSnapshot[];
    settings: SettingsRecord;
    history: UsageSnapshot[];
    appVersion: string;
}

export interface CreateProviderInput {
    kind: ProviderKind;
    name: string;
    credential?: string;
    refreshIntervalMinutes?: number;
    alertCreditRemaining?: number | null;
    alertMonthlySpend?: number | null;
}

export interface UpdateProviderInput {
    id: string;
    name?: string;
    credential?: string;
    refreshIntervalMinutes?: number;
    alertCreditRemaining?: number | null;
    alertMonthlySpend?: number | null;
}

export interface ProviderDefinition {
    kind: ProviderKind;
    label: string;
    source: ProviderSource;
    credentialLabel: string;
    setupHint: string;
    defaultName: string;
}

export interface LedgerExport {
    exportedAt: string;
    settings: SettingsRecord;
    providers: ProviderWithSnapshot[];
    history: UsageSnapshot[];
    developerLogs: DeveloperLogEntry[];
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
    {
        kind: 'openai-api',
        label: 'OpenAI API',
        source: 'api',
        credentialLabel: 'OpenAI Admin API key',
        setupHint: 'Requires an organization admin key for usage and cost endpoints.',
        defaultName: 'OpenAI API',
    },
    {
        kind: 'openrouter',
        label: 'OpenRouter',
        source: 'api',
        credentialLabel: 'OpenRouter management key',
        setupHint: 'Uses the credits API to report purchased, used, and remaining balance.',
        defaultName: 'OpenRouter',
    },
    {
        kind: 'groq',
        label: 'Groq Cloud',
        source: 'portal',
        credentialLabel: 'Browser login session',
        setupHint: 'A secure browser window opens so you can sign in; passwords are never stored.',
        defaultName: 'Groq Cloud',
    },
    {
        kind: 'codex',
        label: 'OpenAI Codex',
        source: 'api',
        credentialLabel: 'OpenAI Codex OAuth',
        setupHint: 'Uses OpenAI Codex OAuth and the Codex usage API. A browser opens only to approve the login.',
        defaultName: 'OpenAI Codex',
    },
    {
        kind: 'opencode',
        label: 'OpenCode',
        source: 'portal',
        credentialLabel: 'Browser login session',
        setupHint:
            'A secure browser window opens so you can sign in to your OpenCode account; passwords are never stored. Tracks Zen credit balance, spend, and debit, plus Go 5-hour, weekly, and monthly remaining quotas.',
        defaultName: 'OpenCode',
    },
];
