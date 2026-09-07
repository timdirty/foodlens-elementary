import {
  CATEGORY_LABELS,
  type AppFilters,
  type AppSnapshot,
  type DataMode,
  type FoodCategory,
  type ImprovementExperiment,
  type Insight,
  type MealRecord,
} from "@/lib/types";
import {
  addCalendarDays,
  calendarWeekday,
  calendarDayDifference,
  distinctCalendarDates,
  epochDay,
  formatCalendarMonthDay,
  mondayOfCalendarWeek,
} from "@/lib/date";
import {
  WASTE_RULE_THRESHOLDS,
  type WasteMetrics,
} from "@/lib/waste-intelligence";

const RANGE_DAYS: Record<Exclude<AppFilters["range"], "all">, number> = {
  "8-weeks": 56,
  month: 30,
};

export function scopeSnapshot(
  snapshot: AppSnapshot,
  filters: AppFilters,
  referenceDate?: string,
): AppSnapshot {
  const latest =
    referenceDate ??
    [...snapshot.meals].sort((left, right) =>
      right.servedOn.localeCompare(left.servedOn),
    )[0]?.servedOn;
  const cutoff =
    latest && filters.range !== "all"
      ? addCalendarDays(latest, -(RANGE_DAYS[filters.range] - 1))
      : undefined;
  const meals = snapshot.meals.filter(
    (meal) =>
      (filters.classId === "all" || meal.classId === filters.classId) &&
      (!cutoff || meal.servedOn >= cutoff) &&
      (!referenceDate || meal.servedOn <= referenceDate),
  );
  const mealIds = new Set(meals.map((meal) => meal.id));
  const scans = snapshot.scans.filter((scan) => mealIds.has(scan.mealRecordId));
  const scanIds = new Set(scans.map((scan) => scan.id));
  const detections = snapshot.detections.filter((detection) =>
    scanIds.has(detection.scanId),
  );
  const detectionIds = new Set(detections.map((detection) => detection.id));
  const evidenceCases = snapshot.evidenceCases.filter(
    (evidenceCase) =>
      (filters.classId === "all" || evidenceCase.classId === filters.classId) &&
      (!cutoff || evidenceCase.servedOn >= cutoff) &&
      (!referenceDate || evidenceCase.servedOn <= referenceDate),
  );
  const evidenceCaseIds = new Set(
    evidenceCases.map((evidenceCase) => evidenceCase.id),
  );
  const collectionEvents = snapshot.collectionEvents.filter((event) =>
    evidenceCaseIds.has(event.evidenceCaseId),
  );
  const collectionEventIds = new Set(collectionEvents.map((event) => event.id));
  return {
    ...snapshot,
    classes:
      filters.classId === "all"
        ? snapshot.classes
        : snapshot.classes.filter((item) => item.id === filters.classId),
    meals,
    mealSafetyObservations: snapshot.mealSafetyObservations.filter(
      (observation) => mealIds.has(observation.mealRecordId),
    ),
    scans,
    detections,
    corrections: snapshot.corrections.filter((correction) =>
      detectionIds.has(correction.detectionId),
    ),
    evidenceCases,
    collectionEvents,
    destinationReceipts: snapshot.destinationReceipts.filter((receipt) =>
      collectionEventIds.has(receipt.collectionEventId),
    ),
  };
}

/**
 * Keep synthetic demonstrations and formal school evidence in separate
 * analysis lanes. This is intentionally independent from the visible filters:
 * a cloud import containing Demo rows still cannot silently affect school
 * findings, and locally entered formal-looking rows cannot inflate the Demo.
 */
export function selectEvidenceCasesForMode(
  evidenceCases: AppSnapshot["evidenceCases"],
  mode: DataMode,
) {
  const lane = mode === "demo-local" ? "demo" : "formal";
  const cases = evidenceCases.filter((evidenceCase) =>
    lane === "demo"
      ? evidenceCase.sourceKind === "demo"
      : evidenceCase.sourceKind !== "demo",
  );
  return {
    lane,
    cases,
    excludedCount: evidenceCases.length - cases.length,
  } as const;
}

export function assessEvidenceDataQuality(metrics: WasteMetrics) {
  const checks = {
    independentMeals:
      metrics.independentMealCount >=
      WASTE_RULE_THRESHOLDS.minimumIndependentMeals,
    plateCoverage:
      metrics.coverageRate >= WASTE_RULE_THRESHOLDS.minimumPlateCoverageRate,
    measurementQuality:
      metrics.evidenceQuality >= WASTE_RULE_THRESHOLDS.minimumEvidenceQuality,
    standardDrainage: metrics.drainageComparable,
  };
  const failedChecks = (
    Object.entries(checks) as Array<[keyof typeof checks, boolean]>
  )
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  return {
    checks,
    failedChecks,
    isReady: failedChecks.length === 0,
    needsMoreData: failedChecks.length > 0,
  };
}

export function snapshotDateRange(snapshot: AppSnapshot) {
  const dates = distinctCalendarDates(
    snapshot.meals.map((meal) => meal.servedOn),
  );
  return {
    start: dates[0],
    end: dates.at(-1),
    independentDateCount: dates.length,
  };
}

export function weightedLeftoverRate(meals: MealRecord[]): number {
  const supply = meals.reduce((sum, meal) => sum + meal.totalSupplyG, 0);
  return supply > 0
    ? meals.reduce((sum, meal) => sum + meal.leftoverG, 0) / supply
    : 0;
}

export function percent(value: number, digits = 1) {
  return Number((value * 100).toFixed(digits));
}

export function formatDate(date: string) {
  return formatCalendarMonthDay(date);
}

export function className(snapshot: AppSnapshot, classId: string) {
  return (
    snapshot.classes.find((item) => item.id === classId)?.name ?? "未知班級"
  );
}

export function getFinalDetection(snapshot: AppSnapshot, detectionId: string) {
  const detection = snapshot.detections.find((item) => item.id === detectionId);
  if (!detection) return undefined;
  const correction = snapshot.corrections.find(
    (item) => item.detectionId === detectionId,
  );
  return {
    ...detection,
    finalCategory: correction?.correctedCategory ?? detection.category,
    finalLabel: correction?.correctedLabel ?? detection.label,
    finalOriginalG: correction?.correctedOriginalG ?? detection.aiOriginalG,
    finalRemainingRatio:
      correction?.correctedRemainingRatio ?? detection.aiRemainingRatio,
    finalRemainingG: correction?.correctedRemainingG ?? detection.aiRemainingG,
    wasCorrected: Boolean(correction),
  };
}

export function latestMeals(snapshot: AppSnapshot) {
  const latest = [...snapshot.meals].sort((a, b) =>
    b.servedOn.localeCompare(a.servedOn),
  )[0]?.servedOn;
  return {
    latest,
    meals: latest
      ? snapshot.meals.filter((meal) => meal.servedOn === latest)
      : [],
  };
}

export function dashboardMetrics(
  snapshot: AppSnapshot,
  referenceDate?: string,
) {
  const sorted = [...snapshot.meals].sort((a, b) =>
    a.servedOn.localeCompare(b.servedOn),
  );
  const latest = sorted.at(-1)?.servedOn;
  const windowEnd = referenceDate ?? latest;
  const weekCutoff = windowEnd ? addCalendarDays(windowEnd, -6) : undefined;
  const monthCutoff = windowEnd ? addCalendarDays(windowEnd, -29) : undefined;
  const latestDayMeals = latest
    ? sorted.filter((meal) => meal.servedOn === latest)
    : [];
  const weekMeals = weekCutoff
    ? sorted.filter(
        (meal) => meal.servedOn >= weekCutoff && meal.servedOn <= windowEnd!,
      )
    : [];
  const monthMeals = monthCutoff
    ? sorted.filter(
        (meal) => meal.servedOn >= monthCutoff && meal.servedOn <= windowEnd!,
      )
    : [];
  const experiment = experimentResult(snapshot);
  const baselineRate = experiment?.isValid ? experiment.beforeRate : 0;
  const afterRate = experiment?.isValid ? experiment.afterRate : 0;
  const pointDrop = Math.max(0, baselineRate - afterRate);
  const improvement = baselineRate > 0 ? pointDrop / baselineRate : 0;
  const monthSupply = monthMeals.reduce(
    (sum, meal) => sum + meal.totalSupplyG,
    0,
  );
  const avoidedG = Math.round(monthSupply * pointDrop);
  return {
    latestMealDate: latest,
    daysSinceLatestMeal:
      latest && referenceDate
        ? Math.max(0, calendarDayDifference(referenceDate, latest))
        : 0,
    latestDayLeftoverG: latestDayMeals.reduce(
      (sum, meal) => sum + meal.leftoverG,
      0,
    ),
    weekLeftoverG: weekMeals.reduce((sum, meal) => sum + meal.leftoverG, 0),
    monthLeftoverG: monthMeals.reduce((sum, meal) => sum + meal.leftoverG, 0),
    improvementRate: improvement,
    absolutePointDrop: pointDrop,
    analyzedPlates: snapshot.scans.filter((scan) => scan.status === "confirmed")
      .length,
    estimatedSavedCostTwd: Math.round(
      (avoidedG / 1000) * snapshot.impactSettings.costTwdPerKg,
    ),
    estimatedAvoidedWasteG: avoidedG,
    weekRate: weightedLeftoverRate(weekMeals),
    weekMealCount: weekMeals.length,
    monthMealCount: monthMeals.length,
    baselineRate,
    afterRate,
    experimentValid: experiment?.isValid ?? false,
    baselineDateCount: experiment?.beforeDateCount ?? 0,
    afterDateCount: experiment?.afterDateCount ?? 0,
  };
}

export function dailyTrend(snapshot: AppSnapshot) {
  const grouped = new Map<string, MealRecord[]>();
  snapshot.meals.forEach((meal) =>
    grouped.set(meal.servedOn, [...(grouped.get(meal.servedOn) ?? []), meal]),
  );
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, meals]) => ({
      date,
      label: formatDate(date),
      rate: percent(weightedLeftoverRate(meals)),
      leftoverKg: Number(
        (meals.reduce((sum, meal) => sum + meal.leftoverG, 0) / 1000).toFixed(
          1,
        ),
      ),
      samples: meals.length,
    }));
}

export function weeklyStats(snapshot: AppSnapshot) {
  const grouped = new Map<string, MealRecord[]>();
  snapshot.meals.forEach((meal) => {
    const key = mondayOfCalendarWeek(meal.servedOn);
    grouped.set(key, [...(grouped.get(key) ?? []), meal]);
  });
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, meals], index) => ({
      week,
      name: `第 ${index + 1} 週`,
      rate: percent(weightedLeftoverRate(meals)),
      count: meals.length,
      dateCount: distinctCalendarDates(meals.map((meal) => meal.servedOn))
        .length,
    }));
}

export function categoryStats(snapshot: AppSnapshot) {
  const mealById = new Map(snapshot.meals.map((meal) => [meal.id, meal]));
  const dateByScanId = new Map(
    snapshot.scans.map((scan) => [
      scan.id,
      mealById.get(scan.mealRecordId)?.servedOn,
    ]),
  );
  const map = new Map<
    FoodCategory,
    { remaining: number; original: number; count: number; dates: Set<string> }
  >();
  snapshot.detections.forEach((detection) => {
    const final = getFinalDetection(snapshot, detection.id);
    if (!final) return;
    const current = map.get(final.finalCategory) ?? {
      remaining: 0,
      original: 0,
      count: 0,
      dates: new Set<string>(),
    };
    current.remaining += final.finalRemainingG;
    current.original += final.finalOriginalG;
    current.count += 1;
    const servedOn = dateByScanId.get(detection.scanId);
    if (servedOn) current.dates.add(servedOn);
    map.set(final.finalCategory, current);
  });
  return [...map]
    .map(([category, value]) => ({
      category,
      name: CATEGORY_LABELS[category],
      rate: value.original ? percent(value.remaining / value.original) : 0,
      count: value.count,
      dateCount: value.dates.size,
      remainingG: value.remaining,
      originalG: value.original,
    }))
    .sort((a, b) => b.rate - a.rate);
}

/**
 * 餐盤樣本中，各類食物占「最終確認後估計剩餘克數」的組成。
 * 這和類別本身的剩餘率不同，首頁分開呈現，避免把兩個分母混為一談。
 */
export function categoryRemainingShares(snapshot: AppSnapshot) {
  const categories = categoryStats(snapshot);
  const totalRemainingG = categories.reduce(
    (total, item) => total + item.remainingG,
    0,
  );
  return categories
    .map((item) => ({
      ...item,
      share: totalRemainingG ? percent(item.remainingG / totalRemainingG) : 0,
      totalRemainingG,
    }))
    .sort((left, right) => right.share - left.share);
}

export function menuStats(snapshot: AppSnapshot) {
  const map = new Map<string, MealRecord[]>();
  snapshot.meals.forEach((meal) => {
    const key = `${meal.staple}・${meal.mainDish}`;
    map.set(key, [...(map.get(key) ?? []), meal]);
  });
  return [...map]
    .map(([name, meals]) => ({
      name,
      rate: percent(weightedLeftoverRate(meals)),
      count: meals.length,
      dateCount: distinctCalendarDates(meals.map((meal) => meal.servedOn))
        .length,
    }))
    .sort((a, b) => b.rate - a.rate);
}

export function classStats(snapshot: AppSnapshot) {
  return snapshot.classes
    .map((schoolClass) => {
      const meals = snapshot.meals.filter(
        (meal) => meal.classId === schoolClass.id,
      );
      return {
        name: schoolClass.name,
        rate: percent(weightedLeftoverRate(meals)),
        count: meals.length,
        dateCount: distinctCalendarDates(meals.map((meal) => meal.servedOn))
          .length,
      };
    })
    .sort((a, b) => b.rate - a.rate);
}

export function weekdayStats(snapshot: AppSnapshot) {
  const labels = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const map = new Map<number, MealRecord[]>();
  snapshot.meals.forEach((meal) => {
    const day = calendarWeekday(meal.servedOn);
    map.set(day, [...(map.get(day) ?? []), meal]);
  });
  return [...map]
    .map(([day, meals]) => ({
      day,
      name: labels[day],
      rate: percent(weightedLeftoverRate(meals)),
      count: meals.length,
      dateCount: distinctCalendarDates(meals.map((meal) => meal.servedOn))
        .length,
    }))
    .sort((a, b) => a.day - b.day);
}

export function heatmapData(snapshot: AppSnapshot) {
  const weekdays = [1, 2, 3, 4, 5];
  const categories = Object.keys(CATEGORY_LABELS) as FoodCategory[];
  return categories.map((category) => ({
    category,
    name: CATEGORY_LABELS[category],
    values: weekdays.map((day) => {
      const scanIds = new Set(
        snapshot.scans
          .filter((scan) => {
            const meal = snapshot.meals.find(
              (item) => item.id === scan.mealRecordId,
            );
            return meal && calendarWeekday(meal.servedOn) === day;
          })
          .map((scan) => scan.id),
      );
      const rows = snapshot.detections
        .map((detection) => getFinalDetection(snapshot, detection.id))
        .filter(
          (item) =>
            item && item.finalCategory === category && scanIds.has(item.scanId),
        );
      const original = rows.reduce(
        (sum, item) => sum + (item?.finalOriginalG ?? 0),
        0,
      );
      const remaining = rows.reduce(
        (sum, item) => sum + (item?.finalRemainingG ?? 0),
        0,
      );
      return {
        day,
        rate: original ? percent(remaining / original) : null,
        count: rows.length,
      };
    }),
  }));
}

export function generateInsights(snapshot: AppSnapshot): Insight[] {
  const insights: Insight[] = [];
  const weekdays = weekdayStats(snapshot);
  const wed = weekdays.find((item) => item.day === 3);
  const fri = weekdays.find((item) => item.day === 5);
  if (
    wed &&
    fri &&
    wed.dateCount >= 3 &&
    fri.dateCount >= 3 &&
    Math.abs(fri.rate - wed.rate) >= 5
  ) {
    insights.push({
      id: "weekday",
      title: `星期五剩食率比星期三${fri.rate > wed.rate ? "高" : "低"} ${Math.abs(fri.rate - wed.rate).toFixed(1)} 個百分點`,
      description: "這是資料中的關聯，可能仍受菜色與出席人數影響。",
      evidence: `星期三 ${wed.dateCount} 個供餐日／${wed.count} 筆班級餐期；星期五 ${fri.dateCount} 個供餐日／${fri.count} 筆班級餐期`,
      tone: "amber",
    });
  }
  const categories = categoryStats(snapshot);
  const eligibleCategories = categories.filter(
    (item) => item.count >= 5 && item.dateCount >= 3,
  );
  const top = eligibleCategories[0];
  const runnerUp = eligibleCategories[1];
  if (top && runnerUp && top.rate - runnerUp.rate >= 5)
    insights.push({
      id: "category",
      title: `${top.name}類加權影像估計比例最高`,
      description: `在餐盤影像估計中，${top.name}的加權剩餘比例為 ${top.rate.toFixed(1)}%。這不是整班${top.name}剩食秤重，下一步需用人工標註樣本驗證。`,
      evidence: `涵蓋 ${top.dateCount} 個供餐日、${top.count} 個辨識項目`,
      tone: "green",
    });
  const overall = percent(weightedLeftoverRate(snapshot.meals));
  const curryMeals = snapshot.meals.filter((meal) =>
    `${meal.staple} ${meal.mainDish}`.includes("咖哩"),
  );
  const curryDates = distinctCalendarDates(
    curryMeals.map((meal) => meal.servedOn),
  );
  if (curryDates.length >= 3) {
    const curryRate = percent(weightedLeftoverRate(curryMeals));
    if (overall - curryRate >= 5)
      insights.push({
        id: "curry",
        title: `咖哩菜單低於整體 ${Math.abs(overall - curryRate).toFixed(1)} 個百分點`,
        description: "可再觀察味道、拌飯方式與熟悉度是否與接受度相關。",
        evidence: `咖哩 ${curryDates.length} 個供餐日／${curryMeals.length} 筆班級餐期；整體 ${distinctCalendarDates(snapshot.meals.map((meal) => meal.servedOn)).length} 個供餐日`,
        tone: "blue",
      });
  }
  return insights.length
    ? insights
    : [
        {
          id: "more-data",
          title: "需要更多資料",
          description: "尚未達到最少樣本數或 5 個百分點差異門檻。",
          evidence: "FoodLens 不會為了有結論而硬產生洞察",
          tone: "blue",
        },
      ];
}

export const MIN_EXPERIMENT_MEALS_PER_PERIOD = 3;
export const MIN_EXPERIMENT_DATES_PER_PERIOD = 2;

export function selectExperimentMeals(
  snapshot: Pick<AppSnapshot, "meals">,
  experiment: ImprovementExperiment,
) {
  const matchesClass = (meal: MealRecord) =>
    !experiment.classId || meal.classId === experiment.classId;
  return {
    baseline: snapshot.meals.filter(
      (meal) =>
        matchesClass(meal) &&
        meal.servedOn >= experiment.baselineStart &&
        meal.servedOn <= experiment.baselineEnd,
    ),
    after: snapshot.meals.filter(
      (meal) =>
        matchesClass(meal) &&
        meal.servedOn >= experiment.interventionStart &&
        meal.servedOn <= experiment.interventionEnd,
    ),
  };
}

export function validateExperiment(
  snapshot: AppSnapshot,
  experiment: ImprovementExperiment,
) {
  const issues: string[] = [];
  try {
    [
      experiment.baselineStart,
      experiment.baselineEnd,
      experiment.interventionStart,
      experiment.interventionEnd,
    ].forEach(epochDay);
  } catch {
    issues.push("比較期間包含無效日期");
  }
  if (experiment.baselineStart > experiment.baselineEnd)
    issues.push("基準期開始日不可晚於結束日");
  if (experiment.interventionStart > experiment.interventionEnd)
    issues.push("改善期開始日不可晚於結束日");
  if (experiment.baselineEnd >= experiment.interventionStart)
    issues.push("改善期必須在基準期結束後開始，兩段期間不可重疊");

  const { baseline, after } = selectExperimentMeals(snapshot, experiment);
  const beforeDateCount = distinctCalendarDates(
    baseline.map((meal) => meal.servedOn),
  ).length;
  const afterDateCount = distinctCalendarDates(
    after.map((meal) => meal.servedOn),
  ).length;
  if (baseline.length < MIN_EXPERIMENT_MEALS_PER_PERIOD)
    issues.push(`基準期至少需要 ${MIN_EXPERIMENT_MEALS_PER_PERIOD} 筆班級餐期`);
  if (after.length < MIN_EXPERIMENT_MEALS_PER_PERIOD)
    issues.push(`改善期至少需要 ${MIN_EXPERIMENT_MEALS_PER_PERIOD} 筆班級餐期`);
  if (beforeDateCount < MIN_EXPERIMENT_DATES_PER_PERIOD)
    issues.push(
      `基準期至少需要 ${MIN_EXPERIMENT_DATES_PER_PERIOD} 個獨立供餐日`,
    );
  if (afterDateCount < MIN_EXPERIMENT_DATES_PER_PERIOD)
    issues.push(
      `改善期至少需要 ${MIN_EXPERIMENT_DATES_PER_PERIOD} 個獨立供餐日`,
    );
  return {
    isValid: issues.length === 0,
    issues,
    beforeSamples: baseline.length,
    afterSamples: after.length,
    beforeDateCount,
    afterDateCount,
  };
}

export function experimentResult(
  snapshot: AppSnapshot,
  experiment = snapshot.experiments[0],
) {
  if (!experiment) return undefined;
  const { baseline, after } = selectExperimentMeals(snapshot, experiment);
  const validation = validateExperiment(snapshot, experiment);
  const beforeRate = weightedLeftoverRate(baseline);
  const afterRate = weightedLeftoverRate(after);
  const drop = beforeRate - afterRate;
  return {
    experiment,
    beforeRate,
    afterRate,
    pointDrop: drop,
    relativeImprovement: beforeRate > 0 ? drop / beforeRate : 0,
    beforeSamples: baseline.length,
    afterSamples: after.length,
    beforeDateCount: validation.beforeDateCount,
    afterDateCount: validation.afterDateCount,
    isValid: validation.isValid,
    issues: validation.issues,
  };
}
