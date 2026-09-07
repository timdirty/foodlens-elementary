import { z } from "zod";
import {
  FOOD_CATEGORIES,
  PLATE_SCAN_ANALYSIS_KINDS,
  legacyPlateScanAnalysisKind,
  type AppSnapshot,
  type MealRecord,
  type PlateScan,
  type SchoolClass,
} from "@/lib/types";
import {
  experimentSafetyGuardrailsSchema,
  predictionDecisionTraceSchema,
} from "@/lib/experiment-decision";
import { mealEvidenceCaseSchema } from "@/lib/evidence-chain";
import {
  mealSafetyObservationSchema,
  validateMealSafetyHistory,
} from "@/lib/meal-safety";
import {
  collectionEventSchema,
  destinationReceiptSchema,
} from "@/lib/circularity";

export const BACKUP_FORMAT = "foodlens-backup" as const;
export const BACKUP_VERSION = 4 as const;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
export const MAX_BACKUP_IMAGE_BYTES = 5 * 1024 * 1024;

const BACKUP_TOO_LARGE_MESSAGE = "備份內容超過 200MB，請先移除部分照片再匯出";
const BACKUP_IMAGE_TOO_LARGE_MESSAGE = "備份中有單張圖片超過 5MB 限制";

const idSchema = z.string().trim().min(1).max(200);
const shortTextSchema = z.string().max(500);
const timestampSchema = z.string().min(1).max(64);

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期必須使用 YYYY-MM-DD")
  .refine(validDate, "日期不存在");
const nonnegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const ratioSchema = z.number().min(0).max(1);

const classSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(40),
    grade: z.union([z.literal(5), z.literal(6)]),
    active: z.boolean(),
  })
  .strict();

const mealSchema = z
  .object({
    id: idSchema,
    classId: idSchema,
    servedOn: dateSchema,
    mealPeriod: z.literal("lunch"),
    staple: z.string().trim().min(1).max(80),
    mainDish: z.string().trim().min(1).max(80),
    sideDishes: z.array(z.string().trim().min(1).max(80)).max(20),
    menuSignature: z.string().trim().min(1).max(200),
    plannedPeople: positiveInteger.max(5000),
    actualPeople: positiveInteger.max(5000),
    totalSupplyG: positiveInteger.max(10_000_000),
    leftoverG: nonnegativeInteger.max(10_000_000),
    measurementMethod: z.enum([
      "scale",
      "manual",
      "sample-extrapolation",
      "ai-estimate",
    ]),
    notes: shortTextSchema,
    source: z.enum(["demo", "manual", "import"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((meal, context) => {
    if (meal.leftoverG > meal.totalSupplyG) {
      context.addIssue({
        code: "custom",
        path: ["leftoverG"],
        message: "剩食重量不可大於供應重量",
      });
    }
  });

const serializedScanSchema = z
  .object({
    id: idSchema,
    mealRecordId: idSchema,
    imageUrl: z.string().max(3000).optional(),
    imagePath: z.string().max(3000).optional(),
    imageLoadError: z.string().max(1000).optional(),
    contentSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/i)
      .optional(),
    imageDataUrl: z
      .string()
      .max(7_200_000)
      .regex(
        /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,
        "只允許 JPEG、PNG 或 WebP 圖片資料",
      )
      .optional(),
    analysisKind: z.enum(PLATE_SCAN_ANALYSIS_KINDS),
    menuContext: z
      .object({
        menuVersionId: idSchema.max(120),
        menuVersionSignature: z.string().trim().min(1).max(160),
        candidateCount: z.number().int().min(1).max(30),
      })
      .strict()
      .nullable(),
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    schemaVersion: z.literal("1"),
    status: z.enum(["confirmed", "failed"]),
    reviewedAt: timestampSchema,
    createdAt: timestampSchema,
  })
  .strict();

const runtimeScanSchema = serializedScanSchema
  .omit({ imageDataUrl: true })
  .extend({
    imageBlob: z
      .custom<Blob>((value) => value instanceof Blob, "圖片 Blob 格式錯誤")
      .optional(),
  })
  .strict();

const detectionSchema = z
  .object({
    id: idSchema,
    scanId: idSchema,
    category: z.enum(FOOD_CATEGORIES),
    label: z.string().trim().min(1).max(80),
    aiOriginalG: positiveInteger.max(1000),
    aiRemainingRatio: ratioSchema,
    aiRemainingG: nonnegativeInteger.max(1000),
    confidence: ratioSchema,
    sortOrder: nonnegativeInteger.max(100),
  })
  .strict();

const correctionSchema = z
  .object({
    id: idSchema,
    detectionId: idSchema,
    correctedCategory: z.enum(FOOD_CATEGORIES),
    correctedLabel: z.string().trim().min(1).max(80),
    correctedOriginalG: positiveInteger.max(1000),
    correctedRemainingRatio: ratioSchema,
    correctedRemainingG: nonnegativeInteger.max(1000),
    note: shortTextSchema,
    correctedAt: timestampSchema,
  })
  .strict();

const predictionSchema = z
  .object({
    id: idSchema,
    createdAt: timestampSchema,
    plannedPeople: positiveInteger.max(5000),
    menuName: z.string().trim().min(1).max(160),
    plannedSupplyG: positiveInteger.max(10_000_000),
    recommendedSupplyG: nonnegativeInteger.max(10_000_000),
    averageLeftoverRate: ratioSchema,
    possibleSavingG: nonnegativeInteger.max(10_000_000),
    possibleSavingTwd: nonnegativeInteger.max(100_000_000),
    confidence: z.enum(["high", "medium", "low"]),
    matchLevel: z.enum(["exact", "similar", "baseline", "insufficient"]),
    sampleSize: nonnegativeInteger.max(100_000),
    independentDateCount: nonnegativeInteger.max(100_000),
    evidenceMealIds: z.array(idSchema).max(1000),
    historyStart: dateSchema.optional(),
    historyEnd: dateSchema.optional(),
    reason: z.string().max(1000),
    algorithmVersion: z.literal("foodlens-v1"),
  })
  .strict();

const experimentSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(160),
    baselineStart: dateSchema,
    baselineEnd: dateSchema,
    interventionStart: dateSchema,
    interventionEnd: dateSchema,
    classId: idSchema.optional(),
    interventionDescription: z.string().trim().min(1).max(2000),
    linkedPredictionId: idSchema.optional(),
    decisionTrace: predictionDecisionTraceSchema().optional(),
    safetyGuardrails: experimentSafetyGuardrailsSchema().optional(),
    createdAt: timestampSchema,
  })
  .strict();

const researchSchema = z
  .object({
    id: idSchema,
    slug: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(160),
    bodyMarkdown: z.string().max(100_000),
    sortOrder: nonnegativeInteger.max(1000),
    isPublished: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

const settingsSchema = z
  .object({
    id: z.literal("default"),
    costTwdPerKg: z.number().finite().nonnegative().max(100_000),
    schoolDailyBaselineG: nonnegativeInteger.max(100_000_000),
    schoolDaysPerWeek: positiveInteger.max(7),
    weeksPerSemester: positiveInteger.max(52),
    semestersPerYear: positiveInteger.max(4),
    co2eFactor: z.number().finite().nonnegative().max(100_000).optional(),
    sourceTitle: z.string().max(500).optional(),
    sourceUrl: z.string().max(3000).optional(),
    retrievedAt: dateSchema.optional(),
    disclaimer: z.string().trim().min(1).max(2000),
    updatedAt: timestampSchema,
  })
  .strict();

const profileSchema = z
  .object({
    id: z.literal("default"),
    projectName: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().min(1).max(240),
    schoolName: z.string().max(160),
    teamName: z.string().max(160),
    teamMembers: z.string().max(1000),
    researchPeriod: z.string().max(240),
    aiDisclosure: z.string().max(5000),
    privacyContact: z.string().trim().min(1).max(500).optional(),
    dataRetentionDays: z.number().int().min(1).max(3650).optional(),
    governanceReviewedAt: timestampSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict();

const serializableSnapshotSchema = z
  .object({
    classes: z.array(classSchema).max(1000),
    meals: z.array(mealSchema).max(100_000),
    scans: z.array(serializedScanSchema).max(200_000),
    detections: z.array(detectionSchema).max(2_400_000),
    corrections: z.array(correctionSchema).max(2_400_000),
    predictions: z.array(predictionSchema).max(100_000),
    experiments: z.array(experimentSchema).max(100_000),
    mealSafetyObservations: z
      .array(mealSafetyObservationSchema)
      .max(200_000)
      .default([]),
    evidenceCases: z.array(mealEvidenceCaseSchema).max(100_000).default([]),
    collectionEvents: z.array(collectionEventSchema).max(100_000).default([]),
    destinationReceipts: z
      .array(destinationReceiptSchema)
      .max(100_000)
      .default([]),
    researchSections: z.array(researchSchema).max(1000),
    impactSettings: settingsSchema,
    profile: profileSchema,
  })
  .strict();

const runtimeSnapshotSchema = serializableSnapshotSchema.extend({
  scans: z.array(runtimeScanSchema).max(200_000),
});

const backupEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.number().int().nonnegative(),
    exportedAt: timestampSchema,
    snapshot: z.unknown(),
  })
  .strict();

const backupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: timestampSchema,
    snapshot: serializableSnapshotSchema,
  })
  .strict();

type SerializableSnapshot = z.infer<typeof serializableSnapshotSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * v0 的餐期尚未儲存 menuSignature；它只能由同筆資料的主食與主菜穩定推得。
 * 其他缺欄位沒有可靠來源，因此保留原值，交給目前的嚴格快照驗證拒絕。
 */
function upgradeV0Meal(value: unknown) {
  if (!isRecord(value) || "menuSignature" in value) return value;
  const { staple, mainDish } = value;
  if (
    typeof staple !== "string" ||
    !staple.trim() ||
    typeof mainDish !== "string" ||
    !mainDish.trim()
  )
    return value;
  return {
    ...value,
    menuSignature: `${staple}|${mainDish}`.toLowerCase(),
  };
}

function upgradeV0Snapshot(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.meals)) return value;
  return {
    ...value,
    meals: value.meals.map(upgradeV0Meal),
  };
}

function upgradeLegacyScanAnalysisKind(
  value: unknown,
  replaceExisting = false,
) {
  if (!isRecord(value) || (!replaceExisting && "analysisKind" in value))
    return value;
  return {
    ...value,
    analysisKind: legacyPlateScanAnalysisKind(value.provider),
  };
}

function upgradeLegacySnapshotAnalysisKinds(
  value: unknown,
  replaceExisting = false,
) {
  if (!isRecord(value) || !Array.isArray(value.scans)) return value;
  return {
    ...value,
    scans: value.scans.map((scan) =>
      upgradeLegacyScanAnalysisKind(scan, replaceExisting),
    ),
  };
}

function upgradeLegacyScanMenuContext(value: unknown, replaceExisting = false) {
  if (!isRecord(value) || (!replaceExisting && "menuContext" in value))
    return value;
  return { ...value, menuContext: null };
}

function upgradeLegacySnapshotMenuContexts(
  value: unknown,
  replaceExisting = false,
) {
  if (!isRecord(value) || !Array.isArray(value.scans)) return value;
  return {
    ...value,
    scans: value.scans.map((scan) =>
      upgradeLegacyScanMenuContext(scan, replaceExisting),
    ),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob: Blob) {
  if (blob.size > MAX_BACKUP_IMAGE_BYTES)
    throw new Error(BACKUP_IMAGE_TOO_LARGE_MESSAGE);
  if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type))
    throw new Error("備份中有不支援的圖片格式");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type};base64,${bytesToBase64(bytes)}`;
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) throw new Error("備份圖片格式無法辨識");
  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const decodedSize = Math.floor((base64.length * 3) / 4) - padding;
  if (decodedSize > MAX_BACKUP_IMAGE_BYTES)
    throw new Error(BACKUP_IMAGE_TOO_LARGE_MESSAGE);
  const binary = atob(base64);
  if (binary.length > MAX_BACKUP_IMAGE_BYTES)
    throw new Error(BACKUP_IMAGE_TOO_LARGE_MESSAGE);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

async function serializableScan(scan: PlateScan) {
  let imageDataUrl: string | undefined;
  let imageUrl = scan.imageUrl;
  if (scan.imageBlob) {
    imageDataUrl = await blobToDataUrl(scan.imageBlob);
    imageUrl = undefined;
  } else if (
    imageUrl &&
    (imageUrl.startsWith("https://") ||
      imageUrl.startsWith("http://") ||
      imageUrl.startsWith("blob:"))
  ) {
    const response = await fetch(imageUrl);
    if (!response.ok)
      throw new Error(`無法取得掃描圖片 ${scan.id}，備份已取消`);
    imageDataUrl = await blobToDataUrl(await response.blob());
    imageUrl = undefined;
  }
  return {
    id: scan.id,
    mealRecordId: scan.mealRecordId,
    imageUrl,
    imageDataUrl,
    imagePath: scan.imagePath,
    imageLoadError: scan.imageLoadError,
    contentSha256: scan.contentSha256,
    analysisKind: scan.analysisKind,
    menuContext: scan.menuContext,
    provider: scan.provider,
    model: scan.model,
    schemaVersion: scan.schemaVersion,
    status: scan.status,
    reviewedAt: scan.reviewedAt,
    createdAt: scan.createdAt,
  };
}

export async function serializeFoodLensBackup(snapshot: AppSnapshot) {
  const exportedAt = new Date().toISOString();
  let estimatedBytes = new Blob([
    JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      snapshot: { ...snapshot, scans: [] },
    }),
  ]).size;
  if (estimatedBytes > MAX_BACKUP_BYTES)
    throw new Error(BACKUP_TOO_LARGE_MESSAGE);

  const scans: Awaited<ReturnType<typeof serializableScan>>[] = [];
  for (const scan of snapshot.scans) {
    const value = await serializableScan(scan);
    scans.push(value);
    estimatedBytes += new Blob([JSON.stringify(value)]).size + 2;
    if (estimatedBytes > MAX_BACKUP_BYTES)
      throw new Error(BACKUP_TOO_LARGE_MESSAGE);
  }
  const payload = backupSchema.parse({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    snapshot: { ...snapshot, scans },
  });
  assertSnapshotReferences(payload.snapshot);
  const text = JSON.stringify(payload, null, 2);
  if (new Blob([text]).size > MAX_BACKUP_BYTES)
    throw new Error(BACKUP_TOO_LARGE_MESSAGE);
  return text;
}

function firstIssueMessage(error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue.path.length ? issue.path.join(".") : "根層";
  return `備份格式錯誤（${path}）：${issue.message}`;
}

function assertUniqueIds(label: string, values: ReadonlyArray<{ id: string }>) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id))
      throw new Error(`備份中有重複的${label} ID：${value.id}`);
    seen.add(value.id);
  }
  return seen;
}

function assertSnapshotReferences(snapshot: SerializableSnapshot) {
  validateMealSafetyHistory(snapshot.mealSafetyObservations, snapshot.meals);
  const classIds = assertUniqueIds("班級", snapshot.classes);
  const mealIds = assertUniqueIds("餐期", snapshot.meals);
  const scanIds = assertUniqueIds("掃描", snapshot.scans);
  const detectionIds = assertUniqueIds("辨識項目", snapshot.detections);
  assertUniqueIds("修正", snapshot.corrections);
  const predictionIds = assertUniqueIds("預測", snapshot.predictions);
  assertUniqueIds("實驗", snapshot.experiments);
  const evidenceCaseIds = assertUniqueIds("餐期證據鏈", snapshot.evidenceCases);
  const collectionEventIds = assertUniqueIds(
    "清運事件",
    snapshot.collectionEvents,
  );
  assertUniqueIds("處理場收據", snapshot.destinationReceipts);
  assertUniqueIds("研究章節", snapshot.researchSections);
  for (const meal of snapshot.meals) {
    if (!classIds.has(meal.classId))
      throw new Error(`餐期 ${meal.id} 指向不存在的班級`);
  }
  for (const scan of snapshot.scans) {
    if (!mealIds.has(scan.mealRecordId))
      throw new Error(`掃描 ${scan.id} 指向不存在的餐期`);
  }
  for (const detection of snapshot.detections) {
    if (!scanIds.has(detection.scanId))
      throw new Error(`辨識項目 ${detection.id} 指向不存在的掃描`);
  }
  for (const correction of snapshot.corrections) {
    if (!detectionIds.has(correction.detectionId))
      throw new Error(`修正 ${correction.id} 指向不存在的辨識項目`);
  }
  for (const prediction of snapshot.predictions) {
    if (prediction.evidenceMealIds.some((id) => !mealIds.has(id)))
      throw new Error(`預測 ${prediction.id} 含有不存在的餐期證據`);
  }
  for (const experiment of snapshot.experiments) {
    if (experiment.classId && !classIds.has(experiment.classId))
      throw new Error(`實驗 ${experiment.id} 指向不存在的班級`);
    if (
      experiment.linkedPredictionId &&
      !predictionIds.has(experiment.linkedPredictionId)
    )
      throw new Error(`實驗 ${experiment.id} 指向不存在的預測`);
    if (
      experiment.decisionTrace &&
      experiment.decisionTrace.predictionId !== experiment.linkedPredictionId
    )
      throw new Error(`實驗 ${experiment.id} 的決策快照與連結預測不一致`);
  }
  for (const evidenceCase of snapshot.evidenceCases) {
    if (!classIds.has(evidenceCase.classId))
      throw new Error(`證據鏈 ${evidenceCase.id} 指向不存在的班級`);
    if (evidenceCase.mealRecordId && !mealIds.has(evidenceCase.mealRecordId))
      throw new Error(
        `證據鏈 ${evidenceCase.id} 指向不存在的餐期 ${evidenceCase.mealRecordId}`,
      );
  }
  for (const event of snapshot.collectionEvents) {
    if (!evidenceCaseIds.has(event.evidenceCaseId))
      throw new Error(`清運事件 ${event.id} 指向不存在的餐期證據`);
  }
  const activeEventsByCase = new Map<
    string,
    Array<(typeof snapshot.collectionEvents)[number]>
  >();
  for (const event of snapshot.collectionEvents) {
    if (event.status === "cancelled") continue;
    const allocated = activeEventsByCase.get(event.evidenceCaseId) ?? [];
    const overlapping = allocated.find((candidate) =>
      candidate.wasteSources.some((source) =>
        event.wasteSources.includes(source),
      ),
    );
    if (overlapping)
      throw new Error(
        `清運事件 ${event.id} 與 ${overlapping.id} 重複分派同一餐期的分流來源`,
      );
    allocated.push(event);
    activeEventsByCase.set(event.evidenceCaseId, allocated);
  }
  for (const receipt of snapshot.destinationReceipts) {
    if (!collectionEventIds.has(receipt.collectionEventId))
      throw new Error(`處理場收據 ${receipt.id} 指向不存在的清運事件`);
    const event = snapshot.collectionEvents.find(
      (candidate) => candidate.id === receipt.collectionEventId,
    );
    if (event?.status !== "collected")
      throw new Error(`處理場收據 ${receipt.id} 的清運事件尚未完成交接`);
    if (
      event.collectedAt &&
      Date.parse(receipt.receivedAt) < Date.parse(event.collectedAt)
    )
      throw new Error(`處理場收據 ${receipt.id} 的收料時間早於清運交接`);
  }
}

export function parseRuntimeSnapshot(value: unknown): AppSnapshot {
  const result = runtimeSnapshotSchema.safeParse(
    upgradeLegacySnapshotMenuContexts(
      upgradeLegacySnapshotAnalysisKinds(value),
    ),
  );
  if (!result.success) throw new Error(firstIssueMessage(result.error));
  assertSnapshotReferences(result.data);
  return result.data as AppSnapshot;
}

export async function parseFoodLensBackup(text: string): Promise<AppSnapshot> {
  if (new Blob([text]).size > MAX_BACKUP_BYTES)
    throw new Error("備份檔超過 200MB，為保護瀏覽器已停止匯入");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("這不是有效的 JSON 備份檔");
  }
  const envelope = backupEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new Error(firstIssueMessage(envelope.error));

  let snapshot: SerializableSnapshot;
  switch (envelope.data.version) {
    case BACKUP_VERSION: {
      const result = backupSchema.safeParse(raw);
      if (!result.success) throw new Error(firstIssueMessage(result.error));
      snapshot = result.data.snapshot;
      break;
    }
    case 3: {
      // v3 has no per-meal safety observations. Missing values remain unknown;
      // never turn its legacy experiment-level averages into new evidence.
      const result = serializableSnapshotSchema.safeParse(
        envelope.data.snapshot,
      );
      if (!result.success) throw new Error(firstIssueMessage(result.error));
      snapshot = result.data;
      break;
    }
    case 2: {
      const result = serializableSnapshotSchema.safeParse(
        upgradeLegacySnapshotMenuContexts(envelope.data.snapshot, true),
      );
      if (!result.success) throw new Error(firstIssueMessage(result.error));
      snapshot = result.data;
      break;
    }
    case 1: {
      const result = serializableSnapshotSchema.safeParse(
        upgradeLegacySnapshotMenuContexts(
          upgradeLegacySnapshotAnalysisKinds(envelope.data.snapshot, true),
          true,
        ),
      );
      if (!result.success) throw new Error(firstIssueMessage(result.error));
      snapshot = result.data;
      break;
    }
    case 0: {
      const result = serializableSnapshotSchema.safeParse(
        upgradeLegacySnapshotMenuContexts(
          upgradeLegacySnapshotAnalysisKinds(
            upgradeV0Snapshot(envelope.data.snapshot),
            true,
          ),
          true,
        ),
      );
      if (!result.success) throw new Error(firstIssueMessage(result.error));
      snapshot = result.data;
      break;
    }
    default:
      throw new Error(
        `不支援的備份版本 ${envelope.data.version}；目前最高支援版本為 ${BACKUP_VERSION}，請更新 FoodLens 後再匯入`,
      );
  }

  assertSnapshotReferences(snapshot);
  const scans: PlateScan[] = snapshot.scans.map((scan) => {
    const { imageDataUrl, ...rest } = scan;
    return {
      ...rest,
      imageBlob: imageDataUrl ? dataUrlToBlob(imageDataUrl) : undefined,
    };
  });
  return { ...snapshot, scans } as AppSnapshot;
}

export const MEAL_CSV_HEADERS = [
  "餐期 ID",
  "日期",
  "班級 ID",
  "班級",
  "主食",
  "主菜",
  "配菜",
  "預計人數",
  "實際人數",
  "供應克數",
  "剩食克數",
  "剩食率",
  "量測方式",
  "資料來源",
  "備註",
  "建立時間",
  "更新時間",
] as const;

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const spreadsheetSafe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

export function serializeMealRecordsCsv(snapshot: AppSnapshot) {
  const rows = snapshot.meals.map((meal) => [
    meal.id,
    meal.servedOn,
    meal.classId,
    snapshot.classes.find((item) => item.id === meal.classId)?.name ?? "",
    meal.staple,
    meal.mainDish,
    meal.sideDishes.join("、"),
    meal.plannedPeople,
    meal.actualPeople,
    meal.totalSupplyG,
    meal.leftoverG,
    meal.totalSupplyG ? (meal.leftoverG / meal.totalSupplyG).toFixed(4) : "0",
    meal.measurementMethod,
    meal.source,
    meal.notes,
    meal.createdAt,
    meal.updatedAt,
  ]);
  return (
    "\ufeff" +
    [MEAL_CSV_HEADERS, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\ufeff/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV 中有未結束的引號");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function csvInteger(value: string, label: string, rowNumber: number) {
  const normalized = value.trim().replaceAll(",", "");
  const number = Number(normalized);
  if (!Number.isInteger(number))
    throw new Error(`CSV 第 ${rowNumber} 列的「${label}」必須是整數`);
  return number;
}

function importId(parts: string[]) {
  const value = parts.join("|");
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second ^ value.charCodeAt(index), 3266489917);
  }
  return `import-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function parseMealRecordsCsv(
  text: string,
  classes: SchoolClass[],
): MealRecord[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV 沒有可匯入的餐期資料");
  const headers = rows[0].map((value) => value.trim());
  const index = new Map(headers.map((header, column) => [header, column]));
  const required = [
    "日期",
    "班級",
    "主食",
    "主菜",
    "預計人數",
    "實際人數",
    "供應克數",
    "剩食克數",
    "量測方式",
  ];
  const missing = required.filter((header) => !index.has(header));
  if (missing.length) throw new Error(`CSV 缺少欄位：${missing.join("、")}`);
  const get = (row: string[], header: string) =>
    index.has(header) ? (row[index.get(header)!] ?? "").trim() : "";
  const byId = new Map(classes.map((item) => [item.id, item]));
  const byName = new Map(classes.map((item) => [item.name.trim(), item]));
  const now = new Date().toISOString();
  const identities = new Set<string>();
  return rows.slice(1).map((row, offset) => {
    const rowNumber = offset + 2;
    const servedOn = get(row, "日期");
    if (!validDate(servedOn))
      throw new Error(`CSV 第 ${rowNumber} 列的日期無效`);
    const classValue =
      byId.get(get(row, "班級 ID")) ?? byName.get(get(row, "班級"));
    if (!classValue)
      throw new Error(
        `CSV 第 ${rowNumber} 列的班級「${get(row, "班級") || get(row, "班級 ID")}」不存在`,
      );
    const staple = get(row, "主食");
    const mainDish = get(row, "主菜");
    if (!staple || !mainDish)
      throw new Error(`CSV 第 ${rowNumber} 列的主食或主菜不可空白`);
    const plannedPeople = csvInteger(
      get(row, "預計人數"),
      "預計人數",
      rowNumber,
    );
    const actualPeople = csvInteger(
      get(row, "實際人數"),
      "實際人數",
      rowNumber,
    );
    const totalSupplyG = csvInteger(
      get(row, "供應克數"),
      "供應克數",
      rowNumber,
    );
    const leftoverG = csvInteger(get(row, "剩食克數"), "剩食克數", rowNumber);
    if (
      plannedPeople < 1 ||
      actualPeople < 1 ||
      totalSupplyG < 1 ||
      leftoverG < 0 ||
      leftoverG > totalSupplyG
    )
      throw new Error(`CSV 第 ${rowNumber} 列的人數或重量不合理`);
    const method = get(row, "量測方式");
    if (method !== "scale" && method !== "manual")
      throw new Error(
        `CSV 第 ${rowNumber} 列的量測方式只能是 scale 或 manual，不可用影像估重代替全班秤重`,
      );
    const identity = `${classValue.id}|${servedOn}|${staple.toLowerCase()}|${mainDish.toLowerCase()}`;
    if (identities.has(identity))
      throw new Error(`CSV 第 ${rowNumber} 列與前面的餐期重複`);
    identities.add(identity);
    const suppliedId = get(row, "餐期 ID");
    const createdAt = get(row, "建立時間") || now;
    const updatedAt = get(row, "更新時間") || now;
    const value = mealSchema.parse({
      id: suppliedId || importId([identity]),
      classId: classValue.id,
      servedOn,
      mealPeriod: "lunch",
      staple,
      mainDish,
      sideDishes: get(row, "配菜")
        .split("、")
        .map((item) => item.trim())
        .filter(Boolean),
      menuSignature: `${staple}|${mainDish}`.toLowerCase(),
      plannedPeople,
      actualPeople,
      totalSupplyG,
      leftoverG,
      measurementMethod: method,
      notes: get(row, "備註"),
      source: "import",
      createdAt,
      updatedAt,
    });
    return value;
  });
}
