import { z } from "zod";
import {
  collectLowConfidenceAcceptances,
  confirmMenuVersion,
  getActualMenuDishes,
  importMenuVersion,
  menuVersionSchema,
} from "@/lib/menu-intelligence";
import {
  analyzeWasteIntelligence,
  responsibilityCardSchema,
  RESPONSIBILITY_KINDS,
  RESPONSIBILITY_OWNERS,
  wasteMeasurementSchema,
  wasteMetricsSchema,
  wasteObservationSchema,
  WASTE_SOURCES,
  type ResponsibilityCard,
  type WasteMeasurement,
  type WasteObservation,
} from "@/lib/waste-intelligence";

export const EVIDENCE_SOURCE_KINDS = [
  "demo",
  "measured",
  "estimated",
  "official",
] as const;

export const HUMAN_DECISION_CHOICES = ["pilot", "more-data", "reject"] as const;

export const COMPARABLE_EVIDENCE_COHORT_LEVELS = [
  "exact-menu",
  "same-main-supplier",
  "class-baseline",
  "current-only",
] as const;

export const COMPARABLE_EVIDENCE_LOOKBACK_DAYS = 180;
export const COMPARABLE_EVIDENCE_MINIMUM_DAYS = 3;

export const ANONYMOUS_REASON_KEYS = [
  "portion",
  "taste",
  "texture",
  "temperature",
  "time",
  "other",
] as const;

const compactIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[\p{L}\p{N}_.:-]+$/u,
    "識別碼只能使用文字、數字、點、底線、冒號或連字號",
  );
const gramSchema = z.number().int().min(0).max(50_000_000);
const dinerCountSchema = z.number().int().min(0).max(20_000);
const reasonCountSchema = z.number().int().min(0).max(20_000).nullable();
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const evidenceSourceKindSchema = z.enum(EVIDENCE_SOURCE_KINDS);
export const humanDecisionChoiceSchema = z.enum(HUMAN_DECISION_CHOICES);
export const reasonCollectionStatusSchema = z
  .enum(["not-collected", "collected", "legacy-unverified"])
  .default("legacy-unverified");
const observationStatusSchema = z
  .enum(["not-collected", "recorded", "legacy-unverified"])
  .default("legacy-unverified");

/**
 * The six v1 keys always exist. `catchall` intentionally permits future
 * anonymous reasons without a schema migration; every extension still has the
 * same bounded, non-negative integer-or-unknown contract. Missing historical
 * fields are unknown, never inferred zeros. Collection status is independent.
 */
export const anonymousReasonCountsSchema = z
  .object({
    portion: reasonCountSchema.default(null),
    taste: reasonCountSchema.default(null),
    texture: reasonCountSchema.default(null),
    temperature: reasonCountSchema.default(null),
    time: reasonCountSchema.default(null),
    other: reasonCountSchema.default(null),
  })
  .catchall(reasonCountSchema)
  .superRefine((reasons, context) => {
    Object.keys(reasons).forEach((key) => {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "擴充原因代碼必須使用小寫英數與連字號",
        });
      }
    });
  });

export const teacherEvidenceContextSchema = z
  .object({
    specialEvent: z.string().trim().min(1).max(200).optional(),
    deliveryStatus: observationStatusSchema,
    temperatureStatus: observationStatusSchema,
    deliveryDelayMinutes: z
      .number()
      .int()
      .min(0)
      .max(1_440)
      .nullable()
      .default(null),
    temperatureConcern: z.boolean().nullable().default(null),
    note: z.string().trim().max(500).default(""),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [statusKey, valueKey] of [
      ["deliveryStatus", "deliveryDelayMinutes"],
      ["temperatureStatus", "temperatureConcern"],
    ] as const) {
      if (value[statusKey] === "recorded" && value[valueKey] === null) {
        context.addIssue({
          code: "custom",
          path: [valueKey],
          message: "已觀察的欄位必須填寫數值或明確選擇結果",
        });
      }
      if (value[statusKey] === "not-collected" && value[valueKey] !== null) {
        context.addIssue({
          code: "custom",
          path: [valueKey],
          message: "尚未觀察不可保留成已知數值",
        });
      }
    }
  });

/** Drafts may be partially entered. Final evidence must distinguish zero from unknown. */
export function reasonCollectionIssue(value: {
  reasonCollectionStatus: z.infer<typeof reasonCollectionStatusSchema>;
  reasonCounts: z.infer<typeof anonymousReasonCountsSchema>;
  actualDiners: number;
}): string | undefined {
  const counts = Object.values(value.reasonCounts);
  if (
    value.reasonCollectionStatus === "not-collected" &&
    counts.some((count) => count !== null)
  ) {
    return "尚未收集的原因票數應留空，不可當成已知 0 票";
  }
  if (
    value.reasonCollectionStatus === "collected" &&
    counts.some((count) => count === null)
  ) {
    return "已收集時請逐項填寫票數；確認沒有票才填 0";
  }
  if (
    counts.reduce<number>((sum, count) => sum + (count ?? 0), 0) >
    value.actualDiners
  ) {
    return "匿名主要原因票數合計不可高於實到用餐人數";
  }
}

export function emptyReasonCounts(): z.infer<
  typeof anonymousReasonCountsSchema
> {
  return anonymousReasonCountsSchema.parse({});
}

export const measurementReviewSchema = z
  .object({
    reviewedAt: isoDateTimeSchema,
    reviewedBy: z.string().trim().min(1).max(120),
    zeroValuesChecked: z.literal(true),
  })
  .strict();

export const evidenceHumanDecisionSchema = z
  .object({
    cardId: z.enum(RESPONSIBILITY_KINDS),
    choice: humanDecisionChoiceSchema,
    rationale: z.string().trim().min(5).max(1_000),
    decidedAt: isoDateTimeSchema,
    decidedByRole: z.enum(RESPONSIBILITY_OWNERS),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.cardId === "need-more-data" && decision.choice === "pilot") {
      context.addIssue({
        code: "custom",
        path: ["choice"],
        message: "需要更多資料卡不可直接進入試行",
      });
    }
  });

export const mealEvidenceCaseSchema = z
  .object({
    id: compactIdSchema,
    mealRecordId: compactIdSchema.optional(),
    classId: compactIdSchema,
    servedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceKind: evidenceSourceKindSchema,
    menuVersion: menuVersionSchema,
    plannedDiners: dinerCountSchema.refine((value) => value > 0, {
      message: "預計用餐人數必須大於 0",
    }),
    actualDiners: dinerCountSchema.refine((value) => value > 0, {
      message: "實到用餐人數必須大於 0",
    }),
    suppliedEdibleG: gramSchema.refine((value) => value > 0, {
      message: "供應可食重量必須大於 0",
    }),
    observedDiners: dinerCountSchema,
    plateSampleSupplyG: gramSchema,
    measurements: z.array(wasteMeasurementSchema).min(5).max(200),
    measurementReview: measurementReviewSchema.optional(),
    feedbackSchemaVersion: z.literal(2).default(2),
    reasonCollectionStatus: reasonCollectionStatusSchema,
    reasonCounts: anonymousReasonCountsSchema,
    teacherContext: teacherEvidenceContextSchema,
    humanDecision: evidenceHumanDecisionSchema.optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((evidenceCase, context) => {
    if (evidenceCase.menuVersion.servedOn !== evidenceCase.servedOn) {
      context.addIssue({
        code: "custom",
        path: ["menuVersion", "servedOn"],
        message: "案件日期必須與菜單版本日期一致",
      });
    }
    if (evidenceCase.menuVersion.status !== "confirmed") {
      context.addIssue({
        code: "custom",
        path: ["menuVersion", "status"],
        message: "菜單必須經人工確認，才能完成證據案件",
      });
    }
    if (evidenceCase.observedDiners > evidenceCase.actualDiners) {
      context.addIssue({
        code: "custom",
        path: ["observedDiners"],
        message: "盤後觀察人數不可高於實到用餐人數",
      });
    }
    if (evidenceCase.plateSampleSupplyG > evidenceCase.suppliedEdibleG) {
      context.addIssue({
        code: "custom",
        path: ["plateSampleSupplyG"],
        message: "抽樣餐盤供應重量不可高於整餐供應可食重量",
      });
    }
    if (evidenceCase.sourceKind !== "demo" && !evidenceCase.measurementReview) {
      context.addIssue({
        code: "custom",
        path: ["measurementReview"],
        message: "正式資料必須由現場人員逐項確認五源量測；0g 也要明確確認",
      });
    }
    if (
      evidenceCase.sourceKind !== "demo" &&
      (evidenceCase.observedDiners <= 0 || evidenceCase.plateSampleSupplyG <= 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["plateSampleSupplyG"],
        message: "正式資料必須記錄至少一份餐盤樣本與其原供應重量",
      });
    }

    const presentSources = new Set(
      evidenceCase.measurements.map((measurement) => measurement.source),
    );
    WASTE_SOURCES.forEach((source) => {
      if (!presentSources.has(source)) {
        context.addIssue({
          code: "custom",
          path: ["measurements"],
          message: `完成案件前必須明確記錄 ${source}，沒有剩餘時請記 0g`,
        });
      }
    });

    const feedbackIssue = reasonCollectionIssue(evidenceCase);
    if (feedbackIssue) {
      context.addIssue({
        code: "custom",
        path: ["reasonCounts"],
        message: feedbackIssue,
      });
    }

    const createdTime = Date.parse(evidenceCase.createdAt);
    const updatedTime = Date.parse(evidenceCase.updatedAt);
    if (updatedTime < createdTime) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "更新時間不可早於建立時間",
      });
    }
    if (evidenceCase.measurementReview) {
      const reviewedTime = Date.parse(
        evidenceCase.measurementReview.reviewedAt,
      );
      if (reviewedTime < createdTime || reviewedTime > updatedTime) {
        context.addIssue({
          code: "custom",
          path: ["measurementReview", "reviewedAt"],
          message: "量測確認時間必須介於案件建立與更新時間之間",
        });
      }
    }
    if (evidenceCase.humanDecision) {
      const decidedTime = Date.parse(evidenceCase.humanDecision.decidedAt);
      if (decidedTime < createdTime || decidedTime > updatedTime) {
        context.addIssue({
          code: "custom",
          path: ["humanDecision", "decidedAt"],
          message: "人工決策時間必須介於案件建立與更新時間之間",
        });
      }
    }

    const parsedMenuVersion = menuVersionSchema.safeParse(
      evidenceCase.menuVersion,
    );
    if (!parsedMenuVersion.success) return;
    const actualDishes = getActualMenuDishes(parsedMenuVersion.data);
    const supplierIds = [
      ...new Set(
        actualDishes
          .map((dish) => dish.vendorId)
          .filter((value) => value && value !== "未提供供應商"),
      ),
    ];
    const wasteCandidate = {
      id: evidenceCase.id,
      servedOn: evidenceCase.servedOn,
      suppliedEdibleG: evidenceCase.suppliedEdibleG,
      plannedDiners: evidenceCase.plannedDiners,
      actualDiners: evidenceCase.actualDiners,
      observedDiners: evidenceCase.observedDiners,
      plateSampleSupplyG: evidenceCase.plateSampleSupplyG,
      measurements: evidenceCase.measurements,
      context: {
        menuName: summarizeMenuName(actualDishes),
        classId: evidenceCase.classId,
        supplierId: supplierIds.length === 1 ? supplierIds[0] : undefined,
        includesVegetable: actualDishes.some(
          (dish) => dish.category === "vegetable",
        ),
        ...feedbackContextForAnalysis(evidenceCase),
      },
    };
    const wasteResult = wasteObservationSchema.safeParse(wasteCandidate);
    if (!wasteResult.success) {
      wasteResult.error.issues.forEach((issue) => {
        const contextField =
          issue.path[0] === "context" ? issue.path[1] : undefined;
        const path =
          contextField === "feedback"
            ? ["reasonCounts", ...issue.path.slice(2)]
            : contextField === "delivery" || contextField === "specialEvent"
              ? ["teacherContext", ...issue.path.slice(2)]
              : ["measurements", ...issue.path];
        context.addIssue({
          code: "custom",
          path,
          message: issue.message,
        });
      });
    }
  });

export const mealEvidenceCaseListSchema = z
  .array(mealEvidenceCaseSchema)
  .min(1)
  .max(1_000)
  .superRefine((cases, context) => {
    const ids = new Set<string>();
    cases.forEach((evidenceCase, index) => {
      if (ids.has(evidenceCase.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "證據案件編號不可重複",
        });
      }
      ids.add(evidenceCase.id);
    });
  });

export const evidenceSourceSummarySchema = z
  .object({
    demo: z.number().int().min(0),
    measured: z.number().int().min(0),
    estimated: z.number().int().min(0),
    official: z.number().int().min(0),
    containsDemoData: z.boolean(),
    disclosureLabel: z.string().trim().min(1).max(200),
  })
  .strict();

export const evidenceCaseAnalysisSchema = z
  .object({
    caseCount: z.number().int().min(1),
    caseIds: z.array(compactIdSchema).min(1),
    menuVersionIds: z.array(compactIdSchema).min(1),
    sourceSummary: evidenceSourceSummarySchema,
    feedbackCoverage: z
      .object({
        collectedMeals: z.number().int().min(0),
        zeroResponseMeals: z.number().int().min(0),
        uncollectedMeals: z.number().int().min(0),
        legacyUnverifiedMeals: z.number().int().min(0),
        confirmedResponseCount: z.number().int().min(0),
        deliveryObservedMeals: z.number().int().min(0),
        temperatureObservedMeals: z.number().int().min(0),
      })
      .strict(),
    metrics: wasteMetricsSchema,
    responsibilityCards: z.array(responsibilityCardSchema).min(1).max(5),
  })
  .strict();

export const comparableEvidenceCohortSchema = z
  .object({
    level: z.enum(COMPARABLE_EVIDENCE_COHORT_LEVELS),
    label: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
    window: z
      .object({
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        lookbackDays: z.literal(COMPARABLE_EVIDENCE_LOOKBACK_DAYS),
      })
      .strict(),
    caseIds: z.array(compactIdSchema).min(1).max(1_001),
    independentMealCount: z.number().int().min(1),
  })
  .strict();

export type EvidenceSourceKind = z.infer<typeof evidenceSourceKindSchema>;
export type AnonymousReasonCounts = z.infer<typeof anonymousReasonCountsSchema>;
export type TeacherEvidenceContext = z.infer<
  typeof teacherEvidenceContextSchema
>;
export type MeasurementReview = z.infer<typeof measurementReviewSchema>;
export type EvidenceHumanDecision = z.infer<typeof evidenceHumanDecisionSchema>;
export type MealEvidenceCase = z.infer<typeof mealEvidenceCaseSchema>;
export type EvidenceSourceSummary = z.infer<typeof evidenceSourceSummarySchema>;
export type EvidenceCaseAnalysis = z.infer<typeof evidenceCaseAnalysisSchema>;
export type ComparableEvidenceCohort = z.infer<
  typeof comparableEvidenceCohortSchema
>;

function reasonResponseCount(reasons: AnonymousReasonCounts) {
  return Object.values(reasons).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0,
  );
}

/** Only explicit observations enter analysis; retained legacy values are audit-only. */
function feedbackContextForAnalysis(evidenceCase: {
  reasonCollectionStatus: z.infer<typeof reasonCollectionStatusSchema>;
  reasonCounts: AnonymousReasonCounts;
  teacherContext: TeacherEvidenceContext;
}) {
  const { reasonCounts, teacherContext } = evidenceCase;
  const collected =
    evidenceCase.reasonCollectionStatus === "collected" &&
    Object.values(reasonCounts).every((count) => count !== null);
  return {
    specialEvent: teacherContext.specialEvent,
    feedback: collected
      ? {
          responseCount: reasonResponseCount(reasonCounts),
          portionTooMuchCount: reasonCounts.portion!,
          tasteIssueCount: reasonCounts.taste!,
          textureIssueCount: reasonCounts.texture!,
          temperatureIssueCount: reasonCounts.temperature!,
        }
      : undefined,
    delivery: {
      delayMinutes:
        teacherContext.deliveryStatus === "recorded"
          ? teacherContext.deliveryDelayMinutes
          : null,
      temperatureConcern:
        teacherContext.temperatureStatus === "recorded"
          ? teacherContext.temperatureConcern
          : null,
    },
  };
}

function summarizeMenuName(
  dishes: readonly { normalizedName: string }[],
  maximumCharacters = 160,
) {
  const characters = Array.from(
    dishes.map((dish) => dish.normalizedName).join("｜"),
  );
  if (characters.length <= maximumCharacters) return characters.join("");
  return `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

function isoDateMilliseconds(value: string) {
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`無效的供餐日期：${value}`);
  }
  return milliseconds;
}

function shiftIsoDate(value: string, days: number) {
  return new Date(isoDateMilliseconds(value) + days * DAY_IN_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

function comparableText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s\u3000]+/g, "")
    .toLocaleLowerCase("zh-Hant-TW");
}

function actualMenuComparisonKey(evidenceCase: MealEvidenceCase) {
  return getActualMenuDishes(evidenceCase.menuVersion)
    .map((dish) =>
      [
        dish.role,
        comparableText(dish.normalizedName),
        dish.category,
        dish.cookingMethod,
        comparableText(dish.recipeVersion),
        comparableText(dish.vendorId),
      ].join("|"),
    )
    .sort()
    .join("||");
}

function mainDishSupplierComparisonKey(evidenceCase: MealEvidenceCase) {
  const mainDishes = getActualMenuDishes(evidenceCase.menuVersion).filter(
    (dish) => dish.role === "main",
  );
  if (mainDishes.length === 0) return undefined;
  return mainDishes
    .map((dish) =>
      [comparableText(dish.normalizedName), comparableText(dish.vendorId)].join(
        "|",
      ),
    )
    .sort()
    .join("||");
}

function independentMealCount(cases: readonly MealEvidenceCase[]) {
  return new Set(cases.map((evidenceCase) => evidenceCase.servedOn)).size;
}

function chronologicalCases(cases: readonly MealEvidenceCase[]) {
  return [...cases].sort(
    (left, right) =>
      left.servedOn.localeCompare(right.servedOn) ||
      left.id.localeCompare(right.id),
  );
}

function cohortResult(
  level: ComparableEvidenceCohort["level"],
  label: string,
  reason: string,
  window: ComparableEvidenceCohort["window"],
  cases: readonly MealEvidenceCase[],
) {
  const sorted = chronologicalCases(cases);
  return comparableEvidenceCohortSchema.parse({
    level,
    label,
    reason,
    window,
    caseIds: sorted.map((evidenceCase) => evidenceCase.id),
    independentMealCount: independentMealCount(sorted),
  });
}

/**
 * Select a defensible comparison cohort for one meal. The current meal is
 * always included, while future meals, evidence outside the 180-day window,
 * and different provenance kinds are excluded before any similarity match.
 */
export function buildComparableEvidenceCohort(
  rawCases: readonly unknown[],
  rawCurrent: unknown,
): ComparableEvidenceCohort {
  const current = mealEvidenceCaseSchema.parse(rawCurrent);
  const parsedCases = z
    .array(mealEvidenceCaseSchema)
    .max(1_000)
    .parse(rawCases);
  const uniqueCases = new Map<string, MealEvidenceCase>();
  parsedCases.forEach((evidenceCase) => {
    if (evidenceCase.id === current.id) return;
    if (uniqueCases.has(evidenceCase.id)) {
      throw new Error(`證據案件編號不可重複：${evidenceCase.id}`);
    }
    uniqueCases.set(evidenceCase.id, evidenceCase);
  });

  const window = {
    start: shiftIsoDate(current.servedOn, -COMPARABLE_EVIDENCE_LOOKBACK_DAYS),
    end: current.servedOn,
    lookbackDays: COMPARABLE_EVIDENCE_LOOKBACK_DAYS,
  } as const;
  const windowStart = isoDateMilliseconds(window.start);
  const windowEnd = isoDateMilliseconds(window.end);
  const eligible = [...uniqueCases.values(), current].filter((evidenceCase) => {
    const servedOn = isoDateMilliseconds(evidenceCase.servedOn);
    return (
      evidenceCase.sourceKind === current.sourceKind &&
      servedOn >= windowStart &&
      servedOn <= windowEnd
    );
  });

  const currentMenuKey = actualMenuComparisonKey(current);
  const exactMenuCases = eligible.filter(
    (evidenceCase) => actualMenuComparisonKey(evidenceCase) === currentMenuKey,
  );
  const exactMenuDays = independentMealCount(exactMenuCases);
  if (exactMenuDays >= COMPARABLE_EVIDENCE_MINIMUM_DAYS) {
    return cohortResult(
      "exact-menu",
      "同一實際菜單、食譜與供應商",
      `最近 ${COMPARABLE_EVIDENCE_LOOKBACK_DAYS} 天內有 ${exactMenuDays} 個獨立供餐日，實際菜單、食譜版本與供應商欄位一致。`,
      window,
      exactMenuCases,
    );
  }

  const currentMainSupplierKey = mainDishSupplierComparisonKey(current);
  const sameMainSupplierCases = currentMainSupplierKey
    ? eligible.filter(
        (evidenceCase) =>
          mainDishSupplierComparisonKey(evidenceCase) ===
          currentMainSupplierKey,
      )
    : [];
  const sameMainSupplierDays = independentMealCount(sameMainSupplierCases);
  if (sameMainSupplierDays >= COMPARABLE_EVIDENCE_MINIMUM_DAYS) {
    return cohortResult(
      "same-main-supplier",
      "同主菜與供應商的相似餐期",
      `完整菜單只有 ${exactMenuDays} 個可比供餐日，未達 ${COMPARABLE_EVIDENCE_MINIMUM_DAYS} 日門檻；改用同主菜與供應商的 ${sameMainSupplierDays} 個獨立供餐日。`,
      window,
      sameMainSupplierCases,
    );
  }

  const classBaselineCases = eligible.filter(
    (evidenceCase) => evidenceCase.classId === current.classId,
  );
  const classBaselineDays = independentMealCount(classBaselineCases);
  if (classBaselineDays >= COMPARABLE_EVIDENCE_MINIMUM_DAYS) {
    return cohortResult(
      "class-baseline",
      "同班近期基準",
      `完整菜單與同主菜／供應商皆未達 ${COMPARABLE_EVIDENCE_MINIMUM_DAYS} 日門檻；改用同班最近 ${COMPARABLE_EVIDENCE_LOOKBACK_DAYS} 天的 ${classBaselineDays} 個獨立供餐日。`,
      window,
      classBaselineCases,
    );
  }

  return cohortResult(
    "current-only",
    "目前餐期（尚無足夠可比資料）",
    `完整菜單、同主菜／供應商與同班基準皆未達 ${COMPARABLE_EVIDENCE_MINIMUM_DAYS} 個獨立供餐日；目前只分析本餐，不混入未來、逾期或不同來源資料。`,
    window,
    [current],
  );
}

/** Convert one complete, confirmed case without mutating its audit aggregate. */
export function caseToWasteObservation(rawCase: unknown): WasteObservation {
  const evidenceCase = mealEvidenceCaseSchema.parse(rawCase);
  const dishes = getActualMenuDishes(evidenceCase.menuVersion);
  const supplierIds = [
    ...new Set(
      dishes
        .map((dish) => dish.vendorId)
        .filter((value) => value && value !== "未提供供應商"),
    ),
  ];
  return wasteObservationSchema.parse({
    id: evidenceCase.id,
    servedOn: evidenceCase.servedOn,
    suppliedEdibleG: evidenceCase.suppliedEdibleG,
    plannedDiners: evidenceCase.plannedDiners,
    actualDiners: evidenceCase.actualDiners,
    observedDiners: evidenceCase.observedDiners,
    plateSampleSupplyG: evidenceCase.plateSampleSupplyG,
    measurements: evidenceCase.measurements.map((measurement) => ({
      ...measurement,
    })),
    context: {
      menuName: summarizeMenuName(dishes),
      classId: evidenceCase.classId,
      supplierId: supplierIds.length === 1 ? supplierIds[0] : undefined,
      includesVegetable: dishes.some((dish) => dish.category === "vegetable"),
      ...feedbackContextForAnalysis(evidenceCase),
    },
  });
}

export function analyzeEvidenceCases(
  rawCases: readonly unknown[],
): EvidenceCaseAnalysis {
  const cases = mealEvidenceCaseListSchema.parse(rawCases);
  const wasteResult = analyzeWasteIntelligence({
    observations: cases.map(caseToWasteObservation),
  });
  const sourceCounts = cases.reduce(
    (counts, evidenceCase) => {
      counts[evidenceCase.sourceKind] += 1;
      return counts;
    },
    { demo: 0, measured: 0, estimated: 0, official: 0 },
  );
  const containsDemoData = sourceCounts.demo > 0;
  return evidenceCaseAnalysisSchema.parse({
    caseCount: cases.length,
    caseIds: cases.map((evidenceCase) => evidenceCase.id),
    menuVersionIds: [
      ...new Set(cases.map((evidenceCase) => evidenceCase.menuVersion.id)),
    ],
    sourceSummary: {
      ...sourceCounts,
      containsDemoData,
      disclosureLabel: containsDemoData
        ? `示範資料：${sourceCounts.demo} 筆，不代表本校實測成果`
        : "不含示範資料；仍須依各案件來源檢查證據 provenance",
    },
    feedbackCoverage: {
      collectedMeals: cases.filter(
        (item) => item.reasonCollectionStatus === "collected",
      ).length,
      zeroResponseMeals: cases.filter(
        (item) =>
          item.reasonCollectionStatus === "collected" &&
          reasonResponseCount(item.reasonCounts) === 0,
      ).length,
      uncollectedMeals: cases.filter(
        (item) => item.reasonCollectionStatus === "not-collected",
      ).length,
      legacyUnverifiedMeals: cases.filter(
        (item) => item.reasonCollectionStatus === "legacy-unverified",
      ).length,
      confirmedResponseCount: cases.reduce(
        (sum, item) =>
          sum +
          (item.reasonCollectionStatus === "collected"
            ? reasonResponseCount(item.reasonCounts)
            : 0),
        0,
      ),
      deliveryObservedMeals: cases.filter(
        (item) => item.teacherContext.deliveryStatus === "recorded",
      ).length,
      temperatureObservedMeals: cases.filter(
        (item) => item.teacherContext.temperatureStatus === "recorded",
      ).length,
    },
    metrics: wasteResult.metrics,
    responsibilityCards: wasteResult.responsibilityCards,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Insert or replace by id while preserving list order. Identity fields cannot
 * drift, equal-timestamp conflicts and stale writes are rejected, and Zod
 * reparsing returns a fresh aggregate rather than mutating caller-owned data.
 */
export function upsertEvidenceCase(
  rawExistingCases: readonly unknown[],
  rawNextCase: unknown,
): MealEvidenceCase[] {
  const existingCases =
    rawExistingCases.length === 0
      ? []
      : mealEvidenceCaseListSchema.parse(rawExistingCases);
  const nextCase = mealEvidenceCaseSchema.parse(rawNextCase);
  const index = existingCases.findIndex(
    (evidenceCase) => evidenceCase.id === nextCase.id,
  );
  if (index < 0) {
    return mealEvidenceCaseListSchema.parse([...existingCases, nextCase]);
  }

  const previous = existingCases[index];
  if (
    previous.classId !== nextCase.classId ||
    previous.servedOn !== nextCase.servedOn ||
    previous.sourceKind !== nextCase.sourceKind ||
    previous.createdAt !== nextCase.createdAt
  ) {
    throw new Error("更新既有案件時不可更改身分、日期、來源或建立時間");
  }
  const previousUpdatedTime = Date.parse(previous.updatedAt);
  const nextUpdatedTime = Date.parse(nextCase.updatedAt);
  if (nextUpdatedTime < previousUpdatedTime) {
    throw new Error("不可用較舊版本覆寫證據案件");
  }
  if (
    nextUpdatedTime === previousUpdatedTime &&
    stableJson(previous) !== stableJson(nextCase)
  ) {
    throw new Error("相同更新時間出現不同內容，請先處理版本衝突");
  }
  const result = existingCases.map((evidenceCase, candidateIndex) =>
    candidateIndex === index ? nextCase : evidenceCase,
  );
  return mealEvidenceCaseListSchema.parse(result);
}

function demoMeasurement(
  caseIndex: number,
  suffix: string,
  source: WasteMeasurement["source"],
  netG: number,
  options: Partial<
    Pick<WasteMeasurement, "drainage" | "method" | "foodCategory">
  > = {},
) {
  const tareG = 300;
  return wasteMeasurementSchema.parse({
    id: `demo-${caseIndex}-${suffix}`,
    source,
    grossG: tareG + netG,
    tareG,
    netG,
    drainage: options.drainage ?? "standard-drained",
    method: options.method ?? "scale",
    foodCategory: options.foodCategory,
  });
}

const DEMO_CASE_ROWS = [
  {
    servedOn: "2026-09-04",
    unservedG: 3_200,
    vegetablePlateG: 2_100,
    otherPlateG: 500,
    sampleSupplyG: 11_000,
  },
  {
    servedOn: "2026-09-18",
    unservedG: 2_800,
    vegetablePlateG: 1_900,
    otherPlateG: 500,
    sampleSupplyG: 11_200,
  },
  {
    servedOn: "2026-10-02",
    unservedG: 3_000,
    vegetablePlateG: 2_000,
    otherPlateG: 600,
    sampleSupplyG: 10_800,
  },
] as const;

/** Fixed, conspicuously labelled demo evidence. No random values or clock. */
export function createDemoEvidenceCases(): MealEvidenceCase[] {
  return DEMO_CASE_ROWS.map((row, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    const draftMenu = importMenuVersion([
      {
        source: "demo",
        menuId: `demo-menu-${index}`,
        servedOn: row.servedOn,
        fingerprint: "foodlens-live-judge-demo",
      },
    ]);
    const menuVersion = confirmMenuVersion(draftMenu, {
      reviewedBy: "FoodLens 示範學生小組",
      reviewedAt: `${row.servedOn}T02:00:00.000Z`,
      notes: "示範菜單：已人工確認 Mock OCR，不代表學校實際供餐。",
      acceptedLowConfidence: collectLowConfidenceAcceptances(draftMenu),
    });
    const createdAt = `${row.servedOn}T05:00:00.000Z`;
    const updatedAt = `${row.servedOn}T06:00:00.000Z`;
    return mealEvidenceCaseSchema.parse({
      id: `demo-evidence-${index}`,
      classId: "class-5a",
      servedOn: row.servedOn,
      sourceKind: "demo",
      menuVersion,
      plannedDiners: 30,
      actualDiners: 27,
      suppliedEdibleG: 20_000,
      observedDiners: 18,
      plateSampleSupplyG: row.sampleSupplyG,
      measurements: [
        demoMeasurement(index, "prep", "prep", 600, { drainage: "wet" }),
        demoMeasurement(index, "unserved", "unserved-edible", row.unservedG),
        demoMeasurement(
          index,
          "plate-vegetable",
          "plate-edible",
          row.vegetablePlateG,
          { foodCategory: "vegetable" },
        ),
        demoMeasurement(index, "plate-other", "plate-edible", row.otherPlateG, {
          foodCategory: "meat",
        }),
        demoMeasurement(index, "inedible", "inedible", 700),
        demoMeasurement(index, "liquid", "liquid-contaminated", 500, {
          drainage: "wet",
        }),
      ],
      feedbackSchemaVersion: 2,
      reasonCollectionStatus: "collected",
      reasonCounts: {
        portion: 4,
        taste: 5,
        texture: 4,
        temperature: 0,
        time: 1,
        other: 1,
      },
      teacherContext: {
        deliveryStatus: "recorded",
        temperatureStatus: "recorded",
        specialEvent: index === 2 ? "示範情境：上午有班級活動" : undefined,
        deliveryDelayMinutes: 4,
        temperatureConcern: false,
        note: "固定 Demo 情境，所有數字均為模擬。",
      },
      humanDecision:
        index === 3
          ? {
              cardId: "headcount-reserve",
              choice: "pilot",
              rationale: "示範由營養師保留添餐能力後，小幅試行人數與備餐調整。",
              decidedAt: `${row.servedOn}T05:30:00.000Z`,
              decidedByRole: "dietitian",
            }
          : undefined,
      createdAt,
      updatedAt,
    });
  });
}

export function findDecisionForCard(
  evidenceCase: MealEvidenceCase,
  card: ResponsibilityCard,
) {
  return evidenceCase.humanDecision?.cardId === card.id
    ? evidenceCase.humanDecision
    : undefined;
}
