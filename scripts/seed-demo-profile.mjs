import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const profileDir = process.argv[2];
if (!profileDir) {
    console.error('Usage: node scripts/seed-demo-profile.mjs <profile-dir>');
    process.exit(1);
}

fs.mkdirSync(profileDir, { recursive: true });

const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
});
const db = new SQL.Database();

db.run(`
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

const settings = {
    startAtLogin: false,
    launchMinimized: false,
    notificationsEnabled: true,
    theme: 'system',
    defaultRefreshIntervalMinutes: 15,
    developmentMode: false,
};

for (const [key, value] of Object.entries(settings)) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
}

const now = new Date();
const providers = [
    {
        id: 'demo-openai-api',
        kind: 'openai-api',
        name: 'OpenAI API',
        source: 'api',
        refresh: 15,
        spend: 12.31,
        remaining: null,
        usage: null,
        metrics: [{ label: 'Monthly spend', value: '$12.31', tone: 'neutral' }],
    },
    {
        id: 'demo-openrouter',
        kind: 'openrouter',
        name: 'OpenRouter',
        source: 'api',
        refresh: 30,
        spend: 3.76,
        remaining: 18.02,
        usage: null,
        metrics: [
            { label: 'Credit', value: '$18.02' },
            { label: 'Monthly spend', value: '$3.76' },
        ],
    },
    {
        id: 'demo-groq',
        kind: 'groq',
        name: 'Groq Cloud',
        source: 'portal',
        refresh: 15,
        spend: 0.0042,
        remaining: null,
        usage: null,
        metrics: [{ label: 'Current spend', value: '<$0.01', tooltip: '$0.0042', emphasis: 'dotted' }],
    },
    {
        id: 'demo-codex',
        kind: 'codex',
        name: 'OpenAI Codex',
        source: 'api',
        refresh: 15,
        spend: null,
        remaining: null,
        usage: 18,
        metrics: [
            { label: '5-hour remaining', value: '82.0%', tone: 'good', tooltip: 'Resets 4 hours from now' },
            { label: 'Weekly remaining', value: '51.0%', tone: 'good', tooltip: 'Resets 3 days from now' },
        ],
    },
];

for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const createdAt = new Date(now.getTime() - (5 - i) * 86_400_000).toISOString();
    const syncedAt = new Date(now.getTime() - (i + 2) * 60_000).toISOString();
    const statusMessage =
        provider.kind === 'codex'
            ? 'Codex quota usage collected'
            : provider.kind === 'openrouter'
              ? '$3.76 spent this month'
              : provider.kind === 'groq'
                ? '$0.0042 current spend'
                : '$12.31 spent this month';

    db.run(
        `INSERT INTO providers (
      id, kind, name, source, refresh_interval_minutes, alert_credit_remaining,
      alert_monthly_spend, created_at, updated_at, last_synced_at, status,
      status_message, has_secret
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            provider.id,
            provider.kind,
            provider.name,
            provider.source,
            provider.refresh,
            provider.kind === 'openrouter' ? 5 : null,
            provider.kind === 'openai-api' ? 50 : null,
            createdAt,
            syncedAt,
            syncedAt,
            'healthy',
            statusMessage,
            1,
        ],
    );

    for (let point = 6; point >= 0; point--) {
        const capturedAt = new Date(now.getTime() - point * 86_400_000 - i * 15 * 60_000).toISOString();
        const factor = (7 - point) / 7;
        const spend = provider.spend == null ? null : Number((provider.spend * factor).toFixed(6));
        const remaining =
            provider.remaining == null ? null : Number((provider.remaining + (1 - factor) * 4).toFixed(2));
        const codexUsage = provider.kind === 'codex' ? Math.round(10 + factor * 8) : provider.usage;
        const metrics =
            provider.kind === 'codex'
                ? [
                      { label: '5-hour remaining', value: `${(90 - factor * 8).toFixed(1)}%`, tone: 'good' },
                      { label: 'Weekly remaining', value: `${(58 - factor * 7).toFixed(1)}%`, tone: 'good' },
                  ]
                : provider.kind === 'groq'
                  ? [
                        {
                            label: 'Current spend',
                            value: '<$0.01',
                            tooltip: `$${spend?.toFixed(6) ?? '0.000000'}`,
                            emphasis: 'dotted',
                        },
                    ]
                  : provider.kind === 'openrouter'
                    ? [
                          { label: 'Credit', value: `$${remaining?.toFixed(2)}` },
                          { label: 'Monthly spend', value: `$${spend?.toFixed(2)}` },
                      ]
                    : [{ label: 'Monthly spend', value: `$${spend?.toFixed(2)}`, tone: 'neutral' }];

        db.run(
            `INSERT INTO snapshots (
        id, provider_id, captured_at, status, summary, metrics_json, raw_json,
        spend_usd, remaining_usd, usage_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                `${provider.id}-${point}`,
                provider.id,
                capturedAt,
                'healthy',
                statusMessage,
                JSON.stringify(metrics),
                JSON.stringify({ demo: true }),
                spend,
                remaining,
                codexUsage,
            ],
        );
    }
}

fs.writeFileSync(path.join(profileDir, 'usage-ledger.sqlite'), Buffer.from(db.export()));
db.close();

console.log(`Seeded demo profile at ${profileDir}`);
