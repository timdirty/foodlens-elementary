import {
  Building2,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Scale,
  Truck,
} from "lucide-react";
import {
  TREATMENT_METHOD_LABELS,
  TRACE_WASTE_SOURCE_LABELS,
  TRACE_WEIGHT_STATE_LABELS,
  collectionReceiptWeightDifference,
  receiptForCollection,
  verifiedOutcome,
  type CollectionEvent,
  type DestinationReceipt,
} from "@/lib/circularity";
import styles from "@/app/(dashboard)/trace/trace.module.css";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function pickupTiming(event: CollectionEvent) {
  if (!event.collectedAt) return undefined;
  const minutes = Math.round(
    (Date.parse(event.collectedAt) - Date.parse(event.scheduledAt)) / 60_000,
  );
  if (minutes === 0) return "準時交接";
  return minutes > 0 ? `晚 ${minutes} 分鐘` : `早 ${Math.abs(minutes)} 分鐘`;
}

export function traceStage(
  event: CollectionEvent,
  receipt: DestinationReceipt | undefined,
) {
  if (event.status === "cancelled")
    return { label: "清運已取消", tone: "muted" as const, step: 0 };
  if (receipt?.status === "verified")
    return { label: "去向已核驗", tone: "verified" as const, step: 4 };
  if (receipt?.status === "rejected")
    return { label: "收據已退回", tone: "warning" as const, step: 3 };
  if (receipt?.status === "submitted")
    return { label: "收據待核驗", tone: "review" as const, step: 3 };
  if (event.status === "collected")
    return { label: "交接完成・待收據", tone: "collected" as const, step: 2 };
  return { label: "待清運交接", tone: "scheduled" as const, step: 1 };
}

export function TraceCard({
  event,
  receipts,
  mealLabel,
  active,
  onSelect,
}: {
  event: CollectionEvent;
  receipts: readonly DestinationReceipt[];
  mealLabel: string;
  active: boolean;
  onSelect: () => void;
}) {
  const receipt = receiptForCollection(receipts, event.id);
  const stage = traceStage(event, receipt);
  const outcome = verifiedOutcome(receipt);
  const weightDifference = collectionReceiptWeightDifference(event, receipt);
  return (
    <article
      className={`${styles.traceCard}${active ? ` ${styles.activeCard}` : ""}`}
    >
      <button
        type="button"
        className={styles.cardSelect}
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`查看 ${mealLabel} 的去向追蹤`}
      >
        <span className={`${styles.stageBadge} ${styles[stage.tone]}`}>
          {stage.step > 0 ? `${stage.step}/4` : "—"} {stage.label}
        </span>
        <strong>{mealLabel}</strong>
        <small>
          <Truck size={14} aria-hidden="true" />
          預定 {formatDateTime(event.scheduledAt)}
          {event.collectedAt
            ? `・實際 ${formatDateTime(event.collectedAt)}（${pickupTiming(event)}）`
            : ""}
        </small>
      </button>

      <div className={styles.cardTruthGrid}>
        <div>
          <span>
            <ClipboardList size={15} aria-hidden="true" /> 預定去向
          </span>
          <strong>{event.plannedDestinationName}</strong>
          <small>
            {TREATMENT_METHOD_LABELS[event.plannedTreatmentMethod]}・
            {event.wasteSources
              .map((source) => TRACE_WASTE_SOURCE_LABELS[source])
              .join("＋")}
            ・僅是計畫
          </small>
        </div>
        <div
          className={outcome ? styles.outcomeVerified : styles.outcomePending}
        >
          <span>
            {outcome ? (
              <CheckCircle2 size={15} aria-hidden="true" />
            ) : (
              <CircleDashed size={15} aria-hidden="true" />
            )}{" "}
            實際處理
          </span>
          <strong>{outcome?.facilityName ?? "尚未由收據核驗"}</strong>
          <small>
            {outcome
              ? `${TREATMENT_METHOD_LABELS[outcome.treatmentMethod]}・已核驗`
              : "不把預定地點當成實際去向"}
          </small>
        </div>
      </div>

      <dl className={styles.cardFacts}>
        <div>
          <dt>
            <Scale size={14} aria-hidden="true" /> 校方交接
          </dt>
          <dd>
            {event.netCollectedWeightG === undefined
              ? "尚未秤重"
              : `${(event.netCollectedWeightG / 1000).toFixed(2)} kg`}
            <small>{TRACE_WEIGHT_STATE_LABELS[event.weightState]}</small>
          </dd>
        </div>
        <div>
          <dt>
            <Building2 size={14} aria-hidden="true" /> 處理場收料
          </dt>
          <dd>
            {outcome
              ? `${(outcome.acceptedWeightG / 1000).toFixed(2)} kg`
              : "等待核驗"}
            <small>
              {weightDifference
                ? `差異 ${weightDifference.differenceG >= 0 ? "+" : ""}${(
                    weightDifference.differenceG / 1000
                  ).toFixed(2)} kg`
                : "尚不計算重量差異"}
            </small>
          </dd>
        </div>
      </dl>
    </article>
  );
}
