import { describe, expect, it } from "vitest";
import {
  appendMealSafetyObservation,
  compareMealSafetyForExperiment,
  createEmptyMealSafetyObservation,
  latestMealSafetyObservations,
  mealSafetyObservationSchema,
  validateMealSafetyHistory,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import { selectExperimentMeals } from "@/lib/analysis";
import type { ImprovementExperiment, MealRecord } from "@/lib/types";

const firstId = "c591ad67-0f89-46b9-9a20-d01601ac0011";
const secondId = "c591ad67-0f89-46b9-9a20-d01601ac0012";
const thirdId = "c591ad67-0f89-46b9-9a20-d01601ac0013";
function meal(date: string, people = 10, classId = "class-5a"): MealRecord {
  return {
    id: `${date}-${classId}`,
    classId,
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
const experiment: ImprovementExperiment = {
  id: "safety-experiment",
  title: "逐餐護欄測試",
  classId: "class-5a",
  baselineStart: "2026-09-01",
  baselineEnd: "2026-09-02",
  interventionStart: "2026-09-08",
  interventionEnd: "2026-09-09",
  interventionDescription: "示範比較",
  createdAt: "2026-09-10T00:00:00Z",
};
function observed(parent: MealRecord, id = firstId): MealSafetyObservation {
  return mealSafetyObservationSchema.parse({
    ...createEmptyMealSafetyObservation(
      parent,
      "demo",
      id,
      "2026-09-10T01:00:00Z",
    ),
    sourceTitle: "模擬班級計次表",
    sourceReference: `隔離表單-${parent.servedOn}`,
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
      ratings: [0, 0, 0, 0, parent.actualPeople],
    },
  });
}
function revision(previous: MealSafetyObservation): MealSafetyObservation {
  return {
    ...structuredClone(previous),
    id: secondId,
    revision: previous.revision + 1,
    previousObservationId: previous.id,
    revisionReason: "依原始紙本更正",
    recordedAt: "2026-09-10T01:01:00Z",
  };
}

describe("逐餐安全觀察 schema 與修訂歷史", () => {
  it("新觀察全部未知，已收集零票仍不同於未收集", () => {
    const parent = meal("2026-09-01");
    const empty = createEmptyMealSafetyObservation(parent, "demo", firstId);
    expect(empty.shortage).toEqual({
      status: "not-collected",
      eventCount: null,
      observedDiners: null,
    });
    expect(empty.satisfaction.ratings).toBeNull();
    const zero = observed(parent);
    zero.satisfaction.ratings = [0, 0, 0, 0, 0];
    expect(mealSafetyObservationSchema.parse(zero).satisfaction.status).toBe(
      "collected",
    );
  });

  it("拒絕未收集卻有數值、缺分母、無來源與超額票數", () => {
    const value = observed(meal("2026-09-01"));
    for (const invalid of [
      { ...value, shortage: { ...value.shortage, status: "not-collected" } },
      { ...value, shortage: { ...value.shortage, eventCount: null } },
      { ...value, refill: { ...value.refill, observedDiners: 0 } },
      { ...value, refill: { ...value.refill, observedDiners: 11 } },
      {
        ...value,
        satisfaction: { ...value.satisfaction, ratings: [0, 0, 0, 0, 11] },
      },
      {
        ...value,
        satisfaction: { ...value.satisfaction, ratings: [0, 0, null, 0, 0] },
      },
      { ...value, sourceReference: "" },
      { ...value, sourceTitle: "" },
      { ...value, shortage: { ...value.shortage, eventCount: 20_001 } },
      { ...value, shortage: { ...value.shortage, eventCount: 1.5 } },
    ])
      expect(mealSafetyObservationSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it("重複事件人次可高於實到人數，不能誤稱學生比例", () => {
    const value = observed(meal("2026-09-01"));
    value.refill.eventCount = 25;
    expect(mealSafetyObservationSchema.parse(value).refill.eventCount).toBe(25);
    const result = compareMealSafetyForExperiment(
      { meals: [meal("2026-09-01")], mealSafetyObservations: [value] },
      experiment,
    );
    expect(result.before.refill.per100DinerMeals).toBe(250);
  });

  it("append 保留歷史、拒絕 stale 修訂、同 id 僅接受完全相同內容，輸出不共用可變物件", () => {
    const parent = meal("2026-09-01");
    const first = observed(parent);
    const rows = appendMealSafetyObservation([], first, [parent], "demo-local");
    const second = revision(first);
    second.shortage.eventCount = 0;
    const history = appendMealSafetyObservation(
      rows,
      second,
      [parent],
      "demo-local",
    );
    expect(latestMealSafetyObservations(history)).toEqual([second]);
    const repeated = appendMealSafetyObservation(
      history,
      second,
      [parent],
      "demo-local",
    );
    repeated[0].shortage.eventCount = 7;
    expect(history[0].shortage.eventCount).toBe(1);
    first.refill.eventCount = 7;
    expect(history[0].refill.eventCount).toBe(2);
    expect(() =>
      appendMealSafetyObservation(
        history,
        { ...second, revisionReason: "換了一段內容" },
        [parent],
        "demo-local",
      ),
    ).toThrow("不可覆寫");
    expect(() =>
      appendMealSafetyObservation(
        history,
        { ...second, id: thirdId },
        [parent],
        "demo-local",
      ),
    ).toThrow("較新安全觀察");
    expect(() => validateMealSafetyHistory([second], [parent])).toThrow(
      "不連續",
    );
    expect(() =>
      validateMealSafetyHistory(
        [history[0], { ...second, recordedAt: "2026-09-01T00:00:00Z" }],
        [parent],
      ),
    ).toThrow("不可早於");
  });

  it("本機手動餐期可有 Demo 觀察；正式觀察不能綁 Demo，也不能混入本機模式", () => {
    const parent = { ...meal("2026-09-01"), source: "manual" as const };
    const local = observed(parent);
    expect(
      appendMealSafetyObservation([], local, [parent], "demo-local"),
    ).toHaveLength(1);
    const formal = { ...local, provenance: "school-record" as const };
    expect(
      appendMealSafetyObservation([], formal, [parent], "school-cloud"),
    ).toHaveLength(1);
    expect(() =>
      appendMealSafetyObservation(
        [],
        formal,
        [meal("2026-09-01")],
        "school-cloud",
      ),
    ).toThrow("身分不一致");
    expect(() =>
      appendMealSafetyObservation([], formal, [parent], "demo-local"),
    ).toThrow("目前資料模式");
  });

  it("舊人數或菜單 anchor 保留但不比較，可新增修訂；班級日期不能搬移", () => {
    const parent = meal("2026-09-01");
    const first = observed(parent);
    const changed = {
      ...parent,
      actualPeople: 12,
      menuSignature: "糙米飯|豆腐",
    };
    expect(() => validateMealSafetyHistory([first], [changed])).not.toThrow();
    const before = compareMealSafetyForExperiment(
      { meals: [changed], mealSafetyObservations: [first] },
      experiment,
    );
    expect(before.before.excludedMeals).toBe(1);
    expect(before.before.shortage.eventCount).toBeNull();
    expect(before.issues.join(" ")).toContain("餐期人數或菜單已變更");
    const second = {
      ...revision(first),
      mealSnapshot: {
        ...first.mealSnapshot,
        actualPeople: 12,
        menuSignature: changed.menuSignature,
      },
    };
    const history = appendMealSafetyObservation(
      [first],
      second,
      [changed],
      "demo-local",
    );
    expect(
      compareMealSafetyForExperiment(
        { meals: [changed], mealSafetyObservations: history },
        experiment,
      ).before.shortage.eventCount,
    ).toBe(1);
    expect(() =>
      validateMealSafetyHistory(history, [{ ...changed, classId: "class-6a" }]),
    ).toThrow("不一致");
  });

  it("同班同日同餐期重複時不得存，兩筆相關資料全排除且不猜分母", () => {
    const parent = meal("2026-09-01");
    const duplicate = { ...parent, id: "duplicate-parent" };
    const rows = [observed(parent), observed(duplicate, secondId)];
    expect(() =>
      appendMealSafetyObservation(
        [],
        rows[0],
        [parent, duplicate],
        "demo-local",
      ),
    ).toThrow("重複餐期");
    const result = compareMealSafetyForExperiment(
      { meals: [parent, duplicate], mealSafetyObservations: rows },
      experiment,
    );
    expect(result.before.excludedMeals).toBe(2);
    expect(result.before.eligibleDinerMeals).toBeNull();
    expect(result.before.shortage.eventCount).toBeNull();
    expect(result.comparisonBlocked).toBe(true);
  });
});

describe("實驗自身期別的逐餐安全比較", () => {
  it("1000 筆餐期與來源歷史透過索引聚合，無遺失或重複計數", () => {
    const meals = Array.from({ length: 1000 }, (_, index) =>
      meal(
        index < 500 ? "2026-09-01" : "2026-09-08",
        10,
        `class-${index % 500}`,
      ),
    );
    const observations = meals.map((parent, index) =>
      observed(
        parent,
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ),
    );
    expect(() => validateMealSafetyHistory(observations, meals)).not.toThrow();
    const result = compareMealSafetyForExperiment(
      { meals, mealSafetyObservations: observations },
      { ...experiment, classId: undefined },
    );
    expect(result.before.shortage.observedMeals).toBe(500);
    expect(result.after.shortage.observedMeals).toBe(500);
    expect(result.before.shortage.eventCount).toBe(500);
    expect(result.before.satisfaction.responseCount).toBe(5000);
    expect(result.before.menuComposition[0].mealCount).toBe(500);
    expect(result.issues).toEqual([]);
  });
  it("重用實驗班級/日期邊界，排除其他班與範圍外資料", () => {
    const meals = [
      meal("2026-09-01"),
      meal("2026-09-02"),
      meal("2026-09-08"),
      meal("2026-09-09"),
      meal("2026-09-02", 30, "class-5b"),
      meal("2026-09-03"),
    ];
    const selected = selectExperimentMeals({ meals }, experiment);
    expect(selected.baseline.map((row) => row.servedOn)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
    expect(selected.after.map((row) => row.servedOn)).toEqual([
      "2026-09-08",
      "2026-09-09",
    ]);
    const result = compareMealSafetyForExperiment(
      {
        meals,
        mealSafetyObservations: [
          observed(meals[0]),
          observed(meals[4], secondId),
        ],
      },
      experiment,
    );
    expect(result.before.eligibleMeals).toBe(2);
    expect(result.before.shortage.observedMeals).toBe(1);
    expect(result.before.shortage.mealCoverage).toBe(0.5);
    expect(result.before.missingMeals).toBe(1);
    expect(result.after.shortage.per100DinerMeals).toBeNull();
    expect(result.differences.shortagePer100).toBeNull();
  });

  it("用事件觀察人次與五格票數加權，不平均每餐比例或均分", () => {
    const meals = [
      meal("2026-09-01", 10),
      meal("2026-09-02", 90),
      meal("2026-09-08", 10),
    ];
    const one = observed(meals[0]);
    one.shortage.eventCount = 5;
    one.satisfaction.ratings = [10, 0, 0, 0, 0];
    const two = observed(meals[1], secondId);
    two.shortage.eventCount = 0;
    const three = observed(meals[2], thirdId);
    three.shortage.eventCount = 0;
    const result = compareMealSafetyForExperiment(
      { meals, mealSafetyObservations: [one, two, three] },
      experiment,
    );
    expect(result.before.shortage.per100DinerMeals).toBe(5);
    expect(result.before.shortage.observedDinerMeals).toBe(100);
    expect(result.before.satisfaction.mean).toBe(4.6);
    expect(result.before.satisfaction.ratings).toEqual([10, 0, 0, 0, 90]);
    expect(result.before.satisfaction.responseCount).toBe(100);
    expect(result.differences.shortagePer100).toBe(-5);
  });

  it("未知、已收集零票、缺少觀察與不同指標涵蓋率分開", () => {
    const meals = [meal("2026-09-01"), meal("2026-09-02"), meal("2026-09-08")];
    const unknown = createEmptyMealSafetyObservation(meals[0], "demo", firstId);
    const zero = observed(meals[1], secondId);
    zero.shortage = {
      status: "not-collected",
      eventCount: null,
      observedDiners: null,
    };
    zero.satisfaction.ratings = [0, 0, 0, 0, 0];
    const result = compareMealSafetyForExperiment(
      { meals, mealSafetyObservations: [unknown, zero] },
      experiment,
    );
    expect(result.before.shortage.uncollectedMeals).toBe(2);
    expect(result.before.refill.observedMeals).toBe(1);
    expect(result.before.satisfaction.zeroResponseMeals).toBe(1);
    expect(result.before.satisfaction.responseRate).toBe(0);
    expect(result.before.satisfaction.mean).toBeNull();
    expect(result.after.missingMeals).toBe(1);
    expect(result.after.satisfaction.responseRate).toBeNull();
  });

  it("相同均分保留不同分布，菜單集合相同但人次占比不同仍揭露混雜", () => {
    const meals = [
      meal("2026-09-01", 10),
      meal("2026-09-02", 30),
      meal("2026-09-08", 30),
      meal("2026-09-09", 10),
    ];
    meals[1].menuSignature = meals[3].menuSignature = "麵|豆腐";
    const before = observed(meals[0]);
    before.satisfaction.ratings = [5, 0, 0, 0, 5];
    const after = observed(meals[2], secondId);
    after.satisfaction.ratings = [0, 0, 10, 0, 0];
    const result = compareMealSafetyForExperiment(
      { meals, mealSafetyObservations: [before, after] },
      experiment,
    );
    expect(result.before.satisfaction.mean).toBe(3);
    expect(result.after.satisfaction.mean).toBe(3);
    expect(result.before.satisfaction.ratings).not.toEqual(
      result.after.satisfaction.ratings,
    );
    expect(result.menuMixDiffers).toBe(true);
    expect(result.sharedMenuSignatures).toHaveLength(2);
  });

  it("不從 legacy 摘要合成觀察，來源混接或修訂鏈錯誤不產生比較值", () => {
    const parent = meal("2026-09-01");
    const legacy = {
      ...experiment,
      safetyGuardrails: {
        shortageReportCount: 0,
        refillRequestCount: 0,
        satisfactionScore: 4.5,
        satisfactionResponseCount: 99,
        dietitianReview: "confirmed" as const,
        dietitianNote: "legacy",
        confounders: [],
        checkedAt: "2026-09-10T00:00:00Z",
      },
    };
    expect(
      compareMealSafetyForExperiment(
        { meals: [parent], mealSafetyObservations: [] },
        legacy,
      ).before.shortage.eventCount,
    ).toBeNull();
    const mismatch = {
      ...observed(parent),
      provenance: "school-record" as const,
    };
    expect(
      compareMealSafetyForExperiment(
        { meals: [parent], mealSafetyObservations: [mismatch] },
        experiment,
        "demo-local",
      ).before.excludedMeals,
    ).toBe(1);
    const broken = compareMealSafetyForExperiment(
      { meals: [parent], mealSafetyObservations: [revision(observed(parent))] },
      experiment,
    );
    expect(broken.comparisonBlocked).toBe(true);
    expect(broken.issues.join(" ")).toContain("修訂鏈無法驗證");
  });
});
