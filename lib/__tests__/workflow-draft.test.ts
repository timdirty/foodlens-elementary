import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDemoEvidenceCases,
  emptyReasonCounts,
} from "@/lib/evidence-chain";
import {
  clearWorkflowDrafts,
  createWorkflowDraftId,
  deleteWorkflowDraftForCase,
  inspectPendingWorkflowDrafts,
  listWorkflowDraftSummaries,
  loadWorkflowDraft,
  loadWorkflowDraftForCase,
  normalizeWorkflowCaseRequest,
  normalizeWorkflowDateRequest,
  saveWorkflowDraft,
  workflowCaseBelongsToMode,
  WORKFLOW_DRAFT_MAX_AGE_MS,
  type WorkflowDraftInput,
} from "@/lib/workflow-draft";

afterEach(async () => {
  await Promise.all([
    clearWorkflowDrafts("demo-local"),
    clearWorkflowDrafts("school-cloud"),
  ]);
});

function inputFor(
  caseId: string,
  mode: "demo-local" | "school-cloud" = "demo-local",
): WorkflowDraftInput {
  const source = structuredClone(createDemoEvidenceCases()[2]);
  const value = {
    ...source,
    id: caseId,
    classId: mode === "demo-local" ? "class-5a" : "class-cloud-5a",
    sourceKind:
      mode === "demo-local" ? ("demo" as const) : ("measured" as const),
    measurementReview: {
      reviewedAt: source.updatedAt,
      reviewedBy: "現場教師",
      zeroValuesChecked: true as const,
    },
  };
  return {
    mode,
    caseId: value.id,
    classId: value.classId,
    servedOn: value.servedOn,
    step: 3,
    value,
    source: value.menuVersion.sourceEvidence.source,
    importText: "尚未完成的菜單原文",
    photoAnalysisMode: mode === "demo-local" ? "mock" : "real",
    decisionDraft: {
      cardId: "headcount-reserve",
      choice: "pilot",
      rationale: "先保留添餐能力，再做小幅試驗。",
      decidedByRole: "dietitian",
    },
    touchedMeasurementFields: ["plannedDiners", "plate-edible.netG"],
  };
}

describe("workflow evidence drafts", () => {
  it("round-trips unknown, partial collected counts, and explicitly observed zero separately", async () => {
    const input = inputFor("workflow-feedback-draft");
    input.value.reasonCollectionStatus = "collected";
    input.value.reasonCounts = {
      ...emptyReasonCounts(),
      portion: 0,
      unfamiliar: null,
    };
    input.value.teacherContext = {
      deliveryStatus: "recorded",
      deliveryDelayMinutes: 0,
      temperatureStatus: "not-collected",
      temperatureConcern: null,
      note: "",
    };
    const saved = await saveWorkflowDraft(input);
    const restored = await loadWorkflowDraft(saved.id);
    expect(restored?.value.reasonCollectionStatus).toBe("collected");
    expect(restored?.value.reasonCounts).toEqual(input.value.reasonCounts);
    expect(restored?.value.teacherContext).toEqual(input.value.teacherContext);
  });

  it("reads legacy persisted rows without marking prefilled values as observed or rewriting raw data", async () => {
    const saved = await saveWorkflowDraft(inputFor("workflow-legacy-feedback"));
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.value.feedbackSchemaVersion;
    delete legacy.value.reasonCollectionStatus;
    delete legacy.value.teacherContext.deliveryStatus;
    delete legacy.value.teacherContext.temperatureStatus;
    const store = new Dexie("foodlens-workflow-drafts");
    await store.open();
    try {
      await store.table("drafts").put(legacy);
      const restored = await loadWorkflowDraft(saved.id);
      expect(restored?.value.reasonCollectionStatus).toBe("legacy-unverified");
      expect(restored?.value.teacherContext.deliveryStatus).toBe(
        "legacy-unverified",
      );
      expect(restored?.value.reasonCounts).toEqual(legacy.value.reasonCounts);
      expect(restored?.value.teacherContext.deliveryDelayMinutes).toBe(
        legacy.value.teacherContext.deliveryDelayMinutes,
      );
      expect(await store.table("drafts").get(saved.id)).toEqual(legacy);
    } finally {
      store.close();
    }
  });

  it("isolates drafts by mode, class, date and case without exposing raw identity", () => {
    const base = {
      mode: "school-cloud" as const,
      classId: "class-secret-5a",
      servedOn: "2026-10-16",
      caseId: "case-secret-a",
    };
    const ids = [
      createWorkflowDraftId(base),
      createWorkflowDraftId({ ...base, mode: "demo-local" }),
      createWorkflowDraftId({ ...base, classId: "class-secret-5b" }),
      createWorkflowDraftId({ ...base, servedOn: "2026-10-17" }),
      createWorkflowDraftId({ ...base, caseId: "case-secret-b" }),
    ];

    expect(new Set(ids)).toHaveLength(ids.length);
    expect(ids[0]).not.toContain(base.classId);
    expect(ids[0]).not.toContain(base.caseId);
  });

  it("stores incomplete work but strips final measurement attestation and human decision", async () => {
    const stored = await saveWorkflowDraft(
      inputFor("workflow-cloud-interrupted", "school-cloud"),
    );

    expect(Object.hasOwn(stored.value, "measurementReview")).toBe(false);
    expect(Object.hasOwn(stored.value, "humanDecision")).toBe(false);

    const restored = await loadWorkflowDraftForCase(
      "school-cloud",
      "workflow-cloud-interrupted",
    );
    expect(restored?.step).toBe(1);
    expect(restored?.decisionDraft.rationale).toContain("小幅試驗");
    expect(restored?.touchedMeasurementFields).toEqual([
      "plannedDiners",
      "plate-edible.netG",
    ]);
    expect(Object.hasOwn(restored?.value ?? {}, "measurementReview")).toBe(
      false,
    );
    expect(Object.hasOwn(restored?.value ?? {}, "humanDecision")).toBe(false);
  });

  it("restores the exact non-default case and keeps another case isolated", async () => {
    const first = await saveWorkflowDraft(inputFor("workflow-case-a"));
    const nonDefaultCase = inputFor("workflow-case-b");
    const differentDay = structuredClone(createDemoEvidenceCases()[0]);
    nonDefaultCase.value = {
      ...differentDay,
      id: nonDefaultCase.caseId,
      classId: "class-6b",
      sourceKind: "demo",
    };
    nonDefaultCase.classId = nonDefaultCase.value.classId;
    nonDefaultCase.servedOn = nonDefaultCase.value.servedOn;
    const second = await saveWorkflowDraft(nonDefaultCase);

    await expect(
      loadWorkflowDraftForCase("demo-local", "workflow-case-a"),
    ).resolves.toMatchObject({ id: first.id, caseId: "workflow-case-a" });
    await expect(
      loadWorkflowDraftForCase("demo-local", "workflow-case-b"),
    ).resolves.toMatchObject({
      id: second.id,
      caseId: "workflow-case-b",
      classId: "class-6b",
      servedOn: differentDay.servedOn,
    });
    await expect(
      loadWorkflowDraftForCase("school-cloud", "workflow-case-a"),
    ).resolves.toBeUndefined();
  });

  it("returns to menu review when an interrupted menu has not been confirmed", async () => {
    const input = inputFor("workflow-unconfirmed-menu");
    input.value = {
      ...input.value,
      menuVersion: {
        ...input.value.menuVersion,
        status: "draft",
        confirmation: null,
        substitutions: [],
      },
    };
    await saveWorkflowDraft(input);

    await expect(
      loadWorkflowDraftForCase("demo-local", "workflow-unconfirmed-menu"),
    ).resolves.toMatchObject({ step: 0 });
  });

  it("lists resumable cases in date/update order and deletes only the chosen case", async () => {
    const older = inputFor("workflow-list-old");
    await saveWorkflowDraft(older, Date.parse("2026-10-14T07:00:00.000Z"));
    const newer = inputFor("workflow-list-new");
    await saveWorkflowDraft(newer, Date.parse("2026-10-16T07:00:00.000Z"));

    const summaries = await listWorkflowDraftSummaries(
      "demo-local",
      Date.parse("2026-10-16T08:00:00.000Z"),
    );
    expect(summaries.map((item) => item.caseId)).toEqual([
      "workflow-list-new",
      "workflow-list-old",
    ]);

    await expect(
      deleteWorkflowDraftForCase("demo-local", "workflow-list-old"),
    ).resolves.toBe(1);
    await expect(
      loadWorkflowDraftForCase("demo-local", "workflow-list-old"),
    ).resolves.toBeUndefined();
    await expect(
      loadWorkflowDraftForCase("demo-local", "workflow-list-new"),
    ).resolves.toBeDefined();
  });

  it("expires old workflow drafts after seven days", async () => {
    const savedAt = Date.parse("2026-09-01T00:00:00.000Z");
    const stored = await saveWorkflowDraft(
      inputFor("workflow-expired"),
      savedAt,
    );

    await expect(
      loadWorkflowDraft(stored.id, savedAt + WORKFLOW_DRAFT_MAX_AGE_MS + 1),
    ).resolves.toBeUndefined();
  });

  it("counts only current valid drafts for the read-only presentation preflight", async () => {
    const now = Date.parse("2026-10-16T08:00:00.000Z");
    await saveWorkflowDraft(inputFor("workflow-preflight-current"), now);
    await saveWorkflowDraft(
      inputFor("workflow-preflight-expired"),
      now - WORKFLOW_DRAFT_MAX_AGE_MS - 1,
    );
    await saveWorkflowDraft(
      inputFor("workflow-preflight-cloud", "school-cloud"),
      now,
    );

    await expect(
      inspectPendingWorkflowDrafts("demo-local", now),
    ).resolves.toEqual({
      count: 1,
      latestUpdatedAt: new Date(now).toISOString(),
    });
    await expect(
      inspectPendingWorkflowDrafts("school-cloud", now),
    ).resolves.toEqual({
      count: 1,
      latestUpdatedAt: new Date(now).toISOString(),
    });
  });

  it("accepts only bounded case query values and keeps Demo/formal lanes separate", () => {
    const [demoCase] = createDemoEvidenceCases();
    expect(normalizeWorkflowCaseRequest("demo-evidence-1")).toBe(
      "demo-evidence-1",
    );
    expect(normalizeWorkflowCaseRequest("javascript:alert(1)")).toBeUndefined();
    expect(normalizeWorkflowDateRequest("2026-10-17")).toBe("2026-10-17");
    expect(normalizeWorkflowDateRequest("2026-02-30")).toBeUndefined();
    expect(workflowCaseBelongsToMode("demo-local", demoCase)).toBe(true);
    expect(workflowCaseBelongsToMode("school-cloud", demoCase)).toBe(false);
    expect(
      workflowCaseBelongsToMode("school-cloud", {
        sourceKind: "measured",
      }),
    ).toBe(true);
  });
});
