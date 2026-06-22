import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import { db } from './database';
import { vault } from './secrets';
import { IPC_CHANNELS } from '../shared/ipc';
import { createTray, rebuildTrayMenu } from './tray';
import { clearProviderSession, loginProvider, refreshAllProviders, refreshProvider } from './providers';
import { PROVIDER_DEFINITIONS, type CreateProviderInput, type UpdateProviderInput } from '../shared/types';

const APP_NAME_PROD = 'AI Usage Monitor';
const APP_NAME_DEV = 'AI Usage Monitor (Dev)';
const APP_DISPLAY_NAME = app.isPackaged ? APP_NAME_PROD : APP_NAME_DEV;

if (!app.isPackaged) {
    app.setName(APP_NAME_DEV);
}

let mainWindow: BrowserWindow | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let scheduledRefreshRunning = false;
let isQuitting = false;
let shouldShowWhenReady = false;

function showMainWindow(): void {
    if (!mainWindow) {
        shouldShowWhenReady = true;
        return;
    }

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function createWindow(): BrowserWindow {
    const screenshotSize = getScreenshotWindowSize();
    const settings = db.getSettings();
    mainWindow = new BrowserWindow({
        width: screenshotSize?.width ?? 1220,
        height: screenshotSize?.height ?? 820,
        minWidth: 980,
        minHeight: 680,
        frame: false,
        show: false,
        title: APP_DISPLAY_NAME,
        icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
        backgroundColor: '#080d1b',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.once('ready-to-show', () => {
        if (!settings.launchMinimized) mainWindow?.show();
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    if (process.env.ELECTRON_RENDERER_URL) {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    captureWindowScreenshotIfRequested(mainWindow);

    return mainWindow;
}

function getScreenshotWindowSize(): { width: number; height: number } | null {
    if (!process.env.AI_USAGE_MONITOR_SCREENSHOT_PATH) return null;
    return {
        width: Number(process.env.AI_USAGE_MONITOR_SCREENSHOT_WIDTH ?? 1493),
        height: Number(process.env.AI_USAGE_MONITOR_SCREENSHOT_HEIGHT ?? 1019),
    };
}

function captureWindowScreenshotIfRequested(win: BrowserWindow): void {
    const outputPath = process.env.AI_USAGE_MONITOR_SCREENSHOT_PATH;
    if (!outputPath) return;

    win.webContents.once('did-finish-load', () => {
        setTimeout(
            () => {
                void win.capturePage().then((image) => {
                    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                    fs.writeFileSync(outputPath, image.toPNG());
                    app.quit();
                });
            },
            Number(process.env.AI_USAGE_MONITOR_SCREENSHOT_DELAY_MS ?? 2000),
        );
    });
}

function registerIpc(): void {
    ipcMain.handle(IPC_CHANNELS.getAppState, () => ({
        providers: db.listProvidersWithSnapshots(),
        settings: db.getSettings(),
        history: db.getHistory(),
    }));

    ipcMain.handle(IPC_CHANNELS.createProvider, (_event, input: CreateProviderInput) => {
        const definition = PROVIDER_DEFINITIONS.find((item) => item.kind === input.kind);
        if (!definition) throw new Error(`Unknown provider kind: ${input.kind}`);
        const encryptedCredential = input.credential ? vault.encrypt(input.credential) : null;
        const provider = db.createProvider({
            id: crypto.randomUUID(),
            kind: input.kind,
            source: definition.source,
            name: input.name.trim() || definition.defaultName,
            refreshIntervalMinutes: input.refreshIntervalMinutes ?? db.getSettings().defaultRefreshIntervalMinutes,
            alertCreditRemaining: input.alertCreditRemaining ?? null,
            alertMonthlySpend: input.alertMonthlySpend ?? null,
            hasSecret: Boolean(encryptedCredential),
        });
        if (encryptedCredential) db.saveSecret(provider.id, encryptedCredential);
        rebuildTrayMenu(() => mainWindow);
        return db.getProvider(provider.id);
    });

    ipcMain.handle(IPC_CHANNELS.updateProvider, (_event, input: UpdateProviderInput) => {
        const encryptedCredential = input.credential ? vault.encrypt(input.credential) : null;
        const changes = {
            ...(input.name != null ? { name: input.name } : {}),
            ...(input.refreshIntervalMinutes != null ? { refreshIntervalMinutes: input.refreshIntervalMinutes } : {}),
            ...(input.alertCreditRemaining !== undefined ? { alertCreditRemaining: input.alertCreditRemaining } : {}),
            ...(input.alertMonthlySpend !== undefined ? { alertMonthlySpend: input.alertMonthlySpend } : {}),
            ...(encryptedCredential ? { hasSecret: true } : {}),
        };
        const updated = db.updateProvider(input.id, changes);
        if (encryptedCredential) db.saveSecret(input.id, encryptedCredential);
        rebuildTrayMenu(() => mainWindow);
        return updated;
    });

    ipcMain.handle(IPC_CHANNELS.deleteProvider, (_event, id: string) => {
        db.deleteProvider(id);
        rebuildTrayMenu(() => mainWindow);
    });

    ipcMain.handle(IPC_CHANNELS.refreshProvider, async (_event, id: string) => {
        const result = await refreshProvider(id);
        rebuildTrayMenu(() => mainWindow);
        return result;
    });

    ipcMain.handle(IPC_CHANNELS.refreshAll, async () => {
        const result = await refreshAllProviders();
        rebuildTrayMenu(() => mainWindow);
        return result;
    });

    ipcMain.handle(IPC_CHANNELS.loginProvider, async (_event, id: string) => {
        await loginProvider(id);
        rebuildTrayMenu(() => mainWindow);
    });

    ipcMain.handle(IPC_CHANNELS.clearProviderSession, async (_event, id: string) => {
        await clearProviderSession(id);
        db.updateProvider(id, {
            status: 'needs-login',
            statusMessage: 'Browser session cleared. Sign in again to refresh usage.',
        });
        rebuildTrayMenu(() => mainWindow);
    });

    ipcMain.handle(IPC_CHANNELS.suppressProviderAlert, (_event, id: string) => {
        const updated = db.updateProvider(id, { alertSuppressed: true });
        rebuildTrayMenu(() => mainWindow);
        return updated;
    });

    ipcMain.handle(IPC_CHANNELS.unsuppressProviderAlert, (_event, id: string) => {
        const updated = db.updateProvider(id, { alertSuppressed: false });
        rebuildTrayMenu(() => mainWindow);
        return updated;
    });

    ipcMain.handle(IPC_CHANNELS.updateSettings, (_event, partial) => {
        const settings = db.updateSettings(partial);
        app.setLoginItemSettings({
            openAtLogin: settings.startAtLogin,
            openAsHidden: settings.launchMinimized,
        });
        scheduleRefreshes();
        return settings;
    });

    ipcMain.handle(IPC_CHANNELS.getHistory, (_event, providerId?: string) => db.getHistory(providerId));
    ipcMain.handle(IPC_CHANNELS.getDeveloperLogs, (_event, providerId?: string) => db.getDeveloperLogs(providerId));

    const buildLedgerExport = () => ({
        exportedAt: new Date().toISOString(),
        settings: db.getSettings(),
        providers: db.listProvidersWithSnapshots(),
        history: db.getHistory(),
        developerLogs: db.getDeveloperLogs(),
    });

    ipcMain.handle(IPC_CHANNELS.exportLedgerFile, async () => {
        const options: Electron.SaveDialogOptions = {
            defaultPath: `ai-usage-monitor-ledger-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        };
        const result = mainWindow
            ? await dialog.showSaveDialog(mainWindow, options)
            : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return null;
        fs.writeFileSync(result.filePath, JSON.stringify(buildLedgerExport(), null, 2));
        return { path: result.filePath };
    });

    const importLedgerSchema = z.object({
        exportedAt: z.string().optional(),
        settings: z.record(z.string(), z.unknown()).optional().default({}),
        providers: z.array(z.record(z.string(), z.unknown())).optional().default([]),
        history: z.array(z.record(z.string(), z.unknown())).optional().default([]),
        developerLogs: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    });

    ipcMain.handle(IPC_CHANNELS.importLedgerFile, async () => {
        const options: Electron.OpenDialogOptions = {
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile'],
        };
        const result = mainWindow
            ? await dialog.showOpenDialog(mainWindow, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths.length) return null;
        const text = fs.readFileSync(result.filePaths[0], 'utf8');
        const parsed = importLedgerSchema.parse(JSON.parse(text));
        db.importLedger(parsed);
        const settings = db.getSettings();
        app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, openAsHidden: settings.launchMinimized });
        rebuildTrayMenu(() => mainWindow);
        return { providers: parsed.providers.length, history: parsed.history.length };
    });

    ipcMain.handle(IPC_CHANNELS.clearHistory, (_event, providerId?: string) => {
        db.clearHistory(providerId);
        rebuildTrayMenu(() => mainWindow);
    });
    ipcMain.handle(IPC_CHANNELS.deleteHistorySnapshot, (_event, snapshotId: string) => {
        if (!db.getSettings().developmentMode)
            throw new Error('Development mode is required to delete individual history rows.');
        db.deleteSnapshot(snapshotId);
        rebuildTrayMenu(() => mainWindow);
    });
    ipcMain.handle(IPC_CHANNELS.clearDeveloperLogs, (_event, providerId?: string) => {
        db.clearDeveloperLogs(providerId);
    });
    ipcMain.handle(IPC_CHANNELS.clearAllData, async () => {
        const providers = db.listProviders();
        for (const provider of providers) {
            if (provider.source === 'portal') await clearProviderSession(provider.id);
        }
        db.clearAllData();
        app.setLoginItemSettings({ openAtLogin: false, openAsHidden: false });
        rebuildTrayMenu(() => mainWindow);
    });
    ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: string) => shell.openExternal(url));
    ipcMain.handle(IPC_CHANNELS.windowAction, (_event, action: 'minimize' | 'maximize' | 'close') => {
        if (!mainWindow) return false;
        if (action === 'minimize') mainWindow.minimize();
        if (action === 'maximize') {
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            else mainWindow.maximize();
        }
        if (action === 'close') mainWindow.close();
        return mainWindow.isMaximized();
    });
}

function scheduleRefreshes(): void {
    if (process.env.AI_USAGE_MONITOR_DISABLE_SCHEDULED_REFRESH === '1') return;

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        void runScheduledRefreshes();
    }, 60_000);
    void runScheduledRefreshes();
}

async function runScheduledRefreshes(): Promise<void> {
    if (scheduledRefreshRunning) return;
    scheduledRefreshRunning = true;
    try {
        const now = Date.now();
        const dueProviders = db.listProviders().filter((provider) => isProviderDueOnAlignedInterval(provider, now));
        if (dueProviders.length === 0) return;

        await Promise.all(dueProviders.map((provider) => refreshProvider(provider.id)));
        rebuildTrayMenu(() => mainWindow);
    } finally {
        scheduledRefreshRunning = false;
    }
}

function isProviderDueOnAlignedInterval(
    provider: { refreshIntervalMinutes: number; lastSyncedAt: string | null },
    now: number,
): boolean {
    const intervalMs = Math.max(1, provider.refreshIntervalMinutes) * 60_000;
    const currentIntervalBoundary = Math.floor(now / intervalMs) * intervalMs;
    const lastSyncedAt = provider.lastSyncedAt ? new Date(provider.lastSyncedAt).getTime() : 0;
    return !lastSyncedAt || lastSyncedAt < currentIntervalBoundary;
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showMainWindow();
    });

    app.whenReady().then(async () => {
        const userDataPath = process.env.AI_USAGE_MONITOR_USER_DATA_DIR;
        if (userDataPath) app.setPath('userData', userDataPath);

        await db.init();
        registerIpc();
        const settings = db.getSettings();
        app.setLoginItemSettings({
            openAtLogin: settings.startAtLogin,
            openAsHidden: settings.launchMinimized,
        });
        createWindow();
        createTray(() => mainWindow);
        scheduleRefreshes();
        if (shouldShowWhenReady) showMainWindow();

        app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window));

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
            else showMainWindow();
        });
    });

    app.on('before-quit', () => {
        isQuitting = true;
    });
}
