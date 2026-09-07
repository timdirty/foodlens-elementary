"use client";

import { Download, Printer } from "lucide-react";
import type { DataMode, MealRecord, SupplyPrediction } from "@/lib/types";
import { kg } from "@/lib/utils";
import styles from "./supply-collaboration-sheet.module.css";

type SupplyBaselineKind = "historical-estimate" | "school-plan";

function baselineCopy(kind: SupplyBaselineKind) {
  return kind === "historical-estimate"
    ? {
        short: "歷史試算基準",
        detail: "依歷史每人供應中位數推估，並非校方已核定的原計畫",
      }
    : {
        short: "校方原計畫",
        detail: "由使用者輸入，仍待列印後由校方／營養師核准",
      };
}

function collaborationText(
  prediction: SupplyPrediction,
  meals: MealRecord[],
  baselineKind: SupplyBaselineKind,
  dataMode: DataMode,
) {
  const baseline = baselineCopy(baselineKind);
  return [
    "FoodLens 供餐協作單｜決策建議，待校方／營養師確認",
    "資料性質：" +
      (dataMode === "demo-local"
        ? "模擬情境，非校方實測"
        : "校園工作區資料；本建議尚未核准"),
    "菜單：" + prediction.menuName,
    "預計人數：" + prediction.plannedPeople + " 人",
    baseline.short + "：" + kg(prediction.plannedSupplyG),
    "基準來源：" + baseline.detail,
    "FoodLens 建議參考量：" + kg(prediction.recommendedSupplyG),
    "歷史加權剩食率：" +
      (prediction.averageLeftoverRate * 100).toFixed(1) +
      "%",
    "證據：" +
      prediction.independentDateCount +
      " 個獨立供餐日／" +
      meals.length +
      " 筆班級餐期",
    "期間：" +
      (prediction.historyStart ?? "未建立") +
      "–" +
      (prediction.historyEnd ?? "未建立"),
    "演算法：" + prediction.algorithmVersion + "；" + prediction.reason,
    "",
    "人類決定（請擇一）：□ 採用建議量　□ 調整後採用　□ 維持原計畫",
    "最後採用量：____________ kg",
    "營養與補餐安全說明：________________________________________",
    "核准角色／簽名：________________　日期：________________",
    "",
    "提醒：本單不會自動下單。供餐公司生產量、送達量及班級實際供應量需分別量測，不可互相代填。",
  ].join("\n");
}

export function SupplyCollaborationSheet({
  prediction,
  evidenceMeals,
  baselineKind,
  dataMode,
}: {
  prediction: SupplyPrediction;
  evidenceMeals: MealRecord[];
  baselineKind: SupplyBaselineKind;
  dataMode: DataMode;
}) {
  const baseline = baselineCopy(baselineKind);
  const exportSheet = () => {
    const blob = new Blob(
      [collaborationText(prediction, evidenceMeals, baselineKind, dataMode)],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "FoodLens-供餐協作單-" +
      prediction.menuName.replace(/[\\/:*?"<>|]/g, "-") +
      ".txt";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const printSheet = () => {
    let focusTimer: number | undefined;
    const cleanup = () => {
      if (focusTimer) window.clearTimeout(focusTimer);
      document.body.classList.remove("foodlens-print-collaboration");
      window.removeEventListener("afterprint", cleanup);
      window.removeEventListener("focus", handleFocus);
    };
    const handleFocus = () => {
      focusTimer = window.setTimeout(cleanup, 250);
    };
    document.body.classList.add("foodlens-print-collaboration");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.addEventListener("focus", handleFocus, { once: true });
    try {
      window.print();
    } catch {
      cleanup();
    }
  };

  return (
    <section
      id="supply-collaboration-sheet"
      className={styles.sheet}
      aria-labelledby="collaboration-sheet-title"
    >
      <header className={styles.head}>
        <div>
          <p>校方 × 營養師 × 供餐公司 × 教室</p>
          <h2 id="collaboration-sheet-title">供餐協作單</h2>
        </div>
        <div className={styles.stamps}>
          <span>
            {dataMode === "demo-local"
              ? "模擬情境・非校方實測"
              : "校園工作區資料"}
          </span>
          <span>待人類核准・不會自動下單</span>
        </div>
      </header>

      <dl className={styles.summary}>
        <div>
          <dt>確認菜單</dt>
          <dd>{prediction.menuName}</dd>
        </div>
        <div>
          <dt>預計用餐</dt>
          <dd>{prediction.plannedPeople} 人</dd>
        </div>
        <div>
          <dt>{baseline.short}</dt>
          <dd>{kg(prediction.plannedSupplyG)}</dd>
        </div>
        <div>
          <dt>建議參考量</dt>
          <dd>{kg(prediction.recommendedSupplyG)}</dd>
        </div>
      </dl>

      <div className={styles.evidence}>
        <strong>
          依 {prediction.independentDateCount} 個獨立供餐日／
          {evidenceMeals.length} 筆班級餐期
        </strong>
        <p>{prediction.reason}</p>
        <small>
          期間 {prediction.historyStart ?? "未建立"}–
          {prediction.historyEnd ?? "未建立"}・歷史加權剩食率{" "}
          {(prediction.averageLeftoverRate * 100).toFixed(1)}%・演算法{" "}
          {prediction.algorithmVersion}
        </small>
        <small>比較基準：{baseline.detail}。</small>
      </div>

      <ul className={styles.roles}>
        <li>
          <strong>午餐秘書／導師</strong>
          確認日期、預計與實到人數；班級端只回報實際供應與剩食量。
        </li>
        <li>
          <strong>營養師／校方</strong>
          檢查營養、份量與補餐安全，決定採用、調整或維持原計畫。
        </li>
        <li>
          <strong>供餐公司</strong>
          另填實際生產量與送達量；未知就留白，不用班級供應重量代填。
        </li>
        <li>
          <strong>學生研究團隊</strong>
          追蹤實際採用量與下一輪秤重，前後比較仍需揭露樣本與限制。
        </li>
      </ul>

      <div className={styles.decision} aria-label="人類核准欄位">
        <strong>人類最後決定（列印後填寫）</strong>
        <span>□ 採用建議　□ 調整後採用　□ 維持原計畫</span>
        <span>最後採用量：________________ kg</span>
        <span>營養與補餐安全說明：</span>
        <span>核准角色／簽名／日期：</span>
      </div>
      <p className={styles.guardrail}>
        本單是協作與稽核用的決策建議，不是採購或生產指令。計畫、生產、送達、班級供應與剩食為不同階段；沒有量到的值保持未知。
      </p>
      <div className={styles.actions}>
        <button type="button" className="ghost-button" onClick={exportSheet}>
          <Download size={16} aria-hidden="true" /> 下載文字協作單
        </button>
        <button type="button" className="secondary-button" onClick={printSheet}>
          <Printer size={16} aria-hidden="true" /> 列印／存成 PDF
        </button>
      </div>
    </section>
  );
}
