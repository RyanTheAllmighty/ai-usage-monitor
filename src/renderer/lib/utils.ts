import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';
import type { ProviderKind, ProviderStatus } from '../../shared/types';

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

export function providerAccent(kind: ProviderKind): string {
    return {
        'openai-api': 'from-plasma/80 to-emerald-300/70',
        openrouter: 'from-orchid/80 to-fuchsia-300/70',
        groq: 'from-ember/90 to-rose-300/70',
        codex: 'from-sky-300/90 to-plasma/70',
    }[kind];
}

export function statusTone(status: ProviderStatus): string {
    return {
        healthy: 'text-plasma',
        warning: 'text-ember',
        error: 'text-rose-300',
        'needs-login': 'text-orchid',
        syncing: 'text-sky-300',
        unknown: 'text-mist/60',
    }[status];
}

export function formatRelative(date: string | null): string {
    if (!date) return 'Never';
    const delta = Date.now() - new Date(date).getTime();
    const minutes = Math.max(1, Math.round(delta / 60_000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

export function formatShortDate(date: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(date));
}
