import { describe, expect, it } from "vitest";
import {
  calculateBmi,
  calculateWeightTrend,
  validatePlausibleRange,
  ImplausibleMeasurementError,
} from "@/lib/domain/health";
import { classifyHealthSafety } from "@/lib/agents/healthSafety";

describe("calculateBmi", () => {
  it("computes BMI and classifies within WHO bands", () => {
    expect(calculateBmi(70, 175)).toEqual({ bmi: 22.9, classification: "normal" });
    expect(calculateBmi(50, 175)).toEqual({ bmi: 16.3, classification: "underweight" });
    expect(calculateBmi(85, 175)).toEqual({ bmi: 27.8, classification: "overweight" });
    expect(calculateBmi(110, 175)).toEqual({ bmi: 35.9, classification: "obese" });
  });

  it("rejects implausible inputs before computing anything", () => {
    expect(() => calculateBmi(5, 175)).toThrow(ImplausibleMeasurementError);
    expect(() => calculateBmi(70, 20)).toThrow(ImplausibleMeasurementError);
  });
});

describe("calculateWeightTrend", () => {
  it("returns null with fewer than two points", () => {
    expect(calculateWeightTrend([])).toBeNull();
    expect(calculateWeightTrend([{ takenAt: new Date(), weightKg: 70 }])).toBeNull();
  });

  it("computes delta/direction from first to last, independent of array order", () => {
    const points = [
      { takenAt: new Date("2026-02-01"), weightKg: 78 },
      { takenAt: new Date("2026-01-01"), weightKg: 82 },
      { takenAt: new Date("2026-01-15"), weightKg: 80 },
    ];
    const trend = calculateWeightTrend(points);
    expect(trend).not.toBeNull();
    expect(trend?.firstWeightKg).toBe(82);
    expect(trend?.lastWeightKg).toBe(78);
    expect(trend?.deltaKg).toBe(-4);
    expect(trend?.direction).toBe("losing");
    expect(trend?.daysSpanned).toBe(31);
  });

  it("classifies tiny deltas as stable noise, not a trend", () => {
    const trend = calculateWeightTrend([
      { takenAt: new Date("2026-01-01"), weightKg: 80 },
      { takenAt: new Date("2026-01-08"), weightKg: 80.1 },
    ]);
    expect(trend?.direction).toBe("stable");
  });
});

describe("validatePlausibleRange", () => {
  it("accepts values inside the range", () => {
    expect(() => validatePlausibleRange("weight_kg", 70)).not.toThrow();
  });
  it("rejects values outside the range with the field/bounds in the error", () => {
    try {
      validatePlausibleRange("weight_kg", 500);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ImplausibleMeasurementError);
      expect((err as ImplausibleMeasurementError).field).toBe("weight_kg");
    }
  });
});

describe("classifyHealthSafety", () => {
  it("classifies emergency/diagnostic/prescription language as medical", () => {
    expect(classifyHealthSafety("Estou com dor no peito")).toBe("medical");
    expect(classifyHealthSafety("Qual o diagnóstico pra isso?")).toBe("medical");
    expect(classifyHealthSafety("Qual a dose de paracetamol que posso tomar?")).toBe("medical");
  });

  it("classifies trend/energy language as health-sensitive, not medical", () => {
    expect(classifyHealthSafety("Estou sentindo muito cansaço ultimamente")).toBe("health-sensitive");
  });

  it("classifies general wellness questions as wellness", () => {
    expect(classifyHealthSafety("Quantos copos de água devo beber por dia?")).toBe("wellness");
  });
});
