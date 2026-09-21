import type { PunchType, TimeEntry, Profile } from "./types";
export const TIME_ZONE = "America/Sao_Paulo";
export const DAILY_TARGET_MINUTES = 528;
export const ORDER: PunchType[] = ["entry_1", "exit_1", "entry_2", "exit_2"];
export function dayKey(value: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function formatTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString("pt-BR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function formatDate(value: Date | string): string {
  const key =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : dayKey(value);
  return key.split("-").reverse().join("/");
}
export function formatDateLong(value: Date | string): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
export function formatDuration(minutes: number): string {
  const n = Math.round(Math.abs(minutes));
  return `${minutes < 0 ? "-" : ""}${Math.floor(n / 60)}h${String(n % 60).padStart(2, "0")}m`;
}
export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start: `${month}-01T00:00:00-03:00`, end: `${next}T00:00:00-03:00` };
}
export function getTodayEntries(
  entries: TimeEntry[],
  now = new Date(),
): TimeEntry[] {
  return entries
    .filter((e) => !e.voided_at && dayKey(e.timestamp) === dayKey(now))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
export function getNextPunchType(entries: TimeEntry[]): PunchType | null {
  const recorded = new Set(getTodayEntries(entries).map((e) => e.type));
  return ORDER.find((t) => !recorded.has(t)) ?? null;
}
export function calculateWorkedMinutes(
  entries: TimeEntry[],
  live = false,
  now = new Date(),
): number {
  const days = new Map<string, TimeEntry[]>();
  for (const e of entries.filter((e) => !e.voided_at)) {
    const key = dayKey(e.timestamp);
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  let ms = 0;
  for (const [key, day] of days) {
    const map = new Map(
      day.map((e) => [e.type, new Date(e.timestamp).getTime()]),
    );
    for (const [start, end] of [
      ["entry_1", "exit_1"],
      ["entry_2", "exit_2"],
    ] as [PunchType, PunchType][]) {
      const a = map.get(start);
      const b = map.get(end);
      if (a !== undefined && b !== undefined && b >= a) ms += b - a;
      else if (
        a !== undefined &&
        b === undefined &&
        live &&
        key === dayKey(now)
      )
        ms += Math.max(0, now.getTime() - a);
    }
  }
  return Math.floor(ms / 60000);
}
export interface DaySummary {
  date: string;
  entries: TimeEntry[];
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  status: "complete" | "partial" | "empty" | "future" | "off";
}
export function summarizeMonth(
  entries: TimeEntry[],
  month: string,
  profile?: Profile,
  now = new Date(),
): DaySummary[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = dayKey(now);
  const target =
    profile?.work_schedule?.daily_target_minutes ?? DAILY_TARGET_MINUTES;
  const workdays = profile?.work_schedule?.work_days ?? [1, 2, 3, 4, 5];
  return Array.from({ length: last }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const day = entries.filter(
      (e) => !e.voided_at && dayKey(e.timestamp) === date,
    );
    const future = date > today;
    const off =
      !workdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ||
      !!(profile?.attendance_start && date < profile.attendance_start);
    const complete = new Set(day.map((e) => e.type)).size === 4;
    const workedMinutes = calculateWorkedMinutes(day);
    const expectedMinutes = off || future ? 0 : target;
    const balanceMinutes = future
      ? 0
      : date === today && !complete
        ? 0
        : day.length && !complete
          ? 0
          : workedMinutes - expectedMinutes;
    const status: DaySummary["status"] = future
      ? "future"
      : complete
        ? "complete"
        : day.length
          ? "partial"
          : off
            ? "off"
            : "empty";
    return {
      date,
      entries: day,
      workedMinutes,
      expectedMinutes,
      balanceMinutes,
      status,
    };
  });
}
export function getDeviceInfo(): string {
  return navigator.userAgent.slice(0, 300);
}
