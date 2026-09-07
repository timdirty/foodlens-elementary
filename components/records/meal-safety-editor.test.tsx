// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MealSafetyEditor } from "./meal-safety-editor";
import {
  createEmptyMealSafetyObservation,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import type { MealRecord } from "@/lib/types";

const meal: MealRecord = {
  id: "meal-safety-component-fixture",
  classId: "class-5a",
  servedOn: "2026-09-04",
  mealPeriod: "lunch",
  staple: "白飯",
  mainDish: "咖哩雞",
  sideDishes: ["青菜"],
  menuSignature: "白飯|咖哩雞|青菜",
  plannedPeople: 30,
  actualPeople: 30,
  totalSupplyG: 21_000,
  leftoverG: 3_200,
  measurementMethod: "scale",
  source: "demo",
  notes: "隔離元件測試",
  createdAt: "2026-09-04T04:00:00Z",
  updatedAt: "2026-09-04T04:00:00Z",
};

function openEditor(
  options: {
    meal?: MealRecord;
    observations?: MealSafetyObservation[];
    onSave?: (observation: MealSafetyObservation) => Promise<void>;
  } = {},
) {
  const onSave = options.onSave ?? vi.fn(async () => undefined);
  render(
    <MealSafetyEditor
      meal={options.meal ?? meal}
      observations={options.observations ?? []}
      provenance="demo"
      onSave={onSave}
      initialOpen
    />,
  );
  return onSave;
}

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function sources() {
  change("資料來源名稱", "隔離單餐紀錄表");
  change("來源編號／查核位置", "FL-TEST-001，第 2 頁");
}

function confirmAndSave() {
  const checkbox = screen.getByRole("checkbox", {
    name: /我已核對收集狀態與來源/,
  });
  if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
  fireEvent.click(
    screen.getByRole("button", { name: "確認並保存本餐安全觀察" }),
  );
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("per-meal safety editor", () => {
  it("keeps all independent unknown values null and can explicitly save an uncollected record", async () => {
    const onSave = openEditor();
    expect(screen.getByLabelText("供應不足事件次數")).toHaveValue(null);
    expect(screen.getByLabelText("供應不足事件次數")).toBeDisabled();
    expect(screen.getByLabelText("添餐事件次數")).toHaveValue(null);
    expect(screen.getByLabelText("滿意度 1 分票數")).toHaveValue(null);
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(vi.mocked(onSave).mock.calls[0][0]).toMatchObject({
      mealRecordId: meal.id,
      provenance: "demo",
      revision: 1,
      previousObservationId: null,
      sourceTitle: "",
      shortage: {
        status: "not-collected",
        eventCount: null,
        observedDiners: null,
      },
      refill: {
        status: "not-collected",
        eventCount: null,
        observedDiners: null,
      },
      satisfaction: {
        status: "not-collected",
        invitedDiners: null,
        ratings: null,
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "第 1 版已保存",
    );
    expect(screen.getByRole("status")).toHaveTextContent("不代表實測成果");
  });

  it("requires an explicit review before submitting", () => {
    const onSave = openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "確認並保存本餐安全觀察" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("請先確認收集狀態");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("requires traceable sources for an explicitly observed zero without changing the other observations", async () => {
    const onSave = openEditor();
    change("供應不足收集狀態", "recorded");
    change("供應不足事件次數", "0");
    change("供應不足觀察人數", "30");
    confirmAndSave();
    expect(screen.getByRole("alert")).toHaveTextContent("來源名稱");
    expect(onSave).not.toHaveBeenCalled();
    sources();
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(vi.mocked(onSave).mock.calls[0][0]).toMatchObject({
      shortage: { status: "recorded", eventCount: 0, observedDiners: 30 },
      refill: { status: "not-collected", eventCount: null },
      satisfaction: { status: "not-collected", ratings: null },
    });
  });

  it("does not turn an emptied event count into an observed zero", () => {
    const onSave = openEditor();
    change("供應不足收集狀態", "recorded");
    change("供應不足事件次數", "0");
    change("供應不足事件次數", "");
    change("供應不足觀察人數", "30");
    sources();
    confirmAndSave();
    expect(screen.getByRole("alert")).toHaveTextContent("確認沒有事件才填 0");
    expect(screen.getByLabelText("供應不足事件次數")).toHaveValue(null);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("permits repeated refill events above the observed number of people", async () => {
    const onSave = openEditor();
    change("添餐收集狀態", "recorded");
    change("添餐事件次數", "35");
    change("添餐觀察人數", "30");
    sources();
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(vi.mocked(onSave).mock.calls[0][0].refill).toEqual({
      status: "recorded",
      eventCount: 35,
      observedDiners: 30,
    });
  });

  it("requires all five satisfaction bins and only assigns all zeros through the explicit no-replies action", async () => {
    const onSave = openEditor();
    change("滿意度收集狀態", "collected");
    change("滿意度邀請人數", "10");
    change("滿意度 1 分票數", "0");
    sources();
    confirmAndSave();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("已收集欄位不能留空");
    fireEvent.click(
      screen.getByRole("button", { name: "已邀請但沒有回覆，五項記為 0 票" }),
    );
    expect(screen.getByLabelText("滿意度邀請人數")).toHaveValue(10);
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(vi.mocked(onSave).mock.calls[0][0].satisfaction).toEqual({
      status: "collected",
      invitedDiners: 10,
      ratings: [0, 0, 0, 0, 0],
    });
  });

  it("rejects votes above invited respondents and does not clamp invalid entries", () => {
    const onSave = openEditor();
    change("滿意度收集狀態", "collected");
    change("滿意度邀請人數", "3");
    fireEvent.click(
      screen.getByRole("button", { name: "已邀請但沒有回覆，五項記為 0 票" }),
    );
    change("滿意度 5 分票數", "4");
    sources();
    confirmAndSave();
    expect(screen.getByRole("alert")).toHaveTextContent("票數不可高於邀請人次");
    expect(screen.getByLabelText("滿意度 5 分票數")).toHaveValue(4);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("appends a reasoned revision with a new identity while keeping the original record", async () => {
    const previous = createEmptyMealSafetyObservation(
      meal,
      "demo",
      "4c70b9ae-5f7d-4001-9d50-fc0fbbf42df1",
      "2026-09-04T06:00:00Z",
    );
    const original = structuredClone(previous);
    const onSave = openEditor({ observations: [previous] });
    confirmAndSave();
    expect(screen.getByRole("alert")).toHaveTextContent("至少 3 字理由");
    change("本次修訂原因", "依紙本複查，補記添餐事件");
    change("添餐收集狀態", "recorded");
    change("添餐事件次數", "0");
    change("添餐觀察人數", "30");
    sources();
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = vi.mocked(onSave).mock.calls[0][0];
    expect(saved.id).not.toEqual(previous.id);
    expect(saved.revision).toBe(2);
    expect(saved.previousObservationId).toBe(previous.id);
    expect(previous).toEqual(original);
    expect(screen.getByText("查看安全觀察歷史（1 版）")).toBeInTheDocument();
  });

  it("locks all editing during a pending submission and ignores duplicate submits", async () => {
    let resolve!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    openEditor({ onSave });
    confirmAndSave();
    expect(screen.getByRole("group", { name: "安全觀察輸入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消編輯" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "本餐安全觀察表單" }));
    expect(onSave).toHaveBeenCalledOnce();
    resolve();
    await screen.findByRole("status");
  });

  it("keeps input after a save error, focuses the error and retries the exact same payload", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("隔離網路中斷"))
      .mockResolvedValueOnce(undefined);
    openEditor({ onSave });
    confirmAndSave();
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("隔離網路中斷");
    await waitFor(() => expect(error).toHaveFocus());
    expect(screen.getByLabelText("供應不足收集狀態")).toHaveValue(
      "not-collected",
    );
    const first = structuredClone(onSave.mock.calls[0][0]);
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toEqual(first);
  });

  it("preserves simulated future chronology while clearly disclosing it", async () => {
    const previous = createEmptyMealSafetyObservation(
      meal,
      "demo",
      "4c70b9ae-5f7d-4001-9d50-fc0fbbf42df1",
      "2099-01-01T00:00:00Z",
    );
    const onSave = openEditor({ observations: [previous] });
    expect(screen.getByText(/這筆示範紀錄使用模擬時序/)).toBeInTheDocument();
    change("本次修訂原因", "示範版本時序驗證");
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(Date.parse(vi.mocked(onSave).mock.calls[0][0].recordedAt)).toBe(
      Date.parse(previous.recordedAt) + 1,
    );
  });

  it("warns about a stale parent snapshot instead of presenting it as current evidence", () => {
    const previous = createEmptyMealSafetyObservation(
      { ...meal, actualPeople: 28 },
      "demo",
    );
    openEditor({ observations: [previous] });
    expect(screen.getByRole("status")).toHaveTextContent(
      "最新安全觀察與目前餐期條件不一致",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "不可直接當作本餐目前條件的安全證據",
    );
  });

  it("keeps a locally entered manual meal in Demo provenance", async () => {
    const onSave = openEditor({ meal: { ...meal, source: "manual" } });
    confirmAndSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(vi.mocked(onSave).mock.calls[0][0]).toMatchObject({
      mealRecordId: meal.id,
      provenance: "demo",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("本機示範紀錄");
  });

  it("focuses the committed revision trigger after saving even when animation frames never run", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    const previous = createEmptyMealSafetyObservation(
      meal,
      "demo",
      "4c70b9ae-5f7d-4001-9d50-fc0fbbf42df1",
      "2026-09-04T06:00:00Z",
    );
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    openEditor({ observations: [previous], onSave });
    change("本次修訂原因", "依原始紀錄核對未知狀態");
    confirmAndSave();
    expect(
      screen.queryByRole("button", { name: "新增修訂版安全觀察" }),
    ).not.toBeInTheDocument();
    resolveSave();
    const trigger = await screen.findByRole("button", {
      name: "新增修訂版安全觀察",
    });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      screen.queryByRole("form", { name: "本餐安全觀察表單" }),
    ).not.toBeInTheDocument();
  });

  it("focuses the trigger on cancel and the new heading on reopen without animation frames", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    const trigger = screen.getByRole("button", { name: "補記本餐安全觀察" });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(
      screen.getByRole("heading", { name: "補上這餐的現場紀錄" }),
    ).toHaveFocus();
  });

  it("focuses new and repeated validation errors without requiring an animation frame or another render", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    const onSave = openEditor();
    const submit = screen.getByRole("button", {
      name: "確認並保存本餐安全觀察",
    });
    fireEvent.click(submit);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveFocus();
    submit.focus();
    expect(submit).toHaveFocus();
    fireEvent.click(submit);
    expect(alert).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });
});
