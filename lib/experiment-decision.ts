import { z } from "zod";
import type {
  ExperimentSafetyGuardrails,
  ImprovementExperiment,
  PredictionAdoptionMode,
  PredictionDecisionTrace,
  SupplyPrediction,
} from "@/lib/types";

export const ADOPTION_MODE_LABELS: Record<PredictionAdoptionMode, string> = {
  pending: "待校方確認",
  recommended: "採用建議量",
  adjusted: "調整後採用",
  original: "維持原計畫",
};

export const DEFAULT_ADOPTION_NOTES: Record<PredictionAdoptionMode, string> = {
  pending: "待營養師或學校確認後，再補記實際採用量。",
  recommended: "以 FoodLens 建議量進行小規模試行，並保留現場補餐能力。",
  adjusted: "考量營養需求、出席與現場備援後，由學校調整採用量。",
  original: "本次不調整供餐量，保留建議作為後續觀察依據。",
};

interface DecisionInput {
  adoptionMode: PredictionAdoptionMode;
  adjustedSupplyG?: number;
  adoptionNote?: string;
  recordedAt?: string;
}

const traceSchema = z
  .object({
    predictionId: z.string().trim().min(1).max(200),
    predictionCreatedAt: z.string().trim().min(1).max(64),
    menuName: z.string().trim().min(1).max(160),
    plannedPeople: z.number().int().positive().max(5000),
    plannedSupplyG: z.number().int().positive().max(10_000_000),
    recommendedSupplyG: z.number().int().positive().max(10_000_000),
    adoptionMode: z.enum(["pending", "recommended", "adjusted", "original"]),
    adoptedSupplyG: z.number().int().positive().max(10_000_000).optional(),
    adoptionNote: z.string().trim().min(1).max(1000),
    recordedAt: z.string().trim().min(1).max(64),
  })
  .strict()
  .superRefine((trace, context) => {
    if (trace.recommendedSupplyG > trace.plannedSupplyG)
      context.addIssue({
        code: "custom",
        path: ["recommendedSupplyG"],
        message: "建議量不可高於原計畫",
      });
    const expected =
      trace.adoptionMode === "recommended"
        ? trace.recommendedSupplyG
        : trace.adoptionMode === "original"
          ? trace.plannedSupplyG
          : undefined;
    if (trace.adoptionMode === "pending" && trace.adoptedSupplyG !== undefined)
      context.addIssue({
        code: "custom",
        path: ["adoptedSupplyG"],
        message: "待確認狀態不可已有實際採用量",
      });
    if (expected !== undefined && trace.adoptedSupplyG !== expected)
      context.addIssue({
        code: "custom",
        path: ["adoptedSupplyG"],
        message: "採用量與採用方式不一致",
      });
    if (
      trace.adoptionMode === "adjusted" &&
      (trace.adoptedSupplyG === undefined ||
        trace.adoptedSupplyG < trace.recommendedSupplyG ||
        trace.adoptedSupplyG > trace.plannedSupplyG)
    )
      context.addIssue({
        code: "custom",
        path: ["adoptedSupplyG"],
        message: "調整後採用量必須介於建議量與原計畫之間",
      });
  });

const nullableEventCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(5000)
  .nullable();

const safetyGuardrailsSchema = z
  .object({
    shortageReportCount: nullableEventCountSchema,
    refillRequestCount: nullableEventCountSchema,
    satisfactionScore: z.number().finite().min(1).max(5).nullable(),
    satisfactionResponseCount: z.number().int().nonnegative().max(5000),
    dietitianReview: z.enum(["pending", "confirmed", "concern"]),
    dietitianNote: z.string().trim().max(1000),
    confounders: z.array(z.string().trim().min(1).max(160)).max(20),
    checkedAt: z.string().datetime({ offset: true }).max(64),
  })
  .strict()
  .superRefine((guardrails, context) => {
    if (
      guardrails.satisfactionScore === null &&
      guardrails.satisfactionResponseCount !== 0
    )
      context.addIssue({
        code: "custom",
        path: ["satisfactionResponseCount"],
        message: "尚未填寫滿意度時，回覆人數必須為 0",
      });
    if (
      guardrails.satisfactionScore !== null &&
      guardrails.satisfactionResponseCount === 0
    )
      context.addIssue({
        code: "custom",
        path: ["satisfactionResponseCount"],
        message: "填寫滿意度時，必須同時記錄回覆人數",
      });
  });

const CLOUD_VALUE_PREFIX_V1 = "[[FOODLENS_EXPERIMENT_DECISION_V1]]";
const CLOUD_VALUE_PREFIX_V2 = "[[FOODLENS_EXPERIMENT_V2]]";
const cloudPayloadV1Schema = z
  .object({
    version: z.literal(1),
    interventionDescription: z.string().trim().min(1).max(2000),
    decisionTrace: traceSchema,
  })
  .strict();
const cloudPayloadV2Schema = z
  .object({
    version: z.literal(2),
    interventionDescription: z.string().trim().min(1).max(2000),
    decisionTrace: traceSchema.optional(),
    safetyGuardrails: safetyGuardrailsSchema.optional(),
  })
  .strict();

export function validatePredictionDecision(
  prediction: SupplyPrediction,
  input: DecisionInput,
): string | undefined {
  if (prediction.recommendedSupplyG <= 0 || prediction.plannedSupplyG <= 0)
    return "這筆供餐建議缺少有效重量，請重新建立建議";
  if (prediction.recommendedSupplyG > prediction.plannedSupplyG)
    return "這筆建議量高於原計畫，無法建立減量採用紀錄";
  if (input.adoptionMode !== "adjusted") return undefined;
  if (
    !Number.isInteger(input.adjustedSupplyG) ||
    Number(input.adjustedSupplyG) <= 0
  )
    return "請輸入實際準備量";
  if (Number(input.adjustedSupplyG) < prediction.recommendedSupplyG)
    return "實際準備量不可低於 FoodLens 建議的安全參考量";
  if (Number(input.adjustedSupplyG) > prediction.plannedSupplyG)
    return "調整後採用量不可高於原計畫；若不採用建議，請選擇「維持原計畫」";
  return undefined;
}

export function createPredictionDecisionTrace(
  prediction: SupplyPrediction,
  input: DecisionInput,
): PredictionDecisionTrace {
  const issue = validatePredictionDecision(prediction, input);
  if (issue) throw new Error(issue);
  const adoptedSupplyG =
    input.adoptionMode === "recommended"
      ? prediction.recommendedSupplyG
      : input.adoptionMode === "adjusted"
        ? input.adjustedSupplyG
        : input.adoptionMode === "original"
          ? prediction.plannedSupplyG
          : undefined;
  return {
    predictionId: prediction.id,
    predictionCreatedAt: prediction.createdAt,
    menuName: prediction.menuName,
    plannedPeople: prediction.plannedPeople,
    plannedSupplyG: prediction.plannedSupplyG,
    recommendedSupplyG: prediction.recommendedSupplyG,
    adoptionMode: input.adoptionMode,
    adoptedSupplyG,
    adoptionNote:
      input.adoptionNote?.trim() || DEFAULT_ADOPTION_NOTES[input.adoptionMode],
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}

/**
 * 首版雲端 schema 只有 intervention_description 文字欄位。用帶版本的封裝保存
 * 決策與安全護欄，避免產品增量破壞既有校園資料；純文字與 V1 決策封裝仍可讀取。
 */
export function encodeExperimentDescription(
  experiment: ImprovementExperiment,
): string {
  if (!experiment.decisionTrace && !experiment.safetyGuardrails)
    return experiment.interventionDescription;
  const payload = cloudPayloadV2Schema.parse({
    version: 2,
    interventionDescription: experiment.interventionDescription,
    decisionTrace: experiment.decisionTrace,
    safetyGuardrails: experiment.safetyGuardrails,
  });
  return `${CLOUD_VALUE_PREFIX_V2}${JSON.stringify(payload)}`;
}

export function decodeExperimentDescription(
  value: string,
): Pick<
  ImprovementExperiment,
  "interventionDescription" | "decisionTrace" | "safetyGuardrails"
> {
  const parse = <T>(prefix: string, schema: z.ZodType<T>) => {
    if (!value.startsWith(prefix)) return undefined;
    try {
      return schema.safeParse(JSON.parse(value.slice(prefix.length)));
    } catch {
      return undefined;
    }
  };

  const parsedV2 = parse(CLOUD_VALUE_PREFIX_V2, cloudPayloadV2Schema);
  if (parsedV2?.success)
    return {
      interventionDescription: parsedV2.data.interventionDescription,
      decisionTrace: parsedV2.data.decisionTrace,
      safetyGuardrails: parsedV2.data.safetyGuardrails,
    };

  const parsedV1 = parse(CLOUD_VALUE_PREFIX_V1, cloudPayloadV1Schema);
  if (parsedV1?.success)
    return {
      interventionDescription: parsedV1.data.interventionDescription,
      decisionTrace: parsedV1.data.decisionTrace,
    };

  return { interventionDescription: value };
}

export function experimentSafetyGuardrailsSchema() {
  return safetyGuardrailsSchema;
}

export function validateExperimentSafetyGuardrails(
  value: ExperimentSafetyGuardrails,
): string | undefined {
  const parsed = safetyGuardrailsSchema.safeParse(value);
  if (parsed.success) return undefined;
  return safetyGuardrailIssueMessage(parsed.error);
}

export function dietitianReviewLabel(
  value: ExperimentSafetyGuardrails["dietitianReview"],
) {
  return {
    pending: "待營養師確認",
    confirmed: "營養師已確認",
    concern: "有疑慮，需調整",
  }[value];
}

export function formatGuardrailMeasurement(value: number | null) {
  return value === null ? "未量測" : `${value} 人次`;
}

export function formatGuardrailSatisfaction(value: ExperimentSafetyGuardrails) {
  return value.satisfactionScore === null
    ? "未量測"
    : `${value.satisfactionScore.toFixed(1)} / 5（${value.satisfactionResponseCount} 份）`;
}

export function assertExperimentSafetyGuardrails(
  value: ExperimentSafetyGuardrails,
): ExperimentSafetyGuardrails {
  try {
    return safetyGuardrailsSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(safetyGuardrailIssueMessage(error));
    throw error;
  }
}

function safetyGuardrailIssueMessage(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "供餐安全護欄格式錯誤";
  if (issue.code === "custom") return issue.message;
  const field = String(issue.path[0] ?? "");
  const labels: Record<string, string> = {
    shortageReportCount: "缺餐／吃不飽回報人次",
    refillRequestCount: "添餐／補菜人次",
    satisfactionScore: "滿意度平均",
    satisfactionResponseCount: "滿意度回覆人數",
    dietitianReview: "營養師確認狀態",
    dietitianNote: "營養師／午餐承辦備註",
    confounders: "可能干擾因素",
    checkedAt: "護欄檢查時間",
  };
  const label = labels[field];
  return `${label ?? "供餐安全護欄"}格式或範圍不正確`;
}

export function predictionDecisionTraceSchema() {
  return traceSchema;
}
