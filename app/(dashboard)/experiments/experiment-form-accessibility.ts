export const EXPERIMENT_FIELD_IDS = {
  title: "experiment-title",
  baselineStart: "experiment-baseline-start",
  baselineEnd: "experiment-baseline-end",
  classId: "experiment-class",
  interventionStart: "experiment-intervention-start",
  interventionEnd: "experiment-intervention-end",
  predictionId: "experiment-prediction",
  adoptionMode: "experiment-adoption-mode",
  adjustedSupplyKg: "experiment-adjusted-supply",
  adoptionNote: "experiment-adoption-note",
  description: "experiment-description",
  shortageReportCount: "experiment-shortage-count",
  refillRequestCount: "experiment-refill-count",
  satisfactionScore: "experiment-satisfaction-score",
  satisfactionResponseCount: "experiment-satisfaction-response-count",
  dietitianReview: "experiment-dietitian-review",
  guardrailCheckedAt: "experiment-guardrail-checked-at",
  dietitianNote: "experiment-dietitian-note",
  confounders: "experiment-confounders",
} as const;

export type ExperimentField = keyof typeof EXPERIMENT_FIELD_IDS;
export type ExperimentFieldErrors = Partial<Record<ExperimentField, string>>;

const EXPERIMENT_FIELD_ORDER = Object.keys(
  EXPERIMENT_FIELD_IDS,
) as ExperimentField[];

interface ExperimentDraftFields {
  title: string;
  baselineStart: string;
  baselineEnd: string;
  interventionStart: string;
  interventionEnd: string;
  description: string;
  guardrailCheckedAt: string;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function setFirstError(
  errors: ExperimentFieldErrors,
  field: ExperimentField,
  message: string,
) {
  if (!errors[field]) errors[field] = message;
}

export function validateExperimentDraftFields(
  form: ExperimentDraftFields,
): ExperimentFieldErrors {
  const errors: ExperimentFieldErrors = {};
  const title = form.title.trim();
  const description = form.description.trim();

  if (!title) setFirstError(errors, "title", "請填寫實驗名稱");
  else if (title.length > 160)
    setFirstError(errors, "title", "實驗名稱不可超過 160 個字");

  const dates: readonly [ExperimentField, string, string, string][] = [
    ["baselineStart", form.baselineStart, "基準期開始日", "請選擇基準期開始日"],
    ["baselineEnd", form.baselineEnd, "基準期結束日", "請選擇基準期結束日"],
    [
      "interventionStart",
      form.interventionStart,
      "改善期開始日",
      "請選擇改善期開始日",
    ],
    [
      "interventionEnd",
      form.interventionEnd,
      "改善期結束日",
      "請選擇改善期結束日",
    ],
  ];
  dates.forEach(([field, value, label, requiredMessage]) => {
    if (!value) setFirstError(errors, field, requiredMessage);
    else if (!isCalendarDate(value))
      setFirstError(errors, field, `${label}格式不正確`);
  });

  const validBaselineStart = isCalendarDate(form.baselineStart);
  const validBaselineEnd = isCalendarDate(form.baselineEnd);
  const validInterventionStart = isCalendarDate(form.interventionStart);
  const validInterventionEnd = isCalendarDate(form.interventionEnd);
  if (
    validBaselineStart &&
    validBaselineEnd &&
    form.baselineStart > form.baselineEnd
  )
    setFirstError(errors, "baselineEnd", "基準期結束日不可早於開始日");
  if (
    validInterventionStart &&
    validInterventionEnd &&
    form.interventionStart > form.interventionEnd
  )
    setFirstError(errors, "interventionEnd", "改善期結束日不可早於開始日");
  if (
    validBaselineEnd &&
    validInterventionStart &&
    form.baselineEnd >= form.interventionStart
  )
    setFirstError(
      errors,
      "interventionStart",
      "改善期必須在基準期結束後開始，兩段期間不可重疊",
    );

  if (!description) setFirstError(errors, "description", "請填寫實際介入方式");
  else if (description.length > 2000)
    setFirstError(errors, "description", "介入方式不可超過 2000 個字");

  if (!form.guardrailCheckedAt)
    setFirstError(errors, "guardrailCheckedAt", "請記錄供餐安全護欄的檢查時間");
  else if (Number.isNaN(new Date(form.guardrailCheckedAt).getTime()))
    setFirstError(
      errors,
      "guardrailCheckedAt",
      "供餐安全護欄的檢查時間格式不正確",
    );

  return errors;
}

export function safetyGuardrailErrorField(message: string): ExperimentField {
  if (message.includes("缺餐") || message.includes("吃不飽"))
    return "shortageReportCount";
  if (message.includes("添餐") || message.includes("補菜"))
    return "refillRequestCount";
  if (message.includes("回覆人數")) return "satisfactionResponseCount";
  if (message.includes("滿意度")) return "satisfactionScore";
  if (message.includes("確認狀態")) return "dietitianReview";
  if (message.includes("備註")) return "dietitianNote";
  if (message.includes("干擾因素")) return "confounders";
  return "guardrailCheckedAt";
}

export function predictionDecisionErrorField(message: string): ExperimentField {
  return message.includes("實際準備量") || message.includes("調整後採用量")
    ? "adjustedSupplyKg"
    : "predictionId";
}

function experimentIssueField(message: string): ExperimentField {
  if (message.includes("基準期開始日不可晚於結束日")) return "baselineEnd";
  if (message.includes("改善期開始日不可晚於結束日")) return "interventionEnd";
  if (message.includes("兩段期間不可重疊")) return "interventionStart";
  if (message.startsWith("基準期至少")) return "baselineEnd";
  if (message.startsWith("改善期至少")) return "interventionEnd";
  return "baselineStart";
}

export function experimentIssuesToFieldErrors(
  issues: readonly string[],
): ExperimentFieldErrors {
  const errors: ExperimentFieldErrors = {};
  issues.forEach((message) =>
    setFirstError(errors, experimentIssueField(message), message),
  );
  return errors;
}

export function experimentFieldErrorId(field: ExperimentField) {
  return `${EXPERIMENT_FIELD_IDS[field]}-error`;
}

export function experimentFieldDescription(
  field: ExperimentField,
  errors: ExperimentFieldErrors,
  ...descriptionIds: (string | undefined)[]
) {
  const ids = descriptionIds.filter(Boolean) as string[];
  if (errors[field]) ids.push(experimentFieldErrorId(field));
  return ids.length ? ids.join(" ") : undefined;
}

export function firstExperimentErrorField(errors: ExperimentFieldErrors) {
  return EXPERIMENT_FIELD_ORDER.find((field) => Boolean(errors[field]));
}

export function focusFirstExperimentError(
  errors: ExperimentFieldErrors,
  root: Document | HTMLElement = document,
) {
  const field = firstExperimentErrorField(errors);
  if (!field) return false;
  const control = root.querySelector<HTMLElement>(
    `#${EXPERIMENT_FIELD_IDS[field]}`,
  );
  control?.focus();
  return Boolean(control && control.ownerDocument.activeElement === control);
}
