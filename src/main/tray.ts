import fs from 'node:fs';
import path from 'node:path';
import type { MenuItemConstructorOptions, NativeImage } from 'electron';
import { type BrowserWindow, Menu, Tray, nativeImage, app } from 'electron';
import type { ProviderWithSnapshot, UsageMetric, UsageSnapshot } from '../shared/types';

import { db } from './database';
import { refreshAllProviders } from './providers';

let tray: Tray | null = null;

export function createTray(getWindow: () => BrowserWindow | null): Tray {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('AI Usage Monitor');
    tray.on('click', () => {
        const win = getWindow();
        if (!win) return;
        if (win.isVisible()) win.focus();
        else win.show();
    });
    rebuildTrayMenu(getWindow);
    return tray;
}

function createTrayIcon(): NativeImage {
    const assetDir = path.join(app.getAppPath(), 'assets');
    const icon = nativeImage.createFromPath(path.join(assetDir, 'tray.png'));
    const retinaPath = path.join(assetDir, 'tray@2x.png');
    if (fs.existsSync(retinaPath)) {
        const dataUrl = `data:image/png;base64,${fs.readFileSync(retinaPath).toString('base64')}`;
        icon.addRepresentation({ scaleFactor: 2, dataURL: dataUrl });
    }
    return icon;
}

export function rebuildTrayMenu(getWindow: () => BrowserWindow | null): void {
    if (!tray) return;
    const providers = db.listProvidersWithSnapshots();
    const usageItems = buildUsageItems(providers);

    const menu = Menu.buildFromTemplate([
        ...usageItems,
        { type: 'separator' },
        {
            label: 'Refresh all',
            click: async () => {
                await refreshAllProviders();
                rebuildTrayMenu(getWindow);
            },
        },
        {
            label: 'Open dashboard',
            click: () => getWindow()?.show(),
        },
        {
            label: 'Settings',
            click: () => {
                const win = getWindow();
                win?.show();
                win?.webContents.send('navigate', 'settings');
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            },
        },
    ]);
    tray.setContextMenu(menu);
}

function buildUsageItems(providers: ProviderWithSnapshot[]): MenuItemConstructorOptions[] {
    if (providers.length === 0) return [{ label: 'No providers configured', enabled: false }];

    const regularProviders = providers.filter((provider) => provider.kind !== 'codex');
    const codexProviders = providers.filter((provider) => provider.kind === 'codex');
    const items: MenuItemConstructorOptions[] = regularProviders.map((provider) => ({
        label: `${provider.name}: ${menuSummary(provider.latestSnapshot)}`,
        enabled: false,
    }));

    if (regularProviders.length > 0 && codexProviders.length > 0) items.push({ type: 'separator' });

    codexProviders.forEach((provider, index) => {
        if (index > 0) items.push({ type: 'separator' });
        items.push({ label: `OpenAI Codex - ${provider.name}`, enabled: false });

        const summary = codexMenuSummary(provider.latestSnapshot);
        if (summary.kind === 'unavailable') {
            items.push({ label: summary.label, enabled: false });
            return;
        }

        items.push({
            label: `Remaining: 5-hour ${summary.fiveHour.percent} | weekly ${summary.weekly.percent}`,
            enabled: false,
        });
        items.push({
            label: `Resets: 5-hour in ${summary.fiveHour.reset} | weekly in ${summary.weekly.reset}`,
            enabled: false,
        });
    });

    return items;
}

function menuSummary(snapshot: UsageSnapshot | null): string {
    if (!snapshot) return 'not synced';
    if (snapshot.status === 'needs-login') return 'login required';
    return snapshot.summary;
}

type CodexTrayQuota = {
    percent: string;
    reset: string;
};

type CodexTraySummary =
    | { kind: 'ready'; fiveHour: CodexTrayQuota; weekly: CodexTrayQuota }
    | { kind: 'unavailable'; label: string };

function codexMenuSummary(snapshot: UsageSnapshot | null): CodexTraySummary {
    if (!snapshot) return { kind: 'unavailable', label: 'not synced' };
    if (snapshot.status === 'needs-login') return { kind: 'unavailable', label: 'login required' };
    if (snapshot.status === 'error') return { kind: 'unavailable', label: menuSummary(snapshot) };

    const windows = extractCodexWindows(snapshot);
    const fiveHourWindow = windows.find((window) => window.label.toLowerCase().includes('5-hour'));
    const weeklyWindow = windows.find((window) => window.label.toLowerCase().includes('weekly'));
    const fiveHourMetric = findCodexMetric(snapshot.metrics, '5-hour');
    const weeklyMetric = findCodexMetric(snapshot.metrics, 'weekly');

    const fiveHourPercent =
        formatRemainingPercent(fiveHourWindow?.remainingPercent) ?? fiveHourMetric?.value ?? 'unknown';
    const weeklyPercent = formatRemainingPercent(weeklyWindow?.remainingPercent) ?? weeklyMetric?.value ?? 'unknown';

    return {
        kind: 'ready',
        fiveHour: {
            percent: fiveHourPercent,
            reset: formatFiveHourReset(fiveHourWindow?.resetsAt),
        },
        weekly: {
            percent: weeklyPercent,
            reset: formatWeeklyReset(weeklyWindow?.resetsAt),
        },
    };
}

function findCodexMetric(metrics: UsageMetric[], phrase: string): UsageMetric | null {
    return metrics.find((metric) => metric.label.toLowerCase().includes(phrase)) ?? null;
}

function extractCodexWindows(
    snapshot: UsageSnapshot,
): Array<{ label: string; remainingPercent: number; resetsAt: number | null }> {
    const raw = readObject(snapshot.raw);
    const rawUsage = readAny(raw, ['usage']);
    const usage = rawUsage == null ? raw : readObject(rawUsage);
    const rateLimit = readObject(readAny(usage, ['rate_limit', 'rateLimit']));
    const windows: Array<{ label: string; remainingPercent: number; resetsAt: number | null }> = [];

    const primary = parseCodexWindow(
        readObject(readAny(rateLimit, ['primary_window', 'primaryWindow', 'primary'])),
        '5-hour',
    );
    const secondary = parseCodexWindow(
        readObject(readAny(rateLimit, ['secondary_window', 'secondaryWindow', 'secondary'])),
        'Weekly',
    );
    if (primary) windows.push(primary);
    if (secondary) windows.push(secondary);

    const additional = readAny(usage, ['additional_rate_limits', 'additionalRateLimits']);
    if (Array.isArray(additional)) {
        for (const item of additional) {
            const entry = readObject(item);
            const nested = readObject(readAny(entry, ['rate_limit', 'rateLimit']));
            const label =
                readString(readAny(entry, ['limit_name', 'limitName', 'metered_feature', 'meteredFeature'])) ??
                'Additional';
            const window = parseCodexWindow(
                readObject(readAny(nested, ['primary_window', 'primaryWindow', 'primary'])),
                label,
            );
            if (window) windows.push(window);
        }
    }

    return windows;
}

function parseCodexWindow(
    window: Record<string, unknown>,
    fallbackLabel: string,
): { label: string; remainingPercent: number; resetsAt: number | null } | null {
    const usedPercent = readNumber(readAny(window, ['used_percent', 'usedPercent']));
    if (usedPercent == null || usedPercent < 0 || usedPercent > 100) return null;
    const minutes = readNumber(readAny(window, ['window_minutes', 'windowMinutes']));
    return {
        label: formatCodexWindowLabel(minutes, fallbackLabel),
        remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
        resetsAt: readNumber(readAny(window, ['reset_at', 'resetAt', 'resets_at', 'resetsAt'])),
    };
}

function formatCodexWindowLabel(minutes: number | null, fallback: string): string {
    if (minutes == null) return fallback;
    if (minutes === 300) return '5-hour';
    if (minutes === 10080) return 'Weekly';
    if (minutes < 60) return `${minutes}-minute`;
    if (minutes % 1440 === 0) return minutes === 10080 ? 'Weekly' : `${minutes / 1440}-day`;
    if (minutes % 60 === 0) return `${minutes / 60}-hour`;
    return fallback;
}

function formatRemainingPercent(value: number | undefined): string | null {
    if (value == null) return null;
    const rounded = Number(value.toFixed(1));
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatFiveHourReset(resetAt: number | null | undefined): string {
    const minutes = minutesUntil(resetAt);
    if (minutes == null) return 'unknown';
    if (minutes <= 0) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatWeeklyReset(resetAt: number | null | undefined): string {
    const minutes = minutesUntil(resetAt);
    if (minutes == null) return 'unknown';
    if (minutes <= 0) return 'now';

    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const remainingMinutes = minutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (remainingMinutes > 0 || parts.length === 0) parts.push(`${remainingMinutes}m`);
    return parts.join(' ');
}

function minutesUntil(resetAt: number | null | undefined): number | null {
    if (resetAt == null) return null;
    return Math.ceil((resetAt * 1000 - Date.now()) / 60_000);
}

function readAny(object: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (object[key] != null) return object[key];
    }
    return null;
}

function readObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}
