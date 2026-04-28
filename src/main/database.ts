import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type {
    DeveloperLogEntry,
    ProviderKind,
    ProviderRecord,
    ProviderSource,
    ProviderStatus,
    ProviderWithSnapshot,
    SettingsRecord,
    UsageMetric,
    UsageSnapshot,
} from '../shared/types';

type Row = Record<string, unknown>;

const DEFAULT_SETTINGS: SettingsRecord = {
    startAtLogin: false,
    launchMinimized: false,
    notificationsEnabled: true,
    theme: 'system',
    defaultRefreshIntervalMinutes: 15,
    developmentMode: false,
};

export class UsageDatabase {
    private SQL: SqlJsStatic | null = null;
    private db: Database | null = null;
    private dbPath = '';

    async init(): Promise<void> {
        const wasmPath = this.resolveWasmPath();
        this.SQL = await initSqlJs({ locateFile: (file: string) => path.join(wasmPath, file) });
        this.dbPath = path.join(app.getPath('userData'), 'usage-ledger.sqlite');

        if (fs.existsSync(this.dbPath)) {
            this.db = new this.SQL.Database(fs.readFileSync(this.dbPath));
        } else {
            this.db = new this.SQL.Database();
        }

        this.migrate();
        this.ensureSettings();
        this.persist();
    }

    private resolveWasmPath(): string {
        const devPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
        if (fs.existsSync(path.join(devPath, 'sql-wasm.wasm'))) return devPath;
        return path.join(process.resourcesPath ?? process.cwd(), 'node_modules', 'sql.js', 'dist');
    }

    private get conn(): Database {
        if (!this.db) throw new Error('Database has not been initialized');
        return this.db;
    }

    private migrate(): void {
        this.conn.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        refresh_interval_minutes INTEGER NOT NULL,
        alert_credit_remaining REAL,
        alert_monthly_spend REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT,
        status TEXT NOT NULL,
        status_message TEXT,
        has_secret INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS secrets (
        provider_id TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        spend_usd REAL,
        remaining_usd REAL,
        usage_percent REAL,
        FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_provider_time
        ON snapshots(provider_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS developer_logs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider_id TEXT,
        provider_name TEXT,
        provider_kind TEXT,
        level TEXT NOT NULL,
        event TEXT NOT NULL,
        source TEXT NOT NULL,
        method TEXT,
        url TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        message TEXT,
        request_json TEXT NOT NULL,
        response_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_developer_logs_provider_time
        ON developer_logs(provider_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_developer_logs_time
        ON developer_logs(created_at DESC);
    `);
    }

    private ensureSettings(): void {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            this.conn.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
        }
    }

    persist(): void {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        fs.writeFileSync(this.dbPath, Buffer.from(this.conn.export()));
    }

    getSettings(): SettingsRecord {
        const rows = this.select('SELECT key, value FROM settings');
        return rows.reduce<SettingsRecord>(
            (acc, row) => ({ ...acc, [String(row.key)]: JSON.parse(String(row.value)) }),
            {
                ...DEFAULT_SETTINGS,
            },
        );
    }

    updateSettings(partial: Partial<SettingsRecord>): SettingsRecord {
        for (const [key, value] of Object.entries(partial)) {
            this.conn.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
        }
        this.persist();
        return this.getSettings();
    }

    createProvider(input: {
        id: string;
        kind: ProviderKind;
        source: ProviderSource;
        name: string;
        refreshIntervalMinutes: number;
        alertCreditRemaining: number | null;
        alertMonthlySpend: number | null;
        hasSecret: boolean;
    }): ProviderRecord {
        const now = new Date().toISOString();
        this.conn.run(
            `INSERT INTO providers (
        id, kind, name, source, refresh_interval_minutes, alert_credit_remaining,
        alert_monthly_spend, created_at, updated_at, status, status_message, has_secret
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                input.id,
                input.kind,
                input.name,
                input.source,
                input.refreshIntervalMinutes,
                input.alertCreditRemaining,
                input.alertMonthlySpend,
                now,
                now,
                input.source === 'portal' ? 'needs-login' : 'unknown',
                input.source === 'portal' ? 'Sign in to start collecting portal usage data.' : null,
                input.hasSecret ? 1 : 0,
            ],
        );
        this.persist();
        return this.getProvider(input.id);
    }

    updateProvider(
        id: string,
        changes: Partial<
            Pick<
                ProviderRecord,
                | 'name'
                | 'refreshIntervalMinutes'
                | 'alertCreditRemaining'
                | 'alertMonthlySpend'
                | 'lastSyncedAt'
                | 'status'
                | 'statusMessage'
                | 'hasSecret'
            >
        >,
    ): ProviderRecord {
        const current = this.getProvider(id);
        const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
        this.conn.run(
            `UPDATE providers SET
        name = ?, refresh_interval_minutes = ?, alert_credit_remaining = ?,
        alert_monthly_spend = ?, updated_at = ?, last_synced_at = ?,
        status = ?, status_message = ?, has_secret = ?
      WHERE id = ?`,
            [
                next.name,
                next.refreshIntervalMinutes,
                next.alertCreditRemaining,
                next.alertMonthlySpend,
                next.updatedAt,
                next.lastSyncedAt,
                next.status,
                next.statusMessage,
                next.hasSecret ? 1 : 0,
                id,
            ],
        );
        this.persist();
        return this.getProvider(id);
    }

    deleteProvider(id: string): void {
        this.conn.run('DELETE FROM snapshots WHERE provider_id = ?', [id]);
        this.conn.run('DELETE FROM developer_logs WHERE provider_id = ?', [id]);
        this.conn.run('DELETE FROM secrets WHERE provider_id = ?', [id]);
        this.conn.run('DELETE FROM providers WHERE id = ?', [id]);
        this.persist();
    }

    getProvider(id: string): ProviderRecord {
        const [row] = this.select('SELECT * FROM providers WHERE id = ?', [id]);
        if (!row) throw new Error(`Provider not found: ${id}`);
        return this.mapProvider(row);
    }

    listProviders(): ProviderRecord[] {
        return this.select('SELECT * FROM providers ORDER BY created_at ASC').map((row) => this.mapProvider(row));
    }

    listProvidersWithSnapshots(): ProviderWithSnapshot[] {
        return this.listProviders().map((provider) => ({
            ...provider,
            latestSnapshot: this.getLatestSnapshot(provider.id),
        }));
    }

    saveSecret(providerId: string, encryptedValue: string): void {
        this.conn.run('INSERT OR REPLACE INTO secrets (provider_id, encrypted_value, updated_at) VALUES (?, ?, ?)', [
            providerId,
            encryptedValue,
            new Date().toISOString(),
        ]);
        this.updateProvider(providerId, { hasSecret: true });
    }

    getSecret(providerId: string): string | null {
        const [row] = this.select('SELECT encrypted_value FROM secrets WHERE provider_id = ?', [providerId]);
        return row ? String(row.encrypted_value) : null;
    }

    addSnapshot(snapshot: UsageSnapshot): UsageSnapshot {
        this.conn.run(
            `INSERT INTO snapshots (
        id, provider_id, captured_at, status, summary, metrics_json, raw_json,
        spend_usd, remaining_usd, usage_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                snapshot.id,
                snapshot.providerId,
                snapshot.capturedAt,
                snapshot.status,
                snapshot.summary,
                JSON.stringify(snapshot.metrics),
                JSON.stringify(snapshot.raw ?? null),
                snapshot.spendUsd,
                snapshot.remainingUsd,
                snapshot.usagePercent,
            ],
        );
        this.updateProvider(snapshot.providerId, {
            lastSyncedAt: snapshot.capturedAt,
            status: snapshot.status,
            statusMessage: snapshot.summary,
        });
        this.persist();
        return snapshot;
    }

    getLatestSnapshot(providerId: string): UsageSnapshot | null {
        const [row] = this.select('SELECT * FROM snapshots WHERE provider_id = ? ORDER BY captured_at DESC LIMIT 1', [
            providerId,
        ]);
        return row ? this.mapSnapshot(row) : null;
    }

    getHistory(providerId?: string): UsageSnapshot[] {
        const sql = providerId
            ? 'SELECT * FROM snapshots WHERE provider_id = ? ORDER BY captured_at ASC'
            : 'SELECT * FROM snapshots ORDER BY captured_at ASC';
        return this.select(sql, providerId ? [providerId] : []).map((row) => this.mapSnapshot(row));
    }

    clearHistory(providerId?: string): void {
        if (providerId) {
            this.conn.run('DELETE FROM snapshots WHERE provider_id = ?', [providerId]);
            this.updateProvider(providerId, {
                lastSyncedAt: null,
                status: 'unknown',
                statusMessage: 'History cleared. Refresh to collect a new snapshot.',
            });
        } else {
            this.conn.run('DELETE FROM snapshots');
            for (const provider of this.listProviders()) {
                this.updateProvider(provider.id, {
                    lastSyncedAt: null,
                    status: provider.source === 'portal' ? 'unknown' : 'unknown',
                    statusMessage: 'History cleared. Refresh to collect a new snapshot.',
                });
            }
        }
        this.persist();
    }

    deleteSnapshot(snapshotId: string): void {
        const [row] = this.select('SELECT provider_id FROM snapshots WHERE id = ?', [snapshotId]);
        if (!row) return;
        const providerId = String(row.provider_id);
        this.conn.run('DELETE FROM snapshots WHERE id = ?', [snapshotId]);
        const latest = this.getLatestSnapshot(providerId);
        if (latest) {
            this.updateProvider(providerId, {
                lastSyncedAt: latest.capturedAt,
                status: latest.status,
                statusMessage: latest.summary,
            });
        } else {
            this.updateProvider(providerId, {
                lastSyncedAt: null,
                status: 'unknown',
                statusMessage: 'History row deleted. Refresh to collect a new snapshot.',
            });
        }
        this.persist();
    }

    addDeveloperLog(
        input: Omit<DeveloperLogEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): DeveloperLogEntry {
        const entry: DeveloperLogEntry = {
            id: input.id ?? crypto.randomUUID(),
            createdAt: input.createdAt ?? new Date().toISOString(),
            providerId: input.providerId,
            providerName: input.providerName,
            providerKind: input.providerKind,
            level: input.level,
            event: input.event,
            source: input.source,
            method: input.method,
            url: input.url,
            statusCode: input.statusCode,
            durationMs: input.durationMs,
            message: input.message,
            request: input.request,
            response: input.response,
        };
        this.conn.run(
            `INSERT INTO developer_logs (
        id, created_at, provider_id, provider_name, provider_kind, level, event,
        source, method, url, status_code, duration_ms, message, request_json, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.id,
                entry.createdAt,
                entry.providerId,
                entry.providerName,
                entry.providerKind,
                entry.level,
                entry.event,
                entry.source,
                entry.method,
                entry.url,
                entry.statusCode,
                entry.durationMs,
                entry.message,
                JSON.stringify(entry.request ?? null),
                JSON.stringify(entry.response ?? null),
            ],
        );
        this.persist();
        return entry;
    }

    getDeveloperLogs(providerId?: string): DeveloperLogEntry[] {
        const sql = providerId
            ? 'SELECT * FROM developer_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT 500'
            : 'SELECT * FROM developer_logs ORDER BY created_at DESC LIMIT 500';
        return this.select(sql, providerId ? [providerId] : []).map((row) => this.mapDeveloperLog(row));
    }

    clearDeveloperLogs(providerId?: string): void {
        if (providerId) this.conn.run('DELETE FROM developer_logs WHERE provider_id = ?', [providerId]);
        else this.conn.run('DELETE FROM developer_logs');
        this.persist();
    }

    clearAllData(): void {
        this.conn.run('DELETE FROM snapshots');
        this.conn.run('DELETE FROM developer_logs');
        this.conn.run('DELETE FROM secrets');
        this.conn.run('DELETE FROM providers');
        this.conn.run('DELETE FROM settings');
        this.ensureSettings();
        this.persist();
    }

    private select(sql: string, params: SqlValue[] = []): Row[] {
        const stmt = this.conn.prepare(sql);
        stmt.bind(params);
        const rows: Row[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    }

    private mapProvider(row: Row): ProviderRecord {
        return {
            id: String(row.id),
            kind: row.kind as ProviderKind,
            name: String(row.name),
            source: row.source as ProviderSource,
            refreshIntervalMinutes: Number(row.refresh_interval_minutes),
            alertCreditRemaining: row.alert_credit_remaining == null ? null : Number(row.alert_credit_remaining),
            alertMonthlySpend: row.alert_monthly_spend == null ? null : Number(row.alert_monthly_spend),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
            lastSyncedAt: row.last_synced_at == null ? null : String(row.last_synced_at),
            status: row.status as ProviderStatus,
            statusMessage: row.status_message == null ? null : String(row.status_message),
            hasSecret: Number(row.has_secret) === 1,
        };
    }

    private mapSnapshot(row: Row): UsageSnapshot {
        return {
            id: String(row.id),
            providerId: String(row.provider_id),
            capturedAt: String(row.captured_at),
            status: row.status as ProviderStatus,
            summary: String(row.summary),
            metrics: JSON.parse(String(row.metrics_json)) as UsageMetric[],
            raw: JSON.parse(String(row.raw_json)),
            spendUsd: row.spend_usd == null ? null : Number(row.spend_usd),
            remainingUsd: row.remaining_usd == null ? null : Number(row.remaining_usd),
            usagePercent: row.usage_percent == null ? null : Number(row.usage_percent),
        };
    }

    private mapDeveloperLog(row: Row): DeveloperLogEntry {
        return {
            id: String(row.id),
            createdAt: String(row.created_at),
            providerId: row.provider_id == null ? null : String(row.provider_id),
            providerName: row.provider_name == null ? null : String(row.provider_name),
            providerKind: row.provider_kind == null ? null : (row.provider_kind as ProviderKind),
            level: row.level as DeveloperLogEntry['level'],
            event: String(row.event),
            source: row.source as DeveloperLogEntry['source'],
            method: row.method == null ? null : String(row.method),
            url: row.url == null ? null : String(row.url),
            statusCode: row.status_code == null ? null : Number(row.status_code),
            durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
            message: row.message == null ? null : String(row.message),
            request: JSON.parse(String(row.request_json)),
            response: JSON.parse(String(row.response_json)),
        };
    }
}

export const db = new UsageDatabase();
