"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  FINAL_RUBRICS,
  REHEARSAL_QUESTION_BANK,
  getRubric,
  type PresentationPhaseId,
  type RehearsalQuestion,
} from "@/lib/presentation-rehearsal";
import type { DataMode } from "@/lib/types";
import styles from "@/app/presentation/presentation.module.css";

interface RehearsalPanelProps {
  phase: Exclude<PresentationPhaseId, "presentation">;
  mode: DataMode;
  packIndex: number;
  questions: readonly RehearsalQuestion[];
  activeIndex: number;
  revealedQuestionIds: ReadonlySet<string>;
  completedQuestionIds: ReadonlySet<string>;
  onSelectQuestion: (index: number) => void;
  onPreviousQuestion: () => void;
  onNextQuestion: () => void;
  onToggleReveal: (questionId: string) => void;
  onToggleComplete: (questionId: string) => void;
  onCyclePack: () => void;
  onOpenAnswers: () => void;
  onOpenQuestions: () => void;
  onChooseFromBank: (questionId: string) => void;
}

export function RehearsalPanel({
  phase,
  mode,
  packIndex,
  questions,
  activeIndex,
  revealedQuestionIds,
  completedQuestionIds,
  onSelectQuestion,
  onPreviousQuestion,
  onNextQuestion,
  onToggleReveal,
  onToggleComplete,
  onCyclePack,
  onOpenAnswers,
  onOpenQuestions,
  onChooseFromBank,
}: RehearsalPanelProps) {
  const question = questions[activeIndex] ?? questions[0];
  if (!question) return null;

  const rubric = getRubric(question.rubric);
  const isQuestionPhase = phase === "judge-questions";
  const isRevealed = revealedQuestionIds.has(question.id);
  const isComplete = completedQuestionIds.has(question.id);
  const completedCount = questions.filter((item) =>
    completedQuestionIds.has(item.id),
  ).length;

  return (
    <section
      className={styles.rehearsal}
      aria-labelledby="rehearsal-title"
      data-phase={phase}
    >
      <header className={styles.rehearsalHeader}>
        <div>
          <p>
            決選排練 · {isQuestionPhase ? "5 分鐘統一提問" : "7 分鐘團隊答詢"}
          </p>
          <h1 id="rehearsal-title">
            {isQuestionPhase
              ? "先把問題聽完整，再決定怎麼回答"
              : "先回答、再舉證，最後主動說限制"}
          </h1>
        </div>
        <span className={styles.rehearsalCounter}>
          本輪第 {activeIndex + 1}／{questions.length} 題
          {!isQuestionPhase && ` · 已完成 ${completedCount} 題`}
        </span>
      </header>

      <RubricMap activeKey={question.rubric} />

      <div className={styles.rehearsalGrid}>
        <aside className={styles.questionRail} aria-label="本輪排練題目">
          <div className={styles.questionRailHead}>
            <div>
              <small>排練題組 {packIndex + 1}／3</small>
              <strong>四項評分各一題</strong>
            </div>
            <button type="button" onClick={onCyclePack}>
              <RefreshCw /> 換一組
            </button>
          </div>

          <ol>
            {questions.map((item, index) => {
              const itemRubric = getRubric(item.rubric);
              const itemComplete = completedQuestionIds.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={index === activeIndex ? styles.selected : ""}
                    onClick={() => onSelectQuestion(index)}
                    aria-current={index === activeIndex ? "true" : undefined}
                  >
                    <span>
                      {itemRubric.label} {itemRubric.weight}%
                    </span>
                    <strong>{item.question}</strong>
                    {itemComplete && (
                      <small>
                        <Check /> 已完成
                      </small>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          <details className={styles.questionBank}>
            <summary>
              <span>查看完整題庫（{REHEARSAL_QUESTION_BANK.length} 題）</span>
              <ChevronDown />
            </summary>
            <div>
              {FINAL_RUBRICS.map((bankRubric) => (
                <section key={bankRubric.key}>
                  <h2>
                    {bankRubric.label} {bankRubric.weight}%
                  </h2>
                  {REHEARSAL_QUESTION_BANK.filter(
                    (item) => item.rubric === bankRubric.key,
                  ).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => onChooseFromBank(item.id)}
                    >
                      {item.question}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </details>
        </aside>

        <article className={styles.answerStage}>
          <div className={styles.answerMeta}>
            <span>
              {rubric.label} {rubric.weight}%
            </span>
            <small>{rubric.focus}</small>
          </div>
          <h2>{question.question}</h2>
          <p className={styles.questionIntent}>
            <MessageSquareText /> {question.intent}
          </p>

          {isQuestionPhase ? (
            <QuestionListeningCard />
          ) : (
            <AnswerPracticeCard
              question={question}
              revealed={isRevealed}
              completed={isComplete}
              onToggleReveal={() => onToggleReveal(question.id)}
              onToggleComplete={() => onToggleComplete(question.id)}
            />
          )}

          <div className={styles.practiceActions}>
            <button
              type="button"
              onClick={onPreviousQuestion}
              disabled={activeIndex === 0}
            >
              <ArrowLeft /> 上一題
            </button>
            {activeIndex < questions.length - 1 ? (
              <button type="button" onClick={onNextQuestion}>
                下一題 <ArrowRight />
              </button>
            ) : isQuestionPhase ? (
              <button
                className={styles.primaryPracticeAction}
                type="button"
                onClick={onOpenAnswers}
              >
                完成記題，進入 7 分鐘答詢 <ArrowRight />
              </button>
            ) : (
              <button type="button" onClick={onOpenQuestions}>
                回到 5 分鐘提問再練一次
              </button>
            )}
          </div>
        </article>
      </div>

      <p className={styles.rehearsalDisclosure} role="note">
        <ShieldCheck />
        {mode === "demo-local"
          ? "目前是示範資料：回答請說『系統可以』或『下一步將實測』，不能說『研究已證明改善』。"
          : "目前是校園工作區：只有來源明確、可追溯且通過樣本門檻的資料，才能稱為實測發現。"}
        題庫只供排練，不代表主辦單位實際提問。
      </p>
    </section>
  );
}

function RubricMap({ activeKey }: { activeKey: RehearsalQuestion["rubric"] }) {
  return (
    <div className={styles.rubricMap} aria-label="官方決選評分配分">
      {FINAL_RUBRICS.map((rubric) => (
        <span
          key={rubric.key}
          className={rubric.key === activeKey ? styles.activeRubric : ""}
        >
          <strong>{rubric.label}</strong>
          <b>{rubric.weight}%</b>
        </span>
      ))}
    </div>
  );
}

function QuestionListeningCard() {
  return (
    <div className={styles.listeningCard}>
      <strong>這一段先不顯示答案</strong>
      <ol>
        <li>把評審的完整問題記下來，不只抓熟悉的詞。</li>
        <li>圈出「為什麼、怎麼證明、誰負責、下一步」等動詞。</li>
        <li>確認有沒有兩個問題，再由最適合的隊員安排答題順序。</li>
      </ol>
      <small>建議節奏：每題約 75 秒聽題與記錄，四題剛好 5 分鐘。</small>
    </div>
  );
}

function AnswerPracticeCard({
  question,
  revealed,
  completed,
  onToggleReveal,
  onToggleComplete,
}: {
  question: RehearsalQuestion;
  revealed: boolean;
  completed: boolean;
  onToggleReveal: () => void;
  onToggleComplete: () => void;
}) {
  return (
    <div className={styles.answerPractice}>
      <div className={styles.answerPracticeHead}>
        <div>
          <strong>105 秒答題骨架</strong>
          <small>一句直答 → 三個證據 → 一個誠實邊界</small>
        </div>
        <button type="button" onClick={onToggleReveal} aria-expanded={revealed}>
          {revealed ? <EyeOff /> : <Eye />}
          {revealed ? "隱藏答案重點" : "顯示答案重點"}
        </button>
      </div>

      {revealed ? (
        <div className={styles.answerReveal}>
          <p className={styles.answerLead}>{question.answerLead}</p>
          <ol>
            {question.answerPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ol>
          <p className={styles.honestyBoundary}>
            <ShieldCheck />
            <span>
              <strong>誠實邊界</strong>
              {question.honestyBoundary}
            </span>
          </p>
          <p className={styles.evidencePrompt}>
            可出示證據：{question.evidenceLabels.join("、")}
          </p>
        </div>
      ) : (
        <div className={styles.answerCovered}>
          <p>先由隊員口頭回答，再打開重點自我檢查。</p>
          <small>目標不是背稿，而是每次都守住相同證據邊界。</small>
        </div>
      )}

      <button
        type="button"
        className={styles.completeAnswerButton}
        onClick={onToggleComplete}
        aria-pressed={completed}
      >
        <Check /> {completed ? "已完成這題" : "標記已完成"}
      </button>
    </div>
  );
}
