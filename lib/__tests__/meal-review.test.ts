import { describe, expect, it } from "vitest";
import { summarizeMealReview } from "@/lib/meal-review";
import type {
  AppSnapshot,
  PlateScan,
  ScanCorrection,
  ScanDetection,
} from "@/lib/types";

const scan = (
  id: string,
  analysisKind: PlateScan["analysisKind"],
  status: PlateScan["status"] = "confirmed",
): PlateScan => ({
  id,
  mealRecordId: "meal-1",
  analysisKind,
  menuContext: null,
  provider: "provider-is-audit-detail-only",
  model: "test-model",
  schemaVersion: "1",
  status,
  reviewedAt: "2026-08-31T12:00:00.000Z",
  createdAt: "2026-08-31T12:00:00.000Z",
});

const detection = (id: string, scanId: string): ScanDetection => ({
  id,
  scanId,
  category: "vegetable",
  label: "青菜",
  aiOriginalG: 100,
  aiRemainingRatio: 0.3,
  aiRemainingG: 30,
  confidence: 0.8,
  sortOrder: 0,
});

const correction = (id: string, detectionId: string): ScanCorrection => ({
  id,
  detectionId,
  correctedCategory: "vegetable",
  correctedLabel: "青菜",
  correctedOriginalG: 100,
  correctedRemainingRatio: 0.4,
  correctedRemainingG: 40,
  note: "學生人工修正",
  correctedAt: "2026-08-31T12:01:00.000Z",
});

const evidence = (
  scans: PlateScan[],
  detections: ScanDetection[] = [],
  corrections: ScanCorrection[] = [],
): Pick<AppSnapshot, "scans" | "detections" | "corrections"> => ({
  scans,
  detections,
  corrections,
});

describe("meal review summary", () => {
  it("沒有餐盤時不宣稱已人工確認", () => {
    const summary = summarizeMealReview(evidence([]), "meal-1");

    expect(summary.label).toBe("尚無餐盤觀察，目前只有餐期秤重");
    expect(summary.scanCount).toBe(0);
  });

  it("學生已檢查但沒有改值時如實顯示 0 項調整", () => {
    const summary = summarizeMealReview(
      evidence([scan("scan-ai", "mock-ai")]),
      "meal-1",
    );

    expect(summary.label).toBe("已人工確認，0 項調整 · AI 原始值保留");
    expect(summary.correctionCount).toBe(0);
  });

  it("只有數值真的改變才顯示人工修正數", () => {
    const detections = [
      detection("detection-1", "scan-ai"),
      detection("detection-2", "scan-ai"),
    ];
    const summary = summarizeMealReview(
      evidence([scan("scan-ai", "mock-ai")], detections, [
        correction("correction-1", "detection-1"),
      ]),
      "meal-1",
    );

    expect(summary.label).toBe("已人工修正 1 項 · AI 原始值保留");
    expect(summary.correctionCount).toBe(1);
  });

  it("人工判讀未改起始值時仍是確認，不是修正", () => {
    const summary = summarizeMealReview(
      evidence([scan("scan-manual", "human-manual")]),
      "meal-1",
    );

    expect(summary.label).toBe("已人工確認，0 項調整 · 人工判讀已確認");
    expect(summary).toMatchObject({
      aiScanCount: 0,
      manualScanCount: 1,
      correctionCount: 0,
    });
  });

  it("混合 AI 與人工判讀時同時交代兩種證據", () => {
    const summary = summarizeMealReview(
      evidence(
        [
          scan("scan-ai", "mock-ai"),
          scan("scan-manual", "human-manual"),
          scan("scan-failed", "mock-ai", "failed"),
        ],
        [detection("detection-1", "scan-manual")],
        [correction("correction-1", "detection-1")],
      ),
      "meal-1",
    );

    expect(summary.label).toBe(
      "已人工修正 1 項 · AI 原始值保留 · 含 1 份人工判讀",
    );
    expect(summary).toMatchObject({
      scanCount: 2,
      aiScanCount: 1,
      manualScanCount: 1,
      correctionCount: 1,
    });
  });

  it("重複修正列不會把同一個食物項目重複計數", () => {
    const summary = summarizeMealReview(
      evidence(
        [scan("scan-ai", "real-ai")],
        [detection("detection-1", "scan-ai")],
        [
          correction("correction-1", "detection-1"),
          correction("correction-legacy-duplicate", "detection-1"),
        ],
      ),
      "meal-1",
    );

    expect(summary.correctionCount).toBe(1);
    expect(summary.label).toContain("已人工修正 1 項");
  });

  it("舊 provider 名稱即使看似真實模型仍顯示來源待確認", () => {
    const summary = summarizeMealReview(
      evidence([scan("scan-legacy", "source-unverified")]),
      "meal-1",
    );

    expect(summary.label).toBe("已人工確認，0 項調整 · 來源待確認");
    expect(summary).toMatchObject({
      aiScanCount: 0,
      manualScanCount: 0,
      unverifiedScanCount: 1,
    });
  });
});
