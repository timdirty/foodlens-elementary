// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExperimentsPage from "@/app/(dashboard)/experiments/page";
import { MealSafetyComparisonPanel } from "./meal-safety-comparison";
import {
  createEmptyMealSafetyObservation,
  mealSafetyObservationSchema,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import { createDemoSnapshot } from "@/lib/seed";
import type {
  AppSnapshot,
  ImprovementExperiment,
  MealRecord,
} from "@/lib/types";

const mocks = vi.hoisted(() => ({
  snapshot: undefined as AppSnapshot | undefined,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/data-provider", () => ({
  useFoodLens: () => ({
    snapshot: mocks.snapshot,
    loading: false,
    mode: "demo-local",
    filters: { classId: "all", range: "all" },
    repository: {},
    refresh: vi.fn(),
  }),
}));

const experiment: ImprovementExperiment = {
  id: "isolated-safety-ui",
  title: "逐餐來源測試",
  classId: "class-5a",
  baselineStart: "2026-09-01",
  baselineEnd: "2026-09-02",
  interventionStart: "2026-09-08",
  interventionEnd: "2026-09-09",
  interventionDescription: "僅作回歸測試",
  createdAt: "2026-09-10T00:00:00Z",
};
function meal(date: string, people = 10): MealRecord {
  return {
    id: `isolated-${date}`,
    classId: "class-5a",
    servedOn: date,
    mealPeriod: "lunch",
    staple: "白飯",
    mainDish: "豆腐",
    sideDishes: ["青菜"],
    menuSignature: "白飯|豆腐",
    plannedPeople: people,
    actualPeople: people,
    totalSupplyG: people * 300,
    leftoverG: people * 30,
    measurementMethod: "scale",
    notes: "隔離測試",
    source: "demo",
    createdAt: `${date}T12:00:00+08:00`,
    updatedAt: `${date}T12:00:00+08:00`,
  };
}
function observation(
  parent: MealRecord,
  number: number,
): MealSafetyObservation {
  return createEmptyMealSafetyObservation(
    parent,
    "demo",
    `c591ad67-0f89-46b9-9a20-d01601ac${String(number).padStart(4, "0")}`,
    "2026-09-10T01:00:00Z",
  );
}
function collected(parent: MealRecord, number: number, rating: 1 | 5) {
  const ratings = [0, 0, 0, 0, 0];
  ratings[rating - 1] = parent.actualPeople;
  return mealSafetyObservationSchema.parse({
    ...observation(parent, number),
    sourceTitle: "隔離班級計次表",
    sourceReference: `紙本-${parent.servedOn}`,
    shortage: {
      status: "recorded",
      eventCount: 1,
      observedDiners: parent.actualPeople,
    },
    refill: {
      status: "recorded",
      eventCount: 2,
      observedDiners: parent.actualPeople,
    },
    satisfaction: {
      status: "collected",
      invitedDiners: parent.actualPeople,
      ratings,
    },
  });
}
function panel(
  meals: MealRecord[],
  observations: MealSafetyObservation[],
  selected = experiment,
) {
  return (
    <MealSafetyComparisonPanel
      snapshot={{
        classes: [{ id: "class-5a", name: "五年甲班", grade: 5, active: true }],
        meals,
        mealSafetyObservations: observations,
      }}
      experiment={selected}
      mode="demo-local"
    />
  );
}
function distribution() {
  return screen.getByRole("region", { name: "前後滿意度五格分布，可水平捲動" });
}

beforeEach(() => {
  mocks.snapshot = createDemoSnapshot();
});
afterEach(cleanup);

describe("逐餐安全比較呈現", () => {
  it("未收集顯示未知與缺少來源，不把空白轉成零票或安全", () => {
    const parents = [meal("2026-09-01"), meal("2026-09-08")];
    render(panel(parents, [observation(parents[0], 1)]));
    expect(
      within(distribution()).getAllByText("未收集／無有效分母"),
    ).toHaveLength(10);
    expect(within(distribution()).queryByText(/0 票/)).not.toBeInTheDocument();
    expect(
      screen.getAllByText("尚未收集滿意度；沒有有效回覆分母"),
    ).toHaveLength(2);
    const shortage = screen.getByRole("row", {
      name: /供應不足事件（缺餐回報）/,
    });
    expect(shortage).toHaveTextContent("明示未觀察 1 餐；缺少紀錄 0 餐");
    expect(shortage).toHaveTextContent("明示未觀察 0 餐；缺少紀錄 1 餐");
    expect(
      screen.getByText(/尚未量測時也不會顯示成「已安全」/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "前往每日紀錄補記逐餐安全觀察" }),
    ).toHaveAttribute("href", "/records");
  });

  it("明確收集零回覆保留零票，但均分不能推成零分", () => {
    const parent = meal("2026-09-01");
    const zero = collected(parent, 1, 5);
    zero.satisfaction.ratings = [0, 0, 0, 0, 0];
    render(panel([parent], [zero]));
    expect(
      within(distribution()).getAllByText("0 票（無有效回覆）"),
    ).toHaveLength(5);
    expect(
      within(distribution()).getAllByText("未收集／無有效分母"),
    ).toHaveLength(5);
    expect(
      screen.getByText(/0 份回覆 ÷ 10 邀請用餐人次；回覆率 0.0%/),
    ).toBeInTheDocument();
    expect(screen.queryByText("0.00／5 分")).not.toBeInTheDocument();
    expect(screen.getAllByText("尚無有效回覆均分")).toHaveLength(2);
  });

  it("以總票數加權均分、事件分母、獨立日及逐餐來源一併顯示", () => {
    const parents = [
      meal("2026-09-01", 10),
      meal("2026-09-02", 90),
      meal("2026-09-08", 10),
    ];
    render(
      panel(parents, [
        collected(parents[0], 1, 1),
        collected(parents[1], 2, 5),
        collected(parents[2], 3, 5),
      ]),
    );
    expect(screen.getByText("4.60／5 分")).toBeInTheDocument();
    expect(screen.queryByText("3.00／5 分")).not.toBeInTheDocument();
    const shortage = screen.getByRole("row", {
      name: /供應不足事件（缺餐回報）/,
    });
    expect(shortage).toHaveTextContent("2 事件人次 ÷ 100 觀察用餐人次");
    expect(shortage).toHaveTextContent("已觀察 2／2 餐期・2 個獨立日");
    expect(shortage).toHaveTextContent("2.0／百用餐人次");
    fireEvent.click(screen.getByText("查看納入計算的逐餐來源與修訂"));
    expect(screen.getByText(/紙本-2026-09-02/)).toBeInTheDocument();
    expect(screen.getAllByText("五年甲班")).toHaveLength(3);
    expect(screen.queryByText("class-5a")).not.toBeInTheDocument();
    expect(
      screen.getByText(/此提示是產品顯示門檻，不是研究有效性或安全認證/),
    ).toBeInTheDocument();
  });

  it("來源班級遺失時明示未知，原識別碼只放在補充 title", () => {
    const parent = meal("2026-09-01");
    render(
      <MealSafetyComparisonPanel
        snapshot={{
          classes: [],
          meals: [parent],
          mealSafetyObservations: [collected(parent, 1, 5)],
        }}
        experiment={experiment}
        mode="demo-local"
      />,
    );
    fireEvent.click(screen.getByText("查看納入計算的逐餐來源與修訂"));
    expect(screen.getByText("未知班級")).toHaveAttribute("title", "class-5a");
    expect(screen.queryByText("class-5a")).not.toBeInTheDocument();
  });

  it("兩期各有三餐已收集但全零票，仍提示有效回覆樣本不足", () => {
    const parents = [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ].map((date) => meal(date));
    const observations = parents.map((parent, index) => {
      const row = collected(parent, index + 1, 5);
      row.satisfaction.ratings = [0, 0, 0, 0, 0];
      return row;
    });
    render(
      panel(parents, observations, {
        ...experiment,
        baselineEnd: "2026-09-03",
        interventionEnd: "2026-09-10",
      }),
    );
    expect(screen.getByText(/護欄樣本仍需累積/)).toBeInTheDocument();
    expect(
      screen.getAllByText("其中有有效回覆 0 餐期・0 個獨立日"),
    ).toHaveLength(2);
    expect(screen.getAllByText("已收集 3／3 餐期・3 個獨立日")).toHaveLength(2);
  });

  it("餐期人數變更後保留排除提示，不把舊觀察算進前後差異", () => {
    const original = meal("2026-09-01");
    const after = meal("2026-09-08");
    render(
      panel(
        [{ ...original, actualPeople: 12 }, after],
        [collected(original, 1, 5), collected(after, 2, 5)],
      ),
    );
    expect(screen.getByText(/餐期人數或菜單已變更/)).toBeInTheDocument();
    const shortage = screen.getByRole("row", {
      name: /供應不足事件（缺餐回報）/,
    });
    expect(shortage).toHaveTextContent("排除 1 餐");
    expect(shortage).toHaveTextContent("無法比較");
  });

  it("重複自然餐期不偷偷合併，涵蓋率與菜單組成分母明示不明", () => {
    const parent = meal("2026-09-01");
    render(
      panel(
        [parent, { ...parent, id: "duplicate-parent" }],
        [collected(parent, 1, 5)],
      ),
    );
    expect(
      screen.getByText(/同班同日同餐期重複，相關安全觀察均排除/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/用餐涵蓋 分母未明/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("查看菜單組成與可能混雜"));
    expect(
      screen.getByText(/尚不能判定兩期組成是否可比較/),
    ).toBeInTheDocument();
  });

  it("切換實驗自身班級範圍重算，而非沿用上個實驗或全站篩選", () => {
    const parent = meal("2026-09-01");
    const view = render(panel([parent], [collected(parent, 1, 5)]));
    expect(screen.getByText("5.00／5 分")).toBeInTheDocument();
    view.rerender(
      panel([parent], [collected(parent, 1, 5)], {
        ...experiment,
        classId: "class-6b",
      }),
    );
    expect(screen.queryByText("5.00／5 分")).not.toBeInTheDocument();
    expect(
      within(distribution()).getAllByText("未收集／無有效分母"),
    ).toHaveLength(10);
  });
});

describe("實驗頁舊摘要與新逐餐流程隔離", () => {
  it("新實驗只保存人工檢查與干擾因素，不再建立未附逐餐來源的數字", () => {
    render(<ExperimentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "建立實驗" }));
    expect(screen.getByLabelText("營養師確認狀態")).toBeInTheDocument();
    expect(
      screen.getByLabelText("可能干擾因素（每行一項）"),
    ).toBeInTheDocument();
    for (const label of [
      /缺餐.*回報人次/,
      /添餐.*需求人次/,
      /滿意度.*平均/,
      /滿意度.*回覆數/,
    ])
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.getByText(/不接受人工代填總平均/)).toBeInTheDocument();
  });

  it("舊數字僅留在預設收合的歷史區，沒有新觀察時不挪用舊均分", () => {
    mocks.snapshot!.mealSafetyObservations = [];
    const { container } = render(<ExperimentsPage />);
    const legacy = screen
      .getByText("舊版實驗數值摘要（僅供歷史查閱）")
      .closest("details");
    expect(legacy).not.toHaveAttribute("open");
    expect(legacy).toHaveTextContent("未納入上方前後護欄計算");
    expect(legacy!.querySelector("input, select, textarea")).toBeNull();
    const comparison = container.querySelector(".meal-safety-comparison")!;
    expect(
      within(comparison as HTMLElement).getAllByText("尚無有效回覆均分"),
    ).toHaveLength(2);
    expect(
      within(comparison as HTMLElement).queryByText(/4\.1.*5/),
    ).not.toBeInTheDocument();
  });
});
