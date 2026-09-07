import { describe, expect, it } from "vitest";
import {
  assessProductReadiness,
  evaluateJudgePreflight,
} from "@/lib/product-readiness";
import { createDemoSnapshot } from "@/lib/seed";

describe("product readiness", () => {
  it("不把固定示範資料誤判成正式校園已啟用", () => {
    const result = assessProductReadiness(createDemoSnapshot(), "demo-local");

    expect(result.demoReady).toBe(false);
    expect(result.judgePreflight.identityReady).toBe(false);
    expect(result.judgePreflight.fixedSeedReady).toBe(true);
    expect(result.judgePreflight.draftStatus).toBe("checking");
    expect(result.schoolReady).toBe(false);
    expect(
      result.checks.find((item) => item.id === "measured-data")?.ready,
    ).toBe(false);
    expect(
      result.checks.find((item) => item.id === "impact-source")?.ready,
    ).toBe(false);
    expect(result.checks.find((item) => item.id === "cloud")?.ready).toBe(
      false,
    );
  });

  it("正式身分、固定示範證據與零草稿全部通過才允許 Live Demo", () => {
    const snapshot = createDemoSnapshot();
    snapshot.profile = {
      ...snapshot.profile,
      schoolName: "臺北市永續國小",
      teamName: "綠芽研究隊",
      teamMembers: "王同學、李同學",
    };

    expect(
      evaluateJudgePreflight(snapshot, "demo-local", {
        pendingScanDraftCount: 0,
        pendingWorkflowDraftCount: 0,
      }).ready,
    ).toBe(true);
    expect(
      assessProductReadiness(snapshot, "demo-local", {
        pendingScanDraftCount: 0,
        pendingWorkflowDraftCount: 0,
      }).demoReady,
    ).toBe(true);

    expect(
      evaluateJudgePreflight(snapshot, "demo-local", {
        pendingScanDraftCount: 1,
        pendingWorkflowDraftCount: 0,
      }),
    ).toMatchObject({
      ready: false,
      draftStatus: "blocked",
      pendingDraftCount: 1,
    });

    expect(
      evaluateJudgePreflight(snapshot, "demo-local", {
        pendingScanDraftCount: 0,
        pendingWorkflowDraftCount: 2,
      }),
    ).toMatchObject({
      ready: false,
      draftStatus: "blocked",
      pendingDraftCount: 2,
    });

    snapshot.meals = snapshot.meals.slice(1);
    expect(
      evaluateJudgePreflight(snapshot, "demo-local", {
        pendingScanDraftCount: 0,
        pendingWorkflowDraftCount: 0,
      }),
    ).toMatchObject({ ready: false, fixedSeedReady: false });
  });

  it("只有身分、實測、來源、治理與私有工作區皆完成才標示正式就緒", () => {
    const snapshot = createDemoSnapshot();
    snapshot.profile = {
      ...snapshot.profile,
      schoolName: "臺北市永續國小",
      teamName: "綠芽研究隊",
      teamMembers: "王同學、李同學",
      privacyContact: "午餐秘書",
      dataRetentionDays: 180,
      governanceReviewedAt: "2026-08-31T09:00:00+08:00",
    };
    snapshot.impactSettings = {
      ...snapshot.impactSettings,
      sourceTitle: "永續國小九月午餐廚餘秤重表",
      retrievedAt: "2026-09-30",
    };
    snapshot.meals.push({
      ...snapshot.meals[0],
      id: "school-measurement-1",
      source: "manual",
      measurementMethod: "scale",
    });

    const result = assessProductReadiness(snapshot, "school-cloud");

    expect(result.readyCount).toBe(result.totalCount);
    expect(result.score).toBe(100);
    expect(result.schoolReady).toBe(true);
    expect(result.nextCheck).toBeUndefined();
  });
});
