"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  History,
  RotateCcw,
  Save,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useFoodLens } from "@/components/data-provider";
import { SupplyCollaborationSheet } from "@/components/forecast/supply-collaboration-sheet";
import { getActualMenuDishes } from "@/lib/menu-intelligence";
import {
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import {
  assessPredictionConfidence,
  assessPredictionStability,
  createPrediction,
  describePredictionStability,
  getHistoricalSupplyBaseline,
  getPredictionEvidence,
  isActionablePrediction,
  JUDGE_DEMO_PREDICTION_INPUT,
  sortPredictionsNewestFirst,
} from "@/lib/prediction";
import type { SupplyPrediction } from "@/lib/types";
import { kg, twd } from "@/lib/utils";

const confidenceLabels = {
  high: "高：相同菜色至少 6 日，且逐日波動穩定",
  medium: "中：相同菜色 3–5 日，或高樣本但仍有波動",
  low: "低：相似／整體基準、樣本不足或波動大",
};
const stabilityLabels = {
  stable: "穩定",
  mixed: "有波動",
  volatile: "波動大",
  insufficient: "尚待更多日期",
};
const matchLabels = {
  exact: "相同菜色",
  similar: "相似主菜／食材",
  baseline: "全校近期基準",
  insufficient: "資料不足",
};
type ForecastInput = {
  plannedPeople: number | "";
  menuName: string;
  plannedSupplyKg: number | "";
  supplyMode: "automatic" | "manual";
};

const demoForecastInput: ForecastInput = {
  plannedPeople: JUDGE_DEMO_PREDICTION_INPUT.plannedPeople,
  menuName: JUDGE_DEMO_PREDICTION_INPUT.menuName,
  plannedSupplyKg: "",
  supplyMode: "automatic",
};
const emptySchoolForecastInput: ForecastInput = {
  plannedPeople: "",
  menuName: "",
  plannedSupplyKg: "",
  supplyMode: "automatic",
};

export default function ForecastPage() {
  const {
    snapshot,
    scopedSnapshot,
    loading,
    repository,
    refresh,
    filters,
    mode,
  } = useFoodLens();
  const [inputs, setInputs] = useState({
    "demo-local": demoForecastInput,
    "school-cloud": emptySchoolForecastInput,
  });
  const input = inputs[mode];
  const setInput = (next: ForecastInput) =>
    setInputs((current) => ({ ...current, [mode]: next }));
  const calculationKey = JSON.stringify([
    mode,
    filters.classId,
    filters.range,
    input.plannedPeople,
    input.menuName,
    input.supplyMode,
    input.plannedSupplyKg,
  ]);
  const [calculation, setCalculation] = useState<{
    calculationKey: string;
    result: SupplyPrediction;
    usedHistoryBaseline: boolean;
  }>();
  const [calculationError, setCalculationError] = useState<{
    calculationKey: string;
    message: string;
  }>();
  const result =
    calculation?.calculationKey === calculationKey
      ? calculation.result
      : undefined;
  const visibleCalculationError =
    calculationError?.calculationKey === calculationKey
      ? calculationError.message
      : undefined;
  const [saving, setSaving] = useState(false);
  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  const automaticBaseline = getHistoricalSupplyBaseline(scopedSnapshot, {
    plannedPeople: Number(input.plannedPeople),
    menuName: input.menuName,
    plannedSupplyG: 0,
  });
  const automaticSupplyKg = automaticBaseline.plannedSupplyG / 1000;
  const confirmedMenuOptions = [
    ...new Set([
      ...scopedSnapshot.evidenceCases.map((evidenceCase) =>
        getActualMenuDishes(evidenceCase.menuVersion)
          .map((dish) => dish.rawName)
          .join("｜"),
      ),
      ...scopedSnapshot.meals.map((meal) => meal.staple + "｜" + meal.mainDish),
    ]),
  ]
    .filter(Boolean)
    .slice(0, 40);
  const displayedSupplyKg =
    input.supplyMode === "automatic"
      ? automaticBaseline.plannedSupplyG > 0
        ? automaticSupplyKg
        : ""
      : input.plannedSupplyKg;
  const calculate = () => {
    const usedHistoryBaseline = input.supplyMode === "automatic";
    const plannedSupplyG =
      input.supplyMode === "automatic"
        ? 0
        : Math.round(Number(input.plannedSupplyKg) * 1000);
    const nextResult = createPrediction(scopedSnapshot, {
      plannedPeople: Number(input.plannedPeople),
      menuName: input.menuName,
      plannedSupplyG,
    });
    if (!isActionablePrediction(nextResult)) {
      setCalculation(undefined);
      setCalculationError({
        calculationKey,
        message:
          "目前篩選範圍沒有可用的餐期紀錄，無法提出供餐建議。請先新增實測餐期或放寬全站篩選；原計畫量仍由學校自行決定。",
      });
      return;
    }
    setCalculationError(undefined);
    setCalculation({
      calculationKey,
      usedHistoryBaseline,
      result: nextResult,
    });
  };
  const save = async () => {
    if (!result || !isActionablePrediction(result)) {
      toast.error("資料不足，這次沒有可保存的供餐建議");
      return;
    }
    setSaving(true);
    try {
      await repository.savePrediction(result);
      await refresh();
      toast.success("供餐情境已保存，可用於後續改善實驗");
    } catch {
      toast.error("無法保存；結果仍保留在畫面上");
    } finally {
      setSaving(false);
    }
  };
  const matched = result ? getPredictionEvidence(scopedSnapshot, result) : [];
  const stability = result ? assessPredictionStability(matched) : undefined;
  const confidenceAssessment =
    result && stability
      ? assessPredictionConfidence(
          result.matchLevel,
          stability.independentDateCount,
          stability,
        )
      : undefined;
  const savedPredictions = sortPredictionsNewestFirst(snapshot.predictions);
  const currentResultSaved = Boolean(
    result && savedPredictions.some((item) => item.id === result.id),
  );
  const missingRequirements = [
    !input.menuName.trim() ? "菜色關鍵字" : undefined,
    Number(input.plannedPeople) < 1 ? "至少 1 位用餐人數" : undefined,
    input.supplyMode === "manual" &&
    (input.plannedSupplyKg === "" || input.plannedSupplyKg <= 0)
      ? "大於 0 kg 的校方原計畫"
      : undefined,
    input.supplyMode === "automatic" && automaticBaseline.plannedSupplyG <= 0
      ? "可用的歷史基準，或改填人工原計畫"
      : undefined,
  ].filter((item): item is string => Boolean(item));
  const linkedExperimentCount = snapshot.experiments.reduce(
    (counts, experiment) => {
      if (experiment.linkedPredictionId)
        counts.set(
          experiment.linkedPredictionId,
          (counts.get(experiment.linkedPredictionId) ?? 0) + 1,
        );
      return counts;
    },
    new Map<string, number>(),
  );
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="決策｜供餐量試算"
        title="把過去的浪費，轉成有安全界線的下一餐建議"
        description="系統提出可解釋的減量情境；營養師與學校仍保有最後決定權。"
        icon={Scale}
      />
      <div className="decision-warning">
        <ShieldCheck size={22} />
        <div>
          <strong>這是決策建議，不是自動供餐指令</strong>
          <p>
            系統不會自行下單，也不建議一次大幅減量。請同時考量營養需求、出席人數與備援份量。
          </p>
        </div>
      </div>
      <div className="forecast-layout">
        <Panel>
          <PanelTitle
            kicker="情境輸入"
            title="下一餐準備供應什麼？"
            note="預設依相似餐期的每人供應中位數 × 預計人數建立基準；人工調整後仍以學校原計畫為準。"
          />
          <div className="forecast-form">
            <label>
              <span>
                <Users size={17} />
                預計用餐人數
              </span>
              <div className="suffix-input">
                <input
                  type="number"
                  min="1"
                  max="2000"
                  value={input.plannedPeople}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      plannedPeople:
                        event.target.value === ""
                          ? ""
                          : Number(event.target.value),
                    })
                  }
                />
                <i>人</i>
              </div>
            </label>
            <label>
              <span>
                <ClipboardCheck size={17} />
                菜色關鍵字
              </span>
              <input
                list="foodlens-confirmed-menu-options"
                value={input.menuName}
                onChange={(event) =>
                  setInput({ ...input, menuName: event.target.value })
                }
                placeholder="例如：咖哩飯｜雞肉咖哩、雞肉、魚"
              />
              <datalist id="foodlens-confirmed-menu-options">
                {confirmedMenuOptions.map((menu) => (
                  <option key={menu} value={menu} />
                ))}
              </datalist>
            </label>
            <label>
              <span>
                <Scale size={17} />
                供餐比較基準
              </span>
              <div className="suffix-input">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={displayedSupplyKg}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      supplyMode: "manual",
                      plannedSupplyKg:
                        event.target.value === ""
                          ? ""
                          : Number(event.target.value),
                    })
                  }
                  placeholder="尚無歷史基準，請輸入原計畫"
                />
                <i>kg</i>
              </div>
            </label>
            <div className="algorithm-note" role="status" aria-live="polite">
              <Gauge size={18} />
              <p>
                {input.supplyMode === "automatic" ? (
                  automaticBaseline.plannedSupplyG > 0 ? (
                    <>
                      <strong>
                        目前：自動歷史基準{" "}
                        {kg(automaticBaseline.plannedSupplyG)}
                      </strong>
                      <br />依{" "}
                      {Math.round(automaticBaseline.historicalPerPersonG)}g／人
                      × {input.plannedPeople || "尚未輸入"}{" "}
                      人計算。調整上方數值即可改為人工原計畫。
                    </>
                  ) : (
                    <>
                      <strong>目前：等待人工原計畫</strong>
                      <br />
                      目前菜色沒有足夠歷史供應資料，請輸入學校預計供餐量後再分析。
                    </>
                  )
                ) : (
                  <>
                    <strong>
                      目前：人工原計畫 {input.plannedSupplyKg || "尚未輸入"} kg
                    </strong>
                    <br />
                    已覆寫自動基準；保存後會在決策理由中保留這次人工輸入的供應量。
                  </>
                )}
              </p>
            </div>
            {input.supplyMode === "manual" && (
              <button
                type="button"
                className="secondary-action full"
                onClick={() =>
                  setInput({
                    ...input,
                    plannedSupplyKg: "",
                    supplyMode: "automatic",
                  })
                }
              >
                <RotateCcw size={16} />
                恢復自動歷史基準
              </button>
            )}
          </div>
          <button
            className="primary-action full"
            disabled={missingRequirements.length > 0}
            aria-describedby="forecast-missing-requirements"
            onClick={calculate}
          >
            分析歷史紀錄
            <ArrowRight size={17} />
          </button>
          <p
            id="forecast-missing-requirements"
            className="cta-requirements"
            role="status"
            aria-live="polite"
          >
            {missingRequirements.length
              ? `還缺：${missingRequirements.join("、")}`
              : "資料已齊全，可以分析歷史紀錄。"}
          </p>
          {visibleCalculationError && (
            <div
              className="analysis-warning forecast-validation"
              role="alert"
              aria-live="assertive"
            >
              <AlertCircle size={20} />
              <span>{visibleCalculationError}</span>
            </div>
          )}
          <div className="algorithm-note">
            <Gauge size={18} />
            <p>
              演算法 v1：最近 180 天相同菜色 3–8 個獨立供餐日優先；同日多班
              不會重複增加信心。建議減量只採歷史剩食率的 75%，並依匹配品質設
              15%、8%、5% 上限；再比較逐日波動，高波動時主動降低信心。
            </p>
          </div>
        </Panel>
        <Panel className={result ? "forecast-result ready" : "forecast-result"}>
          {!result ? (
            <div className="forecast-empty">
              <History size={30} />
              <h2>先輸入下一餐情境</h2>
              <p>
                FoodLens 會顯示用了哪些資料、為何給出這個建議，以及信心有多高。
              </p>
            </div>
          ) : (
            <>
              <div className="recommendation-stamp">
                供餐參考 <span>需人工確認</span>
              </div>
              <p className="section-kicker">FoodLens 建議情境</p>
              <h2>
                {result.menuName} · {result.plannedPeople} 人
              </h2>
              <div className="supply-compare">
                <div>
                  <span>
                    {calculation?.usedHistoryBaseline
                      ? "歷史試算基準"
                      : "校方原計畫"}
                  </span>
                  <strong>{kg(result.plannedSupplyG)}</strong>
                  <small>
                    {calculation?.usedHistoryBaseline
                      ? "依歷史每人供應中位數 × 人數"
                      : "由使用者輸入"}
                  </small>
                </div>
                <ArrowRight />
                <div className="recommended">
                  <span>建議參考量</span>
                  <strong>{kg(result.recommendedSupplyG)}</strong>
                  <small>保留安全餘量</small>
                </div>
              </div>
              <div className="saving-band">
                <div>
                  <span>相較基準可能少準備</span>
                  <strong>{kg(result.possibleSavingG)}</strong>
                </div>
                <div>
                  <span>可能節省成本</span>
                  <strong>NT$ {twd(result.possibleSavingTwd)}</strong>
                </div>
              </div>
              <dl className="reason-grid">
                <div>
                  <dt>歷史剩食率</dt>
                  <dd>{(result.averageLeftoverRate * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>資料匹配</dt>
                  <dd>{matchLabels[result.matchLevel]}</dd>
                </div>
                <div>
                  <dt>獨立供餐日</dt>
                  <dd>{result.independentDateCount} 日</dd>
                </div>
                <div>
                  <dt>信心水準</dt>
                  <dd>{confidenceLabels[result.confidence]}</dd>
                </div>
              </dl>
              {stability && (
                <div
                  className={
                    confidenceAssessment?.downgraded
                      ? "analysis-warning forecast-validation"
                      : "algorithm-note"
                  }
                  role="note"
                >
                  <Gauge size={18} />
                  <p>
                    <strong>
                      資料穩定度：{stabilityLabels[stability.level]}
                    </strong>
                    <br />
                    {describePredictionStability(stability)}
                    {confidenceAssessment?.downgradeReason && (
                      <> {confidenceAssessment.downgradeReason}</>
                    )}
                  </p>
                </div>
              )}
              <div className="reason-box">
                <strong>為什麼這樣建議？</strong>
                <p>{result.reason}</p>
                {result.historyStart && (
                  <small>
                    資料期間：{result.historyStart}–{result.historyEnd}
                  </small>
                )}
              </div>
              {currentResultSaved && result ? (
                <Link
                  className="primary-action full"
                  href={`/experiments?create=1&prediction=${encodeURIComponent(result.id)}`}
                >
                  <FlaskConical size={17} />
                  已保存・下一步建立改善實驗
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <button
                  className="primary-action full"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  <Save size={17} />
                  {saving ? "儲存中…" : "保存這個決策情境"}
                </button>
              )}
            </>
          )}
        </Panel>
      </div>
      {result && (
        <Panel>
          <PanelTitle
            kicker="相似紀錄"
            title="建議背後的歷史證據"
            note={
              matched.length
                ? `演算法實際使用 ${result.independentDateCount} 個獨立供餐日／${matched.length} 筆班級餐期`
                : "直接關鍵字不足，演算法可能使用較寬基準"
            }
          />
          {matched.length ? (
            <div className="history-table">
              <table>
                <caption className="sr-only">
                  本次智慧供餐建議實際採用的相似歷史餐期
                </caption>
                <thead>
                  <tr className="history-row head">
                    <th scope="col">日期</th>
                    <th scope="col">菜單</th>
                    <th scope="col">人數</th>
                    <th scope="col">供應量</th>
                    <th scope="col">剩食率</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((meal) => (
                    <tr className="history-row" key={meal.id}>
                      <td>{meal.servedOn}</td>
                      <td>
                        {meal.staple}・{meal.mainDish}
                      </td>
                      <td>{meal.actualPeople}</td>
                      <td>{kg(meal.totalSupplyG)}</td>
                      <td>
                        {((meal.leftoverG / meal.totalSupplyG) * 100).toFixed(
                          1,
                        )}
                        %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="inline-empty">
              <AlertCircle size={20} />
              <p>
                沒有直接關鍵字符合的紀錄；請查看上方匹配層級，避免把低信心結果當成精確答案。
              </p>
            </div>
          )}
        </Panel>
      )}
      {result && (
        <SupplyCollaborationSheet
          prediction={result}
          evidenceMeals={matched}
          baselineKind={
            calculation?.usedHistoryBaseline
              ? "historical-estimate"
              : "school-plan"
          }
          dataMode={mode}
        />
      )}
      {savedPredictions.length > 0 && (
        <Panel>
          <PanelTitle
            kicker="決策紀錄"
            title="已保存的供餐情境"
            note="保存後才能在改善實驗追蹤是否採用。"
          />
          <div className="saved-predictions">
            {savedPredictions.slice(0, 5).map((item) => {
              const experimentCount = linkedExperimentCount.get(item.id) ?? 0;
              return (
                <article key={item.id}>
                  <span>
                    <Check size={14} />
                    {experimentCount > 0
                      ? `已連結 ${experimentCount} 個實驗`
                      : "已保存，尚未驗證"}
                  </span>
                  <strong>
                    {item.menuName} · {item.plannedPeople} 人
                  </strong>
                  <p>
                    比較基準 {kg(item.plannedSupplyG)} → 建議量{" "}
                    {kg(item.recommendedSupplyG)}
                  </p>
                  <small>
                    {new Date(item.createdAt).toLocaleString("zh-TW")}
                  </small>
                  <Link
                    className="saved-prediction-action"
                    href={`/experiments?create=1&prediction=${encodeURIComponent(item.id)}`}
                    aria-label={`用 ${item.menuName} 的供餐建議建立改善實驗`}
                  >
                    <FlaskConical size={14} />
                    {experimentCount > 0 ? "再建立一組驗證" : "建立改善實驗"}
                  </Link>
                </article>
              );
            })}
          </div>
          <div className="button-row end">
            <Link
              className="secondary-action"
              href={`/experiments?create=1&prediction=${encodeURIComponent(savedPredictions[0].id)}`}
            >
              下一步：連結最新建議並建立改善實驗
              <ArrowRight size={16} />
            </Link>
          </div>
        </Panel>
      )}
    </div>
  );
}
