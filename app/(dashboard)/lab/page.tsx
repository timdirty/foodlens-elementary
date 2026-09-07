"use client";

import {
  BarChart3,
  BookOpenCheck,
  CircleAlert,
  Database,
  Droplets,
  FlaskConical,
  Info,
  Scale,
  ShieldCheck,
  TableProperties,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import { ComparisonBarChart } from "@/components/charts/lab-charts";
import { TrendChart } from "@/components/charts/dashboard-charts";
import { LunchTimeMachine } from "@/components/game/lunch-time-machine";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import {
  assessEvidenceDataQuality,
  categoryStats,
  classStats,
  dailyTrend,
  generateInsights,
  heatmapData,
  menuStats,
  selectEvidenceCasesForMode,
  snapshotDateRange,
  weekdayStats,
  weeklyStats,
} from "@/lib/analysis";
import { analyzeEvidenceCases } from "@/lib/evidence-chain";
import {
  WASTE_RULE_THRESHOLDS,
  type WasteSource,
} from "@/lib/waste-intelligence";

const weekdays = ["週一", "週二", "週三", "週四", "週五"];
function tone(rate: number | null) {
  if (rate === null) return "transparent";
  const alpha = Math.min(0.92, 0.12 + rate / 60);
  return `rgba(38,105,72,${alpha})`;
}

const WASTE_SOURCE_COPY: Record<
  WasteSource,
  { label: string; meaning: string; className: string }
> = {
  prep: {
    label: "備餐損耗",
    meaning: "另列；須依內容判斷是否可避免",
    className: "source-prep",
  },
  "unserved-edible": {
    label: "未供出可食",
    meaning: "列入可避免量（全餐秤重）",
    className: "source-unserved",
  },
  "plate-edible": {
    label: "餐盤可食",
    meaning: "圖中為抽樣實秤；總量另以覆蓋率外推",
    className: "source-plate",
  },
  inedible: {
    label: "不可食部分",
    meaning: "列入不可避免量",
    className: "source-inedible",
  },
  "liquid-contaminated": {
    label: "液體／受污染",
    meaning: "另列；不併入可避免量",
    className: "source-liquid",
  },
};

const PROVENANCE_LABELS = {
  demo: "示範",
  measured: "現場量測",
  estimated: "估算",
  official: "官方／校方確認",
} as const;

function formatWeight(grams: number) {
  return grams >= 1_000
    ? `${(grams / 1_000).toFixed(grams >= 10_000 ? 1 : 2)} kg`
    : `${grams.toLocaleString("zh-TW")} g`;
}

function formatRate(rate: number) {
  return `${(rate * 100).toFixed(0)}%`;
}

export default function LabPage() {
  const { snapshot, scopedSnapshot, loading, filters, mode } = useFoodLens();
  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  const scoped = scopedSnapshot;
  const dateRange = snapshotDateRange(scoped);
  const rangeLabel =
    filters.range === "8-weeks"
      ? mode === "demo-local"
        ? "示範情境 8 週"
        : "最近 8 週"
      : filters.range === "month"
        ? mode === "demo-local"
          ? "情境最近 30 天"
          : "最近 30 天"
        : "全部期間";
  const daily = dailyTrend(scoped);
  const weekly = weeklyStats(scoped);
  const weekday = weekdayStats(scoped);
  const categories = categoryStats(scoped);
  const menus = menuStats(scoped);
  const classes = classStats(scoped);
  const classRows = classes.filter((row) => row.count > 0);
  const insights = generateInsights(scoped);
  const heatmap = heatmapData(scoped);
  const hasDailyData = daily.length > 0;
  const hasWeeklyData = weekly.some((row) => row.count > 0);
  const hasWeekdayData = weekday.some((row) => row.count > 0);
  const hasClassData = classRows.length > 0;
  const hasCategoryData = categories.some((row) => row.count > 0);
  const hasHeatmapData = heatmap.some((row) =>
    row.values.some((cell) => cell.count > 0 && cell.rate !== null),
  );
  const hasMenuData = menus.some((row) => row.count > 0);
  const evidenceSelection = selectEvidenceCasesForMode(
    scoped.evidenceCases,
    mode,
  );
  const evidenceAnalysis = evidenceSelection.cases.length
    ? analyzeEvidenceCases(evidenceSelection.cases)
    : undefined;
  const evidenceMetrics = evidenceAnalysis?.metrics;
  const evidenceQuality = evidenceMetrics
    ? assessEvidenceDataQuality(evidenceMetrics)
    : undefined;
  const sourceRows = evidenceMetrics
    ? [
        {
          id: "prep" as const,
          grams: evidenceMetrics.measuredPrepG,
        },
        {
          id: "unserved-edible" as const,
          grams: evidenceMetrics.measuredUnservedEdibleG,
        },
        {
          id: "plate-edible" as const,
          grams: evidenceMetrics.measuredPlateEdibleG,
        },
        {
          id: "inedible" as const,
          grams: evidenceMetrics.measuredInedibleG,
        },
        {
          id: "liquid-contaminated" as const,
          grams: evidenceMetrics.measuredLiquidContaminatedG,
        },
      ]
    : [];
  const maximumSourceG = Math.max(1, ...sourceRows.map((row) => row.grams));
  const avoidableG = evidenceMetrics
    ? evidenceMetrics.measuredUnservedEdibleG +
      evidenceMetrics.estimatedPlateEdibleG
    : 0;
  const unavoidableG = evidenceMetrics?.measuredInedibleG ?? 0;
  const qualityChecks = evidenceMetrics
    ? [
        {
          id: "independent-meals",
          label: "獨立餐期",
          value: `${evidenceMetrics.independentMealCount} 日`,
          threshold: `至少 ${WASTE_RULE_THRESHOLDS.minimumIndependentMeals} 日`,
          progress: Math.min(
            1,
            evidenceMetrics.independentMealCount /
              WASTE_RULE_THRESHOLDS.minimumIndependentMeals,
          ),
          passed: evidenceQuality?.checks.independentMeals ?? false,
        },
        {
          id: "plate-coverage",
          label: "餐盤抽樣覆蓋",
          value: formatRate(evidenceMetrics.coverageRate),
          threshold: `至少 ${formatRate(WASTE_RULE_THRESHOLDS.minimumPlateCoverageRate)}`,
          progress: evidenceMetrics.coverageRate,
          passed: evidenceQuality?.checks.plateCoverage ?? false,
        },
        {
          id: "measurement-quality",
          label: "量測品質",
          value: formatRate(evidenceMetrics.evidenceQuality),
          threshold: `至少 ${formatRate(WASTE_RULE_THRESHOLDS.minimumEvidenceQuality)}`,
          progress: evidenceMetrics.evidenceQuality,
          passed: evidenceQuality?.checks.measurementQuality ?? false,
        },
        {
          id: "drainage",
          label: "標準瀝水覆蓋",
          value: formatRate(evidenceMetrics.standardDrainageCoverageRate),
          threshold: "可食量測全部採同一標準",
          progress: evidenceMetrics.standardDrainageCoverageRate,
          passed: evidenceQuality?.checks.standardDrainage ?? false,
        },
      ]
    : [];
  const evidenceReady = evidenceQuality?.isReady ?? false;
  const sourceProvenanceRows = evidenceAnalysis
    ? (["demo", "measured", "estimated", "official"] as const).map(
        (source) => ({
          source,
          label: PROVENANCE_LABELS[source],
          count: evidenceAnalysis.sourceSummary[source],
        }),
      )
    : [];
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="理解｜數據實驗室"
        title="每個結論，都能沿路查回原始紀錄"
        description="圖表統一採加權剩食率；文字洞察由資料與門檻即時計算，不預先寫死。"
        icon={BarChart3}
      />
      <div className="method-banner">
        <FlaskConical size={20} />
        <div>
          <strong>
            本頁目前分析：{mode === "demo-local" ? "模擬資料" : "校園記錄"} ·{" "}
            {rangeLabel}（{dateRange.start ?? "無資料"}–
            {dateRange.end ?? "無資料"}）·{" "}
            {filters.classId === "all"
              ? "全部班級"
              : snapshot.classes.find((item) => item.id === filters.classId)
                  ?.name}
          </strong>
          <p>
            星期洞察至少 3 個獨立供餐日，食物類別至少 5 項且涵蓋 3
            個供餐日，差異至少 5 個百分點；不足時不產生結論。
          </p>
        </div>
      </div>
      <section className="insight-grid">
        {insights.map((item, index) => (
          <article className={`lab-insight tone-${item.tone}`} key={item.id}>
            <span>發現 {String(index + 1).padStart(2, "0")}</span>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <small>{item.evidence}</small>
          </article>
        ))}
      </section>
      <LunchTimeMachine />
      <Panel className="evidence-lab-panel" id="five-source-evidence">
        <PanelTitle
          kicker="五源量測 × 資料可信度"
          title="五源廚餘結構與資料品質"
          note="先確認資料能不能比較，再討論問題落在哪裡。"
        />
        <div className="evidence-lane" aria-label="本區資料來源隔離狀態">
          <Database size={18} aria-hidden="true" />
          <div>
            <strong>
              {evidenceSelection.lane === "demo"
                ? "示範資料專用分析線"
                : "正式校園資料專用分析線"}
            </strong>
            <span>
              {evidenceSelection.lane === "demo"
                ? "只納入 provenance = demo；不代表本校實測結果。"
                : "只納入現場量測、估算或官方來源；不讓 Demo 影響校園結論。"}
              {evidenceSelection.excludedCount > 0
                ? ` 已隔離 ${evidenceSelection.excludedCount} 筆另一來源資料。`
                : ""}
            </span>
          </div>
        </div>
        {!evidenceAnalysis || !evidenceMetrics ? (
          <EmptyState
            title="這個篩選範圍還沒有同來源的五源紀錄"
            description="FoodLens 不會把示範與正式資料混在一起補足樣本；請調整班級或期間，或先完成一次五源量測。"
          />
        ) : (
          <>
            <div
              className={`evidence-readiness ${evidenceReady ? "is-ready" : "needs-data"}`}
              role="status"
              aria-live="polite"
            >
              {evidenceReady ? (
                <ShieldCheck size={22} aria-hidden="true" />
              ) : (
                <CircleAlert size={22} aria-hidden="true" />
              )}
              <div>
                <strong>
                  {evidenceReady
                    ? "資料條件足以描述目前的剩食結構"
                    : "需要更多資料，暫不升級為改善結論"}
                </strong>
                <span>
                  {evidenceReady
                    ? "四項品質門檻皆通過；仍只能描述關聯，不能直接宣稱因果。"
                    : qualityChecks
                        .filter((check) => !check.passed)
                        .map((check) => `${check.label}未達門檻`)
                        .join("、")}
                </span>
              </div>
            </div>

            <div className="evidence-outcome-grid">
              <article>
                <Scale size={19} aria-hidden="true" />
                <span>估計可避免量</span>
                <strong>{formatWeight(avoidableG)}</strong>
                <small>未供出實秤＋餐盤抽樣外推</small>
              </article>
              <article>
                <Droplets size={19} aria-hidden="true" />
                <span>不可避免量</span>
                <strong>{formatWeight(unavoidableG)}</strong>
                <small>只計不可食部分實秤</small>
              </article>
              <article>
                <span>餐盤抽樣實秤</span>
                <strong>
                  {formatWeight(evidenceMetrics.measuredPlateEdibleG)}
                </strong>
                <small>
                  代表 {formatWeight(evidenceMetrics.plateSampleSupplyG)}{" "}
                  的抽樣供應量
                </small>
              </article>
              <article>
                <span>外推餐盤可食量</span>
                <strong>
                  {formatWeight(evidenceMetrics.estimatedPlateEdibleG)}
                </strong>
                <small>
                  以加權餐盤率 {formatRate(evidenceMetrics.weightedPlateRate)}{" "}
                  換算
                </small>
              </article>
            </div>
            <DataTable
              caption="可避免量、不可避免量與餐盤抽樣外推資料"
              columns={["指標", "重量", "計算方式"]}
              rows={[
                [
                  "估計可避免量",
                  formatWeight(avoidableG),
                  "未供出可食實秤＋餐盤可食抽樣率外推",
                ],
                [
                  "不可避免量",
                  formatWeight(unavoidableG),
                  "不可食部分實際秤重；備餐損耗與液體另列",
                ],
                [
                  "餐盤抽樣實秤",
                  formatWeight(evidenceMetrics.measuredPlateEdibleG),
                  `抽樣供應量 ${formatWeight(evidenceMetrics.plateSampleSupplyG)}`,
                ],
                [
                  "外推餐盤可食量",
                  formatWeight(evidenceMetrics.estimatedPlateEdibleG),
                  `加權餐盤率 ${formatRate(evidenceMetrics.weightedPlateRate)}`,
                ],
              ]}
            />

            <div className="evidence-analysis-grid">
              <section aria-labelledby="waste-source-heading">
                <div className="evidence-subhead">
                  <div>
                    <p>結構</p>
                    <h3 id="waste-source-heading">五源實際秤重</h3>
                  </div>
                  <span>{evidenceAnalysis.caseCount} 筆餐期證據</span>
                </div>
                <div
                  className="waste-source-chart"
                  role="img"
                  aria-label="五種廚餘來源的實際秤重比較圖"
                >
                  {sourceRows.map((row) => {
                    const copy = WASTE_SOURCE_COPY[row.id];
                    return (
                      <div className="waste-source-row" key={row.id}>
                        <div>
                          <strong>{copy.label}</strong>
                          <span>{formatWeight(row.grams)}</span>
                        </div>
                        <span className="waste-source-track" aria-hidden="true">
                          <i
                            className={copy.className}
                            style={{
                              width: `${(row.grams / maximumSourceG) * 100}%`,
                            }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
                <DataTable
                  caption="五種廚餘來源實際秤重資料"
                  columns={["廚餘來源", "實際秤重", "判讀方式"]}
                  rows={sourceRows.map((row) => [
                    WASTE_SOURCE_COPY[row.id].label,
                    formatWeight(row.grams),
                    WASTE_SOURCE_COPY[row.id].meaning,
                  ])}
                />
              </section>

              <section aria-labelledby="evidence-quality-heading">
                <div className="evidence-subhead">
                  <div>
                    <p>品質</p>
                    <h3 id="evidence-quality-heading">四項資料門檻</h3>
                  </div>
                  <span>{evidenceReady ? "可描述" : "待補資料"}</span>
                </div>
                <div className="evidence-quality-list">
                  {qualityChecks.map((check) => (
                    <div
                      className={check.passed ? "is-passed" : "needs-data"}
                      key={check.id}
                    >
                      <div>
                        <strong>{check.label}</strong>
                        <span>
                          {check.value} · {check.passed ? "通過" : "未達"}
                        </span>
                      </div>
                      <progress
                        max={1}
                        value={check.progress}
                        aria-label={`${check.label}：${check.value}；門檻 ${check.threshold}`}
                      />
                      <small>{check.threshold}</small>
                    </div>
                  ))}
                </div>
                <DataTable
                  caption="五源證據品質門檻資料"
                  columns={["品質指標", "目前結果", "門檻", "狀態"]}
                  rows={qualityChecks.map((check) => [
                    check.label,
                    check.value,
                    check.threshold,
                    check.passed ? "通過" : "需要更多資料",
                  ])}
                />
              </section>
            </div>

            <div className="evidence-method-note">
              <Info size={18} aria-hidden="true" />
              <p>
                <strong>餐盤數字如何換算：</strong>
                圖中的「餐盤可食」是抽樣餐盤實際秤重；「估計可避免量」才把抽樣餐盤率外推至實際供出的整餐重量。
                這是透明估算，不是全班每一盤逐盤秤重，也不是單張照片的精確重量。
              </p>
            </div>

            <div
              className="evidence-provenance"
              aria-label="證據來源 provenance"
            >
              <div>
                <strong>來源 provenance</strong>
                <span>{evidenceAnalysis.sourceSummary.disclosureLabel}</span>
              </div>
              <div className="evidence-provenance-chips">
                {sourceProvenanceRows.map((row) => (
                  <span
                    className={row.count > 0 ? "is-present" : undefined}
                    key={row.source}
                  >
                    {row.label} {row.count}
                  </span>
                ))}
              </div>
            </div>
            <DataTable
              caption="五源分析所納入的證據來源資料"
              columns={["來源類型", "納入餐期數", "目前分析線"]}
              rows={sourceProvenanceRows.map((row) => [
                row.label,
                `${row.count} 筆`,
                evidenceSelection.lane === "demo" ? "示範" : "正式校園",
              ])}
            />
          </>
        )}
      </Panel>
      <div className="lab-grid wide-left">
        <Panel>
          <PanelTitle
            kicker="每日趨勢 · 單位 %"
            title={`${rangeLabel}每日剩食率`}
            note={`樣本 ${dateRange.independentDateCount} 個供餐日／${scoped.meals.length} 筆班級餐期`}
          />
          {hasDailyData ? (
            <>
              <TrendChart data={daily} />
              <DataTable
                caption={`${rangeLabel}每日加權剩食率資料`}
                columns={["日期", "加權剩食率", "餐期數"]}
                rows={daily.map((row) => [
                  row.label,
                  `${row.rate}%`,
                  `${row.samples} 筆`,
                ])}
              />
            </>
          ) : (
            <EmptyState
              title="這個範圍尚無餐期資料"
              description="調整班級或日期範圍，或先新增一筆完成秤重的餐期。"
            />
          )}
        </Panel>
        <Panel>
          <PanelTitle
            kicker="週平均 · 單位 %"
            title="不同週次比較"
            note="介入前後可視化"
          />
          {hasWeeklyData ? (
            <>
              <ComparisonBarChart
                data={weekly}
                ariaLabel="不同週次加權剩食率長條圖"
              />
              <DataTable
                caption="不同週次加權剩食率比較資料"
                columns={["週次", "加權剩食率", "餐期數"]}
                rows={weekly.map((row) => [
                  row.name,
                  `${row.rate}%`,
                  `${row.dateCount} 日／${row.count} 筆`,
                ])}
              />
            </>
          ) : (
            <EmptyState
              title="還不能比較週次"
              description="目前篩選範圍沒有可分組的供餐日；累積資料後才會畫圖。"
            />
          )}
        </Panel>
      </div>
      <div className="lab-grid three">
        <Panel>
          <PanelTitle
            kicker="星期比較"
            title="哪一天較容易剩"
            note="關聯不等同因果"
          />
          {hasWeekdayData ? (
            <>
              <ComparisonBarChart
                data={weekday}
                ariaLabel="星期別加權剩食率長條圖"
              />
              <DataTable
                caption="星期別加權剩食率比較資料"
                columns={["星期", "加權剩食率", "餐期數"]}
                rows={weekday.map((row) => [
                  row.name,
                  `${row.rate}%`,
                  `${row.dateCount} 日／${row.count} 筆`,
                ])}
              />
            </>
          ) : (
            <EmptyState
              title="還不能比較星期"
              description="目前沒有符合篩選的餐期；FoodLens 不會以 0% 代替缺少的樣本。"
            />
          )}
        </Panel>
        <Panel>
          <PanelTitle
            kicker="班級比較"
            title="匿名班級差異"
            note="不作為班級評比"
          />
          {hasClassData ? (
            <>
              <ComparisonBarChart
                data={classRows}
                ariaLabel="匿名班級加權剩食率長條圖"
              />
              <DataTable
                caption="匿名班級加權剩食率比較資料"
                columns={["班級", "加權剩食率", "餐期數"]}
                rows={classRows.map((row) => [
                  row.name,
                  `${row.rate}%`,
                  `${row.dateCount} 日／${row.count} 筆`,
                ])}
              />
            </>
          ) : (
            <EmptyState
              title="還不能比較班級"
              description="目前所選範圍沒有任何班級餐期，因此不顯示零值排名。"
            />
          )}
        </Panel>
        <Panel>
          <PanelTitle
            kicker="食物類別"
            title="人工作業後的分類"
            note="依標準份量加權"
          />
          {hasCategoryData ? (
            <>
              <ComparisonBarChart
                horizontal
                data={categories.slice(0, 7)}
                ariaLabel="食物類別加權剩食率橫向長條圖"
              />
              <DataTable
                caption="食物類別加權剩食率比較資料"
                columns={["食物類別", "加權剩食率", "辨識項目數"]}
                rows={categories.map((row) => [
                  row.name,
                  `${row.rate}%`,
                  `${row.dateCount} 日／${row.count} 項`,
                ])}
              />
            </>
          ) : (
            <EmptyState
              title="尚無食物類別樣本"
              description="需先完成餐盤判讀與學生確認，才會計算影像估計比例。"
            />
          )}
        </Panel>
      </div>
      <Panel>
        <PanelTitle
          kicker="星期 × 食物類型"
          title="剩食熱點矩陣"
          note="顏色越深代表估計剩食率越高；空白代表無樣本。"
        />
        {hasHeatmapData ? (
          <>
            <div
              className="heatmap-wrap"
              tabIndex={0}
              aria-label="可水平捲動的剩食熱圖"
            >
              <div
                className="heatmap"
                role="img"
                aria-label="星期與食物類型剩食率熱圖"
              >
                <span />
                {weekdays.map((day) => (
                  <strong key={day}>{day}</strong>
                ))}
                {heatmap.flatMap((row) => [
                  <strong key={`${row.category}-label`}>{row.name}</strong>,
                  ...row.values.map((cell) => (
                    <span
                      key={`${row.category}-${cell.day}`}
                      style={{
                        background: tone(cell.rate),
                        color:
                          cell.rate !== null && cell.rate > 26
                            ? "white"
                            : "var(--ink)",
                      }}
                      title={`${row.name} ${weekdays[cell.day - 1]}：${cell.rate === null ? "無資料" : `${cell.rate}%（${cell.count} 項）`}`}
                    >
                      {cell.rate === null ? "—" : `${cell.rate.toFixed(0)}%`}
                    </span>
                  )),
                ])}
              </div>
              <div className="heat-legend">
                <span>低</span>
                <i />
                <i />
                <i />
                <i />
                <span>高</span>
              </div>
            </div>
            <DataTable
              caption="星期與食物類型剩食熱點矩陣資料"
              columns={["食物類型", "星期", "估計剩食率", "辨識項目數"]}
              rows={heatmap.flatMap((row) =>
                row.values.map((cell) => [
                  row.name,
                  weekdays[cell.day - 1],
                  cell.rate === null ? "無資料" : `${cell.rate}%`,
                  `${cell.count} 項`,
                ]),
              )}
            />
          </>
        ) : (
          <EmptyState
            title="尚無熱圖樣本"
            description="目前沒有星期 × 食物類型的已確認餐盤資料，不以空白格冒充 0%。"
          />
        )}
      </Panel>
      <div className="lab-grid wide-right">
        <Panel>
          <PanelTitle
            kicker="菜色比較"
            title="哪些組合值得再研究"
            note={`共 ${menus.length} 種菜單`}
          />
          {hasMenuData ? (
            <>
              <ComparisonBarChart
                horizontal
                data={menus.slice(0, 8)}
                ariaLabel="不同菜單加權剩食率橫向長條圖"
              />
              <DataTable
                caption="不同菜單加權剩食率比較資料"
                columns={["菜單", "加權剩食率", "餐期數"]}
                rows={menus.map((row) => [
                  row.name,
                  `${row.rate}%`,
                  `${row.dateCount} 日／${row.count} 筆`,
                ])}
              />
            </>
          ) : (
            <EmptyState
              title="還不能比較菜單"
              description="目前篩選範圍沒有餐期菜單；新增紀錄後才會產生排行。"
            />
          )}
        </Panel>
        <Panel className="calculation-card">
          <BookOpenCheck size={24} />
          <h2>FoodLens 如何避免「漂亮但錯的圖」</h2>
          <ul>
            <li>所有比例採總重量加權，不直接平均百分比。</li>
            <li>AI 原始值不覆寫；學生修正另存。</li>
            <li>樣本不足時，顯示需要更多資料。</li>
            <li>只描述觀察到的關聯，不宣稱因果。</li>
            <li>每張圖都附期間、單位、樣本數與資料表。</li>
          </ul>
          <p>
            <Info size={15} />
            餐盤影像比例是估計；班級剩食率優先使用秤重紀錄。
          </p>
        </Panel>
      </div>
    </div>
  );
}

function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <details className="data-details">
      <summary>
        <TableProperties size={15} />
        查看資料表
      </summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th scope="row" key={cellIndex}>
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
