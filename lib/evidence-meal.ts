import {
  caseToWasteObservation,
  mealEvidenceCaseSchema,
  type MealEvidenceCase,
} from "@/lib/evidence-chain";
import { getActualMenuDishes } from "@/lib/menu-intelligence";
import { calculateWasteMetrics } from "@/lib/waste-intelligence";
import type { MealRecord, MeasurementMethod } from "@/lib/types";

function fnv1a(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundedText(value: string, maximumCharacters = 80) {
  const characters = Array.from(value.trim());
  if (characters.length <= maximumCharacters) return characters.join("");
  return `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

/** Stable only inside demo-local. Cloud mode replaces this with a school-scoped UUID. */
export function localEvidenceMealRecordId(caseId: string) {
  return `evidence-meal-${fnv1a(caseId)}`;
}

export function evidenceCaseToMealRecord(
  rawCase: MealEvidenceCase,
  requestedMealRecordId?: string,
): MealRecord {
  const evidenceCase = mealEvidenceCaseSchema.parse(rawCase);
  const dishes = getActualMenuDishes(evidenceCase.menuVersion);
  const stapleDish =
    dishes.find((dish) => dish.role === "staple") ??
    dishes.find(
      (dish) => dish.category === "rice" || dish.category === "noodles",
    );
  const mainDish =
    dishes.find((dish) => dish.role === "main") ??
    dishes.find((dish) => dish.category === "meat" || dish.category === "egg");
  const used = new Set([stapleDish?.signature, mainDish?.signature]);
  const sideDishes = dishes
    .filter((dish) => !used.has(dish.signature))
    .map((dish) => boundedText(dish.normalizedName))
    .slice(0, 20);
  const metrics = calculateWasteMetrics({
    observations: [caseToWasteObservation(evidenceCase)],
  });
  const relevantMeasurements = evidenceCase.measurements.filter(
    (item) =>
      item.source === "unserved-edible" || item.source === "plate-edible",
  );
  const fullPlateCoverage =
    evidenceCase.observedDiners >= evidenceCase.actualDiners;
  const measurementMethod: MeasurementMethod =
    fullPlateCoverage &&
    relevantMeasurements.every((item) => item.method === "scale")
      ? "scale"
      : "sample-extrapolation";
  const leftoverG = Math.min(
    evidenceCase.suppliedEdibleG,
    metrics.measuredUnservedEdibleG + metrics.estimatedPlateEdibleG,
  );
  const coveragePercent = Math.round(metrics.coverageRate * 100);
  return {
    id:
      requestedMealRecordId ??
      evidenceCase.mealRecordId ??
      localEvidenceMealRecordId(evidenceCase.id),
    classId: evidenceCase.classId,
    servedOn: evidenceCase.servedOn,
    mealPeriod: "lunch",
    staple: boundedText(stapleDish?.normalizedName ?? "未標示主食"),
    mainDish: boundedText(mainDish?.normalizedName ?? "未標示主菜"),
    sideDishes,
    menuSignature: evidenceCase.menuVersion.signature,
    plannedPeople: evidenceCase.plannedDiners,
    actualPeople: evidenceCase.actualDiners,
    totalSupplyG: evidenceCase.suppliedEdibleG,
    leftoverG,
    measurementMethod,
    notes:
      `由一餐證據鏈 ${evidenceCase.id} 同步；可避免剩食為未供出可食重量＋盤後樣本外推，` +
      `餐盤覆蓋率 ${coveragePercent}%，不是把混合廚餘或單張 AI 估重當成全班秤重。`,
    source: evidenceCase.sourceKind === "demo" ? "demo" : "manual",
    createdAt: evidenceCase.createdAt,
    updatedAt: evidenceCase.updatedAt,
  };
}

export function linkEvidenceCaseToMealRecord(
  rawCase: MealEvidenceCase,
  mealRecordId: string,
) {
  return mealEvidenceCaseSchema.parse({
    ...rawCase,
    mealRecordId,
  });
}
