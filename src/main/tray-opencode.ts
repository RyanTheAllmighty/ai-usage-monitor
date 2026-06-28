import type { UsageSnapshot } from '../shared/types';

import { formatFiveHourReset, formatWeeklyReset } from './tray-utils';

export function opencodeMenuLines(snapshot: UsageSnapshot | null): string[] {
    if (!snapshot) return ['not synced'];
    if (snapshot.status === 'needs-login') return ['login required'];

    const balance = findMetric(snapshot.metrics, 'zen balance')?.value;
    const spend = findMetric(snapshot.metrics, 'zen spend')?.value;
    const fiveHour = findMetric(snapshot.metrics, 'go 5-hour')?.value;
    const weekly = findMetric(snapshot.metrics, 'go weekly')?.value;
    const monthly = findMetric(snapshot.metrics, 'go monthly')?.value;

    const lines: string[] = [];
    if (balance || spend) {
        lines.push(`Zen: ${balance ?? 'n/a'} balance · ${spend ?? 'n/a'} spend`);
    }
    if (fiveHour || weekly || monthly) {
        lines.push(`Go: 5h ${fiveHour ?? 'n/a'} | weekly ${weekly ?? 'n/a'} | monthly ${monthly ?? 'n/a'}`);
        const resets = extractOpenCodeResets(snapshot);
        const hasAnyReset = resets.fiveHour != null || resets.weekly != null || resets.monthly != null;
        if (hasAnyReset) {
            lines.push(
                `Resets: 5h in ${formatOpenCodeResetRelative(resets.fiveHour, 'short')} | weekly in ${formatOpenCodeResetRelative(resets.weekly, 'long')} | monthly in ${formatOpenCodeResetRelative(resets.monthly, 'long')}`,
            );
        }
    }
    return lines.length ? lines : [snapshot.summary];
}

function findMetric(metrics: UsageSnapshot['metrics'], phrase: string) {
    return metrics.find((metric) => metric.label.toLowerCase().includes(phrase)) ?? null;
}

export function extractOpenCodeResets(snapshot: UsageSnapshot): {
    fiveHour: number | null;
    weekly: number | null;
    monthly: number | null;
} {
    const raw = readObject(snapshot.raw);
    const ssr = readObject(raw.ssr ?? raw);
    const go = readObject(ssr.goSubscription);
    return {
        fiveHour: readNumber(readObject(go.rollingUsage).resetInSec),
        weekly: readNumber(readObject(go.weeklyUsage).resetInSec),
        monthly: readNumber(readObject(go.monthlyUsage).resetInSec),
    };
}

export function formatOpenCodeResetRelative(resetInSec: number | null, style: 'short' | 'long'): string {
    if (resetInSec == null) return 'unknown';
    const resetsAt = Date.now() / 1000 + resetInSec;
    return style === 'short' ? formatFiveHourReset(resetsAt) : formatWeeklyReset(resetsAt);
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
