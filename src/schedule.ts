import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

export type PollSchedule = {
  timezone: string;
  /** ISO weekdays: 1=Mon … 7=Sun. Empty = every day. */
  weekdays: number[];
  /** HH:MM in the schedule timezone */
  times: string[];
  /** Offsets from each window (e.g. [0, 60000] = T and T+1m) */
  burstOffsetsMs: number[];
};

export type ScheduledPoll = {
  at: Date;
  windowLabel: string;
  burstIndex: number;
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_PREMIA_TIMES = [
  "08:30",
  "08:42",
  "08:54",
  "09:06",
  "09:18",
  "09:30",
  "09:42",
  "09:54",
  "10:06",
  "10:18",
  "11:18",
  "11:30",
  "11:42",
  "11:54",
  "12:06",
  "12:18",
  "12:30",
  "12:42",
  "12:54",
  "13:06",
  "13:18",
] as const;

function parseHhMm(value: string): { hour: number; minute: number } {
  const m = TIME_RE.exec(value.trim());
  if (!m) {
    throw new Error(`Hora de schedule invàlida (cal HH:MM): ${value}`);
  }
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function zonedParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 1,
  };
}

/** Instant UTC corresponding to a civil datetime in `timeZone`. */
function zonedCivilToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

function addDaysCivil(
  year: number,
  month: number,
  day: number,
  delta: number
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function weekdayAllowed(weekday: number, allowed: number[]): boolean {
  if (!allowed.length) return true;
  return allowed.includes(weekday);
}

export function parseTimesList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => {
      const { hour, minute } = parseHhMm(t);
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    });
}

export function loadScheduleFromFile(filePath: string): Partial<PollSchedule> {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw) as Record<string, unknown>;
  const out: Partial<PollSchedule> = {};
  if (typeof data.timezone === "string") out.timezone = data.timezone;
  if (Array.isArray(data.weekdays)) {
    out.weekdays = data.weekdays.map((n) => Number(n));
  }
  if (Array.isArray(data.times)) {
    out.times = data.times.map(String);
  }
  if (Array.isArray(data.burstOffsetsMs)) {
    out.burstOffsetsMs = data.burstOffsetsMs.map((n) => Number(n));
  }
  return out;
}

export function resolveSchedule(opts: {
  enabled: boolean;
  timezone: string;
  timesCsv: string | null;
  weekdaysCsv: string | null;
  burstCsv: string | null;
  scheduleFile: string | null;
}): PollSchedule | null {
  if (!opts.enabled) return null;

  let timezone = opts.timezone;
  let weekdays = [1, 2, 3, 4, 5];
  let times: string[] = [...DEFAULT_PREMIA_TIMES];
  let burstOffsetsMs = [0, 60_000];

  if (opts.scheduleFile) {
    const abs = path.resolve(opts.scheduleFile);
    if (fs.existsSync(abs)) {
      const fromFile = loadScheduleFromFile(abs);
      if (fromFile.timezone) timezone = fromFile.timezone;
      if (fromFile.weekdays) weekdays = fromFile.weekdays;
      if (fromFile.times?.length) times = fromFile.times.map((t) => {
        const { hour, minute } = parseHhMm(t);
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      });
      if (fromFile.burstOffsetsMs?.length) {
        burstOffsetsMs = fromFile.burstOffsetsMs;
      }
      log.info("Schedule carregat de fitxer", { file: abs, times: times.length });
    } else {
      log.warn("SCHEDULE_FILE no trobat; s'usen defaults Premià", { file: abs });
    }
  }

  if (opts.timesCsv) {
    times = parseTimesList(opts.timesCsv);
  }
  if (opts.weekdaysCsv) {
    weekdays = opts.weekdaysCsv
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => Number(n));
  }
  if (opts.burstCsv) {
    burstOffsetsMs = opts.burstCsv
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => Number(n));
  }

  if (!times.length) {
    throw new Error("Schedule actiu però sense hores (times buides)");
  }

  // Validate
  for (const t of times) parseHhMm(t);

  return {
    timezone,
    weekdays,
    times: [...times].sort(),
    burstOffsetsMs: burstOffsetsMs.filter((n) => Number.isFinite(n) && n >= 0),
  };
}

/**
 * Next poll instant at or after `from` according to schedule + burst offsets.
 */
export function getNextScheduledPoll(
  schedule: PollSchedule,
  from: Date = new Date()
): ScheduledPoll {
  const graceMs = 2_000; // allow slight lateness into the window
  const start = new Date(from.getTime() - graceMs);
  const nowParts = zonedParts(from, schedule.timezone);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const civil = addDaysCivil(
      nowParts.year,
      nowParts.month,
      nowParts.day,
      dayOffset
    );
    const noon = zonedCivilToUtc(
      schedule.timezone,
      civil.year,
      civil.month,
      civil.day,
      12,
      0
    );
    const wd = zonedParts(noon, schedule.timezone).weekday;
    if (!weekdayAllowed(wd, schedule.weekdays)) continue;

    for (const label of schedule.times) {
      const { hour, minute } = parseHhMm(label);
      const base = zonedCivilToUtc(
        schedule.timezone,
        civil.year,
        civil.month,
        civil.day,
        hour,
        minute
      );
      for (let i = 0; i < schedule.burstOffsetsMs.length; i++) {
        const at = new Date(base.getTime() + schedule.burstOffsetsMs[i]!);
        if (at.getTime() >= start.getTime()) {
          return { at, windowLabel: label, burstIndex: i };
        }
      }
    }
  }

  throw new Error("No s'ha trobat cap finestra de schedule en 14 dies");
}

export function msUntil(target: Date, from: Date = new Date()): number {
  return Math.max(0, target.getTime() - from.getTime());
}

export function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
