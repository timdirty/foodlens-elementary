import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearScanDrafts,
  createScanDraftId,
  deleteScanDraft,
  inspectPendingScanDrafts,
  loadScanDraft,
  SCAN_DRAFT_MAX_AGE_MS,
  saveScanDraft,
  sweepExpiredScanDrafts,
} from "@/lib/scan-draft";

const draftId = createScanDraftId({
  mode: "school-cloud",
  linkedMealId: "meal-for-draft-test",
});

afterEach(async () => {
  await deleteScanDraft(draftId);
});

describe("resumable scan drafts", () => {
  it("isolates new-scan drafts between cloud workspaces on the same browser", () => {
    const first = createScanDraftId({
      mode: "school-cloud",
      workspaceKey: "school-a|class-5a",
    });
    const second = createScanDraftId({
      mode: "school-cloud",
      workspaceKey: "school-b|class-5a",
    });

    expect(first).not.toBe(second);
    expect(first).not.toContain("school-a");
  });

  it("keeps the processed image Blob and form locally without creating a record", async () => {
    const imageBlob = new Blob(["re-encoded-plate"], { type: "image/webp" });
    await saveScanDraft({
      id: draftId,
      mode: "school-cloud",
      linkedMealId: "meal-for-draft-test",
      step: 2,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "尚未確認",
      },
      selectedImage: "plate.webp",
      imageSource: "upload",
      imageBlob,
      corrections: [],
      analysisMode: "real",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    const restored = await loadScanDraft(draftId);
    expect(restored?.form.mainDish).toBe("雞肉");
    expect(restored?.imageBlob).toBeInstanceOf(Blob);
    expect(await restored?.imageBlob?.text()).toBe("re-encoded-plate");
    expect(restored?.analysis).toBeUndefined();
  });

  it("keeps the confirmed menu candidate context with an interrupted analysis", async () => {
    const detection = {
      category: "rice" as const,
      label: "白飯",
      originalG: 120,
      remainingRatio: 0.25,
      remainingG: 30,
      confidence: 0.9,
    };
    await saveScanDraft({
      id: draftId,
      mode: "school-cloud",
      linkedMealId: "meal-for-draft-test",
      step: 4,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "等待人工確認",
      },
      selectedImage: "plate.webp",
      imageSource: "upload",
      imageBlob: new Blob(["re-encoded-plate"], { type: "image/webp" }),
      analysis: {
        schemaVersion: "1",
        provider: "test-provider",
        model: "test-model",
        isMock: false,
        detections: [detection],
        warnings: [],
        analyzedAt: "2026-08-31T12:00:00.000Z",
      },
      analysisMenuContext: {
        candidates: [
          {
            label: "白飯",
            rawName: "白飯",
            category: "rice",
            role: "staple",
            basis: "planned",
          },
        ],
        menuVersionId: "menu-confirmed-v1",
        menuVersionSignature: "menu-signature-v1",
        source: "structured",
        sourceName: "學校菜單",
        reviewedBy: "午餐教師",
        isMock: false,
        substitutionCount: 0,
      },
      corrections: [detection],
      analysisMode: "real",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    const restored = await loadScanDraft(draftId);

    expect(restored?.analysisMenuContext).toMatchObject({
      menuVersionId: "menu-confirmed-v1",
      menuVersionSignature: "menu-signature-v1",
      candidates: [{ label: "白飯", basis: "planned" }],
    });
  });

  it("removes only the selected local draft when explicitly discarded", async () => {
    await saveScanDraft({
      id: draftId,
      mode: "school-cloud",
      step: 1,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "",
        mainDish: "",
        sides: "",
        people: "",
        supplyKg: "",
        leftoverKg: "",
        notes: "",
      },
      selectedImage: "",
      imageSource: "none",
      corrections: [],
      analysisMode: "mock",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    await deleteScanDraft(draftId);
    await expect(loadScanDraft(draftId)).resolves.toBeUndefined();
  });

  it("clears demo drafts without touching school workspace drafts", async () => {
    const demoId = createScanDraftId({
      mode: "demo-local",
      workspaceKey: "reset-demo",
    });
    const schoolId = createScanDraftId({
      mode: "school-cloud",
      workspaceKey: "keep-school",
    });
    const inputFor = (id: string, mode: "demo-local" | "school-cloud") => ({
      id,
      mode,
      step: 1 as const,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "",
      },
      selectedImage: "",
      imageSource: "none" as const,
      corrections: [],
      analysisMode: "mock" as const,
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    try {
      await saveScanDraft(inputFor(demoId, "demo-local"));
      await saveScanDraft(inputFor(schoolId, "school-cloud"));

      await expect(clearScanDrafts("demo-local")).resolves.toBe(1);
      await expect(loadScanDraft(demoId)).resolves.toBeUndefined();
      await expect(loadScanDraft(schoolId)).resolves.toBeDefined();
    } finally {
      await Promise.all([deleteScanDraft(demoId), deleteScanDraft(schoolId)]);
    }
  });

  it("expires unfinished drafts after seven days", async () => {
    const stored = await saveScanDraft({
      id: draftId,
      mode: "school-cloud",
      step: 1,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "",
      },
      selectedImage: "",
      imageSource: "none",
      corrections: [],
      analysisMode: "mock",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    await expect(
      loadScanDraft(
        draftId,
        Date.parse(stored.updatedAt) + SCAN_DRAFT_MAX_AGE_MS + 1,
      ),
    ).resolves.toBeUndefined();
    await expect(loadScanDraft(draftId)).resolves.toBeUndefined();
  });

  it("inspects pending drafts without deleting browser data", async () => {
    const stored = await saveScanDraft({
      id: draftId,
      mode: "school-cloud",
      step: 1,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "等待學生完成",
      },
      selectedImage: "",
      imageSource: "none",
      corrections: [],
      analysisMode: "mock",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    await expect(
      inspectPendingScanDrafts("school-cloud", Date.parse(stored.updatedAt)),
    ).resolves.toMatchObject({ count: 1, latestUpdatedAt: stored.updatedAt });
    await expect(
      inspectPendingScanDrafts(
        "school-cloud",
        Date.parse(stored.updatedAt) + SCAN_DRAFT_MAX_AGE_MS + 1,
      ),
    ).resolves.toMatchObject({ count: 0 });
    await expect(
      loadScanDraft(draftId, Date.parse(stored.updatedAt)),
    ).resolves.toBeDefined();
  });

  it("sweeps expired image drafts across workspaces without touching current drafts", async () => {
    const expiredIds = [
      createScanDraftId({
        mode: "school-cloud",
        workspaceKey: "expired-school-a",
      }),
      createScanDraftId({
        mode: "school-cloud",
        workspaceKey: "expired-school-b",
      }),
    ];
    const currentIds = [
      createScanDraftId({
        mode: "school-cloud",
        workspaceKey: "current-school-a",
      }),
      createScanDraftId({
        mode: "demo-local",
        workspaceKey: "current-demo",
      }),
    ];
    const inputFor = (id: string, mode: "demo-local" | "school-cloud") => ({
      id,
      mode,
      step: 2 as const,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "",
      },
      selectedImage: "plate.webp",
      imageSource: "upload" as const,
      imageBlob: new Blob([`processed-${id}`], { type: "image/webp" }),
      corrections: [],
      analysisMode: "mock" as const,
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    try {
      await Promise.all(
        expiredIds.map((id) => saveScanDraft(inputFor(id, "school-cloud"))),
      );

      const removed = await sweepExpiredScanDrafts(
        Date.now() + SCAN_DRAFT_MAX_AGE_MS + 1,
      );

      expect(removed).toBe(2);
      await Promise.all(
        expiredIds.map((id) =>
          expect(loadScanDraft(id)).resolves.toBeUndefined(),
        ),
      );

      await saveScanDraft(inputFor(currentIds[0], "school-cloud"));
      await saveScanDraft(inputFor(currentIds[1], "demo-local"));

      await expect(sweepExpiredScanDrafts(Date.now())).resolves.toBe(0);
      await expect(loadScanDraft(currentIds[0])).resolves.toBeDefined();
      await expect(loadScanDraft(currentIds[1])).resolves.toBeDefined();
    } finally {
      await Promise.all(
        [...expiredIds, ...currentIds].map((id) => deleteScanDraft(id)),
      );
    }
  });

  it("keeps a draft at the exact seven-day boundary", async () => {
    const stored = await saveScanDraft({
      id: draftId,
      mode: "school-cloud",
      step: 1,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "",
      },
      selectedImage: "",
      imageSource: "none",
      corrections: [],
      analysisMode: "mock",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });

    await expect(
      sweepExpiredScanDrafts(
        Date.parse(stored.updatedAt) + SCAN_DRAFT_MAX_AGE_MS,
      ),
    ).resolves.toBe(0);
    await expect(loadScanDraft(draftId)).resolves.toBeDefined();
  });

  it("rejects malformed nested form data before writing", async () => {
    await expect(
      saveScanDraft({
        id: draftId,
        mode: "school-cloud",
        step: 1,
        form: { date: "not-a-date" } as never,
        selectedImage: "",
        imageSource: "none",
        corrections: [],
        analysisMode: "mock",
        clientRequestId: "77777777-7777-4777-8777-777777777777",
      }),
    ).rejects.toThrow("掃描草稿內容格式不完整");
  });
});
