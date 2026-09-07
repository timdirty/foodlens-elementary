import { describe, expect, it } from "vitest";
import {
  assessEvidenceDataQuality,
  categoryRemainingShares,
  categoryStats,
  dashboardMetrics,
  experimentResult,
  generateInsights,
  menuStats,
  selectEvidenceCasesForMode,
  scopeSnapshot,
  snapshotDateRange,
  validateExperiment,
  weightedLeftoverRate,
} from "@/lib/analysis";
import { analyzeEvidenceCases } from "@/lib/evidence-chain";
import {
  addCalendarDays,
  calendarWeekday,
  formatCalendarMonthDay,
  mondayOfCalendarWeek,
  todayInTaipei,
} from "@/lib/date";
import {
  aiAnalysisSchema,
  createManualFoodAnalysis,
  MockFoodAnalysisProvider,
} from "@/lib/ai";
import { calculateImpact, impactBarWidth } from "@/lib/impact";
import {
  assessPredictionStability,
  createPrediction,
  getHistoricalSupplyBaseline,
  getPredictionEvidence,
  isActionablePrediction,
  JUDGE_DEMO_PREDICTION_INPUT,
  sortPredictionsNewestFirst,
} from "@/lib/prediction";
import { createDemoSnapshot } from "@/lib/seed";

describe("固定 Demo 資料", () => {
  it("可重現 48 筆餐期與 96 份餐盤", () => {
    const a = createDemoSnapshot();
    const b = createDemoSnapshot();
    expect(a.meals).toEqual(b.meals);
    expect(a.meals).toHaveLength(48);
    expect(a.scans).toHaveLength(96);
    expect(a.classes).toHaveLength(4);
    expect(
      a.meals.every((meal) => ![0, 6].includes(calendarWeekday(meal.servedOn))),
    ).toBe(true);
  });
  it("使用重量加權而不是直接平均百分比", () => {
    const snapshot = createDemoSnapshot();
    const rows = snapshot.meals.slice(0, 2);
    const expected =
      (rows[0].leftoverG + rows[1].leftoverG) /
      (rows[0].totalSupplyG + rows[1].totalSupplyG);
    expect(weightedLeftoverRate(rows)).toBeCloseTo(expected, 8);
    expect(weightedLeftoverRate([])).toBe(0);
  });
  it("以刻意設計的情境資料重算規則門檻與 27% 到 19% 案例", () => {
    const snapshot = createDemoSnapshot();
    const insights = generateInsights(snapshot);
    expect(insights.some((item) => item.id === "weekday")).toBe(true);
    expect(insights.some((item) => item.id === "category")).toBe(true);
    expect(insights.some((item) => item.id === "curry")).toBe(true);
    const result = experimentResult(snapshot);
    expect(result?.beforeRate).toBeCloseTo(0.27, 2);
    expect(result?.afterRate).toBeCloseTo(0.19, 2);
    expect(result?.relativeImprovement).toBeCloseTo(0.296, 2);
    expect(result?.isValid).toBe(true);
    expect(result?.beforeDateCount).toBe(2);
    expect(result?.afterDateCount).toBe(2);
    expect(categoryStats(snapshot)[0].name).toBe("蔬菜");
    expect(snapshot.experiments[0].safetyGuardrails).toMatchObject({
      dietitianReview: "confirmed",
      satisfactionResponseCount: 88,
    });
  });
  it("首頁把菜單剩食率與食物剩餘組成分成不同分母", () => {
    const snapshot = createDemoSnapshot();
    const menus = menuStats(snapshot);
    const composition = categoryRemainingShares(snapshot);

    expect(menus.length).toBeGreaterThanOrEqual(5);
    expect(
      menus.every(
        (item, index) => index === 0 || menus[index - 1].rate >= item.rate,
      ),
    ).toBe(true);
    expect(composition.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(
      100,
      1,
    );
    expect(
      composition.every((item) =>
        item.totalRemainingG
          ? item.share ===
            Number(((item.remainingG / item.totalRemainingG) * 100).toFixed(1))
          : item.share === 0,
      ),
    ).toBe(true);
  });
  it("改善實驗以完整資料重算，不受全站班級與期間篩選改寫", () => {
    const snapshot = createDemoSnapshot();
    const experiment = snapshot.experiments[0];
    const filteredDashboardSnapshot = scopeSnapshot(snapshot, {
      classId: "class-5a",
      range: "month",
    });

    const persistedExperimentResult = experimentResult(snapshot, experiment);
    const incorrectlyScopedResult = experimentResult(
      filteredDashboardSnapshot,
      experiment,
    );

    expect(persistedExperimentResult).toMatchObject({
      isValid: true,
      beforeSamples: 8,
      afterSamples: 8,
    });
    expect(persistedExperimentResult?.beforeRate).toBeCloseTo(0.27, 2);
    expect(persistedExperimentResult?.afterRate).toBeCloseTo(0.19, 2);
    expect(incorrectlyScopedResult?.isValid).toBe(false);
    expect(incorrectlyScopedResult?.beforeSamples).toBe(0);
  });
  it("涵蓋八個週次與五個平日，日期落在 115 學年度學期示範期間", () => {
    const snapshot = createDemoSnapshot();
    const dates = [...new Set(snapshot.meals.map((meal) => meal.servedOn))];
    expect(dates).toHaveLength(12);
    expect(new Set(dates.map(calendarWeekday))).toEqual(
      new Set([1, 2, 3, 4, 5]),
    );
    expect(new Set(dates.map(mondayOfCalendarWeek))).toHaveLength(8);
    expect(snapshotDateRange(snapshot)).toMatchObject({
      start: "2026-08-24",
      end: "2026-10-16",
    });
  });
  it("日期運算只依 YYYY-MM-DD，不受執行裝置時區影響", () => {
    expect(calendarWeekday("2026-09-04")).toBe(5);
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(mondayOfCalendarWeek("2026-09-04")).toBe("2026-08-31");
    expect(formatCalendarMonthDay("2026-09-04")).toBe("9/4");
    expect(todayInTaipei(new Date("2026-08-31T16:30:00.000Z"))).toBe(
      "2026-09-01",
    );
  });
  it("班級與期間篩選同步裁切完整餐盤稽核鏈", () => {
    const scoped = scopeSnapshot(createDemoSnapshot(), {
      classId: "class-5a",
      range: "month",
    });
    const mealIds = new Set(scoped.meals.map((meal) => meal.id));
    const scanIds = new Set(scoped.scans.map((scan) => scan.id));
    const detectionIds = new Set(
      scoped.detections.map((detection) => detection.id),
    );
    const evidenceCaseIds = new Set(
      scoped.evidenceCases.map((evidenceCase) => evidenceCase.id),
    );
    const collectionEventIds = new Set(
      scoped.collectionEvents.map((event) => event.id),
    );
    expect(scoped.classes.map((item) => item.id)).toEqual(["class-5a"]);
    expect(scoped.meals.every((meal) => meal.servedOn >= "2026-09-17")).toBe(
      true,
    );
    expect(scoped.scans.every((scan) => mealIds.has(scan.mealRecordId))).toBe(
      true,
    );
    expect(
      scoped.detections.every((detection) => scanIds.has(detection.scanId)),
    ).toBe(true);
    expect(
      scoped.corrections.every((correction) =>
        detectionIds.has(correction.detectionId),
      ),
    ).toBe(true);
    expect(scoped.evidenceCases.map((item) => item.id)).toEqual([
      "demo-evidence-2",
      "demo-evidence-3",
    ]);
    expect(
      scoped.collectionEvents.every((event) =>
        evidenceCaseIds.has(event.evidenceCaseId),
      ),
    ).toBe(true);
    expect(scoped.collectionEvents.map((event) => event.id)).toEqual([
      "demo-collection-submitted",
      "demo-collection-scheduled",
    ]);
    expect(
      scoped.destinationReceipts.every((receipt) =>
        collectionEventIds.has(receipt.collectionEventId),
      ),
    ).toBe(true);
    expect(scoped.destinationReceipts.map((receipt) => receipt.id)).toEqual([
      "demo-receipt-submitted",
    ]);

    const otherClass = scopeSnapshot(createDemoSnapshot(), {
      classId: "class-5b",
      range: "all",
    });
    expect(otherClass.evidenceCases).toHaveLength(0);
    expect(otherClass.collectionEvents).toHaveLength(0);
    expect(otherClass.destinationReceipts).toHaveLength(0);
  });
  it("五源證據依資料模式分流，示範與正式來源不會混算", () => {
    const snapshot = createDemoSnapshot();
    const formalCase = {
      ...structuredClone(snapshot.evidenceCases[0]),
      id: "measured-evidence-1",
      sourceKind: "measured" as const,
    };
    const cases = [...snapshot.evidenceCases, formalCase];

    const demoLane = selectEvidenceCasesForMode(cases, "demo-local");
    const formalLane = selectEvidenceCasesForMode(cases, "school-cloud");

    expect(demoLane).toMatchObject({ lane: "demo", excludedCount: 1 });
    expect(demoLane.cases).toHaveLength(3);
    expect(
      demoLane.cases.every(
        (evidenceCase) => evidenceCase.sourceKind === "demo",
      ),
    ).toBe(true);
    expect(formalLane).toMatchObject({ lane: "formal", excludedCount: 3 });
    expect(formalLane.cases.map((evidenceCase) => evidenceCase.id)).toEqual([
      "measured-evidence-1",
    ]);
  });
  it("五源品質任一門檻不足時明確要求更多資料", () => {
    const metrics = analyzeEvidenceCases(
      createDemoSnapshot().evidenceCases,
    ).metrics;

    expect(assessEvidenceDataQuality(metrics)).toMatchObject({
      isReady: true,
      needsMoreData: false,
      failedChecks: [],
    });
    expect(
      assessEvidenceDataQuality({
        ...metrics,
        independentMealCount: 1,
        coverageRate: 0.2,
        evidenceQuality: 0.5,
        drainageComparable: false,
      }),
    ).toMatchObject({
      isReady: false,
      needsMoreData: true,
      failedChecks: [
        "independentMeals",
        "plateCoverage",
        "measurementQuality",
        "standardDrainage",
      ],
    });
  });
  it("正式資料範圍以學校今日為截止，不把過期資料包裝成最近資料", () => {
    const snapshot = createDemoSnapshot();
    const scoped = scopeSnapshot(
      snapshot,
      { classId: "all", range: "month" },
      "2027-01-31",
    );
    expect(scoped.meals).toHaveLength(0);
    expect(scoped.evidenceCases).toHaveLength(0);
    expect(scoped.collectionEvents).toHaveLength(0);
    expect(scoped.destinationReceipts).toHaveLength(0);
    const metrics = dashboardMetrics(snapshot, "2027-01-31");
    expect(metrics.weekMealCount).toBe(0);
    expect(metrics.monthMealCount).toBe(0);
    expect(metrics.daysSinceLatestMeal).toBe(107);
  });
  it("改善實驗拒絕重疊、順序錯誤或獨立日期不足", () => {
    const snapshot = createDemoSnapshot();
    const invalid = validateExperiment(snapshot, {
      id: "invalid",
      title: "無效比較",
      baselineStart: "2026-09-02",
      baselineEnd: "2026-10-21",
      interventionStart: "2026-10-21",
      interventionEnd: "2026-10-23",
      classId: "class-5a",
      interventionDescription: "test",
      createdAt: "2026-10-23T16:00:00+08:00",
    });
    expect(invalid.isValid).toBe(false);
    expect(invalid.issues.some((item) => item.includes("不可重疊"))).toBe(true);
    expect(invalid.issues.some((item) => item.includes("3 筆"))).toBe(true);
  });
  it("類別差異未達 5 個百分點時不硬產生類別洞察", () => {
    const snapshot = createDemoSnapshot();
    snapshot.corrections = [];
    snapshot.detections = snapshot.detections.map((item) => ({
      ...item,
      aiRemainingRatio: 0.2,
      aiRemainingG: Math.round(item.aiOriginalG * 0.2),
    }));
    expect(
      generateInsights(snapshot).some((item) => item.id === "category"),
    ).toBe(false);
  });
});

describe("供餐與影響引擎", () => {
  function snapshotWithExactMenuRates(rates: number[]) {
    const snapshot = createDemoSnapshot();
    const template = snapshot.meals.find(
      (meal) => meal.staple === "咖哩飯" && meal.mainDish === "雞肉咖哩",
    );
    if (!template) throw new Error("Demo 應包含咖哩飯樣本");
    snapshot.meals = rates.map((rate, index) => ({
      ...template,
      id: `stability-meal-${index + 1}`,
      servedOn: `2026-10-${String(index + 1).padStart(2, "0")}`,
      totalSupplyG: 10_000,
      leftoverG: Math.round(10_000 * rate),
    }));
    return snapshot;
  }

  it("原計畫留白時會依歷史每人供應量與預計人數建立基準", () => {
    const snapshot = createDemoSnapshot();
    const fiftyPeople = createPrediction(snapshot, {
      ...JUDGE_DEMO_PREDICTION_INPUT,
      plannedPeople: 50,
      plannedSupplyG: 0,
    });
    const hundredPeople = createPrediction(snapshot, {
      ...JUDGE_DEMO_PREDICTION_INPUT,
      plannedPeople: 100,
      plannedSupplyG: 0,
    });
    const manualPlan = createPrediction(snapshot, {
      ...JUDGE_DEMO_PREDICTION_INPUT,
      plannedPeople: 50,
      plannedSupplyG: 25_000,
    });

    expect(hundredPeople.plannedSupplyG).toBeGreaterThan(
      fiftyPeople.plannedSupplyG,
    );
    expect(
      Math.abs(hundredPeople.plannedSupplyG - fiftyPeople.plannedSupplyG * 2),
    ).toBeLessThanOrEqual(1);
    expect(hundredPeople.recommendedSupplyG).toBeGreaterThan(
      fiftyPeople.recommendedSupplyG,
    );
    expect(
      Math.abs(
        hundredPeople.recommendedSupplyG - fiftyPeople.recommendedSupplyG * 2,
      ),
    ).toBeLessThanOrEqual(1);
    expect(manualPlan.plannedSupplyG).toBe(25_000);
    expect(manualPlan.recommendedSupplyG).toBeLessThan(25_000);
    expect(manualPlan.reason).toContain("採用人工輸入的原計畫 25000g");
    expect(fiftyPeople.reason).toContain("歷史每人供應中位數");
  });

  it("自動基準會隨人數改變，且與供餐建議使用同一份歷史證據", () => {
    const snapshot = createDemoSnapshot();
    const input = {
      plannedPeople: 80,
      menuName: JUDGE_DEMO_PREDICTION_INPUT.menuName,
      plannedSupplyG: 0,
    };
    const baseline = getHistoricalSupplyBaseline(snapshot, input);
    const result = createPrediction(snapshot, input);

    expect(baseline.historicalPerPersonG).toBeGreaterThan(0);
    expect(baseline.plannedSupplyG).toBe(
      Math.round(baseline.historicalPerPersonG * input.plannedPeople),
    );
    expect(result.plannedSupplyG).toBe(baseline.plannedSupplyG);
    expect(result.reason).toContain(
      `${input.plannedPeople} 人 = ${baseline.plannedSupplyG}g`,
    );
  });

  it("已保存供餐情境不依 repository 回傳順序判斷最新一筆", () => {
    const snapshot = createDemoSnapshot();
    const older = {
      ...createPrediction(snapshot, JUDGE_DEMO_PREDICTION_INPUT),
      id: "prediction-older",
      createdAt: "2026-08-30T08:00:00.000Z",
    };
    const newer = {
      ...older,
      id: "prediction-newer",
      createdAt: "2026-08-31T08:00:00.000Z",
    };
    const source = [older, newer];

    expect(sortPredictionsNewestFirst(source).map((item) => item.id)).toEqual([
      "prediction-newer",
      "prediction-older",
    ]);
    expect(source.map((item) => item.id)).toEqual([
      "prediction-older",
      "prediction-newer",
    ]);
  });

  it("沒有任何歷史餐期時不會把 0 kg 當成可執行建議", () => {
    const snapshot = createDemoSnapshot();
    snapshot.meals = [];
    const result = createPrediction(snapshot, {
      plannedPeople: 100,
      menuName: "尚未有紀錄的新菜單",
      plannedSupplyG: 0,
    });

    expect(result.matchLevel).toBe("insufficient");
    expect(result.plannedSupplyG).toBe(0);
    expect(isActionablePrediction(result)).toBe(false);
  });

  it("相同菜色上限 15%，全校 fallback 上限 5%", () => {
    const snapshot = createDemoSnapshot();
    const exact = createPrediction(snapshot, JUDGE_DEMO_PREDICTION_INPUT);
    expect(exact.matchLevel).toBe("exact");
    expect(exact.independentDateCount).toBe(3);
    expect(exact.sampleSize).toBe(12);
    expect(exact.confidence).toBe("medium");
    expect(exact.evidenceMealIds).toHaveLength(exact.sampleSize);
    expect(
      getPredictionEvidence(snapshot, exact).map((meal) => meal.id),
    ).toEqual(exact.evidenceMealIds);
    expect(exact.possibleSavingG).toBeLessThanOrEqual(3750);
    expect(exact.recommendedSupplyG).toBe(21_865);
    expect(exact.possibleSavingG).toBe(3_135);
    const fallback = createPrediction(snapshot, {
      plannedPeople: 100,
      menuName: "從未供應的火星料理",
      plannedSupplyG: 25000,
    });
    expect(fallback.matchLevel).toBe("baseline");
    expect(fallback.independentDateCount).toBe(8);
    expect(fallback.possibleSavingG).toBeLessThanOrEqual(1250);
  });
  it("六個極端高波動的相同菜色日不會被標成高信心", () => {
    const snapshot = snapshotWithExactMenuRates([
      0.02, 0.55, 0.03, 0.58, 0.04, 0.6,
    ]);
    const result = createPrediction(snapshot, JUDGE_DEMO_PREDICTION_INPUT);
    const stability = assessPredictionStability(snapshot.meals);

    expect(result.matchLevel).toBe("exact");
    expect(result.independentDateCount).toBe(6);
    expect(stability.level).toBe("volatile");
    expect(stability.rangeRate).toBeGreaterThan(0.5);
    expect(result.confidence).toBe("low");
    expect(result.reason).toContain("信心由高降為低");
  });
  it("六個低波動的相同菜色日可以維持高信心", () => {
    const snapshot = snapshotWithExactMenuRates([
      0.18, 0.19, 0.2, 0.21, 0.2, 0.19,
    ]);
    const result = createPrediction(snapshot, JUDGE_DEMO_PREDICTION_INPUT);
    const stability = assessPredictionStability(snapshot.meals);

    expect(result.matchLevel).toBe("exact");
    expect(result.independentDateCount).toBe(6);
    expect(stability.level).toBe("stable");
    expect(stability.iqrRate).toBeLessThanOrEqual(0.05);
    expect(result.confidence).toBe("high");
    expect(result.reason).toContain("穩定：逐日加權剩食率");
  });
  it("公開假設一致換算週、學期、學年", () => {
    const settings = createDemoSnapshot().impactSettings;
    const result = calculateImpact(settings, 10);
    expect(result.week.grams).toBe(
      settings.schoolDailyBaselineG * 0.1 * settings.schoolDaysPerWeek,
    );
    expect(result.semester.grams).toBe(
      result.week.grams * settings.weeksPerSemester,
    );
    expect(result.year.grams).toBe(
      result.semester.grams * settings.semestersPerYear,
    );
  });
  it("全校基準為 0 時維持有限數值與空白進度條", () => {
    const settings = {
      ...createDemoSnapshot().impactSettings,
      schoolDailyBaselineG: 0,
    };
    const result = calculateImpact(settings, 10);

    expect(result.week).toEqual({ grams: 0, costTwd: 0 });
    expect(result.semester).toEqual({ grams: 0, costTwd: 0 });
    expect(result.year).toEqual({ grams: 0, costTwd: 0 });
    expect(impactBarWidth(result.week.grams, result.year.grams)).toBe(0);
    expect(impactBarWidth(100, 1000)).toBe(12);
    expect(impactBarWidth(500, 1000)).toBe(50);
  });
});

describe("AI schema 與 Mock", () => {
  it("拒絕超出範圍的模型輸出", () => {
    expect(() =>
      aiAnalysisSchema.parse({
        schemaVersion: "1",
        provider: "x",
        model: "x",
        isMock: false,
        detections: [
          {
            category: "rice",
            label: "白飯",
            originalG: 120,
            remainingRatio: 1.5,
            remainingG: 180,
            confidence: 0.9,
          },
        ],
        warnings: [],
        analyzedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
  it("拒絕比例與重量互相矛盾的模型輸出", () => {
    expect(() =>
      aiAnalysisSchema.parse({
        schemaVersion: "1",
        provider: "x",
        model: "x",
        isMock: false,
        detections: [
          {
            category: "rice",
            label: "白飯",
            originalG: 120,
            remainingRatio: 0.25,
            remainingG: 80,
            confidence: 0.9,
          },
        ],
        warnings: [],
        analyzedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
  it("相同示範照片得到穩定結果", async () => {
    const provider = new MockFoodAnalysisProvider();
    const a = await provider.analyze({ fingerprint: "plate-curry.png" });
    const b = await provider.analyze({ fingerprint: "plate-curry.png" });
    expect(a.detections).toEqual(b.detections);
    expect(a.isMock).toBe(true);
  });
  it("Mock 只以已確認候選優先命名，仍保留可重現的固定比例情境", async () => {
    const provider = new MockFoodAnalysisProvider();
    const menuCandidates = [
      {
        label: "糙米飯",
        rawName: "糙米飯",
        category: "rice" as const,
        role: "staple" as const,
        basis: "planned" as const,
      },
      {
        label: "咖哩雞丁",
        rawName: "咖哩雞丁",
        category: "meat" as const,
        role: "main" as const,
        basis: "planned" as const,
      },
      {
        label: "清炒高麗菜",
        rawName: "清炒高麗菜",
        category: "vegetable" as const,
        role: "side" as const,
        basis: "substitution" as const,
      },
    ];
    const baseline = await provider.analyze({ fingerprint: "plate-curry.png" });
    const assisted = await provider.analyze({
      fingerprint: "plate-curry.png",
      menuCandidates,
    });

    expect(assisted.detections.map((item) => item.label)).toEqual([
      "糙米飯",
      "清炒高麗菜",
      "咖哩雞丁",
    ]);
    expect(
      assisted.detections.map((item) => ({
        originalG: item.originalG,
        remainingRatio: item.remainingRatio,
        remainingG: item.remainingG,
      })),
    ).toEqual(
      baseline.detections.map((item) => ({
        originalG: item.originalG,
        remainingRatio: item.remainingRatio,
        remainingG: item.remainingG,
      })),
    );
    expect(assisted.warnings.join(" ")).toContain("Mock 未讀取照片");
    expect(assisted.warnings.join(" ")).toContain("候選不是辨識答案");
    expect(baseline.warnings.join(" ")).toContain("未使用已確認菜單候選");
  });
  it("人工判讀建立的是明確標示的起始表，不冒充模型輸出", () => {
    const analysis = createManualFoodAnalysis({
      staple: "陽春麵",
      mainDish: "番茄炒蛋",
      sideDishes: ["小白菜"],
    });
    expect(analysis.provider).toBe("human-manual");
    expect(analysis.model).toBe("manual-entry-v1");
    expect(analysis.isMock).toBe(false);
    expect(analysis.detections.map((item) => item.category)).toEqual([
      "noodles",
      "egg",
      "vegetable",
    ]);
    expect(analysis.detections.every((item) => item.confidence === 0)).toBe(
      true,
    );
    expect(analysis.warnings.join(" ")).toContain("沒有 AI 模型輸出");
  });
});
