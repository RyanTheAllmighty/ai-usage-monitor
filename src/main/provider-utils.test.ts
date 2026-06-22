import { describe, expect, it } from 'vitest';

import {
    formatUsageUsdMetric,
    formatUsd,
    parseMoneyValues,
    parsePercentValues,
    redact,
    snapshot,
} from './provider-utils';
import {
    extractGroqActivitySpendFromApiPayloads,
    extractGroqSpendFromApiPayloads,
    isPortalLoginRequired,
    parseCodexUsagePayload,
    parsePortalText,
    sumOpenRouterActivityUsage,
} from './providers';

describe('provider-utils', () => {
    it('formats USD values for provider summaries', () => {
        expect(formatUsd(12.5)).toBe('$12.50');
        expect(formatUsd(null)).toBe('n/a');
    });

    it('extracts money and percentage values from portal text', () => {
        const text = 'Current spend $12.40 of $50.00 monthly limit. Usage 24.8% used. Tiny spend $0.00002.';

        expect(parseMoneyValues(text)).toEqual([12.4, 50, 0.00002]);
        expect(parsePercentValues(text)).toEqual([24.8]);
    });

    it('formats tiny USD usage with exact hover text', () => {
        expect(formatUsageUsdMetric(0.00002, 'Current spend')).toMatchObject({
            label: 'Current spend',
            value: '<$0.01',
            tooltip: '$0.00002',
            emphasis: 'dotted',
        });
    });

    it('creates snapshots with stable public fields and redacts keys', () => {
        const next = snapshot({
            providerId: 'provider-1',
            status: 'healthy',
            summary: 'ok',
            metrics: [{ label: 'Remaining', value: '$9.00' }],
            raw: { ok: true },
            remainingUsd: 9,
        });

        expect(next.providerId).toBe('provider-1');
        expect(next.remainingUsd).toBe(9);
        expect(next.id).toHaveLength(36);
        expect(redact('sk-admin-1234567890')).toBe('sk-a...7890');
    });

    it('detects portal login screens', () => {
        const parsed = parsePortalText({ id: 'codex-1', kind: 'codex' }, 'Sign in to continue with OpenAI');

        expect(parsed.status).toBe('needs-login');
        expect(parsed.metrics[0].value).toBe('Needs login');
    });

    it('extracts Groq spend without tracking limits from portal text', () => {
        const parsed = parsePortalText(
            { id: 'groq-1', kind: 'groq' },
            'Billing usage Current spend $0.00002 Monthly limit $50.00 Usage alerts',
        );

        expect(parsed.status).toBe('healthy');
        expect(parsed.spendUsd).toBe(0.00002);
        expect(parsed.remainingUsd).toBe(null);
        expect(parsed.metrics).toHaveLength(1);
        expect(parsed.metrics[0]).toMatchObject({ value: '<$0.01', tooltip: '$0.00002', emphasis: 'dotted' });
    });

    it('prefers Groq API payload spend over rounded visible text', () => {
        const parsed = parsePortalText(
            { id: 'groq-1', kind: 'groq' },
            'Billing usage Current spend $0.00',
            'https://console.groq.com/dashboard/usage',
            { groqSpendUsd: 0.0004 },
        );

        expect(parsed.spendUsd).toBe(0.0004);
        expect(parsed.summary).toBe('$0.0004 current spend');
        expect(parsed.metrics[0]).toMatchObject({ value: '<$0.01', tooltip: '$0.0004' });
    });

    it('extracts Groq spend from nested API payloads without using limits', () => {
        expect(
            extractGroqSpendFromApiPayloads([
                { account: { monthlyLimitUsd: 50, remainingBalanceUsd: 49.99 } },
                { billing: { currentSpendUsd: 0.0004 } },
            ]),
        ).toBe(0.0004);
    });

    it('sums Groq organization activity costs from the canonical API response', () => {
        const activityPayload = {
            url: 'https://api.groq.com/platform/v1/organizations/org_01jjk9m3wyf6y8c0e6x6k0cfk9/activity?start=1777248000&end=1777334400',
            payload: {
                object: 'list',
                data: [
                    { model: 'openai/gpt-oss-120b', cost: 0.00062055 },
                    { model: 'openai/gpt-oss-20b', cost: 0.0005958 },
                    { model: 'whisper-large-v3-turbo', cost: 0.000444444444444 },
                ],
            },
        };

        expect(extractGroqActivitySpendFromApiPayloads([activityPayload])).toBeCloseTo(0.001660794444444);
        expect(extractGroqSpendFromApiPayloads([activityPayload])).toBeCloseTo(0.001660794444444);
    });

    it('sums OpenRouter monthly spend from activity usage instead of lifetime credits usage', () => {
        expect(
            sumOpenRouterActivityUsage([
                {
                    data: [
                        { date: '2026-04-01', usage: 0.25, requests: 3 },
                        { date: '2026-04-01', usage: 0.125, requests: 2 },
                    ],
                },
                {
                    data: [{ date: '2026-04-02', usage: 0.005, requests: 1 }],
                },
            ]),
        ).toBeCloseTo(0.38);
    });

    it('detects an authenticated Groq console page from URL and content', () => {
        expect(
            isPortalLoginRequired(
                { kind: 'groq' },
                'https://console.groq.com/dashboard/usage',
                'Groq Cloud Console Dashboard Billing Usage Current spend $1.25',
            ),
        ).toBe(false);
    });

    it('keeps Groq auth routes in reconnect state', () => {
        expect(
            isPortalLoginRequired({ kind: 'groq' }, 'https://console.groq.com/login', 'Sign in to continue with Groq'),
        ).toBe(true);
    });

    it('extracts Codex remaining usage from dashboard text', () => {
        const parsed = parsePortalText(
            { id: 'codex-1', kind: 'codex' },
            'Codex usage Weekly limit 72% remaining. Resets later today.',
        );

        expect(parsed.summary).toBe('Codex quota usage collected');
        expect(parsed.metrics).toEqual([{ label: 'Weekly remaining', value: '72.0%', tone: 'good' }]);
        expect(parsed.usagePercent).toBe(28);
    });

    it('extracts Codex 5-hour and weekly remaining metrics separately', () => {
        const parsed = parsePortalText(
            { id: 'codex-1', kind: 'codex' },
            'Codex usage 5-hour limit 82% remaining. Weekly limit 51% remaining.',
            'https://chatgpt.com/codex/settings/usage',
        );

        expect(parsed.metrics).toEqual([
            { label: '5-hour remaining', value: '82.0%', tone: 'good' },
            { label: 'Weekly remaining', value: '51.0%', tone: 'good' },
        ]);
    });

    it('extracts Codex quota windows from the OAuth API usage payload', () => {
        const parsed = parseCodexUsagePayload({
            plan_type: 'pro',
            rate_limit: {
                primary_window: { used_percent: 18, window_minutes: 300, reset_at: 1777248000 },
                secondary_window: { used_percent: 49, window_minutes: 10080, reset_at: 1777852800 },
            },
        });

        expect(parsed.summary).toBe('Codex quota usage collected');
        expect(parsed.usagePercent).toBe(18);
        expect(parsed.metrics).toEqual([
            { label: '5-hour remaining', value: '82.0%', tone: 'good', tooltip: expect.any(String) },
            { label: 'Weekly remaining', value: '51.0%', tone: 'good', tooltip: expect.any(String) },
        ]);
    });

    it('parses OpenCode Zen credits and Go quotas from dashboard text', () => {
        const parsed = parsePortalText(
            { id: 'opencode-1', kind: 'opencode' },
            'OpenCode account Zen balance $42.50 Zen spend $7.25 Zen debit $7.25 Go 5-hour 80% remaining Go weekly 55% remaining Go monthly 90% remaining',
            'https://opencode.ai/account',
        );

        expect(parsed.status).toBe('healthy');
        expect(parsed.remainingUsd).toBe(42.5);
        expect(parsed.spendUsd).toBe(7.25);
        expect(parsed.usagePercent).toBe(45);
        expect(parsed.metrics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: 'Zen balance', value: '$42.50' }),
                expect.objectContaining({ label: 'Zen spend', value: '$7.25' }),
                expect.objectContaining({ label: 'Go 5-hour remaining', value: '80.0%' }),
                expect.objectContaining({ label: 'Go weekly remaining', value: '55.0%' }),
                expect.objectContaining({ label: 'Go monthly remaining', value: '90.0%' }),
            ]),
        );
    });

    it('flags an OpenCode warning when a Go quota is nearly exhausted', () => {
        const parsed = parsePortalText(
            { id: 'opencode-1', kind: 'opencode' },
            'Zen balance $42.50 Go weekly 12% remaining',
            'https://opencode.ai/account',
        );

        expect(parsed.status).toBe('warning');
    });

    it('flags an OpenCode warning when Zen balance reaches the alert threshold', () => {
        const parsed = parsePortalText(
            { id: 'opencode-1', kind: 'opencode' },
            'Zen balance $1.00 Go weekly 80% remaining',
            'https://opencode.ai/account',
            { alertCreditRemaining: 2 },
        );

        expect(parsed.status).toBe('warning');
    });

    it('detects OpenCode login screens', () => {
        const parsed = parsePortalText({ id: 'opencode-1', kind: 'opencode' }, 'Sign in to continue with OpenCode');

        expect(parsed.status).toBe('needs-login');
        expect(parsed.metrics[0].value).toBe('Needs login');
    });
});
