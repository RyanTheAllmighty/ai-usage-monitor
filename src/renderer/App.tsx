import { motion } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip as ChartTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    Activity,
    Bell,
    BellOff,
    Bug,
    Check,
    PanelLeftClose,
    PanelLeftOpen,
    Copy,
    Database,
    Download,
    Eraser,
    Clock,
    History,
    KeyRound,
    LayoutDashboard,
    Loader2,
    LogIn,
    Maximize2,
    Minus,
    Pencil,
    Plus,
    Power,
    RefreshCw,
    Settings,
    Shield,
    Trash2,
    X,
} from 'lucide-react';

import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { cn, formatRelative, formatShortDate, providerAccent, statusTone } from './lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from './components/ui/alert-dialog';
import {
    PROVIDER_DEFINITIONS,
    type AppState,
    type CreateProviderInput,
    type DeveloperLogEntry,
    type ProviderKind,
    type ProviderWithSnapshot,
    type SettingsRecord,
    type UpdateProviderInput,
    type UsageMetric,
    type UsageSnapshot,
} from '../shared/types';

type View = 'dashboard' | 'providers' | 'history' | 'developer-logs' | 'settings';

const api = window.aiUsageMonitor;

export function App(): ReactElement {
    const queryClient = useQueryClient();
    const [view, setView] = useState<View>('dashboard');
    const [adding, setAdding] = useState(false);
    const [navCollapsed, setNavCollapsed] = useState(false);
    const [editingProvider, setEditingProvider] = useState<ProviderWithSnapshot | null>(null);

    const stateQuery = useQuery({
        queryKey: ['app-state'],
        queryFn: api.getAppState,
        refetchInterval: 60_000,
    });
    const state = stateQuery.data;

    const refreshAll = useMutation({
        mutationFn: api.refreshAll,
        onSuccess: (snapshots) => {
            showRefreshToasts(snapshots);
            queryClient.invalidateQueries({ queryKey: ['app-state'] });
            queryClient.invalidateQueries({ queryKey: ['developer-logs'] });
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Refresh failed.'),
    });

    const refreshOne = useMutation({
        mutationFn: api.refreshProvider,
        onSuccess: (snapshot) => {
            showRefreshToasts([snapshot]);
            queryClient.invalidateQueries({ queryKey: ['app-state'] });
            queryClient.invalidateQueries({ queryKey: ['developer-logs'] });
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Refresh failed.'),
    });

    const login = useMutation({
        mutationFn: api.loginProvider,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });

    const deleteProvider = useMutation({
        mutationFn: api.deleteProvider,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });
    const suppressAlert = useMutation({
        mutationFn: api.suppressProviderAlert,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });
    const unsuppressAlert = useMutation({
        mutationFn: api.unsuppressProviderAlert,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });

    const isInitialLoading = stateQuery.isLoading || !state;
    const totals = useMemo(() => summarize(state), [state]);
    const currentView = state && !state.settings.developmentMode && view === 'developer-logs' ? 'settings' : view;

    if (isInitialLoading) {
        return (
            <div className="h-screen overflow-hidden text-mist">
                <ThemeEffect theme={state?.settings.theme ?? 'system'} />
                <TooltipProvider delayDuration={250}>
                    <div className="app-shell flex h-full flex-col overflow-hidden">
                        <TitleBar navCollapsed={navCollapsed} onToggleNav={() => setNavCollapsed((value) => !value)} />
                        <LoadingSplash />
                    </div>
                </TooltipProvider>
                <Toaster
                    richColors
                    closeButton
                    position="bottom-right"
                    theme={state?.settings.theme === 'light' ? 'light' : 'dark'}
                />
            </div>
        );
    }

    return (
        <div className="h-screen overflow-hidden text-mist">
            <ThemeEffect theme={state?.settings.theme ?? 'system'} />
            <TooltipProvider delayDuration={250}>
                <div className="app-shell flex h-full flex-col overflow-hidden">
                    <TitleBar navCollapsed={navCollapsed} onToggleNav={() => setNavCollapsed((value) => !value)} />
                    <div className="flex min-h-0 flex-1 overflow-hidden">
                        <aside
                            className={cn(
                                'flex flex-col border-r border-white/10 p-5 transition-[width] duration-200',
                                navCollapsed ? 'w-[84px]' : 'w-72',
                            )}
                        >
                            <div className={cn('flex items-center gap-3', navCollapsed && 'justify-center')}>
                                <div className="grid h-11 w-11 place-items-center rounded-lg bg-gradient-to-br from-plasma to-orchid text-ink shadow-lg shadow-plasma/20">
                                    <Activity size={22} strokeWidth={2.4} />
                                </div>
                                <div className={cn(navCollapsed && 'hidden')}>
                                    <div className="text-lg leading-tight font-semibold">AI Usage Monitor</div>
                                    <div className="text-xs text-mist/50">Local usage ledger</div>
                                </div>
                            </div>

                            <nav className="mt-8 grid gap-1">
                                <NavButton
                                    collapsed={navCollapsed}
                                    icon={LayoutDashboard}
                                    label="Dashboard"
                                    active={currentView === 'dashboard'}
                                    onClick={() => setView('dashboard')}
                                />
                                <NavButton
                                    collapsed={navCollapsed}
                                    icon={KeyRound}
                                    label="Providers"
                                    active={currentView === 'providers'}
                                    onClick={() => setView('providers')}
                                />
                                <NavButton
                                    collapsed={navCollapsed}
                                    icon={History}
                                    label="History"
                                    active={currentView === 'history'}
                                    onClick={() => setView('history')}
                                />
                                {state?.settings.developmentMode && (
                                    <NavButton
                                        collapsed={navCollapsed}
                                        icon={Bug}
                                        label="Developer logs"
                                        active={currentView === 'developer-logs'}
                                        onClick={() => setView('developer-logs')}
                                    />
                                )}
                                <NavButton
                                    collapsed={navCollapsed}
                                    icon={Settings}
                                    label="Settings"
                                    active={currentView === 'settings'}
                                    onClick={() => setView('settings')}
                                />
                            </nav>

                            <div className={cn('mt-auto grid gap-3', navCollapsed && 'hidden')}>
                                <div className="glass-soft rounded-lg p-4">
                                    <div className="text-xs text-mist/40 uppercase">Current month</div>
                                    <div className="mt-2 text-2xl font-semibold">
                                        <CurrencyValue value={totals.spendUsd} />
                                    </div>
                                    <div className="mt-1 text-sm text-mist/50">
                                        {totals.providers} providers watched
                                    </div>
                                </div>
                                <Button
                                    onClick={() => refreshAll.mutate()}
                                    disabled={refreshAll.isPending || !state?.providers.length}
                                >
                                    {refreshAll.isPending ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : (
                                        <RefreshCw size={16} />
                                    )}
                                    Refresh all
                                </Button>
                            </div>
                        </aside>

                        <main className="thin-scrollbar flex-1 overflow-auto p-7">
                            <motion.div
                                key={currentView}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.22 }}
                                className="mx-auto max-w-6xl"
                            >
                                {currentView === 'dashboard' && (
                                    <Dashboard
                                        state={state}
                                        totals={totals}
                                        onAdd={() => setAdding(true)}
                                        onRefresh={(id) => refreshOne.mutate(id)}
                                        refreshingId={refreshOne.isPending ? refreshOne.variables : undefined}
                                        onLogin={(id) => login.mutate(id)}
                                        onSuppress={(id) => suppressAlert.mutate(id)}
                                        onUnsuppress={(id) => unsuppressAlert.mutate(id)}
                                    />
                                )}
                                {currentView === 'providers' && (
                                    <Providers
                                        state={state}
                                        onAdd={() => setAdding(true)}
                                        onEdit={(provider) => setEditingProvider(provider)}
                                        onRefresh={(id) => refreshOne.mutate(id)}
                                        onLogin={(id) => login.mutate(id)}
                                        onDelete={(id) => deleteProvider.mutate(id)}
                                        onSuppress={(id) => suppressAlert.mutate(id)}
                                        onUnsuppress={(id) => unsuppressAlert.mutate(id)}
                                    />
                                )}
                                {currentView === 'history' && <HistoryView state={state} />}
                                {currentView === 'developer-logs' && <DeveloperLogsView state={state} />}
                                {currentView === 'settings' && <SettingsView settings={state.settings} />}
                            </motion.div>
                        </main>
                    </div>
                </div>
            </TooltipProvider>
            <Toaster
                richColors
                closeButton
                position="bottom-right"
                theme={state?.settings.theme === 'light' ? 'light' : 'dark'}
            />

            {adding && <AddProviderDialog onClose={() => setAdding(false)} />}
            {editingProvider && (
                <EditProviderDialog provider={editingProvider} onClose={() => setEditingProvider(null)} />
            )}
        </div>
    );
}

function IconTooltip({ label, children }: { label: string; children: ReactElement }): ReactElement {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function ThemeEffect({ theme }: { theme: SettingsRecord['theme'] }): null {
    useEffect(() => {
        const root = document.documentElement;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => {
            const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
            root.classList.toggle('dark', resolved === 'dark');
            root.classList.toggle('light', resolved === 'light');
        };

        apply();
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [theme]);

    return null;
}

function TitleBar({ navCollapsed, onToggleNav }: { navCollapsed: boolean; onToggleNav: () => void }): ReactElement {
    return (
        <div
            className="drag-region relative flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-2"
            onDoubleClick={() => api.windowAction('maximize')}
        >
            <div className="no-drag flex items-center">
                <Button
                    variant="ghost"
                    size="window"
                    title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                    onClick={onToggleNav}
                >
                    {navCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                </Button>
            </div>
            <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
                <div className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-plasma to-orchid text-ink">
                    <Activity size={13} strokeWidth={2.4} />
                </div>
                <div className="text-xs font-semibold text-mist/82">AI Usage Monitor</div>
            </div>
            <div className="no-drag flex items-center gap-1">
                <Button variant="ghost" size="window" title="Minimize" onClick={() => api.windowAction('minimize')}>
                    <Minus size={15} />
                </Button>
                <Button variant="ghost" size="window" title="Maximize" onClick={() => api.windowAction('maximize')}>
                    <Maximize2 size={14} />
                </Button>
                <Button
                    variant="ghost"
                    size="window"
                    className="hover:bg-rose-400 hover:text-ink"
                    title="Close to tray"
                    onClick={() => api.windowAction('close')}
                >
                    <X size={15} />
                </Button>
            </div>
        </div>
    );
}

function LoadingSplash(): ReactElement {
    return (
        <main className="loading-surface relative flex flex-1 items-center justify-center overflow-hidden">
            <div className="loading-grid" />
            <motion.section
                initial={{ opacity: 0, y: 14, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 flex flex-col items-center text-center"
            >
                <div className="loading-logo-frame">
                    <div className="loading-monitor">
                        <HeartbeatTrack className="loading-heartbeat-shadow" />
                        <HeartbeatTrack />
                    </div>
                </div>
                <div className="mt-7 text-2xl font-semibold text-mist">AI Usage Monitor</div>
            </motion.section>
        </main>
    );
}

function HeartbeatTrack({ className }: { className?: string }): ReactElement {
    const path = 'M0 22H18L29 12L40 34L56 4L72 22H96';

    return (
        <div className={cn('loading-heartbeat-track', className)}>
            {[0, 1, 2].map((index) => (
                <svg key={index} className="loading-heartbeat" viewBox="0 0 96 42" aria-hidden="true">
                    <path d={path} />
                </svg>
            ))}
        </div>
    );
}

function Dashboard({
    state,
    totals,
    onAdd,
    onRefresh,
    refreshingId,
    onLogin,
    onSuppress,
    onUnsuppress,
}: {
    state: AppState;
    totals: ReturnType<typeof summarize>;
    onAdd: () => void;
    onRefresh: (id: string) => void;
    refreshingId?: string;
    onLogin: (id: string) => void;
    onSuppress: (id: string) => void;
    onUnsuppress: (id: string) => void;
}): ReactElement {
    return (
        <div>
            <Header
                eyebrow="Dashboard"
                title="Provider usage"
                action={
                    <Button onClick={onAdd}>
                        <Plus size={17} />
                        Add provider
                    </Button>
                }
            />

            <OverviewPanel totals={totals} providers={state.providers} />

            <div className="mt-6 grid gap-3">
                {state.providers.length === 0 ? (
                    <EmptyState onAdd={onAdd} />
                ) : (
                    state.providers.map((provider) => (
                        <ProviderRow
                            key={provider.id}
                            provider={provider}
                            onRefresh={onRefresh}
                            onLogin={onLogin}
                            onSuppress={onSuppress}
                            onUnsuppress={onUnsuppress}
                            refreshing={refreshingId === provider.id}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function OverviewPanel({
    totals,
    providers,
}: {
    totals: ReturnType<typeof summarize>;
    providers: ProviderWithSnapshot[];
}): ReactElement {
    const healthy = providers.filter((provider) => provider.status === 'healthy').length;
    return (
        <section className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(114,244,216,.12),rgba(199,166,255,.08)_44%,rgba(255,184,107,.08))] p-[1px]">
            <div className="rounded-lg bg-ink/58 p-6">
                <div className="grid grid-cols-[1.15fr_.85fr] gap-8">
                    <div>
                        <div className="text-xs text-plasma/70 uppercase">Tracked this month</div>
                        <div className="mt-3 flex items-end gap-4">
                            <div className="text-6xl leading-none font-semibold text-mist">
                                <CurrencyValue value={totals.spendUsd} />
                            </div>
                            <div className="pb-2 text-sm text-mist/45">
                                {totals.providers} sources · last sync {totals.lastSync}
                            </div>
                        </div>
                        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/8">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-plasma via-sky-300 to-orchid"
                                style={{
                                    width: `${providers.length ? Math.max(10, (healthy / providers.length) * 100) : 0}%`,
                                }}
                            />
                        </div>
                    </div>
                    <div className="grid content-center gap-2">
                        <OverviewMetric
                            icon={Shield}
                            label="Balance"
                            value={totals.remainingUsd == null ? 'n/a' : <CurrencyValue value={totals.remainingUsd} />}
                        />
                        <OverviewMetric icon={Bell} label="Needs attention" value={String(totals.attention)} />
                        <OverviewMetric icon={Clock} label="Healthy" value={`${healthy}/${totals.providers}`} />
                    </div>
                </div>
            </div>
        </section>
    );
}

function OverviewMetric({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Shield;
    label: string;
    value: ReactNode;
}): ReactElement {
    return (
        <div className="flex items-center justify-between border-b border-white/10 py-2 last:border-b-0">
            <div className="flex items-center gap-2 text-sm text-mist/58">
                <Icon size={15} className="text-plasma" />
                {label}
            </div>
            <div className="max-w-40 truncate text-right text-lg font-semibold text-mist">{value}</div>
        </div>
    );
}

function Providers({
    state,
    onAdd,
    onEdit,
    onRefresh,
    onLogin,
    onDelete,
    onSuppress,
    onUnsuppress,
}: {
    state: AppState;
    onAdd: () => void;
    onEdit: (provider: ProviderWithSnapshot) => void;
    onRefresh: (id: string) => void;
    onLogin: (id: string) => void;
    onDelete: (id: string) => void;
    onSuppress: (id: string) => void;
    onUnsuppress: (id: string) => void;
}): ReactElement {
    const queryClient = useQueryClient();
    const clearSession = useMutation({
        mutationFn: api.clearProviderSession,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });
    const clearHistory = useMutation({
        mutationFn: (providerId: string) => api.clearHistory(providerId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });

    return (
        <div>
            <Header
                eyebrow="Providers"
                title="Accounts and connectors"
                action={
                    <Button onClick={onAdd}>
                        <Plus size={17} />
                        Add provider
                    </Button>
                }
            />
            <div className="mt-6 grid gap-3">
                {state.providers.map((provider) => (
                    <div key={provider.id} className="glass-soft rounded-lg p-5">
                        <div className="flex items-start justify-between gap-4">
                            <ProviderIdentity provider={provider} />
                            <div className="flex gap-2">
                                <IconTooltip label="Edit provider">
                                    <Button
                                        variant="icon"
                                        size="icon"
                                        aria-label="Edit provider"
                                        onClick={() => onEdit(provider)}
                                    >
                                        <Pencil size={16} />
                                    </Button>
                                </IconTooltip>
                                {(provider.source === 'portal' || provider.kind === 'codex') && (
                                    <IconTooltip
                                        label={
                                            provider.status === 'needs-login'
                                                ? 'Sign in to provider'
                                                : 'Reconnect provider auth'
                                        }
                                    >
                                        <Button
                                            variant="icon"
                                            size="icon"
                                            aria-label="Log in to provider"
                                            onClick={() => onLogin(provider.id)}
                                        >
                                            <LogIn size={16} />
                                        </Button>
                                    </IconTooltip>
                                )}
                                {provider.source === 'portal' && (
                                    <IconTooltip label="Clear saved browser session">
                                        <Button
                                            variant="icon"
                                            size="icon"
                                            aria-label="Clear saved browser session"
                                            onClick={() => clearSession.mutate(provider.id)}
                                        >
                                            <Eraser size={16} />
                                        </Button>
                                    </IconTooltip>
                                )}
                                <IconTooltip label="Clear provider history">
                                    <Button
                                        variant="icon"
                                        size="icon"
                                        aria-label="Clear provider history"
                                        onClick={() => clearHistory.mutate(provider.id)}
                                    >
                                        <Database size={16} />
                                    </Button>
                                </IconTooltip>
                                <IconTooltip
                                    label={provider.status === 'syncing' ? 'Refreshing usage' : 'Refresh usage now'}
                                >
                                    <Button
                                        variant="icon"
                                        size="icon"
                                        aria-label="Refresh usage now"
                                        onClick={() => onRefresh(provider.id)}
                                    >
                                        <RefreshCw size={16} />
                                    </Button>
                                </IconTooltip>
                                {['warning', 'error', 'needs-login'].includes(provider.status) &&
                                    !provider.alertSuppressed && (
                                        <IconTooltip label="Suppress this alarm until it clears">
                                            <Button
                                                variant="icon"
                                                size="icon"
                                                aria-label="Suppress this alarm"
                                                onClick={() => onSuppress(provider.id)}
                                            >
                                                <BellOff size={16} />
                                            </Button>
                                        </IconTooltip>
                                    )}
                                {provider.alertSuppressed && (
                                    <IconTooltip label="Alarms suppressed. Click to resume alerts.">
                                        <Button
                                            variant="icon"
                                            size="icon"
                                            className="text-ember"
                                            aria-label="Resume alerts"
                                            onClick={() => onUnsuppress(provider.id)}
                                        >
                                            <BellOff size={16} />
                                        </Button>
                                    </IconTooltip>
                                )}
                                <AlertDialog>
                                    <IconTooltip label="Delete provider">
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="icon"
                                                size="icon"
                                                className="text-rose-200"
                                                aria-label="Delete provider"
                                            >
                                                <Trash2 size={16} />
                                            </Button>
                                        </AlertDialogTrigger>
                                    </IconTooltip>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete {provider.name}?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This removes the provider, its encrypted credential or session, and its
                                                local history. This cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => onDelete(provider.id)}>
                                                Delete provider
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
                            <Meta
                                label="Source"
                                value={
                                    provider.kind === 'codex'
                                        ? 'OAuth API'
                                        : provider.source === 'api'
                                          ? 'API'
                                          : 'Portal session'
                                }
                            />
                            <Meta label="Refresh" value={`${provider.refreshIntervalMinutes} min`} />
                            <Meta
                                label="Secret/session"
                                value={provider.hasSecret || provider.source === 'portal' ? 'Configured' : 'Missing'}
                            />
                            <Meta label="Last sync" value={formatRelative(provider.lastSyncedAt)} />
                        </div>
                    </div>
                ))}
                {state.providers.length === 0 && <EmptyState onAdd={onAdd} />}
            </div>
        </div>
    );
}

function HistoryView({ state }: { state: AppState }): ReactElement {
    const queryClient = useQueryClient();
    const [providerId, setProviderId] = useState<string>('all');
    const providerLookup = useMemo(
        () => new Map(state.providers.map((provider) => [provider.id, provider])),
        [state.providers],
    );
    const filteredHistory =
        providerId === 'all' ? state.history : state.history.filter((snapshot) => snapshot.providerId === providerId);
    const chartData = useMemo(
        () => buildHistoryChartData(filteredHistory, providerLookup),
        [filteredHistory, providerLookup],
    );
    const hasCodexQuotaSeries = chartData.some((point) => point.codexFiveHour != null || point.codexWeekly != null);
    const hasOpenCodeQuotaSeries = chartData.some(
        (point) => point.opencodeFiveHour != null || point.opencodeWeekly != null || point.opencodeMonthly != null,
    );
    const hasQuotaSeries = hasCodexQuotaSeries || hasOpenCodeQuotaSeries;
    const deleteSnapshot = useMutation({
        mutationFn: api.deleteHistorySnapshot,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['app-state'] });
            toast.success('History row deleted.');
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not delete history row.'),
    });

    return (
        <div>
            <Header
                eyebrow="History"
                title="Detailed local ledger"
                action={
                    <Select value={providerId} onValueChange={setProviderId}>
                        <SelectTrigger className="w-56">
                            <SelectValue placeholder="Provider" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All providers</SelectItem>
                            {state.providers.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                    {provider.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                }
            />
            <div className="mt-6 h-80 rounded-lg border border-white/10 bg-white/[0.045] p-5">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                        <defs>
                            <linearGradient id="totalSpend" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#72f4d8" stopOpacity={0.75} />
                                <stop offset="95%" stopColor="#72f4d8" stopOpacity={0.03} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(233,238,247,0.1)" vertical={false} />
                        <XAxis
                            dataKey="time"
                            stroke="rgba(233,238,247,0.45)"
                            tickLine={false}
                            axisLine={false}
                            minTickGap={28}
                        />
                        <YAxis
                            yAxisId="spend"
                            stroke="rgba(233,238,247,0.45)"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => formatCurrencyAxis(Number(value))}
                        />
                        <YAxis
                            yAxisId="quota"
                            orientation="right"
                            domain={[0, 100]}
                            hide={!hasQuotaSeries}
                            stroke="rgba(233,238,247,0.45)"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `${value}%`}
                        />
                        <ChartTooltip
                            formatter={(value, name) => formatHistoryChartTooltip(value, name)}
                            contentStyle={{
                                background: '#10172a',
                                border: '1px solid rgba(255,255,255,.12)',
                                borderRadius: 16,
                            }}
                        />
                        <Legend wrapperStyle={{ color: 'rgba(233,238,247,0.72)', fontSize: 12, paddingTop: 12 }} />
                        <Area
                            yAxisId="spend"
                            type="monotone"
                            dataKey="totalSpend"
                            name="Total cost"
                            stroke="#72f4d8"
                            fill="url(#totalSpend)"
                            strokeWidth={2}
                        />
                        <Line
                            yAxisId="quota"
                            type="monotone"
                            dataKey="codexFiveHour"
                            name="Codex 5-hour"
                            stroke="#7dd3fc"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                        />
                        <Line
                            yAxisId="quota"
                            type="monotone"
                            dataKey="codexWeekly"
                            name="Codex weekly"
                            stroke="#c4b5fd"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                        />
                        {hasOpenCodeQuotaSeries && (
                            <>
                                <Line
                                    yAxisId="quota"
                                    type="monotone"
                                    dataKey="opencodeFiveHour"
                                    name="OpenCode Go 5-hour"
                                    stroke="#fbbf24"
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls
                                />
                                <Line
                                    yAxisId="quota"
                                    type="monotone"
                                    dataKey="opencodeWeekly"
                                    name="OpenCode Go weekly"
                                    stroke="#f472b6"
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls
                                />
                                <Line
                                    yAxisId="quota"
                                    type="monotone"
                                    dataKey="opencodeMonthly"
                                    name="OpenCode Go monthly"
                                    stroke="#34d399"
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls
                                />
                            </>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-4 grid gap-2">
                {filteredHistory
                    .slice()
                    .reverse()
                    .slice(0, 12)
                    .map((snapshot) => {
                        const provider = state.providers.find((item) => item.id === snapshot.providerId);
                        return (
                            <div
                                key={snapshot.id}
                                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3"
                            >
                                <div>
                                    <div className="font-medium">{provider?.name ?? 'Deleted provider'}</div>
                                    <div className="text-xs text-mist/45">{formatShortDate(snapshot.capturedAt)}</div>
                                </div>
                                <div className="flex items-center gap-3 self-center">
                                    <HistorySnapshotSummary snapshot={snapshot} />
                                    {state.settings.developmentMode && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="icon"
                                                    size="icon"
                                                    className="text-rose-200"
                                                    aria-label="Delete history row"
                                                    title="Delete history row"
                                                    disabled={deleteSnapshot.isPending}
                                                >
                                                    <Trash2 size={16} />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete history row?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This removes only this snapshot from the local ledger and
                                                        recalculates the provider&apos;s latest status from the
                                                        remaining history.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => deleteSnapshot.mutate(snapshot.id)}
                                                    >
                                                        Delete row
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

interface HistoryChartPoint {
    time: string;
    totalSpend: number;
    codexFiveHour: number | null;
    codexWeekly: number | null;
    opencodeFiveHour: number | null;
    opencodeWeekly: number | null;
    opencodeMonthly: number | null;
}

function buildHistoryChartData(
    history: UsageSnapshot[],
    providerLookup: Map<string, ProviderWithSnapshot>,
): HistoryChartPoint[] {
    const latestSpendByProvider = new Map<string, number>();
    const latestCodexFiveHourByProvider = new Map<string, number>();
    const latestCodexWeeklyByProvider = new Map<string, number>();
    const latestOpencodeFiveHourByProvider = new Map<string, number>();
    const latestOpencodeWeeklyByProvider = new Map<string, number>();
    const latestOpencodeMonthlyByProvider = new Map<string, number>();

    return history
        .slice()
        .sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime())
        .map((snapshot) => {
            if (snapshot.spendUsd != null) latestSpendByProvider.set(snapshot.providerId, snapshot.spendUsd);

            const provider = providerLookup.get(snapshot.providerId);
            if (provider?.kind === 'codex') {
                const fiveHourRemaining =
                    readMetricPercent(snapshot.metrics, '5-hour') ??
                    (snapshot.usagePercent == null ? null : Math.max(0, Math.min(100, 100 - snapshot.usagePercent)));
                const weeklyRemaining = readMetricPercent(snapshot.metrics, 'weekly');
                if (fiveHourRemaining != null)
                    latestCodexFiveHourByProvider.set(snapshot.providerId, fiveHourRemaining);
                if (weeklyRemaining != null) latestCodexWeeklyByProvider.set(snapshot.providerId, weeklyRemaining);
            }

            if (provider?.kind === 'opencode') {
                const fiveHourRemaining = readMetricPercent(snapshot.metrics, 'go 5-hour');
                const weeklyRemaining = readMetricPercent(snapshot.metrics, 'go weekly');
                const monthlyRemaining = readMetricPercent(snapshot.metrics, 'go monthly');
                if (fiveHourRemaining != null)
                    latestOpencodeFiveHourByProvider.set(snapshot.providerId, fiveHourRemaining);
                if (weeklyRemaining != null) latestOpencodeWeeklyByProvider.set(snapshot.providerId, weeklyRemaining);
                if (monthlyRemaining != null)
                    latestOpencodeMonthlyByProvider.set(snapshot.providerId, monthlyRemaining);
            }

            return {
                time: formatShortDate(snapshot.capturedAt),
                totalSpend: sumValues(latestSpendByProvider),
                codexFiveHour: lowestValue(latestCodexFiveHourByProvider),
                codexWeekly: lowestValue(latestCodexWeeklyByProvider),
                opencodeFiveHour: lowestValue(latestOpencodeFiveHourByProvider),
                opencodeWeekly: lowestValue(latestOpencodeWeeklyByProvider),
                opencodeMonthly: lowestValue(latestOpencodeMonthlyByProvider),
            };
        });
}

function readMetricPercent(metrics: UsageMetric[], labelIncludes: string): number | null {
    const metric = metrics.find((item) => item.label.toLowerCase().includes(labelIncludes));
    if (!metric) return null;
    const match = metric.value.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s?%/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function sumValues(values: Map<string, number>): number {
    let total = 0;
    for (const value of values.values()) total += value;
    return total;
}

function lowestValue(values: Map<string, number>): number | null {
    const entries = Array.from(values.values());
    return entries.length ? Math.min(...entries) : null;
}

function formatHistoryChartTooltip(value: unknown, name: unknown): [string, string] {
    const label = String(name);
    if (typeof value !== 'number') return [String(value ?? 'No data'), label];
    if (label === 'Total cost') return [formatCurrencyPrecise(value), label];
    return [`${value.toFixed(1)}% remaining`, label];
}

function DeveloperLogsView({ state }: { state: AppState }): ReactElement {
    const queryClient = useQueryClient();
    const [providerId, setProviderId] = useState('all');
    const selectedProvider = providerId === 'all' ? undefined : providerId;
    const logsQuery = useQuery({
        queryKey: ['developer-logs', selectedProvider ?? 'all'],
        queryFn: () => api.getDeveloperLogs(selectedProvider),
        refetchInterval: 5000,
    });
    const clearLogs = useMutation({
        mutationFn: () => api.clearDeveloperLogs(selectedProvider),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['developer-logs'] }),
    });
    const logs = logsQuery.data ?? [];

    return (
        <div>
            <Header
                eyebrow="Developer"
                title="Request logs"
                action={
                    <div className="flex items-center gap-2">
                        <Select value={providerId} onValueChange={setProviderId}>
                            <SelectTrigger className="w-60">
                                <SelectValue placeholder="Provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All providers</SelectItem>
                                {state.providers.map((provider) => (
                                    <SelectItem key={provider.id} value={provider.id}>
                                        {provider.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="secondary"
                            disabled={clearLogs.isPending || !logs.length}
                            onClick={() => clearLogs.mutate()}
                        >
                            <Trash2 size={16} />
                            Clear logs
                        </Button>
                    </div>
                }
            />

            <div className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
                <div className="grid grid-cols-[130px_160px_115px_1fr_86px] gap-3 border-b border-white/10 px-4 py-3 text-xs text-mist/38 uppercase">
                    <span>Time</span>
                    <span>Provider</span>
                    <span>Event</span>
                    <span>Request</span>
                    <span className="text-right">Status</span>
                </div>
                <div className="thin-scrollbar max-h-[62vh] overflow-auto">
                    {logs.length === 0 ? (
                        <div className="grid min-h-60 place-items-center text-center text-sm text-mist/46">
                            <div>
                                <Bug className="mx-auto mb-3 text-plasma" />
                                Refresh a provider to collect sanitized request and response logs.
                            </div>
                        </div>
                    ) : (
                        logs.map((log) => <DeveloperLogRow key={log.id} log={log} />)
                    )}
                </div>
            </div>
        </div>
    );
}

function DeveloperLogRow({ log }: { log: DeveloperLogEntry }): ReactElement {
    const [open, setOpen] = useState(false);
    const levelTone =
        log.level === 'error'
            ? 'text-rose-300'
            : log.level === 'warning'
              ? 'text-ember'
              : log.level === 'debug'
                ? 'text-mist/45'
                : 'text-plasma';

    return (
        <div className="border-b border-white/[0.06] last:border-b-0">
            <button
                type="button"
                className="grid w-full grid-cols-[130px_160px_115px_1fr_86px] items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-white/[0.045]"
                onClick={() => setOpen((value) => !value)}
            >
                <span className="text-xs text-mist/42">{formatShortDate(log.createdAt)}</span>
                <span className="truncate">{log.providerName ?? 'System'}</span>
                <span className={cn('truncate text-xs uppercase', levelTone)}>{log.event}</span>
                <span className="min-w-0 truncate font-mono text-xs text-mist/58">
                    {log.method ? `${log.method} ` : ''}
                    {log.url ?? log.message ?? 'No URL'}
                </span>
                <span className="text-right font-mono text-xs text-mist/58">
                    {log.statusCode ?? '-'}
                    {log.durationMs != null ? ` · ${log.durationMs}ms` : ''}
                </span>
            </button>
            {open && (
                <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] bg-ink/28 p-4">
                    <LogPanel title="Request" value={log.request} />
                    <LogPanel title="Response" value={log.response ?? log.message} />
                </div>
            )}
        </div>
    );
}

function LogPanel({ title, value }: { title: string; value: unknown }): ReactElement {
    return (
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="mb-2 text-xs text-mist/36 uppercase">{title}</div>
            <pre className="thin-scrollbar max-h-64 overflow-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-mist/66">
                {formatLogValue(value)}
            </pre>
        </div>
    );
}

function SettingsView({ settings }: { settings: SettingsRecord }): ReactElement {
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState(false);
    const update = useMutation({
        mutationFn: api.updateSettings,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });
    const clearHistory = useMutation({
        mutationFn: () => api.clearHistory(),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });
    const clearAll = useMutation({
        mutationFn: api.clearAllData,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-state'] }),
    });

    const toggle = (key: keyof SettingsRecord) => {
        update.mutate({ [key]: !settings[key] });
    };

    const exportLedger = async () => {
        const ledger = await api.exportLedger();
        await navigator.clipboard.writeText(JSON.stringify(ledger, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    return (
        <div>
            <Header eyebrow="Settings" title="Desktop behavior" />
            <div className="mt-6 grid gap-3">
                <SettingRow
                    icon={Power}
                    label="Start at login"
                    description="Open AI Usage Monitor when you sign in."
                    value={settings.startAtLogin}
                    onClick={() => toggle('startAtLogin')}
                />
                <SettingRow
                    icon={Clock}
                    label="Launch minimized to tray"
                    description="Start silently and keep the window hidden."
                    value={settings.launchMinimized}
                    onClick={() => toggle('launchMinimized')}
                />
                <SettingRow
                    icon={Bell}
                    label="Local threshold notifications"
                    description="Show alerts for low credit, high spend, or sync issues."
                    value={settings.notificationsEnabled}
                    onClick={() => toggle('notificationsEnabled')}
                />
                <SettingRow
                    icon={Bug}
                    label="Development mode"
                    description="Show request logs and debugging detail in the sidebar."
                    value={settings.developmentMode}
                    onClick={() => toggle('developmentMode')}
                />
                <div className="grid grid-cols-2 gap-3">
                    <label className="glass-soft grid gap-2 rounded-lg p-5 text-sm text-mist/58">
                        Default refresh interval
                        <Input
                            value={settings.defaultRefreshIntervalMinutes}
                            onChange={(event) =>
                                update.mutate({ defaultRefreshIntervalMinutes: Number(event.target.value) || 15 })
                            }
                        />
                    </label>
                    <label className="glass-soft grid gap-2 rounded-lg p-5 text-sm text-mist/58">
                        Theme
                        <Select
                            value={settings.theme}
                            onValueChange={(value) => update.mutate({ theme: value as SettingsRecord['theme'] })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Theme" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="dark">Dark</SelectItem>
                                <SelectItem value="light">Light</SelectItem>
                                <SelectItem value="system">System</SelectItem>
                            </SelectContent>
                        </Select>
                    </label>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                    <Button variant="secondary" onClick={exportLedger}>
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Copied export' : 'Copy ledger JSON'}
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="secondary">
                                <Download size={16} />
                                Clear history
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Clear all usage history?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This deletes every locally stored usage snapshot while keeping your providers and
                                    settings.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => clearHistory.mutate()}>
                                    Clear history
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive">
                                <Trash2 size={16} />
                                Reset app data
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Reset app data?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This deletes all providers, encrypted secrets, saved sessions, developer logs, and
                                    history. This cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => clearAll.mutate()}>Reset app data</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </div>
    );
}

function AddProviderDialog({ onClose }: { onClose: () => void }): ReactElement {
    const queryClient = useQueryClient();
    const [kind, setKind] = useState<ProviderKind>('openai-api');
    const definition = PROVIDER_DEFINITIONS.find((item) => item.kind === kind)!;
    const [name, setName] = useState(definition.defaultName);
    const [credential, setCredential] = useState('');
    const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(15);
    const [alertCreditRemaining, setAlertCreditRemaining] = useState('');
    const [alertMonthlySpend, setAlertMonthlySpend] = useState('');
    const requiresCredential = definition.source === 'api' && definition.kind !== 'codex';

    const create = useMutation({
        mutationFn: (input: CreateProviderInput) => api.createProvider(input),
        onSuccess: async (provider) => {
            queryClient.invalidateQueries({ queryKey: ['app-state'] });
            if (provider.source === 'portal' || provider.kind === 'codex') {
                try {
                    await api.loginProvider(provider.id);
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Provider login failed.');
                }
            }
            onClose();
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not create provider.'),
    });

    const submit = () => {
        if (requiresCredential && !credential.trim()) return;
        create.mutate({
            kind,
            name,
            credential: requiresCredential ? credential : undefined,
            refreshIntervalMinutes,
            alertCreditRemaining: alertCreditRemaining ? Number(alertCreditRemaining) : null,
            alertMonthlySpend: alertMonthlySpend ? Number(alertMonthlySpend) : null,
        });
    };

    return (
        <div className="fixed inset-0 grid place-items-center bg-ink/70 p-6 backdrop-blur-xl" onMouseDown={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="glass w-full max-w-2xl rounded-lg p-6"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-sm text-mist/40 uppercase">New provider</div>
                        <h2 className="mt-1 text-2xl font-semibold">Connect usage source</h2>
                    </div>
                    <Button variant="icon" size="icon" onClick={onClose}>
                        <X size={16} />
                    </Button>
                </div>

                <div className="mt-6 grid grid-cols-4 gap-2">
                    {PROVIDER_DEFINITIONS.map((item) => (
                        <Button
                            variant="secondary"
                            key={item.kind}
                            className={cn(
                                'h-16 justify-start rounded-lg border px-3 py-3 text-left text-sm transition',
                                item.kind === kind
                                    ? 'border-plasma bg-plasma/12'
                                    : 'border-white/10 bg-white/[0.035] hover:bg-white/[0.07]',
                            )}
                            onClick={() => {
                                setKind(item.kind);
                                setName(item.defaultName);
                            }}
                        >
                            <span
                                className={cn(
                                    'h-1.5 w-10 shrink-0 rounded-full bg-gradient-to-r',
                                    providerAccent(item.kind),
                                )}
                            />
                            <span className="min-w-0 flex-1 leading-tight">{item.label}</span>
                        </Button>
                    ))}
                </div>

                <div className="mt-5 grid gap-4">
                    <Field label="Display name" value={name} onChange={setName} />
                    {requiresCredential ? (
                        <Field label={definition.credentialLabel} value={credential} onChange={setCredential} secret />
                    ) : (
                        <div className="rounded-lg border border-orchid/25 bg-orchid/10 px-4 py-3 text-sm text-mist/75">
                            {definition.setupHint}
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                        <Field
                            label="Refresh minutes"
                            value={String(refreshIntervalMinutes)}
                            onChange={(v) => setRefreshIntervalMinutes(Number(v) || 15)}
                        />
                        <Field
                            label="Low credit alert"
                            value={alertCreditRemaining}
                            onChange={setAlertCreditRemaining}
                        />
                        <Field label="Monthly spend alert" value={alertMonthlySpend} onChange={setAlertMonthlySpend} />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button disabled={create.isPending || (requiresCredential && !credential.trim())} onClick={submit}>
                        {create.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        Connect
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

function EditProviderDialog({
    provider,
    onClose,
}: {
    provider: ProviderWithSnapshot;
    onClose: () => void;
}): ReactElement {
    const queryClient = useQueryClient();
    const definition = PROVIDER_DEFINITIONS.find((item) => item.kind === provider.kind)!;
    const [name, setName] = useState(provider.name);
    const [credential, setCredential] = useState('');
    const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(provider.refreshIntervalMinutes);
    const [alertCreditRemaining, setAlertCreditRemaining] = useState(provider.alertCreditRemaining?.toString() ?? '');
    const [alertMonthlySpend, setAlertMonthlySpend] = useState(provider.alertMonthlySpend?.toString() ?? '');

    const update = useMutation({
        mutationFn: (input: UpdateProviderInput) => api.updateProvider(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['app-state'] });
            onClose();
        },
    });

    const submit = () => {
        update.mutate({
            id: provider.id,
            name,
            credential: credential || undefined,
            refreshIntervalMinutes,
            alertCreditRemaining: alertCreditRemaining ? Number(alertCreditRemaining) : null,
            alertMonthlySpend: alertMonthlySpend ? Number(alertMonthlySpend) : null,
        });
    };

    return (
        <div className="fixed inset-0 grid place-items-center bg-ink/70 p-6 backdrop-blur-xl" onMouseDown={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="glass w-full max-w-2xl rounded-lg p-6"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-sm text-mist/40 uppercase">Edit provider</div>
                        <h2 className="mt-1 text-2xl font-semibold">{provider.name}</h2>
                    </div>
                    <Button variant="icon" size="icon" onClick={onClose}>
                        <X size={16} />
                    </Button>
                </div>

                <div className="mt-5 grid gap-4">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-mist/60">
                        {definition.label} ·{' '}
                        {provider.kind === 'codex'
                            ? 'OAuth API connector'
                            : provider.source === 'api'
                              ? 'API connector'
                              : 'Portal session connector'}
                    </div>
                    <Field label="Display name" value={name} onChange={setName} />
                    {provider.source === 'api' && provider.kind !== 'codex' && (
                        <Field
                            label={`Replace ${definition.credentialLabel}`}
                            value={credential}
                            onChange={setCredential}
                            secret
                            placeholder="Leave blank to keep current key"
                        />
                    )}
                    <div className="grid grid-cols-3 gap-3">
                        <Field
                            label="Refresh minutes"
                            value={String(refreshIntervalMinutes)}
                            onChange={(v) => setRefreshIntervalMinutes(Number(v) || 15)}
                        />
                        <Field
                            label="Low credit alert"
                            value={alertCreditRemaining}
                            onChange={setAlertCreditRemaining}
                        />
                        <Field label="Monthly spend alert" value={alertMonthlySpend} onChange={setAlertMonthlySpend} />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button disabled={update.isPending} onClick={submit}>
                        {update.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        Save changes
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

function ProviderRow({
    provider,
    onRefresh,
    onLogin,
    onSuppress,
    onUnsuppress,
    refreshing,
}: {
    provider: ProviderWithSnapshot;
    onRefresh: (id: string) => void;
    onLogin: (id: string) => void;
    onSuppress: (id: string) => void;
    onUnsuppress: (id: string) => void;
    refreshing: boolean;
}): ReactElement {
    const snapshot = provider.latestSnapshot;
    const progress = snapshot?.usagePercent == null ? null : Math.max(0, Math.min(snapshot.usagePercent, 100));
    const metrics = getProviderDisplayMetrics(provider);
    const showProgress = progress != null && provider.kind !== 'groq' && provider.kind !== 'openrouter';
    const isAlerting = ['warning', 'error', 'needs-login'].includes(provider.status);
    return (
        <div className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] transition hover:border-white/18 hover:bg-white/[0.06]">
            <div className={cn('h-1 bg-gradient-to-r', providerAccent(provider.kind))} />
            <div className="grid grid-cols-[minmax(250px,1fr)_minmax(390px,1.35fr)_auto] items-center gap-5 p-5">
                <div>
                    <ProviderIdentity provider={provider} />
                    {showProgress && (
                        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8">
                            <div
                                className={cn('h-full rounded-full bg-gradient-to-r', providerAccent(provider.kind))}
                                style={{ width: `${Math.max(progress, 4)}%` }}
                            />
                        </div>
                    )}
                </div>

                <div
                    className={cn(
                        'grid gap-2',
                        metrics.length === 1 && 'min-w-52 grid-cols-1 justify-self-start',
                        metrics.length === 2 && 'grid-cols-2 justify-self-stretch',
                        metrics.length > 2 && 'grid-cols-4',
                    )}
                >
                    {metrics.slice(0, 4).map((metric) => (
                        <div
                            key={metric.label}
                            className={cn('min-w-0 border-l border-white/10 px-3', metrics.length === 1 && 'min-w-52')}
                        >
                            <div className={cn('text-[11px] text-mist/34 uppercase', metrics.length > 2 && 'truncate')}>
                                {metric.label}
                            </div>
                            <MetricValue metric={metric} />
                        </div>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    {(provider.source === 'portal' || provider.kind === 'codex') && (
                        <IconTooltip
                            label={
                                provider.status === 'needs-login' ? 'Sign in to provider' : 'Reconnect provider auth'
                            }
                        >
                            <Button
                                variant="icon"
                                size="icon"
                                aria-label="Log in to provider"
                                onClick={() => onLogin(provider.id)}
                            >
                                <LogIn size={16} />
                            </Button>
                        </IconTooltip>
                    )}
                    {isAlerting && !provider.alertSuppressed && (
                        <IconTooltip label="Suppress this alarm until it clears">
                            <Button
                                variant="icon"
                                size="icon"
                                aria-label="Suppress this alarm"
                                onClick={() => onSuppress(provider.id)}
                            >
                                <BellOff size={16} />
                            </Button>
                        </IconTooltip>
                    )}
                    {provider.alertSuppressed && (
                        <IconTooltip label="Alarms suppressed. Click to resume alerts.">
                            <Button
                                variant="icon"
                                size="icon"
                                className="text-ember"
                                aria-label="Resume alerts"
                                onClick={() => onUnsuppress(provider.id)}
                            >
                                <BellOff size={16} />
                            </Button>
                        </IconTooltip>
                    )}
                    <IconTooltip label={refreshing ? 'Refreshing usage' : 'Refresh usage now'}>
                        <Button
                            variant="icon"
                            size="icon"
                            aria-label="Refresh usage now"
                            onClick={() => onRefresh(provider.id)}
                        >
                            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        </Button>
                    </IconTooltip>
                </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-xs text-mist/40">
                <span className="flex items-center gap-2">
                    <span>
                        {provider.kind === 'codex'
                            ? 'OAuth API source'
                            : provider.source === 'api'
                              ? 'API source'
                              : 'Portal session'}{' '}
                        · every {provider.refreshIntervalMinutes} min
                    </span>
                    {provider.alertSuppressed && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ember/15 px-2 py-0.5 text-ember">
                            <BellOff size={11} />
                            Alarms suppressed
                        </span>
                    )}
                </span>
                <span>Last sync {formatRelative(provider.lastSyncedAt)}</span>
            </div>
        </div>
    );
}

function getProviderDisplayMetrics(provider: ProviderWithSnapshot): UsageMetric[] {
    const snapshot = provider.latestSnapshot;

    if (provider.kind === 'openai-api') {
        if (snapshot?.spendUsd != null) {
            return [
                {
                    label: 'Monthly spend',
                    ...currencyMetricValue(snapshot.spendUsd),
                },
            ];
        }
        const monthlySpend = snapshot?.metrics.find((metric) => metric.label.toLowerCase().includes('spend'));
        return monthlySpend
            ? [{ ...monthlySpend, label: 'Monthly spend' }]
            : [{ label: 'Monthly spend', value: 'Not synced', tone: 'neutral' }];
    }

    if (provider.kind === 'groq') {
        if (snapshot?.spendUsd != null) {
            return [
                {
                    label: 'Current spend',
                    ...currencyMetricValue(snapshot.spendUsd),
                },
            ];
        }
        const currentSpend = snapshot?.metrics.find((metric) => metric.label.toLowerCase() === 'current spend');
        return currentSpend ? [currentSpend] : [{ label: 'Current spend', value: 'Not synced', tone: 'neutral' }];
    }

    if (provider.kind === 'codex' && snapshot?.metrics.length) {
        const quotaMetrics = snapshot.metrics.filter((metric) =>
            ['5-hour remaining', 'weekly remaining'].includes(metric.label.toLowerCase()),
        );
        if (quotaMetrics.length) return quotaMetrics;
    }

    if (provider.kind === 'opencode' && snapshot?.metrics.length) {
        return snapshot.metrics;
    }

    if (snapshot?.metrics.length) return snapshot.metrics.map((metric) => enrichCurrencyMetric(metric, snapshot));

    return [{ label: 'Status', value: provider.statusMessage ?? 'Not synced', tone: 'neutral' }];
}

function enrichCurrencyMetric(metric: UsageMetric, snapshot: UsageSnapshot): UsageMetric {
    const label = metric.label.toLowerCase();
    const isSpendMetric = /spend|spent|used/.test(label) && snapshot.spendUsd != null;
    const isRemainingMetric = /remaining|balance/.test(label) && snapshot.remainingUsd != null;

    if (isSpendMetric) return { ...metric, ...currencyMetricValue(snapshot.spendUsd!) };
    if (isRemainingMetric) return { ...metric, ...currencyMetricValue(snapshot.remainingUsd!) };
    return metric;
}

function HistorySnapshotSummary({ snapshot }: { snapshot: UsageSnapshot }): ReactElement {
    if (snapshot.spendUsd != null) {
        return (
            <div className={cn('flex h-9 items-center gap-1.5 text-sm leading-none', statusTone(snapshot.status))}>
                <CurrencyValue value={snapshot.spendUsd} className="leading-none" />
                <span className="leading-none">spent</span>
            </div>
        );
    }

    if (snapshot.remainingUsd != null) {
        return (
            <div className={cn('flex h-9 items-center gap-1.5 text-sm leading-none', statusTone(snapshot.status))}>
                <CurrencyValue value={snapshot.remainingUsd} className="leading-none" />
                <span className="leading-none">remaining</span>
            </div>
        );
    }

    return (
        <div className={cn('flex h-9 items-center text-sm leading-none', statusTone(snapshot.status))}>
            {snapshot.summary}
        </div>
    );
}

function MetricValue({ metric }: { metric: UsageMetric }): ReactElement {
    const value = (
        <span
            className={cn(
                'mt-1 inline-block max-w-full truncate text-base font-semibold',
                metric.emphasis === 'dotted' && 'cursor-help underline decoration-dotted underline-offset-4',
                metric.tone === 'good' && 'text-plasma',
                metric.tone === 'warning' && 'text-ember',
                metric.tone === 'danger' && 'text-rose-300',
            )}
        >
            {metric.value}
        </span>
    );

    if (!metric.tooltip) return value;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{value}</TooltipTrigger>
            <TooltipContent>{metric.tooltip}</TooltipContent>
        </Tooltip>
    );
}

function ProviderIdentity({ provider }: { provider: ProviderWithSnapshot }): ReactElement {
    const definition = PROVIDER_DEFINITIONS.find((item) => item.kind === provider.kind);
    return (
        <div className="flex items-center gap-3">
            <div className={cn('h-12 w-12 rounded-lg bg-gradient-to-br shadow-lg', providerAccent(provider.kind))} />
            <div>
                <div className="flex items-center gap-2">
                    <h3 className="text-lg leading-tight font-semibold">{provider.name}</h3>
                    <span className={cn('text-xs capitalize', statusTone(provider.status))}>
                        {provider.status.replace('-', ' ')}
                    </span>
                </div>
                <div className="mt-1 text-sm text-mist/45">{definition?.label}</div>
            </div>
        </div>
    );
}

function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }): ReactElement {
    return (
        <div className="flex items-end justify-between">
            <div>
                <div className="text-sm text-mist/40 uppercase">{eyebrow}</div>
                <h1 className="mt-1 text-4xl font-semibold">{title}</h1>
            </div>
            {action}
        </div>
    );
}

function NavButton({
    icon: Icon,
    label,
    active,
    onClick,
    collapsed,
}: {
    icon: typeof LayoutDashboard;
    label: string;
    active: boolean;
    onClick: () => void;
    collapsed: boolean;
}): ReactElement {
    return (
        <Button
            variant="ghost"
            title={collapsed ? label : undefined}
            className={cn(
                'flex h-10 w-full justify-start gap-3 rounded-lg px-3 text-left text-sm text-mist/62 transition hover:bg-white/[0.07] hover:text-mist',
                active && 'bg-white/[0.09] text-mist',
                collapsed && 'justify-center px-0',
            )}
            onClick={onClick}
        >
            <Icon size={17} />
            <span className={cn(collapsed && 'hidden')}>{label}</span>
        </Button>
    );
}

function Meta({ label, value }: { label: string; value: string }): ReactElement {
    return (
        <div>
            <div className="text-xs text-mist/40">{label}</div>
            <div className="mt-1 truncate text-mist/85">{value}</div>
        </div>
    );
}

function SettingRow({
    icon: Icon,
    label,
    description,
    value,
    onClick,
}: {
    icon: typeof Power;
    label: string;
    description: string;
    value: boolean;
    onClick: () => void;
}): ReactElement {
    return (
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.045] p-5 text-left">
            <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-lg bg-white/[0.07]">
                    <Icon size={18} className="text-plasma" />
                </div>
                <div>
                    <div className="font-medium">{label}</div>
                    <div className="mt-1 text-sm text-mist/45">{description}</div>
                </div>
            </div>
            <Switch checked={value} onCheckedChange={onClick} />
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    secret,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    secret?: boolean;
    placeholder?: string;
}): ReactElement {
    return (
        <label className="grid gap-2 text-sm text-mist/58">
            {label}
            <Input
                type={secret ? 'password' : 'text'}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
            />
        </label>
    );
}

function EmptyState({ onAdd }: { onAdd: () => void }): ReactElement {
    return (
        <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-white/16 bg-white/[0.035] p-10 text-center">
            <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-white/[0.08]">
                    <KeyRound className="text-plasma" />
                </div>
                <h2 className="mt-4 text-2xl font-semibold">No providers yet</h2>
                <p className="mt-2 max-w-md text-sm text-mist/50">
                    Add API-backed or portal-backed accounts to start collecting a local usage ledger.
                </p>
                <Button className="mx-auto mt-5" onClick={onAdd}>
                    <Plus size={17} />
                    Add provider
                </Button>
            </div>
        </div>
    );
}

function showRefreshToasts(snapshots: UsageSnapshot[]): void {
    for (const snapshot of snapshots) {
        if (snapshot.status === 'error') toast.error(snapshot.summary || 'Provider refresh failed.');
        if (snapshot.status === 'needs-login') toast.warning(snapshot.summary || 'Provider needs login.');
    }
}

function formatLogValue(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value ?? null, null, 2);
    } catch {
        return String(value);
    }
}

function CurrencyValue({ value, className }: { value: number; className?: string }): ReactElement {
    const display = currencyMetricValue(value);
    const content = (
        <span
            className={cn(
                'inline-block max-w-full truncate',
                display.emphasis === 'dotted' && 'cursor-help border-b border-dotted border-current pb-0.5',
                className,
            )}
        >
            {display.value}
        </span>
    );

    if (!display.tooltip) return content;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent>{display.tooltip}</TooltipContent>
        </Tooltip>
    );
}

function currencyMetricValue(value: number): Pick<UsageMetric, 'value' | 'tooltip' | 'emphasis'> {
    if (value > 0 && value < 0.01) {
        return {
            value: '<$0.01',
            tooltip: formatCurrencyPrecise(value),
            emphasis: 'dotted',
        };
    }
    return { value: formatCurrency(value) };
}

function summarize(state?: AppState): {
    spendUsd: number;
    remainingUsd: number | null;
    attention: number;
    providers: number;
    snapshots: string;
    lastSync: string;
} {
    if (!state)
        return { spendUsd: 0, remainingUsd: null, attention: 0, providers: 0, snapshots: '0', lastSync: 'Never' };
    const latest = state.providers.map((provider) => provider.latestSnapshot).filter(Boolean) as UsageSnapshot[];
    const spend = latest.reduce((total, snap) => total + (snap.spendUsd ?? 0), 0);
    const remainingValues = latest.map((snap) => snap.remainingUsd).filter((value): value is number => value != null);
    const remaining = remainingValues.reduce((total, value) => total + value, 0);
    const attention = state.providers.filter((provider) =>
        ['warning', 'error', 'needs-login'].includes(provider.status),
    ).length;
    const lastSync = state.providers
        .map((provider) => provider.lastSyncedAt)
        .filter(Boolean)
        .sort()
        .at(-1);

    return {
        spendUsd: spend,
        remainingUsd: remainingValues.length ? remaining : null,
        attention,
        providers: state.providers.length,
        snapshots: state.history.length.toLocaleString(),
        lastSync: formatRelative(lastSync ?? null),
    };
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatCurrencyAxis(value: number): string {
    if (value > 0 && value < 1) return '<$1';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(value);
}

function formatCurrencyPrecise(value: number): string {
    if (value > 0 && value < 0.01) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 8,
        }).format(value);
    }
    return formatCurrency(value);
}
