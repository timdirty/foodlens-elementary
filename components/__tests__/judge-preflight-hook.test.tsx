// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useJudgePreflightRuntime } from "@/components/use-judge-preflight";
import { createDemoEvidenceCases } from "@/lib/evidence-chain";
import {
  createScanDraftId,
  deleteScanDraft,
  loadScanDraft,
  saveScanDraft,
} from "@/lib/scan-draft";
import { evaluateJudgePreflight } from "@/lib/product-readiness";
import { createDemoSnapshot } from "@/lib/seed";
import type { DataMode } from "@/lib/types";
import {
  deleteWorkflowDraftForCase,
  loadWorkflowDraftForCase,
  saveWorkflowDraft,
} from "@/lib/workflow-draft";

const scanId = createScanDraftId({
  mode: "demo-local",
  workspaceKey: "judge-inspection-refresh",
});
const caseId = "workflow-judge-inspection-refresh";

afterEach(async () => {
  cleanup();
  await Promise.all([
    deleteScanDraft(scanId),
    deleteWorkflowDraftForCase("demo-local", caseId),
  ]);
});

async function saveBothDrafts() {
  const scan = await saveScanDraft({
    id: scanId,
    mode: "demo-local",
    step: 2,
    form: {
      date: "2026-09-06",
      classId: "class-5a",
      staple: "白飯",
      mainDish: "雞肉",
      sides: "青菜",
      people: 25,
      supplyKg: 6,
      leftoverKg: 1,
      notes: "仍待學生確認",
    },
    selectedImage: "/demo/plate-curry.png",
    imageSource: "demo",
    corrections: [],
    analysisMode: "mock",
    clientRequestId: "77777777-7777-4777-8777-777777777777",
  });
  const value = { ...createDemoEvidenceCases()[2], id: caseId };
  const workflow = await saveWorkflowDraft({
    mode: "demo-local",
    caseId,
    classId: value.classId,
    servedOn: value.servedOn,
    step: 1,
    value,
    source: value.menuVersion.sourceEvidence.source,
    importText: "待完成的午餐任務",
    photoAnalysisMode: "mock",
    decisionDraft: {
      cardId: "need-more-data",
      choice: "more-data",
      rationale: "",
      decidedByRole: "dietitian",
    },
    touchedMeasurementFields: [],
  });
  return { scan, workflow };
}

describe("shared judge preflight inspection", () => {
  it("rechecks both draft stores when the data snapshot refreshes without changing either draft", async () => {
    const firstSnapshot = createDemoSnapshot();
    const view = renderHook(
      ({ snapshot }) => useJudgePreflightRuntime("demo-local", snapshot),
      { initialProps: { snapshot: firstSnapshot } },
    );
    expect(view.result.current.pendingScanDraftCount).toBeUndefined();
    await waitFor(() => {
      expect(view.result.current.pendingScanDraftCount).toBe(0);
      expect(view.result.current.pendingWorkflowDraftCount).toBe(0);
    });

    const stored = await saveBothDrafts();
    view.rerender({ snapshot: createDemoSnapshot() });
    expect(view.result.current.pendingScanDraftCount).toBeUndefined();
    expect(view.result.current.pendingWorkflowDraftCount).toBeUndefined();
    await waitFor(() => {
      expect(view.result.current.pendingScanDraftCount).toBe(1);
      expect(view.result.current.pendingWorkflowDraftCount).toBe(1);
    });
    expect(
      evaluateJudgePreflight(firstSnapshot, "demo-local", view.result.current),
    ).toMatchObject({ draftStatus: "blocked", pendingDraftCount: 2 });
    await expect(loadScanDraft(scanId)).resolves.toEqual(stored.scan);
    await expect(
      loadWorkflowDraftForCase("demo-local", caseId),
    ).resolves.toEqual(stored.workflow);

    // Simulate an explicit action elsewhere; inspection itself never deletes.
    await Promise.all([
      deleteScanDraft(scanId),
      deleteWorkflowDraftForCase("demo-local", caseId),
    ]);
    view.rerender({ snapshot: createDemoSnapshot() });
    await waitFor(() => {
      expect(view.result.current.pendingScanDraftCount).toBe(0);
      expect(view.result.current.pendingWorkflowDraftCount).toBe(0);
    });
  });

  it("does not reuse one data mode's draft counts while another mode is being inspected", async () => {
    await saveBothDrafts();
    const view = renderHook(
      ({ mode }: { mode: DataMode }) => useJudgePreflightRuntime(mode),
      { initialProps: { mode: "demo-local" as DataMode } },
    );
    await waitFor(() =>
      expect(view.result.current.pendingScanDraftCount).toBe(1),
    );
    view.rerender({ mode: "school-cloud" });
    expect(view.result.current.pendingScanDraftCount).toBeUndefined();
    expect(view.result.current.pendingWorkflowDraftCount).toBeUndefined();
    await waitFor(() => {
      expect(view.result.current.pendingScanDraftCount).toBe(0);
      expect(view.result.current.pendingWorkflowDraftCount).toBe(0);
    });
    await expect(loadScanDraft(scanId)).resolves.toBeDefined();
    await expect(
      loadWorkflowDraftForCase("demo-local", caseId),
    ).resolves.toBeDefined();
  });
});
