import { z } from "zod";
import { FOOD_CATEGORIES } from "@/lib/types";

export const WASTE_SOURCES = [
  "prep",
  "unserved-edible",
  "plate-edible",
  "inedible",
  "liquid-contaminated",
] as const;

export const DRAINAGE_STATES = [
  "wet",
  "standard-drained",
  "dewatered",
] as const;

export const WASTE_MEASUREMENT_METHODS = [
  "scale",
  "ai-estimate",
  "manual-band",
] as const;

export const RESPONSIBILITY_KINDS = [
  "headcount-reserve",
  "recipe-texture",
  "delivery",
  "vegetable-guardrail",
  "need-more-data",
] as const;

export const RESPONSIBILITY_OWNERS = [
  "lunch-secretary",
  "dietitian",
  "caterer",
  "teacher-student-team",
  "school-committee",
] as const;

export const WASTE_RULE_THRESHOLDS = {
  minimumIndependentMeals: 3,
  strongIndependentMeals: 5,
  minimumPlateCoverageRate: 0.5,
  minimumEvidenceQuality: 0.65,
  highUnservedRate: 0.1,
  highPlateRate: 0.2,
  attendanceGapRate: 0.08,
  feedbackSignalRate: 0.25,
  minimumFeedbackSignals: 3,
  deliveryDelayMinutes: 15,
  vegetablePlateShare: 0.4,
} as const;

const gramSchema = z.number().int().min(0).max(50_000_000);
const countSchema = z.number().int().min(0).max(20_000);
const ratioSchema = z.number().min(0).max(1);

export const wasteSourceSchema = z.enum(WASTE_SOURCES);
export const drainageStateSchema = z.enum(DRAINAGE_STATES);
export const wasteMeasurementMethodSchema = z.enum(WASTE_MEASUREMENT_METHODS);

/**
 * A weight is auditable only when all three values are retained. Net weight is
 * repeated deliberately so imports and handwritten logs can be checked rather
 * than silently trusting a derived value.
 */
export const wasteMeasurementSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    source: wasteSourceSchema,
    grossG: gramSchema,
    tareG: gramSchema,
    netG: gramSchema,
    drainage: drainageStateSchema,
    method: wasteMeasurementMethodSchema,
    foodCategory: z.enum(FOOD_CATEGORIES).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((measurement, context) => {
    if (measurement.grossG < measurement.tareG) {
      context.addIssue({
        code: "custom",
        path: ["grossG"],
        message: "毛重不可小於皮重",
      });
    }
    if (measurement.netG !== measurement.grossG - measurement.tareG) {
      context.addIssue({
        code: "custom",
        path: ["netG"],
        message: "淨重必須等於毛重減去皮重",
      });
    }
  });

export const wasteFeedbackSchema = z
  .object({
    responseCount: countSchema,
    portionTooMuchCount: countSchema.default(0),
    tasteIssueCount: countSchema.default(0),
    textureIssueCount: countSchema.default(0),
    temperatureIssueCount: countSchema.default(0),
  })
  .strict()
  .superRefine((feedback, context) => {
    const entries = [
      ["portionTooMuchCount", feedback.portionTooMuchCount],
      ["tasteIssueCount", feedback.tasteIssueCount],
      ["textureIssueCount", feedback.textureIssueCount],
      ["temperatureIssueCount", feedback.temperatureIssueCount],
    ] as const;
    entries.forEach(([key, value]) => {
      if (value > feedback.responseCount) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "原因票數不可高於回覆人數",
        });
      }
    });
  });

export const wasteDeliveryContextSchema = z
  .object({
    delayMinutes: z.number().int().min(0).max(1_440).nullable().default(null),
    temperatureConcern: z.boolean().nullable().default(null),
  })
  .strict();

export const wasteObservationContextSchema = z
  .object({
    menuName: z.string().trim().min(1).max(160),
    classId: z.string().trim().min(1).max(160).optional(),
    supplierId: z.string().trim().min(1).max(160).optional(),
    includesVegetable: z.boolean().default(false),
    specialEvent: z.string().trim().min(1).max(200).optional(),
    feedback: wasteFeedbackSchema.optional(),
    delivery: wasteDeliveryContextSchema.optional(),
  })
  .strict();

function measurementTotal(
  measurements: readonly z.infer<typeof wasteMeasurementSchema>[],
  source: z.infer<typeof wasteSourceSchema>,
) {
  return measurements.reduce(
    (sum, measurement) =>
      sum + (measurement.source === source ? measurement.netG : 0),
    0,
  );
}

/**
 * One observation represents one class or serving group on one serving date.
 * `observedDiners` is the number of diners represented by plate measurements;
 * unserved food is still a whole-group measurement. An explicit
 * `plateSampleSupplyG` is preferred. If absent, the engine estimates the sample
 * denominator from diner coverage and discloses that in its result.
 */
export const wasteObservationSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    servedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    suppliedEdibleG: gramSchema.refine((value) => value > 0, {
      message: "供應可食重量必須大於 0",
    }),
    plannedDiners: countSchema.refine((value) => value > 0, {
      message: "預計用餐人數必須大於 0",
    }),
    actualDiners: countSchema,
    observedDiners: countSchema,
    plateSampleSupplyG: gramSchema.optional(),
    measurements: z.array(wasteMeasurementSchema).min(1).max(200),
    context: wasteObservationContextSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.observedDiners > observation.actualDiners) {
      context.addIssue({
        code: "custom",
        path: ["observedDiners"],
        message: "盤後觀察人數不可高於實到用餐人數",
      });
    }

    const measurementIds = new Set<string>();
    observation.measurements.forEach((measurement, index) => {
      if (measurementIds.has(measurement.id)) {
        context.addIssue({
          code: "custom",
          path: ["measurements", index, "id"],
          message: "同一餐期的量測編號不可重複",
        });
      }
      measurementIds.add(measurement.id);
    });

    const unservedG = measurementTotal(
      observation.measurements,
      "unserved-edible",
    );
    const plateG = measurementTotal(observation.measurements, "plate-edible");
    if (unservedG + plateG > observation.suppliedEdibleG) {
      context.addIssue({
        code: "custom",
        path: ["measurements"],
        message: "可食剩食總量不可高於供應可食重量",
      });
    }

    const hasPlateMeasurement = observation.measurements.some(
      (measurement) => measurement.source === "plate-edible",
    );
    if (hasPlateMeasurement && observation.observedDiners === 0) {
      context.addIssue({
        code: "custom",
        path: ["observedDiners"],
        message: "有盤後量測時必須記錄至少一位觀察用餐者",
      });
    }
    if (!hasPlateMeasurement && observation.observedDiners > 0) {
      context.addIssue({
        code: "custom",
        path: ["observedDiners"],
        message: "沒有盤後量測時，盤後觀察人數必須為 0",
      });
    }

    const servedG = Math.max(0, observation.suppliedEdibleG - unservedG);
    const estimatedSampleSupplyG =
      observation.actualDiners > 0
        ? servedG * (observation.observedDiners / observation.actualDiners)
        : 0;
    const sampleSupplyG =
      observation.plateSampleSupplyG ?? estimatedSampleSupplyG;
    if (observation.plateSampleSupplyG !== undefined && !hasPlateMeasurement) {
      context.addIssue({
        code: "custom",
        path: ["plateSampleSupplyG"],
        message: "沒有盤後量測時不可填寫抽樣供應重量",
      });
    }
    if (sampleSupplyG > servedG) {
      context.addIssue({
        code: "custom",
        path: ["plateSampleSupplyG"],
        message: "抽樣餐盤供應重量不可高於實際供出的可食重量",
      });
    }
    if (plateG > sampleSupplyG) {
      context.addIssue({
        code: "custom",
        path: ["measurements"],
        message: "餐盤可食剩食不可高於抽樣餐盤原供應重量",
      });
    }
  });

export const wasteIntelligenceInputSchema = z
  .object({
    observations: z.array(wasteObservationSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((input, context) => {
    const observationIds = new Set<string>();
    input.observations.forEach((observation, index) => {
      if (observationIds.has(observation.id)) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "id"],
          message: "餐期觀察編號不可重複",
        });
      }
      observationIds.add(observation.id);
    });
  });

export const wasteMetricsSchema = z
  .object({
    observationCount: z.number().int().min(1),
    independentMealCount: z.number().int().min(1),
    suppliedEdibleG: gramSchema,
    measuredPrepG: gramSchema,
    measuredUnservedEdibleG: gramSchema,
    measuredPlateEdibleG: gramSchema,
    estimatedPlateEdibleG: gramSchema,
    measuredInedibleG: gramSchema,
    measuredLiquidContaminatedG: gramSchema,
    plateSampleSupplyG: gramSchema,
    weightedPlateRate: ratioSchema,
    unservedRate: ratioSchema,
    avoidableRate: ratioSchema,
    coverageRate: ratioSchema,
    evidenceQuality: ratioSchema,
    standardDrainageCoverageRate: ratioSchema,
    drainageComparable: z.boolean(),
    plateEstimateExtrapolated: z.boolean(),
  })
  .strict();

export const responsibilityEvidenceSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    value: z.number().optional(),
    unit: z.enum(["ratio", "grams", "people", "minutes", "count"]),
    detail: z.string().trim().min(1).max(500),
  })
  .strict();

export const responsibilityCardSchema = z
  .object({
    id: z.enum(RESPONSIBILITY_KINDS),
    title: z.string().trim().min(1).max(120),
    evidence: z.array(responsibilityEvidenceSchema).min(1).max(8),
    owner: z
      .object({
        primary: z.enum(RESPONSIBILITY_OWNERS),
        collaborators: z.array(z.enum(RESPONSIBILITY_OWNERS)).max(4),
      })
      .strict(),
    action: z.string().trim().min(1).max(800),
    guardrail: z.string().trim().min(1).max(800),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export const wasteIntelligenceResultSchema = z
  .object({
    metrics: wasteMetricsSchema,
    responsibilityCards: z.array(responsibilityCardSchema).min(1).max(5),
  })
  .strict();

export type WasteSource = z.infer<typeof wasteSourceSchema>;
export type DrainageState = z.infer<typeof drainageStateSchema>;
export type WasteMeasurementMethod = z.infer<
  typeof wasteMeasurementMethodSchema
>;
export type WasteMeasurement = z.infer<typeof wasteMeasurementSchema>;
export type WasteFeedback = z.infer<typeof wasteFeedbackSchema>;
export type WasteObservationContext = z.infer<
  typeof wasteObservationContextSchema
>;
export type WasteObservation = z.infer<typeof wasteObservationSchema>;
export type WasteIntelligenceInput = z.infer<
  typeof wasteIntelligenceInputSchema
>;
export type WasteMetrics = z.infer<typeof wasteMetricsSchema>;
export type ResponsibilityEvidence = z.infer<
  typeof responsibilityEvidenceSchema
>;
export type ResponsibilityCard = z.infer<typeof responsibilityCardSchema>;
export type WasteIntelligenceResult = z.infer<
  typeof wasteIntelligenceResultSchema
>;

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

function roundedRatio(value: number) {
  return Number(value.toFixed(6));
}

function measurementQuality(measurement: WasteMeasurement) {
  const methodQuality = {
    scale: 1,
    "ai-estimate": 0.55,
    "manual-band": 0.4,
  }[measurement.method];
  const drainageQuality = {
    "standard-drained": 1,
    dewatered: 0.85,
    wet: 0.7,
  }[measurement.drainage];
  return methodQuality * drainageQuality;
}

function weightedMeasurementQuality(measurements: WasteMeasurement[]) {
  const totalWeight = measurements.reduce(
    (sum, measurement) => sum + measurement.netG,
    0,
  );
  if (totalWeight === 0) {
    return measurements.length
      ? measurements.reduce(
          (sum, measurement) => sum + measurementQuality(measurement),
          0,
        ) / measurements.length
      : 0;
  }
  return (
    measurements.reduce(
      (sum, measurement) =>
        sum + measurementQuality(measurement) * measurement.netG,
      0,
    ) / totalWeight
  );
}

function relevantEdibleMeasurements(input: WasteIntelligenceInput) {
  return input.observations.flatMap((observation) =>
    observation.measurements.filter(
      (measurement) =>
        measurement.source === "unserved-edible" ||
        measurement.source === "plate-edible",
    ),
  );
}

export function calculateWasteMetrics(
  input: WasteIntelligenceInput,
): WasteMetrics {
  const observations = input.observations;
  const measurements = observations.flatMap(
    (observation) => observation.measurements,
  );
  const suppliedEdibleG = observations.reduce(
    (sum, observation) => sum + observation.suppliedEdibleG,
    0,
  );
  const totalBySource = (source: WasteSource) =>
    measurements.reduce(
      (sum, measurement) =>
        sum + (measurement.source === source ? measurement.netG : 0),
      0,
    );
  const measuredUnservedEdibleG = totalBySource("unserved-edible");
  const measuredPlateEdibleG = totalBySource("plate-edible");

  let plateSampleSupplyG = 0;
  let estimatedPlateEdibleG = 0;
  let observedDiners = 0;
  let actualDiners = 0;
  observations.forEach((observation) => {
    const unservedG = measurementTotal(
      observation.measurements,
      "unserved-edible",
    );
    const plateG = measurementTotal(observation.measurements, "plate-edible");
    const servedG = Math.max(0, observation.suppliedEdibleG - unservedG);
    const hasPlateMeasurement = observation.measurements.some(
      (measurement) => measurement.source === "plate-edible",
    );
    actualDiners += observation.actualDiners;
    if (!hasPlateMeasurement) return;
    observedDiners += observation.observedDiners;
    const sampleSupplyG =
      observation.plateSampleSupplyG ??
      (observation.actualDiners > 0
        ? servedG * (observation.observedDiners / observation.actualDiners)
        : 0);
    plateSampleSupplyG += sampleSupplyG;
    const observationPlateRate = ratio(plateG, sampleSupplyG);
    estimatedPlateEdibleG += Math.round(observationPlateRate * servedG);
  });

  const edibleMeasurements = relevantEdibleMeasurements(input);
  const standardDrainageWeight = edibleMeasurements.reduce(
    (sum, measurement) =>
      sum +
      (measurement.drainage === "standard-drained" ? measurement.netG : 0),
    0,
  );
  const totalEdibleMeasuredWeight = edibleMeasurements.reduce(
    (sum, measurement) => sum + measurement.netG,
    0,
  );
  const coverageRate = ratio(observedDiners, actualDiners);
  const result: WasteMetrics = {
    observationCount: observations.length,
    independentMealCount: new Set(
      observations.map((observation) => observation.servedOn),
    ).size,
    suppliedEdibleG,
    measuredPrepG: totalBySource("prep"),
    measuredUnservedEdibleG,
    measuredPlateEdibleG,
    estimatedPlateEdibleG,
    measuredInedibleG: totalBySource("inedible"),
    measuredLiquidContaminatedG: totalBySource("liquid-contaminated"),
    plateSampleSupplyG: Math.round(plateSampleSupplyG),
    weightedPlateRate: roundedRatio(
      ratio(measuredPlateEdibleG, plateSampleSupplyG),
    ),
    unservedRate: roundedRatio(ratio(measuredUnservedEdibleG, suppliedEdibleG)),
    avoidableRate: roundedRatio(
      ratio(measuredUnservedEdibleG + estimatedPlateEdibleG, suppliedEdibleG),
    ),
    coverageRate: roundedRatio(coverageRate),
    evidenceQuality: roundedRatio(
      weightedMeasurementQuality(edibleMeasurements),
    ),
    standardDrainageCoverageRate: roundedRatio(
      ratio(standardDrainageWeight, totalEdibleMeasuredWeight),
    ),
    drainageComparable:
      edibleMeasurements.length > 0 &&
      edibleMeasurements.every(
        (measurement) => measurement.drainage === "standard-drained",
      ),
    plateEstimateExtrapolated:
      measuredPlateEdibleG > 0 && coverageRate > 0 && coverageRate < 1,
  };
  return wasteMetricsSchema.parse(result);
}

function feedbackTotals(input: WasteIntelligenceInput) {
  return input.observations.reduce(
    (totals, observation) => {
      const feedback = observation.context.feedback;
      if (!feedback) return totals;
      totals.responseCount += feedback.responseCount;
      totals.portionTooMuchCount += feedback.portionTooMuchCount;
      totals.tasteIssueCount += feedback.tasteIssueCount;
      totals.textureIssueCount += feedback.textureIssueCount;
      totals.temperatureIssueCount += feedback.temperatureIssueCount;
      return totals;
    },
    {
      responseCount: 0,
      portionTooMuchCount: 0,
      tasteIssueCount: 0,
      textureIssueCount: 0,
      temperatureIssueCount: 0,
    },
  );
}

function lowerConfidence(confidence: ResponsibilityCard["confidence"]) {
  return confidence === "high" ? "medium" : "low";
}

function evidenceConfidence(
  metrics: WasteMetrics,
  options: {
    needsPlateCoverage?: boolean;
    needsDrainage?: boolean;
    signalIndependentMeals?: number;
  } = {},
): ResponsibilityCard["confidence"] {
  const independentMeals = Math.min(
    metrics.independentMealCount,
    options.signalIndependentMeals ?? metrics.independentMealCount,
  );
  let confidence: ResponsibilityCard["confidence"] =
    independentMeals >= WASTE_RULE_THRESHOLDS.strongIndependentMeals
      ? "high"
      : independentMeals >= WASTE_RULE_THRESHOLDS.minimumIndependentMeals
        ? "medium"
        : "low";
  if (metrics.evidenceQuality < WASTE_RULE_THRESHOLDS.minimumEvidenceQuality)
    confidence = lowerConfidence(confidence);
  if (
    options.needsPlateCoverage &&
    metrics.coverageRate < WASTE_RULE_THRESHOLDS.minimumPlateCoverageRate
  )
    confidence = "low";
  if (options.needsDrainage && !metrics.drainageComparable)
    confidence = lowerConfidence(confidence);
  return confidence;
}

function proportionEvidence(
  code: string,
  label: string,
  value: number,
  detail: string,
): ResponsibilityEvidence {
  return { code, label, value, unit: "ratio", detail };
}

export function generateResponsibilityCards(
  input: WasteIntelligenceInput,
  metrics = calculateWasteMetrics(input),
): ResponsibilityCard[] {
  const cards: ResponsibilityCard[] = [];
  const feedback = feedbackTotals(input);
  const feedbackObservations = input.observations.filter(
    (row) => row.context.feedback !== undefined,
  );
  const independentDays = (rows: readonly WasteObservation[]) =>
    new Set(rows.map((row) => row.servedOn)).size;
  const feedbackDays = independentDays(
    feedbackObservations.filter(
      (row) => row.context.feedback!.responseCount > 0,
    ),
  );
  const plannedDiners = input.observations.reduce(
    (sum, observation) => sum + observation.plannedDiners,
    0,
  );
  const actualDiners = input.observations.reduce(
    (sum, observation) => sum + observation.actualDiners,
    0,
  );
  const attendanceGapRate = ratio(
    Math.max(0, plannedDiners - actualDiners),
    plannedDiners,
  );
  const portionSignalRate = ratio(
    feedback.portionTooMuchCount,
    feedback.responseCount,
  );

  if (
    metrics.unservedRate >= WASTE_RULE_THRESHOLDS.highUnservedRate ||
    attendanceGapRate >= WASTE_RULE_THRESHOLDS.attendanceGapRate ||
    (feedback.portionTooMuchCount >=
      WASTE_RULE_THRESHOLDS.minimumFeedbackSignals &&
      portionSignalRate >= WASTE_RULE_THRESHOLDS.feedbackSignalRate)
  ) {
    cards.push({
      id: "headcount-reserve",
      title: "先核對人數與備餐，不急著縮小每份營養",
      evidence: [
        proportionEvidence(
          "unserved-rate",
          "未供出率",
          metrics.unservedRate,
          `共有 ${metrics.measuredUnservedEdibleG}g 可食餐點未供出。`,
        ),
        proportionEvidence(
          "attendance-gap",
          "預計與實到落差",
          attendanceGapRate,
          `累計預計 ${plannedDiners} 人、實到 ${actualDiners} 人。`,
        ),
      ],
      owner: {
        primary: "lunch-secretary",
        collaborators: ["caterer", "dietitian"],
      },
      action:
        "先核對請假、活動與備餐紀錄，再由午餐秘書和供餐單位小幅調整人數預估或備餐量，下一次同類餐期另行驗證。",
      guardrail:
        "不得用總廚餘直接等比例減餐；須符合營養基準、保留現場添餐及合理備援，最後仍由營養師或學校決定。",
      confidence: evidenceConfidence(metrics, {
        signalIndependentMeals:
          metrics.unservedRate >= WASTE_RULE_THRESHOLDS.highUnservedRate ||
          attendanceGapRate >= WASTE_RULE_THRESHOLDS.attendanceGapRate
            ? undefined
            : feedbackDays,
      }),
    });
  }

  const recipeSignals = feedback.tasteIssueCount + feedback.textureIssueCount;
  const recipeSignalRate = ratio(recipeSignals, feedback.responseCount);
  if (
    metrics.weightedPlateRate >= WASTE_RULE_THRESHOLDS.highPlateRate &&
    recipeSignals >= WASTE_RULE_THRESHOLDS.minimumFeedbackSignals &&
    recipeSignalRate >= WASTE_RULE_THRESHOLDS.feedbackSignalRate
  ) {
    cards.push({
      id: "recipe-texture",
      title: "優先測試食譜與口感，而不是只減少份量",
      evidence: [
        proportionEvidence(
          "plate-rate",
          "加權盤後率",
          metrics.weightedPlateRate,
          `抽樣餐盤供應 ${metrics.plateSampleSupplyG}g，量到可食剩食 ${metrics.measuredPlateEdibleG}g。`,
        ),
        {
          code: "recipe-feedback",
          label: "口味或口感原因票數",
          value: recipeSignals,
          unit: "count",
          detail: `共 ${feedback.responseCount} 份匿名主要原因回覆，涵蓋 ${feedbackDays} 個有有效回覆的獨立供餐日；其中口味 ${feedback.tasteIssueCount} 票、口感 ${feedback.textureIssueCount} 票；每人每餐只計一票。`,
        },
      ],
      owner: {
        primary: "dietitian",
        collaborators: ["caterer", "teacher-student-team"],
      },
      action:
        "由營養師與供餐單位選擇一項可控變因，例如切法、軟硬、醬汁或烹調方式，維持其他條件後做一次小規模前後比較。",
      guardrail:
        "匿名回饋是原因線索，不等同因果；不可因少數偏好移除必要食物類別，改善後仍須檢查營養、滿意度與供應不足。",
      confidence: evidenceConfidence(metrics, {
        needsPlateCoverage: true,
        needsDrainage: true,
        signalIndependentMeals: feedbackDays,
      }),
    });
  }

  const observedDelays = input.observations.flatMap((observation) => {
    const delay = observation.context.delivery?.delayMinutes;
    return delay === null || delay === undefined ? [] : [delay];
  });
  const delayedObservations = input.observations.filter(
    (observation) =>
      observation.context.delivery?.delayMinutes !== null &&
      observation.context.delivery?.delayMinutes !== undefined &&
      observation.context.delivery.delayMinutes >=
        WASTE_RULE_THRESHOLDS.deliveryDelayMinutes,
  );
  const temperatureConcernCount = input.observations.filter(
    (observation) => observation.context.delivery?.temperatureConcern,
  ).length;
  const temperatureSignalRate = ratio(
    feedback.temperatureIssueCount,
    feedback.responseCount,
  );
  const temperatureFeedbackTriggered =
    feedback.temperatureIssueCount >=
      WASTE_RULE_THRESHOLDS.minimumFeedbackSignals &&
    temperatureSignalRate >= WASTE_RULE_THRESHOLDS.feedbackSignalRate;
  const deliveryEvidenceDays = [
    ...(delayedObservations.length
      ? [
          independentDays(
            input.observations.filter(
              (row) =>
                row.context.delivery?.delayMinutes !== null &&
                row.context.delivery?.delayMinutes !== undefined,
            ),
          ),
        ]
      : []),
    ...(temperatureConcernCount
      ? [
          independentDays(
            input.observations.filter(
              (row) =>
                row.context.delivery?.temperatureConcern !== null &&
                row.context.delivery?.temperatureConcern !== undefined,
            ),
          ),
        ]
      : []),
    ...(temperatureFeedbackTriggered ? [feedbackDays] : []),
  ];
  if (
    delayedObservations.length > 0 ||
    temperatureConcernCount > 0 ||
    temperatureFeedbackTriggered
  ) {
    const maximumDelay = observedDelays.length
      ? Math.max(...observedDelays)
      : undefined;
    cards.push({
      id: "delivery",
      title: "檢查送達、等待與食用溫度",
      evidence: [
        {
          code: "delivery-delay",
          label:
            maximumDelay === undefined
              ? "配送延遲尚無觀察紀錄"
              : "最長配送延遲",
          value: maximumDelay,
          unit: "minutes",
          detail: `已觀察 ${observedDelays.length}／${input.observations.length} 筆餐期；${delayedObservations.length} 筆達到 ${WASTE_RULE_THRESHOLDS.deliveryDelayMinutes} 分鐘延遲門檻。未觀察不當成 0 分鐘。`,
        },
        {
          code: "temperature-feedback",
          label: feedbackObservations.length
            ? "溫度原因票數"
            : "匿名溫度回饋尚未收集",
          value: feedbackObservations.length
            ? feedback.temperatureIssueCount
            : undefined,
          unit: "count",
          detail: `已收集匿名回覆 ${feedbackObservations.length}／${input.observations.length} 筆餐期，共 ${feedback.responseCount} 份有效回覆、${feedbackDays} 個有回覆的獨立供餐日。另有 ${temperatureConcernCount} 筆被現場標記溫度疑慮；未收集不當成 0 票。`,
        },
      ],
      owner: {
        primary: "caterer",
        collaborators: ["lunch-secretary", "teacher-student-team"],
      },
      action:
        "比對出餐、送達、分餐與開動時間，先修正可控制的動線或保溫環節，再以相似菜色確認盤後率是否同步變化。",
      guardrail:
        "學生主觀覺得冷只能作為線索；食安溫度與運送是否合規須由校方依實際量測、契約及衛生規範判定。",
      confidence: evidenceConfidence(metrics, {
        needsPlateCoverage: true,
        signalIndependentMeals: Math.min(...deliveryEvidenceDays),
      }),
    });
  }

  const plateMeasurements = input.observations.flatMap((observation) =>
    observation.measurements.filter(
      (measurement) => measurement.source === "plate-edible",
    ),
  );
  const vegetablePlateG = plateMeasurements.reduce(
    (sum, measurement) =>
      sum + (measurement.foodCategory === "vegetable" ? measurement.netG : 0),
    0,
  );
  const vegetablePlateShare = ratio(
    vegetablePlateG,
    metrics.measuredPlateEdibleG,
  );
  const includesVegetable = input.observations.some(
    (observation) => observation.context.includesVegetable,
  );
  if (
    includesVegetable &&
    metrics.weightedPlateRate >= WASTE_RULE_THRESHOLDS.highPlateRate &&
    vegetablePlateShare >= WASTE_RULE_THRESHOLDS.vegetablePlateShare
  ) {
    cards.push({
      id: "vegetable-guardrail",
      title: "蔬菜剩得多，先改善接受度並保留營養護欄",
      evidence: [
        proportionEvidence(
          "vegetable-plate-share",
          "蔬菜占盤後可食剩食",
          vegetablePlateShare,
          `盤後可食剩食中有 ${vegetablePlateG}g 標記為蔬菜。這是組成占比，不是蔬菜供應剩食率。`,
        ),
        proportionEvidence(
          "plate-rate",
          "加權盤後率",
          metrics.weightedPlateRate,
          "盤後率依抽樣餐盤原供應重量加權，未直接平均各筆百分比。",
        ),
      ],
      owner: {
        primary: "dietitian",
        collaborators: ["caterer", "teacher-student-team"],
      },
      action:
        "比較蔬菜品項、切法、軟硬度、烹調方式與菜色搭配；可先做小份初取、可再添餐或餐前認識食材的單一變因實驗。",
      guardrail:
        "不可因蔬菜剩食偏高就直接降低蔬菜營養供應；本卡不取代學校午餐營養基準及營養師專業判斷。",
      confidence: evidenceConfidence(metrics, {
        needsPlateCoverage: true,
        needsDrainage: true,
      }),
    });
  }

  const needsMoreData =
    metrics.independentMealCount <
      WASTE_RULE_THRESHOLDS.minimumIndependentMeals ||
    metrics.coverageRate < WASTE_RULE_THRESHOLDS.minimumPlateCoverageRate ||
    metrics.evidenceQuality < WASTE_RULE_THRESHOLDS.minimumEvidenceQuality ||
    !metrics.drainageComparable;
  if (needsMoreData || cards.length === 0) {
    const reasons = [
      metrics.independentMealCount <
      WASTE_RULE_THRESHOLDS.minimumIndependentMeals
        ? `目前只有 ${metrics.independentMealCount} 個獨立供餐日`
        : undefined,
      metrics.coverageRate < WASTE_RULE_THRESHOLDS.minimumPlateCoverageRate
        ? `盤後覆蓋率 ${(metrics.coverageRate * 100).toFixed(1)}%`
        : undefined,
      metrics.evidenceQuality < WASTE_RULE_THRESHOLDS.minimumEvidenceQuality
        ? `量測品質分數 ${(metrics.evidenceQuality * 100).toFixed(1)}%`
        : undefined,
      !metrics.drainageComparable ? "可食剩食未全部採標準瀝水" : undefined,
      cards.length === 0 ? "目前沒有其他規則達到行動門檻" : undefined,
    ].filter((reason): reason is string => Boolean(reason));
    cards.push({
      id: "need-more-data",
      title: "先補足可比較資料，再決定如何調整",
      evidence: [
        {
          code: "evidence-readiness",
          label: "證據準備度",
          value: metrics.independentMealCount,
          unit: "count",
          detail: reasons.join("；"),
        },
        proportionEvidence(
          "coverage-rate",
          "盤後覆蓋率",
          metrics.coverageRate,
          `盤後量測涵蓋的學生占實到用餐人數比例；門檻為 ${WASTE_RULE_THRESHOLDS.minimumPlateCoverageRate * 100}%。`,
        ),
      ],
      owner: {
        primary: "teacher-student-team",
        collaborators: ["lunch-secretary"],
      },
      action:
        "至少累積三個獨立供餐日，統一使用標準瀝水與同一量測範圍；若採餐盤抽樣，記錄觀察人數及抽樣餐盤原供應重量。",
      guardrail:
        "資料不足時只描述觀察，不產生自動減餐結論；Demo、AI 估算與人工區間不得冒充正式秤重。",
      confidence: "low",
    });
  }

  return z.array(responsibilityCardSchema).parse(cards);
}

export function analyzeWasteIntelligence(
  rawInput: unknown,
): WasteIntelligenceResult {
  const input = wasteIntelligenceInputSchema.parse(rawInput);
  const metrics = calculateWasteMetrics(input);
  return wasteIntelligenceResultSchema.parse({
    metrics,
    responsibilityCards: generateResponsibilityCards(input, metrics),
  });
}
