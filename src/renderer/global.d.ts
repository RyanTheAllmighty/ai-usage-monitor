/// <reference types="vite/client" />

import type { AiUsageMonitorApi } from '../shared/ipc';

declare module '*.css';

declare global {
    interface Window {
        aiUsageMonitor: AiUsageMonitorApi;
    }
}

export {};
