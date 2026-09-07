import type { AppSnapshot } from "@/lib/types";

export interface MealReviewSummary {
  scanCount: number;
  manualScanCount: number;
  aiScanCount: number;
  unverifiedScanCount: number;
  correctionCount: number;
  label: string;
}

/**
 * Describes what students actually did after a plate observation.
 * A confirmed scan without a correction row is a review, not a correction.
 */
export function summarizeMealReview(
  snapshot: Pick<AppSnapshot, "scans" | "detections" | "corrections">,
  mealId: string,
): MealReviewSummary {
  const scans = snapshot.scans.filter(
    (scan) => scan.mealRecordId === mealId && scan.status === "confirmed",
  );
  const scanIds = new Set(scans.map((scan) => scan.id));
  const detectionIds = new Set(
    snapshot.detections
      .filter((detection) => scanIds.has(detection.scanId))
      .map((detection) => detection.id),
  );
  const correctionCount = new Set(
    snapshot.corrections
      .filter((correction) => detectionIds.has(correction.detectionId))
      .map((correction) => correction.detectionId),
  ).size;
  const manualScanCount = scans.filter(
    (scan) => scan.analysisKind === "human-manual",
  ).length;
  const aiScanCount = scans.filter(
    (scan) =>
      scan.analysisKind === "mock-ai" || scan.analysisKind === "real-ai",
  ).length;
  const unverifiedScanCount = scans.filter(
    (scan) => scan.analysisKind === "source-unverified",
  ).length;

  let label = "尚無餐盤觀察，目前只有餐期秤重";
  if (scans.length > 0) {
    const reviewState =
      correctionCount > 0
        ? `已人工修正 ${correctionCount} 項`
        : "已人工確認，0 項調整";
    const evidenceState = aiScanCount
      ? "AI 原始值保留"
      : manualScanCount
        ? "人工判讀已確認"
        : "來源待確認";
    const manualState =
      (aiScanCount || unverifiedScanCount) && manualScanCount
        ? `含 ${manualScanCount} 份人工判讀`
        : undefined;
    const unverifiedState =
      unverifiedScanCount && (aiScanCount || manualScanCount)
        ? `含 ${unverifiedScanCount} 份來源待確認`
        : undefined;
    label = [reviewState, evidenceState, manualState, unverifiedState]
      .filter(Boolean)
      .join(" · ");
  }

  return {
    scanCount: scans.length,
    manualScanCount,
    aiScanCount,
    unverifiedScanCount,
    correctionCount,
    label,
  };
}
