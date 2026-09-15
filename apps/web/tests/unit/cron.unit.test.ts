import { describe, expect, it } from "vitest";
import { calculateNextRun, parseCron } from "@/lib/scheduler/cron";

describe("parseCron", () => {
  it("parses fixed fields and wildcards", () => {
    const cron = parseCron("0 9 * * 6");
    expect(cron.minutes.has(0)).toBe(true);
    expect(cron.minutes.has(1)).toBe(false);
    expect(cron.hours.has(9)).toBe(true);
    expect(cron.daysOfWeek.has(6)).toBe(true);
    expect(cron.daysOfWeek.size).toBe(1);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCron("0 9 * *")).toThrow();
    expect(() => parseCron("60 9 * * *")).toThrow();
  });
});

describe("calculateNextRun — IANA timezone correctness (ADR 018)", () => {
  it("computes the exact UTC instant for 09:00 America/Sao_Paulo (fixed UTC-3, no DST since 2019)", () => {
    const ref = new Date("2026-02-02T00:00:00.000Z"); // Monday
    const next = calculateNextRun("0 9 * * *", "America/Sao_Paulo", ref);
    expect(next.toISOString()).toBe("2026-02-02T12:00:00.000Z");
  });

  it("computes the next Saturday 09:00 for the weekly_planning ritual", () => {
    const ref = new Date("2026-02-02T00:00:00.000Z"); // Monday
    const next = calculateNextRun("0 9 * * 6", "America/Sao_Paulo", ref);
    expect(next.toISOString()).toBe("2026-02-07T12:00:00.000Z"); // next Saturday, 12:00 UTC
  });

  it("computes the next Sunday 10:00 for the shopping_preparation ritual", () => {
    const ref = new Date("2026-02-02T00:00:00.000Z"); // Monday
    const next = calculateNextRun("0 10 * * 0", "America/Sao_Paulo", ref);
    expect(next.toISOString()).toBe("2026-02-08T13:00:00.000Z"); // next Sunday, 13:00 UTC
  });

  it("is genuinely DST-aware: the same 09:00 local cron resolves to a different UTC offset in January vs July in a DST timezone", () => {
    const jan = calculateNextRun("0 9 * * *", "America/New_York", new Date("2026-01-05T00:00:00.000Z"));
    const jul = calculateNextRun("0 9 * * *", "America/New_York", new Date("2026-07-05T00:00:00.000Z"));
    expect(jan.toISOString()).toBe("2026-01-05T14:00:00.000Z"); // EST = UTC-5
    expect(jul.toISOString()).toBe("2026-07-05T13:00:00.000Z"); // EDT = UTC-4
  });

  it("always returns a result strictly after referenceDate, even when referenceDate is itself an exact match", () => {
    const exactMatch = new Date("2026-02-07T12:00:00.000Z"); // a Saturday 09:00 BRT
    const next = calculateNextRun("0 9 * * 6", "America/Sao_Paulo", exactMatch);
    expect(next.getTime()).toBeGreaterThan(exactMatch.getTime());
    expect(next.toISOString()).toBe("2026-02-14T12:00:00.000Z"); // the FOLLOWING Saturday
  });
});
