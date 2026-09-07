import { DEMO_REFERENCE_DATE } from "@/lib/seed";
import { todayInTaipei } from "@/lib/date";
import {
  foodAnalysisMenuCandidatesSchema,
  type FoodAnalysisMenuCandidate,
} from "@/lib/ai";
import type { MealEvidenceCase } from "@/lib/evidence-chain";
import {
  getPlateCandidates,
  type MenuImportSource,
} from "@/lib/menu-intelligence";
import type {
  DataMode,
  MealRecord,
  PlateScanMenuContext,
  SchoolClass,
} from "@/lib/types";

export type ScanNumberField = number | "";

export interface ScanFormState {
  date: string;
  classId: string;
  staple: string;
  mainDish: string;
  sides: string;
  people: ScanNumberField;
  supplyKg: ScanNumberField;
  leftoverKg: ScanNumberField;
  notes: string;
}

/**
 * An unlinked scan must record the student's meal ownership decision instead
 * of inferring it from menu text. `null` deliberately means unresolved.
 */
export type ScanMealChoice =
  { kind: "attach"; mealId: string } | { kind: "new" } | null;

export interface ConfirmedPlateMenuContext {
  candidates: FoodAnalysisMenuCandidate[];
  menuVersionId: string;
  menuVersionSignature: string;
  source: MenuImportSource;
  sourceName: string | null;
  reviewedBy: string;
  isMock: boolean;
  substitutionCount: number;
}

export function plateScanMenuContext(
  context: ConfirmedPlateMenuContext | null | undefined,
): PlateScanMenuContext | null {
  if (!context) return null;
  return {
    menuVersionId: context.menuVersionId,
    menuVersionSignature: context.menuVersionSignature,
    candidateCount: context.candidates.length,
  };
}

/**
 * AI hints require an exact, unambiguous meal-record link to one confirmed
 * menu. Matching only on date, class or dish text is deliberately forbidden.
 */
export function resolveConfirmedPlateMenuContext({
  evidenceCases,
  meal,
}: {
  evidenceCases: readonly MealEvidenceCase[];
  meal?: MealRecord;
}): ConfirmedPlateMenuContext | undefined {
  if (!meal) return undefined;
  const linkedCases = evidenceCases.filter(
    (evidenceCase) =>
      evidenceCase.mealRecordId === meal.id &&
      evidenceCase.menuVersion.status === "confirmed" &&
      evidenceCase.menuVersion.signature === meal.menuSignature,
  );
  if (linkedCases.length !== 1) return undefined;
  const evidenceCase = linkedCases[0];
  const confirmation = evidenceCase.menuVersion.confirmation;
  if (!confirmation) return undefined;
  try {
    const candidates = foodAnalysisMenuCandidatesSchema.parse(
      getPlateCandidates(evidenceCase.menuVersion).map((candidate) => ({
        label: candidate.label,
        rawName: candidate.rawName,
        category: candidate.category,
        role: candidate.role,
        basis: candidate.basis,
      })),
    );
    if (candidates.length === 0) return undefined;
    return {
      candidates,
      menuVersionId: evidenceCase.menuVersion.id,
      menuVersionSignature: evidenceCase.menuVersion.signature,
      source: evidenceCase.menuVersion.sourceEvidence.source,
      sourceName: evidenceCase.menuVersion.sourceEvidence.sourceName,
      reviewedBy: confirmation.reviewedBy,
      isMock: evidenceCase.menuVersion.sourceEvidence.isMock,
      substitutionCount: candidates.filter(
        (candidate) => candidate.basis === "substitution",
      ).length,
    };
  } catch {
    // A stale or malformed candidate must never silently influence analysis.
    return undefined;
  }
}

export function findSameDayLunchMeals({
  meals,
  classId,
  servedOn,
}: {
  meals: MealRecord[];
  classId: string;
  servedOn: string;
}) {
  return meals.filter(
    (meal) =>
      meal.classId === classId &&
      meal.servedOn === servedOn &&
      meal.mealPeriod === "lunch",
  );
}

export function resolveScanMealTarget({
  linkedMeal,
  sameDayMeals,
  choice,
}: {
  linkedMeal?: MealRecord;
  sameDayMeals: MealRecord[];
  choice: ScanMealChoice;
}) {
  if (linkedMeal) return linkedMeal;
  if (choice?.kind !== "attach") return undefined;
  return sameDayMeals.find((meal) => meal.id === choice.mealId);
}

export function hasResolvedScanMealChoice({
  linkedMeal,
  sameDayMeals,
  choice,
}: {
  linkedMeal?: MealRecord;
  sameDayMeals: MealRecord[];
  choice: ScanMealChoice;
}) {
  if (linkedMeal) return true;
  if (choice?.kind === "attach")
    return sameDayMeals.some((meal) => meal.id === choice.mealId);
  if (sameDayMeals.length === 0) return true;
  if (choice?.kind === "new") return true;
  return false;
}

export function createScanInitialForm({
  mode,
  activeClasses,
  linkedMeal,
  now,
}: {
  mode: DataMode;
  activeClasses: SchoolClass[];
  linkedMeal?: MealRecord;
  now?: Date;
}): ScanFormState {
  if (linkedMeal) {
    return {
      date: linkedMeal.servedOn,
      classId: linkedMeal.classId,
      staple: linkedMeal.staple,
      mainDish: linkedMeal.mainDish,
      sides: linkedMeal.sideDishes.join("、"),
      people: linkedMeal.actualPeople,
      supplyKg: linkedMeal.totalSupplyG / 1000,
      leftoverKg: linkedMeal.leftoverG / 1000,
      notes: linkedMeal.notes,
    };
  }

  if (mode === "school-cloud") {
    return {
      date: todayInTaipei(now),
      classId: activeClasses[0]?.id ?? "",
      staple: "",
      mainDish: "",
      sides: "",
      people: "",
      supplyKg: "",
      leftoverKg: "",
      notes: "",
    };
  }

  return {
    date: DEMO_REFERENCE_DATE,
    classId: "class-5a",
    staple: "陽春麵",
    mainDish: "滷雞腿",
    sides: "高麗菜、芭樂",
    people: 25,
    supplyKg: 6.6,
    leftoverKg: 1.2,
    notes: "",
  };
}

export function isDemoPlateUrl(value?: string) {
  if (!value) return false;
  try {
    return new URL(value, "https://foodlens.invalid").pathname.startsWith(
      "/demo/",
    );
  } catch {
    return value.split(/[?#]/, 1)[0].startsWith("/demo/");
  }
}

export function canPersistScanImage({
  mode,
  hasUploadedImage,
  selectedImage,
  previewUrl,
}: {
  mode: DataMode;
  hasUploadedImage: boolean;
  selectedImage?: string;
  previewUrl?: string;
}) {
  return (
    mode !== "school-cloud" ||
    (hasUploadedImage &&
      !isDemoPlateUrl(selectedImage) &&
      !isDemoPlateUrl(previewUrl))
  );
}
