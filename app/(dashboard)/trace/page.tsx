"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  Factory,
  FileCheck2,
  GraduationCap,
  Handshake,
  Info,
  PackageCheck,
  School,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { useFoodLens } from "@/components/data-provider";
import { TraceActionPanel } from "@/components/trace/trace-action-panel";
import { TraceCard, traceStage } from "@/components/trace/trace-card";
import { useConfirmationFocus } from "@/components/trace/use-confirmation-focus";
import {
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import {
  TREATMENT_METHODS,
  TREATMENT_METHOD_LABELS,
  TRACE_WASTE_SOURCES,
  TRACE_WASTE_SOURCE_LABELS,
  TRACE_WEIGHT_STATES,
  TRACE_WEIGHT_STATE_LABELS,
  collectionEventSchema,
  receiptForCollection,
  type CollectionEvent,
  type TreatmentMethod,
  type TraceWasteSource,
  type TraceWeightState,
} from "@/lib/circularity";
import { createUuid } from "@/lib/crypto";
import { todayInTaipei } from "@/lib/date";
import type { MealEvidenceCase } from "@/lib/evidence-chain";
import styles from "./trace.module.css";

function menuLabel(evidenceCase: MealEvidenceCase) {
  const dishes = evidenceCase.menuVersion.plannedDishes
    .map((dish) => dish.rawName)
    .slice(0, 3)
    .join("、");
  return `${evidenceCase.servedOn.replaceAll("-", "/")}・${dishes || "已確認菜單"}`;
}

const evidenceSourceToTraceSource = {
  prep: "preparation",
  "unserved-edible": "unserved_edible",
  "plate-edible": "plate_edible",
  inedible: "inedible",
  "liquid-contaminated": "liquid",
} as const;

function sourceWeight(
  evidenceCase: MealEvidenceCase | undefined,
  source: TraceWasteSource,
) {
  return (
    evidenceCase?.measurements
      .filter(
        (measurement) =>
          evidenceSourceToTraceSource[measurement.source] === source,
      )
      .reduce((sum, measurement) => sum + measurement.netG, 0) ?? 0
  );
}

function suggestedCollectionWeight(
  evidenceCase: MealEvidenceCase | undefined,
  sources: readonly TraceWasteSource[],
) {
  return sources.reduce(
    (sum, source) => sum + sourceWeight(evidenceCase, source),
    0,
  );
}

function suggestedSources(method: TreatmentMethod): TraceWasteSource[] {
  if (method === "circular_feed") return ["unserved_edible"];
  if (
    method === "composting" ||
    method === "anaerobic_digestion" ||
    method === "black_soldier_fly"
  )
    return ["preparation", "unserved_edible", "plate_edible"];
  if (method === "incineration" || method === "landfill") return ["inedible"];
  return [];
}

function isoFromTaipeiInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("請填寫完整的預定交接日期與時間");
  const date = new Date(`${value}:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error("交接日期與時間格式無效");
  return date.toISOString();
}

function NewTraceForm({
  evidenceCases,
  existingEvents,
  mode,
  busy,
  onSave,
}: {
  evidenceCases: MealEvidenceCase[];
  existingEvents: CollectionEvent[];
  mode: "demo-local" | "school-cloud";
  busy: boolean;
  onSave: (event: CollectionEvent) => Promise<void>;
}) {
  const firstCase = evidenceCases[0];
  const [evidenceCaseId, setEvidenceCaseId] = useState(firstCase?.id ?? "");
  const selected =
    evidenceCases.find((item) => item.id === evidenceCaseId) ?? firstCase;
  const [scheduledAt, setScheduledAt] = useState(
    firstCase ? `${firstCase.servedOn}T13:10` : "",
  );
  const [destination, setDestination] = useState(
    mode === "demo-local" ? "示範有機資源處理場" : "",
  );
  const initialMethod: TreatmentMethod =
    mode === "demo-local" ? "composting" : "unknown";
  const initiallyReserved = new Set(
    existingEvents
      .filter(
        (event) =>
          event.evidenceCaseId === firstCase?.id &&
          event.status !== "cancelled",
      )
      .flatMap((event) => event.wasteSources),
  );
  const [method, setMethod] = useState<TreatmentMethod>(initialMethod);
  const [wasteSources, setWasteSources] = useState<TraceWasteSource[]>(
    suggestedSources(initialMethod).filter(
      (source) => !initiallyReserved.has(source),
    ),
  );
  const [weightState, setWeightState] =
    useState<TraceWeightState>("standard_drained");
  const [candidate, setCandidate] = useState<CollectionEvent>();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const { setReviewElement, setReturnFocusElement, returnToEditor } =
    useConfirmationFocus(Boolean(candidate));

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (!selected)
    return (
      <div className={styles.emptyTrace}>
        <ClipboardCheck size={28} aria-hidden="true" />
        <h2>先完成一筆餐期證據</h2>
        <p>
          清運事件必須連回已確認菜單與五源量測，不能建立沒有上游依據的孤立紀錄。
        </p>
        <Link className="primary-button" href="/workflow">
          前往午餐任務台 <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    );

  const reservedSources = new Set(
    existingEvents
      .filter(
        (event) =>
          event.evidenceCaseId === selected.id && event.status !== "cancelled",
      )
      .flatMap((event) => event.wasteSources),
  );

  if (candidate)
    return (
      <section
        ref={setReviewElement}
        className={styles.newTraceReview}
        aria-label="建立清運安排前確認"
        tabIndex={-1}
      >
        <div>
          <ShieldCheck size={22} aria-hidden="true" />
          <span>
            <strong>建立前再確認一次</strong>
            <small>
              {mode === "demo-local"
                ? "只寫入此瀏覽器的示範資料"
                : "將寫入本校正式工作區"}
            </small>
          </span>
        </div>
        <dl>
          <div>
            <dt>餐期</dt>
            <dd>{menuLabel(selected)}</dd>
          </div>
          <div>
            <dt>預定地點</dt>
            <dd>{candidate.plannedDestinationName}</dd>
          </div>
          <div>
            <dt>預定方式</dt>
            <dd>{TREATMENT_METHOD_LABELS[candidate.plannedTreatmentMethod]}</dd>
          </div>
          <div>
            <dt>本批來源</dt>
            <dd>
              {candidate.wasteSources
                .map((source) => TRACE_WASTE_SOURCE_LABELS[source])
                .join("＋")}
            </dd>
          </div>
        </dl>
        <p>
          <Info size={16} aria-hidden="true" />
          以上皆為預定資訊。只有後續核驗處理場收據，才會顯示實際去向。
        </p>
        <label className={styles.reviewCheck}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>我確認這是一筆清運安排，不是已完成的實際處理成果。</span>
        </label>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className="ghost-button"
            onClick={() => returnToEditor(() => setCandidate(undefined))}
          >
            返回修改
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!checked || busy}
            onClick={() => onSave(candidate)}
          >
            <Check size={16} aria-hidden="true" />
            {busy ? "正在建立…" : "確認建立安排"}
          </button>
        </div>
      </section>
    );

  return (
    <form
      className={styles.newTraceForm}
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const now = new Date().toISOString();
          setCandidate(
            collectionEventSchema.parse({
              id: createUuid(),
              evidenceCaseId: selected.id,
              status: "scheduled",
              scheduledAt: isoFromTaipeiInput(scheduledAt),
              weightState,
              plannedDestinationName: destination,
              plannedTreatmentMethod: method,
              wasteSources,
              provenance: mode === "demo-local" ? "demo" : "official",
              createdAt: now,
              updatedAt: now,
            }),
          );
          setChecked(false);
          setError(undefined);
        } catch (caught) {
          const issue =
            caught && typeof caught === "object" && "issues" in caught
              ? (caught as { issues?: Array<{ message?: string }> }).issues?.[0]
              : undefined;
          setError(
            issue?.message ??
              (caught instanceof Error ? caught.message : "請檢查表單內容"),
          );
        }
      }}
    >
      <div className={styles.formColumns}>
        <label>
          已完成證據的餐期
          <select
            value={selected.id}
            onChange={(event) => {
              const next = evidenceCases.find(
                (item) => item.id === event.target.value,
              );
              setEvidenceCaseId(event.target.value);
              if (next) {
                setScheduledAt(`${next.servedOn}T13:10`);
                const nextReserved = new Set(
                  existingEvents
                    .filter(
                      (item) =>
                        item.evidenceCaseId === next.id &&
                        item.status !== "cancelled",
                    )
                    .flatMap((item) => item.wasteSources),
                );
                setWasteSources(
                  suggestedSources(method).filter(
                    (source) => !nextReserved.has(source),
                  ),
                );
              }
            }}
          >
            {evidenceCases.map((item) => (
              <option key={item.id} value={item.id}>
                {menuLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          預定交接時間
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            required
          />
        </label>
        <label>
          預定處理場／去向
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="填寫清運安排上的預定地點"
            required
          />
        </label>
        <label>
          預定處理方式
          <select
            value={method}
            onChange={(event) => {
              const nextMethod = event.target.value as TreatmentMethod;
              setMethod(nextMethod);
              setWasteSources(
                suggestedSources(nextMethod).filter(
                  (source) => !reservedSources.has(source),
                ),
              );
            }}
          >
            {TREATMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {TREATMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          交接重量基準
          <select
            value={weightState}
            onChange={(event) =>
              setWeightState(event.target.value as TraceWeightState)
            }
          >
            {TRACE_WEIGHT_STATES.map((value) => (
              <option key={value} value={value}>
                {TRACE_WEIGHT_STATE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className={styles.sourcePicker}>
        <legend>這一批實際包含哪些分流來源？</legend>
        <p>
          不會把五源全部相加。請依這台車／這條處理路線逐源勾選，同餐期可另建不同來源的另一批。
        </p>
        <div>
          {TRACE_WASTE_SOURCES.map((source) => {
            const grams = sourceWeight(selected, source);
            const checked = wasteSources.includes(source);
            const reserved = reservedSources.has(source);
            return (
              <label
                key={source}
                className={reserved ? styles.reservedSource : undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={reserved}
                  onChange={() =>
                    setWasteSources((current) =>
                      current.includes(source)
                        ? current.filter((item) => item !== source)
                        : [...current, source],
                    )
                  }
                />
                <span>
                  <strong>{TRACE_WASTE_SOURCE_LABELS[source]}</strong>
                  <small>
                    {reserved
                      ? "已安排於其他有效批次"
                      : `${(grams / 1000).toFixed(2)} kg 餐期量測`}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
        <output aria-live="polite">
          本批勾選來源合計建議參考：
          <strong>
            {(suggestedCollectionWeight(selected, wasteSources) / 1000).toFixed(
              2,
            )}{" "}
            kg
          </strong>
          <span>交接時仍以現場秤重為準</span>
        </output>
      </fieldset>
      {error && (
        <p
          ref={errorRef}
          className={styles.formError}
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      )}
      <button
        ref={setReturnFocusElement}
        type="submit"
        className="primary-button"
        disabled={busy}
      >
        檢查清運安排 <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}

const responsibilityRoles = [
  {
    icon: GraduationCap,
    role: "學生與教室",
    task: "完成五源分流、餐盤抽樣與匿名原因；不記姓名、學號或座號。",
  },
  {
    icon: School,
    role: "校方午餐團隊",
    task: "確認餐期、交接淨重、重量狀態與清運安排，保留異常說明。",
  },
  {
    icon: Truck,
    role: "清運單位",
    task: "提供實際交接時間、車次或聯單編號；不得代替處理場宣告最終去向。",
  },
  {
    icon: Factory,
    role: "處理場",
    task: "在入場單或收據提供收料重量與處理方式，成為最終去向的外部證據。",
  },
  {
    icon: PackageCheck,
    role: "供餐公司／營養師",
    task: "使用上游剩食資料改善菜單與備餐；不以清運量取代營養與供餐安全判斷。",
  },
  {
    icon: Users,
    role: "家長與社群",
    task: "只看班級或全校彙整成果與方法限制，不接觸學生個別餐盤資料。",
  },
];

export default function TracePage() {
  const { snapshot, scopedSnapshot, loading, mode, repository, refresh } =
    useFoodLens();
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);

  const focusActionRegion = () => {
    window.requestAnimationFrame(() => {
      document.getElementById("trace-action-region")?.focus();
    });
  };

  if (loading || !snapshot || !scopedSnapshot)
    return (
      <div className="page-wrap">
        <LoadingState label="正在核對清運與收據證據…" />
      </div>
    );

  const visibleCases = scopedSnapshot.evidenceCases;
  const events = [...scopedSnapshot.collectionEvents].sort((left, right) =>
    right.scheduledAt.localeCompare(left.scheduledAt),
  );
  const receipts = scopedSnapshot.destinationReceipts;
  const selectedEvent =
    events.find((event) => event.id === selectedId) ?? events[0];
  const selectedReceipt = selectedEvent
    ? receiptForCollection(receipts, selectedEvent.id)
    : undefined;
  const selectedEvidenceCase = selectedEvent
    ? scopedSnapshot.evidenceCases.find(
        (evidenceCase) => evidenceCase.id === selectedEvent.evidenceCaseId,
      )
    : undefined;
  const latestScenarioDate = events[0]?.scheduledAt.slice(0, 10);
  const todayPending = events.filter(
    (event) =>
      event.status === "scheduled" &&
      event.scheduledAt.slice(0, 10) ===
        (mode === "demo-local" ? latestScenarioDate : todayInTaipei()),
  ).length;
  const collectedCount = events.filter(
    (event) => event.status === "collected",
  ).length;
  const submittedCount = receipts.filter(
    (receipt) => receipt.status === "submitted",
  ).length;
  const verifiedReceipts = receipts.filter(
    (receipt) => receipt.status === "verified",
  );
  const verifiedWeightG = verifiedReceipts.reduce(
    (sum, receipt) => sum + (receipt.acceptedWeightG ?? 0),
    0,
  );

  const saveCollection = async (event: CollectionEvent) => {
    setBusy(true);
    try {
      await repository.saveCollectionEvent(event);
      await refresh();
      setSelectedId(event.id);
      focusActionRegion();
      toast.success(
        event.status === "scheduled"
          ? "已建立清運安排"
          : event.status === "cancelled"
            ? "已取消安排並釋放本批來源"
            : "已保存清運交接證據",
      );
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "清運資料保存失敗",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveReceipt = async (
    receipt: (typeof snapshot.destinationReceipts)[number],
  ) => {
    setBusy(true);
    try {
      await repository.saveDestinationReceipt(receipt);
      await refresh();
      focusActionRegion();
      toast.success(
        receipt.status === "verified"
          ? "收據已核驗，現在才顯示實際去向"
          : receipt.status === "rejected"
            ? "收據已退回並保留原因，可重新登錄補正文件"
            : "已登錄處理場申報，等待核驗",
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "收據保存失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="閉環｜廚餘清運與最終去向"
        title="追到收據，才知道廚餘最後去了哪裡"
        description="把校方的預定安排、清運交接與處理場收據分開保存；未核驗前，FoodLens 不宣稱實際處理方式。"
        icon={Truck}
        actions={
          <Link className="secondary-button" href="/workflow">
            回到餐期證據 <ArrowRight size={16} aria-hidden="true" />
          </Link>
        }
      />

      <aside className={styles.truthBanner} aria-label="去向資料判讀原則">
        <Handshake size={22} aria-hidden="true" />
        <div>
          <strong>一條鏈，三種不同證據</strong>
          <span>
            預定去向是校方安排；交接重量是校方與清運單位的紀錄；實際去向必須有處理場收據並經核驗。
          </span>
        </div>
        <b>{mode === "demo-local" ? "全為模擬流程" : "本校正式資料"}</b>
      </aside>

      <ol className={styles.processRail} aria-label="廚餘去向的四段證據">
        {[
          ["01", "教室完成分流", "學生／導師", ClipboardCheck],
          ["02", "校方清運交接", "校方／清運商", Truck],
          ["03", "處理場出具收據", "處理場", FileCheck2],
          ["04", "收據逐項核驗", "校方授權者", ShieldCheck],
        ].map(([number, title, owner, Icon]) => {
          const StageIcon = Icon as typeof Truck;
          return (
            <li key={number as string}>
              <span>{number as string}</span>
              <StageIcon size={20} aria-hidden="true" />
              <div>
                <strong>{title as string}</strong>
                <small>{owner as string}</small>
              </div>
            </li>
          );
        })}
      </ol>

      <section className={styles.kpiGrid} aria-label="去向追蹤摘要">
        <article>
          <span>
            {mode === "demo-local" ? "情境最新日待交接" : "今日待交接"}
          </span>
          <strong>{todayPending}</strong>
          <small>筆清運安排</small>
        </article>
        <article>
          <span>已具清運交接證據</span>
          <strong>{collectedCount}</strong>
          <small>筆・不等於去向已確認</small>
        </article>
        <article>
          <span>處理場收據待核驗</span>
          <strong>{submittedCount}</strong>
          <small>筆・仍不顯示實際成果</small>
        </article>
        <article className={styles.verifiedKpi}>
          <span>已核驗處理場收料</span>
          <strong>{(verifiedWeightG / 1000).toFixed(2)}</strong>
          <small>kg・{verifiedReceipts.length} 張已核驗收據</small>
        </article>
      </section>

      <div className={styles.traceWorkspace}>
        <Panel className={styles.traceListPanel}>
          <PanelTitle
            kicker={`目前班級範圍・${events.length} 批`}
            title="從預定到核驗的批次"
            note="選一批，完成下一個仍缺少的證據。"
          />
          {events.length ? (
            <div className={styles.traceList}>
              {events.map((event) => {
                const evidenceCase = scopedSnapshot.evidenceCases.find(
                  (item) => item.id === event.evidenceCaseId,
                );
                return (
                  <TraceCard
                    key={event.id}
                    event={event}
                    receipts={receipts}
                    mealLabel={
                      evidenceCase ? menuLabel(evidenceCase) : "餐期資料待修復"
                    }
                    active={selectedEvent?.id === event.id}
                    onSelect={() => {
                      setSelectedId(event.id);
                      focusActionRegion();
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyTrace}>
              <Truck size={28} aria-hidden="true" />
              <h2>目前範圍還沒有清運事件</h2>
              <p>
                從已完成五源量測的餐期建立第一筆安排，才不會出現沒有來源的去向數字。
              </p>
            </div>
          )}
        </Panel>

        <Panel className={styles.actionPanel}>
          <div
            id="trace-action-region"
            className={styles.actionRegion}
            tabIndex={-1}
            aria-label={
              selectedEvent
                ? `${selectedEvent.plannedDestinationName}，${traceStage(selectedEvent, selectedReceipt).label}`
                : "建立新的清運安排"
            }
          >
            <p className="sr-only" role="status" aria-live="polite">
              {selectedEvent
                ? `目前批次：${selectedEvent.plannedDestinationName}；${traceStage(selectedEvent, selectedReceipt).label}`
                : "目前可建立新的清運安排"}
            </p>
            {selectedEvent ? (
              <TraceActionPanel
                key={`${selectedEvent.id}-${traceStage(selectedEvent, selectedReceipt).label}`}
                event={selectedEvent}
                receipt={selectedReceipt}
                suggestedWeightG={suggestedCollectionWeight(
                  selectedEvidenceCase,
                  selectedEvent.wasteSources,
                )}
                mode={mode}
                busy={busy}
                onSaveCollection={saveCollection}
                onSaveReceipt={saveReceipt}
              />
            ) : (
              <NewTraceForm
                evidenceCases={visibleCases}
                existingEvents={events}
                mode={mode}
                busy={busy}
                onSave={saveCollection}
              />
            )}
          </div>
        </Panel>
      </div>

      {events.length > 0 && (
        <Panel className={styles.newTracePanel}>
          <PanelTitle
            kicker="建立下一批"
            title="安排另一筆廚餘清運"
            note="同餐期可依不同分流去向建立多批；只要任一來源已在有效安排中，系統就會阻擋重複分派。"
          />
          {visibleCases.length ? (
            <NewTraceForm
              key={`${visibleCases.map((item) => item.id).join("|")}::${events
                .map(
                  (event) =>
                    `${event.id}:${event.status}:${event.wasteSources.join(",")}`,
                )
                .join("|")}`}
              evidenceCases={visibleCases}
              existingEvents={events}
              mode={mode}
              busy={busy}
              onSave={saveCollection}
            />
          ) : (
            <div className={styles.emptyTrace}>
              <Check size={28} aria-hidden="true" />
              <h2>目前範圍沒有可連結的餐期證據</h2>
              <p>完成新的餐期證據後，這裡會出現可建立清運安排的資料。</p>
              <Link className="secondary-button" href="/workflow">
                新增餐期證據 <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          )}
        </Panel>
      )}

      <Panel className={styles.responsibilityPanel}>
        <PanelTitle
          kicker="誰負責哪一段"
          title="不是把責任全部交給 AI"
          note="FoodLens 只整理證據與差異；每一段仍由最接近現場的角色確認。"
        />
        <div className={styles.roleGrid}>
          {responsibilityRoles.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.role}>
                <Icon size={20} aria-hidden="true" />
                <strong>{item.role}</strong>
                <p>{item.task}</p>
              </article>
            );
          })}
        </div>
        <div className={styles.noClaimNote}>
          <Building2 size={18} aria-hidden="true" />
          <span>
            <strong>資料邊界：</strong>
            去向已核驗，只代表收據證據完整；本頁不把重量換算成虛構碳排，也不把特定處理方式直接稱為環保成果。
          </span>
        </div>
      </Panel>
    </div>
  );
}
