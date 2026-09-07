"use client";

import { CheckCircle2, Hand, ShieldAlert } from "lucide-react";
import type {
  ComparableEvidenceCohort,
  EvidenceCaseAnalysis,
  EvidenceHumanDecision,
} from "@/lib/evidence-chain";
import type {
  ResponsibilityCard,
  ResponsibilityEvidence,
} from "@/lib/waste-intelligence";
import {
  CONFIDENCE_LABELS,
  RESPONSIBILITY_KIND_LABELS,
  RESPONSIBILITY_OWNER_LABELS,
  formatPercent,
  formatWeight,
} from "@/components/workflow/workflow-copy";
import { RESPONSIBILITY_OWNERS } from "@/lib/waste-intelligence";
import styles from "@/app/(dashboard)/workflow/workflow.module.css";

export type DecisionDraft = Pick<
  EvidenceHumanDecision,
  "cardId" | "choice" | "rationale" | "decidedByRole"
>;

const DECISION_COPY: Record<
  EvidenceHumanDecision["choice"],
  { title: string; description: string }
> = {
  pilot: {
    title: "採用小型試驗",
    description: "只測一個變因，保留安全與營養護欄。",
  },
  "more-data": {
    title: "需要更多資料",
    description: "先補樣本、瀝水一致性或現場情境。",
  },
  reject: {
    title: "這次不採用",
    description: "寫下理由，保留不同專業判斷。",
  },
};

function evidenceValue(evidence: ResponsibilityEvidence) {
  if (evidence.value === undefined) return evidence.label;
  if (evidence.unit === "ratio")
    return `${evidence.label} ${formatPercent(evidence.value)}`;
  if (evidence.unit === "grams")
    return `${evidence.label} ${formatWeight(evidence.value)}`;
  if (evidence.unit === "minutes")
    return `${evidence.label} ${evidence.value} 分鐘`;
  if (evidence.unit === "people")
    return `${evidence.label} ${evidence.value} 人`;
  return `${evidence.label} ${evidence.value} 筆`;
}

function DecisionCard({
  card,
  selected,
  onSelect,
}: {
  card: ResponsibilityCard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={`${styles.decisionCard} ${
        card.id === "need-more-data" ? styles.moreData : ""
      } ${selected ? styles.selectedCard : ""}`}
    >
      <div className={styles.decisionTop}>
        <div>
          <span>{RESPONSIBILITY_KIND_LABELS[card.id]}</span>
          <h3>{card.title}</h3>
        </div>
        <span
          className={`${styles.confidenceBadge} ${
            card.confidence === "low" ? styles.low : ""
          }`}
        >
          {CONFIDENCE_LABELS[card.confidence]}
        </span>
      </div>
      <div className={styles.ownerLine}>
        <strong>主責：{RESPONSIBILITY_OWNER_LABELS[card.owner.primary]}</strong>
        <span>
          協作：
          {card.owner.collaborators
            .map((owner) => RESPONSIBILITY_OWNER_LABELS[owner])
            .join("、") || "無"}
        </span>
      </div>
      <div className={styles.evidenceList} aria-label="判斷依據">
        {card.evidence.map((evidence) => (
          <span key={evidence.code} title={evidence.detail}>
            {evidenceValue(evidence)}
          </span>
        ))}
      </div>
      <p className={styles.actionCopy}>
        <strong>建議下一步：</strong> {card.action}
      </p>
      <p className={styles.guardrail}>
        <ShieldAlert size={13} aria-hidden="true" />
        <strong>不可越過的界線：</strong> {card.guardrail}
      </p>
      <div className="button-row" style={{ padding: "0 17px 16px" }}>
        <button
          className={selected ? "primary-action" : "secondary-action"}
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {selected ? <CheckCircle2 size={15} /> : <Hand size={15} />}
          {selected ? "已選為決策對象" : "針對這張卡做決定"}
        </button>
      </div>
    </article>
  );
}

export function DecisionStage({
  analysis,
  cohort,
  draft,
  error,
  onDraftChange,
}: {
  analysis: EvidenceCaseAnalysis;
  cohort: ComparableEvidenceCohort;
  draft: DecisionDraft;
  error?: string;
  onDraftChange: (patch: Partial<DecisionDraft>) => void;
}) {
  const selectedCard =
    analysis.responsibilityCards.find((card) => card.id === draft.cardId) ??
    analysis.responsibilityCards[0];

  return (
    <>
      <header className={styles.stageHeader}>
        <div>
          <span>STEP 04 · DECIDE</span>
          <h2>把規律轉成有主責、有護欄的下一步</h2>
          <p>
            系統只整理證據與提出可檢驗方案；是否採用，仍由營養師或學校決定，並留下理由。
          </p>
        </div>
        <span className={styles.statusPill}>
          <Hand size={14} /> 人類做最後決定
        </span>
      </header>

      <section
        className={`${styles.cohortNotice} ${
          cohort.level === "current-only" ? styles.cohortCaution : ""
        }`}
        aria-labelledby="cohort-title"
      >
        <div>
          <span>這次拿什麼來比</span>
          <h3 id="cohort-title">{cohort.label}</h3>
          <p>{cohort.reason}</p>
        </div>
        <dl>
          <div>
            <dt>時間範圍</dt>
            <dd>
              {cohort.window.start}－{cohort.window.end}
            </dd>
          </div>
          <div>
            <dt>可比餐期</dt>
            <dd>{cohort.independentMealCount} 個獨立供餐日</dd>
          </div>
        </dl>
      </section>

      <section className={styles.reasonIntro} aria-label="回饋與現場觀察涵蓋率">
        <strong>這些線索，實際收集了多少？</strong>
        <p>
          {analysis.caseCount} 筆餐期中，
          {analysis.feedbackCoverage.collectedMeals} 筆已完成回饋收集， 共{" "}
          {analysis.feedbackCoverage.confirmedResponseCount} 份有效回覆； 其中{" "}
          {analysis.feedbackCoverage.zeroResponseMeals} 筆確認為 0 份回覆。
        </p>
        <p>
          尚未收集 {analysis.feedbackCoverage.uncollectedMeals} 筆、舊資料待複核{" "}
          {analysis.feedbackCoverage.legacyUnverifiedMeals}{" "}
          筆，均不列入原因統計。 配送延遲已觀察{" "}
          {analysis.feedbackCoverage.deliveryObservedMeals} 筆，溫度情境已觀察{" "}
          {analysis.feedbackCoverage.temperatureObservedMeals} 筆。
          未觀察不是正常，0 份回覆也不代表沒有意見。
        </p>
      </section>

      <div
        className={styles.metricGrid}
        aria-label={`${cohort.independentMealCount} 個可比供餐日加權分析`}
      >
        <div className={`${styles.metric} ${styles.primaryMetric}`}>
          <span>可避免剩食率</span>
          <strong>{formatPercent(analysis.metrics.avoidableRate)}</strong>
          <small>未供出＋盤後抽樣外推</small>
        </div>
        <div className={styles.metric}>
          <span>盤後剩食率</span>
          <strong>{formatPercent(analysis.metrics.weightedPlateRate)}</strong>
          <small>依抽樣原供應重量加權</small>
        </div>
        <div className={styles.metric}>
          <span>未供出率</span>
          <strong>{formatPercent(analysis.metrics.unservedRate)}</strong>
          <small>不是學生餐盤剩食</small>
        </div>
        <div className={styles.metric}>
          <span>盤後覆蓋率</span>
          <strong>{formatPercent(analysis.metrics.coverageRate)}</strong>
          <small>{analysis.metrics.independentMealCount} 個獨立供餐日</small>
        </div>
      </div>

      <div className={styles.cardsList}>
        {analysis.responsibilityCards.map((card) => (
          <DecisionCard
            key={card.id}
            card={card}
            selected={selectedCard.id === card.id}
            onSelect={() =>
              onDraftChange({
                cardId: card.id,
                ...(card.id === "need-more-data" && draft.choice === "pilot"
                  ? { choice: "more-data" }
                  : {}),
              })
            }
          />
        ))}
      </div>

      <section
        className={styles.humanDecision}
        aria-labelledby="human-decision-title"
      >
        <h3 id="human-decision-title">由人完成最後一哩</h3>
        <p>
          目前決策對象：「{selectedCard.title}
          」。選擇不採用也同樣有價值，理由會成為研究稽核的一部分。
        </p>
        {cohort.level === "current-only" && (
          <p className={styles.cohortDecisionHint} role="status">
            目前未達 3
            個可比較供餐日，因此先鎖住「採用小型試驗」；請選擇補資料或不採用。
          </p>
        )}
        <div
          className={styles.decisionOptions}
          role="group"
          aria-label="人工決策"
        >
          {(
            Object.keys(DECISION_COPY) as EvidenceHumanDecision["choice"][]
          ).map((choice) => {
            const disabled =
              choice === "pilot" &&
              (selectedCard.id === "need-more-data" ||
                cohort.level === "current-only");
            const disabledReason =
              cohort.level === "current-only"
                ? "需至少三個可比較供餐日，才能把觀察轉成試驗建議"
                : "資料不足卡不能直接進入試行";
            return (
              <button
                key={choice}
                className={
                  draft.choice === choice ? styles.selectedDecision : ""
                }
                type="button"
                disabled={disabled}
                aria-pressed={draft.choice === choice}
                title={disabled ? disabledReason : undefined}
                onClick={() => onDraftChange({ choice })}
              >
                {DECISION_COPY[choice].title}
              </button>
            );
          })}
        </div>
        <div className={styles.decisionForm}>
          <label>
            <span>最後確認角色</span>
            <select
              value={draft.decidedByRole}
              onChange={(event) =>
                onDraftChange({
                  decidedByRole: event.target
                    .value as EvidenceHumanDecision["decidedByRole"],
                })
              }
            >
              {RESPONSIBILITY_OWNERS.map((role) => (
                <option key={role} value={role}>
                  {RESPONSIBILITY_OWNER_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.decisionReason}>
            <span>決策理由（至少 5 字）</span>
            <textarea
              value={draft.rationale}
              minLength={5}
              maxLength={1000}
              placeholder={DECISION_COPY[draft.choice].description}
              onChange={(event) =>
                onDraftChange({ rationale: event.target.value })
              }
            />
          </label>
        </div>
      </section>
      {error && (
        <p className={styles.validationError} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
