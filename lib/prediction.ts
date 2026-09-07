import { weightedLeftoverRate } from "@/lib/analysis";
import { addCalendarDays, distinctCalendarDates } from "@/lib/date";
import type {
  AppSnapshot,
  ConfidenceLevel,
  MealRecord,
  SupplyPrediction,
} from "@/lib/types";

export interface PredictionInput {
  plannedPeople: number;
  menuName: string;
  plannedSupplyG: number;
}

export const JUDGE_DEMO_PREDICTION_INPUT: PredictionInput = {
  plannedPeople: 100,
  menuName: "咖哩飯｜雞肉咖哩",
  plannedSupplyG: 25_000,
};

export interface PredictionEvidence {
  meals: MealRecord[];
  matchLevel: SupplyPrediction["matchLevel"];
  independentDateCount: number;
  reductionCap: number;
}

export interface HistoricalSupplyBaseline {
  historicalPerPersonG: number;
  plannedSupplyG: number;
}

export type PredictionStabilityLevel =
  "stable" | "mixed" | "volatile" | "insufficient";

export interface DailyLeftoverRate {
  date: string;
  /** Weighted class-level leftover rate for one serving date, from 0 to 1. */
  rate: number;
  mealCount: number;
}

export interface PredictionStability {
  level: PredictionStabilityLevel;
  dailyRates: DailyLeftoverRate[];
  independentDateCount: number;
  minRate: number;
  q1Rate: number;
  q3Rate: number;
  maxRate: number;
  iqrRate: number;
  rangeRate: number;
}

export interface PredictionConfidenceAssessment {
  baseConfidence: ConfidenceLevel;
  confidence: ConfidenceLevel;
  downgraded: boolean;
  downgradeReason?: string;
}

const STABLE_IQR_MAX = 0.05;
const STABLE_RANGE_MAX = 0.1;
const MIXED_IQR_MAX = 0.1;
const MIXED_RANGE_MAX = 0.2;

/**
 * Repository implementations do not promise the same row order: IndexedDB
 * prepends newly saved decisions while PostgREST returns the configured query
 * order. Keep "latest decision" behavior deterministic at the product layer.
 */
export function sortPredictionsNewestFirst(
  predictions: SupplyPrediction[],
): SupplyPrediction[] {
  return [...predictions].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function quantile(sortedValues: number[], percentile: number) {
  if (!sortedValues.length) return 0;
  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  return lower + (upper - lower) * (position - lowerIndex);
}

/**
 * Compares like with like: classes from the same serving date are first
 * combined with supply-weighting, then the independent dates are compared.
 * This prevents a four-class day from looking like four independent trials.
 */
export function assessPredictionStability(
  meals: MealRecord[],
): PredictionStability {
  const byDate = new Map<string, MealRecord[]>();
  meals.forEach((meal) =>
    byDate.set(meal.servedOn, [...(byDate.get(meal.servedOn) ?? []), meal]),
  );
  const dailyRates = [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .filter(([, rows]) => rows.some((meal) => meal.totalSupplyG > 0))
    .map(([date, rows]) => ({
      date,
      rate: weightedLeftoverRate(rows),
      mealCount: rows.length,
    }));
  const sortedRates = dailyRates
    .map((item) => item.rate)
    .sort((left, right) => left - right);
  const minRate = sortedRates[0] ?? 0;
  const maxRate = sortedRates.at(-1) ?? 0;
  const q1Rate = quantile(sortedRates, 0.25);
  const q3Rate = quantile(sortedRates, 0.75);
  const iqrRate = Math.max(0, q3Rate - q1Rate);
  const rangeRate = Math.max(0, maxRate - minRate);
  const level: PredictionStabilityLevel =
    dailyRates.length < 3
      ? "insufficient"
      : iqrRate <= STABLE_IQR_MAX && rangeRate <= STABLE_RANGE_MAX
        ? "stable"
        : iqrRate <= MIXED_IQR_MAX && rangeRate <= MIXED_RANGE_MAX
          ? "mixed"
          : "volatile";

  return {
    level,
    dailyRates,
    independentDateCount: dailyRates.length,
    minRate,
    q1Rate,
    q3Rate,
    maxRate,
    iqrRate,
    rangeRate,
  };
}

export function assessPredictionConfidence(
  matchLevel: SupplyPrediction["matchLevel"],
  independentDateCount: number,
  stability: PredictionStability,
): PredictionConfidenceAssessment {
  const baseConfidence: ConfidenceLevel =
    matchLevel === "exact" && independentDateCount >= 6
      ? "high"
      : matchLevel === "exact" && independentDateCount >= 3
        ? "medium"
        : "low";
  const confidence: ConfidenceLevel =
    stability.level === "volatile"
      ? "low"
      : stability.level === "mixed" && baseConfidence === "high"
        ? "medium"
        : baseConfidence;
  const downgraded = confidence !== baseConfidence;
  const downgradeReason = downgraded
    ? stability.level === "volatile"
      ? `各供餐日剩食率波動大（全距 ${(stability.rangeRate * 100).toFixed(1)} 個百分點、IQR ${(stability.iqrRate * 100).toFixed(1)} 個百分點），因此信心由${baseConfidence === "high" ? "高" : "中"}降為低。`
      : `各供餐日剩食率有波動（全距 ${(stability.rangeRate * 100).toFixed(1)} 個百分點、IQR ${(stability.iqrRate * 100).toFixed(1)} 個百分點），因此信心由高降為中。`
    : undefined;

  return { baseConfidence, confidence, downgraded, downgradeReason };
}

export function describePredictionStability(stability: PredictionStability) {
  if (stability.level === "insufficient")
    return `只有 ${stability.independentDateCount} 個可比較供餐日，尚不足以判斷波動。`;
  const levelLabel = {
    stable: "穩定",
    mixed: "有波動",
    volatile: "波動大",
  }[stability.level];
  return `${levelLabel}：逐日加權剩食率 ${(stability.minRate * 100).toFixed(1)}%–${(stability.maxRate * 100).toFixed(1)}%，IQR ${(stability.iqrRate * 100).toFixed(1)} 個百分點。判定門檻：IQR 不超過 5 且全距不超過 10 個百分點才列為穩定；IQR 超過 10 或全距超過 20 個百分點即列為波動大。`;
}

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("zh-TW")
    .replace(/[・\s|｜、,]/g, "");
}

function byEvidenceOrder(left: MealRecord, right: MealRecord) {
  return (
    right.servedOn.localeCompare(left.servedOn) ||
    left.classId.localeCompare(right.classId) ||
    left.id.localeCompare(right.id)
  );
}

function selectLatestServingDates(rows: MealRecord[], limit = 8) {
  const dates = distinctCalendarDates(rows.map((meal) => meal.servedOn))
    .reverse()
    .slice(0, limit);
  const selected = new Set(dates);
  return rows
    .filter((meal) => selected.has(meal.servedOn))
    .sort(byEvidenceOrder);
}

export function selectPredictionEvidence(
  snapshot: AppSnapshot,
  input: PredictionInput,
): PredictionEvidence {
  const normalized = normalize(input.menuName);
  const reference = [...snapshot.meals].sort((left, right) =>
    right.servedOn.localeCompare(left.servedOn),
  )[0]?.servedOn;
  if (!reference)
    return {
      meals: [],
      matchLevel: "insufficient",
      independentDateCount: 0,
      reductionCap: 0,
    };

  const cutoff = addCalendarDays(reference, -179);
  const recent = snapshot.meals.filter((meal) => meal.servedOn >= cutoff);
  const exact = recent.filter((meal) => {
    const stapleAndMain = normalize(`${meal.staple}${meal.mainDish}`);
    const mainDish = normalize(meal.mainDish);
    return (
      normalized.length >= 2 &&
      (stapleAndMain === normalized ||
        (mainDish.length >= 2 && normalized === mainDish))
    );
  });
  const tokens = input.menuName
    .split(/[・\s|｜、,]+/)
    .map(normalize)
    .filter((item) => item.length >= 2);
  const similar = recent.filter((meal) => {
    const menu = normalize(
      `${meal.staple}${meal.mainDish}${meal.sideDishes.join("")}`,
    );
    return tokens.some((token) => menu.includes(token));
  });

  const candidates: Array<{
    rows: MealRecord[];
    level: PredictionEvidence["matchLevel"];
    cap: number;
  }> = [
    { rows: exact, level: "exact", cap: 0.15 },
    { rows: similar, level: "similar", cap: 0.08 },
  ];
  for (const candidate of candidates) {
    const independentDateCount = distinctCalendarDates(
      candidate.rows.map((meal) => meal.servedOn),
    ).length;
    if (independentDateCount >= 3) {
      const meals = selectLatestServingDates(candidate.rows);
      return {
        meals,
        matchLevel: candidate.level,
        independentDateCount: distinctCalendarDates(
          meals.map((meal) => meal.servedOn),
        ).length,
        reductionCap: candidate.cap,
      };
    }
  }

  const meals = selectLatestServingDates(recent);
  return {
    meals,
    matchLevel: meals.length ? "baseline" : "insufficient",
    independentDateCount: distinctCalendarDates(
      meals.map((meal) => meal.servedOn),
    ).length,
    reductionCap: meals.length ? 0.05 : 0,
  };
}

export function getPredictionEvidence(
  snapshot: AppSnapshot,
  prediction: SupplyPrediction,
) {
  const ids = new Set(prediction.evidenceMealIds);
  return snapshot.meals
    .filter((meal) => ids.has(meal.id))
    .sort(byEvidenceOrder);
}

export function isActionablePrediction(prediction: SupplyPrediction) {
  return (
    prediction.matchLevel !== "insufficient" &&
    prediction.plannedSupplyG > 0 &&
    prediction.recommendedSupplyG > 0
  );
}

/**
 * Builds the automatic starting quantity from the same evidence set used for a
 * prediction. Keeping this calculation shared prevents the editable UI from
 * showing a different baseline than the saved decision record.
 */
export function getHistoricalSupplyBaseline(
  snapshot: AppSnapshot,
  input: PredictionInput,
  evidence = selectPredictionEvidence(snapshot, input),
): HistoricalSupplyBaseline {
  const historicalPerPersonG = median(
    evidence.meals.map(
      (meal) => meal.totalSupplyG / Math.max(1, meal.actualPeople),
    ),
  );

  return {
    historicalPerPersonG,
    plannedSupplyG: Math.max(
      0,
      Math.round(historicalPerPersonG * Math.max(0, input.plannedPeople)),
    ),
  };
}

export function createPrediction(
  snapshot: AppSnapshot,
  input: PredictionInput,
): SupplyPrediction {
  const evidence = selectPredictionEvidence(snapshot, input);
  const matches = evidence.meals;
  const rate = weightedLeftoverRate(matches);
  const reductionRate = Math.min(evidence.reductionCap, rate * 0.75);
  const automaticBaseline = getHistoricalSupplyBaseline(
    snapshot,
    input,
    evidence,
  );
  const isManualPlan = input.plannedSupplyG > 0;
  const plannedSupplyG = isManualPlan
    ? Math.round(input.plannedSupplyG)
    : automaticBaseline.plannedSupplyG;
  const savingG = Math.round(plannedSupplyG * reductionRate);
  const sampleSize = matches.length;
  const stability = assessPredictionStability(matches);
  const confidenceAssessment = assessPredictionConfidence(
    evidence.matchLevel,
    stability.independentDateCount,
    stability,
  );
  const confidence = confidenceAssessment.confidence;
  const sortedDates = distinctCalendarDates(
    matches.map((meal) => meal.servedOn),
  );
  const evidenceSummary = `${evidence.independentDateCount} 個獨立供餐日、${sampleSize} 筆班級餐期`;
  return {
    id: `prediction-${Date.now()}`,
    createdAt: new Date().toISOString(),
    plannedPeople: input.plannedPeople,
    menuName: input.menuName,
    plannedSupplyG,
    recommendedSupplyG: Math.max(0, plannedSupplyG - savingG),
    averageLeftoverRate: rate,
    possibleSavingG: savingG,
    possibleSavingTwd: Math.round(
      (savingG / 1000) * snapshot.impactSettings.costTwdPerKg,
    ),
    confidence,
    matchLevel: evidence.matchLevel,
    sampleSize,
    independentDateCount: evidence.independentDateCount,
    evidenceMealIds: matches.map((meal) => meal.id),
    historyStart: sortedDates[0],
    historyEnd: sortedDates.at(-1),
    reason: `${
      isManualPlan
        ? `供應基準：採用人工輸入的原計畫 ${Math.round(input.plannedSupplyG)}g。`
        : automaticBaseline.plannedSupplyG > 0
          ? `供應基準：歷史每人供應中位數 ${Math.round(automaticBaseline.historicalPerPersonG)}g × ${input.plannedPeople} 人 = ${automaticBaseline.plannedSupplyG}g。`
          : "供應基準：尚無可用歷史每人供應量。"
    } ${
      evidence.matchLevel === "exact"
        ? `最近 180 天找到 ${evidenceSummary}的相同菜色；只採歷史剩食率的 75% 作為減量，並設定 15% 上限。`
        : evidence.matchLevel === "similar"
          ? `相同菜色的獨立供餐日不足，改用 ${evidenceSummary}的相似主菜或食材紀錄，減量上限縮為 8%。`
          : evidence.matchLevel === "baseline"
            ? `相似菜色未滿 3 個獨立供餐日，暫用最近 ${evidenceSummary}的全校基準，減量上限縮為 5%。`
            : "尚無足夠資料，請先累積餐期紀錄。"
    } ${describePredictionStability(stability)}${
      confidenceAssessment.downgradeReason
        ? ` ${confidenceAssessment.downgradeReason}`
        : ""
    }`,
    algorithmVersion: "foodlens-v1",
  };
}
