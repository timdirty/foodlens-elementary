"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenText,
  Camera,
  Check,
  Clock3,
  Leaf,
  NotebookPen,
  RotateCcw,
  Scale,
  ScanLine,
  ShieldCheck,
  Truck,
  UsersRound,
  Utensils,
  X,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import { RehearsalPanel } from "@/components/presentation/rehearsal-panel";
import { useJudgePreflightRuntime } from "@/components/use-judge-preflight";
import {
  experimentResult,
  generateInsights,
  snapshotDateRange,
} from "@/lib/analysis";
import { calculateImpact } from "@/lib/impact";
import {
  createPrediction,
  JUDGE_DEMO_PREDICTION_INPUT,
} from "@/lib/prediction";
import { evaluateJudgePreflight } from "@/lib/product-readiness";
import {
  FINAL_RUBRICS,
  PRESENTATION_PHASES,
  REHEARSAL_QUESTION_PACKS,
  SLIDE_RUBRIC_KEYS,
  SLIDE_SECONDS,
  getPhase,
  getPhaseTimerState,
  getQuestionPack,
  getRubric,
  type FinalRubricKey,
  type PresentationPhaseId,
} from "@/lib/presentation-rehearsal";
import styles from "./presentation.module.css";

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isInteractiveKeyTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'a, button, input, select, textarea, summary, [contenteditable="true"]',
      ),
    )
  );
}

export default function PresentationPage() {
  const { snapshot, scopedSnapshot, loading, mode, filters } = useFoodLens();
  const preflightRuntime = useJudgePreflightRuntime(mode, snapshot);
  const [phase, setPhase] = useState<PresentationPhaseId>("presentation");
  const [slide, setSlide] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsedByPhase, setElapsedByPhase] = useState<
    Record<PresentationPhaseId, number>
  >({
    presentation: 0,
    "judge-questions": 0,
    "team-answers": 0,
  });
  const [questionPackIndex, setQuestionPackIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [completedQuestionIds, setCompletedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [preflightOverride, setPreflightOverride] = useState(false);
  const go = useCallback((next: number) => {
    setSlide(Math.max(0, Math.min(SLIDE_SECONDS.length - 1, next)));
    window.scrollTo(0, 0);
  }, []);

  const switchPhase = useCallback((nextPhase: PresentationPhaseId) => {
    setRunning(false);
    setPhase(nextPhase);
    if (nextPhase !== "presentation") setQuestionIndex(0);
    window.scrollTo(0, 0);
  }, []);

  const rehearsalQuestions = useMemo(
    () => getQuestionPack(questionPackIndex),
    [questionPackIndex],
  );

  const toggleQuestionId = useCallback(
    (setter: Dispatch<SetStateAction<Set<string>>>, questionId: string) => {
      setter((current) => {
        const next = new Set(current);
        if (next.has(questionId)) next.delete(questionId);
        else next.add(questionId);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () =>
        setElapsedByPhase((current) => ({
          ...current,
          [phase]: current[phase] + 1,
        })),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [phase, running]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        phase !== "presentation" ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isInteractiveKeyTarget(event.target)
      )
        return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        go(slide + 1);
      }
      if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        go(slide - 1);
      }
      if (event.key === "Home") {
        event.preventDefault();
        go(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        go(SLIDE_SECONDS.length - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, phase, slide]);

  const evidence = useMemo(() => {
    if (!scopedSnapshot) return undefined;
    const insights = generateInsights(scopedSnapshot);
    const experiment = experimentResult(scopedSnapshot);
    const prediction = createPrediction(
      scopedSnapshot,
      JUDGE_DEMO_PREDICTION_INPUT,
    );
    const impact = calculateImpact(scopedSnapshot.impactSettings, 20);
    const dateRange = snapshotDateRange(scopedSnapshot);
    return { insights, experiment, prediction, impact, dateRange };
  }, [scopedSnapshot]);

  if (loading || !snapshot || !scopedSnapshot || !evidence) {
    return <main className={styles.loading}>正在整理簡報證據…</main>;
  }
  const judgePreflight = evaluateJudgePreflight(
    snapshot,
    mode,
    preflightRuntime,
  );
  const identityReady = judgePreflight.identityReady;
  const impactSettings = scopedSnapshot.impactSettings;
  const dailyBaselineKg = impactSettings.schoolDailyBaselineG / 1000;

  if (!judgePreflight.ready && !preflightOverride) {
    const draftLabel =
      judgePreflight.draftStatus === "blocked"
        ? `${judgePreflight.pendingDraftCount} 份待處理`
        : judgePreflight.draftStatus === "clear"
          ? "沒有未完成草稿"
          : judgePreflight.draftStatus === "unavailable"
            ? "目前無法檢查"
            : "正在檢查";
    return (
      <main className={styles.stage} aria-label="FoodLens 評審模式預檢">
        <div className={styles.canvas}>
          <section className={`${styles.slide} ${styles.cover}`}>
            <div className={styles.coverCopy}>
              <p className={styles.caseLine}>評審模式預檢 · 不會修改資料</p>
              <h1>
                <span>開始簡報前，</span>
                <em>先確認展示狀態</em>
              </h1>
              <p className={styles.lead}>
                {identityReady
                  ? "正式身分已填寫；請再處理下列展示證據與未完成草稿，確保上台動線可預測。"
                  : "目前仍是中性示範名稱。請先填入正式參賽資料，或明確選擇以示範身分預覽，避免占位文案直接出現在評審封面。"}
              </p>
              <div className={styles.coverIdentity}>
                <span>
                  <small>正式參賽身分</small>
                  <strong>{identityReady ? "已完成" : "尚未完成"}</strong>
                </span>
                <span>
                  <small>
                    {mode === "demo-local" ? "固定示範證據" : "校園資料來源"}
                  </small>
                  <strong>
                    {mode === "school-cloud"
                      ? "沿用每筆來源標示"
                      : judgePreflight.fixedSeedReady
                        ? "版本一致"
                        : "需要重設確認"}
                  </strong>
                </span>
                <span>
                  <small>未完成本機草稿</small>
                  <strong>{draftLabel}</strong>
                  {judgePreflight.draftStatus === "blocked" && (
                    <small>
                      掃描 {judgePreflight.pendingScanDraftCount ?? 0}・午餐任務{" "}
                      {judgePreflight.pendingWorkflowDraftCount ?? 0}
                    </small>
                  )}
                </span>
              </div>
              <div className="button-row">
                {!identityReady && (
                  <Link className="primary-action" href="/admin?tab=project">
                    前往教師管理
                  </Link>
                )}
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setPreflightOverride(true)}
                >
                  {identityReady ? "仍要進入簡報預覽" : "以示範身分預覽"}
                </button>
                {(judgePreflight.pendingScanDraftCount ?? 0) > 0 && (
                  <Link className="secondary-action" href="/scan">
                    前往掃描頁處理草稿
                  </Link>
                )}
                {(judgePreflight.pendingWorkflowDraftCount ?? 0) > 0 && (
                  <Link className="secondary-action" href="/workflow">
                    前往午餐任務台處理草稿
                  </Link>
                )}
                {!judgePreflight.fixedSeedReady && (
                  <Link className="secondary-action" href="/admin?tab=data">
                    前往備份與重設
                  </Link>
                )}
              </div>
              <p className={styles.disclosure}>
                預覽不會清除掃描或午餐任務草稿，也不會把示範身分寫回資料庫；正式上台前請回到教師管理完成資料確認。
              </p>
            </div>
            <div className={styles.coverImage}>
              <Image
                src="/brand/field-note-hero.jpg"
                alt="校園剩食研究桌的 AI 生成視覺示意"
                fill
                preload
                sizes="60vw"
              />
              <span>評審模式預檢 · 不修改資料</span>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const slides = [
    <section className={`${styles.slide} ${styles.cover}`} key="cover">
      <div className={styles.coverCopy}>
        <p className={styles.caseLine}>科技助力社會創新 · 115 研究紀錄</p>
        <h1>
          <span>剩下來的午餐，</span>
          <em>能不能回答</em>
          <em>下一餐？</em>
        </h1>
        <p className={styles.lead}>
          FoodLens
          食光偵探讓學生拍下餐盤、修正初判、對照秤重，再把結果交給學校討論。
        </p>
        <div className={styles.coverIdentity}>
          {identityReady ? (
            <>
              <span>
                <small>學校</small>
                <strong>{snapshot.profile.schoolName}</strong>
              </span>
              <span>
                <small>團隊</small>
                <strong>{snapshot.profile.teamName}</strong>
              </span>
              <span>
                <small>參選者</small>
                <strong>{snapshot.profile.teamMembers}</strong>
              </span>
            </>
          ) : (
            <span>
              <small>展示身分</small>
              <strong>FoodLens 示範身分預覽｜未代入正式參賽資料</strong>
            </span>
          )}
          <span>
            <small>主題</small>
            <strong>科技助力社會創新</strong>
          </span>
        </div>
        <div className={styles.coverStats}>
          <span>
            <strong>{scopedSnapshot.meals.length}</strong> 筆班級餐期
          </span>
          <span>
            <strong>{scopedSnapshot.scans.length}</strong> 份餐盤
          </span>
          <span>
            <strong>{evidence.dateRange.independentDateCount}</strong> 個供餐日
          </span>
        </div>
        <RubricSummary activeKeys={SLIDE_RUBRIC_KEYS[0]} />
        <p className={styles.disclosure}>
          本簡報使用
          {mode === "demo-local" ? "可重現的模擬資料" : "目前校園資料"}
          ；封面照片為 AI
          生成視覺示意，不納入分析。這是現場展示模式，正式報名仍需依主辦規定另交
          PPT、PPTX 或 ODP 檔。
          {mode === "demo-local" &&
            " 目前為使用者明確選擇的示範身分預覽；正式展示前請由教師填入學校與參賽者資料。"}
        </p>
      </div>
      <div className={styles.coverImage}>
        <Image
          src="/brand/field-note-hero.jpg"
          alt="校園剩食研究桌的 AI 生成視覺示意"
          fill
          preload
          sizes="60vw"
        />
        <span>品牌視覺示意 · 非研究樣本</span>
      </div>
    </section>,
    <section className={styles.slide} key="problem">
      <Header
        number="01"
        eyebrow="問題"
        title="我們缺的不是一句「剩很多」，而是能行動的證據"
        rubrics={SLIDE_RUBRIC_KEYS[1]}
      />
      <div className={styles.problemGrid}>
        <article className={styles.questionCard}>
          <NotebookPen />
          <p>核心研究問題</p>
          <h2>
            <span>影像與餐期資料，</span>
            <span>能不能幫助學校</span>
            <span>做出更好的供餐決策？</span>
          </h2>
        </article>
        <div className={styles.problemSteps}>
          {[
            ["剩了什麼", "把模糊印象拆成食物類別"],
            ["為什麼剩", "對照星期、菜色、班級與情境"],
            ["下次怎麼改", "提出保守、可追溯的供餐試算"],
          ].map(([title, text], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <EvidenceFooter>
        115 學年度臺北市營養午餐約涵蓋 18.6 萬名學生（
        <a
          href="https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=55614625852816D3"
          target="_blank"
          rel="noreferrer"
        >
          臺北市政府，115/04
        </a>
        ）；
        {mode === "demo-local"
          ? "這個原型還沒有參賽團隊的實測基準"
          : "目前仍需累積可比較的餐盤類別與秤重基準"}
        。
      </EvidenceFooter>
    </section>,
    <section className={styles.slide} key="method">
      <Header
        number="02"
        eyebrow="研究方法"
        title="兩個閉環：先減少浪費，也追到處理責任"
        rubrics={SLIDE_RUBRIC_KEYS[2]}
      />
      <div className={styles.loop}>
        {[
          [Camera, "確認菜單", "照片初判只是草稿，逐欄人工確認"],
          [Scale, "五源量測", "備料、未供餐、餐盤、不可食、液體分開"],
          [UsersRound, "找原因", "匿名回饋與現場情境一起判讀"],
          [BarChart3, "供餐試驗", "有樣本門檻、減量上限與人類決定"],
          [Truck, "清運交接", "所選來源、重量與預定去向分開留證"],
          [ShieldCheck, "收據核驗", "核驗後才顯示處理場實際去向"],
        ].map(([Icon, title, text], index) => {
          const ItemIcon = Icon as typeof Camera;
          return (
            <article key={String(title)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <ItemIcon />
              <h3>{String(title)}</h3>
              <p>{String(text)}</p>
            </article>
          );
        })}
      </div>
      <div className={styles.methodStrip}>
        <strong>兩個閉環不混用</strong>
        <span>預防：菜單 → 量測 → 決策 → 再量測</span>
        <ArrowRight />
        <span>責任：分流 → 交接 → 收據 → 核驗</span>
      </div>
    </section>,
    <section className={styles.slide} key="collaboration">
      <Header
        number="03"
        eyebrow="人機協作"
        title="模型先整理，學生保留最後判斷權"
        rubrics={SLIDE_RUBRIC_KEYS[3]}
      />
      <div className={styles.collaborationGrid}>
        <div className={styles.plateFrame}>
          <Image
            src="/demo/plate-curry.png"
            alt="咖哩餐盤示範照片"
            fill
            sizes="42vw"
          />
          <span>AI 生成示範照片 · 非實測</span>
        </div>
        <div className={styles.correctionLedger}>
          <small className={styles.exampleLabel}>
            {mode === "demo-local"
              ? "固定示範案例，用來練習辨識與修正流程"
              : "操作示意，不是目前校園資料的分析結果"}
          </small>
          <div className={styles.ledgerHead}>
            <span>
              {mode === "demo-local"
                ? "規則初判示意（比例／示範分數）"
                : "AI 初判示意（比例／信心）"}
            </span>
            <span>學生修正示意（比例／估計克數）</span>
          </div>
          {[
            ["白飯", "34% · 92%", "學生 34% · 41g"],
            ["青花菜", "48% · 68%", "學生 58% · 46g"],
            ["咖哩雞肉", "17% · 81%", "學生 12% · 9g"],
          ].map(([food, original, corrected]) => (
            <div className={styles.ledgerRow} key={food}>
              <strong>{food}</strong>
              <span>
                {mode === "demo-local" ? "規則 " : "AI "}
                {original}
              </span>
              <ArrowRight />
              <b>{corrected}</b>
              <Check />
            </div>
          ))}
          <small className={styles.correctionReason}>
            青花菜修正理由：醬汁與餐盤邊界讓模型漏判；原始值與修正值一併保留。
          </small>
          <p>
            <ShieldCheck /> 未逐項人工確認前，資料不會寫入。
          </p>
        </div>
      </div>
      <EvidenceFooter>
        影像重量＝標準原始份量 × 影像估計比例；不是電子秤實測。
      </EvidenceFooter>
    </section>,
    <section className={styles.slide} key="findings">
      <Header
        number="04"
        eyebrow={mode === "demo-local" ? "規則引擎門檻測試" : "校園資料發現"}
        title={
          mode === "demo-local"
            ? "刻意設計情境，測試系統會不會重新計算"
            : "結論不是寫死的，它必須通過門檻"
        }
        rubrics={SLIDE_RUBRIC_KEYS[4]}
      />
      <div className={styles.findingGrid}>
        {[
          ...evidence.insights.slice(0, 3),
          ...Array.from(
            { length: Math.max(0, 3 - evidence.insights.length) },
            (_, index) => ({
              id: `pending-${index}`,
              title: "其餘差異尚未達門檻",
              description:
                "資料不足時先保留空白，比為了湊結論而過度解讀更重要。",
              evidence: "下一步：增加獨立供餐日期，再重新檢查",
            }),
          ),
        ].map((insight, index) => (
          <article key={insight.id}>
            <span>
              {mode === "demo-local" ? "門檻測試" : "發現"} 0{index + 1}
            </span>
            <h2>{insight.title}</h2>
            <p>{insight.description}</p>
            <small>{insight.evidence}</small>
          </article>
        ))}
      </div>
      <div className={styles.ruleLine}>
        <ShieldCheck />
        {mode === "demo-local"
          ? "示範資料中的星期五、蔬菜、咖哩與後期趨勢都是刻意設計，不是校園實測發現。"
          : "星期／班級與食物類別皆有最低樣本門檻；差異小於 5 個百分點時，不製造結論。"}
      </div>
    </section>,
    <section className={styles.slide} key="decision">
      <Header
        number="05"
        eyebrow="決策建議"
        title="建議保守減量，決定仍然交給學校"
        rubrics={SLIDE_RUBRIC_KEYS[5]}
      />
      <div className={styles.decisionGrid}>
        <article>
          <p>示範輸入基準</p>
          <strong>
            25.0 <small>kg</small>
          </strong>
          <span>
            {JUDGE_DEMO_PREDICTION_INPUT.plannedPeople} 人 ·{" "}
            {JUDGE_DEMO_PREDICTION_INPUT.menuName}
          </span>
        </article>
        <ArrowRight className={styles.decisionArrow} />
        <article className={styles.recommended}>
          <p>FoodLens 試算</p>
          <strong>
            {(evidence.prediction.recommendedSupplyG / 1000).toFixed(1)}{" "}
            <small>kg</small>
          </strong>
          <span>保留安全餘量與減量上限</span>
        </article>
        <div className={styles.savingCard}>
          <span>可能少備</span>
          <strong>
            {(evidence.prediction.possibleSavingG / 1000).toFixed(1)} kg
          </strong>
          <p>{evidence.prediction.reason}</p>
        </div>
      </div>
      <div className={styles.decisionNote}>
        <Utensils />
        此頁以 100 人、25 kg
        作為試算輸入，不代表校方原計畫；營養師仍需考量營養、出席與補餐安全。
      </div>
    </section>,
    <section className={styles.slide} key="experiment">
      <Header
        number="06"
        eyebrow={mode === "demo-local" ? "驗證方法示範" : "改善驗證"}
        title={
          mode === "demo-local"
            ? "用前後比較情境，示範如何避免誇大"
            : "同時呈現百分點、相對改善與限制"
        }
        rubrics={SLIDE_RUBRIC_KEYS[6]}
      />
      {evidence.experiment?.isValid ? (
        <div className={styles.experimentGrid}>
          <article>
            <span>{mode === "demo-local" ? "情境前期" : "基準期"}</span>
            <strong>
              {(evidence.experiment.beforeRate * 100).toFixed(0)}%
            </strong>
            <small>{evidence.experiment.beforeSamples} 餐期</small>
            <small>{evidence.experiment.beforeDateCount} 個獨立供餐日</small>
          </article>
          <div>
            <ArrowRight />
            <strong>
              下降 {(evidence.experiment.pointDrop * 100).toFixed(1)} 個百分點
            </strong>
            <span>
              相對改善{" "}
              {(evidence.experiment.relativeImprovement * 100).toFixed(1)}%
            </span>
          </div>
          <article className={styles.after}>
            <span>{mode === "demo-local" ? "情境後期" : "改善期"}</span>
            <strong>{(evidence.experiment.afterRate * 100).toFixed(0)}%</strong>
            <small>{evidence.experiment.afterSamples} 餐期</small>
            <small>{evidence.experiment.afterDateCount} 個獨立供餐日</small>
          </article>
        </div>
      ) : (
        <div className={styles.caveats}>
          <h3>目前篩選範圍尚未通過前後期最低樣本門檻</h3>
          <p>
            保留空白比顯示不可靠的改善率更重要；請回到全校範圍或增加獨立供餐日。
          </p>
        </div>
      )}
      <div className={styles.caveats}>
        <h3>我們不會把漂亮差異直接說成因果</h3>
        <p>
          {mode === "demo-local"
            ? "前後各只有 2 個獨立供餐日，而且菜單不同、沒有對照組；這只示範計算方法，不能判斷介入成效。"
            : "菜單、天氣、出席與活動都可能影響結果；下一輪應增加獨立供餐日期並記錄干擾因素。"}
        </p>
      </div>
    </section>,
    <section className={styles.slide} key="conclusion">
      <Header
        number="07"
        eyebrow="結論與擴散"
        title="真正重要的，是讓人更有依據地負責"
        rubrics={SLIDE_RUBRIC_KEYS[7]}
      />
      <div className={styles.conclusionGrid}>
        <div className={styles.impactNumber}>
          <Leaf />
          <p>
            {mode === "demo-local" ? "示範輸入" : "目前試算輸入"}：
            {dailyBaselineKg.toFixed(1)} kg／日 × 假設改善 20%
          </p>
          <strong>
            {(evidence.impact.year.grams / 1000).toFixed(0)}{" "}
            <small>kg／年</small>
          </strong>
          <span>
            {mode === "demo-local"
              ? "參賽團隊實測基準尚未建立"
              : impactSettings.sourceTitle
                ? `基準來源：${impactSettings.sourceTitle}`
                : "基準來源尚待校方補充"}
            ｜情境估算，不是成果
          </span>
          <small className={styles.impactFormula}>
            算式：{dailyBaselineKg.toFixed(1)} kg／日 × 20% ×{" "}
            {impactSettings.schoolDaysPerWeek} 日／週 ×{" "}
            {impactSettings.weeksPerSemester} 週／學期 ×{" "}
            {impactSettings.semestersPerYear} 學期。
            {mode === "demo-local" &&
              ` ${dailyBaselineKg.toFixed(1)} kg／日是示範係數，尚未由參賽團隊實測。`}
          </small>
        </div>
        <div className={styles.takeaways}>
          {[
            "學生看得見模型原始判斷，也能修正它",
            "每個結論都能查回餐期、樣本與計算方式",
            "供餐試算有安全上限，最後由人決定",
            "實際去向須有處理場收據，預定路線不算成果",
            "下一步由校方、營養師、供餐與清運端共同實測",
          ].map((text) => (
            <p key={text}>
              <Check />
              {text}
            </p>
          ))}
        </div>
      </div>
      <blockquote className={styles.finalQuote}>
        讓每一份沒吃完的午餐，都變成下一餐更好的答案。
      </blockquote>
    </section>,
  ];

  const currentPhase = getPhase(phase);
  const timerState = getPhaseTimerState(phase, elapsedByPhase[phase]);
  const timerText = timerState.isOvertime
    ? `超時 +${formatClock(timerState.overtimeSeconds)}`
    : `剩餘 ${formatClock(timerState.remainingSeconds)}`;

  const cycleQuestionPack = () => {
    setQuestionPackIndex(
      (current) => (current + 1) % REHEARSAL_QUESTION_PACKS.length,
    );
    setQuestionIndex(0);
    setRevealedQuestionIds(new Set());
    setCompletedQuestionIds(new Set());
  };

  const chooseQuestionFromBank = (questionId: string) => {
    const nextPackIndex = REHEARSAL_QUESTION_PACKS.findIndex((pack) =>
      pack.some((id) => id === questionId),
    );
    if (nextPackIndex < 0) return;
    const nextQuestionIndex = REHEARSAL_QUESTION_PACKS[nextPackIndex].findIndex(
      (id) => id === questionId,
    );
    setQuestionPackIndex(nextPackIndex);
    setQuestionIndex(Math.max(0, nextQuestionIndex));
  };

  return (
    <main className={styles.stage} aria-label="FoodLens 決選簡報與答詢排練">
      <header className={styles.toolbar}>
        <Link href="/" aria-label="離開簡報">
          <X />
        </Link>
        <div
          className={styles.phaseSwitcher}
          role="group"
          aria-label="決選排練階段"
        >
          {PRESENTATION_PHASES.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === phase ? styles.activePhase : ""}
              onClick={() => switchPhase(item.id)}
              aria-pressed={item.id === phase}
              aria-label={item.label}
              title={item.guidance}
            >
              <span className={styles.phaseLongLabel}>{item.label}</span>
              <span className={styles.phaseShortLabel}>{item.shortLabel}</span>
            </button>
          ))}
        </div>
        <div className={styles.status} aria-label="目前展示資料與範圍">
          <span className={styles.statusItem}>
            <span className={styles.demoDot} />
            {mode === "demo-local" ? "示範資料" : "校園資料"}
          </span>
          <span className={styles.separator} />
          <span className={`${styles.statusItem} ${styles.aiStatus}`}>
            <ScanLine /> 辨識：
            {mode === "demo-local" ? "示範規則" : "逐次標示 Mock／真實"}
          </span>
          <span className={styles.separator} />
          <span className={`${styles.statusItem} ${styles.scopeStatus}`}>
            {filters.classId === "all"
              ? "全部班級"
              : (snapshot.classes.find((item) => item.id === filters.classId)
                  ?.name ?? "指定班級")}
          </span>
        </div>
        <div className={styles.timerGroup}>
          <button
            className={styles.timerReset}
            type="button"
            onClick={() =>
              setElapsedByPhase((current) => ({ ...current, [phase]: 0 }))
            }
            aria-label={`重設${currentPhase.label}計時`}
            title="重設計時"
          >
            <RotateCcw />
          </button>
          <button
            className={`${styles.timerButton} ${timerState.isOvertime ? styles.timerOvertime : ""}`}
            type="button"
            onClick={() => setRunning((value) => !value)}
            aria-pressed={running}
            aria-label={`${running ? "暫停" : "開始計時"}：${currentPhase.label}，${timerText}`}
          >
            <Clock3 />
            <span>{timerText}</span>
            <strong>{running ? "暫停" : "開始計時"}</strong>
          </button>
        </div>
      </header>
      <div
        className={`${styles.canvas} ${phase === "presentation" ? "" : styles.rehearsalCanvas}`}
        aria-live="polite"
      >
        {phase === "presentation" ? (
          slides[slide]
        ) : (
          <RehearsalPanel
            phase={phase}
            mode={mode}
            packIndex={questionPackIndex}
            questions={rehearsalQuestions}
            activeIndex={questionIndex}
            revealedQuestionIds={revealedQuestionIds}
            completedQuestionIds={completedQuestionIds}
            onSelectQuestion={setQuestionIndex}
            onPreviousQuestion={() =>
              setQuestionIndex((current) => Math.max(0, current - 1))
            }
            onNextQuestion={() =>
              setQuestionIndex((current) =>
                Math.min(rehearsalQuestions.length - 1, current + 1),
              )
            }
            onToggleReveal={(questionId) =>
              toggleQuestionId(setRevealedQuestionIds, questionId)
            }
            onToggleComplete={(questionId) =>
              toggleQuestionId(setCompletedQuestionIds, questionId)
            }
            onCyclePack={cycleQuestionPack}
            onOpenAnswers={() => switchPhase("team-answers")}
            onOpenQuestions={() => switchPhase("judge-questions")}
            onChooseFromBank={chooseQuestionFromBank}
          />
        )}
      </div>
      {phase === "presentation" && (
        <>
          <footer className={styles.controls}>
            <button
              type="button"
              onClick={() => go(slide - 1)}
              disabled={slide === 0}
              aria-label="上一頁"
            >
              <ArrowLeft />
            </button>
            <div
              className={styles.progress}
              aria-label={`第 ${slide + 1} 頁，共 8 頁`}
            >
              {slides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={
                    index === slide
                      ? styles.active
                      : index < slide
                        ? styles.done
                        : ""
                  }
                  onClick={() => go(index)}
                  aria-label={`前往第 ${index + 1} 頁`}
                  aria-current={index === slide ? "step" : undefined}
                >
                  <span />
                </button>
              ))}
            </div>
            <div className={styles.pageMeta}>
              <span>{slide + 1} / 8</span>
              <span>建議 {SLIDE_SECONDS[slide]} 秒</span>
            </div>
            <button
              type="button"
              onClick={() => go(slide + 1)}
              disabled={slide === SLIDE_SECONDS.length - 1}
              aria-label="下一頁"
            >
              <ArrowRight />
            </button>
          </footer>
          <p className={styles.keyboardHint}>← → 或空白鍵換頁</p>
        </>
      )}
    </main>
  );
}

function Header({
  number,
  eyebrow,
  title,
  rubrics,
}: {
  number: string;
  eyebrow: string;
  title: string;
  rubrics: readonly FinalRubricKey[];
}) {
  return (
    <header className={styles.slideHeader}>
      <span>{number}</span>
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <RubricSummary activeKeys={rubrics} compact />
    </header>
  );
}

function RubricSummary({
  activeKeys,
  compact = false,
}: {
  activeKeys: readonly FinalRubricKey[];
  compact?: boolean;
}) {
  const rubrics = compact
    ? activeKeys.map((key) => getRubric(key))
    : FINAL_RUBRICS;

  return (
    <div
      className={`${styles.rubricSummary} ${compact ? styles.compactRubricSummary : ""}`}
      aria-label={
        compact
          ? "本頁對應決選評分"
          : "官方決選評分：可行性 30%、完整性 30%、發展性 30%、發表 10%"
      }
    >
      {rubrics.map((rubric) => (
        <span
          key={rubric.key}
          className={activeKeys.includes(rubric.key) ? styles.activeRubric : ""}
        >
          {compact && <small>本頁支撐</small>}
          <strong>{rubric.label}</strong>
          <b>{rubric.weight}%</b>
        </span>
      ))}
    </div>
  );
}

function EvidenceFooter({ children }: { children: ReactNode }) {
  return (
    <p className={styles.evidenceFooter}>
      <BookOpenText />
      <span>{children}</span>
    </p>
  );
}
