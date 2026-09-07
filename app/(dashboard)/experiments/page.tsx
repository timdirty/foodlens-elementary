"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Beaker,
  CalendarRange,
  CheckCircle2,
  FlaskConical,
  Link2,
  Plus,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useFoodLens } from "@/components/data-provider";
import { MealSafetyComparisonPanel } from "@/components/experiments/meal-safety-comparison";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import {
  className,
  experimentResult,
  validateExperiment,
} from "@/lib/analysis";
import { createUuid } from "@/lib/crypto";
import {
  ADOPTION_MODE_LABELS,
  assertExperimentSafetyGuardrails,
  createPredictionDecisionTrace,
  DEFAULT_ADOPTION_NOTES,
  dietitianReviewLabel,
  formatGuardrailMeasurement,
  formatGuardrailSatisfaction,
  validatePredictionDecision,
} from "@/lib/experiment-decision";
import { sortPredictionsNewestFirst } from "@/lib/prediction";
import { getRovingTabTargetIndex } from "@/lib/tab-navigation";
import type {
  DietitianReviewStatus,
  ImprovementExperiment,
  PredictionAdoptionMode,
} from "@/lib/types";
import { kg } from "@/lib/utils";
import {
  EXPERIMENT_FIELD_IDS,
  experimentFieldDescription,
  experimentFieldErrorId,
  experimentIssuesToFieldErrors,
  firstExperimentErrorField,
  focusFirstExperimentError,
  predictionDecisionErrorField,
  safetyGuardrailErrorField,
  validateExperimentDraftFields,
  type ExperimentField,
  type ExperimentFieldErrors,
} from "./experiment-form-accessibility";

interface ExperimentFormState {
  title: string;
  baselineStart: string;
  baselineEnd: string;
  interventionStart: string;
  interventionEnd: string;
  classId: string;
  predictionId: string;
  description: string;
  adoptionMode: PredictionAdoptionMode;
  adjustedSupplyKg: number | "";
  adoptionNote: string;
  dietitianReview: DietitianReviewStatus;
  dietitianNote: string;
  confounders: string;
  guardrailCheckedAt: string;
}

function ExperimentFieldError({
  field,
  errors,
}: {
  field: ExperimentField;
  errors: ExperimentFieldErrors;
}) {
  const message = errors[field];
  if (!message) return null;
  return (
    <small
      className="experiment-field-error"
      id={experimentFieldErrorId(field)}
    >
      {message}
    </small>
  );
}

export default function ExperimentsPage() {
  return (
    <Suspense
      fallback={
        <div className="page-wrap">
          <LoadingState />
        </div>
      }
    >
      <ExperimentsPageContent />
    </Suspense>
  );
}

function ExperimentsPageContent() {
  const { snapshot, loading, repository, refresh, mode, filters } =
    useFoodLens();
  const searchParams = useSearchParams();
  const createFromDecision = searchParams.get("create") === "1";
  const requestedPredictionId = searchParams.get("prediction") ?? "";
  const [selectedId, setSelectedId] = useState("experiment-demo-1");
  const [showForm, setShowForm] = useState(createFromDecision);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<ExperimentFieldErrors>({});
  const [form, setForm] = useState<ExperimentFormState>({
    title: "新的供餐改善實驗",
    baselineStart: mode === "demo-local" ? "2026-08-24" : "",
    baselineEnd: mode === "demo-local" ? "2026-08-28" : "",
    interventionStart: mode === "demo-local" ? "2026-10-14" : "",
    interventionEnd: mode === "demo-local" ? "2026-10-16" : "",
    classId: "",
    predictionId: requestedPredictionId,
    description: "記錄實際採用的調整方式",
    adoptionMode: "pending" as PredictionAdoptionMode,
    adjustedSupplyKg: "" as number | "",
    adoptionNote: DEFAULT_ADOPTION_NOTES.pending,
    dietitianReview: "pending" as DietitianReviewStatus,
    dietitianNote: "",
    confounders: "",
    guardrailCheckedAt: mode === "demo-local" ? "2026-10-16T13:30" : "",
  });
  const clearFieldErrors = (...fields: ExperimentField[]) => {
    setFieldErrors((current) => {
      const next = { ...current };
      let changed = false;
      fields.forEach((field) => {
        if (!next[field]) return;
        delete next[field];
        changed = true;
      });
      return changed ? next : current;
    });
  };
  const updateFormField = <
    Field extends ExperimentField & keyof ExperimentFormState,
  >(
    field: Field,
    value: ExperimentFormState[Field],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearFieldErrors(field);
  };
  const reportValidationErrors = (
    errors: ExperimentFieldErrors,
    summary?: string,
  ) => {
    const firstField = firstExperimentErrorField(errors);
    if (!firstField) return false;
    const message = summary ?? errors[firstField] ?? "請修正標示的欄位";
    setFieldErrors(errors);
    setSaveError(message);
    toast.error(message);
    window.requestAnimationFrame(() => focusFirstExperimentError(errors));
    return true;
  };
  const fieldAccessibility = (
    field: ExperimentField,
    ...descriptionIds: (string | undefined)[]
  ) => ({
    id: EXPERIMENT_FIELD_IDS[field],
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": experimentFieldDescription(
      field,
      fieldErrors,
      ...descriptionIds,
    ),
    "aria-errormessage": fieldErrors[field]
      ? experimentFieldErrorId(field)
      : undefined,
  });
  if (loading || !snapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  const savedPredictions = sortPredictionsNewestFirst(snapshot.predictions);
  const formPrediction = savedPredictions.find(
    (item) => item.id === form.predictionId,
  );
  const globalClassLabel =
    filters.classId === "all"
      ? "全部班級"
      : className(snapshot, filters.classId);
  const globalRangeLabel = {
    "8-weeks": "近 8 週",
    month: "本月",
    all: "全部期間",
  }[filters.range];
  const experiment =
    snapshot.experiments.find((item) => item.id === selectedId) ??
    snapshot.experiments[0];
  const experimentIndex = experiment
    ? snapshot.experiments.findIndex((item) => item.id === experiment.id)
    : -1;
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex = getRovingTabTargetIndex(
      event.key,
      index,
      snapshot.experiments.length,
    );
    if (nextIndex === undefined) return;
    event.preventDefault();
    setSelectedId(snapshot.experiments[nextIndex].id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  };
  // 每個實驗已定義自己的日期與班級範圍；全站篩選不應改寫實驗證據。
  const result = experimentResult(snapshot, experiment);
  const linkedPrediction = result?.experiment.linkedPredictionId
    ? snapshot.predictions.find(
        (item) => item.id === result.experiment.linkedPredictionId,
      )
    : undefined;
  const decisionTrace = result?.experiment.decisionTrace;
  const safetyGuardrails = result?.experiment.safetyGuardrails;
  const experimentClassScope = result?.experiment.classId
    ? className(snapshot, result.experiment.classId)
    : "全部班級";
  const save = async () => {
    if (saving) return;
    const draftErrors = validateExperimentDraftFields(form);
    if (reportValidationErrors(draftErrors)) return;
    if (form.predictionId && !formPrediction) {
      const message = "找不到這筆已保存的供餐建議，請重新選擇";
      reportValidationErrors({ predictionId: message });
      return;
    }
    const checkedAtDate = new Date(form.guardrailCheckedAt);
    let nextSafetyGuardrails: ImprovementExperiment["safetyGuardrails"];
    try {
      nextSafetyGuardrails = assertExperimentSafetyGuardrails({
        // This envelope retains experiment-level human review only. Quantities
        // must come from meal-linked observations, never a new summary entry.
        shortageReportCount: null,
        refillRequestCount: null,
        satisfactionScore: null,
        satisfactionResponseCount: 0,
        dietitianReview: form.dietitianReview,
        dietitianNote: form.dietitianNote.trim(),
        confounders: [
          ...new Set(
            form.confounders
              .split(/[\n,，;；]+/)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
        checkedAt: checkedAtDate.toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "供餐安全護欄格式不正確";
      reportValidationErrors({
        [safetyGuardrailErrorField(message)]: message,
      });
      return;
    }
    let nextDecisionTrace: ImprovementExperiment["decisionTrace"];
    if (formPrediction) {
      const decisionInput = {
        adoptionMode: form.adoptionMode,
        adjustedSupplyG:
          form.adoptionMode === "adjusted"
            ? Math.round(Number(form.adjustedSupplyKg) * 1000)
            : undefined,
        adoptionNote: form.adoptionNote,
      };
      const issue = validatePredictionDecision(formPrediction, decisionInput);
      if (issue) {
        reportValidationErrors({
          [predictionDecisionErrorField(issue)]: issue,
        });
        return;
      }
      nextDecisionTrace = createPredictionDecisionTrace(
        formPrediction,
        decisionInput,
      );
    }
    const item: ImprovementExperiment = {
      id: `experiment-${createUuid()}`,
      title: form.title.trim(),
      baselineStart: form.baselineStart,
      baselineEnd: form.baselineEnd,
      interventionStart: form.interventionStart,
      interventionEnd: form.interventionEnd,
      classId: form.classId || undefined,
      interventionDescription: form.description.trim(),
      linkedPredictionId: formPrediction?.id,
      decisionTrace: nextDecisionTrace,
      safetyGuardrails: nextSafetyGuardrails,
      createdAt: new Date().toISOString(),
    };
    const validation = validateExperiment(snapshot, item);
    if (!validation.isValid) {
      const message = validation.issues[0] ?? "目前資料不足以建立這組比較";
      reportValidationErrors(
        experimentIssuesToFieldErrors(validation.issues),
        message,
      );
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    setFieldErrors({});
    let persisted = false;
    try {
      await repository.saveExperiment(item);
      persisted = true;
      await refresh();
      setSelectedId(item.id);
      setShowForm(false);
      if (createFromDecision)
        window.history.replaceState({}, "", "/experiments");
      toast.success("改善實驗已建立");
    } catch (error) {
      const reason =
        error instanceof Error && error.message.trim()
          ? error.message
          : "請確認連線或資料模式後再試一次";
      const message = persisted
        ? `資料可能已保存，但畫面更新失敗：${reason}`
        : `改善實驗尚未保存：${reason}`;
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="驗證｜改善實驗"
        title="不只看數字變小，也檢查比較是否公平"
        description="每個實驗固定使用自己定義的期間與班級，不會被頂部全站篩選悄悄改變。"
        icon={FlaskConical}
        actions={
          <button
            className="primary-action"
            disabled={saving}
            onClick={() => {
              setShowForm(!showForm);
              setSaveError(undefined);
              setFieldErrors({});
              if (showForm && createFromDecision)
                window.history.replaceState({}, "", "/experiments");
              if (!showForm && !form.predictionId) {
                setForm((value) => ({
                  ...value,
                  predictionId: savedPredictions[0]?.id ?? "",
                }));
              }
            }}
          >
            <Plus size={17} />
            建立實驗
          </button>
        }
      />
      <div className="algorithm-note" role="note">
        <CalendarRange size={18} />
        <p>
          <strong>本頁按每個實驗自己的範圍計算。</strong>
          <br />
          頂部全站篩選目前是
          <strong>
            「{globalClassLabel}／{globalRangeLabel}」
          </strong>
          ；它只供其他儀表板瀏覽，不會改寫這裡保存的班級、基準期或改善期。
        </p>
      </div>
      {showForm && (
        <Panel className="experiment-form">
          <PanelTitle
            kicker="新實驗"
            title={
              mode === "demo-local"
                ? "定義比較期間與情境介入"
                : "定義比較期間與實際介入"
            }
            note="結果由餐期原始資料即時計算，不另外儲存漂亮數字。"
          />
          {saveError && (
            <div
              className="decision-warning"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle size={22} />
              <div>
                <strong>這次沒有完成建立</strong>
                <p>{saveError}。表單內容仍保留，可修正後再試一次。</p>
              </div>
            </div>
          )}
          <div className="form-grid three">
            <label className="span-3">
              <span>實驗名稱</span>
              <input
                {...fieldAccessibility("title")}
                maxLength={160}
                value={form.title}
                onChange={(event) =>
                  updateFormField("title", event.target.value)
                }
              />
              <ExperimentFieldError field="title" errors={fieldErrors} />
            </label>
            <label>
              <span>基準期開始</span>
              <input
                {...fieldAccessibility("baselineStart")}
                type="date"
                max={form.baselineEnd}
                value={form.baselineStart}
                onChange={(event) => {
                  updateFormField("baselineStart", event.target.value);
                  clearFieldErrors("baselineEnd");
                }}
              />
              <ExperimentFieldError
                field="baselineStart"
                errors={fieldErrors}
              />
            </label>
            <label>
              <span>基準期結束</span>
              <input
                {...fieldAccessibility("baselineEnd")}
                type="date"
                min={form.baselineStart}
                max={form.interventionStart}
                value={form.baselineEnd}
                onChange={(event) => {
                  updateFormField("baselineEnd", event.target.value);
                  clearFieldErrors("interventionStart");
                }}
              />
              <ExperimentFieldError field="baselineEnd" errors={fieldErrors} />
            </label>
            <label>
              <span>班級</span>
              <select
                {...fieldAccessibility("classId")}
                value={form.classId}
                onChange={(event) => {
                  updateFormField("classId", event.target.value);
                  clearFieldErrors("baselineEnd", "interventionEnd");
                }}
              >
                <option value="">全部班級</option>
                {snapshot.classes.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ExperimentFieldError field="classId" errors={fieldErrors} />
            </label>
            <label>
              <span>改善期開始</span>
              <input
                {...fieldAccessibility("interventionStart")}
                type="date"
                min={form.baselineEnd}
                max={form.interventionEnd}
                value={form.interventionStart}
                onChange={(event) => {
                  updateFormField("interventionStart", event.target.value);
                  clearFieldErrors("interventionEnd");
                }}
              />
              <ExperimentFieldError
                field="interventionStart"
                errors={fieldErrors}
              />
            </label>
            <label>
              <span>改善期結束</span>
              <input
                {...fieldAccessibility("interventionEnd")}
                type="date"
                min={form.interventionStart}
                value={form.interventionEnd}
                onChange={(event) =>
                  updateFormField("interventionEnd", event.target.value)
                }
              />
              <ExperimentFieldError
                field="interventionEnd"
                errors={fieldErrors}
              />
            </label>
            <label className="span-3">
              <span>連結已保存的供餐情境（可選）</span>
              <select
                {...fieldAccessibility("predictionId")}
                value={form.predictionId}
                onChange={(event) => {
                  const adoptionMode = "pending" as const;
                  const predictionId = event.target.value;
                  setForm((current) => ({
                    ...current,
                    predictionId,
                    adoptionMode,
                    adjustedSupplyKg: "",
                    adoptionNote: DEFAULT_ADOPTION_NOTES[adoptionMode],
                  }));
                  clearFieldErrors(
                    "predictionId",
                    "adoptionMode",
                    "adjustedSupplyKg",
                    "adoptionNote",
                  );
                }}
              >
                <option value="">未連結供餐建議</option>
                {savedPredictions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.menuName} · {item.plannedPeople} 人 ·
                    {(item.plannedSupplyG / 1000).toFixed(1)} →
                    {(item.recommendedSupplyG / 1000).toFixed(1)} kg
                  </option>
                ))}
              </select>
              <ExperimentFieldError field="predictionId" errors={fieldErrors} />
            </label>
            {formPrediction && (
              <fieldset className="span-3 decision-capture">
                <legend>把建議轉成可追溯的人類決策</legend>
                <div
                  className="decision-path-preview"
                  role="group"
                  aria-label="供餐決策三階段"
                >
                  <article>
                    <span>01 · 原計畫</span>
                    <strong>{kg(formPrediction.plannedSupplyG)}</strong>
                    <small>學校原本準備量</small>
                  </article>
                  <ArrowRight aria-hidden="true" />
                  <article className="suggested">
                    <span>02 · FoodLens 建議</span>
                    <strong>{kg(formPrediction.recommendedSupplyG)}</strong>
                    <small>只供決策參考</small>
                  </article>
                  <ArrowRight aria-hidden="true" />
                  <article className="human">
                    <span>03 · 人類決定</span>
                    <strong>{ADOPTION_MODE_LABELS[form.adoptionMode]}</strong>
                    <small>
                      {form.adoptionMode === "recommended"
                        ? kg(formPrediction.recommendedSupplyG)
                        : form.adoptionMode === "original"
                          ? kg(formPrediction.plannedSupplyG)
                          : form.adoptionMode === "adjusted" &&
                              form.adjustedSupplyKg !== ""
                            ? `${form.adjustedSupplyKg} kg`
                            : "尚未記錄實際量"}
                    </small>
                  </article>
                </div>
                <div className="decision-capture-fields">
                  <label>
                    <span>採用方式</span>
                    <select
                      {...fieldAccessibility("adoptionMode")}
                      value={form.adoptionMode}
                      onChange={(event) => {
                        const adoptionMode = event.target
                          .value as PredictionAdoptionMode;
                        setForm((current) => ({
                          ...current,
                          adoptionMode,
                          adjustedSupplyKg:
                            adoptionMode === "adjusted"
                              ? current.adjustedSupplyKg
                              : "",
                          adoptionNote: DEFAULT_ADOPTION_NOTES[adoptionMode],
                        }));
                        clearFieldErrors(
                          "adoptionMode",
                          "adjustedSupplyKg",
                          "adoptionNote",
                        );
                      }}
                    >
                      <option value="pending">待校方確認</option>
                      <option value="recommended">採用建議量</option>
                      <option value="adjusted">調整後採用</option>
                      <option value="original">維持原計畫</option>
                    </select>
                    <ExperimentFieldError
                      field="adoptionMode"
                      errors={fieldErrors}
                    />
                  </label>
                  {form.adoptionMode === "adjusted" && (
                    <label>
                      <span>實際準備量</span>
                      <div className="suffix-input">
                        <input
                          {...fieldAccessibility(
                            "adjustedSupplyKg",
                            "experiment-adjusted-supply-hint",
                          )}
                          type="number"
                          min={formPrediction.recommendedSupplyG / 1000}
                          max={formPrediction.plannedSupplyG / 1000}
                          step="0.1"
                          required
                          value={form.adjustedSupplyKg}
                          onChange={(event) =>
                            updateFormField(
                              "adjustedSupplyKg",
                              event.target.value === ""
                                ? ""
                                : Number(event.target.value),
                            )
                          }
                        />
                        <i>kg</i>
                      </div>
                      <small id="experiment-adjusted-supply-hint">
                        安全範圍：{kg(formPrediction.recommendedSupplyG)}–
                        {kg(formPrediction.plannedSupplyG)}
                      </small>
                      <ExperimentFieldError
                        field="adjustedSupplyKg"
                        errors={fieldErrors}
                      />
                    </label>
                  )}
                  <label className="decision-note-field">
                    <span>決策備註</span>
                    <textarea
                      {...fieldAccessibility("adoptionNote")}
                      rows={2}
                      maxLength={1000}
                      value={form.adoptionNote}
                      onChange={(event) =>
                        updateFormField("adoptionNote", event.target.value)
                      }
                    />
                    <ExperimentFieldError
                      field="adoptionNote"
                      errors={fieldErrors}
                    />
                  </label>
                </div>
                <p className="decision-capture-footnote">
                  建立後會保存這一刻的原計畫與建議量快照；日後即使資料更新，實驗仍能說明當時由誰做了什麼決定。
                </p>
              </fieldset>
            )}
            <label className="span-3">
              <span>介入方式</span>
              <input
                {...fieldAccessibility("description")}
                required
                maxLength={2000}
                value={form.description}
                onChange={(event) =>
                  updateFormField("description", event.target.value)
                }
              />
              <ExperimentFieldError field="description" errors={fieldErrors} />
            </label>
            <fieldset className="span-3 safety-guardrail-capture">
              <legend>實驗層人工檢查</legend>
              <div className="guardrail-form-intro">
                <ShieldCheck size={20} aria-hidden="true" />
                <p>
                  <strong>剩食下降不等於供餐成功。</strong>
                  這裡只記錄營養師／校方的判斷與可能干擾因素。缺餐、添餐與滿意度請在每日紀錄逐餐填寫來源及票數，系統依本實驗期別聚合，不接受人工代填總平均。
                </p>
              </div>
              <div className="safety-guardrail-fields">
                <label>
                  <span>營養師確認狀態</span>
                  <select
                    {...fieldAccessibility("dietitianReview")}
                    value={form.dietitianReview}
                    onChange={(event) =>
                      updateFormField(
                        "dietitianReview",
                        event.target.value as DietitianReviewStatus,
                      )
                    }
                  >
                    <option value="pending">待營養師確認</option>
                    <option value="confirmed">營養師已確認</option>
                    <option value="concern">有疑慮，需調整</option>
                  </select>
                  <ExperimentFieldError
                    field="dietitianReview"
                    errors={fieldErrors}
                  />
                </label>
                <label>
                  <span>護欄檢查時間</span>
                  <input
                    {...fieldAccessibility("guardrailCheckedAt")}
                    type="datetime-local"
                    required
                    value={form.guardrailCheckedAt}
                    onChange={(event) =>
                      updateFormField("guardrailCheckedAt", event.target.value)
                    }
                  />
                  <ExperimentFieldError
                    field="guardrailCheckedAt"
                    errors={fieldErrors}
                  />
                </label>
                <label className="guardrail-wide-field">
                  <span>營養師／午餐承辦備註</span>
                  <textarea
                    {...fieldAccessibility("dietitianNote")}
                    rows={2}
                    maxLength={1000}
                    placeholder="例如：熱量與份量仍在學校安全範圍；下一次持續觀察。"
                    value={form.dietitianNote}
                    onChange={(event) =>
                      updateFormField("dietitianNote", event.target.value)
                    }
                  />
                  <ExperimentFieldError
                    field="dietitianNote"
                    errors={fieldErrors}
                  />
                </label>
                <label className="guardrail-wide-field">
                  <span>可能干擾因素（每行一項）</span>
                  <textarea
                    {...fieldAccessibility("confounders")}
                    rows={3}
                    maxLength={2000}
                    placeholder={
                      "例如：\n改善週有校慶活動\n前後期菜色不同\n出席人數改變"
                    }
                    value={form.confounders}
                    onChange={(event) =>
                      updateFormField("confounders", event.target.value)
                    }
                  />
                  <ExperimentFieldError
                    field="confounders"
                    errors={fieldErrors}
                  />
                </label>
              </div>
            </fieldset>
          </div>
          <div className="button-row end">
            <button
              className="secondary-action"
              disabled={saving}
              onClick={() => {
                setShowForm(false);
                setSaveError(undefined);
                setFieldErrors({});
                if (createFromDecision)
                  window.history.replaceState({}, "", "/experiments");
              }}
            >
              取消
            </button>
            <button
              className="primary-action"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "建立中…" : "建立並計算"}
            </button>
          </div>
        </Panel>
      )}
      {snapshot.experiments.length === 0 && !showForm && (
        <EmptyState
          title="尚未建立改善實驗"
          description="先建立基準期與改善期，FoodLens 才會依原始餐期資料計算前後差異。"
        />
      )}
      {snapshot.experiments.length > 0 && (
        <div className="experiment-tabs" role="tablist" aria-label="改善實驗">
          {snapshot.experiments.map((item, index) => (
            <button
              id={`experiment-tab-${index}`}
              role="tab"
              aria-selected={experiment?.id === item.id}
              aria-controls={`experiment-panel-${index}`}
              tabIndex={experiment?.id === item.id ? 0 : -1}
              className={experiment?.id === item.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              key={item.id}
            >
              <Beaker size={16} />
              {item.title}
            </button>
          ))}
        </div>
      )}
      {snapshot.experiments.map((item, index) =>
        index === experimentIndex ? null : (
          <div
            id={`experiment-panel-${index}`}
            role="tabpanel"
            aria-labelledby={`experiment-tab-${index}`}
            hidden
            key={item.id}
          />
        ),
      )}
      {experiment && experimentIndex >= 0 && (
        <div
          id={`experiment-panel-${experimentIndex}`}
          role="tabpanel"
          aria-labelledby={`experiment-tab-${experimentIndex}`}
        >
          {result && !result.isValid && (
            <div className="decision-warning" role="alert">
              <AlertTriangle size={22} />
              <div>
                <strong>這組期間尚不能形成可信的改善比較</strong>
                <p>{result.issues.join("；")}</p>
              </div>
            </div>
          )}
          {result?.isValid && (
            <>
              <Panel className="experiment-hero">
                <div className="experiment-label">
                  <span>
                    {mode === "demo-local" ? "前後比較計算情境" : "改善實驗"}{" "}
                    {snapshot.experiments.indexOf(result.experiment) + 1}
                  </span>
                  <h2>{result.experiment.title}</h2>
                  <p>{result.experiment.interventionDescription}</p>
                  <div className="linked-prediction-summary">
                    <CalendarRange size={16} />
                    <span>
                      本實驗範圍｜{experimentClassScope} · 基準期{" "}
                      {result.experiment.baselineStart}–
                      {result.experiment.baselineEnd}；改善期{" "}
                      {result.experiment.interventionStart}–
                      {result.experiment.interventionEnd} ·
                      以完整資料集計算，不受頂部篩選影響
                    </span>
                  </div>
                  {decisionTrace ? (
                    <div
                      className="decision-trace-card"
                      aria-label="供餐建議採用紀錄"
                    >
                      <div className="decision-trace-heading">
                        <Link2 size={16} />
                        <span>已保存決策快照</span>
                        <strong>
                          {ADOPTION_MODE_LABELS[decisionTrace.adoptionMode]}
                        </strong>
                      </div>
                      <p>
                        {decisionTrace.menuName} · {decisionTrace.plannedPeople}{" "}
                        人
                      </p>
                      <dl>
                        <div>
                          <dt>原計畫</dt>
                          <dd>{kg(decisionTrace.plannedSupplyG)}</dd>
                        </div>
                        <div>
                          <dt>建議量</dt>
                          <dd>{kg(decisionTrace.recommendedSupplyG)}</dd>
                        </div>
                        <div>
                          <dt>實際採用</dt>
                          <dd>
                            {decisionTrace.adoptedSupplyG
                              ? kg(decisionTrace.adoptedSupplyG)
                              : "待確認"}
                          </dd>
                        </div>
                      </dl>
                      <small>{decisionTrace.adoptionNote}</small>
                    </div>
                  ) : linkedPrediction ? (
                    <div className="linked-prediction-summary">
                      <Link2 size={16} />
                      <span>
                        舊版連結紀錄｜{linkedPrediction.menuName} · 原計畫{" "}
                        {kg(linkedPrediction.plannedSupplyG)} → 建議量{" "}
                        {kg(linkedPrediction.recommendedSupplyG)} ·
                        尚未補記實際採用方式
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="before-after-large">
                  <article>
                    <span>{mode === "demo-local" ? "情境前期" : "改善前"}</span>
                    <strong>{(result.beforeRate * 100).toFixed(1)}%</strong>
                    <small>
                      {result.experiment.baselineStart}–
                      {result.experiment.baselineEnd}
                    </small>
                    <i style={{ height: `${result.beforeRate * 230}px` }} />
                  </article>
                  <div className="experiment-arrow">
                    <ArrowDown size={24} />
                    <strong>
                      下降 {(result.pointDrop * 100).toFixed(1)} 個百分點
                    </strong>
                    <span>
                      相對改善 {(result.relativeImprovement * 100).toFixed(1)}%
                    </span>
                  </div>
                  <article className="after">
                    <span>{mode === "demo-local" ? "情境後期" : "改善後"}</span>
                    <strong>{(result.afterRate * 100).toFixed(1)}%</strong>
                    <small>
                      {result.experiment.interventionStart}–
                      {result.experiment.interventionEnd}
                    </small>
                    <i style={{ height: `${result.afterRate * 230}px` }} />
                  </article>
                </div>
              </Panel>
              <section className="experiment-kpis">
                <article>
                  <CalendarRange />
                  <span>基準期樣本</span>
                  <strong>
                    {result.beforeDateCount}
                    <small>日／{result.beforeSamples} 筆</small>
                  </strong>
                </article>
                <article>
                  <CalendarRange />
                  <span>改善期樣本</span>
                  <strong>
                    {result.afterDateCount}
                    <small>日／{result.afterSamples} 筆</small>
                  </strong>
                </article>
                <article>
                  <Scale />
                  <span>絕對差異</span>
                  <strong>
                    {(result.pointDrop * 100).toFixed(1)}
                    <small>百分點</small>
                  </strong>
                </article>
                <article>
                  <CheckCircle2 />
                  <span>相對改善</span>
                  <strong>
                    {(result.relativeImprovement * 100).toFixed(1)}
                    <small>%</small>
                  </strong>
                </article>
              </section>
              <MealSafetyComparisonPanel
                snapshot={snapshot}
                experiment={result.experiment}
                mode={mode}
              />
              <Panel className="safety-guardrail-panel">
                <PanelTitle
                  kicker="實驗層人工檢查｜與逐餐觀察分開"
                  title="營養師與校方的判斷紀錄"
                  note="此處為人工填報的檢查摘要，不代表系統驗證專業身分，也不取代逐餐護欄證據。"
                />
                {safetyGuardrails ? (
                  <>
                    <details>
                      <summary>舊版實驗數值摘要（僅供歷史查閱）</summary>
                      <p>
                        這些舊欄位沒有逐餐來源與期別，未納入上方前後護欄計算。新實驗不再填寫總人次或均分；沒有舊值就保持未量測。
                      </p>
                      <div className="safety-guardrail-summary">
                        <article>
                          <span>缺餐／吃不飽</span>
                          <strong>
                            {formatGuardrailMeasurement(
                              safetyGuardrails.shortageReportCount,
                            )}
                          </strong>
                        </article>
                        <article>
                          <span>添餐／補菜</span>
                          <strong>
                            {formatGuardrailMeasurement(
                              safetyGuardrails.refillRequestCount,
                            )}
                          </strong>
                        </article>
                        <article>
                          <span>學生滿意度</span>
                          <strong>
                            {formatGuardrailSatisfaction(safetyGuardrails)}
                          </strong>
                        </article>
                      </div>
                    </details>
                    <div className="safety-guardrail-summary">
                      <article>
                        <span>營養師確認</span>
                        <strong
                          className={`guardrail-status ${safetyGuardrails.dietitianReview}`}
                        >
                          {dietitianReviewLabel(
                            safetyGuardrails.dietitianReview,
                          )}
                        </strong>
                      </article>
                    </div>
                    <div className="guardrail-context-grid">
                      <div>
                        <strong>可能干擾因素</strong>
                        {safetyGuardrails.confounders.length ? (
                          <ul>
                            {safetyGuardrails.confounders.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>尚未記錄；解讀前後差異時仍需補查。</p>
                        )}
                      </div>
                      <div>
                        <strong>人工檢查紀錄</strong>
                        <p>
                          {safetyGuardrails.dietitianNote ||
                            "尚未留下營養師或午餐承辦備註。"}
                        </p>
                        <small>
                          檢查時間：
                          {new Date(safetyGuardrails.checkedAt).toLocaleString(
                            "zh-TW",
                            { timeZone: "Asia/Taipei" },
                          )}
                        </small>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="guardrail-missing" role="note">
                    <AlertTriangle size={20} aria-hidden="true" />
                    <p>
                      <strong>這筆比較尚未記錄實驗層人工檢查。</strong>
                      逐餐觀察仍以本實驗期別獨立計算；不能因剩食下降就判定「供餐已成功」，營養師與校方仍須確認。
                    </p>
                  </div>
                )}
              </Panel>
              <div className="experiment-grid">
                <Panel>
                  <PanelTitle
                    kicker="介入紀錄"
                    title={
                      mode === "demo-local"
                        ? "情境做法與驗證界線"
                        : "實際做法與驗證界線"
                    }
                  />
                  <ol className="intervention-log">
                    {decisionTrace ? (
                      <li>
                        <span>00</span>
                        <div>
                          <strong>建議與人類採用決定皆已留存</strong>
                          <p>
                            {decisionTrace.menuName} ·
                            {decisionTrace.plannedPeople} 人；原計畫{" "}
                            {kg(decisionTrace.plannedSupplyG)}，FoodLens 建議{" "}
                            {kg(decisionTrace.recommendedSupplyG)}，人類決定「
                            {ADOPTION_MODE_LABELS[decisionTrace.adoptionMode]}」
                            {decisionTrace.adoptedSupplyG
                              ? ` ${kg(decisionTrace.adoptedSupplyG)}`
                              : "，尚未記錄實際量"}
                            。{decisionTrace.adoptionNote}
                          </p>
                        </div>
                      </li>
                    ) : linkedPrediction ? (
                      <li>
                        <span>00</span>
                        <div>
                          <strong>舊版實驗只保留建議連結</strong>
                          <p>
                            {linkedPrediction.menuName} · 原計畫{" "}
                            {kg(linkedPrediction.plannedSupplyG)}，建議量{" "}
                            {kg(linkedPrediction.recommendedSupplyG)}
                            ；尚未補記實際採用方式，不能將建議視為已執行。
                          </p>
                        </div>
                      </li>
                    ) : null}
                    <li>
                      <span>01</span>
                      <div>
                        <strong>
                          {mode === "demo-local"
                            ? "情境中設定的介入做法"
                            : "教師記錄的實際介入"}
                        </strong>
                        <p>{result.experiment.interventionDescription}</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>比較通過系統顯示門檻；不代表研究有效性</strong>
                        <p>
                          前後期不重疊，且各有至少 2 個獨立供餐日與 3
                          筆班級餐期。
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>
                          {safetyGuardrails
                            ? "人工檢查與干擾因素已另列保存"
                            : "仍需補記人工檢查與干擾因素"}
                        </strong>
                        <p>
                          {safetyGuardrails
                            ? `填報檢查狀態：${dietitianReviewLabel(safetyGuardrails.dietitianReview)}；逐餐缺餐、添餐與滿意度的來源及涵蓋率另列，不由本摘要推定。`
                            : "營養需求、出席、天氣與菜色差異仍由人判斷，不能只看剩食率下降。"}
                        </p>
                      </div>
                    </li>
                  </ol>
                </Panel>
                <Panel>
                  <PanelTitle
                    kicker="研究誠信"
                    title="這個結果還不能證明因果"
                  />
                  <div className="caution-card">
                    <AlertTriangle size={22} />
                    <p>
                      前後菜單組成差異請看上方逐餐比較；即使菜名相同，配方、出席人數、天氣或活動也可能影響食慾。
                      {result
                        ? `${(result.beforeRate * 100).toFixed(1)}% → ${(result.afterRate * 100).toFixed(1)}%`
                        : "目前前後差異"}
                      是{mode === "demo-local" ? "模擬資料" : "校園記錄"}
                      的觀察結果，不是單獨的因果證明。
                    </p>
                  </div>
                  <ul className="check-list">
                    <li>
                      <CheckCircle2 />
                      顯示原始比例，不只顯示改善百分比
                    </li>
                    <li>
                      <CheckCircle2 />
                      顯示各期樣本數與日期
                    </li>
                    <li>
                      <CheckCircle2 />
                      保留 AI 與人工修正稽核軌跡
                    </li>
                    <li>
                      <Users />
                      下一步：相同菜色配對或增加對照班級
                    </li>
                  </ul>
                </Panel>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
