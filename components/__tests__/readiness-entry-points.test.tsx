// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "@/app/(dashboard)/admin/page";
import PresentationPage from "@/app/presentation/page";
import { createDemoSnapshot } from "@/lib/seed";
import type { AppSnapshot, DataMode } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  useFoodLens: vi.fn(),
  scanInspection: vi.fn(),
  workflowInspection: vi.fn(),
  clearScans: vi.fn(),
  clearWorkflows: vi.fn(),
}));

vi.mock("@/components/data-provider", () => ({
  useFoodLens: mocks.useFoodLens,
}));
vi.mock("@/lib/scan-draft", () => ({
  usePendingScanDraftInspection: mocks.scanInspection,
  clearScanDrafts: mocks.clearScans,
}));
vi.mock("@/lib/workflow-draft", () => ({
  usePendingWorkflowDraftInspection: mocks.workflowInspection,
  clearWorkflowDrafts: mocks.clearWorkflows,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function setWorkspace(snapshot: AppSnapshot, mode: DataMode = "demo-local") {
  mocks.useFoodLens.mockReturnValue({
    snapshot,
    scopedSnapshot: snapshot,
    mode,
    loading: false,
    repository: {},
    filters: { classId: "all", range: "8-weeks" },
    refresh: vi.fn(),
    setMode: vi.fn(),
  });
}

function formalSnapshot() {
  const snapshot = createDemoSnapshot();
  snapshot.profile = {
    ...snapshot.profile,
    schoolName: "臺北市永續國小",
    teamName: "綠芽研究隊",
    teamMembers: "王同學、李同學",
  };
  return snapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWorkspace(formalSnapshot());
  mocks.scanInspection.mockReturnValue({
    mode: "demo-local",
    status: "ready",
    count: 0,
  });
  mocks.workflowInspection.mockReturnValue({
    mode: "demo-local",
    status: "ready",
    count: 0,
  });
});

afterEach(() => {
  expect(mocks.clearScans).not.toHaveBeenCalled();
  expect(mocks.clearWorkflows).not.toHaveBeenCalled();
  cleanup();
});

describe("readiness entry points", () => {
  it("marks the admin Live Demo ready once identity, seed and both draft inspections pass", () => {
    render(<AdminPage />);
    expect(screen.getByText("Live Demo 已就緒")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "模擬資料仍維持示範標示",
    );
    expect(
      screen.getByRole("link", { name: "查看完整展示預檢" }),
    ).toHaveAttribute("href", "/presentation");
  });

  it("does not bypass identity or fixed evidence when both stores are clear", () => {
    const view = render(<AdminPage />);
    setWorkspace(createDemoSnapshot());
    view.rerender(<AdminPage />);
    expect(screen.getByText("Live Demo 待確認展示資料")).toBeInTheDocument();

    const changed = formalSnapshot();
    changed.meals = changed.meals.slice(1);
    setWorkspace(changed);
    view.rerender(<AdminPage />);
    expect(screen.queryByText("Live Demo 已就緒")).not.toBeInTheDocument();
  });

  it("keeps an incomplete inspection distinct from zero drafts", () => {
    mocks.workflowInspection.mockReturnValue({
      mode: "demo-local",
      status: "checking",
    });
    render(<AdminPage />);
    expect(screen.getByText("Live Demo 檢查中")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在唯讀檢查");
    expect(screen.getByRole("status")).not.toHaveTextContent("沒有未完成草稿");
  });

  it("makes failed local inspection visible without claiming clear storage", () => {
    mocks.scanInspection.mockReturnValue({
      mode: "demo-local",
      status: "unavailable",
    });
    render(<AdminPage />);
    expect(screen.getByText("Live Demo 無法檢查草稿")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("不能視為零份");
    expect(screen.getByRole("status")).toHaveTextContent("既有草稿不會被清除");
  });

  it("shows both pending draft counts and passes the refreshed snapshot to both inspectors", () => {
    mocks.scanInspection.mockReturnValue({
      mode: "demo-local",
      status: "ready",
      count: 1,
    });
    mocks.workflowInspection.mockReturnValue({
      mode: "demo-local",
      status: "ready",
      count: 2,
    });
    const view = render(<AdminPage />);
    expect(screen.getByText("Live Demo 尚有 3 份草稿")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "未完成掃描 1 份、午餐任務 2 份",
    );
    const refreshed = formalSnapshot();
    setWorkspace(refreshed);
    view.rerender(<AdminPage />);
    expect(mocks.scanInspection).toHaveBeenLastCalledWith(
      "demo-local",
      refreshed,
    );
    expect(mocks.workflowInspection).toHaveBeenLastCalledWith(
      "demo-local",
      refreshed,
    );
  });

  it("does not equate completed basic cloud fields with storage verification or school approval", () => {
    const snapshot = formalSnapshot();
    snapshot.profile = {
      ...snapshot.profile,
      privacyContact: "午餐秘書",
      dataRetentionDays: 180,
      governanceReviewedAt: "2026-09-06T09:00:00+08:00",
    };
    snapshot.impactSettings = {
      ...snapshot.impactSettings,
      sourceTitle: "本校午餐廚餘秤重表",
      retrievedAt: "2026-09-04",
    };
    snapshot.meals = [
      { ...snapshot.meals[0], source: "manual", measurementMethod: "scale" },
    ];
    setWorkspace(snapshot, "school-cloud");
    render(<AdminPage />);
    expect(
      screen.getByRole("heading", {
        name: "基本資料已備齊，仍需校方核准與校園雲端驗證",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "前往校園雲端驗證" }),
    ).toBeInTheDocument();
    expect(screen.getByText("校園基本設定 6/6")).toBeInTheDocument();
    expect(
      screen.getByLabelText("校園基本設定完成度 100%"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "六項基本設定檢查" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("可以開始正式校園研究")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "不把展示預檢當成研究成果驗證",
    );
  });

  it("shows a completed identity in presentation when only pending drafts block entry", () => {
    mocks.workflowInspection.mockReturnValue({
      mode: "demo-local",
      status: "ready",
      count: 1,
    });
    render(<PresentationPage />);
    const identity = screen.getByText("正式參賽身分").parentElement!;
    expect(within(identity).getByText("已完成")).toBeInTheDocument();
    expect(within(identity).queryByText("尚未完成")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "前往午餐任務台處理草稿" }),
    ).toBeInTheDocument();
  });

  it("labels cloud evidence by its own source instead of claiming a fixed Demo seed check", () => {
    setWorkspace(formalSnapshot(), "school-cloud");
    mocks.workflowInspection.mockReturnValue({
      mode: "school-cloud",
      status: "ready",
      count: 1,
    });
    render(<PresentationPage />);
    expect(screen.getByText("校園資料來源")).toBeInTheDocument();
    expect(screen.getByText("沿用每筆來源標示")).toBeInTheDocument();
    expect(screen.queryByText("固定示範證據")).not.toBeInTheDocument();
  });
});
