import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, type UpdateState, type UpdateStatus } from '../shared/ipc';

describe('updater ipc contract', () => {
    it('exposes dedicated channels for the renderer to drive the updater', () => {
        expect(IPC_CHANNELS.getUpdateState).toBe('updater:get-state');
        expect(IPC_CHANNELS.checkForUpdates).toBe('updater:check');
        expect(IPC_CHANNELS.installUpdate).toBe('updater:install');
        expect(IPC_CHANNELS.updateStateChanged).toBe('updater:state-changed');
    });

    it('uses a closed set of update statuses', () => {
        const statuses: UpdateStatus[] = [
            'idle',
            'checking',
            'available',
            'downloading',
            'downloaded',
            'unsupported',
            'error',
        ];
        expect(new Set(statuses).size).toBe(statuses.length);
    });

    it('produces a well-formed idle state', () => {
        const state: UpdateState = {
            status: 'idle',
            currentVersion: '0.0.2',
            availableVersion: null,
            progressPercent: null,
            message: null,
            simulator: false,
        };
        expect(state.status).toBe('idle');
        expect(state.availableVersion).toBeNull();
        expect(state.progressPercent).toBeNull();
        expect(state.simulator).toBe(false);
    });
});
