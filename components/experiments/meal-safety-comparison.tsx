"use client";

import Link from "next/link";
import { Panel, PanelTitle } from "@/components/ui/page";
import {
  compareMealSafetyForExperiment,
  type MealSafetyComparison,
} from "@/lib/meal-safety";
import type { AppSnapshot, DataMode, ImprovementExperiment } from "@/lib/types";
import styles from "./meal-safety-comparison.module.css";

type Period = MealSafetyComparison["before"];
function decimal(value: number | null, digits = 1) {
  return value === null ? "無法計算" : value.toFixed(digits);
}
function ratio(value: number | null) {
  return value === null ? "分母未明" : `${(value * 100).toFixed(1)}%`;
}
function difference(value: number | null) {
  return value === null
    ? "無法比較"
    : `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function ScrollHint() {
  return (
    <p className={styles.scrollHint}>
      <span aria-hidden="true">↔</span>
      窄螢幕可左右滑動查看整張表；鍵盤聚焦表格區域後，使用左右方向鍵。
    </p>
  );
}

function EventCell({
  period,
  metric,
}: {
  period: Period;
  metric: "shortage" | "refill";
}) {
  const value = period[metric];
  return (
    <>
      <strong>{decimal(value.per100DinerMeals)}／百用餐人次</strong>
      <p>
        {value.eventCount === null
          ? "尚無已觀察事件資料"
          : `${value.eventCount} 事件人次 ÷ ${value.observedDinerMeals} 觀察用餐人次`}
      </p>
      <p>
        已觀察 {value.observedMeals}／{period.eligibleMeals} 餐期・
        {value.observedDates} 個獨立日
      </p>
      <p>
        餐期涵蓋 {ratio(value.mealCoverage)}；用餐涵蓋{" "}
        {ratio(value.dinerCoverage)}
      </p>
      <small>
        明示未觀察 {value.uncollectedMeals} 餐；缺少紀錄 {period.missingMeals}{" "}
        餐；排除 {period.excludedMeals} 餐
      </small>
    </>
  );
}

function SatisfactionCell({ period }: { period: Period }) {
  const value = period.satisfaction;
  return (
    <>
      <strong>
        {value.mean === null
          ? "尚無有效回覆均分"
          : `${value.mean.toFixed(2)}／5 分`}
      </strong>
      <p>
        {value.collectedMeals === 0 ? (
          "尚未收集滿意度；沒有有效回覆分母"
        ) : (
          <>
            {value.responseCount} 份回覆 ÷ {value.invitedDinerMeals}{" "}
            邀請用餐人次；回覆率 {ratio(value.responseRate)}
          </>
        )}
      </p>
      <p>
        已收集 {value.collectedMeals}／{period.eligibleMeals} 餐期・
        {value.collectedDates} 個獨立日
      </p>
      <p>
        其中有有效回覆 {value.respondingMeals} 餐期・{value.respondingDates}{" "}
        個獨立日
      </p>
      <p>
        餐期涵蓋 {ratio(value.mealCoverage)}；邀請涵蓋{" "}
        {ratio(value.dinerCoverage)}
      </p>
      <small>
        已收集零回覆 {value.zeroResponseMeals} 餐；明示未收集{" "}
        {value.uncollectedMeals} 餐；缺少紀錄 {period.missingMeals} 餐；排除{" "}
        {period.excludedMeals} 餐
      </small>
    </>
  );
}

export function MealSafetyComparisonPanel({
  snapshot,
  experiment,
  mode,
}: {
  snapshot: Pick<AppSnapshot, "classes" | "meals" | "mealSafetyObservations">;
  experiment: ImprovementExperiment;
  mode: DataMode;
}) {
  const result = compareMealSafetyForExperiment(snapshot, experiment, mode);
  const classNames = new Map(
    snapshot.classes.map((item) => [item.id, item.name]),
  );
  const periods = [
    { name: "基準期", data: result.before },
    { name: "改善期", data: result.after },
  ];
  const fewerDays = periods.some(
    ({ data }) =>
      data.shortage.observedMeals < 3 ||
      data.shortage.observedDates < 2 ||
      data.refill.observedMeals < 3 ||
      data.refill.observedDates < 2 ||
      data.satisfaction.respondingMeals < 3 ||
      data.satisfaction.respondingDates < 2,
  );
  return (
    <Panel className={`meal-safety-comparison ${styles.panel}`}>
      <PanelTitle
        kicker="逐餐安全觀察｜來源可追溯"
        title="剩食少了，也要看吃得夠不夠"
        note="只計入最新且與餐期一致的觀察。未收集、明確零值及排除資料分開；舊版實驗摘要不參與計算。"
      />
      <p className={styles.scope}>
        依本實驗的班級與期別計算，不受頂部篩選影響：基準期{" "}
        {experiment.baselineStart}–{experiment.baselineEnd}；改善期{" "}
        {experiment.interventionStart}–{experiment.interventionEnd}。
      </p>
      <p className={styles.provenance}>
        {mode === "demo-local"
          ? "以下為本機示範資料，不代表本校供餐結果。"
          : "以下為人工填報紀錄；來源索引不等於外部已核驗。"}{" "}
        重複事件按人次計，同一學生跨餐也會重複計入用餐人次，不能解讀為不同學生人數。
      </p>
      {result.issues.length > 0 && (
        <div className={`caution-card ${styles.warning}`} role="note">
          <div>
            <strong>有觀察不適合直接比較</strong>
            <ul>
              {result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {fewerDays && (
        <p className={styles.sampleNote} role="note">
          護欄樣本仍需累積：至少一項指標尚未在兩期各涵蓋 3 筆餐期與 2
          個獨立日；滿意度只以有有效回覆的餐期計入此門檻。下面保留描述性數值；此提示是產品顯示門檻，不是研究有效性或安全認證。
        </p>
      )}
      <ScrollHint />
      <div
        className={`table-wrap ${styles.scrollRegion}`}
        role="region"
        aria-label="前後逐餐安全護欄比較表，可水平捲動"
        tabIndex={0}
      >
        <table className={`${styles.table} ${styles.comparisonTable}`}>
          <caption className="sr-only">
            逐餐安全指標、前後分母、涵蓋率與差異
          </caption>
          <thead>
            <tr>
              <th scope="col">指標</th>
              <th scope="col">基準期</th>
              <th scope="col">改善期</th>
              <th scope="col">改善期減基準期</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">供應不足事件（缺餐回報）</th>
              <td>
                <EventCell period={result.before} metric="shortage" />
              </td>
              <td>
                <EventCell period={result.after} metric="shortage" />
              </td>
              <td>
                {difference(result.differences.shortagePer100)}
                <br />
                事件人次／百用餐人次
              </td>
            </tr>
            <tr>
              <th scope="row">添餐／補菜</th>
              <td>
                <EventCell period={result.before} metric="refill" />
              </td>
              <td>
                <EventCell period={result.after} metric="refill" />
              </td>
              <td>
                {difference(result.differences.refillPer100)}
                <br />
                事件人次／百用餐人次
              </td>
            </tr>
            <tr>
              <th scope="row">滿意度</th>
              <td>
                <SatisfactionCell period={result.before} />
              </td>
              <td>
                <SatisfactionCell period={result.after} />
              </td>
              <td>
                {difference(result.differences.satisfaction)} 分<br />
                由逐份票數加權
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={styles.method}>
        供應不足指需要用餐或添餐、卻沒有足夠餐點可供應的事件，不等於主觀飢餓感。缺餐與添餐＝總事件人次÷該項已觀察用餐人次×100，可能超過
        100，並非學生百分比。添餐增加也可能表示補餐機制有被使用，不能單獨判定好壞。滿意度＝Σ（分數×票數）÷總票數，未直接平均各餐均分。
      </p>
      <ScrollHint />
      <div
        className={`table-wrap ${styles.scrollRegion}`}
        role="region"
        aria-label="前後滿意度五格分布，可水平捲動"
        tabIndex={0}
      >
        <table className={`${styles.table} ${styles.distributionTable}`}>
          <caption className={styles.caption}>
            同樣平均，可能有不同意見分布
          </caption>
          <thead>
            <tr>
              <th scope="col">分數</th>
              <th scope="col">基準期票數／占有效回覆</th>
              <th scope="col">改善期票數／占有效回覆</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((score) => (
              <tr key={score}>
                <th scope="row">{score} 分</th>
                {periods.map(({ name, data }) => (
                  <td key={name}>
                    {data.satisfaction.collectedMeals === 0 ? (
                      "未收集／無有效分母"
                    ) : (
                      <>
                        {data.satisfaction.ratings[score - 1]} 票（
                        {data.satisfaction.responseCount > 0
                          ? ratio(
                              data.satisfaction.ratings[score - 1] /
                                data.satisfaction.responseCount,
                            )
                          : "無有效回覆"}
                        ）
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className={styles.details}>
        <summary>查看菜單組成與可能混雜</summary>
        <p>
          {result.menuComparisonIncomplete
            ? "菜單或用餐人次資料不足／有歧義，尚不能判定兩期組成是否可比較。"
            : result.menuMixDiffers
              ? "兩期菜單名稱組合或用餐人次占比不同，不能把差異單獨歸因於介入。"
              : "兩期可用菜單名稱組合與人次占比未見差異，仍不能證明配方、配送或其他條件相同。"}
          共同組合 {result.sharedMenuSignatures.length}{" "}
          種；此處只比較已保存的菜單名稱簽章，不代表同食譜控制研究。
        </p>
        <ScrollHint />
        <div
          className={`table-wrap ${styles.scrollRegion}`}
          role="region"
          aria-label="每期菜單組成表，可水平捲動"
          tabIndex={0}
        >
          <table className={`${styles.table} ${styles.menuTable}`}>
            <caption className={styles.caption}>
              每期菜單名稱組合與用餐人次
            </caption>
            <thead>
              <tr>
                <th scope="col">期別</th>
                <th scope="col">菜單名稱組合</th>
                <th scope="col">餐期</th>
                <th scope="col">用餐人次／占比</th>
              </tr>
            </thead>
            <tbody>
              {periods.flatMap(({ name, data }) =>
                data.menuComposition.map((menu) => (
                  <tr key={`${name}-${menu.signature}`}>
                    <th scope="row">{name}</th>
                    <td className="break-all">{menu.signature}</td>
                    <td>{menu.mealCount}</td>
                    <td>
                      {menu.dinerMeals}／
                      {ratio(
                        data.eligibleDinerMeals
                          ? menu.dinerMeals / data.eligibleDinerMeals
                          : null,
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
      <details className={styles.details}>
        <summary>查看納入計算的逐餐來源與修訂</summary>
        <p>
          觀察紀錄{" "}
          {result.before.observations.length + result.after.observations.length}{" "}
          筆；新修訂不覆寫歷史。各指標是否納入仍依該指標的收集狀態判斷。
        </p>
        <ScrollHint />
        <div
          className={`table-wrap ${styles.scrollRegion}`}
          role="region"
          aria-label="逐餐來源與修訂表，可水平捲動"
          tabIndex={0}
        >
          <table className={`${styles.table} ${styles.sourceTable}`}>
            <caption className={styles.caption}>目前有效逐餐觀察</caption>
            <thead>
              <tr>
                <th scope="col">期別／餐期</th>
                <th scope="col">來源與索引</th>
                <th scope="col">修訂與記錄時間</th>
              </tr>
            </thead>
            <tbody>
              {periods.flatMap(({ name, data }) =>
                data.observations.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      {name}・{row.mealSnapshot.servedOn}
                      <br />
                      <span title={row.mealSnapshot.classId}>
                        {classNames.get(row.mealSnapshot.classId) ?? "未知班級"}
                      </span>
                    </th>
                    <td>
                      {row.sourceTitle || "尚未蒐集"}
                      <br />
                      {row.sourceReference || "沒有已觀察數值"}
                      <br />
                      {row.provenance === "demo" ? "示範" : "校園填報"}
                    </td>
                    <td>
                      第 {row.revision} 版<br />
                      {new Date(row.recordedAt).toLocaleString("zh-TW", {
                        timeZone: "Asia/Taipei",
                      })}
                      {row.revisionReason && <p>{row.revisionReason}</p>}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.closingNote}>
        剩食下降、零回報或高滿意度都不能替代營養專業與校方判斷；尚未量測時也不會顯示成「已安全」。
      </p>
      <Link className={`secondary-action ${styles.action}`} href="/records">
        前往每日紀錄補記逐餐安全觀察
      </Link>
    </Panel>
  );
}
