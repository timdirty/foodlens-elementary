// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SupplyCollaborationSheet } from "@/components/forecast/supply-collaboration-sheet";
import type { MealRecord, SupplyPrediction } from "@/lib/types";

const prediction: SupplyPrediction = {
  id: "prediction-review",
  createdAt: "2026-09-05T00:00:00.000Z",
  plannedPeople: 100,
  menuName: "咖哩飯｜雞肉咖哩",
  plannedSupplyG: 25_000,
  recommendedSupplyG: 22_800,
  averageLeftoverRate: 0.117,
  possibleSavingG: 2_200,
  possibleSavingTwd: 176,
  confidence: "low",
  matchLevel: "baseline",
  sampleSize: 1,
  independentDateCount: 1,
  evidenceMealIds: ["meal-review"],
  historyStart: "2026-08-01",
  historyEnd: "2026-08-15",
  reason: "依目前證據建立保守試算。",
  algorithmVersion: "foodlens-v1",
};

const evidenceMeal: MealRecord = {
  id: "meal-review",
  classId: "class-5a",
  servedOn: "2026-08-15",
  mealPeriod: "lunch",
  staple: "咖哩飯",
  mainDish: "雞肉咖哩",
  sideDishes: ["青菜"],
  menuSignature: "咖哩飯-雞肉咖哩",
  plannedPeople: 30,
  actualPeople: 29,
  totalSupplyG: 7_500,
  leftoverG: 878,
  measurementMethod: "scale",
  notes: "",
  source: "demo",
  createdAt: "2026-08-15T04:00:00.000Z",
  updatedAt: "2026-08-15T04:00:00.000Z",
};

afterEach(cleanup);

describe("SupplyCollaborationSheet", () => {
  it("labels an automatic quantity as a historical estimate, not a school plan", () => {
    render(
      <SupplyCollaborationSheet
        prediction={prediction}
        evidenceMeals={[evidenceMeal]}
        baselineKind="historical-estimate"
        dataMode="demo-local"
      />,
    );

    expect(screen.getByText("歷史試算基準")).toBeInTheDocument();
    expect(screen.getByText(/並非校方已核定的原計畫/)).toBeInTheDocument();
    expect(screen.getByText("模擬情境・非校方實測")).toBeInTheDocument();
  });

  it("keeps a manually entered plan pending human approval", () => {
    render(
      <SupplyCollaborationSheet
        prediction={prediction}
        evidenceMeals={[evidenceMeal]}
        baselineKind="school-plan"
        dataMode="school-cloud"
      />,
    );

    expect(screen.getByText("校方原計畫")).toBeInTheDocument();
    expect(
      screen.getByText(/仍待列印後由校方／營養師核准/),
    ).toBeInTheDocument();
    expect(screen.getByText("人類最後決定（列印後填寫）")).toBeInTheDocument();
  });
});
