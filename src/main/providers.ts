import { createHash, randomBytes } from 'node:crypto';
import { BrowserWindow, Notification, session, shell } from 'electron';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { DeveloperLogEntry, ProviderRecord, UsageMetric, UsageSnapshot } from '../shared/types';

import { db } from './database';
import { vault } from './secrets';
import {
    formatUsageUsdMetric,
    formatUsdPrecise,
    normalizeOpenCodeSsrData,
    openCodeSsrDataIsEmpty,
    parseMoneyValues,
    parseOpenCodeSsrData,
    parsePercentValues,
    snapshot,
    type OpenCodeSsrData,
    type OpenCodeWorkspace,
} from './provider-utils';

const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const OPENROUTER_ACTIVITY_URL = 'https://openrouter.ai/api/v1/activity';
const CODEX_AUTH_ISSUER = 'https://auth.openai.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_OAUTH_CALLBACK_PORT = 1455;
const OPENCODE_AUTH_URL = 'https://opencode.ai/auth';
const OPENCODE_WORKSPACE_BASE_URL = 'https://opencode.ai/workspace';
const OPENCODE_GO_PATH = '/go';
const OPENCODE_HYDRATION_WAIT_MS = 6_000;
const GROQ_REFRESH_TIMEOUT_MS = 30_000;
const PORTAL_DEBUGGER_TIMEOUT_MS = 4_000;
const GROQ_ACTIVITY_WAIT_MS = 8_000;
const GROQ_ACTIVITY_URL_PATTERN = /^https:\/\/api\.groq\.com\/platform\/v1\/organizations\/[^/]+\/activity(?:\?|$)/i;
const portalWindows = new Map<string, BrowserWindow>();
const inFlightRefreshes = new Map<string, Promise<UsageSnapshot>>();

class RefreshTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RefreshTimeoutError';
    }
}

export async function refreshProvider(providerId: string): Promise<UsageSnapshot> {
    const existing = inFlightRefreshes.get(providerId);
    if (existing) return existing;

    const refresh = refreshProviderInternal(providerId).finally(() => {
        inFlightRefreshes.delete(providerId);
    });
    inFlightRefreshes.set(providerId, refresh);
    return refresh;
}

async function refreshProviderInternal(providerId: string): Promise<UsageSnapshot> {
    const provider = db.getProvider(providerId);
    const startedAt = Date.now();
    logDeveloperEvent({
        provider,
        level: 'info',
        event: 'refresh.start',
        source: provider.source,
        method: null,
        url: provider.source === 'portal' ? getPortalUrl(provider) : null,
        statusCode: null,
        durationMs: null,
        message: `Refreshing ${provider.name}.`,
        request: {
            providerId: provider.id,
            providerKind: provider.kind,
            source: provider.source,
        },
        response: null,
    });
    try {
        const next =
            provider.kind === 'openai-api'
                ? await refreshOpenAi(provider)
                : provider.kind === 'openrouter'
                  ? await refreshOpenRouter(provider)
                  : provider.kind === 'codex'
                    ? await refreshCodex(provider)
                    : await refreshPortal(provider);

        db.addSnapshot(next);
        logDeveloperEvent({
            provider,
            level: next.status === 'healthy' ? 'info' : next.status === 'warning' ? 'warning' : 'error',
            event: 'refresh.complete',
            source: provider.source,
            method: null,
            url: provider.source === 'portal' ? getPortalUrl(provider) : null,
            statusCode: null,
            durationMs: Date.now() - startedAt,
            message: next.summary,
            request: null,
            response: {
                status: next.status,
                metrics: next.metrics,
                spendUsd: next.spendUsd,
                remainingUsd: next.remainingUsd,
                usagePercent: next.usagePercent,
            },
        });
        maybeNotify(provider, next);
        return next;
    } catch (error) {
        logDeveloperEvent({
            provider,
            level: 'error',
            event: 'refresh.failed',
            source: provider.source,
            method: null,
            url: provider.source === 'portal' ? getPortalUrl(provider) : null,
            statusCode: null,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : 'Refresh failed.',
            request: null,
            response: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
            },
        });
        const failed = snapshot({
            providerId: provider.id,
            status: isLikelySessionError(error) ? 'needs-login' : 'error',
            summary: error instanceof Error ? error.message : 'Refresh failed.',
            metrics: [{ label: 'Status', value: 'Refresh failed', tone: 'danger' }],
            raw: { error: error instanceof Error ? error.message : String(error) },
        });
        db.addSnapshot(failed);
        maybeNotify(provider, failed);
        return failed;
    }
}

export async function refreshAllProviders(): Promise<UsageSnapshot[]> {
    const providers = db.listProviders();
    return Promise.all(providers.map((provider) => refreshProvider(provider.id)));
}

async function refreshOpenAi(provider: ProviderRecord): Promise<UsageSnapshot> {
    const encrypted = db.getSecret(provider.id);
    if (!encrypted) throw new Error('Missing OpenAI admin key.');
    const key = vault.decrypt(encrypted);
    const startTime = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

    const costsUrl = `${OPENAI_COSTS_URL}?start_time=${startTime}&bucket_width=1d&limit=31`;
    const costs = await fetchJson(provider, costsUrl, { headers }, 'OpenAI costs');
    const spendUsd = sumOpenAiCosts(costs);
    const metrics: UsageMetric[] = [formatUsageUsdMetric(spendUsd, 'Monthly spend', spendUsd > 0 ? 'neutral' : 'good')];

    return snapshot({
        providerId: provider.id,
        status: provider.alertMonthlySpend != null && spendUsd >= provider.alertMonthlySpend ? 'warning' : 'healthy',
        summary: `${formatUsdPrecise(spendUsd)} spent this month`,
        metrics,
        raw: { costs },
        spendUsd,
    });
}

async function refreshOpenRouter(provider: ProviderRecord): Promise<UsageSnapshot> {
    const encrypted = db.getSecret(provider.id);
    if (!encrypted) throw new Error('Missing OpenRouter management key.');
    const key = vault.decrypt(encrypted);
    const headers = { Authorization: `Bearer ${key}` };
    const activityDates = getCurrentUtcMonthCompletedDates();
    const [credits, activityByDay] = await Promise.all([
        fetchJson(provider, OPENROUTER_CREDITS_URL, { headers }, 'OpenRouter credits'),
        Promise.all(
            activityDates.map((date) =>
                fetchJson(
                    provider,
                    `${OPENROUTER_ACTIVITY_URL}?date=${date}`,
                    { headers },
                    `OpenRouter activity ${date}`,
                ),
            ),
        ),
    ]);
    const totalCredits = Number(credits.data?.total_credits ?? 0);
    const totalUsage = Number(credits.data?.total_usage ?? 0);
    const remaining = Math.max(totalCredits - totalUsage, 0);
    const monthlySpend = sumOpenRouterActivityUsage(activityByDay);
    const danger = provider.alertCreditRemaining != null && remaining <= provider.alertCreditRemaining;
    const spendWarning = provider.alertMonthlySpend != null && monthlySpend >= provider.alertMonthlySpend;

    return snapshot({
        providerId: provider.id,
        status: danger || spendWarning ? 'warning' : 'healthy',
        summary: `${formatUsdPrecise(monthlySpend)} spent this month, ${formatUsdPrecise(remaining)} credit remaining`,
        metrics: [
            formatUsageUsdMetric(remaining, 'Credit', danger ? 'warning' : 'neutral'),
            formatUsageUsdMetric(monthlySpend, 'Monthly spend', spendWarning ? 'warning' : 'neutral'),
        ],
        raw: { credits, activityByDay, activityDates },
        spendUsd: monthlySpend,
        remainingUsd: remaining,
        usagePercent: null,
    });
}

async function refreshCodex(provider: ProviderRecord): Promise<UsageSnapshot> {
    let auth = await getCodexAuth(provider);
    let usage: unknown;
    let resetCredits: unknown;

    try {
        [usage, resetCredits] = await fetchCodexUsageAndResetCredits(provider, auth);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/401|unauthori[sz]ed|token|auth/i.test(message)) throw error;

        auth = await refreshCodexTokens(provider, auth);
        [usage, resetCredits] = await fetchCodexUsageAndResetCredits(provider, auth);
    }

    const settings = db.getSettings();
    const parsed = parseCodexUsagePayload(usage, resetCredits, {
        creditExpiryWarningDays: settings.codexCreditExpiryWarningDays,
    });
    return snapshot({
        providerId: provider.id,
        status: parsed.status,
        summary: parsed.summary,
        metrics: parsed.metrics,
        raw: {
            source: CODEX_USAGE_URL,
            resetCreditsSource: CODEX_RESET_CREDITS_URL,
            accountId: auth.accountId ?? null,
            planType: auth.planType ?? null,
            usage,
            resetCredits,
        },
        spendUsd: null,
        remainingUsd: null,
        usagePercent: parsed.usagePercent,
    });
}

async function fetchCodexUsageAndResetCredits(
    provider: ProviderRecord,
    auth: CodexAuthSecret,
): Promise<[unknown, unknown]> {
    const headers = codexAuthHeaders(auth);
    return Promise.all([
        fetchJson(provider, CODEX_USAGE_URL, { headers }, 'Codex usage'),
        fetchJson(provider, CODEX_RESET_CREDITS_URL, { headers }, 'Codex reset credits'),
    ]);
}

export async function loginProvider(providerId: string): Promise<void> {
    const provider = db.getProvider(providerId);
    if (provider.kind === 'codex') {
        await loginCodexProvider(provider);
        return;
    }

    if (provider.source !== 'portal') return;

    const existing = portalWindows.get(provider.id);
    if (existing && !existing.isDestroyed()) {
        existing.show();
        existing.focus();
        return;
    }

    const win = createPortalWindow(provider, false);
    portalWindows.set(provider.id, win);
    let authenticated = false;
    let checkTimer: NodeJS.Timeout | null = null;
    const checkAuthenticated = async (): Promise<void> => {
        if (authenticated || win.isDestroyed()) return;
        const data = await extractPortalPage(win).catch(() => null);
        if (!data || isPortalLoginRequired(provider, data.url, data.text)) return;

        authenticated = true;
        db.updateProvider(provider.id, {
            status: 'syncing',
            statusMessage: 'Portal session connected. Collecting usage now.',
        });
        await refreshProvider(provider.id);
    };

    win.webContents.on('did-finish-load', () => {
        void checkAuthenticated();
    });
    checkTimer = setInterval(() => {
        void checkAuthenticated();
    }, 2000);
    win.on('closed', () => {
        if (checkTimer) clearInterval(checkTimer);
        portalWindows.delete(provider.id);
        if (!authenticated) {
            db.updateProvider(provider.id, {
                status: 'needs-login',
                statusMessage: 'Sign in was not detected. Open login again when ready.',
            });
        }
    });
    db.updateProvider(provider.id, {
        status: 'needs-login',
        statusMessage: 'Sign in in the opened browser window. Usage will refresh automatically.',
    });
    await win.loadURL(getPortalUrl(provider));
}

interface CodexAuthSecret {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId?: string | null;
    accountEmail?: string | null;
    planType?: string | null;
    isFedramp?: boolean;
    lastRefresh?: string;
}

interface CodexTokenResponse {
    id_token: string;
    access_token: string;
    refresh_token: string;
}

async function loginCodexProvider(provider: ProviderRecord): Promise<void> {
    const pkce = createPkce();
    const state = randomUrlToken(32);
    const login = await createLocalCodexLoginServer(provider, pkce, state);

    db.updateProvider(provider.id, {
        status: 'needs-login',
        statusMessage: 'Approve the Codex OAuth login in your browser.',
    });

    try {
        await shell.openExternal(buildCodexAuthorizeUrl(login.redirectUri, pkce.challenge, state));
        const auth = await withTimeout(
            login.done,
            5 * 60_000,
            () => 'Codex OAuth login timed out. Try connecting again.',
        );
        saveCodexAuth(provider, auth);
        db.updateProvider(provider.id, {
            status: 'syncing',
            statusMessage: 'Codex OAuth connected. Collecting usage now.',
            hasSecret: true,
        });
        await refreshProvider(provider.id);
    } finally {
        login.close();
    }
}

function createLocalCodexLoginServer(
    provider: ProviderRecord,
    pkce: { verifier: string; challenge: string },
    expectedState: string,
): Promise<{ redirectUri: string; done: Promise<CodexAuthSecret>; close: () => void }> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            void handleCodexOAuthRequest(provider, req, res, pkce, expectedState)
                .then((auth) => {
                    if (auth) {
                        doneResolve(auth);
                        server.close();
                    }
                })
                .catch((error) => {
                    doneReject(error);
                    sendCodexOAuthResponse(res, false, error instanceof Error ? error.message : 'Codex login failed.');
                    server.close();
                });
        });

        let doneResolve!: (auth: CodexAuthSecret) => void;
        let doneReject!: (error: unknown) => void;
        const done = new Promise<CodexAuthSecret>((innerResolve, innerReject) => {
            doneResolve = innerResolve;
            doneReject = innerReject;
        });

        server.on('error', reject);
        server.listen(CODEX_OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Could not start Codex OAuth callback server.'));
                return;
            }
            resolve({
                redirectUri: `http://localhost:${CODEX_OAUTH_CALLBACK_PORT}/auth/callback`,
                done,
                close: () => server.close(),
            });
        });
    });
}

async function handleCodexOAuthRequest(
    provider: ProviderRecord,
    req: IncomingMessage,
    res: ServerResponse,
    pkce: { verifier: string },
    expectedState: string,
): Promise<CodexAuthSecret | null> {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    if (requestUrl.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end('Not found');
        return null;
    }

    const state = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    const error = requestUrl.searchParams.get('error');
    if (error) throw new Error(requestUrl.searchParams.get('error_description') ?? `Codex OAuth failed: ${error}`);
    if (!state || state !== expectedState) throw new Error('Codex OAuth state did not match.');
    if (!code) throw new Error('Codex OAuth did not return an authorization code.');

    const redirectUri = `http://localhost:${CODEX_OAUTH_CALLBACK_PORT}/auth/callback`;
    const tokens = await exchangeCodexCode(code, redirectUri, pkce.verifier);
    const auth = tokensToCodexAuth(tokens);
    logDeveloperEvent({
        provider,
        level: 'info',
        event: 'codex.oauth.connected',
        source: 'api',
        method: 'POST',
        url: `${CODEX_AUTH_ISSUER}/oauth/token`,
        statusCode: 200,
        durationMs: null,
        message: 'Codex OAuth token exchange succeeded.',
        request: { grant_type: 'authorization_code', client_id: CODEX_CLIENT_ID, redirect_uri: redirectUri },
        response: { accountId: auth.accountId, accountEmail: auth.accountEmail, planType: auth.planType },
    });
    sendCodexOAuthResponse(res, true, 'Codex is connected. You can close this browser tab.');
    return auth;
}

function sendCodexOAuthResponse(res: ServerResponse, success: boolean, message: string): void {
    if (res.headersSent) return;
    res.writeHead(success ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
        `<!doctype html><title>AI Usage Monitor</title><body style="font-family:system-ui;background:#080d1b;color:#eaf0ff;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:520px;text-align:center"><h1>${success ? 'Connected' : 'Could not connect'}</h1><p>${escapeHtml(message)}</p></main></body>`,
    );
}

function buildCodexAuthorizeUrl(redirectUri: string, codeChallenge: string, state: string): string {
    const url = new URL('/oauth/authorize', CODEX_AUTH_ISSUER);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CODEX_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'openid profile email offline_access api.connectors.read api.connectors.invoke');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('state', state);
    url.searchParams.set('originator', 'ai-usage-monitor');
    return url.toString();
}

async function exchangeCodexCode(code: string, redirectUri: string, verifier: string): Promise<CodexTokenResponse> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CODEX_CLIENT_ID,
        code_verifier: verifier,
    });
    return postCodexToken(body, { 'Content-Type': 'application/x-www-form-urlencoded' }, 'Codex OAuth token exchange');
}

async function refreshCodexTokens(provider: ProviderRecord, auth: CodexAuthSecret): Promise<CodexAuthSecret> {
    const body = JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CODEX_CLIENT_ID,
        refresh_token: auth.refreshToken,
    });
    const tokens = await postCodexToken(body, { 'Content-Type': 'application/json' }, 'Codex OAuth token refresh');
    const refreshed = tokensToCodexAuth(tokens);
    saveCodexAuth(provider, refreshed);
    return refreshed;
}

async function postCodexToken(
    body: BodyInit,
    headers: Record<string, string>,
    label: string,
): Promise<CodexTokenResponse> {
    const res = await fetch(`${CODEX_AUTH_ISSUER}/oauth/token`, {
        method: 'POST',
        headers,
        body,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`${label} failed with ${res.status}${text ? `: ${text.slice(0, 220)}` : ''}`);
    return JSON.parse(text) as CodexTokenResponse;
}

function getCodexAuth(provider: ProviderRecord): CodexAuthSecret {
    const encrypted = db.getSecret(provider.id);
    if (!encrypted) throw new Error('Codex OAuth login is required.');
    const parsed = JSON.parse(vault.decrypt(encrypted)) as CodexAuthSecret;
    if (!parsed.accessToken || !parsed.refreshToken)
        throw new Error('Codex OAuth login is incomplete. Reconnect this provider.');
    return parsed;
}

function saveCodexAuth(provider: ProviderRecord, auth: CodexAuthSecret): void {
    db.saveSecret(provider.id, vault.encrypt(JSON.stringify(auth)));
}

function codexAuthHeaders(auth: CodexAuthSecret): Record<string, string> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'codex-cli',
    };
    if (auth.accountId) headers['ChatGPT-Account-ID'] = auth.accountId;
    if (auth.isFedramp) headers['X-OpenAI-Fedramp'] = 'true';
    return headers;
}

function tokensToCodexAuth(tokens: CodexTokenResponse): CodexAuthSecret {
    const idClaims = decodeJwtPayload(tokens.id_token);
    const authClaims = getOpenAiAuthClaims(idClaims);
    const profileClaims = idClaims['https://api.openai.com/profile'] as Record<string, unknown> | undefined;
    return {
        idToken: tokens.id_token,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accountId: readString(authClaims.chatgpt_account_id),
        accountEmail: readString(idClaims.email) ?? readString(profileClaims?.email),
        planType: readString(authClaims.chatgpt_plan_type),
        isFedramp: authClaims.chatgpt_account_is_fedramp === true,
        lastRefresh: new Date().toISOString(),
    };
}

function createPkce(): { verifier: string; challenge: string } {
    const verifier = randomUrlToken(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

function randomUrlToken(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
}

function decodeJwtPayload(token: string): Record<string, unknown> {
    const [, payload] = token.split('.');
    if (!payload) return {};
    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function getOpenAiAuthClaims(claims: Record<string, unknown>): Record<string, unknown> {
    const auth = claims['https://api.openai.com/auth'];
    return auth && typeof auth === 'object' ? (auth as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
}

async function refreshPortal(provider: ProviderRecord): Promise<UsageSnapshot> {
    if (provider.kind === 'opencode') return refreshOpenCodePortal(provider);
    const win = createPortalWindow(provider, true);
    let networkCapture: Awaited<ReturnType<typeof startNetworkJsonCapture>> | null = null;
    const timeout = provider.kind === 'groq' ? GROQ_REFRESH_TIMEOUT_MS : 45_000;
    try {
        return await withTimeout(
            (async () => {
                networkCapture = provider.kind === 'groq' ? await startNetworkJsonCapture(win, provider) : null;
                return collectPortalSnapshot(provider, win, networkCapture);
            })(),
            timeout,
            () =>
                `${provider.kind === 'groq' ? 'Groq Cloud' : provider.name} refresh timed out after ${Math.round(timeout / 1000)} seconds. Try again, or reconnect the portal session.`,
        );
    } finally {
        const capture = networkCapture as Awaited<ReturnType<typeof startNetworkJsonCapture>> | null;
        capture?.stop();
        if (!win.isDestroyed()) win.destroy();
    }
}

async function collectPortalSnapshot(
    provider: ProviderRecord,
    win: BrowserWindow,
    networkCapture: Awaited<ReturnType<typeof startNetworkJsonCapture>> | null,
): Promise<UsageSnapshot> {
    const startedAt = Date.now();
    const portalUrl = getPortalUrl(provider);
    logDeveloperEvent({
        provider,
        level: 'info',
        event: 'portal.refresh.start',
        source: 'portal',
        method: 'GET',
        url: portalUrl,
        statusCode: null,
        durationMs: null,
        message: 'Loading provider usage portal.',
        request: { url: portalUrl },
        response: null,
    });
    await win.loadURL(portalUrl);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await networkCapture?.settle().catch(() => undefined);
    const data = await extractPortalPage(win);
    const apiPayloads = networkCapture?.getPayloads() ?? [];
    const groqSpendUsd = provider.kind === 'groq' ? extractGroqSpendFromApiPayloads(apiPayloads) : null;
    const groqActivityRows = provider.kind === 'groq' ? countGroqActivityRows(apiPayloads) : 0;

    const parsed = parsePortalText(provider, data.text, data.url, {
        groqSpendUsd,
        alertCreditRemaining: provider.alertCreditRemaining,
    });
    logDeveloperEvent({
        provider,
        level: parsed.status === 'healthy' ? 'info' : 'warning',
        event: 'portal.refresh.complete',
        source: 'portal',
        method: 'GET',
        url: data.url,
        statusCode: null,
        durationMs: Date.now() - startedAt,
        message: parsed.summary,
        request: { initialUrl: portalUrl },
        response: {
            title: data.title,
            url: data.url,
            extractedTextLength: data.text.length,
            capturedApiPayloads: apiPayloads.length,
            groqActivityRows,
            groqActivitySpendUsd: groqSpendUsd,
            parsedMetrics: parsed.metrics,
        },
    });

    return snapshot({
        providerId: provider.id,
        status: parsed.status,
        summary: parsed.summary,
        metrics: parsed.metrics,
        raw: { title: data.title, url: data.url, extractedText: data.text, apiPayloads },
        spendUsd: parsed.spendUsd,
        remainingUsd: parsed.remainingUsd,
        usagePercent: parsed.usagePercent,
    });
}

function createPortalWindow(provider: ProviderRecord, hidden: boolean): BrowserWindow {
    return new BrowserWindow({
        width: 1180,
        height: 820,
        show: !hidden,
        title: `${provider.name} login`,
        webPreferences: {
            partition: `persist:provider-${provider.id}`,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
}

function getPortalUrl(provider: ProviderRecord): string {
    if (provider.kind === 'groq') return 'https://console.groq.com/dashboard/usage';
    if (provider.kind === 'opencode') return OPENCODE_AUTH_URL;
    throw new Error(`Provider ${provider.kind} does not use portal auth.`);
}

interface OpenCodeExtractedSsr {
    raw: Record<string, unknown>;
    url: string;
    title: string;
}

interface OpenCodeSsrDebug {
    url: string;
    title: string;
    ready: boolean;
    totalKeys: number;
    resolvedKeys: string[];
    pendingKeys: string[];
    htmlSnippet: string;
    viewport?: string;
}

function openCodeSsrExtractionScript(waitMs: number): string {
    return `(async function(){var max=${waitMs};var start=Date.now();var debug={url:location.href,title:document.title,ready:false,totalKeys:0,resolvedKeys:[],pendingKeys:[],htmlSnippet:(document.body&&document.body.innerText?document.body.innerText:"").slice(0,400),viewport:window.innerWidth+"x"+window.innerHeight,values:[]};function readSlot(v){if(!v)return{state:"missing"};if(v.v!==undefined)return{state:"resolved",data:v.v};if(v.p&&v.p.v!=null)return{state:"resolved",data:v.p.v};if(v.p&&typeof v.p.then==="function")return{state:"pending"};return{state:"weird"}}function take(){var r=window._$HY&&window._$HY.r;var out={};if(!r)return out;var keys=Object.keys(r);debug.totalKeys=keys.length;for(var i=0;i<keys.length;i++){var k=keys[i];var s=readSlot(r[k]);if(s.state==="resolved"){out[k]=s.data;debug.resolvedKeys.push(k);var v=s.data;var preview=typeof v==="object"?JSON.stringify(v).slice(0,120):String(v).slice(0,120);debug.values.push(preview)}else{debug.pendingKeys.push(k+":"+s.state)}}return out}while(Date.now()-start<max){var s=take();if(Object.keys(s).length>0){debug.ready=true;debug.data=s;return debug}await new Promise(function(r){setTimeout(r,100)})}take();return debug})()`;
}

async function extractOpenCodeSsr(
    win: BrowserWindow,
    waitMs: number,
): Promise<OpenCodeExtractedSsr & { debug: OpenCodeSsrDebug }> {
    const empty: OpenCodeExtractedSsr & { debug: OpenCodeSsrDebug } = {
        raw: {},
        url: '',
        title: '',
        debug: { url: '', title: '', ready: false, totalKeys: 0, resolvedKeys: [], pendingKeys: [], htmlSnippet: '' },
    };
    const result = (await win.webContents
        .executeJavaScript(openCodeSsrExtractionScript(waitMs), true)
        .catch(() => null)) as (OpenCodeSsrDebug & { data?: Record<string, unknown> }) | null;
    if (!result) return empty;
    const debug: OpenCodeSsrDebug = {
        url: typeof result.url === 'string' ? result.url : win.webContents.getURL(),
        title: typeof result.title === 'string' ? result.title : '',
        ready: result.ready === true,
        totalKeys: typeof result.totalKeys === 'number' ? result.totalKeys : 0,
        resolvedKeys: Array.isArray(result.resolvedKeys) ? result.resolvedKeys : [],
        pendingKeys: Array.isArray(result.pendingKeys) ? result.pendingKeys : [],
        htmlSnippet: typeof result.htmlSnippet === 'string' ? result.htmlSnippet : '',
        viewport: typeof result.viewport === 'string' ? result.viewport : '',
    };
    return {
        raw: result.data && typeof result.data === 'object' ? result.data : {},
        url: debug.url,
        title: debug.title,
        debug,
    };
}

function isOpenCodeLoginRequired(url: string, title: string): boolean {
    if (!url) return true;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('github.com/')) return true;
    if (lowerUrl.includes('auth.opencode.ai')) return true;
    if (/\/login|sign[-_]?in|signin|oauth|sso/.test(lowerUrl)) return true;
    if (/sign in|log in|continue with/i.test(title)) return true;
    return false;
}

function findShapeMatch<T>(values: ReadonlyArray<unknown>, matcher: (value: unknown) => T | null): T | null {
    for (const value of values) {
        const match = matcher(value);
        if (match !== null) return match;
    }
    return null;
}

function isWorkspaceRecord(value: unknown): { id: string; name: string; slug: string | null } | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.startsWith('wrk_')) return null;
    return {
        id: record.id,
        name: typeof record.name === 'string' ? record.name : record.id,
        slug: typeof record.slug === 'string' ? record.slug : null,
    };
}

function isWorkspacesArray(value: unknown): OpenCodeWorkspace[] | null {
    if (!Array.isArray(value)) return null;
    const result: OpenCodeWorkspace[] = [];
    for (const item of value) {
        const ws = isWorkspaceRecord(item);
        if (ws) result.push(ws);
    }
    return result.length > 0 ? result : null;
}

function isBillingObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.customerID !== 'string' || !record.customerID.startsWith('cus_')) return null;
    if (!('balance' in record) && !('liteSubscriptionID' in record)) return null;
    return record;
}

function isGoSubscriptionObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.mine !== 'boolean') return null;
    if (!record.rollingUsage || typeof record.rollingUsage !== 'object') return null;
    return record;
}

function isUsageItemRecord(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string' && record.id.startsWith('usg_') && typeof record.cost === 'number';
}

function isUsageArray(value: unknown): Array<Record<string, unknown>> | null {
    if (!Array.isArray(value)) return null;
    const result: Array<Record<string, unknown>> = [];
    for (const item of value) {
        if (isUsageItemRecord(item)) result.push(item as Record<string, unknown>);
    }
    return result.length > 0 ? result : null;
}

function isUserEmailString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
    return value;
}

function pickOpenCodeWorkspaceId(extracted: OpenCodeExtractedSsr): string | null {
    const values = Object.values(extracted.raw);
    const workspaces = findShapeMatch(values, isWorkspacesArray);
    if (workspaces && workspaces[0]) return workspaces[0].id;
    const match = extracted.url.match(/\/workspace\/(wrk_[A-Za-z0-9]+)/);
    return match ? match[1] : null;
}

function buildOpenCodeSsrData(go: OpenCodeExtractedSsr, workspaceId: string): OpenCodeSsrData {
    const values = Object.values(go.raw);
    const billing = findShapeMatch(values, isBillingObject);
    const goSubscription = findShapeMatch(values, isGoSubscriptionObject);
    const workspaces = findShapeMatch(values, isWorkspacesArray) ?? [];
    const usage = findShapeMatch(values, isUsageArray) ?? [];
    const userEmail = findShapeMatch(values, isUserEmailString);
    return normalizeOpenCodeSsrData({
        workspaceId,
        userEmail,
        billing,
        goSubscription,
        usage,
        workspaces,
    });
}

async function refreshOpenCodePortal(provider: ProviderRecord): Promise<UsageSnapshot> {
    const win = createPortalWindow(provider, true);
    const startedAt = Date.now();
    try {
        return await withTimeout(
            (async () => {
                logDeveloperEvent({
                    provider,
                    level: 'info',
                    event: 'opencode.refresh.start',
                    source: 'portal',
                    method: 'GET',
                    url: OPENCODE_AUTH_URL,
                    statusCode: null,
                    durationMs: null,
                    message: 'Loading OpenCode workspace portal.',
                    request: { url: OPENCODE_AUTH_URL },
                    response: null,
                });
                await win.loadURL(OPENCODE_AUTH_URL);
                const initial = await extractOpenCodeSsr(win, OPENCODE_HYDRATION_WAIT_MS);
                if (isOpenCodeLoginRequired(initial.url, initial.title)) {
                    logDeveloperEvent({
                        provider,
                        level: 'warning',
                        event: 'opencode.refresh.login-required',
                        source: 'portal',
                        method: 'GET',
                        url: initial.url || OPENCODE_AUTH_URL,
                        statusCode: null,
                        durationMs: Date.now() - startedAt,
                        message: 'OpenCode session not detected; sign in required.',
                        request: null,
                        response: { url: initial.url, title: initial.title, debug: initial.debug },
                    });
                    return snapshot({
                        providerId: provider.id,
                        status: 'needs-login',
                        summary: 'Sign in required before usage can be collected.',
                        metrics: [{ label: 'Session', value: 'Needs login', tone: 'warning' }],
                        raw: { initial },
                        spendUsd: null,
                        remainingUsd: null,
                        usagePercent: null,
                    });
                }
                const workspaceId = pickOpenCodeWorkspaceId(initial);
                if (!workspaceId) {
                    logDeveloperEvent({
                        provider,
                        level: 'warning',
                        event: 'opencode.refresh.no-workspace',
                        source: 'portal',
                        method: 'GET',
                        url: initial.url || OPENCODE_AUTH_URL,
                        statusCode: null,
                        durationMs: Date.now() - startedAt,
                        message: 'Could not find an OpenCode workspace id on the landing page.',
                        request: null,
                        response: {
                            url: initial.url,
                            title: initial.title,
                            rawKeys: Object.keys(initial.raw),
                            debug: initial.debug,
                        },
                    });
                    return snapshot({
                        providerId: provider.id,
                        status: 'warning',
                        summary: 'No OpenCode workspaces were returned by the dashboard.',
                        metrics: [{ label: 'Status', value: 'No workspace', tone: 'warning' }],
                        raw: { initial },
                    });
                }
                const goUrl = `${OPENCODE_WORKSPACE_BASE_URL}/${workspaceId}${OPENCODE_GO_PATH}`;
                await win.loadURL(goUrl);
                const go = await extractOpenCodeSsr(win, OPENCODE_HYDRATION_WAIT_MS);
                const ssr = buildOpenCodeSsrData(go, workspaceId);
                if (openCodeSsrDataIsEmpty(ssr)) {
                    logDeveloperEvent({
                        provider,
                        level: 'warning',
                        event: 'opencode.refresh.empty',
                        source: 'portal',
                        method: 'GET',
                        url: goUrl,
                        statusCode: null,
                        durationMs: Date.now() - startedAt,
                        message: 'OpenCode dashboard returned no usage payload.',
                        request: null,
                        response: {
                            url: go.url,
                            title: go.title,
                            rawKeys: Object.keys(go.raw),
                            debug: go.debug,
                        },
                    });
                    return snapshot({
                        providerId: provider.id,
                        status: 'warning',
                        summary: 'OpenCode dashboard returned no usage payload.',
                        metrics: [{ label: 'Status', value: 'No data', tone: 'warning' }],
                        raw: { initial, go, ssr },
                    });
                }
                const parsed = parseOpenCodeSsrData(ssr, { alertCreditRemaining: provider.alertCreditRemaining });
                logDeveloperEvent({
                    provider,
                    level: parsed.status === 'healthy' ? 'info' : 'warning',
                    event: 'opencode.refresh.complete',
                    source: 'portal',
                    method: 'GET',
                    url: goUrl,
                    statusCode: null,
                    durationMs: Date.now() - startedAt,
                    message: parsed.summary,
                    request: { workspaceId, goUrl },
                    response: {
                        billingBalance: ssr.billing?.balance ?? null,
                        goMine: ssr.goSubscription?.mine ?? null,
                        rollingUsagePercent: ssr.goSubscription?.rollingUsage.usagePercent ?? null,
                        weeklyUsagePercent: ssr.goSubscription?.weeklyUsage.usagePercent ?? null,
                        monthlyUsagePercent: ssr.goSubscription?.monthlyUsage.usagePercent ?? null,
                        usageItems: ssr.usage.length,
                        parsedMetrics: parsed.metrics,
                    },
                });
                return snapshot({
                    providerId: provider.id,
                    status: parsed.status,
                    summary: parsed.summary,
                    metrics: parsed.metrics,
                    raw: { initial, go, ssr },
                    spendUsd: parsed.spendUsd,
                    remainingUsd: parsed.remainingUsd,
                    usagePercent: parsed.usagePercent,
                });
            })(),
            45_000,
            () => 'OpenCode refresh timed out after 45 seconds. Try again, or reconnect the portal session.',
        );
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

export function parsePortalText(
    provider: Pick<ProviderRecord, 'id' | 'kind'>,
    text: string,
    url = '',
    options: { groqSpendUsd?: number | null; alertCreditRemaining?: number | null } = {},
): {
    status: 'healthy' | 'warning' | 'needs-login';
    summary: string;
    metrics: UsageMetric[];
    spendUsd: number | null;
    remainingUsd: number | null;
    usagePercent: number | null;
} {
    if (isPortalLoginRequired(provider, url, text)) {
        return {
            status: 'needs-login',
            summary: 'Sign in required before usage can be collected.',
            metrics: [{ label: 'Session', value: 'Needs login', tone: 'warning' }],
            spendUsd: null,
            remainingUsd: null,
            usagePercent: null,
        };
    }

    const money = parseMoneyValues(text);
    const percents = parsePercentValues(text);
    const lower = text.toLowerCase();
    const usagePercent =
        percents.find((value) => {
            const needle = `${value}%`;
            const index = lower.indexOf(needle);
            const context = index >= 0 ? lower.slice(Math.max(0, index - 80), index + 80) : '';
            return /usage|used|remaining|limit|quota|spend/.test(context);
        }) ?? null;

    if (provider.kind === 'opencode') {
        return parseOpenCodeDashboard(lower, options.alertCreditRemaining ?? null);
    }

    if (provider.kind === 'groq') {
        const spend = options.groqSpendUsd ?? money[0] ?? null;
        return {
            status: 'healthy',
            summary: spend == null ? 'Groq usage collected from console.' : `${formatUsdPrecise(spend)} current spend`,
            metrics: [
                {
                    ...formatUsageUsdMetric(spend, 'Current spend'),
                    tooltip: spend == null ? undefined : formatUsdPrecise(spend),
                    emphasis: spend != null && spend < 0.01 ? 'dotted' : undefined,
                },
            ],
            spendUsd: spend,
            remainingUsd: null,
            usagePercent: usagePercent,
        };
    }

    const remainingPercent = findContextualPercent(lower, 'remaining') ?? null;
    const usedPercent = findContextualPercent(lower, 'used') ?? (remainingPercent == null ? usagePercent : null);
    const percent = usedPercent ?? (remainingPercent == null ? null : 100 - remainingPercent);
    const codexMetrics = parseCodexQuotaMetrics(lower);
    return {
        status: percent != null && percent >= 85 ? 'warning' : 'healthy',
        summary:
            codexMetrics.length === 0 && remainingPercent == null
                ? 'Codex usage collected from dashboard.'
                : codexMetrics.length > 0
                  ? 'Codex quota usage collected'
                  : `${remainingPercent?.toFixed(0)}% Codex quota remaining`,
        metrics:
            codexMetrics.length > 0
                ? codexMetrics
                : [
                      {
                          label: 'Remaining',
                          value: remainingPercent == null ? 'n/a' : `${remainingPercent.toFixed(1)}%`,
                          tone: 'good',
                      },
                      { label: 'Used', value: percent == null ? 'n/a' : `${percent.toFixed(1)}%` },
                  ],
        spendUsd: null,
        remainingUsd: null,
        usagePercent: percent,
    };
}

function parseOpenCodeDashboard(
    text: string,
    alertCreditRemaining: number | null,
): {
    status: 'healthy' | 'warning';
    summary: string;
    metrics: UsageMetric[];
    spendUsd: number | null;
    remainingUsd: number | null;
    usagePercent: number | null;
} {
    const balance = findContextualMoney(text, 'balance') ?? findContextualMoney(text, 'credit');
    const spend = findContextualMoney(text, 'spend') ?? findContextualMoney(text, 'spent');
    const debit = findContextualMoney(text, 'debit') ?? findContextualMoney(text, 'usage');
    const fiveHour =
        findPercentAfterPhrase(text, '5-hour') ??
        findPercentAfterPhrase(text, '5 hour') ??
        findPercentAfterPhrase(text, '5h');
    const weekly = findPercentAfterPhrase(text, 'weekly') ?? findPercentAfterPhrase(text, 'week');
    const monthly = findPercentAfterPhrase(text, 'monthly') ?? findPercentAfterPhrase(text, 'month');

    const metrics: UsageMetric[] = [];
    if (balance != null) {
        const danger = alertCreditRemaining != null && balance <= alertCreditRemaining;
        metrics.push(formatUsageUsdMetric(balance, 'Zen balance', danger ? 'warning' : 'good'));
    }
    if (spend != null) metrics.push(formatUsageUsdMetric(spend, 'Zen spend', 'neutral'));
    if (debit != null) metrics.push(formatUsageUsdMetric(debit, 'Zen debit', 'neutral'));
    if (fiveHour != null)
        metrics.push({
            label: 'Go 5-hour remaining',
            value: `${fiveHour.toFixed(1)}%`,
            tone: fiveHour <= 15 ? 'warning' : 'good',
        });
    if (weekly != null)
        metrics.push({
            label: 'Go weekly remaining',
            value: `${weekly.toFixed(1)}%`,
            tone: weekly <= 15 ? 'warning' : 'good',
        });
    if (monthly != null)
        metrics.push({
            label: 'Go monthly remaining',
            value: `${monthly.toFixed(1)}%`,
            tone: monthly <= 15 ? 'warning' : 'good',
        });

    const quotas = [fiveHour, weekly, monthly].filter((value): value is number => value != null);
    const lowestQuota = quotas.length ? Math.min(...quotas) : null;
    const balanceDanger = balance != null && alertCreditRemaining != null && balance <= alertCreditRemaining;
    const quotaWarning = lowestQuota != null && lowestQuota <= 15;
    const status: 'healthy' | 'warning' = balanceDanger || quotaWarning ? 'warning' : 'healthy';

    const summaryParts: string[] = [];
    if (balance != null) summaryParts.push(`${formatUsdPrecise(balance)} Zen balance`);
    if (spend != null) summaryParts.push(`${formatUsdPrecise(spend)} Zen spend`);
    if (lowestQuota != null) summaryParts.push(`${lowestQuota.toFixed(0)}% lowest Go quota remaining`);
    const summary = summaryParts.length ? summaryParts.join(' · ') : 'OpenCode usage collected';

    return {
        status,
        summary,
        metrics: metrics.length ? metrics : [{ label: 'Usage', value: 'No data found', tone: 'neutral' }],
        spendUsd: spend ?? debit ?? null,
        remainingUsd: balance ?? null,
        usagePercent: lowestQuota != null ? Math.max(0, Math.min(100, 100 - lowestQuota)) : null,
    };
}

function findContextualMoney(text: string, word: string): number | undefined {
    let from = 0;
    while (true) {
        const phraseIndex = text.indexOf(word, from);
        if (phraseIndex < 0) return undefined;
        const window = text.slice(phraseIndex, phraseIndex + 80);
        const match = window.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/);
        if (match) {
            const value = Number(match[1].replaceAll(',', ''));
            if (Number.isFinite(value)) return value;
        }
        from = phraseIndex + word.length;
    }
}

function parseCodexQuotaMetrics(text: string): UsageMetric[] {
    const metrics: UsageMetric[] = [];
    const fiveHourRemaining =
        findPercentAfterPhrase(text, '5-hour') ??
        findPercentAfterPhrase(text, '5 hour') ??
        findPercentAfterPhrase(text, '5h');
    const weeklyRemaining = findPercentAfterPhrase(text, 'weekly') ?? findPercentAfterPhrase(text, 'week');

    if (fiveHourRemaining != null) {
        metrics.push({
            label: '5-hour remaining',
            value: `${fiveHourRemaining.toFixed(1)}%`,
            tone: fiveHourRemaining <= 15 ? 'warning' : 'good',
        });
    }

    if (weeklyRemaining != null) {
        metrics.push({
            label: 'Weekly remaining',
            value: `${weeklyRemaining.toFixed(1)}%`,
            tone: weeklyRemaining <= 15 ? 'warning' : 'good',
        });
    }

    return metrics;
}

interface ParsedCodexResetCredit {
    id: string;
    title: string;
    status: string;
    expiresAt: string | null;
    expiresAtMs: number | null;
}

interface ParsedCodexResetCredits {
    availableCount: number;
    availableCredits: ParsedCodexResetCredit[];
    nextExpiring: ParsedCodexResetCredit | null;
}

export function parseCodexUsagePayload(
    payload: unknown,
    resetCreditsPayload?: unknown,
    options: { creditExpiryWarningDays?: number; now?: number } = {},
): {
    status: 'healthy' | 'warning';
    summary: string;
    metrics: UsageMetric[];
    usagePercent: number | null;
} {
    const windows = extractCodexRateLimitWindows(payload);
    const metrics: UsageMetric[] = windows.map((window) => {
        const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
        return {
            label: `${window.label} remaining`,
            value: `${remaining.toFixed(1)}%`,
            tone: remaining <= 15 ? ('warning' as const) : ('good' as const),
            tooltip: window.resetsAt ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString()}` : undefined,
        };
    });

    const resetCredits = parseCodexResetCreditsPayload(resetCreditsPayload);
    if (resetCredits) {
        metrics.push(...formatCodexResetCreditMetrics(resetCredits, options));
    }

    const lowestRemaining = windows.length ? Math.min(...windows.map((window) => 100 - window.usedPercent)) : null;
    const creditWarning = isCodexResetCreditExpiringSoon(resetCredits, options);
    return {
        status: (lowestRemaining != null && lowestRemaining <= 15) || creditWarning ? 'warning' : 'healthy',
        summary: formatCodexSummary(windows.length > 0, resetCredits, options),
        metrics: metrics.length ? metrics : [{ label: 'Usage', value: 'No quota data', tone: 'neutral' }],
        usagePercent: windows[0]?.usedPercent ?? null,
    };
}

function parseCodexResetCreditsPayload(payload: unknown): ParsedCodexResetCredits | null {
    if (payload == null) return null;
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const rawCredits = Array.isArray(body.credits) ? body.credits : [];
    const credits = rawCredits
        .map((item) => {
            const credit = readObject(item);
            const status = readString(readAny(credit, ['status'])) ?? 'unknown';
            const expiresAt = readString(readAny(credit, ['expires_at', 'expiresAt']));
            const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
            return {
                id: readString(readAny(credit, ['id'])) ?? '',
                title: readString(readAny(credit, ['title'])) ?? 'Rate limit reset',
                status,
                expiresAt,
                expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
            };
        })
        .filter((credit) => credit.status === 'available');
    const availableCount = readNumber(readAny(body, ['available_count', 'availableCount'])) ?? credits.length;
    const expiring = credits
        .filter((credit) => credit.expiresAtMs != null)
        .sort((a, b) => (a.expiresAtMs ?? 0) - (b.expiresAtMs ?? 0));

    return {
        availableCount,
        availableCredits: expiring,
        nextExpiring: expiring[0] ?? null,
    };
}

function formatCodexResetCreditMetrics(
    resetCredits: ParsedCodexResetCredits,
    options: { creditExpiryWarningDays?: number; now?: number },
): UsageMetric[] {
    const expiry = resetCredits.nextExpiring;
    const metrics: UsageMetric[] = [
        {
            label: 'Reset credits',
            value: String(resetCredits.availableCount),
            tone: resetCredits.availableCount > 0 ? 'good' : 'neutral',
            tooltip: formatCodexResetCreditsTooltip(resetCredits, options.now),
        },
    ];
    if (expiry?.expiresAtMs != null) {
        const expiringSoon = isCodexResetCreditExpiringSoon(resetCredits, options);
        metrics.push({
            label: 'Next credit expiry',
            value: formatCodexCreditExpiry(expiry.expiresAtMs, options.now),
            tone: expiringSoon ? 'warning' : 'neutral',
            tooltip: `Expires ${new Date(expiry.expiresAtMs).toLocaleString()}`,
        });
    }
    return metrics;
}

function formatCodexResetCreditsTooltip(resetCredits: ParsedCodexResetCredits, now = Date.now()): string | undefined {
    if (resetCredits.availableCount <= 0) return undefined;
    if (!resetCredits.availableCredits.length) return `${resetCredits.availableCount} available`;
    return `${resetCredits.availableCount} available: ${resetCredits.availableCredits
        .map((credit) => formatCodexCreditExpiryDetail(credit.expiresAtMs, now))
        .join(', ')}`;
}

function formatCodexSummary(
    hasMetrics: boolean,
    resetCredits: ParsedCodexResetCredits | null,
    options: { creditExpiryWarningDays?: number; now?: number },
): string {
    const quota = hasMetrics ? 'Codex quota usage collected' : 'Codex usage API returned no displayable quota windows.';
    if (!resetCredits) return quota;
    if (resetCredits.availableCount <= 0) return `${quota}; no reset credits available`;
    const expiry = resetCredits.nextExpiring?.expiresAtMs;
    if (expiry == null) return `${quota}; ${resetCredits.availableCount} reset credits available`;
    const prefix = isCodexResetCreditExpiringSoon(resetCredits, options) ? 'reset credit expires' : 'next reset credit';
    return `${quota}; ${resetCredits.availableCount} reset credits available, ${prefix} ${formatCodexCreditExpiry(
        expiry,
        options.now,
    )}`;
}

function isCodexResetCreditExpiringSoon(
    resetCredits: ParsedCodexResetCredits | null,
    options: { creditExpiryWarningDays?: number; now?: number },
): boolean {
    const expiry = resetCredits?.nextExpiring?.expiresAtMs;
    if (expiry == null || (resetCredits?.availableCount ?? 0) <= 0) return false;
    const thresholdDays = Math.max(0, options.creditExpiryWarningDays ?? 7);
    return expiry - (options.now ?? Date.now()) <= thresholdDays * 86_400_000;
}

function formatCodexCreditExpiry(expiresAtMs: number, now = Date.now()): string {
    const deltaMs = expiresAtMs - now;
    if (deltaMs <= 0) return 'now';
    const hours = Math.ceil(deltaMs / 3_600_000);
    if (hours < 24) return `in ${hours}h`;
    const days = Math.ceil(deltaMs / 86_400_000);
    return `in ${days}d`;
}

function formatCodexCreditExpiryDetail(expiresAtMs: number | null, now = Date.now()): string {
    if (expiresAtMs == null) return 'expiry unknown';
    const relative = formatCodexCreditExpiry(expiresAtMs, now).replace(/(\d+)d$/, (_match, days: string) =>
        Number(days) === 1 ? '1 day' : `${days} days`,
    );
    const date = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(new Date(expiresAtMs));
    return `${relative} (${date})`;
}

function extractCodexRateLimitWindows(
    payload: unknown,
): Array<{ label: string; usedPercent: number; resetsAt: number | null }> {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const rateLimit = readObject(readAny(body, ['rate_limit', 'rateLimit']));
    const windows: Array<{ label: string; usedPercent: number; resetsAt: number | null }> = [];

    const primary = readObject(readAny(rateLimit, ['primary_window', 'primaryWindow', 'primary']));
    const secondary = readObject(readAny(rateLimit, ['secondary_window', 'secondaryWindow', 'secondary']));
    const primaryWindow = parseCodexWindow(primary, '5-hour');
    const secondaryWindow = parseCodexWindow(secondary, 'Weekly');
    if (primaryWindow) windows.push(primaryWindow);
    if (secondaryWindow) windows.push(secondaryWindow);

    const additional = readAny(body, ['additional_rate_limits', 'additionalRateLimits']);
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
): { label: string; usedPercent: number; resetsAt: number | null } | null {
    const usedPercent = readNumber(readAny(window, ['used_percent', 'usedPercent']));
    if (usedPercent == null || usedPercent < 0 || usedPercent > 100) return null;
    const minutes = readNumber(readAny(window, ['window_minutes', 'windowMinutes']));
    return {
        label: formatCodexWindowLabel(minutes, fallbackLabel),
        usedPercent,
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

function findPercentAfterPhrase(text: string, phrase: string): number | undefined {
    const phraseIndex = text.indexOf(phrase);
    if (phraseIndex < 0) return undefined;
    const context = text.slice(phraseIndex, phraseIndex + 120);
    const match = context.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s?%/);
    if (!match) return undefined;
    const value = Number(match[1]);
    return value >= 0 && value <= 100 ? value : undefined;
}

export function isPortalLoginRequired(provider: Pick<ProviderRecord, 'kind'>, url: string, text: string): boolean {
    const lowerUrl = url.toLowerCase();
    const lowerText = text.toLowerCase();
    const loginWords = /log in|login|sign in|signin|continue with|authenticate/;

    if (!url) return loginWords.test(lowerText) && text.length < 5000;

    if (provider.kind === 'groq') {
        const onGroqConsole = lowerUrl.includes('console.groq.com');
        const onAuthRoute = /\/login|sign-in|signin|auth|oauth|sso/.test(lowerUrl);
        const hasAppContent = /usage|billing|spend|limit|console|dashboard|api keys|projects/.test(lowerText);
        if (!onGroqConsole || onAuthRoute) return true;
        return loginWords.test(lowerText) && !hasAppContent && text.length < 8000;
    }

    if (provider.kind === 'codex') {
        const onChatGpt = lowerUrl.includes('chatgpt.com') || lowerUrl.includes('chat.openai.com');
        const onAuthRoute = /\/login|sign-in|signin|auth|oauth/.test(lowerUrl);
        const hasAppContent = /codex|usage|remaining|limit|workspace|settings/.test(lowerText);
        if (!onChatGpt || onAuthRoute) return true;
        return loginWords.test(lowerText) && !hasAppContent && text.length < 8000;
    }

    if (provider.kind === 'opencode') {
        const onOpenCode = lowerUrl.includes('opencode.ai');
        const onAuthRoute = /\/login|sign-in|signin|auth|oauth|sso/.test(lowerUrl);
        const hasAppContent = /usage|balance|credit|quota|spend|remaining|limit|dashboard|account|zen|go/.test(
            lowerText,
        );
        if (!onOpenCode || onAuthRoute) return true;
        return loginWords.test(lowerText) && !hasAppContent && text.length < 8000;
    }

    return false;
}

async function extractPortalPage(win: BrowserWindow): Promise<{ title: string; url: string; text: string }> {
    return win.webContents.executeJavaScript(`
    (() => {
      const text = document.body?.innerText || "";
      const title = document.title || "";
      const url = location.href;
      return { title, url, text: text.slice(0, 50000) };
    })()
  `);
}

interface CapturedJsonPayload {
    url: string;
    payload: unknown;
}

interface PortalNetworkCapture {
    getPayloads: () => CapturedJsonPayload[];
    settle: () => Promise<void>;
    stop: () => void;
}

async function startNetworkJsonCapture(win: BrowserWindow, provider: ProviderRecord): Promise<PortalNetworkCapture> {
    const startedAt = Date.now();
    logDeveloperEvent({
        provider,
        level: 'info',
        event: 'portal.network-capture.start',
        source: 'portal',
        method: null,
        url: getPortalUrl(provider),
        statusCode: null,
        durationMs: null,
        message: 'Attaching Chromium network debugger.',
        request: null,
        response: null,
    });
    const payloads: CapturedJsonPayload[] = [];
    const replayCapture = startGroqApiReplayCapture(win, provider, payloads);
    const requests = new Map<
        string,
        {
            url: string;
            method: string;
            mimeType: string;
            resourceType: string;
            startedAt: number;
            request: unknown;
            statusCode: number | null;
        }
    >();
    const dbg = win.webContents.debugger;

    try {
        if (!dbg.isAttached()) dbg.attach('1.3');
        await withTimeout(
            dbg.sendCommand('Network.enable'),
            PORTAL_DEBUGGER_TIMEOUT_MS,
            () => 'Portal network capture setup timed out; continuing with page scraping.',
        );
        logDeveloperEvent({
            provider,
            level: 'info',
            event: 'portal.network-capture.ready',
            source: 'portal',
            method: null,
            url: getPortalUrl(provider),
            statusCode: null,
            durationMs: Date.now() - startedAt,
            message: 'Chromium network debugger attached.',
            request: null,
            response: null,
        });
    } catch (error) {
        if (dbg.isAttached()) {
            try {
                dbg.detach();
            } catch {
                // Ignore debugger cleanup races when capture setup times out.
            }
        }
        logDeveloperEvent({
            provider,
            level: 'warning',
            event:
                error instanceof RefreshTimeoutError
                    ? 'portal.network-capture.skipped'
                    : 'portal.network-capture.unavailable',
            source: 'portal',
            method: null,
            url: getPortalUrl(provider),
            statusCode: null,
            durationMs: Date.now() - startedAt,
            message:
                error instanceof Error
                    ? error.message
                    : 'Network capture could not be attached. Continuing with page scraping.',
            request: null,
            response: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
            },
        });
        return {
            getPayloads: () => payloads,
            settle: replayCapture.settle,
            stop: replayCapture.stop,
        };
    }

    const onMessage = async (_event: Electron.Event, method: string, params: any): Promise<void> => {
        if (method === 'Network.requestWillBeSent') {
            requests.set(params.requestId, {
                url: params.request?.url ?? '',
                method: params.request?.method ?? 'GET',
                mimeType: '',
                resourceType: params.type ?? '',
                startedAt: Date.now(),
                statusCode: null,
                request: {
                    headers: params.request?.headers ?? null,
                    postData: params.request?.postData ?? null,
                },
            });
        }

        if (method === 'Network.responseReceived') {
            const current = requests.get(params.requestId);
            requests.set(params.requestId, {
                ...current,
                url: params.response?.url ?? '',
                method: current?.method ?? 'GET',
                startedAt: current?.startedAt ?? Date.now(),
                request: current?.request ?? null,
                resourceType: current?.resourceType ?? params.type ?? '',
                statusCode: params.response?.status ?? null,
                mimeType: params.response?.mimeType ?? '',
            });
        }

        if (method === 'Network.loadingFinished') {
            const meta = requests.get(params.requestId);
            if (!meta) return;
            if (!shouldLogCapturedPortalResponse(provider, meta)) return;
            let responseBody: unknown = null;
            let level: DeveloperLogEntry['level'] = 'info';
            let message = 'Portal API response captured.';
            try {
                const body = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
                const text = body?.base64Encoded
                    ? Buffer.from(String(body.body), 'base64').toString('utf8')
                    : String(body?.body ?? '');
                if (!text) {
                    responseBody = null;
                } else {
                    responseBody = JSON.parse(text);
                    payloads.push({ url: meta.url, payload: responseBody });
                }
            } catch (error) {
                level = 'debug';
                message = error instanceof Error ? error.message : 'Portal API response body could not be captured.';
            } finally {
                logDeveloperEvent({
                    provider,
                    level,
                    event: 'portal.api.response',
                    source: 'portal',
                    method: meta.method,
                    url: meta.url,
                    statusCode: meta.statusCode,
                    durationMs: Date.now() - meta.startedAt,
                    message,
                    request: meta.request,
                    response: responseBody,
                });
                requests.delete(params.requestId);
            }
        }
    };

    dbg.on('message', onMessage);

    return {
        getPayloads: () => payloads,
        settle: replayCapture.settle,
        stop: () => {
            replayCapture.stop();
            dbg.off('message', onMessage);
            if (dbg.isAttached()) {
                try {
                    dbg.detach();
                } catch {
                    // Ignore debugger cleanup races during window teardown.
                }
            }
        },
    };
}

function startGroqApiReplayCapture(
    win: BrowserWindow,
    provider: ProviderRecord,
    payloads: CapturedJsonPayload[],
): Pick<PortalNetworkCapture, 'settle' | 'stop'> {
    const providerSession = win.webContents.session;
    const filter = { urls: ['https://*.groq.com/*', 'https://groq.com/*'] };
    const requests = new Map<
        string,
        {
            url: string;
            method: string;
            resourceType: string;
            startedAt: number;
            requestHeaders: Record<string, string>;
            body: string | null;
        }
    >();
    const replayed = new Set<string>();
    const pending = new Set<Promise<void>>();
    let activityDetected = false;
    let activitySettled = false;
    let resolveActivitySettled: () => void = () => undefined;
    const activitySettledPromise = new Promise<void>((resolve) => {
        resolveActivitySettled = resolve;
    });

    const onBeforeRequest = (details: any, callback: (response: Record<string, unknown>) => void): void => {
        const body = extractUploadBody(details.uploadData);
        requests.set(details.id, {
            url: details.url,
            method: details.method ?? 'GET',
            resourceType: details.resourceType ?? '',
            startedAt: Date.now(),
            requestHeaders: {},
            body,
        });
        callback({});
    };

    const onBeforeSendHeaders = (
        details: any,
        callback: (response: { requestHeaders?: Record<string, string> }) => void,
    ): void => {
        const current = requests.get(details.id);
        if (current) {
            current.requestHeaders = normalizeHeaders(details.requestHeaders ?? {});
        }
        callback({ requestHeaders: details.requestHeaders });
    };

    const onCompleted = (details: any): void => {
        const current = requests.get(details.id);
        requests.delete(details.id);
        if (!current || !shouldReplayGroqRequest(current)) return;
        activityDetected = true;
        const replayKey = `${current.method} ${current.url} ${current.body ?? ''}`;
        if (replayed.has(replayKey)) return;
        replayed.add(replayKey);

        logDeveloperEvent({
            provider,
            level: 'debug',
            event: 'groq.activity.detected',
            source: 'portal',
            method: current.method,
            url: current.url,
            statusCode: details.statusCode ?? null,
            durationMs: Date.now() - current.startedAt,
            message: 'Detected Groq organization activity request; replaying to capture response body.',
            request: {
                resourceType: current.resourceType,
                headers: current.requestHeaders,
                body: current.body,
            },
            response: null,
        });

        const replay = replayGroqApiRequest(provider, providerSession, current, payloads);
        pending.add(replay);
        replay
            .finally(() => {
                pending.delete(replay);
                activitySettled = true;
                resolveActivitySettled();
            })
            .catch(() => undefined);
    };

    providerSession.webRequest.onBeforeRequest(filter, onBeforeRequest);
    providerSession.webRequest.onBeforeSendHeaders(filter, onBeforeSendHeaders);
    providerSession.webRequest.onCompleted(filter, onCompleted);

    logDeveloperEvent({
        provider,
        level: 'info',
        event: 'groq.api-replay.ready',
        source: 'portal',
        method: null,
        url: getPortalUrl(provider),
        statusCode: null,
        durationMs: null,
        message: 'Watching Groq console organization activity requests for replay capture.',
        request: null,
        response: null,
    });

    return {
        settle: async () => {
            await Promise.race([
                activitySettledPromise,
                new Promise((resolve) => setTimeout(resolve, GROQ_ACTIVITY_WAIT_MS)),
            ]);
            await Promise.allSettled([...pending]);
            if (!activityDetected) {
                logDeveloperEvent({
                    provider,
                    level: 'warning',
                    event: 'groq.activity.not-detected',
                    source: 'portal',
                    method: 'GET',
                    url: 'https://api.groq.com/platform/v1/organizations/{organization_id}/activity',
                    statusCode: null,
                    durationMs: GROQ_ACTIVITY_WAIT_MS,
                    message: 'No Groq organization activity request was observed while loading the usage page.',
                    request: null,
                    response: null,
                });
            } else if (!activitySettled) {
                logDeveloperEvent({
                    provider,
                    level: 'warning',
                    event: 'groq.activity.not-captured',
                    source: 'portal',
                    method: 'GET',
                    url: 'https://api.groq.com/platform/v1/organizations/{organization_id}/activity',
                    statusCode: null,
                    durationMs: GROQ_ACTIVITY_WAIT_MS,
                    message:
                        'Groq organization activity request was observed but its replay response was not captured before timeout.',
                    request: null,
                    response: null,
                });
            }
        },
        stop: () => {
            providerSession.webRequest.onBeforeRequest(filter, null);
            providerSession.webRequest.onBeforeSendHeaders(filter, null);
            providerSession.webRequest.onCompleted(filter, null);
        },
    };
}

async function replayGroqApiRequest(
    provider: ProviderRecord,
    providerSession: Electron.Session,
    request: {
        url: string;
        method: string;
        startedAt: number;
        requestHeaders: Record<string, string>;
        body: string | null;
    },
    payloads: CapturedJsonPayload[],
): Promise<void> {
    const startedAt = Date.now();
    try {
        const headers = await buildReplayHeaders(providerSession, request.url, request.requestHeaders);
        const res = await fetch(request.url, {
            method: request.method,
            headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        });
        const text = await res.text().catch(() => '');
        const parsed = parseResponseText(text);
        if (parsed != null) payloads.push({ url: request.url, payload: parsed });

        logDeveloperEvent({
            provider,
            level: res.ok ? 'info' : 'warning',
            event: 'groq.activity.response',
            source: 'portal',
            method: request.method,
            url: request.url,
            statusCode: res.status,
            durationMs: Date.now() - startedAt,
            message: 'Captured Groq organization activity response body by replaying the console request.',
            request: {
                headers,
                body: request.body,
            },
            response: {
                spendUsd: sumGroqActivityCosts(parsed),
                body: parsed ?? text.slice(0, 6000),
            },
        });
    } catch (error) {
        logDeveloperEvent({
            provider,
            level: 'warning',
            event: 'groq.activity.replay-failed',
            source: 'portal',
            method: request.method,
            url: request.url,
            statusCode: null,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : 'Groq API replay failed.',
            request: {
                headers: request.requestHeaders,
                body: request.body,
            },
            response: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
            },
        });
    }
}

function shouldReplayGroqRequest(request: {
    url: string;
    method: string;
    resourceType: string;
    body: string | null;
    requestHeaders: Record<string, string>;
}): boolean {
    if (request.method.toUpperCase() !== 'GET') return false;
    return isGroqActivityUrl(request.url);
}

function shouldLogCapturedPortalResponse(
    provider: ProviderRecord,
    response: { url: string; mimeType: string; resourceType: string; method: string },
): boolean {
    if (!response.url || !response.method) return false;
    if (provider.kind === 'groq') return isGroqActivityUrl(response.url);
    if (isStaticOrDocumentUrl(response.url)) return false;

    const resourceType = response.resourceType.toLowerCase();
    const looksLikeFetch = resourceType === 'xhr' || resourceType === 'fetch';
    const looksLikeApi = /json|graphql|\/api\/|\/v[0-9]\//i.test(`${response.mimeType} ${response.url}`);
    return looksLikeFetch && looksLikeApi;
}

function isStaticOrDocumentUrl(url: string): boolean {
    if (/\.(html?|js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|$)/i.test(url)) return true;
    if (/\/dashboard\/usage(?:\?|$)/i.test(url)) return true;
    return false;
}

async function buildReplayHeaders(
    providerSession: Electron.Session,
    url: string,
    capturedHeaders: Record<string, string>,
): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(capturedHeaders)) {
        const lower = key.toLowerCase();
        if (
            [
                'host',
                'content-length',
                'accept-encoding',
                'connection',
                'origin',
                'referer',
                'sec-fetch-dest',
                'sec-fetch-mode',
                'sec-fetch-site',
                'sec-fetch-user',
            ].includes(lower)
        ) {
            continue;
        }
        headers[key] = value;
    }

    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'cookie')) {
        const cookies = await providerSession.cookies.get({ url }).catch(() => []);
        if (cookies.length) headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    }

    return headers;
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function extractUploadBody(uploadData: Array<{ bytes?: Buffer } | undefined> | undefined): string | null {
    if (!uploadData?.length) return null;
    const chunks = uploadData.map((item) => item?.bytes).filter((value): value is Buffer => Buffer.isBuffer(value));
    if (!chunks.length) return null;
    return Buffer.concat(chunks).toString('utf8');
}

function parseResponseText(text: string): unknown {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export function extractGroqSpendFromApiPayloads(payloads: unknown[]): number | null {
    const activitySpend = extractGroqActivitySpendFromApiPayloads(payloads);
    if (activitySpend != null) return activitySpend;

    const candidates: Array<{ value: number; score: number }> = [];

    for (const item of payloads) {
        const payload = isCapturedJsonPayload(item) ? item.payload : item;
        const url = isCapturedJsonPayload(item) ? item.url.toLowerCase() : '';
        walkPayload(payload, [], (path, value) => {
            const joined = path.join('.').toLowerCase();
            const numberValue = typeof value === 'number' ? value : parseNumericString(value);
            if (numberValue == null || numberValue < 0 || !Number.isFinite(numberValue)) return;

            let score = 0;
            if (/billing|usage|spend|cost/.test(url)) score += 5;
            if (/spend|spent/.test(joined)) score += 12;
            if (/cost|charge|billing/.test(joined)) score += 9;
            if (/amount|total/.test(joined)) score += 5;
            if (/usd|dollar|currency/.test(joined)) score += 6;
            if (/current|month|period|usage/.test(joined)) score += 4;
            if (/limit|quota|max|threshold|remaining|balance|credit/.test(joined)) score -= 100;
            if (/token|request|count|rate|latency/.test(joined)) score -= 20;

            if (score > 0) candidates.push({ value: numberValue, score });
        });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || b.value - a.value);
    return candidates[0].value;
}

export function extractGroqActivitySpendFromApiPayloads(payloads: unknown[]): number | null {
    let total = 0;
    let found = false;

    for (const item of payloads) {
        const payload = isCapturedJsonPayload(item) ? item.payload : item;
        const url = isCapturedJsonPayload(item) ? item.url : '';
        if (url && !isGroqActivityUrl(url)) continue;
        const spend = sumGroqActivityCosts(payload);
        if (spend == null) continue;
        total += spend;
        found = true;
    }

    return found ? total : null;
}

function countGroqActivityRows(payloads: unknown[]): number {
    return payloads.reduce<number>((total, item) => {
        const payload = isCapturedJsonPayload(item) ? item.payload : item;
        const url = isCapturedJsonPayload(item) ? item.url : '';
        if (url && !isGroqActivityUrl(url)) return total;
        return (
            total +
            (Array.isArray((payload as { data?: unknown })?.data) ? (payload as { data: unknown[] }).data.length : 0)
        );
    }, 0);
}

function sumGroqActivityCosts(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') return null;
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) return null;

    let total = 0;
    let found = false;
    for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const cost = (item as { cost?: unknown }).cost;
        const numericCost = typeof cost === 'number' ? cost : parseNumericString(cost);
        if (numericCost == null || !Number.isFinite(numericCost)) continue;
        total += numericCost;
        found = true;
    }
    return found ? total : null;
}

function isGroqActivityUrl(url: string): boolean {
    return GROQ_ACTIVITY_URL_PATTERN.test(url);
}

function isCapturedJsonPayload(value: unknown): value is CapturedJsonPayload {
    return Boolean(
        value &&
        typeof value === 'object' &&
        'url' in value &&
        'payload' in value &&
        typeof (value as CapturedJsonPayload).url === 'string',
    );
}

function walkPayload(value: unknown, path: string[], visit: (path: string[], value: unknown) => void): void {
    if (value == null) return;
    if (typeof value === 'number' || typeof value === 'string') {
        visit(path, value);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => walkPayload(item, [...path, String(index)], visit));
        return;
    }
    if (typeof value === 'object') {
        Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
            walkPayload(item, [...path, key], visit),
        );
    }
}

function parseNumericString(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const money = value.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    if (!money) return null;
    return Number(money[1].replaceAll(',', ''));
}

function findContextualPercent(text: string, word: string): number | undefined {
    const regex = /([0-9]{1,3}(?:\.[0-9]+)?)\s?%/g;
    for (const match of text.matchAll(regex)) {
        const value = Number(match[1]);
        const index = match.index ?? 0;
        const context = text.slice(Math.max(0, index - 80), index + 80);
        if (context.includes(word) && value >= 0 && value <= 100) return value;
    }
    return undefined;
}

function sumOpenAiCosts(body: any): number {
    return Number(
        body.data?.reduce((total: number, bucket: any) => {
            return (
                total +
                (bucket.results ?? []).reduce(
                    (bucketTotal: number, result: any) => bucketTotal + Number(result.amount?.value ?? 0),
                    0,
                )
            );
        }, 0) ?? 0,
    );
}

async function fetchJson(provider: ProviderRecord, url: string, init: RequestInit, label: string): Promise<any> {
    const startedAt = Date.now();
    logDeveloperEvent({
        provider,
        level: 'info',
        event: 'api.request',
        source: 'api',
        method: init.method ?? 'GET',
        url,
        statusCode: null,
        durationMs: null,
        message: label,
        request: {
            headers: init.headers ?? null,
            body: init.body ?? null,
        },
        response: null,
    });

    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (error) {
        logDeveloperEvent({
            provider,
            level: 'error',
            event: 'api.error',
            source: 'api',
            method: init.method ?? 'GET',
            url,
            statusCode: null,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : `${label} request failed.`,
            request: {
                headers: init.headers ?? null,
                body: init.body ?? null,
            },
            response: null,
        });
        throw error;
    }
    const text = await res.text().catch(() => '');
    const durationMs = Date.now() - startedAt;
    let parsed: unknown = null;
    if (text) {
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = text.slice(0, 4000);
        }
    }

    logDeveloperEvent({
        provider,
        level: res.ok ? 'info' : 'error',
        event: 'api.response',
        source: 'api',
        method: init.method ?? 'GET',
        url: res.url || url,
        statusCode: res.status,
        durationMs,
        message: `${label} returned ${res.status}`,
        request: {
            headers: init.headers ?? null,
            body: init.body ?? null,
        },
        response: parsed,
    });

    if (!res.ok) {
        const detail = text ? `: ${text.slice(0, 220)}` : '';
        throw new Error(`${label} request failed with ${res.status}${detail}`);
    }
    return parsed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, getMessage: () => string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new RefreshTimeoutError(getMessage())), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function isLikelySessionError(error: unknown): boolean {
    if (error instanceof RefreshTimeoutError) return false;
    const message = error instanceof Error ? error.message : String(error);
    return /sign in|login|session|authenticate|auth/i.test(message);
}

function logDeveloperEvent(
    input: Omit<DeveloperLogEntry, 'id' | 'createdAt' | 'providerId' | 'providerName' | 'providerKind'> & {
        provider: ProviderRecord;
    },
): void {
    const settings = db.getSettings();
    if (!settings.developmentMode) return;
    if (!shouldStoreDeveloperLog(input)) return;
    db.addDeveloperLog({
        providerId: input.provider.id,
        providerName: input.provider.name,
        providerKind: input.provider.kind,
        level: input.level,
        event: input.event,
        source: input.source,
        method: input.method,
        url: input.url ? redactUrl(input.url) : null,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        message: input.message,
        request: sanitizeLogValue(input.request),
        response: sanitizeLogValue(input.response),
    });
}

function shouldStoreDeveloperLog(
    input: Omit<DeveloperLogEntry, 'id' | 'createdAt' | 'providerId' | 'providerName' | 'providerKind'> & {
        provider: ProviderRecord;
    },
): boolean {
    if (!input.method || !input.url) return false;
    if (isStaticOrDocumentUrl(input.url)) return false;

    if (input.provider.kind === 'groq') {
        return (
            isGroqActivityUrl(input.url) &&
            [
                'groq.activity.detected',
                'groq.activity.response',
                'groq.activity.replay-failed',
                'portal.api.response',
            ].includes(input.event)
        );
    }

    return (
        input.event === 'api.request' ||
        input.event === 'api.response' ||
        input.event === 'api.error' ||
        input.event === 'portal.api.response'
    );
}

const REDACTED = '[redacted]';
const SECRET_KEY_PATTERN = /authorization|cookie|token|secret|password|credential|api[-_]?key|session|jwt|bearer/i;

function redactUrl(value: string): string {
    try {
        const url = new URL(value);
        for (const key of [...url.searchParams.keys()]) {
            if (SECRET_KEY_PATTERN.test(key)) url.searchParams.set(key, REDACTED);
        }
        return url.toString();
    } catch {
        return value;
    }
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
    if (value == null) return value;
    if (depth > 6) return '[truncated]';
    if (typeof value === 'string') return sanitizeLogString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeLogValue(item, depth + 1));
    if (typeof value === 'object') {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 120)) {
            output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : sanitizeLogValue(item, depth + 1);
        }
        return output;
    }
    return String(value);
}

function sanitizeLogString(value: string): string {
    const redacted = value
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
        .replace(/sk-[A-Za-z0-9_-]+/g, REDACTED);
    return redacted.length > 6000 ? `${redacted.slice(0, 6000)}...[truncated]` : redacted;
}

export function sumOpenRouterActivityUsage(activityResponses: unknown[]): number {
    return activityResponses.reduce<number>((total, body) => {
        const rows = Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : [];
        return (
            total +
            rows.reduce<number>((rowTotal, row) => {
                const usage = (row as { usage?: unknown })?.usage;
                return rowTotal + (typeof usage === 'number' && Number.isFinite(usage) ? usage : 0);
            }, 0)
        );
    }, 0);
}

function getCurrentUtcMonthCompletedDates(): string[] {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const dates: string[] = [];

    while (cursor.getTime() < todayUtc) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
}

function maybeNotify(provider: ProviderRecord, snap: UsageSnapshot): void {
    const settings = db.getSettings();
    if (!settings.notificationsEnabled) return;
    if (!Notification.isSupported()) return;

    if (snap.status === 'healthy') {
        if (provider.alertSuppressed) {
            db.updateProvider(provider.id, { alertSuppressed: false });
        }
        return;
    }

    if (!['warning', 'error', 'needs-login'].includes(snap.status)) return;
    if (provider.alertSuppressed) return;

    new Notification({
        title: `${provider.name}: ${snap.status === 'needs-login' ? 'Reconnect needed' : 'Usage alert'}`,
        body: snap.summary,
    }).show();
}

export async function clearProviderSession(providerId: string): Promise<void> {
    const providerSession = session.fromPartition(`persist:provider-${providerId}`);
    await providerSession.clearStorageData();
}
