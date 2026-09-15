// Deterministic, dependency-free 5-field cron engine — the LLM never decides "when" (same
// discipline as domain/*.ts: IA raciocina, software calcula). IANA timezone correctness comes
// from Intl.DateTimeFormat, which ships the full tz database in Node/V8 — no external library
// needed to get real DST-aware wall-clock <-> UTC conversion (ADR 018: "timezone explícito,
// avaliado sempre no fuso do household, nunca o da máquina do worker").

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number> | "*";
  months: Set<number>;
  daysOfWeek: Set<number>; // 0=Sunday .. 6=Saturday
}

function parseField(field: string, min: number, max: number): Set<number> | "*" {
  if (field === "*") return "*";
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!stepMatch) throw new Error(`invalid cron field segment: "${part}"`);
    const [, base, rangeEnd, stepStr] = stepMatch;
    const step = stepStr ? Number(stepStr) : 1;
    const start = base === "*" ? min : Number(base);
    const end = rangeEnd ? Number(rangeEnd) : base === "*" ? max : start;
    if (start < min || end > max || start > end) {
      throw new Error(`cron field segment "${part}" out of range [${min}, ${max}]`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

/** Standard 5-field cron: "minute hour day-of-month month day-of-week". */
export function parseCron(cronExpr: string): ParsedCron {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron expression must have exactly 5 fields, got ${fields.length}: "${cronExpr}"`);
  }
  const [minuteF, hourF, domF, monthF, dowF] = fields;
  const minutes = parseField(minuteF, 0, 59);
  const hours = parseField(hourF, 0, 23);
  const daysOfMonth = parseField(domF, 1, 31);
  const months = parseField(monthF, 1, 12);
  const daysOfWeek = parseField(dowF, 0, 6);

  return {
    minutes: minutes === "*" ? new Set(Array.from({ length: 60 }, (_, i) => i)) : minutes,
    hours: hours === "*" ? new Set(Array.from({ length: 24 }, (_, i) => i)) : hours,
    daysOfMonth,
    months: months === "*" ? new Set(Array.from({ length: 12 }, (_, i) => i + 1)) : months,
    daysOfWeek: daysOfWeek === "*" ? new Set([0, 1, 2, 3, 4, 5, 6]) : daysOfWeek,
  };
}

interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0=Sunday .. 6=Saturday
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Converts a UTC instant into its wall-clock representation in `timeZone`, using Intl's
 * built-in IANA tz database — correct across DST transitions without any external dependency. */
function wallClockPartsInZone(date: Date, timeZone: string): WallClockParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // ICU quirk: hour12:false can render midnight as "24"
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function matchesDate(cron: ParsedCron, parts: WallClockParts): boolean {
  if (!cron.months.has(parts.month)) return false;
  const domRestricted = cron.daysOfMonth !== "*";
  const dowRestricted = cron.daysOfWeek.size < 7;
  const domMatch = !domRestricted || (cron.daysOfMonth as Set<number>).has(parts.day);
  const dowMatch = cron.daysOfWeek.has(parts.weekday);
  // POSIX cron rule: when BOTH day-of-month and day-of-week are restricted (non-"*"), a date
  // matches if EITHER matches (union), not both (intersection).
  if (domRestricted && dowRestricted) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

const MAX_SEARCH_MINUTES = 400 * 24 * 60; // safety net for pathological expressions (e.g. Feb 30)

/**
 * The next UTC instant, strictly after `referenceDate`, at which `cronExpr` fires when evaluated
 * in `timezone` — never the machine/container's local timezone (ADR 018). Straightforward
 * minute-by-minute scan (deliberately simple over cleverly-optimized: our 3 rituals are all a
 * single fixed daily/weekly hour:minute, so the worst case is ~10080 iterations — trivial) —
 * correct across DST transitions because each minute's wall-clock reading comes from Intl, not
 * from a fixed offset assumption.
 */
export function calculateNextRun(cronExpr: string, timezone: string, referenceDate: Date = new Date()): Date {
  const cron = parseCron(cronExpr);

  let cursor = new Date(referenceDate.getTime() + 60_000);
  cursor.setUTCSeconds(0, 0);

  for (let i = 0; i < MAX_SEARCH_MINUTES; i++) {
    const parts = wallClockPartsInZone(cursor, timezone);
    if (cron.minutes.has(parts.minute) && cron.hours.has(parts.hour) && matchesDate(cron, parts)) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }

  throw new Error(`no matching run found for cron "${cronExpr}" in timezone "${timezone}" within ${MAX_SEARCH_MINUTES} minutes`);
}
