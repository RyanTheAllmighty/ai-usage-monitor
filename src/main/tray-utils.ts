export function formatFiveHourReset(resetAt: number | null | undefined): string {
    const minutes = minutesUntil(resetAt);
    if (minutes == null) return 'unknown';
    if (minutes <= 0) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatWeeklyReset(resetAt: number | null | undefined): string {
    const minutes = minutesUntil(resetAt);
    if (minutes == null) return 'unknown';
    if (minutes <= 0) return 'now';

    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const remainingMinutes = minutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (remainingMinutes > 0 || parts.length === 0) parts.push(`${remainingMinutes}m`);
    return parts.join(' ');
}

export function minutesUntil(resetAt: number | null | undefined): number | null {
    if (resetAt == null) return null;
    return Math.ceil((resetAt * 1000 - Date.now()) / 60_000);
}
