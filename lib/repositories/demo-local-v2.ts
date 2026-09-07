"use client";

import Dexie, { type EntityTable } from "dexie";
import { createUuid, sha256Hex } from "@/lib/crypto";
import {
  createDataRetentionPreview,
  scrubExpiredPlateEvidence,
} from "@/lib/data-retention";
import { parseRuntimeSnapshot } from "@/lib/data-portability";
import { todayInTaipei } from "@/lib/date";
import {
  appendMealSafetyObservation,
  validateMealSafetyHistory,
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
  mergeMealRecords,
  resolvePersistedPlateMenuContext,
} from "@/lib/repositories/local-state";
import {
  createDemoSnapshot,
  DEMO_REFERENCE_DATE,
  DEMO_SEED_VERSION,
} from "@/lib/seed";
import { derivePlateScanAnalysisKind } from "@/lib/types";
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

interface CustomizationState {
  profile: boolean;
  settings: boolean;
  researchSectionIds: string[];
  /** Class IDs added or edited by the local school administrator. */
  classIds: string[];
}

interface StateRow {
  id: "snapshot" | "recovery";
  version: number;
  schemaVersion: 1;
  value: AppSnapshot;
  customized: CustomizationState;
  recoveryCreatedAt?: string;
}

class FoodLensDatabase extends Dexie {
  state!: EntityTable<StateRow, "id">;
  retentionRuns!: EntityTable<DataRetentionRun, "id">;
  constructor() {
    super("foodlens-demo");
    this.version(1).stores({ state: "id,version" });
    this.version(2).stores({
      state: "id,version",
      retentionRuns: "id,startedAt,status",
    });
  }
}

let database: FoodLensDatabase | undefined;
function db() {
  database ??= new FoodLensDatabase();
  return database;
}

/**
 * Release this module's IndexedDB connection without deleting any local data.
 * The next repository operation opens a fresh connection to the same database.
 */
export function closeDemoLocalDatabaseConnection() {
  database?.close();
  database = undefined;
}

const emptyCustomization = (): CustomizationState => ({
  profile: false,
  settings: false,
  researchSectionIds: [],
  classIds: [],
});

function freshRow(value = createDemoSnapshot()): StateRow {
  return {
    id: "snapshot",
    version: DEMO_SEED_VERSION,
    schemaVersion: 1,
    value,
    customized: emptyCustomization(),
  };
}

function byId<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  const values = new Map(base.map((item) => [item.id, item]));
  overrides.forEach((item) => values.set(item.id, item));
  return [...values.values()];
}

function sameClass(left: SchoolClass, right: SchoolClass) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.grade === right.grade &&
    left.active === right.active
  );
}

const LEGACY_DEFAULT_UPDATED_AT = new Set([
  "2026-10-23T16:20:00+08:00",
  "2026-10-16T16:20:00+08:00",
]);

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * v12 existed before exact collection sources and explicit menu-review fields.
 * A pickup's sources cannot be reconstructed from its total weight or planned
 * destination, so that legacy sub-chain is intentionally retired and replaced
 * by the v13 Demo trace. Other local work remains untouched.
 */
function prepareLegacySnapshot(value: unknown): unknown {
  const next = structuredClone(value);
  const root = objectRecord(next);
  if (!root) return next;

  const events = Array.isArray(root.collectionEvents)
    ? root.collectionEvents
    : [];
  const hasUnclassifiedPickup = events.some((event) => {
    const row = objectRecord(event);
    return !row || !Array.isArray(row.wasteSources) || !row.wasteSources.length;
  });
  if (hasUnclassifiedPickup) {
    root.collectionEvents = [];
    root.destinationReceipts = [];
  }

  if (Array.isArray(root.evidenceCases)) {
    for (const rawCase of root.evidenceCases) {
      const evidenceCase = objectRecord(rawCase);
      const menu = objectRecord(evidenceCase?.menuVersion);
      const sourceEvidence = objectRecord(menu?.sourceEvidence);
      if (sourceEvidence && !Array.isArray(sourceEvidence.warnings)) {
        sourceEvidence.warnings = [
          "由 v12 本機資料升級：舊版未分欄保存菜單來源警示。",
        ];
      }
      const confirmation = objectRecord(menu?.confirmation);
      if (confirmation && !Array.isArray(confirmation.acceptedLowConfidence)) {
        const acceptedLowConfidence = (
          Array.isArray(menu?.plannedDishes) ? menu.plannedDishes : []
        ).flatMap((rawDish) => {
          const dish = objectRecord(rawDish);
          const signature = dish?.signature;
          const fields = dish?.lowConfidenceFields;
          return typeof signature === "string" &&
            Array.isArray(fields) &&
            fields.length
            ? [{ dishSignature: signature, fields }]
            : [];
        });
        confirmation.acceptedLowConfidence = acceptedLowConfidence;
        const previousNotes =
          typeof confirmation.notes === "string" ? confirmation.notes : "";
        confirmation.notes =
          `${previousNotes}${previousNotes ? "；" : ""}由 v12 升級：舊版只有整份菜單人工確認，低信心欄位依當時仍保留的菜色欄位轉存。`.slice(
            0,
            500,
          );
      }
    }
  }
  return next;
}

function migrateRow(current: Partial<StateRow> & { value: AppSnapshot }) {
  if (
    current.version === DEMO_SEED_VERSION &&
    current.schemaVersion === 1 &&
    current.customized &&
    Array.isArray(current.customized.classIds)
  )
    return current as StateRow;

  const next = createDemoSnapshot();
  const previous = current.value;
  const inferredCustomization: CustomizationState = {
    profile:
      current.customized?.profile ??
      !LEGACY_DEFAULT_UPDATED_AT.has(previous.profile?.updatedAt ?? ""),
    settings:
      current.customized?.settings ??
      !LEGACY_DEFAULT_UPDATED_AT.has(previous.impactSettings?.updatedAt ?? ""),
    researchSectionIds:
      current.customized?.researchSectionIds ??
      (previous.researchSections ?? [])
        .filter((item) => !LEGACY_DEFAULT_UPDATED_AT.has(item.updatedAt))
        .map((item) => item.id),
    classIds:
      current.customized?.classIds ??
      (previous.classes ?? [])
        .filter((item) => {
          const seeded = next.classes.find((seed) => seed.id === item.id);
          return !seeded || !sameClass(item, seeded);
        })
        .map((item) => item.id),
  };

  const seedScanIds = new Set(next.scans.map((item) => item.id));
  const preservedScans = (previous.scans ?? []).filter(
    (item) => !seedScanIds.has(item.id),
  );
  const preservedScanIds = new Set(preservedScans.map((item) => item.id));
  const preservedMeals = (previous.meals ?? []).filter(
    (item) =>
      item.source !== "demo" ||
      preservedScans.some((scan) => scan.mealRecordId === item.id),
  );
  const customResearch = new Set(inferredCustomization.researchSectionIds);

  const customClassIds = new Set(inferredCustomization.classIds);
  next.classes = byId(
    next.classes,
    (previous.classes ?? []).filter((item) => customClassIds.has(item.id)),
  );
  next.meals = byId(next.meals, preservedMeals);
  next.scans = byId(next.scans, preservedScans);
  next.detections = byId(
    next.detections,
    (previous.detections ?? []).filter((item) =>
      preservedScanIds.has(item.scanId),
    ),
  );
  const preservedDetectionIds = new Set(
    next.detections
      .filter((item) => preservedScanIds.has(item.scanId))
      .map((item) => item.id),
  );
  next.corrections = byId(
    next.corrections,
    (previous.corrections ?? []).filter((item) =>
      preservedDetectionIds.has(item.detectionId),
    ),
  );
  next.predictions = byId(next.predictions, previous.predictions ?? []);
  // Never add new simulated safety evidence to previously collected meals.
  // Retain every revision and its parent, including customized Demo meal rows.
  next.mealSafetyObservations = previous.mealSafetyObservations ?? [];
  const safetyMealIds = new Set(
    next.mealSafetyObservations.map((item) => item.mealRecordId),
  );
  next.meals = byId(
    next.meals,
    (previous.meals ?? []).filter((meal) => safetyMealIds.has(meal.id)),
  );
  const seededExperimentIds = new Set(next.experiments.map((item) => item.id));
  next.experiments = byId(
    next.experiments,
    (previous.experiments ?? []).filter(
      (item) => !seededExperimentIds.has(item.id),
    ),
  );
  const seededEvidenceIds = new Set(
    next.evidenceCases.map((evidenceCase) => evidenceCase.id),
  );
  next.evidenceCases = byId(next.evidenceCases, previous.evidenceCases ?? []);
  next.evidenceCases = next.evidenceCases.map((evidenceCase) => {
    if (seededEvidenceIds.has(evidenceCase.id)) return evidenceCase;
    const mealRecordId =
      evidenceCase.mealRecordId ?? localEvidenceMealRecordId(evidenceCase.id);
    const linkedCase = linkEvidenceCaseToMealRecord(evidenceCase, mealRecordId);
    const mealRecord = evidenceCaseToMealRecord(linkedCase, mealRecordId);
    next.meals = [
      ...next.meals.filter((item) => item.id !== mealRecordId),
      mealRecord,
    ];
    return linkedCase;
  });
  next.collectionEvents = byId(
    next.collectionEvents,
    previous.collectionEvents ?? [],
  );
  next.destinationReceipts = byId(
    next.destinationReceipts,
    previous.destinationReceipts ?? [],
  );
  next.researchSections = byId(
    next.researchSections,
    (previous.researchSections ?? []).filter((item) =>
      customResearch.has(item.id),
    ),
  );
  if (inferredCustomization.settings && previous.impactSettings)
    next.impactSettings = previous.impactSettings;
  if (inferredCustomization.profile && previous.profile)
    next.profile = previous.profile;

  return {
    id: "snapshot" as const,
    version: DEMO_SEED_VERSION,
    schemaVersion: 1 as const,
    value: next,
    customized: inferredCustomization,
  };
}

async function ensureState() {
  return db().transaction("rw", db().state, async () => {
    let current = await db().state.get("snapshot");
    if (current) {
      try {
        const value =
          current.version < DEMO_SEED_VERSION
            ? prepareLegacySnapshot(current.value)
            : current.value;
        current = { ...current, value: parseRuntimeSnapshot(value) };
      } catch {
        await db().state.put({
          ...current,
          id: "recovery",
          recoveryCreatedAt: new Date().toISOString(),
        });
        current = undefined;
      }
    }
    const row = current ? migrateRow(current) : freshRow();
    if (row !== current) await db().state.put(row);
    return row.value;
  });
}

function uid(prefix: string) {
  return `${prefix}-${createUuid()}`;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function commandHash(command: ConfirmScanCommand) {
  const imageSha256 = command.imageBlob
    ? await sha256Hex(await command.imageBlob.arrayBuffer())
    : undefined;
  return sha256Hex(
    new TextEncoder().encode(
      stableJson({
        meal: command.meal,
        imageSha256,
        imageUrl: command.imageUrl,
        analysis: command.analysis,
        menuContext: command.menuContext ?? null,
        corrections: command.corrections,
        correctionNotes: command.correctionNotes,
      }),
    ).buffer as ArrayBuffer,
  );
}

function notifyDemoChange() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("foodlens-demo-updated"));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel("foodlens-demo-updates");
      channel.postMessage({ changedAt: Date.now() });
      channel.close();
    } catch {
      // Some managed browsers block cross-tab channels; the local write succeeded.
    }
  }
}

function retentionReferenceDate() {
  const today = todayInTaipei();
  return today > DEMO_REFERENCE_DATE ? today : DEMO_REFERENCE_DATE;
}

async function updateState(
  updater: (state: AppSnapshot, row: StateRow) => void | Promise<void>,
) {
  await db().transaction("rw", db().state, async () => {
    const current = await db().state.get("snapshot");
    const row = current ? migrateRow(current) : freshRow();
    await updater(row.value, row);
    validateMealSafetyHistory(
      row.value.mealSafetyObservations ?? [],
      row.value.meals,
    );
    row.version = DEMO_SEED_VERSION;
    row.schemaVersion = 1;
    await db().state.put(row);
  });
  notifyDemoChange();
}

export class DemoLocalRepositoryV2 implements FoodLensRepository {
  async getSnapshot() {
    return ensureState();
  }

  async confirmScan(command: ConfirmScanCommand) {
    const contentSha256 = await commandHash(command);
    const result = await db().transaction("rw", db().state, async () => {
      const current = await db().state.get("snapshot");
      const row = current ? migrateRow(current) : freshRow();
      const state = row.value;
      const now = new Date().toISOString();
      const mealId = command.meal.id ?? uid("meal");
      const scanId = `scan-${command.clientRequestId}`;
      const existingScan = state.scans.find((scan) => scan.id === scanId);
      if (existingScan) {
        if (existingScan.contentSha256 === contentSha256)
          return {
            mealId: existingScan.mealRecordId,
            scanId: existingScan.id,
          };
        throw new Error(
          existingScan.contentSha256
            ? "同一送出識別碼已保存另一份內容；請先到每日紀錄確認，再將新餐盤另行送出。"
            : "這筆舊版紀錄缺少內容指紋，為避免誤判重試，請將新餐盤另行送出。",
        );
      }
      const analysisKind = derivePlateScanAnalysisKind(command.analysis);
      const menuSignature =
        `${command.meal.staple}|${command.meal.mainDish}`.toLowerCase();
      const existingMealIndex = state.meals.findIndex(
        (meal) => meal.id === mealId,
      );
      if (command.meal.id && existingMealIndex < 0)
        throw new Error("指定的既有餐期不存在，請重新選擇餐期");
      const menuContext = resolvePersistedPlateMenuContext({
        state,
        mealId,
        analysisKind,
        context: command.menuContext,
      });
      if (existingMealIndex < 0) {
        if (
          !Number.isInteger(command.meal.leftoverG) ||
          command.meal.leftoverG < 0 ||
          command.meal.leftoverG > command.meal.totalSupplyG
        )
          throw new Error("全班剩食秤重必須介於 0 與總供應重量之間");
        if (
          command.meal.measurementMethod !== "scale" &&
          command.meal.measurementMethod !== "manual"
        )
          throw new Error(
            "班級剩食重量必須來自秤重或人工登錄，不能由單張餐盤推算",
          );
        state.meals.push({
          ...command.meal,
          id: mealId,
          menuSignature,
          createdAt: now,
          updatedAt: now,
        });
      }
      state.scans.push({
        id: scanId,
        mealRecordId: mealId,
        imageBlob: command.imageBlob,
        imageUrl: command.imageUrl,
        analysisKind,
        menuContext,
        provider: command.analysis.provider,
        model: command.analysis.model,
        schemaVersion: "1",
        status: "confirmed",
        reviewedAt: now,
        createdAt: now,
        contentSha256,
      });
      command.analysis.detections.forEach((original, index) => {
        const detectionId = `${scanId}-d${index + 1}`;
        state.detections.push({
          id: detectionId,
          scanId,
          category: original.category,
          label: original.label,
          aiOriginalG: original.originalG,
          aiRemainingRatio: original.remainingRatio,
          aiRemainingG: original.remainingG,
          confidence: original.confidence,
          sortOrder: index,
        });
        const corrected = command.corrections[index];
        if (
          corrected &&
          (corrected.category !== original.category ||
            corrected.label !== original.label ||
            corrected.originalG !== original.originalG ||
            corrected.remainingRatio !== original.remainingRatio)
        ) {
          state.corrections.push({
            id: `${detectionId}-correction`,
            detectionId,
            correctedCategory: corrected.category,
            correctedLabel: corrected.label,
            correctedOriginalG: corrected.originalG,
            correctedRemainingRatio: corrected.remainingRatio,
            correctedRemainingG: corrected.remainingG,
            note: command.correctionNotes?.[index] ?? "學生人工確認與修正",
            correctedAt: now,
          });
        }
      });
      row.version = DEMO_SEED_VERSION;
      row.schemaVersion = 1;
      await db().state.put(row);
      return { mealId, scanId };
    });
    notifyDemoChange();
    return result;
  }

  async savePrediction(prediction: SupplyPrediction) {
    await updateState((state) => {
      state.predictions = [
        prediction,
        ...state.predictions.filter((item) => item.id !== prediction.id),
      ];
    });
  }
  async saveExperiment(experiment: ImprovementExperiment) {
    await updateState((state) => {
      state.experiments = [
        experiment,
        ...state.experiments.filter((item) => item.id !== experiment.id),
      ];
    });
  }
  async saveMealSafetyObservation(observation: MealSafetyObservation) {
    await updateState((state) => {
      state.mealSafetyObservations = appendMealSafetyObservation(
        state.mealSafetyObservations ?? [],
        observation,
        state.meals,
        "demo-local",
      );
    });
  }
  async saveEvidenceCase(evidenceCase: MealEvidenceCase) {
    const mealRecordId =
      evidenceCase.mealRecordId ?? localEvidenceMealRecordId(evidenceCase.id);
    const linkedCase = linkEvidenceCaseToMealRecord(evidenceCase, mealRecordId);
    const mealRecord = evidenceCaseToMealRecord(linkedCase, mealRecordId);
    await updateState((state) => {
      state.evidenceCases = upsertEvidenceCase(state.evidenceCases, linkedCase);
      state.meals = [
        ...state.meals.filter((item) => item.id !== mealRecordId),
        mealRecord,
      ];
    });
    return { mealRecordId };
  }
  async saveCollectionEvent(event: CollectionEvent) {
    await updateState((state) => {
      if (
        !state.evidenceCases.some(
          (evidenceCase) => evidenceCase.id === event.evidenceCaseId,
        )
      )
        throw new Error("找不到這筆清運事件所屬的餐期證據");
      state.collectionEvents = upsertCollectionEvent(
        state.collectionEvents,
        event,
      );
    });
  }
  async saveDestinationReceipt(receipt: DestinationReceipt) {
    await updateState((state) => {
      const collection = state.collectionEvents.find(
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
      state.destinationReceipts = upsertDestinationReceipt(
        state.destinationReceipts,
        receipt,
      );
    });
  }
  async updateSettings(settings: ImpactSettings) {
    await updateState((state, row) => {
      state.impactSettings = settings;
      row.customized.settings = true;
    });
  }
  async updateProfile(profile: ProjectProfile) {
    await updateState((state, row) => {
      state.profile = profile;
      row.customized.profile = true;
    });
  }
  async upsertClass(schoolClass: SchoolClass) {
    await updateState((state, row) => {
      state.classes = [
        ...state.classes.filter((item) => item.id !== schoolClass.id),
        schoolClass,
      ];
      row.customized.classIds = [
        ...new Set([...row.customized.classIds, schoolClass.id]),
      ];
    });
  }
  async updateResearchSection(section: ResearchSection) {
    await updateState((state, row) => {
      state.researchSections = state.researchSections.map((item) =>
        item.id === section.id ? section : item,
      );
      row.customized.researchSectionIds = [
        ...new Set([...row.customized.researchSectionIds, section.id]),
      ];
    });
  }
  async importMealRecords(records: MealRecord[]) {
    await updateState((state) => {
      mergeMealRecords(state, records);
    });
    return records.length;
  }
  async replaceSnapshot(snapshot: AppSnapshot) {
    const validated = parseRuntimeSnapshot(snapshot);
    await db().transaction("rw", db().state, async () => {
      const current = await db().state.get("snapshot");
      if (current)
        await db().state.put({
          ...current,
          id: "recovery",
          recoveryCreatedAt: new Date().toISOString(),
        });
      await db().state.put({
        ...freshRow(validated),
        customized: {
          profile: true,
          settings: true,
          researchSectionIds: snapshot.researchSections.map((item) => item.id),
          classIds: snapshot.classes.map((item) => item.id),
        },
      });
    });
    notifyDemoChange();
  }
  async resetDemo() {
    await db().transaction("rw", db().state, db().retentionRuns, async () => {
      const current = await db().state.get("snapshot");
      if (current)
        await db().state.put({
          ...current,
          id: "recovery",
          recoveryCreatedAt: new Date().toISOString(),
        });
      await db().state.put(freshRow());
      await db().retentionRuns.clear();
    });
    notifyDemoChange();
  }
  async restoreRecovery() {
    const restored = await db().transaction("rw", db().state, async () => {
      const current = await db().state.get("snapshot");
      const recovery = await db().state.get("recovery");
      if (!current || !recovery) return false;
      const recoveredSnapshot = parseRuntimeSnapshot(recovery.value);
      await db().state.put({
        ...current,
        id: "recovery",
        recoveryCreatedAt: new Date().toISOString(),
      });
      await db().state.put({
        ...recovery,
        id: "snapshot",
        value: recoveredSnapshot,
        recoveryCreatedAt: undefined,
      });
      return true;
    });
    if (restored) notifyDemoChange();
    return restored;
  }
  async getRecoveryMetadata() {
    const recovery = await db().state.get("recovery");
    return recovery &&
      Array.isArray(recovery.value?.meals) &&
      Array.isArray(recovery.value?.scans)
      ? {
          savedAt: recovery.recoveryCreatedAt,
          mealCount: recovery.value.meals.length,
          scanCount: recovery.value.scans.length,
        }
      : null;
  }

  async previewDataRetention(retentionDays: number) {
    return createDataRetentionPreview(
      await ensureState(),
      retentionDays,
      retentionReferenceDate(),
    );
  }

  async executeDataRetention(retentionDays: number) {
    const now = new Date().toISOString();
    const run = await db().transaction(
      "rw",
      db().state,
      db().retentionRuns,
      async () => {
        const current = await db().state.get("snapshot");
        const currentRow = current ? migrateRow(current) : freshRow();
        const preview = createDataRetentionPreview(
          currentRow.value,
          retentionDays,
          retentionReferenceDate(),
          now,
        );
        const deleted = scrubExpiredPlateEvidence(
          currentRow.value,
          retentionDays,
          retentionReferenceDate(),
        );
        await db().state.put(currentRow);

        const recovery = await db().state.get("recovery");
        if (recovery) {
          scrubExpiredPlateEvidence(
            recovery.value,
            retentionDays,
            retentionReferenceDate(),
          );
          await db().state.put(recovery);
        }

        const value: DataRetentionRun = {
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
        await db().retentionRuns.put(value);
        return value;
      },
    );
    notifyDemoChange();
    return run;
  }

  async listDataRetentionRuns() {
    return (await db().retentionRuns.toArray()).sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    );
  }
}

export { DemoLocalRepositoryV2 as DemoLocalRepository };
