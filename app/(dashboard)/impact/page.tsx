"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Calculator,
  Check,
  CircleDollarSign,
  Copy,
  EyeOff,
  Info,
  Leaf,
  Recycle,
  Scale,
  School,
  Sprout,
  Truck,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import {
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import { dashboardMetrics, snapshotDateRange } from "@/lib/analysis";
import { calculateImpact, impactBarWidth } from "@/lib/impact";
import { kg, twd } from "@/lib/utils";
import { todayInTaipei } from "@/lib/date";

const levels = [5, 10, 20, 30] as const;

export default function ImpactPage() {
  const { snapshot, scopedSnapshot, loading, mode } = useFoodLens();
  const [levelIndex, setLevelIndex] = useState(1);
  const [summaryCopyStatus, setSummaryCopyStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  const metrics = dashboardMetrics(
    scopedSnapshot,
    mode === "school-cloud" ? todayInTaipei() : undefined,
  );
  const settings = snapshot.impactSettings;
  const publicRange = snapshotDateRange(scopedSnapshot);
  const impact = calculateImpact(settings, levels[levelIndex]);
  const verifiedReceipts = scopedSnapshot.destinationReceipts.filter(
    (receipt) => receipt.status === "verified",
  );
  const verifiedDestinationWeightG = verifiedReceipts.reduce(
    (sum, receipt) => sum + (receipt.acceptedWeightG ?? 0),
    0,
  );
  const pendingDestinationReceipts = scopedSnapshot.destinationReceipts.filter(
    (receipt) => receipt.status === "submitted",
  ).length;
  const cumulative = [
    {
      label: "累積分析餐盤",
      value: metrics.analyzedPlates.toLocaleString(),
      unit: "份",
      icon: Scale,
      note:
        mode === "demo-local"
          ? "模擬餐盤均具人工校正欄位"
          : "經學生逐項確認後保存",
    },
    {
      label: "累積剩食重量",
      value: (
        scopedSnapshot.meals.reduce((sum, meal) => sum + meal.leftoverG, 0) /
        1000
      ).toFixed(1),
      unit: "kg",
      icon: Recycle,
      note: `${scopedSnapshot.meals.length} 筆${mode === "demo-local" ? "模擬" : "校園"}餐期`,
    },
    {
      label: "改善後可能少產生",
      value: (metrics.estimatedAvoidedWasteG / 1000).toFixed(1),
      unit: "kg",
      icon: Sprout,
      note: "依前後期差額估算",
    },
    {
      label: "估計節省成本",
      value: twd(metrics.estimatedSavedCostTwd),
      unit: "元",
      icon: CircleDollarSign,
      note:
        mode === "demo-local"
          ? `NT$${settings.costTwdPerKg}/kg 示範值`
          : `依 NT$${settings.costTwdPerKg}/kg 可修改估算係數`,
    },
  ];
  const publicSummary = [
    "FoodLens 校園午餐研究｜家長與社群公開摘要",
    "資料性質：" +
      (mode === "demo-local"
        ? "目前篩選範圍的模擬情境，非本校實測"
        : "目前篩選範圍的本校去識別化彙整"),
    "範圍：" +
      (publicRange.start ?? "尚無資料") +
      "–" +
      (publicRange.end ?? "尚無資料") +
      "，" +
      publicRange.independentDateCount +
      " 個供餐日／" +
      scopedSnapshot.meals.length +
      " 筆班級餐期",
    "累積剩食：" +
      (
        scopedSnapshot.meals.reduce((sum, meal) => sum + meal.leftoverG, 0) /
        1000
      ).toFixed(1) +
      " kg",
    "改善後可能少產生：" +
      (metrics.estimatedAvoidedWasteG / 1000).toFixed(1) +
      " kg（依前後期差額估算，不等同因果）",
    "最終去向證據：" +
      verifiedReceipts.length +
      (mode === "demo-local" ? " 張模擬收據已核驗" : " 張處理場收據已核驗") +
      "；預定去向不列為成果",
    "隱私：不公開餐盤照片、班級排名、姓名、學號、座號或個別飲食紀錄。",
  ].join("\n");
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="擴散｜永續影響"
        title="先說清楚假設，再談全校可以少浪費多少"
        description="主指標只採可理解的廚餘重量；沒有可追溯係數前，不展示虛構碳排。"
        icon={Leaf}
      />
      <section className="impact-kpis">
        {cumulative.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.label}>
              <Icon size={20} />
              <span>{item.label}</span>
              <div>
                <strong>{item.value}</strong>
                <b>{item.unit}</b>
              </div>
              <small>{item.note}</small>
            </article>
          );
        })}
      </section>
      <Panel className="mb-[18px] border-[#bdd8c4] bg-[#f1f7f1]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Truck
              className="mt-0.5 shrink-0 text-[var(--green)]"
              size={22}
              aria-hidden="true"
            />
            <div>
              <p className="section-kicker">清運之後的證據</p>
              <h2 className="m-0 font-serif text-xl text-[var(--ink)]">
                {verifiedReceipts.length} 張
                {mode === "demo-local" ? "模擬收據" : "收據"}已核驗・
                {(verifiedDestinationWeightG / 1000).toFixed(2)} kg
              </h2>
              <p className="mt-1.5 mb-0 max-w-3xl text-xs leading-6 text-[#49685c]">
                目前篩選範圍另有 {pendingDestinationReceipts}{" "}
                張收據待核驗。只有已核驗收據才列入實際處理場收料；本頁不把預定去向或清運重量當成環境成果。
              </p>
            </div>
          </div>
          <Link className="secondary-button shrink-0" href="/trace">
            查看去向證據 <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </Panel>
      <Panel className="simulator-panel">
        <div className="simulator-heading">
          <div>
            <p className="section-kicker">全校情境試算</p>
            <h2>
              如果全校都改善 <em>{levels[levelIndex]}%</em>
            </h2>
            <span>拖曳滑桿，觀察同一組假設如何影響一週、一學期與一學年。</span>
          </div>
          <span className="simulation-stamp">
            情境估算
            <br />
            不是承諾
          </span>
        </div>
        <div className="range-wrap">
          <input
            aria-label="全校改善比例"
            aria-valuetext={`${levels[levelIndex]}%`}
            type="range"
            min="0"
            max="3"
            step="1"
            value={levelIndex}
            onChange={(event) => setLevelIndex(Number(event.target.value))}
          />
          <div>
            {levels.map((level, index) => (
              <button
                type="button"
                className={index === levelIndex ? "active" : ""}
                onClick={() => setLevelIndex(index)}
                aria-pressed={index === levelIndex}
                key={level}
              >
                {level}%
              </button>
            ))}
          </div>
        </div>
        {settings.schoolDailyBaselineG === 0 && (
          <p className="estimate-note" role="status">
            <Info size={17} />
            全校每日剩食基準尚未填寫，因此目前試算皆顯示
            0；請由教師管理頁填入實際量測基準後再比較。
          </p>
        )}
        <div className="impact-horizons">
          {[
            ["一週", impact.week],
            ["一學期", impact.semester],
            ["一學年", impact.year],
          ].map(([label, value], index) => {
            const data = value as { grams: number; costTwd: number };
            return (
              <article
                className={index === 2 ? "featured" : ""}
                key={label as string}
              >
                <span>{label as string}</span>
                <strong>{kg(data.grams, 0)}</strong>
                <small>可能少產生的廚餘</small>
                <div>估計節省 NT$ {twd(data.costTwd)}</div>
                <i
                  aria-hidden="true"
                  style={{
                    width: `${impactBarWidth(data.grams, impact.year.grams)}%`,
                  }}
                />
              </article>
            );
          })}
        </div>
      </Panel>
      <div className="impact-grid">
        <Panel>
          <PanelTitle
            kicker="公開假設"
            title="這些係數都能由教師修改"
            note={`最後更新 ${settings.updatedAt.slice(0, 10).replaceAll("-", "/")}`}
          />
          <dl className="assumption-list">
            <div>
              <dt>全校每日剩食基準</dt>
              <dd>{kg(settings.schoolDailyBaselineG)}</dd>
            </div>
            <div>
              <dt>每週供餐日</dt>
              <dd>{settings.schoolDaysPerWeek} 天</dd>
            </div>
            <div>
              <dt>每學期週數</dt>
              <dd>{settings.weeksPerSemester} 週</dd>
            </div>
            <div>
              <dt>每學年學期</dt>
              <dd>{settings.semestersPerYear} 學期</dd>
            </div>
            <div>
              <dt>成本係數</dt>
              <dd>NT$ {settings.costTwdPerKg}/kg</dd>
            </div>
            <div>
              <dt>碳排換算</dt>
              <dd>未啟用</dd>
            </div>
            <div>
              <dt>全校基準來源</dt>
              <dd>
                {settings.sourceUrl ? (
                  <a href={settings.sourceUrl} target="_blank" rel="noreferrer">
                    {settings.sourceTitle || "查看來源"}
                  </a>
                ) : (
                  settings.sourceTitle || "尚待教師補充外部來源"
                )}
              </dd>
            </div>
            <div>
              <dt>來源日期</dt>
              <dd>{settings.retrievedAt?.slice(0, 10) || "尚未提供"}</dd>
            </div>
          </dl>
          <p className="estimate-note">
            <Info size={17} />
            {settings.disclaimer}
          </p>
        </Panel>
        <Panel className="impact-story">
          <School size={28} />
          <p className="section-kicker">從一個班級到全校</p>
          <h2>擴大，不只是把數字乘大</h2>
          <p>
            不同年級、菜單與份量都有差異。全校使用前，需要先用各年級的班級層級去識別化資料校正基準，並由午餐團隊檢查供餐安全。
          </p>
          <ol>
            <li>
              <span>01</span>一個班級連續量測
            </li>
            <li>
              <span>02</span>跨班級比較差異
            </li>
            <li>
              <span>03</span>營養師共同設定安全界線
            </li>
            <li>
              <span>04</span>小規模介入後再擴大
            </li>
          </ol>
          <div className="human-decision">
            <Calculator size={18} />
            <span>系統整理情境；學校決定是否採用。</span>
          </div>
        </Panel>
      </div>
      <Panel className="mt-[18px] border-[#cfdcd2] bg-[#fbfcf7]">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <p className="section-kicker">家長與社群可公開版</p>
            <h2 className="m-0 font-serif text-2xl text-[var(--ink)]">
              只分享目前研究範圍的彙整、方法限制與下一步
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-[#51695d]">
              這份摘要不含餐盤照片、班級排行或學生個別資訊。家長看到的是研究怎麼做、資料屬性與限制，不是拿班級互相比較。
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            aria-describedby="public-summary-copy-status"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(publicSummary);
                setSummaryCopyStatus("success");
                window.setTimeout(() => setSummaryCopyStatus("idle"), 1_800);
              } catch {
                setSummaryCopyStatus("error");
              }
            }}
          >
            {summaryCopyStatus === "success" ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            {summaryCopyStatus === "success"
              ? "已複製公開摘要"
              : "複製公開摘要"}
          </button>
        </div>
        <p
          id="public-summary-copy-status"
          className={
            summaryCopyStatus === "error"
              ? "mt-3 mb-0 text-sm font-bold text-[#8a3f32]"
              : "sr-only"
          }
          aria-live="polite"
        >
          {summaryCopyStatus === "success"
            ? "公開摘要已複製。"
            : summaryCopyStatus === "error"
              ? "無法存取剪貼簿，請確認瀏覽器權限後再試一次。"
              : ""}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <article className="border border-[#dde6dd] bg-white p-4">
            <span className="text-xs font-bold text-[#526b5f]">研究範圍</span>
            <strong className="mt-1 block text-lg text-[var(--ink)]">
              {publicRange.independentDateCount} 日・
              {scopedSnapshot.meals.length} 餐期
            </strong>
            <small className="mt-1 block text-xs leading-5 text-[#526b5f]">
              {publicRange.start ?? "尚無資料"}–{publicRange.end ?? "尚無資料"}
            </small>
          </article>
          <article className="border border-[#dde6dd] bg-white p-4">
            <span className="text-xs font-bold text-[#526b5f]">方法限制</span>
            <strong className="mt-1 block text-lg text-[var(--ink)]">
              前後差異不等同因果
            </strong>
            <small className="mt-1 block text-xs leading-5 text-[#526b5f]">
              菜單、出席、天氣與活動仍可能影響剩食。
            </small>
          </article>
          <article className="border border-[#dde6dd] bg-white p-4">
            <span className="flex items-center gap-1.5 text-xs font-bold text-[#526b5f]">
              <EyeOff size={14} aria-hidden="true" /> 不公開
            </span>
            <strong className="mt-1 block text-lg text-[var(--ink)]">
              照片・姓名・班級排行
            </strong>
            <small className="mt-1 block text-xs leading-5 text-[#526b5f]">
              僅提供去識別化的全校或研究範圍彙整。
            </small>
          </article>
        </div>
        <p className="estimate-note mt-4">
          <Info size={17} />
          {mode === "demo-local"
            ? "目前全部是模擬情境；複製內容也會保留這項標示，不得當成本校成果。"
            : "公開前仍由校方資料負責人檢查期間、樣本與文字，FoodLens 不會自動發佈。"}
        </p>
      </Panel>
    </div>
  );
}
