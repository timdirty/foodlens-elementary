// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MealEvidenceWorkflowPage from "@/app/(dashboard)/workflow/page";
import { createDemoSnapshot } from "@/lib/seed";
import { MockMenuOcrProvider, type MenuOcrAnalysis } from "@/lib/menu-ocr";
import {
  emptyReasonCounts,
  mealEvidenceCaseSchema,
  type MealEvidenceCase,
} from "@/lib/evidence-chain";
import type { AppSnapshot, DataMode } from "@/lib/types";
import type { WorkflowDraft, WorkflowDraftInput } from "@/lib/workflow-draft";

const mocks = vi.hoisted(() => ({
  snapshot: undefined as AppSnapshot | undefined,
  mode: "demo-local" as DataMode,
  params: new URLSearchParams(),
  router: { replace: vi.fn() },
  repository: { saveEvidenceCase: vi.fn() },
  refresh: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  loadDraft: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
}));

vi.mock("@/components/data-provider", () => ({
  useFoodLens: () => ({
    snapshot: mocks.snapshot,
    loading: false,
    mode: mocks.mode,
    repository: mocks.repository,
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/lib/workflow-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow-draft")>()),
  listWorkflowDraftSummaries: vi.fn(async () => []),
  loadWorkflowDraftForCase: mocks.loadDraft,
  saveWorkflowDraft: mocks.saveDraft,
  deleteWorkflowDraftForCase: mocks.deleteDraft,
}));

vi.mock("@/lib/image", () => ({
  prepareMenuImage: vi.fn(async () =>
    Object.assign(new Blob(["isolated-test-image"], { type: "image/webp" }), {
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  ),
}));

vi.mock("@/lib/crypto", () => ({
  sha256Hex: vi.fn(async () => "a".repeat(64)),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function storedDraft(input: WorkflowDraftInput): WorkflowDraft {
  return {
    ...input,
    id: "isolated-route-test-draft",
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot = createDemoSnapshot();
  mocks.mode = "demo-local";
  mocks.params = new URLSearchParams({
    case: mocks.snapshot.evidenceCases[0].id,
  });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.repository.saveEvidenceCase.mockResolvedValue({
    mealRecordId: "isolated-feedback-meal",
  });
  mocks.loadDraft.mockResolvedValue(undefined);
  mocks.deleteDraft.mockResolvedValue(undefined);
  mocks.saveDraft.mockImplementation(async (input: WorkflowDraftInput) =>
    storedDraft(input),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
    window.clearTimeout(handle),
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:isolated-menu-test");
      static revokeObjectURL = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPage() {
  render(<MealEvidenceWorkflowPage />);
  await screen.findByRole("group", { name: "智慧菜單輸入" });
}

function setSavedCaseFixture() {
  const current = mocks.snapshot!.evidenceCases[0];
  mocks.snapshot!.evidenceCases[0] = {
    ...current,
    mealRecordId: mocks.snapshot!.meals[0].id,
    humanDecision: {
      cardId: "headcount-reserve",
      choice: "more-data",
      rationale: "先增加可比較供餐日，再評估是否進行小型試驗。",
      decidedAt: current.updatedAt,
      decidedByRole: "dietitian",
    },
  };
  return structuredClone(mocks.snapshot!.evidenceCases[0]);
}

function expectWorkbenchLocked(locked: boolean) {
  const fieldset = screen.getByRole("group", { name: /輸入$/ });
  expect(fieldset).toHaveAttribute("aria-busy", String(locked));
  expect((fieldset as HTMLFieldSetElement).disabled).toBe(locked);
  for (const control of within(
    screen.getByRole("navigation", { name: "午餐任務四步驟" }),
  ).getAllByRole("button")) {
    if (locked) expect(control).toBeDisabled();
    else expect(control).toBeEnabled();
  }
  for (const control of within(
    screen.getByRole("complementary", { name: "任務進度與儲存" }),
  ).getAllByRole("button")) {
    if (locked) expect(control).toBeDisabled();
    else expect(control).toBeEnabled();
  }
  const selector = screen.getByRole("combobox", { name: "目前案件" });
  if (locked) expect(selector).toBeDisabled();
  else expect(selector).toBeEnabled();
}

async function openDecision() {
  await openPage();
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "午餐任務四步驟" }),
    ).getByRole("button", { name: /責任決策/ }),
  );
  await screen.findByRole("group", { name: "責任決策輸入" });
  fireEvent.click(screen.getByRole("button", { name: "需要更多資料" }));
}

function selectWorkflowStage(name: RegExp) {
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "午餐任務四步驟" }),
    ).getByRole("button", { name }),
  );
}

async function openFeedback() {
  await openPage();
  selectWorkflowStage(/學生原因/);
  return screen.findByLabelText("匿名回覆收集狀態");
}

function resumeFeedbackFixture(value: MealEvidenceCase): WorkflowDraft {
  return storedDraft({
    mode: "demo-local",
    caseId: value.id,
    classId: value.classId,
    servedOn: value.servedOn,
    step: 1,
    value,
    source: value.menuVersion.sourceEvidence.source,
    importText: "",
    photoAnalysisMode: "mock",
    decisionDraft: {
      cardId: "need-more-data",
      choice: "more-data",
      rationale: "先補上尚未完成的回饋，再由現場人員確認。",
      decidedByRole: "teacher-student-team",
    },
    touchedMeasurementFields: [],
  });
}

async function confirmFeedbackAndSave() {
  fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
  await screen.findByRole("group", { name: "責任決策輸入" });
  fireEvent.click(screen.getByRole("button", { name: "需要更多資料" }));
  fireEvent.click(screen.getByRole("button", { name: "確認並保存證據鏈" }));
  await waitFor(() =>
    expect(mocks.repository.saveEvidenceCase).toHaveBeenCalledOnce(),
  );
  await waitFor(() => expect(mocks.deleteDraft).toHaveBeenCalledOnce());
  return mocks.repository.saveEvidenceCase.mock.calls[0][0] as MealEvidenceCase;
}

describe("workflow feedback observation contract", () => {
  it("starts a new school-cloud draft with unknown feedback and observations, never fabricated zeros", async () => {
    mocks.mode = "school-cloud";
    mocks.snapshot!.evidenceCases = [];
    mocks.params = new URLSearchParams();
    await openPage();
    vi.useFakeTimers();
    fireEvent.change(screen.getAllByLabelText("人工確認菜名")[0], {
      target: { value: "現場待核對主食" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({
      mode: "school-cloud",
      value: {
        feedbackSchemaVersion: 2,
        reasonCollectionStatus: "not-collected",
        reasonCounts: emptyReasonCounts(),
        teacherContext: {
          deliveryStatus: "not-collected",
          temperatureStatus: "not-collected",
          deliveryDelayMinutes: null,
          temperatureConcern: null,
        },
      },
    });
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
  });

  it("keeps the seeded Demo observations explicitly collected and recorded", async () => {
    await openFeedback();
    expect(screen.getByLabelText("匿名回覆收集狀態")).toHaveValue("collected");
    expect(screen.getByLabelText("份量太多票數")).toHaveValue(4);
    expect(screen.getByLabelText("配送延遲（分鐘）")).toHaveValue(4);
    expect(screen.getByLabelText("現場溫度觀察（僅作線索）")).toHaveValue(
      "false",
    );
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
  });

  it.each(["not-collected", "collected-zero"] as const)(
    "allows %s feedback through decision and save without forcing a positive vote",
    async (state) => {
      // Keep analysis scoped to this isolated case so coverage cannot be
      // supplied accidentally by a different seeded serving date.
      mocks.snapshot!.evidenceCases = [mocks.snapshot!.evidenceCases[0]];
      const collectionStatus = await openFeedback();
      fireEvent.change(collectionStatus, {
        target: { value: "not-collected" },
      });
      fireEvent.change(screen.getByLabelText("配送延遲（分鐘）"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByLabelText("現場溫度觀察（僅作線索）"), {
        target: { value: "not-collected" },
      });
      if (state === "collected-zero") {
        fireEvent.change(collectionStatus, { target: { value: "collected" } });
        expect(screen.getByLabelText("份量太多票數")).toHaveValue(null);
        fireEvent.click(
          screen.getByRole("button", {
            name: "已收集但沒有回覆，全部記為 0 票",
          }),
        );
        expect(screen.getByLabelText("份量太多票數")).toHaveValue(0);
      } else {
        expect(screen.getByLabelText("份量太多票數")).toBeDisabled();
        expect(screen.getByLabelText("份量太多票數")).toHaveValue(null);
      }
      const saved = await confirmFeedbackAndSave();
      const coverage = screen.getByRole("region", {
        name: "回饋與現場觀察涵蓋率",
      });
      expect(coverage).toHaveTextContent("共 0 份有效回覆");
      expect(coverage).toHaveTextContent(
        state === "collected-zero" ? "1 筆確認為 0 份回覆" : "尚未收集 1 筆",
      );
      expect(saved.reasonCollectionStatus).toBe(
        state === "collected-zero" ? "collected" : "not-collected",
      );
      expect(Object.values(saved.reasonCounts)).toEqual(
        Array(6).fill(state === "collected-zero" ? 0 : null),
      );
      expect(saved.teacherContext).toMatchObject({
        deliveryStatus: "not-collected",
        temperatureStatus: "not-collected",
        deliveryDelayMinutes: null,
        temperatureConcern: null,
      });
      expect(saved.humanDecision?.choice).toBe("more-data");
    },
  );

  it("keeps incomplete collected feedback at the feedback stage, not the measurement stage", async () => {
    await openFeedback();
    fireEvent.change(screen.getByLabelText("份量太多票數"), {
      target: { value: "" },
    });
    selectWorkflowStage(/責任決策/);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "已收集時請逐項填寫票數；確認沒有票才填 0",
    );
    expect(screen.getByLabelText("匿名回覆收集狀態")).toHaveValue("collected");
    expect(
      screen.queryByRole("group", { name: "責任決策輸入" }),
    ).not.toBeInTheDocument();
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
    selectWorkflowStage(/分流秤重/);
    expect(screen.getByLabelText("備餐耗損毛重（公克）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    expect(screen.getByLabelText("匿名回覆收集狀態")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^份量太多/ }));
    expect(screen.getByLabelText("份量太多票數")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("份量太多票數"), {
      target: { value: "0" },
    });
    const saved = await confirmFeedbackAndSave();
    expect(saved.reasonCounts.portion).toBe(0);
    expect(saved.reasonCounts.taste).toBe(5);
  });

  it("restores a partially collected draft at measurement and still lets the user reach and complete feedback", async () => {
    const value = structuredClone(mocks.snapshot!.evidenceCases[0]);
    value.reasonCounts.portion = null;
    value.humanDecision = undefined;
    const draft = resumeFeedbackFixture(value);
    mocks.loadDraft.mockResolvedValueOnce(draft);
    render(<MealEvidenceWorkflowPage />);
    await screen.findByLabelText("備餐耗損毛重（公克）");
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    expect(screen.getByLabelText("匿名回覆收集狀態")).toHaveValue("collected");
    fireEvent.click(screen.getByRole("button", { name: /^份量太多/ }));
    expect(screen.getByLabelText("份量太多票數")).toHaveValue(null);
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "已收集時請逐項填寫票數",
    );
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("份量太多票數"), {
      target: { value: "0" },
    });
    const saved = await confirmFeedbackAndSave();
    expect(saved.reasonCounts.portion).toBe(0);
    expect(draft.value.reasonCounts.portion).toBeNull();
    expect(draft.schemaVersion).toBe(1);
    expect(saved.feedbackSchemaVersion).toBe(2);
  });

  it("preserves unreviewed legacy values while excluding them from decision feedback and observation statistics", async () => {
    const current = mocks.snapshot!.evidenceCases[0];
    const legacy = mealEvidenceCaseSchema.parse({
      ...current,
      feedbackSchemaVersion: undefined,
      reasonCollectionStatus: undefined,
      teacherContext: {
        ...current.teacherContext,
        deliveryStatus: undefined,
        temperatureStatus: undefined,
      },
    });
    mocks.snapshot!.evidenceCases = [legacy];
    await openFeedback();
    expect(screen.getByLabelText("匿名回覆收集狀態")).toHaveValue(
      "legacy-unverified",
    );
    expect(screen.getByLabelText("份量太多票數")).toHaveValue(4);
    expect(screen.getByLabelText("份量太多票數")).toBeDisabled();
    const saved = await confirmFeedbackAndSave();
    const coverage = screen.getByRole("region", {
      name: "回饋與現場觀察涵蓋率",
    });
    expect(coverage).toHaveTextContent("0 筆已完成回饋收集");
    expect(coverage).toHaveTextContent("共 0 份有效回覆");
    expect(coverage).toHaveTextContent("舊資料待複核 1 筆");
    expect(coverage).toHaveTextContent("配送延遲已觀察 0 筆");
    expect(coverage).toHaveTextContent("溫度情境已觀察 0 筆");
    expect(saved.reasonCollectionStatus).toBe("legacy-unverified");
    expect(saved.reasonCounts).toEqual(current.reasonCounts);
    expect(saved.teacherContext).toEqual(legacy.teacherContext);
  });
});

describe("workflow route async operation locking", () => {
  it("keeps saved evidence read-only while navigating forward, backward and directly between stages", async () => {
    const persisted = setSavedCaseFixture();
    await openPage();
    vi.useFakeTimers();
    const stages = screen.getByRole("navigation", { name: "午餐任務四步驟" });
    const assertSaved = () => {
      expect(
        screen.getByText("目前顯示已正式保存的證據鏈"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("已保存於這個瀏覽器", { exact: false }),
      ).toBeInTheDocument();
      expect(screen.queryByText("有新的草稿變更")).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "為本餐新增餐盤樣本" }),
      ).toHaveAttribute("href", `/scan?meal=${persisted.mealRecordId}`);
    };

    assertSaved();
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    assertSaved();
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    assertSaved();
    fireEvent.click(within(stages).getByRole("button", { name: /責任決策/ }));
    assertSaved();
    expect(screen.getByLabelText("決策理由（至少 5 字）")).toHaveValue(
      persisted.humanDecision!.rationale,
    );
    expect(screen.getByLabelText("最後確認角色")).toHaveValue(
      persisted.humanDecision!.decidedByRole,
    );
    fireEvent.click(within(stages).getByRole("button", { name: /智慧菜單/ }));
    assertSaved();
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
    expect(mocks.snapshot!.evidenceCases[0]).toEqual(persisted);
  });

  it("still creates a draft after a real content edit and preserves its subsequent navigation step", async () => {
    setSavedCaseFixture();
    await openPage();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    fireEvent.change(screen.getByLabelText("備餐耗損毛重（公克）"), {
      target: { value: "430" },
    });
    expect(
      screen.queryByText("目前顯示已正式保存的證據鏈"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ step: 2 });
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
    expect(screen.getByText("未完成草稿已保存")).toBeInTheDocument();
  });

  it("retains navigation progress for an unfinished case even before another content edit", async () => {
    mocks.snapshot!.evidenceCases[0] = {
      ...mocks.snapshot!.evidenceCases[0],
      humanDecision: undefined,
    };
    await openPage();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ step: 1 });
    expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
  });

  it("does not enter a pending transition when the current case is selected again", async () => {
    mocks.params = new URLSearchParams();
    await openPage();
    const currentCase = screen.getByRole("combobox", { name: "目前案件" });
    expect(
      screen.getByRole("button", { name: "目前正在編輯此餐" }),
    ).toBeDisabled();
    fireEvent.change(currentCase, {
      target: { value: (currentCase as HTMLSelectElement).value },
    });
    expectWorkbenchLocked(false);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "新增餐期班級" }), {
      target: { value: "class-5b" },
    });
    expect(
      screen.getByRole("button", { name: "建立／開啟這個餐期" }),
    ).toBeEnabled();
  });

  it.each(["success", "failure"] as const)(
    "locks editable fields, stage navigation, and rail until formal save %s settles",
    async (outcome) => {
      const saving = deferred<{ mealRecordId: string }>();
      mocks.repository.saveEvidenceCase.mockReturnValueOnce(saving.promise);
      await openDecision();
      const rationale = screen.getByRole("textbox", {
        name: "決策理由（至少 5 字）",
      });
      expect(rationale).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "確認並保存證據鏈" }));
      await waitFor(() =>
        expect(mocks.repository.saveEvidenceCase).toHaveBeenCalledOnce(),
      );
      expectWorkbenchLocked(true);
      expect(rationale).toBeDisabled();
      await act(async () => {
        if (outcome === "success")
          saving.resolve({ mealRecordId: "route-test-meal" });
        else saving.reject(new Error("測試保存失敗，請重試"));
      });
      await waitFor(() => expectWorkbenchLocked(false));
      expect(rationale).toBeEnabled();
      if (outcome === "failure") {
        expect(screen.getByText("測試保存失敗，請重試")).toBeInTheDocument();
        expect(mocks.deleteDraft).not.toHaveBeenCalled();
      } else {
        expect(mocks.deleteDraft).toHaveBeenCalledOnce();
        expect(mocks.refresh).toHaveBeenCalledOnce();
      }
    },
  );

  it("locks the current case during a draft flush and unlocks after a failed transition", async () => {
    const draftWrite = deferred<WorkflowDraft>();
    mocks.saveDraft.mockReturnValueOnce(draftWrite.promise);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "檢查並繼續" }));
    fireEvent.change(screen.getByLabelText("備餐耗損毛重（公克）"), {
      target: { value: "430" },
    });
    const before = screen.getByRole("combobox", { name: "目前案件" });
    const originalCaseId = (before as HTMLSelectElement).value;
    fireEvent.change(before, {
      target: { value: mocks.snapshot!.evidenceCases[1].id },
    });
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce());
    expectWorkbenchLocked(true);
    await act(async () => draftWrite.reject(new Error("模擬草稿寫入失敗")));
    await waitFor(() => expectWorkbenchLocked(false));
    expect(before).toHaveValue(originalCaseId);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(screen.getByText("本機草稿暫時無法保存")).toBeInTheDocument();
  });

  it.each(["success", "failure"] as const)(
    "locks the whole workbench during menu OCR and unlocks after %s",
    async (outcome) => {
      const analyzing = deferred<MenuOcrAnalysis>();
      const analyze = vi
        .spyOn(MockMenuOcrProvider.prototype, "analyze")
        .mockReturnValueOnce(analyzing.promise);
      await openPage();
      fireEvent.click(
        screen.getByRole("button", { name: /菜單照片.*拍照 OCR/ }),
      );
      fireEvent.change(screen.getByLabelText("選擇菜單圖片"), {
        target: {
          files: [new File(["test"], "menu.png", { type: "image/png" })],
        },
      });
      const analyzeButton = await screen.findByRole("button", {
        name: "開始照片初判",
      });
      await waitFor(() => expect(analyzeButton).toBeEnabled());
      fireEvent.click(analyzeButton);
      await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
      expectWorkbenchLocked(true);
      expect(
        screen.getByRole("textbox", { name: /OCR 辨識原文/ }),
      ).toBeDisabled();
      await act(async () => {
        if (outcome === "failure")
          analyzing.reject(new Error("測試 OCR 暫時中斷"));
        else
          analyzing.resolve({
            schemaVersion: "1",
            provider: "isolated-mock",
            model: "fixture-v1",
            isMock: true,
            rawText: "主食：糙米飯\n主菜：咖哩雞丁",
            extractedLines: ["主食：糙米飯", "主菜：咖哩雞丁"],
            warnings: ["Mock 測試結果"],
            analyzedAt: "2026-10-16T04:00:00.000Z",
          });
      });
      await waitFor(() => expectWorkbenchLocked(false));
      expect(
        screen.getByRole("textbox", { name: /OCR 辨識原文/ }),
      ).toBeEnabled();
      expect(mocks.repository.saveEvidenceCase).not.toHaveBeenCalled();
      if (outcome === "failure")
        expect(screen.getByText(/測試 OCR 暫時中斷/)).toBeInTheDocument();
      else
        expect(
          screen.getByRole("textbox", { name: /OCR 辨識原文/ }),
        ).toHaveValue("主食：糙米飯\n主菜：咖哩雞丁");
    },
  );
});
