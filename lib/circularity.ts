import { z } from "zod";

export const COLLECTION_STATUSES = [
  "scheduled",
  "collected",
  "cancelled",
] as const;

export const RECEIPT_STATUSES = ["submitted", "verified", "rejected"] as const;

export const TREATMENT_METHODS = [
  "composting",
  "anaerobic_digestion",
  "black_soldier_fly",
  "circular_feed",
  "incineration",
  "landfill",
  "other",
  "unknown",
] as const;

export const TRACE_PROVENANCE = [
  "demo",
  "measured",
  "estimated",
  "official",
] as const;

export const TRACE_WEIGHT_STATES = [
  "wet",
  "standard_drained",
  "dewatered",
] as const;

export const TRACE_WASTE_SOURCES = [
  "preparation",
  "unserved_edible",
  "plate_edible",
  "inedible",
  "liquid",
] as const;

export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export type TreatmentMethod = (typeof TREATMENT_METHODS)[number];
export type TraceProvenance = (typeof TRACE_PROVENANCE)[number];
export type TraceWeightState = (typeof TRACE_WEIGHT_STATES)[number];
export type TraceWasteSource = (typeof TRACE_WASTE_SOURCES)[number];

export const TREATMENT_METHOD_LABELS: Record<TreatmentMethod, string> = {
  composting: "堆肥處理",
  anaerobic_digestion: "厭氧消化",
  black_soldier_fly: "黑水虻處理",
  circular_feed: "循環飼料",
  incineration: "焚化處理",
  landfill: "掩埋處理",
  other: "其他處理",
  unknown: "尚未確認",
};

export const TRACE_WEIGHT_STATE_LABELS: Record<TraceWeightState, string> = {
  wet: "含水原重",
  standard_drained: "標準瀝水後",
  dewatered: "脫水後",
};

export const TRACE_WASTE_SOURCE_LABELS: Record<TraceWasteSource, string> = {
  preparation: "備餐損耗",
  unserved_edible: "未供應可食",
  plate_edible: "餐盤可食剩餘",
  inedible: "不可食部分",
  liquid: "液體／受污染",
};

const idSchema = z.string().trim().min(1).max(200);
const optionalIdSchema = idSchema.optional();
const compactTextSchema = z.string().trim().min(1).max(300);
const optionalCompactTextSchema = compactTextSchema.optional();
const gramSchema = z.number().int().min(0).max(100_000_000);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const collectionEventSchema = z
  .object({
    id: idSchema,
    evidenceCaseId: idSchema,
    /** Present after cloud hydration; local Demo can resolve by evidenceCaseId. */
    mealBatchId: optionalIdSchema,
    status: z.enum(COLLECTION_STATUSES),
    scheduledAt: isoDateTimeSchema,
    collectedAt: isoDateTimeSchema.optional(),
    haulerName: optionalCompactTextSchema,
    manifestReference: optionalCompactTextSchema,
    netCollectedWeightG: gramSchema.optional(),
    weightState: z.enum(TRACE_WEIGHT_STATES),
    plannedDestinationName: compactTextSchema,
    plannedTreatmentMethod: z.enum(TREATMENT_METHODS),
    wasteSources: z.array(z.enum(TRACE_WASTE_SOURCES)).min(1).max(5),
    provenance: z.enum(TRACE_PROVENANCE),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((event, context) => {
    const createdAt = Date.parse(event.createdAt);
    const updatedAt = Date.parse(event.updatedAt);
    if (updatedAt < createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "更新時間不可早於建立時間",
      });
    }
    if (new Set(event.wasteSources).size !== event.wasteSources.length) {
      context.addIssue({
        code: "custom",
        path: ["wasteSources"],
        message: "同一清運來源不可重複勾選",
      });
    }
    if (event.status === "collected") {
      if (!event.collectedAt) {
        context.addIssue({
          code: "custom",
          path: ["collectedAt"],
          message: "完成交接時必須記錄實際清運時間",
        });
      } else if (Date.parse(event.collectedAt) > updatedAt) {
        context.addIssue({
          code: "custom",
          path: ["collectedAt"],
          message: "實際清運時間不可晚於這筆紀錄的更新時間",
        });
      }
      if (!event.haulerName) {
        context.addIssue({
          code: "custom",
          path: ["haulerName"],
          message: "完成交接時必須記錄清運單位",
        });
      }
      if (event.netCollectedWeightG === undefined) {
        context.addIssue({
          code: "custom",
          path: ["netCollectedWeightG"],
          message: "完成交接時必須記錄淨清運重量，0 g 也要明確填寫",
        });
      }
    }
  });

export const destinationReceiptSchema = z
  .object({
    id: idSchema,
    collectionEventId: idSchema,
    receiptReference: compactTextSchema,
    facilityName: compactTextSchema,
    actualTreatmentMethod: z.enum(TREATMENT_METHODS),
    acceptedWeightG: gramSchema.optional(),
    receivedAt: isoDateTimeSchema,
    status: z.enum(RECEIPT_STATUSES),
    verifiedBy: optionalIdSchema,
    verifiedAt: isoDateTimeSchema.optional(),
    rejectionReason: optionalCompactTextSchema,
    documentSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "文件指紋必須是 64 位小寫十六進位 SHA-256")
      .optional(),
    provenance: z.enum(TRACE_PROVENANCE),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const createdAt = Date.parse(receipt.createdAt);
    const updatedAt = Date.parse(receipt.updatedAt);
    if (updatedAt < createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "更新時間不可早於建立時間",
      });
    }
    if (receipt.status === "verified") {
      if (!receipt.verifiedBy || !receipt.verifiedAt) {
        context.addIssue({
          code: "custom",
          path: ["verifiedAt"],
          message: "核驗收據時必須保留核驗者與時間",
        });
      }
      if (!receipt.acceptedWeightG || receipt.acceptedWeightG <= 0) {
        context.addIssue({
          code: "custom",
          path: ["acceptedWeightG"],
          message: "核驗收據必須包含大於 0 g 的處理場收料重量",
        });
      }
      if (receipt.actualTreatmentMethod === "unknown") {
        context.addIssue({
          code: "custom",
          path: ["actualTreatmentMethod"],
          message: "處理方式未確認時不可標示為已核驗",
        });
      }
      if (receipt.provenance !== "demo" && receipt.provenance !== "official") {
        context.addIssue({
          code: "custom",
          path: ["provenance"],
          message: "估算或單方量測不能升級為處理場收據已核驗",
        });
      }
      if (receipt.provenance === "official" && !receipt.documentSha256) {
        context.addIssue({
          code: "custom",
          path: ["documentSha256"],
          message: "正式收據必須先選取原文件並保存 SHA-256 指紋，才能核驗",
        });
      }
      if (
        receipt.verifiedAt &&
        Date.parse(receipt.verifiedAt) < Date.parse(receipt.receivedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["verifiedAt"],
          message: "核驗時間不可早於處理場收料時間",
        });
      }
    }
    if (receipt.status === "rejected" && !receipt.rejectionReason) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "退回收據時必須記錄原因",
      });
    }
  });

export type CollectionEvent = z.infer<typeof collectionEventSchema>;
export type DestinationReceipt = z.infer<typeof destinationReceiptSchema>;

export const collectionEventListSchema = z.array(collectionEventSchema);
export const destinationReceiptListSchema = z.array(destinationReceiptSchema);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function assertNewerVersion<T extends { updatedAt: string }>(
  previous: T,
  next: T,
) {
  const previousTime = Date.parse(previous.updatedAt);
  const nextTime = Date.parse(next.updatedAt);
  if (nextTime < previousTime) throw new Error("不可用較舊版本覆寫去向證據");
  if (nextTime === previousTime && stableJson(previous) !== stableJson(next))
    throw new Error("相同更新時間出現不同去向內容，請先重新載入資料");
}

function withoutUpdatedAt<T extends { updatedAt: string }>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "updatedAt"),
  );
}

const collectionTransitions: Record<CollectionStatus, CollectionStatus[]> = {
  scheduled: ["scheduled", "collected", "cancelled"],
  collected: ["collected"],
  cancelled: ["cancelled"],
};

const receiptTransitions: Record<ReceiptStatus, ReceiptStatus[]> = {
  submitted: ["submitted", "verified", "rejected"],
  verified: ["verified"],
  rejected: ["rejected"],
};

export function upsertCollectionEvent(
  rawExisting: readonly unknown[],
  rawNext: unknown,
): CollectionEvent[] {
  const existing = collectionEventListSchema.parse(rawExisting);
  const next = collectionEventSchema.parse(rawNext);
  const index = existing.findIndex((event) => event.id === next.id);
  if (
    next.status !== "cancelled" &&
    existing.some(
      (event) =>
        event.id !== next.id &&
        event.evidenceCaseId === next.evidenceCaseId &&
        event.status !== "cancelled" &&
        event.wasteSources.some((source) => next.wasteSources.includes(source)),
    )
  )
    throw new Error("同一餐期的同一分流來源不可重複分派到多筆清運安排");
  if (index < 0) return collectionEventListSchema.parse([...existing, next]);
  const previous = existing[index];
  if (
    previous.evidenceCaseId !== next.evidenceCaseId ||
    previous.createdAt !== next.createdAt
  )
    throw new Error("更新清運事件時不可更改所屬餐期或建立時間");
  if (previous.status === "collected" || previous.status === "cancelled") {
    if (
      stableJson(withoutUpdatedAt(previous)) !==
      stableJson(withoutUpdatedAt(next))
    )
      throw new Error("已完成或取消的清運證據不可改寫");
    return existing;
  }
  assertNewerVersion(previous, next);
  if (!collectionTransitions[previous.status].includes(next.status))
    throw new Error("已完成或取消的清運事件不可退回上一階段");
  return collectionEventListSchema.parse(
    existing.map((event, candidate) => (candidate === index ? next : event)),
  );
}

export function upsertDestinationReceipt(
  rawExisting: readonly unknown[],
  rawNext: unknown,
): DestinationReceipt[] {
  const existing = destinationReceiptListSchema.parse(rawExisting);
  const next = destinationReceiptSchema.parse(rawNext);
  const index = existing.findIndex((receipt) => receipt.id === next.id);
  if (index < 0) return destinationReceiptListSchema.parse([...existing, next]);
  const previous = existing[index];
  if (
    previous.collectionEventId !== next.collectionEventId ||
    previous.createdAt !== next.createdAt
  )
    throw new Error("更新收據時不可更改所屬清運事件或建立時間");
  if (previous.status === "verified" || previous.status === "rejected") {
    if (
      stableJson(withoutUpdatedAt(previous)) !==
      stableJson(withoutUpdatedAt(next))
    )
      throw new Error("已核驗或退回的處理場收據不可改寫");
    return existing;
  }
  assertNewerVersion(previous, next);
  if (!receiptTransitions[previous.status].includes(next.status))
    throw new Error("已核驗或退回的收據不可退回待核驗狀態");
  return destinationReceiptListSchema.parse(
    existing.map((receipt, candidate) =>
      candidate === index ? next : receipt,
    ),
  );
}

export function receiptForCollection(
  receipts: readonly DestinationReceipt[],
  collectionEventId: string,
) {
  return [...receipts]
    .filter((receipt) => receipt.collectionEventId === collectionEventId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function verifiedOutcome(receipt: DestinationReceipt | undefined):
  | {
      facilityName: string;
      treatmentMethod: TreatmentMethod;
      acceptedWeightG: number;
      verifiedAt: string;
    }
  | undefined {
  if (receipt?.status !== "verified") return undefined;
  const parsed = destinationReceiptSchema.parse(receipt);
  return {
    facilityName: parsed.facilityName,
    treatmentMethod: parsed.actualTreatmentMethod,
    acceptedWeightG: parsed.acceptedWeightG as number,
    verifiedAt: parsed.verifiedAt as string,
  };
}

export function collectionReceiptWeightDifference(
  event: CollectionEvent,
  receipt: DestinationReceipt | undefined,
) {
  const outcome = verifiedOutcome(receipt);
  if (event.status !== "collected" || !outcome) return undefined;
  const collectedWeightG = event.netCollectedWeightG ?? 0;
  const differenceG = outcome.acceptedWeightG - collectedWeightG;
  return {
    collectedWeightG,
    acceptedWeightG: outcome.acceptedWeightG,
    differenceG,
    differenceRate:
      collectedWeightG > 0 ? differenceG / collectedWeightG : undefined,
  };
}

/** Fixed Demo records. They demonstrate evidence states, not school outcomes. */
export function createDemoCircularityTrace(): {
  collectionEvents: CollectionEvent[];
  destinationReceipts: DestinationReceipt[];
} {
  const collectionEvents = collectionEventListSchema.parse([
    {
      id: "demo-collection-verified",
      evidenceCaseId: "demo-evidence-1",
      status: "collected",
      scheduledAt: "2026-09-04T05:10:00.000Z",
      collectedAt: "2026-09-04T05:24:00.000Z",
      haulerName: "示範清運合作單位",
      manifestReference: "DEMO-MF-20260904-01",
      netCollectedWeightG: 7_600,
      weightState: "standard_drained",
      plannedDestinationName: "北區有機資源示範場",
      plannedTreatmentMethod: "composting",
      wasteSources: ["preparation", "unserved_edible", "plate_edible"],
      provenance: "demo",
      createdAt: "2026-09-04T04:40:00.000Z",
      updatedAt: "2026-09-04T05:24:00.000Z",
    },
    {
      id: "demo-collection-submitted",
      evidenceCaseId: "demo-evidence-2",
      status: "collected",
      scheduledAt: "2026-09-18T05:10:00.000Z",
      collectedAt: "2026-09-18T05:19:00.000Z",
      haulerName: "示範清運合作單位",
      manifestReference: "DEMO-MF-20260918-01",
      netCollectedWeightG: 7_000,
      weightState: "standard_drained",
      plannedDestinationName: "北區有機資源示範場",
      plannedTreatmentMethod: "anaerobic_digestion",
      wasteSources: ["preparation", "unserved_edible", "plate_edible"],
      provenance: "demo",
      createdAt: "2026-09-18T04:40:00.000Z",
      updatedAt: "2026-09-18T05:19:00.000Z",
    },
    {
      id: "demo-collection-scheduled",
      evidenceCaseId: "demo-evidence-3",
      status: "scheduled",
      scheduledAt: "2026-10-02T05:10:00.000Z",
      weightState: "standard_drained",
      plannedDestinationName: "北區有機資源示範場",
      plannedTreatmentMethod: "composting",
      wasteSources: ["preparation", "unserved_edible", "plate_edible"],
      provenance: "demo",
      createdAt: "2026-10-02T04:40:00.000Z",
      updatedAt: "2026-10-02T04:40:00.000Z",
    },
  ]);
  const destinationReceipts = destinationReceiptListSchema.parse([
    {
      id: "demo-receipt-verified",
      collectionEventId: "demo-collection-verified",
      receiptReference: "DEMO-RC-20260904-01",
      facilityName: "北區有機資源示範場",
      actualTreatmentMethod: "anaerobic_digestion",
      acceptedWeightG: 7_420,
      receivedAt: "2026-09-04T06:02:00.000Z",
      status: "verified",
      verifiedBy: "示範校方覆核人員",
      verifiedAt: "2026-09-05T01:30:00.000Z",
      documentSha256:
        "76586d33f47bf0fcafd183e640a6f35f5934ac31d38f04772de8e6823bcf3a64",
      provenance: "demo",
      createdAt: "2026-09-04T06:10:00.000Z",
      updatedAt: "2026-09-05T01:30:00.000Z",
    },
    {
      id: "demo-receipt-submitted",
      collectionEventId: "demo-collection-submitted",
      receiptReference: "DEMO-RC-20260918-01",
      facilityName: "北區有機資源示範場",
      actualTreatmentMethod: "unknown",
      receivedAt: "2026-09-18T06:00:00.000Z",
      status: "submitted",
      provenance: "demo",
      createdAt: "2026-09-18T06:10:00.000Z",
      updatedAt: "2026-09-18T06:10:00.000Z",
    },
  ]);
  return { collectionEvents, destinationReceipts };
}
