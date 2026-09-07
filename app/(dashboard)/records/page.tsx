"use client";

import Link from "next/link";
import {
  Fragment,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  Grid2X2,
  List,
  ScanLine,
  Search,
  SlidersHorizontal,
  UserRoundCheck,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import { PlateImage } from "@/components/plate-image";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  Panel,
} from "@/components/ui/page";
import { CATEGORY_LABELS, type PlateScanAnalysisKind } from "@/lib/types";
import { className, getFinalDetection } from "@/lib/analysis";
import { summarizeMealReview } from "@/lib/meal-review";
import {
  includeRequestedMeal,
  recordsUrlWithoutMeal,
  requestedSafetyMeal,
  resolveRecordsDeepLink,
} from "@/lib/records-deeplink";
import { kg } from "@/lib/utils";

function subscribeMobileView(onStoreChange: () => void) {
  const media = window.matchMedia("(max-width: 600px)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getMobileViewSnapshot() {
  return window.matchMedia("(max-width: 600px)").matches;
}

function subscribeLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getRequestedMealSnapshot() {
  return new URLSearchParams(window.location.search).get("meal") ?? undefined;
}

function getSafetyEditorSnapshot() {
  return requestedSafetyMeal(window.location.search);
}

const RECORDS_PER_PAGE = 20;

const SCAN_SOURCE_LABELS: Record<PlateScanAnalysisKind, string> = {
  "mock-ai": "示範規則 · Mock AI",
  "real-ai": "真實 AI",
  "human-manual": "人工判讀 · 無 AI",
  "source-unverified": "來源待確認",
};

function compactAuditToken(value: string) {
  const characters = Array.from(value);
  if (characters.length <= 24) return value;
  return characters.slice(0, 10).join("") + "…" + characters.slice(-8).join("");
}

function isPersistedAiSource(kind: PlateScanAnalysisKind) {
  return kind === "mock-ai" || kind === "real-ai";
}

export default function RecordsPage() {
  const {
    snapshot,
    scopedSnapshot,
    loading,
    setFilters: setGlobalFilters,
  } = useFoodLens();
  const isMobile = useSyncExternalStore(
    subscribeMobileView,
    getMobileViewSnapshot,
    () => false,
  );
  const [selectedView, setSelectedView] = useState<"list" | "cards" | null>(
    null,
  );
  const view = selectedView ?? (isMobile ? "cards" : "list");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [level, setLevel] = useState("all");
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const resultsStartRef = useRef<HTMLDivElement>(null);
  const requestedMeal = useSyncExternalStore(
    subscribeLocation,
    getRequestedMealSnapshot,
    () => undefined,
  );
  const [selectedOpen, setSelectedOpen] = useState<string | null>();
  const open =
    selectedOpen === undefined ? requestedMeal : (selectedOpen ?? undefined);

  const deepLink = useMemo(
    () =>
      resolveRecordsDeepLink(
        snapshot?.meals ?? [],
        scopedSnapshot?.meals ?? [],
        requestedMeal,
      ),
    [requestedMeal, scopedSnapshot, snapshot],
  );

  const meals = useMemo(() => {
    if (!scopedSnapshot) return [];
    const filtered = scopedSnapshot.meals.filter((meal) => {
      const rate = meal.totalSupplyG ? meal.leftoverG / meal.totalSupplyG : 0;
      const matchesLevel =
        level === "all" ||
        (level === "low" && rate < 0.15) ||
        (level === "medium" && rate >= 0.15 && rate < 0.25) ||
        (level === "high" && rate >= 0.25);
      return (
        (classFilter === "all" || meal.classId === classFilter) &&
        (!dateFilter || meal.servedOn === dateFilter) &&
        matchesLevel &&
        `${meal.staple}${meal.mainDish}${meal.sideDishes.join("")}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    });
    return includeRequestedMeal(filtered, deepLink.meal).sort((a, b) =>
      b.servedOn.localeCompare(a.servedOn),
    );
  }, [scopedSnapshot, query, classFilter, dateFilter, level, deepLink.meal]);
  const pageCount = Math.max(1, Math.ceil(meals.length / RECORDS_PER_PAGE));
  const requestedMealIndex = requestedMeal
    ? meals.findIndex((meal) => meal.id === requestedMeal)
    : -1;
  const requestedPage =
    requestedMealIndex >= 0
      ? Math.floor(requestedMealIndex / RECORDS_PER_PAGE) + 1
      : 1;
  const page = Math.min(pageCount, selectedPage ?? requestedPage);
  const visibleMeals = useMemo(
    () => meals.slice((page - 1) * RECORDS_PER_PAGE, page * RECORDS_PER_PAGE),
    [meals, page],
  );
  const visibleStart = meals.length ? (page - 1) * RECORDS_PER_PAGE + 1 : 0;
  const visibleEnd = Math.min(page * RECORDS_PER_PAGE, meals.length);

  const goToPage = (nextPage: number) => {
    setSelectedPage(Math.min(pageCount, Math.max(1, nextPage)));
    window.requestAnimationFrame(() => {
      resultsStartRef.current?.focus({ preventScroll: true });
      resultsStartRef.current?.scrollIntoView({ block: "start" });
    });
  };
  const beginLocalFilterChange = () => {
    setSelectedPage(1);
    if (!requestedMeal) return;
    window.history.replaceState(
      window.history.state,
      "",
      recordsUrlWithoutMeal(window.location.href),
    );
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
    setSelectedOpen(null);
  };
  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="觀察｜每日紀錄"
        title="一筆餐期，連結多份餐盤證據"
        description="班級供餐總量與餐盤影像樣本分成兩層，避免把單張照片誤當作整班實秤結果。"
        icon={CalendarDays}
        actions={
          <div className="segmented">
            <button
              className={view === "list" ? "active" : ""}
              onClick={() => setSelectedView("list")}
              aria-label="列表模式"
              aria-pressed={view === "list"}
            >
              <List size={17} />
              列表
            </button>
            <button
              className={view === "cards" ? "active" : ""}
              onClick={() => setSelectedView("cards")}
              aria-label="卡片模式"
              aria-pressed={view === "cards"}
            >
              <Grid2X2 size={17} />
              卡片
            </button>
          </div>
        }
      />
      <Panel className="filter-bar">
        <label className="search-field">
          <span className="search-field-label">搜尋餐期菜色</span>
          <span className="search-field-control">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="搜尋餐期菜色"
              value={query}
              onChange={(event) => {
                beginLocalFilterChange();
                setQuery(event.target.value);
              }}
              placeholder="搜尋主食、主菜或配菜"
            />
          </span>
        </label>
        <label>
          <span className="sr-only">班級</span>
          <select
            value={classFilter}
            onChange={(event) => {
              beginLocalFilterChange();
              setClassFilter(event.target.value);
            }}
          >
            <option value="all">全部班級</option>
            {scopedSnapshot.classes.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">日期</span>
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => {
              beginLocalFilterChange();
              setDateFilter(event.target.value);
            }}
          />
        </label>
        <label>
          <span className="sr-only">剩食程度</span>
          <select
            value={level}
            onChange={(event) => {
              beginLocalFilterChange();
              setLevel(event.target.value);
            }}
          >
            <option value="all">全部剩食程度</option>
            <option value="low">低於 15%</option>
            <option value="medium">15%–25%</option>
            <option value="high">25% 以上</option>
          </select>
        </label>
        <span
          className="filter-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <SlidersHorizontal size={15} />
          {meals.length} 筆結果
        </span>
      </Panel>
      {deepLink.excludedByGlobalFilters && deepLink.meal && (
        <div className="decision-warning" role="status" aria-live="polite">
          <div>
            <strong>此餐期不在目前篩選</strong>
            <p>
              已暫時顯示 {deepLink.meal.servedOn} ·{" "}
              {className(snapshot, deepLink.meal.classId)} 的餐期與完整證據；
              其他紀錄仍依全站班級／日期範圍篩選。
            </p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() =>
              setGlobalFilters({
                classId: "all",
                range: "all",
              })
            }
          >
            重設全站篩選
          </button>
        </div>
      )}
      {requestedMeal && deepLink.missing && (
        <div className="analysis-warning" role="alert">
          <span>
            找不到指定餐期；它可能已被刪除，或此登入帳號沒有讀取權限。
          </span>
          <Link className="secondary-action" href="/records">
            查看目前紀錄
          </Link>
        </div>
      )}
      <div
        className="records-results-start"
        ref={resultsStartRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
      >
        {meals.length > RECORDS_PER_PAGE
          ? `顯示第 ${visibleStart}–${visibleEnd} 筆，共 ${meals.length} 筆`
          : `${meals.length} 筆餐期紀錄`}
      </div>
      {meals.length === 0 ? (
        <EmptyState
          title="找不到符合條件的餐期"
          description="試著放寬日期、班級或剩食程度篩選。"
        />
      ) : view === "cards" ? (
        <div className="record-card-grid">
          {visibleMeals.map((meal, index) => {
            const scan = scopedSnapshot.scans.find(
              (item) => item.mealRecordId === meal.id,
            );
            const rate = meal.leftoverG / meal.totalSupplyG;
            const expanded = open === meal.id;
            const evidenceId = `meal-card-evidence-${meal.id}`;
            return (
              <article className="record-card" key={meal.id}>
                <PlateImage
                  blob={scan?.imageBlob}
                  url={scan?.imageUrl}
                  alt={`${meal.mainDish}餐盤樣本`}
                  loading={index === 0 ? "eager" : "lazy"}
                />
                <div className="record-card-body">
                  <div>
                    <span className="data-chip">
                      {meal.source === "demo"
                        ? "模擬餐期"
                        : meal.source === "import"
                          ? "CSV 匯入"
                          : "學生新增"}
                    </span>
                    <span>{meal.servedOn} · 午餐</span>
                  </div>
                  <h2>
                    {meal.staple}・{meal.mainDish}
                  </h2>
                  <p>
                    {className(snapshot, meal.classId)} ·{" "}
                    {meal.sideDishes.join("、")}
                  </p>
                  <p title={meal.notes}>備註：{meal.notes || "無"}</p>
                  <dl>
                    <div>
                      <dt>供應</dt>
                      <dd>{kg(meal.totalSupplyG)}</dd>
                    </div>
                    <div>
                      <dt>剩食</dt>
                      <dd>{kg(meal.leftoverG)}</dd>
                    </div>
                    <div>
                      <dt>比例</dt>
                      <dd>{(rate * 100).toFixed(1)}%</dd>
                    </div>
                  </dl>
                  <button
                    onClick={() => setSelectedOpen(expanded ? null : meal.id)}
                    aria-expanded={expanded}
                    aria-controls={evidenceId}
                  >
                    查看餐期與判讀證據
                    <ChevronDown size={16} />
                  </button>
                  {expanded && (
                    <MealEvidence mealId={meal.id} id={evidenceId} />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel className="records-panel">
          <table className="records-table">
            <caption className="sr-only">
              每日餐期紀錄，共 {meals.length} 筆篩選結果
            </caption>
            <thead>
              <tr className="records-row head">
                <th scope="col">日期／班級</th>
                <th scope="col">菜單</th>
                <th scope="col">供應重量</th>
                <th scope="col">剩食重量</th>
                <th scope="col">剩食率</th>
                <th scope="col">餐盤</th>
                <th scope="col">證據</th>
              </tr>
            </thead>
            <tbody>
              {visibleMeals.map((meal) => {
                const count = snapshot.scans.filter(
                  (scan) => scan.mealRecordId === meal.id,
                ).length;
                const expanded = open === meal.id;
                const evidenceId = `meal-evidence-${meal.id}`;
                return (
                  <Fragment key={meal.id}>
                    <tr className="records-row">
                      <th scope="row">
                        <strong>{meal.servedOn}</strong>
                        <small>{className(snapshot, meal.classId)}</small>
                      </th>
                      <td>
                        <strong>
                          {meal.staple}・{meal.mainDish}
                        </strong>
                        <small>{meal.sideDishes.join("、")}</small>
                      </td>
                      <td>{kg(meal.totalSupplyG)}</td>
                      <td>{kg(meal.leftoverG)}</td>
                      <td>
                        <b
                          className={
                            meal.leftoverG / meal.totalSupplyG >= 0.25
                              ? "rate-high"
                              : "rate-ok"
                          }
                        >
                          {((meal.leftoverG / meal.totalSupplyG) * 100).toFixed(
                            1,
                          )}
                          %
                        </b>
                      </td>
                      <td>{count} 份</td>
                      <td>
                        <button
                          className="record-expand-button"
                          type="button"
                          onClick={() =>
                            setSelectedOpen(expanded ? null : meal.id)
                          }
                          aria-expanded={expanded}
                          aria-controls={evidenceId}
                          aria-label={`${expanded ? "收合" : "展開"}${meal.servedOn} ${meal.mainDish}的影像判讀與人工證據`}
                        >
                          <ChevronDown
                            className={expanded ? "rotate" : ""}
                            size={17}
                            aria-hidden="true"
                          />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="record-evidence-row">
                        <td colSpan={7} id={evidenceId}>
                          <MealEvidence mealId={meal.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
      {meals.length > RECORDS_PER_PAGE && (
        <nav className="records-pagination" aria-label="餐期紀錄分頁">
          <button
            className="secondary-action"
            type="button"
            disabled={page === 1}
            onClick={() => goToPage(page - 1)}
          >
            上一頁
          </button>
          <span aria-current="page">
            第 {page} / {pageCount} 頁 · {visibleStart}–{visibleEnd} 筆
          </span>
          <button
            className="secondary-action"
            type="button"
            disabled={page === pageCount}
            onClick={() => goToPage(page + 1)}
          >
            下一頁
          </button>
        </nav>
      )}
    </div>
  );
}

function MealEvidence({ mealId, id }: { mealId: string; id?: string }) {
  const { snapshot, mode, repository, refresh } = useFoodLens();
  const requestedSafety = useSyncExternalStore(
    subscribeLocation,
    getSafetyEditorSnapshot,
    () => undefined,
  );
  if (!snapshot) return null;
  const meal = snapshot.meals.find((item) => item.id === mealId);
  const scans = snapshot.scans.filter((item) => item.mealRecordId === mealId);
  const reviewSummary = summarizeMealReview(snapshot, mealId).label;
  return (
    <div className="evidence-panel" id={id}>
      <div className="evidence-summary">
        <div>
          <strong>餐期層</strong>
          <p>
            午餐 · {meal?.actualPeople} 人 ·{" "}
            {meal?.measurementMethod === "scale"
              ? "班級剩食以秤重記錄"
              : meal?.measurementMethod === "manual"
                ? "班級剩食以人工量測登錄"
                : meal?.measurementMethod === "sample-extrapolation"
                  ? "五源秤重＋餐盤抽樣外推（明確標示估算）"
                  : "舊版影像估計紀錄（不納入新掃描量測）"}
          </p>
          <p>備註：{meal?.notes || "無"}</p>
        </div>
        <div className="evidence-actions">
          <span>
            <UserRoundCheck size={16} />
            {reviewSummary}
          </span>
          <Link
            className="evidence-add-link"
            href={`/scan?meal=${encodeURIComponent(mealId)}`}
          >
            <ScanLine size={16} aria-hidden="true" />
            為此餐期新增餐盤
          </Link>
        </div>
      </div>

      {scans.length === 0 ? (
        <EmptyState
          title="這筆餐期尚無餐盤照片"
          description="餐期的供應重量與剩食秤重已保存；可到掃描頁新增餐盤觀察。"
        />
      ) : (
        <div className="scan-evidence-grid">
          {scans.map((scan) => {
            const rows = snapshot.detections
              .filter((item) => item.scanId === scan.id)
              .map((item) => getFinalDetection(snapshot, item.id))
              .filter(Boolean);
            return (
              <article key={scan.id}>
                <PlateImage
                  blob={scan.imageBlob}
                  url={scan.imageUrl}
                  alt="餐盤掃描樣本"
                />
                <div>
                  <span className="data-chip">
                    {SCAN_SOURCE_LABELS[scan.analysisKind]}
                  </span>
                  <small>{scan.reviewedAt.slice(0, 10)} 已確認</small>
                  {scan.menuContext ? (
                    <small
                      title={
                        "菜單版本：" +
                        scan.menuContext.menuVersionId +
                        "\n菜單簽章：" +
                        scan.menuContext.menuVersionSignature
                      }
                    >
                      菜單候選脈絡：流程宣告 {scan.menuContext.candidateCount}{" "}
                      道 · 版本{" "}
                      {compactAuditToken(scan.menuContext.menuVersionId)} · 簽章{" "}
                      {compactAuditToken(scan.menuContext.menuVersionSignature)}
                      。雲端僅核對已確認菜單連結、簽章與筆數；不證明模型收到或採納內容。
                    </small>
                  ) : isPersistedAiSource(scan.analysisKind) ? (
                    <small>
                      菜單候選脈絡：未保存或未提供；舊版紀錄不回推。
                    </small>
                  ) : scan.analysisKind === "human-manual" ? (
                    <small>菜單候選脈絡：人工判讀不適用。</small>
                  ) : (
                    <small>菜單候選脈絡：來源待確認，不能回推。</small>
                  )}
                  {scan.imageLoadError && <small>{scan.imageLoadError}</small>}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>
                        {scan.analysisKind === "human-manual"
                          ? "起始值"
                          : isPersistedAiSource(scan.analysisKind)
                            ? "AI 原始"
                            : "原始值"}
                      </th>
                      <th>人工最終</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(
                      (row) =>
                        row && (
                          <tr key={row.id}>
                            <td>{CATEGORY_LABELS[row.finalCategory]}</td>
                            <td>
                              {Math.round(row.aiRemainingRatio * 100)}% ·{" "}
                              {row.aiRemainingG}g
                              {isPersistedAiSource(scan.analysisKind) && (
                                <> · 信心 {Math.round(row.confidence * 100)}%</>
                              )}
                            </td>
                            <td>
                              {Math.round(row.finalRemainingRatio * 100)}% ·{" "}
                              {row.finalRemainingG}g{" "}
                              {row.wasCorrected && <em>已修正</em>}
                            </td>
                          </tr>
                        ),
                    )}
                  </tbody>
                </table>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
