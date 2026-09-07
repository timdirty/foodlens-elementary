"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/crypto";
import {
  decodeExperimentDescription,
  encodeExperimentDescription,
} from "@/lib/experiment-decision";
import { hasSameMealEvidence } from "@/lib/repositories/local-state";
import {
  mealEvidenceCaseSchema,
  type MealEvidenceCase,
} from "@/lib/evidence-chain";
import type { MenuImportSource } from "@/lib/menu-intelligence";
import {
  mealSafetyObservationSchema,
  validateMealSafetyHistory,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import {
  collectionEventSchema,
  destinationReceiptSchema,
  upsertCollectionEvent,
  upsertDestinationReceipt,
  type CollectionEvent,
  type DestinationReceipt,
} from "@/lib/circularity";
import {
  evidenceCaseToMealRecord,
  linkEvidenceCaseToMealRecord,
} from "@/lib/evidence-meal";
import {
  persistedPlateScanAnalysisKind,
  validatedPlateScanMenuContext,
} from "@/lib/types";
import type {
  AppSnapshot,
  ConfirmScanCommand,
  DataRetentionPreview,
  DataRetentionRun,
  FoodCategory,
  FoodLensRepository,
  ImpactSettings,
  ImprovementExperiment,
  MealRecord,
  ProjectProfile,
  ResearchSection,
  SchoolClass,
  SupplyPrediction,
} from "@/lib/types";
import { PLATE_IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/storage-security";

type Row = Record<string, unknown>;
const SNAPSHOT_PAGE_SIZE = 500;
const SIGNED_URL_BATCH_SIZE = 100;
export const MAX_SCAN_CORRECTION_NOTE_CHARACTERS = 300;
const snapshotTables = [
  "classes",
  "meal_records",
  "plate_scans",
  "scan_detections",
  "scan_corrections",
  "supply_predictions",
  "experiments",
  "meal_batches",
  "meal_safety_observations",
  "collection_events",
  "destination_receipts",
  "research_sections",
  "impact_settings",
  "project_profiles",
] as const;
type SnapshotTable = (typeof snapshotTables)[number];
const snapshotOrderColumn: Record<SnapshotTable, string> = {
  classes: "id",
  meal_records: "id",
  plate_scans: "id",
  scan_detections: "id",
  scan_corrections: "id",
  supply_predictions: "id",
  experiments: "id",
  meal_batches: "id",
  meal_safety_observations: "id",
  collection_events: "id",
  destination_receipts: "id",
  research_sections: "id",
  impact_settings: "school_id",
  project_profiles: "school_id",
};
const s = (value: unknown) => (typeof value === "string" ? value : "");
const n = (value: unknown) => Number(value ?? 0);
const list = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];
const category = (value: unknown) => s(value) as FoodCategory;

function mealSafetySaveError(error: unknown): Error {
  const detail = error && typeof error === "object" ? (error as Row) : {};
  const code = s(detail.code);
  const sourceMessage = s(detail.message);
  let message =
    "安全觀察保存未完成，請稍後重試；重新送出相同內容不會新增重複紀錄。";
  if (code === "40001")
    message =
      "這筆餐期已有較新的安全觀察修訂，請重新讀取最新資料，再核對並新增修訂。";
  else if (code === "23505") {
    if (sourceMessage.includes("ambiguous class/date/meal period"))
      message =
        "同班、同日、同餐期有多筆餐期紀錄；請先由教師釐清重複餐期，再保存安全觀察。";
    else if (
      sourceMessage.includes("same meal safety id has different payload")
    )
      message =
        "這個安全觀察編號已保存不同內容，不可覆寫；請重新讀取原紀錄，再新增修訂。";
    else
      message =
        "安全觀察紀錄或修訂編號重複；請重新讀取最新資料後核對，不會覆寫原紀錄。";
  } else if (code === "42501")
    message =
      "目前帳號沒有保存這所學校安全觀察的權限；請重新登入，並請管理員確認教師或管理員身分。";
  else if (code === "22023")
    message =
      "安全觀察與目前餐期不一致，或欄位未符合規則；請重新讀取餐期，核對人數、菜單、來源及數值後再保存。";
  else if (code === "55000")
    message =
      "已保存的安全觀察不可覆寫或刪除；請保留原紀錄，重新讀取後新增修訂並說明原因。";
  // Keep only a bounded diagnostic code, never database details or source text.
  return new Error(message, {
    cause: { code: /^[A-Z0-9]{5,12}$/.test(code) ? code : null },
  });
}

export function mealSafetyObservationsFromRows(
  rows: Row[],
): MealSafetyObservation[] {
  return rows.map((row) => {
    const result = mealSafetyObservationSchema.safeParse(row.observation);
    if (!result.success || result.data.provenance !== "school-record")
      throw new Error(
        `安全觀察 ${s(row.id)} 的校園稽核資料不完整；不會推定為零或轉成示範資料。`,
      );
    const value = result.data;
    if (
      value.id !== row.id ||
      value.mealRecordId !== row.meal_record_id ||
      value.revision !== row.revision ||
      value.previousObservationId !== row.previous_observation_id
    )
      throw new Error(`安全觀察 ${s(row.id)} 的修訂索引與原始資料不一致。`);
    return value;
  });
}

export function persistedPlateScanMenuContext(row: Row) {
  const menuVersionId = s(row.menu_context_version_id);
  const menuVersionSignature = s(row.menu_context_signature);
  const rawCandidateCount = row.menu_context_candidate_count;
  if (
    !menuVersionId &&
    !menuVersionSignature &&
    (rawCandidateCount === null || rawCandidateCount === undefined)
  )
    return null;
  try {
    return validatedPlateScanMenuContext({
      menuVersionId,
      menuVersionSignature,
      candidateCount: Number(rawCandidateCount),
    });
  } catch {
    throw new Error(`餐盤掃描 ${s(row.id)} 的菜單候選稽核資料不完整`);
  }
}

export function createPlateScanMenuContextAssertion(
  context: ConfirmScanCommand["menuContext"],
) {
  const value = validatedPlateScanMenuContext(context);
  return value
    ? {
        menu_version_signature: value.menuVersionSignature,
        candidate_count: value.candidateCount,
      }
    : undefined;
}

/**
 * The RPC stores correction notes by detection index. Normalize a shorter
 * caller array to that exact shape, while keeping an omitted field omitted so
 * legacy in-flight retries retain their original idempotency fingerprint.
 */
export function createPlateScanCorrectionNotesPayload(
  notes: ConfirmScanCommand["correctionNotes"],
  correctionCount: number,
): { correction_notes?: Array<string | null> } {
  if (notes === undefined) return {};
  if (!Array.isArray(notes)) throw new Error("修正註記必須是陣列");
  if (!Number.isInteger(correctionCount) || correctionCount < 1) {
    throw new Error("修正註記必須對應至少一筆餐盤辨識結果");
  }
  if (notes.length > correctionCount) {
    throw new Error("修正註記數量不可超過餐盤辨識結果");
  }

  return {
    correction_notes: Array.from({ length: correctionCount }, (_, index) => {
      const note = notes[index];
      if (note === undefined) return null;
      if (typeof note !== "string") throw new Error("每筆修正註記必須是文字");
      if (Array.from(note).length > MAX_SCAN_CORRECTION_NOTE_CHARACTERS) {
        throw new Error(
          `每筆修正註記不可超過 ${MAX_SCAN_CORRECTION_NOTE_CHARACTERS} 個字`,
        );
      }
      return note;
    }),
  };
}

function retentionPreview(row: Row): DataRetentionPreview {
  return {
    cutoffDate: s(row.cutoff_date),
    retentionDays: n(row.retention_days),
    eligibleScanCount: n(row.eligible_scan_count),
    eligibleImageCount: n(row.eligible_image_count),
    affectedMealCount: n(row.affected_meal_count),
    preservedMealCount: n(row.preserved_meal_count),
    oldestEligibleDate: s(row.oldest_eligible_date) || undefined,
    newestEligibleDate: s(row.newest_eligible_date) || undefined,
    generatedAt: s(row.generated_at) || new Date().toISOString(),
    batchLimit: n(row.batch_limit) || 500,
  };
}

function retentionRun(row: Row): DataRetentionRun {
  return {
    id: s(row.id),
    cutoffDate: s(row.cutoff_date),
    retentionDays: n(row.retention_days),
    status: s(row.status) as DataRetentionRun["status"],
    candidateScanCount: n(row.candidate_scan_count),
    candidateImageCount: n(row.candidate_image_count),
    affectedMealCount: n(row.affected_meal_count),
    deletedScanCount: n(row.deleted_scan_count),
    deletedImageCount: n(row.deleted_image_count),
    startedAt: s(row.started_at),
    completedAt: s(row.completed_at) || undefined,
    failureReason: s(row.failure_reason) || undefined,
  };
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedText(value: string, maximumCharacters: number) {
  const characters = Array.from(value.trim());
  if (characters.length <= maximumCharacters) return characters.join("");
  return `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

async function deterministicUuid(value: string) {
  const digest = await sha256Hex(new TextEncoder().encode(value));
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function evidenceCasesFromRows(rows: Row[]): MealEvidenceCase[] {
  const cases: MealEvidenceCase[] = [];
  for (const row of rows) {
    const payload = row.audit_payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length === 0
    )
      continue;
    const mealRecordId = s(row.meal_record_id);
    const result = mealEvidenceCaseSchema.safeParse({
      ...payload,
      ...(mealRecordId ? { mealRecordId } : {}),
    });
    if (!result.success) {
      throw new Error(
        `餐期證據鏈 ${s(row.client_case_id) || s(row.id)} 無法驗證：${result.error.issues[0]?.message ?? "格式錯誤"}`,
      );
    }
    cases.push(result.data);
  }
  return cases.sort((left, right) =>
    left.servedOn.localeCompare(right.servedOn),
  );
}

function auditEvidenceCaseId(row: Row) {
  const payload = row.audit_payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? s((payload as Row).id)
    : "";
}

function collectionEventFromRow(
  row: Row,
  evidenceCaseId: string,
): CollectionEvent {
  return collectionEventSchema.parse({
    id: s(row.id),
    evidenceCaseId,
    mealBatchId: s(row.meal_batch_id) || undefined,
    status: s(row.status),
    scheduledAt: s(row.scheduled_at),
    collectedAt: s(row.collected_at) || undefined,
    haulerName: s(row.hauler_name) || undefined,
    manifestReference: s(row.manifest_reference) || undefined,
    netCollectedWeightG:
      row.net_collected_weight_g === null ||
      row.net_collected_weight_g === undefined
        ? undefined
        : n(row.net_collected_weight_g),
    weightState: s(row.weight_state),
    plannedDestinationName: s(row.planned_destination_name),
    plannedTreatmentMethod: s(row.planned_treatment_method),
    wasteSources: list(row.waste_sources),
    provenance: s(row.provenance),
    createdAt: s(row.created_at),
    updatedAt: s(row.updated_at),
  });
}

function destinationReceiptFromRow(row: Row): DestinationReceipt {
  return destinationReceiptSchema.parse({
    id: s(row.id),
    collectionEventId: s(row.collection_event_id),
    receiptReference: s(row.receipt_reference),
    facilityName: s(row.facility_name),
    actualTreatmentMethod: s(row.actual_treatment_method),
    acceptedWeightG:
      row.accepted_weight_g === null || row.accepted_weight_g === undefined
        ? undefined
        : n(row.accepted_weight_g),
    receivedAt: s(row.received_at),
    status: s(row.status),
    verifiedBy: s(row.verified_by) || undefined,
    verifiedAt: s(row.verified_at) || undefined,
    rejectionReason: s(row.rejection_reason) || undefined,
    documentSha256: s(row.document_sha256) || undefined,
    provenance: s(row.provenance),
    createdAt: s(row.created_at),
    updatedAt: s(row.updated_at),
  });
}

export function createCollectionEventRow(
  schoolId: string,
  event: CollectionEvent,
  ids: { id: string; mealBatchId: string },
) {
  const value = collectionEventSchema.parse(event);
  return {
    id: ids.id,
    school_id: schoolId,
    meal_batch_id: ids.mealBatchId,
    status: value.status,
    scheduled_at: value.scheduledAt,
    collected_at: value.collectedAt ?? null,
    hauler_name: value.haulerName ?? null,
    manifest_reference: value.manifestReference ?? null,
    net_collected_weight_g: value.netCollectedWeightG ?? null,
    weight_state: value.weightState,
    planned_destination_name: value.plannedDestinationName,
    planned_treatment_method: value.plannedTreatmentMethod,
    waste_sources: value.wasteSources,
    provenance: value.provenance,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

export function createDestinationReceiptRow(
  schoolId: string,
  receipt: DestinationReceipt,
  ids: { id: string; verifiedBy: string | null },
) {
  const value = destinationReceiptSchema.parse(receipt);
  return {
    id: ids.id,
    school_id: schoolId,
    collection_event_id: value.collectionEventId,
    receipt_reference: value.receiptReference,
    facility_name: value.facilityName,
    actual_treatment_method: value.actualTreatmentMethod,
    accepted_weight_g: value.acceptedWeightG ?? null,
    received_at: value.receivedAt,
    status: value.status,
    verified_by: value.status === "verified" ? ids.verifiedBy : null,
    verified_at: value.status === "verified" ? value.verifiedAt : null,
    rejection_reason:
      value.status === "rejected" ? value.rejectionReason : null,
    document_sha256: value.documentSha256 ?? null,
    provenance: value.provenance,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

export function sameCollectionEventMaterial(
  left: CollectionEvent,
  right: CollectionEvent,
) {
  const leftMaterial = Object.fromEntries(
    Object.entries(left).filter(([key]) => key !== "updatedAt"),
  );
  const rightMaterial = Object.fromEntries(
    Object.entries(right).filter(([key]) => key !== "updatedAt"),
  );
  return (
    stableJson({
      ...leftMaterial,
      createdAt: new Date(left.createdAt).toISOString(),
      scheduledAt: new Date(left.scheduledAt).toISOString(),
      collectedAt: left.collectedAt
        ? new Date(left.collectedAt).toISOString()
        : undefined,
    }) ===
    stableJson({
      ...rightMaterial,
      createdAt: new Date(right.createdAt).toISOString(),
      scheduledAt: new Date(right.scheduledAt).toISOString(),
      collectedAt: right.collectedAt
        ? new Date(right.collectedAt).toISOString()
        : undefined,
    })
  );
}

export function sameDestinationReceiptMaterial(
  left: DestinationReceipt,
  right: DestinationReceipt,
) {
  const ignored = new Set(["updatedAt", "verifiedAt", "verifiedBy"]);
  const leftMaterial = Object.fromEntries(
    Object.entries(left).filter(([key]) => !ignored.has(key)),
  );
  const rightMaterial = Object.fromEntries(
    Object.entries(right).filter(([key]) => !ignored.has(key)),
  );
  return (
    stableJson({
      ...leftMaterial,
      createdAt: new Date(left.createdAt).toISOString(),
      receivedAt: new Date(left.receivedAt).toISOString(),
    }) ===
    stableJson({
      ...rightMaterial,
      createdAt: new Date(right.createdAt).toISOString(),
      receivedAt: new Date(right.receivedAt).toISOString(),
    })
  );
}

const databaseWasteSource = {
  prep: "preparation",
  "unserved-edible": "unserved_edible",
  "plate-edible": "plate_edible",
  inedible: "inedible",
  "liquid-contaminated": "liquid",
} as const;

const databaseWeightState = {
  wet: "wet",
  "standard-drained": "standard_drained",
  dewatered: "dewatered",
} as const;

const databaseMeasurementMethod = {
  scale: "scale",
  "ai-estimate": "calibrated_photo",
  "manual-band": "manual_estimate",
} as const;

const databaseDecision = {
  pilot: "pilot",
  "more-data": "collect_more_data",
  reject: "rejected",
} as const;

/** 菜單本身的來源獨立於剩食量測來源，避免 Demo 案件掩蓋校方菜單證據。 */
export function menuProvenanceForSource(
  source: MenuImportSource,
): "demo" | "estimated" | "official" {
  if (source === "demo") return "demo";
  if (source === "ocr") return "estimated";
  return "official";
}

export async function createEvidenceChainPayload(
  schoolId: string,
  evidenceCase: MealEvidenceCase,
) {
  const value = mealEvidenceCaseSchema.parse(evidenceCase);
  if (!UUID_PATTERN.test(value.classId))
    throw new Error(
      "校園雲端餐期需要資料庫班級識別碼；請重新選擇目前學校的班級後再保存。",
    );
  const clientCaseId = await deterministicUuid(
    `${schoolId}|evidence-case|${value.id}`,
  );
  const menuVersionId = await deterministicUuid(
    `${schoolId}|menu|${value.servedOn}|${value.menuVersion.mealPeriod}|1`,
  );
  const mealBatchId = await deterministicUuid(
    `${schoolId}|meal-batch|${value.id}`,
  );
  const mealRecordId =
    value.mealRecordId && UUID_PATTERN.test(value.mealRecordId)
      ? value.mealRecordId
      : await deterministicUuid(`${schoolId}|meal-record|${value.id}`);
  const linkedValue = linkEvidenceCaseToMealRecord(value, mealRecordId);
  const mealRecord = evidenceCaseToMealRecord(linkedValue, mealRecordId);
  const menuProvenance = menuProvenanceForSource(
    value.menuVersion.sourceEvidence.source,
  );
  const menuItems = await Promise.all(
    value.menuVersion.plannedDishes.map(async (dish, index) => ({
      id: await deterministicUuid(
        `${schoolId}|menu-item|${menuVersionId}|${index}`,
      ),
      sort_order: index,
      display_name: dish.rawName,
      normalized_name: dish.normalizedName,
      category: dish.category,
      preparation_method: dish.cookingMethod,
      standard_portion_g: dish.portionG ?? undefined,
      weight_basis: dish.portionG === null ? undefined : "ready_to_eat",
      status: "confirmed",
      provenance: menuProvenance,
    })),
  );
  const itemIdByCategory = new Map<string, string>();
  value.menuVersion.plannedDishes.forEach((dish, index) => {
    if (!itemIdByCategory.has(dish.category))
      itemIdByCategory.set(dish.category, menuItems[index].id);
  });
  const unservedG = value.measurements.reduce(
    (sum, item) => sum + (item.source === "unserved-edible" ? item.netG : 0),
    0,
  );
  const contexts = await Promise.all(
    [
      {
        key: "attendance",
        context_type: "attendance",
        context_value: {
          planned_diners: value.plannedDiners,
          actual_diners: value.actualDiners,
          observed_diners: value.observedDiners,
          plate_sample_supply_g: value.plateSampleSupplyG,
        },
      },
      {
        key: "operation",
        context_type: "operational",
        context_value: {
          feedback_schema_version: value.feedbackSchemaVersion,
          reason_collection_status: value.reasonCollectionStatus,
          reason_counts: value.reasonCounts,
          delivery_status: value.teacherContext.deliveryStatus,
          temperature_status: value.teacherContext.temperatureStatus,
          delivery_delay_minutes: value.teacherContext.deliveryDelayMinutes,
          temperature_concern: value.teacherContext.temperatureConcern,
          note: value.teacherContext.note,
        },
      },
      ...(value.teacherContext.specialEvent
        ? [
            {
              key: "activity",
              context_type: "activity",
              context_value: {
                event: value.teacherContext.specialEvent,
              },
            },
          ]
        : []),
    ].map(async (context) => ({
      id: await deterministicUuid(
        `${schoolId}|evidence-context|${value.id}|${context.key}`,
      ),
      context_type: context.context_type,
      context_value: context.context_value,
      observed_at: value.updatedAt,
      status:
        context.key === "operation" &&
        (value.reasonCollectionStatus !== "collected" ||
          value.teacherContext.deliveryStatus !== "recorded" ||
          value.teacherContext.temperatureStatus !== "recorded")
          ? "recorded"
          : "confirmed",
      source_reference: `FoodLens evidence case ${value.id}`,
      provenance: value.sourceKind,
    })),
  );
  const supportedReasons = new Set([
    "portion",
    "taste",
    "texture",
    "temperature",
    "time",
    "nutrition",
    "other",
  ]);
  const reasonBuckets = Object.entries(value.reasonCounts).reduce(
    (buckets, [reason, count]) => {
      if (
        value.reasonCollectionStatus !== "collected" ||
        count === null ||
        count <= 0
      )
        return buckets;
      const reasonCode = supportedReasons.has(reason) ? reason : "other";
      const current = buckets.get(reasonCode) ?? {
        count: 0,
        sourceKeys: [] as string[],
      };
      current.count += count;
      current.sourceKeys.push(reason);
      buckets.set(reasonCode, current);
      return buckets;
    },
    new Map<string, { count: number; sourceKeys: string[] }>(),
  );
  const feedback = await Promise.all(
    [...reasonBuckets.entries()].map(async ([reason, bucket]) => ({
      id: await deterministicUuid(
        `${schoolId}|evidence-feedback|${value.id}|${reason}`,
      ),
      actor_role: "student",
      reason_code: reason,
      response_count: bucket.count,
      note: `班級匿名主要原因彙整；不含姓名、學號或座號。來源代碼：${bucket.sourceKeys.join("、")}`,
      status: "reviewed",
      provenance: value.sourceKind,
    })),
  );
  const measurements = await Promise.all(
    value.measurements.map(async (item, index) => {
      const provenance =
        value.sourceKind === "demo"
          ? "demo"
          : item.method === "scale"
            ? "measured"
            : "estimated";
      return {
        id: await deterministicUuid(
          `${schoolId}|evidence-measurement|${value.id}|${item.id}|${index}`,
        ),
        menu_item_id: item.foodCategory
          ? itemIdByCategory.get(item.foodCategory)
          : undefined,
        waste_source: databaseWasteSource[item.source],
        measurement_method: databaseMeasurementMethod[item.method],
        weight_state: databaseWeightState[item.drainage],
        net_weight_g: item.netG,
        tare_weight_g: item.tareG,
        gross_weight_g: item.grossG,
        estimate_low_g:
          provenance === "estimated"
            ? Math.max(0, Math.round(item.netG * 0.8))
            : undefined,
        estimate_high_g:
          provenance === "estimated" ? Math.round(item.netG * 1.2) : undefined,
        contamination_g: 0,
        sample_plate_count:
          item.source === "plate-edible" ? value.observedDiners : undefined,
        measured_at: value.updatedAt,
        status: "confirmed",
        provenance,
        note: item.note ?? `FoodLens ${item.source} 分流量測`,
      };
    }),
  );
  const humanDecision = value.humanDecision
    ? {
        id: await deterministicUuid(
          `${schoolId}|evidence-decision|${value.id}|${value.humanDecision.cardId}`,
        ),
        recommendation_kind: "responsibility_card",
        recommendation_key: value.humanDecision.cardId,
        decision: databaseDecision[value.humanDecision.choice],
        rationale: value.humanDecision.rationale,
        decided_by_role: value.humanDecision.decidedByRole,
        status: "active",
        provenance: value.sourceKind,
        decided_at: value.humanDecision.decidedAt,
      }
    : undefined;
  const plannedDishes = value.menuVersion.plannedDishes
    .map((dish) => dish.rawName.trim())
    .join("、");
  return {
    school_id: schoolId,
    client_case_id: clientCaseId,
    audit_payload: linkedValue,
    menu_version: {
      id: menuVersionId,
      service_date: value.servedOn,
      meal_period: value.menuVersion.mealPeriod,
      version_number: 1,
      title: boundedText(plannedDishes, 200),
      source_system: value.menuVersion.sourceEvidence.source,
      source_reference:
        value.menuVersion.sourceEvidence.sourceName ??
        value.menuVersion.signature,
      status: "confirmed",
      provenance: menuProvenance,
      confirmed_at: value.menuVersion.confirmation?.reviewedAt,
    },
    menu_items: menuItems,
    meal_record: {
      id: mealRecord.id,
      class_id: mealRecord.classId,
      served_on: mealRecord.servedOn,
      meal_period: mealRecord.mealPeriod,
      staple: mealRecord.staple,
      main_dish: mealRecord.mainDish,
      side_dishes: mealRecord.sideDishes,
      menu_signature: mealRecord.menuSignature,
      planned_people: mealRecord.plannedPeople,
      actual_people: mealRecord.actualPeople,
      total_supply_g: mealRecord.totalSupplyG,
      leftover_g: mealRecord.leftoverG,
      measurement_method: mealRecord.measurementMethod,
      notes: mealRecord.notes,
      source: mealRecord.source === "demo" ? "manual" : mealRecord.source,
      created_at: mealRecord.createdAt,
      updated_at: mealRecord.updatedAt,
    },
    meal_batch: {
      id: mealBatchId,
      meal_record_id: mealRecordId,
      class_id: value.classId,
      service_date: value.servedOn,
      meal_period: value.menuVersion.mealPeriod,
      status: "closed",
      planned_people: value.plannedDiners,
      notified_people: undefined,
      actual_people: value.actualDiners,
      planned_supply_g: undefined,
      produced_weight_g: undefined,
      delivered_weight_g: undefined,
      served_weight_g: Math.max(0, value.suppliedEdibleG - unservedG),
      weight_basis: "ready_to_eat",
      provenance: value.sourceKind,
    },
    contexts,
    feedback,
    measurements,
    human_decision: humanDecision,
  };
}

export class SupabaseRepository implements FoodLensRepository {
  private client: SupabaseClient;
  private schoolId?: string;
  constructor(client = createSupabaseBrowserClient()) {
    this.client = client;
  }
  private async requireFeedbackContract() {
    const { data, error } = await this.client.rpc(
      "foodlens_feedback_contract_version",
    );
    if (error || data !== 2)
      throw new Error(
        "校園資料庫尚未支援回饋收集狀態 v2；請由管理員完成資料庫更新後重試。本機示範不受影響。",
      );
  }
  private async requireMealSafetyContract() {
    const { data, error } = await this.client.rpc(
      "foodlens_meal_safety_contract_version",
    );
    if (error || data !== 1)
      throw new Error(
        "校園資料庫尚未支援逐餐安全觀察 v1；請由管理員完成資料庫更新後重試。本機示範不受影響。",
      );
  }
  private async school() {
    if (this.schoolId) return this.schoolId;
    const {
      data: { user },
      error,
    } = await this.client.auth.getUser();
    if (error || !user) throw new Error("請先使用教師 Email 登入");
    const { data, error: membershipError } = await this.client
      .from("memberships")
      .select("school_id,role")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(2);
    if (membershipError) throw membershipError;
    if (!data?.length) throw new Error("此帳號尚未加入任何學校");
    if (data.length > 1)
      throw new Error(
        "此帳號加入多所學校；執行正式資料前，請先由管理員設定單一 FoodLens 工作區。",
      );
    if (!["teacher", "admin"].includes(s(data[0].role)))
      throw new Error(
        "此帳號目前只有檢視權限；FoodLens 正式工作區僅開放教師或管理員操作。",
      );
    this.schoolId = s(data[0].school_id);
    return this.schoolId;
  }
  private async selectSnapshotRows(table: SnapshotTable, schoolId: string) {
    const rows: Row[] = [];
    for (let from = 0; ; from += SNAPSHOT_PAGE_SIZE) {
      const { data, error } = await this.client
        .from(table)
        .select("*")
        .eq("school_id", schoolId)
        .order(snapshotOrderColumn[table])
        .range(from, from + SNAPSHOT_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Row[];
      rows.push(...page);
      if (page.length < SNAPSHOT_PAGE_SIZE) return rows;
    }
  }
  private async signedPlateImages(scanRows: Row[]) {
    const paths = [
      ...new Set(scanRows.map((row) => s(row.image_path)).filter(Boolean)),
    ];
    const result = new Map<
      string,
      { imageUrl?: string; imageLoadError?: string }
    >();
    const bucket = this.client.storage.from("plate-images");
    for (let start = 0; start < paths.length; start += SIGNED_URL_BATCH_SIZE) {
      const batch = paths.slice(start, start + SIGNED_URL_BATCH_SIZE);
      const { data, error } = await bucket.createSignedUrls(
        batch,
        PLATE_IMAGE_SIGNED_URL_TTL_SECONDS,
      );
      if (error) {
        batch.forEach((path) =>
          result.set(path, {
            imageLoadError: `圖片授權暫時失敗：${error.message}`,
          }),
        );
        continue;
      }
      const items = (data ?? []) as Array<{
        path?: string;
        signedUrl?: string | null;
        error?: string | null;
      }>;
      batch.forEach((path, index) => {
        const item = items.find((value) => value.path === path) ?? items[index];
        result.set(
          path,
          item?.signedUrl
            ? { imageUrl: item.signedUrl }
            : {
                imageLoadError: `圖片授權暫時失敗：${item?.error ?? "沒有收到有效網址"}`,
              },
        );
      });
    }
    return result;
  }
  async getSnapshot(): Promise<AppSnapshot> {
    const schoolId = await this.school();
    await this.requireFeedbackContract();
    await this.requireMealSafetyContract();
    const results = await Promise.all(
      snapshotTables.map((table) => this.selectSnapshotRows(table, schoolId)),
    );
    const [
      classRows,
      mealRows,
      scanRows,
      detectionRows,
      correctionRows,
      predictionRows,
      experimentRows,
      evidenceBatchRows,
      mealSafetyRows,
      collectionRows,
      receiptRows,
      researchRows,
      settingsRows,
      profileRows,
    ] = results;
    const signedImages = await this.signedPlateImages(scanRows);
    const scans = scanRows.map((row) => {
      const path = s(row.image_path);
      const image = path ? signedImages.get(path) : undefined;
      return {
        id: s(row.id),
        mealRecordId: s(row.meal_record_id),
        imageUrl: image?.imageUrl,
        imagePath: path || undefined,
        imageLoadError: image?.imageLoadError,
        contentSha256: s(row.content_sha256) || undefined,
        analysisKind: persistedPlateScanAnalysisKind(row.analysis_kind),
        menuContext: persistedPlateScanMenuContext(row),
        provider: s(row.provider),
        model: s(row.model),
        schemaVersion: "1" as const,
        status:
          s(row.status) === "failed"
            ? ("failed" as const)
            : ("confirmed" as const),
        reviewedAt: s(row.reviewed_at),
        createdAt: s(row.created_at),
      };
    });
    const setting = settingsRows[0];
    const profile = profileRows[0];
    const evidenceCaseIdByBatchId = new Map(
      evidenceBatchRows
        .map((row) => [s(row.id), auditEvidenceCaseId(row)] as const)
        .filter((entry) => entry[0] && entry[1]),
    );
    const collectionEvents = collectionRows.map((row) => {
      const evidenceCaseId = evidenceCaseIdByBatchId.get(s(row.meal_batch_id));
      if (!evidenceCaseId)
        throw new Error(
          `清運事件 ${s(row.id)} 找不到可稽核的餐期證據；請由管理員檢查資料關聯。`,
        );
      return collectionEventFromRow(row, evidenceCaseId);
    });
    const snapshot: AppSnapshot = {
      classes: classRows.map((row) => ({
        id: s(row.id),
        name: s(row.name),
        grade: n(row.grade) === 6 ? (6 as const) : (5 as const),
        active: Boolean(row.active),
      })),
      meals: mealRows.map((row) => ({
        id: s(row.id),
        classId: s(row.class_id),
        servedOn: s(row.served_on),
        mealPeriod: "lunch" as const,
        staple: s(row.staple),
        mainDish: s(row.main_dish),
        sideDishes: list(row.side_dishes),
        menuSignature: s(row.menu_signature),
        plannedPeople: n(row.planned_people),
        actualPeople: n(row.actual_people),
        totalSupplyG: n(row.total_supply_g),
        leftoverG: n(row.leftover_g),
        measurementMethod: (s(row.measurement_method) || "manual") as
          "scale" | "manual" | "sample-extrapolation" | "ai-estimate",
        notes: s(row.notes),
        source: (s(row.source) || "manual") as "demo" | "manual" | "import",
        createdAt: s(row.created_at),
        updatedAt: s(row.updated_at),
      })),
      scans,
      detections: detectionRows.map((row) => ({
        id: s(row.id),
        scanId: s(row.scan_id),
        category: category(row.category),
        label: s(row.label),
        aiOriginalG: n(row.ai_original_g),
        aiRemainingRatio: n(row.ai_remaining_ratio),
        aiRemainingG: n(row.ai_remaining_g),
        confidence: n(row.confidence),
        sortOrder: n(row.sort_order),
      })),
      corrections: correctionRows.map((row) => ({
        id: s(row.id),
        detectionId: s(row.detection_id),
        correctedCategory: category(row.corrected_category),
        correctedLabel: s(row.corrected_label),
        correctedOriginalG: n(row.corrected_original_g),
        correctedRemainingRatio: n(row.corrected_remaining_ratio),
        correctedRemainingG: n(row.corrected_remaining_g),
        note: s(row.note),
        correctedAt: s(row.corrected_at),
      })),
      predictions: predictionRows.map((row) => ({
        id: s(row.id),
        createdAt: s(row.created_at),
        plannedPeople: n(row.planned_people),
        menuName: s(row.menu_name),
        plannedSupplyG: n(row.planned_supply_g),
        recommendedSupplyG: n(row.recommended_supply_g),
        averageLeftoverRate: n(row.average_leftover_rate),
        possibleSavingG: n(row.possible_saving_g),
        possibleSavingTwd: n(row.possible_saving_twd),
        confidence: s(row.confidence) as SupplyPrediction["confidence"],
        matchLevel: s(row.match_level) as SupplyPrediction["matchLevel"],
        sampleSize: n(row.sample_size),
        independentDateCount: n(row.independent_date_count),
        evidenceMealIds: list(row.evidence_meal_ids),
        historyStart: s(row.history_start) || undefined,
        historyEnd: s(row.history_end) || undefined,
        reason: s(row.reason),
        algorithmVersion: "foodlens-v1" as const,
      })),
      experiments: experimentRows.map((row) => {
        const description = decodeExperimentDescription(
          s(row.intervention_description),
        );
        return {
          id: s(row.id),
          title: s(row.title),
          baselineStart: s(row.baseline_start),
          baselineEnd: s(row.baseline_end),
          interventionStart: s(row.intervention_start),
          interventionEnd: s(row.intervention_end),
          classId: s(row.class_id) || undefined,
          ...description,
          linkedPredictionId: s(row.linked_prediction_id) || undefined,
          createdAt: s(row.created_at),
        };
      }),
      evidenceCases: evidenceCasesFromRows(evidenceBatchRows),
      mealSafetyObservations: mealSafetyObservationsFromRows(mealSafetyRows),
      collectionEvents,
      destinationReceipts: receiptRows.map(destinationReceiptFromRow),
      researchSections: researchRows.map((row) => ({
        id: s(row.id),
        slug: s(row.slug),
        title: s(row.title),
        bodyMarkdown: s(row.body_markdown),
        sortOrder: n(row.sort_order),
        isPublished: Boolean(row.is_published),
        updatedAt: s(row.updated_at),
      })),
      impactSettings: {
        id: "default",
        costTwdPerKg:
          setting?.cost_twd_per_kg === null ||
          setting?.cost_twd_per_kg === undefined
            ? 80
            : n(setting.cost_twd_per_kg),
        schoolDailyBaselineG: n(setting?.school_daily_baseline_g),
        schoolDaysPerWeek: n(setting?.school_days_per_week) || 5,
        weeksPerSemester: n(setting?.weeks_per_semester) || 20,
        semestersPerYear: n(setting?.semesters_per_year) || 2,
        co2eFactor: setting?.co2e_factor ? n(setting.co2e_factor) : undefined,
        sourceTitle: s(setting?.source_title) || undefined,
        sourceUrl: s(setting?.source_url) || undefined,
        retrievedAt: s(setting?.retrieved_at) || undefined,
        disclaimer: s(setting?.disclaimer) || "所有結果皆為估算。",
        updatedAt: s(setting?.updated_at),
      },
      profile: {
        id: "default",
        projectName: s(profile?.project_name) || "FoodLens 食光偵探",
        subtitle: s(profile?.subtitle) || "AI 校園剩食分析與智慧供餐系統",
        schoolName: s(profile?.school_name),
        teamName: s(profile?.team_name),
        teamMembers: s(profile?.team_members),
        researchPeriod: s(profile?.research_period),
        aiDisclosure: s(profile?.ai_disclosure),
        privacyContact: s(profile?.privacy_contact) || undefined,
        dataRetentionDays:
          profile?.data_retention_days === null ||
          profile?.data_retention_days === undefined
            ? undefined
            : n(profile.data_retention_days),
        governanceReviewedAt: s(profile?.governance_reviewed_at) || undefined,
        updatedAt: s(profile?.updated_at),
      },
    };
    validateMealSafetyHistory(snapshot.mealSafetyObservations, snapshot.meals);
    return snapshot;
  }
  async confirmScan(command: ConfirmScanCommand) {
    const schoolId = await this.school();
    const menuContext = validatedPlateScanMenuContext(command.menuContext);
    const menuContextAssertion =
      createPlateScanMenuContextAssertion(menuContext);
    const correctionNotesPayload = createPlateScanCorrectionNotesPayload(
      command.correctionNotes,
      command.corrections.length,
    );
    if (menuContext && command.analysis.provider === "human-manual")
      throw new Error("人工判讀不會保存為 AI 菜單候選脈絡");
    if (
      !command.meal.id &&
      command.meal.measurementMethod !== "scale" &&
      command.meal.measurementMethod !== "manual"
    )
      throw new Error(
        "新餐期的全班剩食重量必須來自秤重或人工登錄；抽樣外推只能由已保存的餐期證據鏈建立。",
      );
    const requestId = command.clientRequestId;
    let imagePath: string | undefined;
    let imageSha256: string | undefined;
    let uploadedNewImage = false;
    if (command.imageBlob) {
      imageSha256 = await sha256Hex(await command.imageBlob.arrayBuffer());
      const servedYear = command.meal.servedOn.slice(0, 4);
      imagePath = `${schoolId}/${servedYear}/${requestId}-${imageSha256}.webp`;
      const { error } = await this.client.storage
        .from("plate-images")
        .upload(imagePath, command.imageBlob, {
          contentType: "image/webp",
          upsert: false,
        });
      const statusCode = String(
        (error as { statusCode?: string | number } | null)?.statusCode ?? "",
      );
      const isExistingImage =
        error &&
        (statusCode === "409" ||
          /already exists|duplicate/i.test(error.message));
      if (error && !isExistingImage) throw error;
      uploadedNewImage = !error;
    }
    const scanContent = {
      image_sha256: imageSha256 ?? null,
      meal: {
        id: command.meal.id,
        class_id: command.meal.classId,
        served_on: command.meal.servedOn,
        staple: command.meal.staple,
        main_dish: command.meal.mainDish,
        side_dishes: command.meal.sideDishes,
        planned_people: command.meal.plannedPeople,
        actual_people: command.meal.actualPeople,
        total_supply_g: command.meal.totalSupplyG,
        leftover_g: command.meal.leftoverG,
        measurement_method: command.meal.measurementMethod,
        notes: command.meal.notes,
        source: command.meal.source,
      },
      analysis: command.analysis,
      ...(menuContextAssertion
        ? {
            menu_context_assertion: menuContextAssertion,
          }
        : {}),
      corrections: command.corrections,
      ...correctionNotesPayload,
    };
    const encodedContent = new TextEncoder().encode(stableJson(scanContent));
    const contentSha256 = await sha256Hex(encodedContent.buffer as ArrayBuffer);
    const { data, error } = await this.client.rpc("confirm_scan", {
      payload: {
        school_id: schoolId,
        client_request_id: requestId,
        image_path: imagePath ?? null,
        content_sha256: contentSha256,
        ...scanContent,
      },
    });
    if (error) {
      const isIdempotencyConflict =
        error.code === "23505" && /idempotency key/i.test(error.message ?? "");
      if (isIdempotencyConflict) {
        if (uploadedNewImage && imagePath) {
          await this.client.storage.from("plate-images").remove([imagePath]);
        }
        throw new Error(
          "同一送出識別碼已保存另一份內容；請先到每日紀錄確認，再將新餐盤另行送出。",
        );
      }
      const recovery = await this.client
        .from("plate_scans")
        .select("id,meal_record_id,content_sha256")
        .eq("school_id", schoolId)
        .eq("client_request_id", requestId)
        .maybeSingle();
      if (recovery.data?.content_sha256 === contentSha256)
        return {
          mealId: s(recovery.data.meal_record_id),
          scanId: s(recovery.data.id),
        };
      if (recovery.data) {
        if (uploadedNewImage && imagePath) {
          await this.client.storage.from("plate-images").remove([imagePath]);
        }
        throw new Error(
          "同一送出識別碼已保存另一份內容；請先到每日紀錄確認，再將新餐盤另行送出。",
        );
      }
      if (!recovery.error && uploadedNewImage && imagePath)
        await this.client.storage.from("plate-images").remove([imagePath]);
      throw error;
    }
    const value = data as Row;
    return { mealId: s(value.meal_id), scanId: s(value.scan_id) };
  }
  async savePrediction(value: SupplyPrediction) {
    const schoolId = await this.school();
    const { error } = await this.client.from("supply_predictions").upsert(
      {
        id: value.id,
        school_id: schoolId,
        planned_people: value.plannedPeople,
        menu_name: value.menuName,
        planned_supply_g: value.plannedSupplyG,
        recommended_supply_g: value.recommendedSupplyG,
        average_leftover_rate: value.averageLeftoverRate,
        possible_saving_g: value.possibleSavingG,
        possible_saving_twd: value.possibleSavingTwd,
        confidence: value.confidence,
        match_level: value.matchLevel,
        sample_size: value.sampleSize,
        independent_date_count: value.independentDateCount,
        evidence_meal_ids: value.evidenceMealIds,
        history_start: value.historyStart,
        history_end: value.historyEnd,
        reason: value.reason,
        algorithm_version: value.algorithmVersion,
      },
      { onConflict: "school_id,id" },
    );
    if (error) throw error;
  }
  async saveExperiment(value: ImprovementExperiment) {
    const schoolId = await this.school();
    const { error } = await this.client.from("experiments").upsert(
      {
        id: value.id,
        school_id: schoolId,
        title: value.title,
        baseline_start: value.baselineStart,
        baseline_end: value.baselineEnd,
        intervention_start: value.interventionStart,
        intervention_end: value.interventionEnd,
        class_id: value.classId,
        intervention_description: encodeExperimentDescription(value),
        linked_prediction_id: value.linkedPredictionId,
      },
      { onConflict: "school_id,id" },
    );
    if (error) throw error;
  }
  async saveEvidenceCase(value: MealEvidenceCase) {
    const schoolId = await this.school();
    await this.requireFeedbackContract();
    const payload = await createEvidenceChainPayload(schoolId, value);
    const { error } = await this.client.rpc("save_meal_evidence_chain", {
      payload,
    });
    if (error) throw error;
    return { mealRecordId: payload.meal_record.id };
  }
  async saveMealSafetyObservation(value: MealSafetyObservation): Promise<void> {
    const schoolId = await this.school();
    await this.requireMealSafetyContract();
    const observation = mealSafetyObservationSchema.parse(value);
    if (observation.provenance !== "school-record")
      throw new Error(
        "校園雲端只接受正式逐餐安全觀察；示範資料請留在本機模式。",
      );
    try {
      const { error } = await this.client.rpc("save_meal_safety_observation", {
        p_school_id: schoolId,
        p_observation: observation,
      });
      if (error) throw error;
    } catch (error) {
      throw mealSafetySaveError(error);
    }
  }
  async saveCollectionEvent(value: CollectionEvent) {
    const schoolId = await this.school();
    const input = collectionEventSchema.parse(value);
    if (input.provenance !== "official")
      throw new Error(
        "校園雲端只接受明確標示為正式登錄的清運資料；示範與估算資料請留在本機模式。",
      );
    const id = UUID_PATTERN.test(input.id)
      ? input.id
      : await deterministicUuid(`${schoolId}|collection-event|${input.id}`);
    const mealBatchId =
      input.mealBatchId && UUID_PATTERN.test(input.mealBatchId)
        ? input.mealBatchId
        : await deterministicUuid(
            `${schoolId}|meal-batch|${input.evidenceCaseId}`,
          );
    const batchResult = await this.client
      .from("meal_batches")
      .select("id,audit_payload")
      .eq("school_id", schoolId)
      .eq("id", mealBatchId)
      .maybeSingle();
    if (batchResult.error) throw batchResult.error;
    if (
      !batchResult.data ||
      auditEvidenceCaseId(batchResult.data as Row) !== input.evidenceCaseId
    )
      throw new Error(
        "找不到這筆清運事件所屬的正式餐期證據；請先在午餐任務台完成並保存該餐期。",
      );
    const normalized = collectionEventSchema.parse({
      ...input,
      id,
      mealBatchId,
    });
    const existingResult = await this.client
      .from("collection_events")
      .select("*")
      .eq("school_id", schoolId)
      .eq("id", id)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (existingResult.data) {
      const existing = collectionEventFromRow(
        existingResult.data as Row,
        input.evidenceCaseId,
      );
      if (sameCollectionEventMaterial(existing, normalized)) return;
      upsertCollectionEvent([existing], normalized);
    }
    const { error } = await this.client
      .from("collection_events")
      .upsert(
        createCollectionEventRow(schoolId, normalized, { id, mealBatchId }),
        { onConflict: "school_id,id" },
      );
    if (
      error?.code === "23505" &&
      /waste source|unique_source_route/i.test(error.message ?? "")
    )
      throw new Error(
        "同一餐期的其中一個分流來源已在其他有效清運安排中；請改選尚未分派的來源。",
      );
    if (error) throw error;
  }
  async saveDestinationReceipt(value: DestinationReceipt) {
    const schoolId = await this.school();
    const input = destinationReceiptSchema.parse(value);
    if (input.provenance !== "official")
      throw new Error(
        "校園雲端只接受具正式來源的處理場收據；示範收據請留在本機模式。",
      );
    if (!UUID_PATTERN.test(input.collectionEventId))
      throw new Error("處理場收據需要已保存的正式清運事件");
    const collectionResult = await this.client
      .from("collection_events")
      .select("*")
      .eq("school_id", schoolId)
      .eq("id", input.collectionEventId)
      .maybeSingle();
    if (collectionResult.error) throw collectionResult.error;
    if (!collectionResult.data)
      throw new Error("找不到這張收據所屬的正式清運事件");
    if (s(collectionResult.data.status) !== "collected")
      throw new Error("尚未完成校方與清運單位交接，不能登錄處理場收據");
    const collectedAt = s(collectionResult.data.collected_at);
    if (collectedAt && Date.parse(input.receivedAt) < Date.parse(collectedAt))
      throw new Error("處理場收料時間不可早於校方清運交接時間");
    const id = UUID_PATTERN.test(input.id)
      ? input.id
      : await deterministicUuid(`${schoolId}|destination-receipt|${input.id}`);
    const normalized = destinationReceiptSchema.parse({ ...input, id });
    let verifiedBy: string | null = null;
    if (normalized.status === "verified") {
      const userResult = await this.client.auth.getUser();
      if (userResult.error || !userResult.data.user)
        throw new Error("核驗收據前請重新登入教師或管理員帳號");
      verifiedBy = userResult.data.user.id;
    }
    const existingResult = await this.client
      .from("destination_receipts")
      .select("*")
      .eq("school_id", schoolId)
      .eq("id", id)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    if (existingResult.data) {
      const existing = destinationReceiptFromRow(existingResult.data as Row);
      if (
        sameDestinationReceiptMaterial(existing, normalized) &&
        (normalized.status !== "verified" || existing.verifiedBy === verifiedBy)
      )
        return;
      upsertDestinationReceipt([existing], normalized);
    }
    const { error } = await this.client
      .from("destination_receipts")
      .upsert(
        createDestinationReceiptRow(schoolId, normalized, { id, verifiedBy }),
        { onConflict: "school_id,id" },
      );
    if (error) throw error;
  }
  async updateSettings(value: ImpactSettings) {
    const schoolId = await this.school();
    const { error } = await this.client.from("impact_settings").upsert({
      school_id: schoolId,
      cost_twd_per_kg: value.costTwdPerKg,
      school_daily_baseline_g: value.schoolDailyBaselineG,
      school_days_per_week: value.schoolDaysPerWeek,
      weeks_per_semester: value.weeksPerSemester,
      semesters_per_year: value.semestersPerYear,
      co2e_factor: value.co2eFactor,
      source_title: value.sourceTitle,
      source_url: value.sourceUrl,
      retrieved_at: value.retrievedAt,
      disclaimer: value.disclaimer,
    });
    if (error) throw error;
  }
  async updateProfile(value: ProjectProfile) {
    const schoolId = await this.school();
    const { error } = await this.client.from("project_profiles").upsert({
      school_id: schoolId,
      project_name: value.projectName,
      subtitle: value.subtitle,
      school_name: value.schoolName,
      team_name: value.teamName,
      team_members: value.teamMembers,
      research_period: value.researchPeriod,
      ai_disclosure: value.aiDisclosure,
      privacy_contact: value.privacyContact?.trim() || null,
      data_retention_days: value.dataRetentionDays ?? null,
      governance_reviewed_at: value.governanceReviewedAt?.trim() || null,
    });
    if (error) throw error;
  }
  async upsertClass(value: SchoolClass) {
    const schoolId = await this.school();
    const { error } = await this.client.from("classes").upsert(
      {
        id: value.id,
        school_id: schoolId,
        name: value.name,
        grade: value.grade,
        active: value.active,
      },
      { onConflict: "school_id,id" },
    );
    if (error) throw error;
  }
  async updateResearchSection(value: ResearchSection) {
    const schoolId = await this.school();
    const { error } = await this.client.from("research_sections").upsert(
      {
        id: value.id,
        school_id: schoolId,
        slug: value.slug,
        title: value.title,
        body_markdown: value.bodyMarkdown,
        sort_order: value.sortOrder,
        is_published: value.isPublished,
      },
      { onConflict: "school_id,id" },
    );
    if (error) throw error;
  }
  async importMealRecords(records: MealRecord[]) {
    if (!records.length) return 0;
    const schoolId = await this.school();
    const [existingResult, scanResult] = await Promise.all([
      this.client.from("meal_records").select("*").eq("school_id", schoolId),
      this.client
        .from("plate_scans")
        .select("meal_record_id")
        .eq("school_id", schoolId),
    ]);
    if (existingResult.error) throw existingResult.error;
    if (scanResult.error) throw scanResult.error;
    const existingRows = (existingResult.data ?? []) as Row[];
    const existingIds = new Set(existingRows.map((row) => s(row.id)));
    const existingById = new Map(existingRows.map((row) => [s(row.id), row]));
    const scannedMealIds = new Set(
      ((scanResult.data ?? []) as Row[]).map((row) => s(row.meal_record_id)),
    );
    const rows = await Promise.all(
      records.map(async (value) => {
        const importedId =
          UUID_PATTERN.test(value.id) && existingIds.has(value.id)
            ? value.id
            : await deterministicUuid(
                `${schoolId}|${value.classId}|${value.servedOn}|${value.menuSignature}`,
              );
        const existing = existingById.get(importedId);
        if (
          existing &&
          scannedMealIds.has(importedId) &&
          !hasSameMealEvidence(
            {
              classId: s(existing.class_id),
              servedOn: s(existing.served_on),
              mealPeriod: "lunch",
              staple: s(existing.staple),
              mainDish: s(existing.main_dish),
              sideDishes: list(existing.side_dishes),
              menuSignature: s(existing.menu_signature),
              plannedPeople: n(existing.planned_people),
              actualPeople: n(existing.actual_people),
              totalSupplyG: n(existing.total_supply_g),
              leftoverG: n(existing.leftover_g),
              measurementMethod: (s(existing.measurement_method) ||
                "manual") as MealRecord["measurementMethod"],
            },
            value,
          )
        )
          throw new Error(
            `餐期 ${value.id} 已有餐盤判讀，不能用 CSV 改寫日期、班級、菜單、人數或秤重；請改用新的餐期 ID。`,
          );
        return {
          id: importedId,
          school_id: schoolId,
          class_id: value.classId,
          served_on: value.servedOn,
          meal_period: "lunch",
          staple: value.staple,
          main_dish: value.mainDish,
          side_dishes: value.sideDishes,
          menu_signature: value.menuSignature,
          planned_people: value.plannedPeople,
          actual_people: value.actualPeople,
          total_supply_g: value.totalSupplyG,
          leftover_g: value.leftoverG,
          measurement_method: value.measurementMethod,
          notes: value.notes,
          source: "import",
        };
      }),
    );
    for (let start = 0; start < rows.length; start += 200) {
      const { error } = await this.client
        .from("meal_records")
        .upsert(rows.slice(start, start + 200), {
          onConflict: "school_id,id",
        });
      if (error) throw error;
    }
    return records.length;
  }
  async initializeSchoolWorkspace(template: AppSnapshot) {
    const schoolId = await this.school();
    const classRows = template.classes.map((item) => ({
      school_id: schoolId,
      name: item.name,
      grade: item.grade,
      active: item.active,
    }));
    const { error: classError } = await this.client
      .from("classes")
      .upsert(classRows, { onConflict: "school_id,name" });
    if (classError) throw classError;

    const researchRows = template.researchSections.map((item) => ({
      id: `${schoolId}:${item.slug}`,
      school_id: schoolId,
      slug: item.slug,
      title: item.title,
      body_markdown: item.bodyMarkdown,
      sort_order: item.sortOrder,
      is_published: item.isPublished,
    }));
    const { error: researchError } = await this.client
      .from("research_sections")
      .upsert(researchRows, { onConflict: "school_id,slug" });
    if (researchError) throw researchError;

    await this.updateSettings(template.impactSettings);
    await this.updateProfile({
      ...template.profile,
      schoolName: "請填寫實際學校名稱",
      teamName: "請填寫團隊名稱",
      teamMembers: "請填寫參選者",
    });
  }
  async replaceSnapshot() {
    throw new Error(
      "整份 JSON 還原只開放本機 Demo，校園資料請使用 CSV 匯入流程。",
    );
  }
  async resetDemo() {
    throw new Error("校園雲端資料不可用 Demo Reset 重設。");
  }

  async previewDataRetention(retentionDays: number) {
    const schoolId = await this.school();
    const { data, error } = await this.client.rpc("preview_data_retention", {
      target_school: schoolId,
      retention_days: retentionDays,
    });
    if (error) throw error;
    return retentionPreview(data as Row);
  }

  async executeDataRetention(retentionDays: number) {
    const response = await fetch("/api/retention/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays }),
    });
    const payload = (await response.json()) as {
      result?: Row;
      error?: string;
      requestId?: string;
    };
    if (!response.ok || !payload.result)
      throw new Error(
        `${payload.error ?? "正式資料清理未完成"}${
          payload.requestId ? `（追蹤碼 ${payload.requestId}）` : ""
        }`,
      );
    return retentionRun(payload.result);
  }

  async listDataRetentionRuns() {
    const schoolId = await this.school();
    const { data, error } = await this.client
      .from("data_retention_runs")
      .select("*")
      .eq("school_id", schoolId)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(retentionRun);
  }
}
