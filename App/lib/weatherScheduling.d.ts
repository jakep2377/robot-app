// Type declarations for the shared weather-scheduling helpers. These keep the
// TypeScript app surface in sync with the JS implementation used by tests.
export function getShiftedDate(unixSeconds: number, timezoneSeconds?: number): Date;
export function formatForecastLabel(unixSeconds: number, timezoneSeconds?: number): string;
export function formatShiftedDayKey(unixSeconds: number, timezoneSeconds?: number): string;
export function formatShiftedDayLabel(unixSeconds: number, timezoneSeconds?: number): string;
export function resolveScheduledUnix(dayKey: string, timeText: string, timezoneSeconds?: number): number | null;
