import type { MealEvidenceCase } from "@/lib/evidence-chain";
import type { CollectionEvent, DestinationReceipt } from "@/lib/circularity";
import type { MealSafetyObservation } from "@/lib/meal-safety";

export const FOOD_CATEGORIES = [
  "rice",
  "noodles",
  "meat",
  "vegetable",
  "egg",
  "fruit",
  "other",
] as const;

export type FoodCategory = (typeof FOOD_CATEGORIES)[number];
export type DataMode = "demo-local" | "school-cloud";
export type MeasurementMethod =
  "scale" | "manual" | "sample-extrapolation" | "ai-estimate";
export type MealPeriod = "lunch";
export type ConfidenceLevel = "high" | "medium" | "low";

export const PLATE_SCAN_ANALYSIS_KINDS = [
  "mock-ai",
  "real-ai",
  "human-manual",
  "source-unverified",
] as const;

export type PlateScanAnalysisKind = (typeof PLATE_SCAN_ANALYSIS_KINDS)[number];

export const CATEGORY_LABELS: Record<FoodCategory, string> = {
  rice: "白飯",
  noodles: "麵類",
  meat: "肉類",
  vegetable: "蔬菜",
  egg: "蛋",
  fruit: "水果",
  other: "其他",
};

export interface SchoolClass {
  id: string;
  name: string;
  grade: 5 | 6;
  active: boolean;
}

export interface MealRecord {
  id: string;
  classId: string;
  servedOn: string;
  mealPeriod: MealPeriod;
  staple: string;
  mainDish: string;
  sideDishes: string[];
  menuSignature: string;
  plannedPeople: number;
  actualPeople: number;
  totalSupplyG: number;
  leftoverG: number;
  measurementMethod: MeasurementMethod;
  notes: string;
  source: "demo" | "manual" | "import";
  createdAt: string;
  updatedAt: string;
}

export interface PlateScan {
  id: string;
  mealRecordId: string;
  imageUrl?: string;
  imageBlob?: Blob;
  imagePath?: string;
  imageLoadError?: string;
  contentSha256?: string;
  /** Persisted source identity. UI must never infer this from provider text. */
  analysisKind: PlateScanAnalysisKind;
  /**
   * Workflow-declared menu context. Cloud persistence re-derives its canonical
   * menu identity, but cannot prove what an external model received or used.
   * `null` means no auditable context was saved (including legacy scans).
   */
  menuContext: PlateScanMenuContext | null;
  provider: string;
  model: string;
  schemaVersion: "1";
  status: "confirmed" | "failed";
  reviewedAt: string;
  createdAt: string;
}

export interface PlateScanMenuContext {
  menuVersionId: string;
  menuVersionSignature: string;
  candidateCount: number;
}

export function validatedPlateScanMenuContext(
  value: PlateScanMenuContext | null | undefined,
): PlateScanMenuContext | null {
  if (!value) return null;
  const idLength = Array.from(value.menuVersionId).length;
  const signatureLength = Array.from(value.menuVersionSignature).length;
  if (
    value.menuVersionId !== value.menuVersionId.trim() ||
    idLength < 1 ||
    idLength > 120 ||
    value.menuVersionSignature !== value.menuVersionSignature.trim() ||
    signatureLength < 1 ||
    signatureLength > 160 ||
    !Number.isInteger(value.candidateCount) ||
    value.candidateCount < 1 ||
    value.candidateCount > 30
  )
    throw new Error("菜單候選稽核資料不完整，請重新分析");
  return { ...value };
}

export interface ScanDetection {
  id: string;
  scanId: string;
  category: FoodCategory;
  label: string;
  aiOriginalG: number;
  aiRemainingRatio: number;
  aiRemainingG: number;
  confidence: number;
  sortOrder: number;
}

export interface ScanCorrection {
  id: string;
  detectionId: string;
  correctedCategory: FoodCategory;
  correctedLabel: string;
  correctedOriginalG: number;
  correctedRemainingRatio: number;
  correctedRemainingG: number;
  note: string;
  correctedAt: string;
}

export interface AiDetectionInput {
  category: FoodCategory;
  label: string;
  originalG: number;
  remainingRatio: number;
  remainingG: number;
  confidence: number;
}

export interface AiAnalysisV1 {
  schemaVersion: "1";
  provider: string;
  model: string;
  isMock: boolean;
  detections: AiDetectionInput[];
  warnings: string[];
  analyzedAt: string;
}

export type ConfirmedPlateScanAnalysisKind = Exclude<
  PlateScanAnalysisKind,
  "source-unverified"
>;

/**
 * Derive source identity from the structured analysis contract. Provider text
 * is retained only as audit detail and cannot, by itself, turn Mock into real AI.
 */
export function derivePlateScanAnalysisKind(
  analysis: Pick<AiAnalysisV1, "provider" | "isMock">,
): ConfirmedPlateScanAnalysisKind {
  const provider = analysis.provider.trim().toLowerCase();
  if (provider === "human-manual") {
    if (analysis.isMock) throw new Error("人工判讀來源不可同時標示為 Mock AI");
    return "human-manual";
  }
  if (provider === "foodlens-mock" && !analysis.isMock)
    throw new Error("FoodLens 示範 provider 必須標示為 Mock AI");
  return analysis.isMock ? "mock-ai" : "real-ai";
}

/** Old scans did not persist isMock, so only reserved, deterministic sources
 * can be upgraded. Every other provider remains explicitly unverified. */
export function legacyPlateScanAnalysisKind(
  provider: unknown,
): PlateScanAnalysisKind {
  if (typeof provider !== "string") return "source-unverified";
  const normalized = provider.trim().toLowerCase();
  if (normalized === "human-manual") return "human-manual";
  if (normalized === "foodlens-mock") return "mock-ai";
  return "source-unverified";
}

export function persistedPlateScanAnalysisKind(
  value: unknown,
): PlateScanAnalysisKind {
  return typeof value === "string" &&
    (PLATE_SCAN_ANALYSIS_KINDS as readonly string[]).includes(value)
    ? (value as PlateScanAnalysisKind)
    : "source-unverified";
}

export interface ConfirmScanCommand {
  clientRequestId: string;
  meal: Omit<MealRecord, "id" | "createdAt" | "updatedAt" | "menuSignature"> & {
    id?: string;
  };
  imageBlob?: Blob;
  imageUrl?: string;
  analysis: AiAnalysisV1;
  /** Captured when analysis starts; omitted/null means no menu candidates. */
  menuContext?: PlateScanMenuContext | null;
  corrections: AiDetectionInput[];
  correctionNotes?: string[];
}

export interface SupplyPrediction {
  id: string;
  createdAt: string;
  plannedPeople: number;
  menuName: string;
  plannedSupplyG: number;
  recommendedSupplyG: number;
  averageLeftoverRate: number;
  possibleSavingG: number;
  possibleSavingTwd: number;
  confidence: ConfidenceLevel;
  matchLevel: "exact" | "similar" | "baseline" | "insufficient";
  /** Number of class-level meal rows used in the weighted calculation. */
  sampleSize: number;
  /** Distinct school serving dates; repeated classes never inflate confidence. */
  independentDateCount: number;
  /** Exact audit rows selected by the prediction engine, in display order. */
  evidenceMealIds: string[];
  historyStart?: string;
  historyEnd?: string;
  reason: string;
  algorithmVersion: "foodlens-v1";
}

export type PredictionAdoptionMode =
  "pending" | "recommended" | "adjusted" | "original";

/**
 * 建立改善實驗時保存的決策快照。
 *
 * 即使原供餐建議日後不在目前資料集，實驗仍能說明當時看到的原計畫、
 * 建議量與人類最後採用方式；FoodLens 不會把「AI 建議」誤寫成「實際執行」。
 */
export interface PredictionDecisionTrace {
  predictionId: string;
  predictionCreatedAt: string;
  menuName: string;
  plannedPeople: number;
  plannedSupplyG: number;
  recommendedSupplyG: number;
  adoptionMode: PredictionAdoptionMode;
  adoptedSupplyG?: number;
  adoptionNote: string;
  recordedAt: string;
}

export type DietitianReviewStatus = "pending" | "confirmed" | "concern";

/**
 * 改善實驗的供餐安全檢查。
 *
 * 數值使用 null 表示「未量測」，避免把未知狀態誤寫成零事件；這些欄位和
 * 剩食率並列保存，提醒使用者減少廚餘不能以吃不飽或營養風險為代價。
 */
export interface ExperimentSafetyGuardrails {
  shortageReportCount: number | null;
  refillRequestCount: number | null;
  satisfactionScore: number | null;
  satisfactionResponseCount: number;
  dietitianReview: DietitianReviewStatus;
  dietitianNote: string;
  confounders: string[];
  checkedAt: string;
}

export interface ImprovementExperiment {
  id: string;
  title: string;
  baselineStart: string;
  baselineEnd: string;
  interventionStart: string;
  interventionEnd: string;
  classId?: string;
  interventionDescription: string;
  linkedPredictionId?: string;
  decisionTrace?: PredictionDecisionTrace;
  safetyGuardrails?: ExperimentSafetyGuardrails;
  createdAt: string;
}

export interface ResearchSection {
  id: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
}

export interface ImpactSettings {
  id: "default";
  costTwdPerKg: number;
  schoolDailyBaselineG: number;
  schoolDaysPerWeek: number;
  weeksPerSemester: number;
  semestersPerYear: number;
  co2eFactor?: number;
  sourceTitle?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  disclaimer: string;
  updatedAt: string;
}

export interface ProjectProfile {
  id: "default";
  projectName: string;
  subtitle: string;
  schoolName: string;
  teamName: string;
  teamMembers: string;
  researchPeriod: string;
  aiDisclosure: string;
  /** Contact point for privacy and data-governance questions. */
  privacyContact?: string;
  /** Local data retention window, in days. */
  dataRetentionDays?: number;
  /** ISO timestamp for the most recent governance review. */
  governanceReviewedAt?: string;
  updatedAt: string;
}

export type DataRetentionRunStatus = "prepared" | "completed" | "failed";

/**
 * Dry-run result for the raw plate-evidence retention policy. Aggregated,
 * class-level meal measurements are deliberately preserved for research.
 */
export interface DataRetentionPreview {
  cutoffDate: string;
  retentionDays: number;
  eligibleScanCount: number;
  eligibleImageCount: number;
  affectedMealCount: number;
  preservedMealCount: number;
  oldestEligibleDate?: string;
  newestEligibleDate?: string;
  generatedAt: string;
  batchLimit: number;
}

/** Audit summary only: no image path, meal ID, menu, or raw detection data. */
export interface DataRetentionRun {
  id: string;
  cutoffDate: string;
  retentionDays: number;
  status: DataRetentionRunStatus;
  candidateScanCount: number;
  candidateImageCount: number;
  affectedMealCount: number;
  deletedScanCount: number;
  deletedImageCount: number;
  startedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface AppSnapshot {
  classes: SchoolClass[];
  meals: MealRecord[];
  scans: PlateScan[];
  detections: ScanDetection[];
  corrections: ScanCorrection[];
  predictions: SupplyPrediction[];
  experiments: ImprovementExperiment[];
  /** Append-only, per-meal observations; never reconstructed from legacy averages. */
  mealSafetyObservations: MealSafetyObservation[];
  evidenceCases: MealEvidenceCase[];
  collectionEvents: CollectionEvent[];
  destinationReceipts: DestinationReceipt[];
  researchSections: ResearchSection[];
  impactSettings: ImpactSettings;
  profile: ProjectProfile;
}

export interface DashboardSnapshot {
  latestMealDate?: string;
  latestDayLeftoverG: number;
  weekLeftoverG: number;
  monthLeftoverG: number;
  improvementRate: number;
  absolutePointDrop: number;
  analyzedPlates: number;
  estimatedSavedCostTwd: number;
  estimatedAvoidedWasteG: number;
}

export interface Insight {
  id: string;
  title: string;
  description: string;
  evidence: string;
  tone: "green" | "amber" | "blue";
}

export interface AppFilters {
  classId: "all" | string;
  range: "8-weeks" | "month" | "all";
}

export interface FoodLensRepository {
  getSnapshot(): Promise<AppSnapshot>;
  confirmScan(
    command: ConfirmScanCommand,
  ): Promise<{ mealId: string; scanId: string }>;
  savePrediction(prediction: SupplyPrediction): Promise<void>;
  saveExperiment(experiment: ImprovementExperiment): Promise<void>;
  saveMealSafetyObservation(observation: MealSafetyObservation): Promise<void>;
  saveEvidenceCase(
    evidenceCase: MealEvidenceCase,
  ): Promise<{ mealRecordId: string }>;
  saveCollectionEvent(event: CollectionEvent): Promise<void>;
  saveDestinationReceipt(receipt: DestinationReceipt): Promise<void>;
  updateSettings(settings: ImpactSettings): Promise<void>;
  updateProfile(profile: ProjectProfile): Promise<void>;
  upsertClass(schoolClass: SchoolClass): Promise<void>;
  updateResearchSection(section: ResearchSection): Promise<void>;
  importMealRecords(records: MealRecord[]): Promise<number>;
  initializeSchoolWorkspace?(template: AppSnapshot): Promise<void>;
  replaceSnapshot(snapshot: AppSnapshot): Promise<void>;
  resetDemo(): Promise<void>;
  restoreRecovery?(): Promise<boolean>;
  getRecoveryMetadata?(): Promise<{
    savedAt?: string;
    mealCount: number;
    scanCount: number;
  } | null>;
  previewDataRetention(retentionDays: number): Promise<DataRetentionPreview>;
  executeDataRetention(retentionDays: number): Promise<DataRetentionRun>;
  listDataRetentionRuns(): Promise<DataRetentionRun[]>;
}
