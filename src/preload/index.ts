import { contextBridge, ipcRenderer } from 'electron';
import type { AiUsageMonitorApi } from '../shared/ipc';

import { IPC_CHANNELS } from '../shared/ipc';

const api: AiUsageMonitorApi = {
    getAppState: () => ipcRenderer.invoke(IPC_CHANNELS.getAppState),
    createProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.createProvider, input),
    updateProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateProvider, input),
    deleteProvider: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteProvider, id),
    refreshProvider: (id) => ipcRenderer.invoke(IPC_CHANNELS.refreshProvider, id),
    refreshAll: () => ipcRenderer.invoke(IPC_CHANNELS.refreshAll),
    loginProvider: (id) => ipcRenderer.invoke(IPC_CHANNELS.loginProvider, id),
    clearProviderSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.clearProviderSession, id),
    suppressProviderAlert: (id) => ipcRenderer.invoke(IPC_CHANNELS.suppressProviderAlert, id),
    unsuppressProviderAlert: (id) => ipcRenderer.invoke(IPC_CHANNELS.unsuppressProviderAlert, id),
    updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings),
    getHistory: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.getHistory, providerId),
    getDeveloperLogs: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.getDeveloperLogs, providerId),
    exportLedger: () => ipcRenderer.invoke(IPC_CHANNELS.exportLedger),
    clearHistory: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.clearHistory, providerId),
    deleteHistorySnapshot: (snapshotId) => ipcRenderer.invoke(IPC_CHANNELS.deleteHistorySnapshot, snapshotId),
    clearDeveloperLogs: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.clearDeveloperLogs, providerId),
    clearAllData: () => ipcRenderer.invoke(IPC_CHANNELS.clearAllData),
    windowAction: (action) => ipcRenderer.invoke(IPC_CHANNELS.windowAction, action),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
};

contextBridge.exposeInMainWorld('aiUsageMonitor', api);
