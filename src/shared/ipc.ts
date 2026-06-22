import type {
    AppState,
    CreateProviderInput,
    DeveloperLogEntry,
    LedgerExport,
    ProviderRecord,
    SettingsRecord,
    UpdateProviderInput,
    UsageSnapshot,
} from './types';

export interface AiUsageMonitorApi {
    getAppState(): Promise<AppState>;
    createProvider(input: CreateProviderInput): Promise<ProviderRecord>;
    updateProvider(input: UpdateProviderInput): Promise<ProviderRecord>;
    deleteProvider(id: string): Promise<void>;
    refreshProvider(id: string): Promise<UsageSnapshot>;
    refreshAll(): Promise<UsageSnapshot[]>;
    loginProvider(id: string): Promise<void>;
    clearProviderSession(id: string): Promise<void>;
    suppressProviderAlert(id: string): Promise<ProviderRecord>;
    unsuppressProviderAlert(id: string): Promise<ProviderRecord>;
    updateSettings(settings: Partial<SettingsRecord>): Promise<SettingsRecord>;
    getHistory(providerId?: string): Promise<UsageSnapshot[]>;
    getDeveloperLogs(providerId?: string): Promise<DeveloperLogEntry[]>;
    exportLedger(): Promise<LedgerExport>;
    clearHistory(providerId?: string): Promise<void>;
    deleteHistorySnapshot(snapshotId: string): Promise<void>;
    clearDeveloperLogs(providerId?: string): Promise<void>;
    clearAllData(): Promise<void>;
    windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<boolean>;
    openExternal(url: string): Promise<void>;
}

export const IPC_CHANNELS = {
    getAppState: 'app:get-state',
    createProvider: 'provider:create',
    updateProvider: 'provider:update',
    deleteProvider: 'provider:delete',
    refreshProvider: 'provider:refresh',
    refreshAll: 'provider:refresh-all',
    loginProvider: 'provider:login',
    clearProviderSession: 'provider:clear-session',
    suppressProviderAlert: 'provider:suppress-alert',
    unsuppressProviderAlert: 'provider:unsuppress-alert',
    updateSettings: 'settings:update',
    getHistory: 'history:get',
    getDeveloperLogs: 'developer-logs:get',
    exportLedger: 'ledger:export',
    clearHistory: 'ledger:clear-history',
    deleteHistorySnapshot: 'ledger:delete-snapshot',
    clearDeveloperLogs: 'developer-logs:clear',
    clearAllData: 'ledger:clear-all-data',
    windowAction: 'window:action',
    openExternal: 'shell:open-external',
} as const;
