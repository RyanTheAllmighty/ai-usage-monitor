import { describe, expect, it } from 'vitest';
import type { UsageSnapshot } from '../shared/types';

import { extractOpenCodeResets, formatOpenCodeResetRelative, opencodeMenuLines } from './tray-opencode';

function makeOpenCodeSnapshot(raw: unknown, status: UsageSnapshot['status'] = 'healthy'): UsageSnapshot {
    return {
        id: 'snap-1',
        providerId: 'opencode-1',
        capturedAt: new Date().toISOString(),
        status,
        summary: 'OpenCode usage collected from dashboard',
        metrics: [
            { label: 'Zen balance', value: '$10.00' },
            { label: 'Go 5-hour remaining', value: '80.0%' },
            { label: 'Go weekly remaining', value: '55.0%' },
            { label: 'Go monthly remaining', value: '90.0%' },
        ],
        raw,
        spendUsd: null,
        remainingUsd: 10,
        usagePercent: 10,
    };
}

describe('tray-opencode', () => {
    it('returns "not synced" and "login required" placeholder lines when snapshot is missing or login is needed', () => {
        expect(opencodeMenuLines(null)).toEqual(['not synced']);
        expect(opencodeMenuLines(makeOpenCodeSnapshot({}, 'needs-login'))).toEqual(['login required']);
    });

    it('includes a Resets line in the tray menu when resetInSec values are present in raw.ssr.goSubscription', () => {
        const snapshot = makeOpenCodeSnapshot({
            ssr: {
                goSubscription: {
                    rollingUsage: { resetInSec: 2 * 60 * 60 },
                    weeklyUsage: { resetInSec: 3 * 24 * 60 * 60 + 4 * 60 * 60 },
                    monthlyUsage: { resetInSec: 12 * 24 * 60 * 60 + 5 * 60 * 60 },
                },
            },
        });

        const lines = opencodeMenuLines(snapshot);

        expect(lines.some((line) => line.startsWith('Resets:'))).toBe(true);
        expect(lines.find((line) => line.startsWith('Resets:'))).toMatch(/5h in 2h/);
        expect(lines.find((line) => line.startsWith('Resets:'))).toMatch(/weekly in 3d 4h/);
        expect(lines.find((line) => line.startsWith('Resets:'))).toMatch(/monthly in 12d 5h/);
    });

    it('omits the Resets line when no resetInSec values are available', () => {
        const snapshot = makeOpenCodeSnapshot({
            ssr: {
                goSubscription: {
                    rollingUsage: { resetInSec: null },
                    weeklyUsage: { resetInSec: null },
                    monthlyUsage: { resetInSec: null },
                },
            },
        });

        const lines = opencodeMenuLines(snapshot);

        expect(lines.some((line) => line.startsWith('Resets:'))).toBe(false);
    });

    it('falls back to reading the SSR data from the top of raw when raw.ssr is missing', () => {
        const snapshot = makeOpenCodeSnapshot({
            goSubscription: {
                rollingUsage: { resetInSec: 60 * 60 },
                weeklyUsage: { resetInSec: 2 * 24 * 60 * 60 },
                monthlyUsage: { resetInSec: 5 * 24 * 60 * 60 },
            },
        });

        const resets = extractOpenCodeResets(snapshot);

        expect(resets.fiveHour).toBe(3600);
        expect(resets.weekly).toBe(172_800);
        expect(resets.monthly).toBe(432_000);
    });

    it('reads resetInSec values from the raw.ssr path that the OpenCode provider actually stores', () => {
        const snapshot = makeOpenCodeSnapshot({
            initial: {},
            go: {},
            ssr: {
                goSubscription: {
                    rollingUsage: { resetInSec: 3600 },
                    weeklyUsage: { resetInSec: 172_800 },
                    monthlyUsage: { resetInSec: 432_000 },
                },
            },
        });

        const resets = extractOpenCodeResets(snapshot);

        expect(resets).toEqual({ fiveHour: 3600, weekly: 172_800, monthly: 432_000 });
    });

    it('returns "unknown" for null resetInSec and formats short/long styles for finite values', () => {
        expect(formatOpenCodeResetRelative(null, 'short')).toBe('unknown');
        expect(formatOpenCodeResetRelative(null, 'long')).toBe('unknown');

        const fixedNow = 1_700_000_000_000;
        const originalNow = Date.now;
        Date.now = () => fixedNow;
        try {
            const oneHour = formatOpenCodeResetRelative(3600, 'short');
            const threeDays = formatOpenCodeResetRelative(3 * 24 * 3600, 'long');
            expect(oneHour).toBe('1h');
            expect(threeDays).toBe('3d');
        } finally {
            Date.now = originalNow;
        }
    });
});
