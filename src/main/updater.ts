import { BrowserWindow, app } from 'electron';
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater';

import { IPC_CHANNELS, type UpdateState } from '../shared/ipc';

const { autoUpdater } = electronUpdater;

const isSimulatorEnabled = !app.isPackaged;

const INITIAL_STATE: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    progressPercent: null,
    message: null,
    simulator: isSimulatorEnabled,
};

let state: UpdateState = { ...INITIAL_STATE };
let initialized = false;
let initialCheckScheduled = false;
let lastManualCheck = 0;
const MANUAL_CHECK_COOLDOWN_MS = 30_000;

function publishState(): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.updateStateChanged, state);
        }
    }
}

function setState(partial: Partial<UpdateState>): void {
    state = { ...state, ...partial };
    publishState();
}

function isManualCheckAllowed(): boolean {
    return Date.now() - lastManualCheck >= MANUAL_CHECK_COOLDOWN_MS;
}

export function getUpdateState(): UpdateState {
    return state;
}

export function checkForUpdates(): { ok: boolean; reason?: string } {
    if (isSimulatorEnabled) {
        setState({ status: 'checking', message: null });
        return { ok: true };
    }
    if (!isManualCheckAllowed()) {
        return { ok: false, reason: 'Please wait a moment before checking again.' };
    }
    lastManualCheck = Date.now();
    if (state.status === 'downloading' || state.status === 'downloaded') {
        return { ok: false, reason: 'An update is already in progress.' };
    }
    setState({ status: 'checking', message: null });
    void autoUpdater.checkForUpdates();
    return { ok: true };
}

export function installUpdate(): void {
    if (isSimulatorEnabled) {
        setState({ status: 'idle', availableVersion: null, progressPercent: null, message: null });
        return;
    }
    if (state.status !== 'downloaded') return;
    autoUpdater.quitAndInstall();
}

export function simulateUpdateState(partial: Partial<UpdateState>): void {
    if (!isSimulatorEnabled) return;
    setState(partial);
}

export function setupAutoUpdater(): void {
    if (initialized) return;
    initialized = true;

    if (isSimulatorEnabled) {
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => {
        setState({ status: 'checking', message: null });
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
        setState({
            status: 'available',
            availableVersion: info.version,
            message: 'A new version is available. Downloading in the background…',
        });
    });
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
        setState({
            status: 'idle',
            availableVersion: null,
            message: `You're on the latest version (${info.version}).`,
        });
    });
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        setState({
            status: 'downloading',
            progressPercent: Math.round(progress.percent),
        });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
        setState({
            status: 'downloaded',
            availableVersion: info.version,
            progressPercent: 100,
            message: `Version ${info.version} is ready to install.`,
        });
    });
    autoUpdater.on('error', (error: Error) => {
        setState({
            status: 'error',
            message: error.message || 'Update check failed.',
        });
    });

    if (!initialCheckScheduled) {
        initialCheckScheduled = true;
        setTimeout(() => {
            setState({ status: 'checking', message: null });
            void autoUpdater.checkForUpdates();
        }, 5_000);
    }
}
