import { describe, expect, it } from "vitest";
import {
  createDataRetentionPreview,
  scrubExpiredPlateEvidence,
} from "@/lib/data-retention";
import { createDemoSnapshot } from "@/lib/seed";

describe("raw plate-evidence retention", () => {
  it("uses a strict cutoff and keeps class-level meal measurements", () => {
    const snapshot = createDemoSnapshot();
    const beforeMeals = snapshot.meals.length;
    const beforeSafety = structuredClone(snapshot.mealSafetyObservations);
    const preview = createDataRetentionPreview(
      snapshot,
      45,
      "2026-10-16",
      "2026-10-16T12:00:00+08:00",
    );

    expect(preview.cutoffDate).toBe("2026-09-01");
    expect(preview.eligibleScanCount).toBeGreaterThan(0);
    const result = scrubExpiredPlateEvidence(snapshot, 45, "2026-10-16");
    expect(result.deletedScanCount).toBe(preview.eligibleScanCount);
    expect(snapshot.meals).toHaveLength(beforeMeals);
    expect(snapshot.mealSafetyObservations).toEqual(beforeSafety);
  });

  it("protects a recently created scan even when its meal date is old", () => {
    const snapshot = createDemoSnapshot();
    const oldMeal = snapshot.meals[0];
    const scan = snapshot.scans.find(
      (item) => item.mealRecordId === oldMeal.id,
    );
    if (!scan) throw new Error("seed scan missing");
    scan.createdAt = "2026-10-15T12:00:00+08:00";
    scan.reviewedAt = "2026-10-15T12:00:00+08:00";

    const preview = createDataRetentionPreview(snapshot, 45, "2026-10-16");
    const selected = snapshot.scans.filter(
      (item) => item.mealRecordId === oldMeal.id,
    ).length;
    expect(preview.eligibleScanCount).toBeLessThan(snapshot.scans.length);
    expect(selected).toBeGreaterThan(0);
    scrubExpiredPlateEvidence(snapshot, 45, "2026-10-16");
    expect(snapshot.scans.some((item) => item.id === scan.id)).toBe(true);
  });

  it("protects a scan whose correction was reviewed after the cutoff", () => {
    const snapshot = createDemoSnapshot();
    const correction = snapshot.corrections[0];
    const detection = snapshot.detections.find(
      (item) => item.id === correction.detectionId,
    );
    if (!detection) throw new Error("seed detection missing");
    correction.correctedAt = "2026-10-15T12:00:00+08:00";

    scrubExpiredPlateEvidence(snapshot, 45, "2026-10-16");
    expect(snapshot.scans.some((item) => item.id === detection.scanId)).toBe(
      true,
    );
  });

  it("rejects policy values outside the governed range", () => {
    expect(() =>
      createDataRetentionPreview(createDemoSnapshot(), 0, "2026-10-16"),
    ).toThrow("1 到 3650 天");
  });
});
