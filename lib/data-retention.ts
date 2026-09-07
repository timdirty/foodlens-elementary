import { addCalendarDays, todayInTaipei } from "@/lib/date";
import type { AppSnapshot, DataRetentionPreview, PlateScan } from "@/lib/types";

export const DATA_RETENTION_BATCH_LIMIT = 500;

function taipeiDateOfTimestamp(value: string) {
  return todayInTaipei(new Date(value));
}

function isScanEligible(
  snapshot: AppSnapshot,
  scan: PlateScan,
  cutoffDate: string,
) {
  const meal = snapshot.meals.find((item) => item.id === scan.mealRecordId);
  if (!meal || meal.servedOn >= cutoffDate) return false;
  if (taipeiDateOfTimestamp(scan.createdAt) >= cutoffDate) return false;
  if (taipeiDateOfTimestamp(scan.reviewedAt) >= cutoffDate) return false;
  const detectionIds = new Set(
    snapshot.detections
      .filter((item) => item.scanId === scan.id)
      .map((item) => item.id),
  );
  return !snapshot.corrections.some(
    (item) =>
      detectionIds.has(item.detectionId) &&
      taipeiDateOfTimestamp(item.correctedAt) >= cutoffDate,
  );
}

export function selectExpiredPlateEvidence(
  snapshot: AppSnapshot,
  retentionDays: number,
  referenceDate: string,
) {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  )
    throw new Error("資料保存期限必須介於 1 到 3650 天");
  const cutoffDate = addCalendarDays(referenceDate, -retentionDays);
  const scans = snapshot.scans
    .filter((scan) => isScanEligible(snapshot, scan, cutoffDate))
    .sort((left, right) => {
      const leftMeal = snapshot.meals.find(
        (item) => item.id === left.mealRecordId,
      );
      const rightMeal = snapshot.meals.find(
        (item) => item.id === right.mealRecordId,
      );
      return (
        (leftMeal?.servedOn ?? "").localeCompare(rightMeal?.servedOn ?? "") ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    });
  return { cutoffDate, scans };
}

export function createDataRetentionPreview(
  snapshot: AppSnapshot,
  retentionDays: number,
  referenceDate: string,
  generatedAt = new Date().toISOString(),
): DataRetentionPreview {
  const { cutoffDate, scans } = selectExpiredPlateEvidence(
    snapshot,
    retentionDays,
    referenceDate,
  );
  const mealById = new Map(snapshot.meals.map((meal) => [meal.id, meal]));
  const dates = scans
    .map((scan) => mealById.get(scan.mealRecordId)?.servedOn)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    cutoffDate,
    retentionDays,
    eligibleScanCount: scans.length,
    eligibleImageCount: scans.filter((scan) =>
      Boolean(scan.imageBlob || scan.imagePath),
    ).length,
    affectedMealCount: new Set(scans.map((scan) => scan.mealRecordId)).size,
    preservedMealCount: snapshot.meals.length,
    oldestEligibleDate: dates.at(0),
    newestEligibleDate: dates.at(-1),
    generatedAt,
    batchLimit: DATA_RETENTION_BATCH_LIMIT,
  };
}

export function scrubExpiredPlateEvidence(
  snapshot: AppSnapshot,
  retentionDays: number,
  referenceDate: string,
  limit = DATA_RETENTION_BATCH_LIMIT,
) {
  const selected = selectExpiredPlateEvidence(
    snapshot,
    retentionDays,
    referenceDate,
  ).scans.slice(0, limit);
  const scanIds = new Set(selected.map((scan) => scan.id));
  const detectionIds = new Set(
    snapshot.detections
      .filter((item) => scanIds.has(item.scanId))
      .map((item) => item.id),
  );
  snapshot.scans = snapshot.scans.filter((item) => !scanIds.has(item.id));
  snapshot.detections = snapshot.detections.filter(
    (item) => !detectionIds.has(item.id),
  );
  snapshot.corrections = snapshot.corrections.filter(
    (item) => !detectionIds.has(item.detectionId),
  );
  return {
    deletedScanCount: selected.length,
    deletedImageCount: selected.filter((scan) =>
      Boolean(scan.imageBlob || scan.imagePath),
    ).length,
    affectedMealCount: new Set(selected.map((scan) => scan.mealRecordId)).size,
  };
}
