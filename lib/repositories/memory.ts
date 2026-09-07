import { createDemoSnapshot, DEMO_REFERENCE_DATE } from "@/lib/seed";
import {
  createDataRetentionPreview,
  scrubExpiredPlateEvidence,
} from "@/lib/data-retention";
import { todayInTaipei } from "@/lib/date";
import { createUuid } from "@/lib/crypto";
import { parseRuntimeSnapshot } from "@/lib/data-portability";
import {
  appendMealSafetyObservation,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import {
  upsertEvidenceCase,
  type MealEvidenceCase,
} from "@/lib/evidence-chain";
import {
  upsertCollectionEvent,
  upsertDestinationReceipt,
  type CollectionEvent,
  type DestinationReceipt,
} from "@/lib/circularity";
import {
  evidenceCaseToMealRecord,
  linkEvidenceCaseToMealRecord,
  localEvidenceMealRecordId,
} from "@/lib/evidence-meal";
import {
  applyConfirmedScan,
  mergeMealRecords,
  scanCommandHash,
} from "@/lib/repositories/local-state";
import type {
  AppSnapshot,
  ConfirmScanCommand,
  DataRetentionRun,
  FoodLensRepository,
  ImpactSettings,
  ImprovementExperiment,
  MealRecord,
  ProjectProfile,
  ResearchSection,
  SchoolClass,
  SupplyPrediction,
} from "@/lib/types";

function cloneSnapshot(snapshot: AppSnapshot) {
  return structuredClone(snapshot);
}

function retentionReferenceDate() {
  const today = todayInTaipei();
  return today > DEMO_REFERENCE_DATE ? today : DEMO_REFERENCE_DATE;
}

export class MemoryFoodLensRepository implements FoodLensRepository {
  private snapshot = createDemoSnapshot();
  private recovery?: AppSnapshot;
  private recoverySavedAt?: string;
  private retentionRuns: DataRetentionRun[] = [];

  async getSnapshot() {
    return cloneSnapshot(this.snapshot);
  }

  async confirmScan(command: ConfirmScanCommand) {
    const contentSha256 = await scanCommandHash(command);
    const next = cloneSnapshot(this.snapshot);
    const result = applyConfirmedScan(next, command, contentSha256);
    this.snapshot = next;
    return result;
  }

  async savePrediction(prediction: SupplyPrediction) {
    this.snapshot.predictions = [
      prediction,
      ...this.snapshot.predictions.filter((item) => item.id !== prediction.id),
    ];
  }

  async saveExperiment(experiment: ImprovementExperiment) {
    this.snapshot.experiments = [
      experiment,
      ...this.snapshot.experiments.filter((item) => item.id !== experiment.id),
    ];
  }

  async saveMealSafetyObservation(observation: MealSafetyObservation) {
    this.snapshot.mealSafetyObservations = appendMealSafetyObservation(
      this.snapshot.mealSafetyObservations,
      observation,
      this.snapshot.meals,
      "demo-local",
    );
  }

  async saveEvidenceCase(evidenceCase: MealEvidenceCase) {
    const mealRecordId =
      evidenceCase.mealRecordId ?? localEvidenceMealRecordId(evidenceCase.id);
    const linkedCase = linkEvidenceCaseToMealRecord(evidenceCase, mealRecordId);
    const mealRecord = evidenceCaseToMealRecord(linkedCase, mealRecordId);
    const next = cloneSnapshot(this.snapshot);
    next.evidenceCases = upsertEvidenceCase(next.evidenceCases, linkedCase);
    next.meals = [
      ...next.meals.filter((item) => item.id !== mealRecordId),
      mealRecord,
    ];
    this.snapshot = parseRuntimeSnapshot(next);
    return { mealRecordId };
  }

  async saveCollectionEvent(event: CollectionEvent) {
    if (
      !this.snapshot.evidenceCases.some(
        (evidenceCase) => evidenceCase.id === event.evidenceCaseId,
      )
    )
      throw new Error("找不到這筆清運事件所屬的餐期證據");
    this.snapshot.collectionEvents = upsertCollectionEvent(
      this.snapshot.collectionEvents,
      event,
    );
  }

  async saveDestinationReceipt(receipt: DestinationReceipt) {
    const collection = this.snapshot.collectionEvents.find(
      (event) => event.id === receipt.collectionEventId,
    );
    if (!collection) throw new Error("找不到這張處理場收據所屬的清運事件");
    if (collection.status !== "collected")
      throw new Error("尚未完成校方與清運單位交接，不能登錄處理場收據");
    if (
      collection.collectedAt &&
      Date.parse(receipt.receivedAt) < Date.parse(collection.collectedAt)
    )
      throw new Error("處理場收料時間不可早於校方清運交接時間");
    this.snapshot.destinationReceipts = upsertDestinationReceipt(
      this.snapshot.destinationReceipts,
      receipt,
    );
  }

  async updateSettings(settings: ImpactSettings) {
    this.snapshot.impactSettings = settings;
  }

  async updateProfile(profile: ProjectProfile) {
    this.snapshot.profile = profile;
  }

  async upsertClass(schoolClass: SchoolClass) {
    this.snapshot.classes = [
      ...this.snapshot.classes.filter((item) => item.id !== schoolClass.id),
      structuredClone(schoolClass),
    ];
  }

  async updateResearchSection(section: ResearchSection) {
    this.snapshot.researchSections = this.snapshot.researchSections.map(
      (item) => (item.id === section.id ? section : item),
    );
  }

  async importMealRecords(records: MealRecord[]) {
    const next = cloneSnapshot(this.snapshot);
    const count = mergeMealRecords(next, records);
    this.snapshot = next;
    return count;
  }

  async replaceSnapshot(snapshot: AppSnapshot) {
    const next = parseRuntimeSnapshot(snapshot);
    this.recovery = cloneSnapshot(this.snapshot);
    this.recoverySavedAt = new Date().toISOString();
    this.snapshot = cloneSnapshot(next);
  }

  async resetDemo() {
    this.recovery = cloneSnapshot(this.snapshot);
    this.recoverySavedAt = new Date().toISOString();
    this.snapshot = createDemoSnapshot();
    this.retentionRuns = [];
  }

  async restoreRecovery() {
    if (!this.recovery) return false;
    const current = cloneSnapshot(this.snapshot);
    this.snapshot = cloneSnapshot(this.recovery);
    this.recovery = current;
    this.recoverySavedAt = new Date().toISOString();
    return true;
  }

  async getRecoveryMetadata() {
    return this.recovery
      ? {
          savedAt: this.recoverySavedAt,
          mealCount: this.recovery.meals.length,
          scanCount: this.recovery.scans.length,
        }
      : null;
  }

  async previewDataRetention(retentionDays: number) {
    return createDataRetentionPreview(
      this.snapshot,
      retentionDays,
      retentionReferenceDate(),
    );
  }

  async executeDataRetention(retentionDays: number) {
    const now = new Date().toISOString();
    const preview = createDataRetentionPreview(
      this.snapshot,
      retentionDays,
      retentionReferenceDate(),
      now,
    );
    const deleted = scrubExpiredPlateEvidence(
      this.snapshot,
      retentionDays,
      retentionReferenceDate(),
    );
    if (this.recovery)
      scrubExpiredPlateEvidence(
        this.recovery,
        retentionDays,
        retentionReferenceDate(),
      );
    const run: DataRetentionRun = {
      id: createUuid(),
      cutoffDate: preview.cutoffDate,
      retentionDays,
      status: "completed",
      candidateScanCount: deleted.deletedScanCount,
      candidateImageCount: deleted.deletedImageCount,
      affectedMealCount: deleted.affectedMealCount,
      deletedScanCount: deleted.deletedScanCount,
      deletedImageCount: deleted.deletedImageCount,
      startedAt: now,
      completedAt: now,
    };
    this.retentionRuns.unshift(run);
    return structuredClone(run);
  }

  async listDataRetentionRuns() {
    return structuredClone(this.retentionRuns);
  }
}
