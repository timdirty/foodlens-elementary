"use client";

import Link from "next/link";
import {
  ArrowRight,
  Camera,
  ClipboardCheck,
  FileCheck2,
  MonitorPlay,
  NotebookPen,
  TrendingDown,
  Utensils,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import { TrendChart } from "@/components/charts/dashboard-charts";
import { ClosedLoopCase } from "@/components/product-story/closed-loop-case";
import { EmptyState, LoadingState } from "@/components/ui/page";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { DetectiveAllianceHub } from "@/components/game/detective-alliance-hub";
import {
  categoryRemainingShares,
  className,
  dailyTrend,
  dashboardMetrics,
  formatDate,
  generateInsights,
  menuStats,
  snapshotDateRange,
} from "@/lib/analysis";
import { kg, twd } from "@/lib/utils";
import { todayInTaipei } from "@/lib/date";
import { resolveProjectIdentity } from "@/lib/project-identity";

export default function DashboardPage() {
  const { snapshot, scopedSnapshot, loading, filters, mode } = useFoodLens();
  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  const scoped = scopedSnapshot;
  const { projectName, subtitle } = resolveProjectIdentity(snapshot.profile);
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
  const referenceDate = mode === "school-cloud" ? todayInTaipei() : undefined;
  const metrics = dashboardMetrics(scoped, referenceDate);
  const trend = dailyTrend(scoped);
  const categories = categoryRemainingShares(scoped);
  const menus = menuStats(scoped);
  const insights = generateInsights(scoped);
  const activeExperiment = snapshot.experiments[0];
  const recent = [...scoped.meals]
    .sort((a, b) => b.servedOn.localeCompare(a.servedOn))
    .slice(0, 4);
  const kpis = [
    {
      label: "本週班級剩食量",
      value: (metrics.weekLeftoverG / 1000).toFixed(1),
      unit: "kg",
      note: `約等於 ${Math.round(metrics.weekLeftoverG / 65)} 碗熱騰騰白飯 🍚`,
      tone: "dark",
    },
    {
      label: "平均剩食比例",
      value: (metrics.weekRate * 100).toFixed(1),
      unit: "%",
      note: metrics.experimentValid
        ? `較改善前顯著下降 ${(metrics.improvementRate * 100).toFixed(1)}% 📉`
        : `加權計算 · 涵蓋 ${metrics.weekMealCount} 筆餐期`,
      tone: "green",
    },
    {
      label: "已完成 AI 勘查餐盤",
      value: String(metrics.analyzedPlates),
      unit: "份",
      note: "均經學生「鷹眼校正」與骨頭扣除 🦅",
      tone: "amber",
    },
    {
      label: "累積避免食物浪費",
      value: (metrics.estimatedAvoidedWasteG / 1000).toFixed(1),
      unit: "kg",
      note: `估計節省約 ${twd(metrics.estimatedSavedCostTwd)} 元食材價值 🌱`,
      tone: "cream",
    },
  ];
  return (
    <div className="dashboard-wrap">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="hero-brandline">
            {projectName} <span>學生校園午餐剩食觀察</span>
          </p>
          <p className="hero-formal-title">專題副標｜{subtitle}</p>
          <div className="eyebrow">
            {rangeLabel}校園剩食調查｜{scoped.classes.length} 班｜
            {dateRange.start ?? "尚無資料"}–{dateRange.end ?? "尚無資料"}
          </div>
          <h1>
            這段期間，我們想弄清楚：
            <br />
            <em>午餐到底剩在哪裡？</em>
          </h1>
          <p>
            {mode === "demo-local" ? "示範資料包含" : "學生記錄"}{" "}
            {scoped.meals.length} 筆班級餐期、{scoped.scans.length} 份餐盤，涵蓋{" "}
            {dateRange.independentDateCount}
            個獨立供餐日；保留每次影像初判與人工修正，試著把「今天剩很多」變成下一餐可討論的證據。
          </p>
          <blockquote>
            讓每一份沒吃完的午餐，都變成下一餐更好的答案。
          </blockquote>
          <div
            className="mb-6 flex flex-wrap items-center gap-3"
            role="group"
            aria-label="快速行動"
          >
            <Link
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#2e7d32] px-6 text-sm font-bold text-white shadow-md hover:bg-[#1b5e20] transition"
              href="/scan"
            >
              <Camera size={18} aria-hidden="true" />
              開始餐盤 AI 辨識調查
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur hover:bg-white/20 transition"
              href="/presentation"
            >
              <MonitorPlay size={17} aria-hidden="true" />
              評審 8 分鐘簡報模式
            </Link>
          </div>
        </div>
        <ClosedLoopCase snapshot={scoped} mode={mode} />
      </section>
      {mode === "demo-local" && (
        <aside className="demo-evidence-banner" aria-label="示範資料說明">
          <FileCheck2 size={19} aria-hidden="true" />
          <strong>目前是系統測試情境，不是本校研究成果。</strong>
          <span>
            初始 48 筆餐期與 96
            份餐盤用來檢查計算、人工修正與前後比較流程；數字是刻意設計的可重現資料。
          </span>
          <Link href="/research#results">查看研究誠信說明</Link>
        </aside>
      )}
      <section className="kpi-grid" aria-label="核心指標">
        {kpis.map((kpi) => (
          <article className={`kpi-card ${kpi.tone}`} key={kpi.label}>
            <p>{kpi.label}</p>
            <div>
              <strong>
                <AnimatedNumber value={kpi.value} />
              </strong>
              <span>{kpi.unit}</span>
            </div>
            <small>{kpi.note}</small>
          </article>
        ))}
      </section>
      <DetectiveAllianceHub
        currentWasteKg={Number((metrics.weekLeftoverG / 1000).toFixed(1))}
      />
      <section className="dashboard-grid">
        <article className="card trend-card">
          <div className="card-head">
            <div>
              <p className="section-kicker">趨勢觀察 · {rangeLabel} · 單位 %</p>
              <h2>每日加權剩食率</h2>
            </div>
            <span className="delta-badge">
              {metrics.experimentValid ? (
                <>
                  <TrendingDown size={15} />
                  {(metrics.improvementRate * 100).toFixed(1)}%
                </>
              ) : (
                "樣本不足"
              )}
            </span>
          </div>
          <div className="chart-summary">
            <div>
              <strong>{(metrics.weekRate * 100).toFixed(1)}%</strong>
              <span>
                {mode === "demo-local"
                  ? "情境最後 7 天加權平均"
                  : "最近一週加權平均"}
              </span>
            </div>
            <p>總剩食重量 ÷ 總供應重量，沒有直接平均每筆百分比。</p>
          </div>
          {trend.length ? (
            <>
              <TrendChart data={trend} />
              <details className="data-details">
                <summary>查看圖表資料表</summary>
                <table>
                  <caption className="sr-only">
                    {rangeLabel}每日加權剩食率、餐期數與日期明細
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">日期</th>
                      <th scope="col">剩食率</th>
                      <th scope="col">餐期數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((row) => (
                      <tr key={row.date}>
                        <td>{row.label}</td>
                        <td>{row.rate}%</td>
                        <td>{row.samples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <EmptyState
              title="這個範圍還沒有餐期秤重"
              description="先新增一筆班級餐期；有供應重量與剩食重量後，才會繪製加權趨勢。"
            />
          )}
        </article>
        <article className="card insight-card">
          <div className="insight-icon">
            <NotebookPen size={20} />
          </div>
          <p className="section-kicker">研究筆記 #03 · 規則分析</p>
          <h2>{insights[0].title}</h2>
          <p className="insight-text">{insights[0].description}</p>
          <div className="evidence-row">
            <span>{insights[0].evidence}</span>
            <span>下一步：訪談口感、溫度與份量</span>
          </div>
          <Link className="text-link" href="/lab">
            查看計算依據 <ArrowRight size={15} />
          </Link>
        </article>
        <article className="card food-card menu-card">
          <div className="card-head">
            <div>
              <p className="section-kicker">班級餐期秤重 · {rangeLabel}</p>
              <h2>最易剩的菜單 Top 5</h2>
            </div>
            <Utensils size={20} />
          </div>
          {menus.length ? (
            <>
              <div className="food-list">
                {menus.slice(0, 5).map((menu, index) => (
                  <div className="food-row" key={menu.name}>
                    <span className="rank">0{index + 1}</span>
                    <strong>{menu.name}</strong>
                    <div className="progress">
                      <span
                        style={{
                          width: `${menu.rate}%`,
                          background: [
                            "#3d7a5b",
                            "#83a98f",
                            "#d99a3e",
                            "#d3b575",
                            "#8a6753",
                          ][index],
                        }}
                      />
                    </div>
                    <b>{menu.rate.toFixed(0)}%</b>
                  </div>
                ))}
              </div>
              <details className="data-details">
                <summary>查看菜單排行資料表</summary>
                <table>
                  <caption className="sr-only">
                    {rangeLabel}最容易剩下的五項菜單排行
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">菜單</th>
                      <th scope="col">加權剩食率</th>
                      <th scope="col">供餐日／餐期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menus.slice(0, 5).map((menu) => (
                      <tr key={menu.name}>
                        <td>{menu.name}</td>
                        <td>{menu.rate.toFixed(1)}%</td>
                        <td>
                          {menu.dateCount} 日／{menu.count} 筆
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <EmptyState
              title="這個範圍還沒有菜單秤重"
              description="先新增含供應重量與剩食重量的班級餐期，才會建立菜單加權排行。"
            />
          )}
        </article>
        <article className="card category-card">
          <div className="card-head">
            <div>
              <p className="section-kicker">餐盤樣本 · 最終人工確認</p>
              <h2>食物類別剩餘組成</h2>
            </div>
          </div>
          {categories.length ? (
            <>
              <p className="category-composition-note">
                各類別占餐盤樣本「估計剩餘克數」的比例；不是整班廚餘秤重，也不是各類別自身剩餘率。
              </p>
              <div
                className="category-composition-bar"
                role="img"
                aria-label={categories
                  .map(
                    (item) =>
                      `${item.name}占估計剩餘重量 ${item.share.toFixed(1)}%`,
                  )
                  .join("；")}
              >
                {categories.map((item, index) => (
                  <span
                    key={item.category}
                    style={{
                      width: `${item.share}%`,
                      background: [
                        "#2f7050",
                        "#7da58c",
                        "#d49338",
                        "#d9bd7d",
                        "#8b6752",
                        "#9aaf8e",
                        "#a7aaa2",
                      ][index],
                    }}
                  />
                ))}
              </div>
              <div className="category-composition-legend">
                {categories.map((item, index) => (
                  <div key={item.category}>
                    <i
                      aria-hidden="true"
                      style={{
                        background: [
                          "#2f7050",
                          "#7da58c",
                          "#d49338",
                          "#d9bd7d",
                          "#8b6752",
                          "#9aaf8e",
                          "#a7aaa2",
                        ][index],
                      }}
                    />
                    <span>{item.name}</span>
                    <strong>{item.share.toFixed(1)}%</strong>
                  </div>
                ))}
              </div>
              <details className="data-details">
                <summary>查看類別組成資料表</summary>
                <table>
                  <caption className="sr-only">
                    已由學生確認的餐盤樣本食物類別剩餘組成
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">食物類別</th>
                      <th scope="col">剩餘組成</th>
                      <th scope="col">估計剩餘重量</th>
                      <th scope="col">辨識項目</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((item) => (
                      <tr key={item.category}>
                        <td>{item.name}</td>
                        <td>{item.share.toFixed(1)}%</td>
                        <td>{item.remainingG.toLocaleString("zh-TW")} g</td>
                        <td>{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <EmptyState
              title="這個範圍還沒有已確認餐盤"
              description="先完成一次影像初判或人工判讀並由學生確認，才會顯示食物類別組成。"
            />
          )}
        </article>
        <article className="card improvement-card">
          <p className="section-kicker">
            改善證據 · {mode === "demo-local" ? "示範比較" : "校園改善紀錄"}
          </p>
          <h2>從「剩很多」到知道如何改善</h2>
          {metrics.experimentValid && activeExperiment ? (
            <>
              <div className="before-after">
                <div>
                  <span>基準期</span>
                  <strong>{(metrics.baselineRate * 100).toFixed(0)}%</strong>
                  <small>
                    {formatDate(activeExperiment.baselineStart)}–
                    {formatDate(activeExperiment.baselineEnd)}
                  </small>
                </div>
                <div className="improve-arrow">
                  <TrendingDown size={21} />
                  <span>
                    改善 {(metrics.improvementRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="after">
                  <span>改善期</span>
                  <strong>{(metrics.afterRate * 100).toFixed(0)}%</strong>
                  <small>
                    {formatDate(activeExperiment.interventionStart)}–
                    {formatDate(activeExperiment.interventionEnd)}
                  </small>
                </div>
              </div>
              <p className="method-note">
                下降 {(metrics.absolutePointDrop * 100).toFixed(1)} 個百分點 ·
                {mode === "demo-local" ? "模擬資料" : "校園記錄"} ·
                前後比較不等同因果證明
              </p>
            </>
          ) : (
            <p className="method-note">
              目前篩選範圍未達前後期的最低樣本與獨立日期門檻，因此不顯示改善率。
            </p>
          )}
          <Link className="secondary-button" href="/experiments">
            查看改善實驗 <ArrowRight size={15} />
          </Link>
        </article>
        <article className="card recent-card">
          <div className="card-head">
            <div>
              <p className="section-kicker">稽核軌跡</p>
              <h2>近期餐期紀錄</h2>
            </div>
            <Link className="text-link text-green-800!" href="/records">
              全部紀錄 <ArrowRight size={15} />
            </Link>
          </div>
          {recent.length ? (
            <div className="recent-list">
              {recent.map((meal) => (
                <Link href={`/records?meal=${meal.id}`} key={meal.id}>
                  <span>{meal.servedOn.slice(5).replace("-", "/")}</span>
                  <div>
                    <strong>
                      {meal.staple}・{meal.mainDish}
                    </strong>
                    <small>
                      {className(snapshot, meal.classId)} · {kg(meal.leftoverG)}
                    </small>
                  </div>
                  <b>
                    {Math.round((meal.leftoverG / meal.totalSupplyG) * 100)}%
                  </b>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="尚無餐期紀錄"
              description="掃描工作台確認保存第一筆餐期後，會在這裡留下可追溯的紀錄。"
            />
          )}
        </article>
      </section>
    </div>
  );
}
