"use client";

import { useId, useMemo, useState } from "react";
import { MessageSquareText, ShieldCheck } from "lucide-react";
import {
  ANONYMOUS_REASON_KEYS,
  type AnonymousReasonCounts,
  type MealEvidenceCase,
  type TeacherEvidenceContext,
} from "@/lib/evidence-chain";
import styles from "@/app/(dashboard)/workflow/workflow.module.css";

type ReasonKey = (typeof ANONYMOUS_REASON_KEYS)[number];

const REASON_COPY: Record<ReasonKey, { title: string; description: string }> = {
  portion: { title: "份量太多", description: "主要是吃不完，不一定不喜歡。" },
  taste: { title: "味道不習慣", description: "太淡、太鹹或調味不合。" },
  texture: { title: "口感／切法", description: "太硬、太軟、太大塊或有筋。" },
  temperature: {
    title: "溫度不適合",
    description: "送到教室時已經太冷或太熱。",
  },
  time: { title: "用餐時間不夠", description: "排隊、活動或收餐時間影響。" },
  other: { title: "其他原因", description: "只記班級整體線索，不寫姓名。" },
};

function numberFromInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCount(value: number | null, maximum: number) {
  return (
    value !== null && Number.isInteger(value) && value >= 0 && value <= maximum
  );
}

export function FeedbackStage({
  reasonCollectionStatus,
  reasonCounts,
  teacherContext,
  actualDiners,
  error,
  onReasonCollectionChange,
  onReasonChange,
  onContextChange,
}: {
  reasonCollectionStatus: MealEvidenceCase["reasonCollectionStatus"];
  reasonCounts: AnonymousReasonCounts;
  teacherContext: TeacherEvidenceContext;
  actualDiners: number;
  error?: string;
  onReasonCollectionChange: (
    status: MealEvidenceCase["reasonCollectionStatus"],
    counts: AnonymousReasonCounts,
  ) => void;
  onReasonChange: (key: string, count: number | null) => void;
  onContextChange: (patch: Partial<TeacherEvidenceContext>) => void;
}) {
  const firstWithValue = ANONYMOUS_REASON_KEYS.find(
    (key) => (reasonCounts[key] ?? 0) > 0,
  );
  const [selectedReason, setSelectedReason] = useState<ReasonKey>(
    firstWithValue ?? "portion",
  );
  const responseCount = useMemo(
    () =>
      Object.values(reasonCounts).reduce<number>(
        (sum, count) => sum + (count ?? 0),
        0,
      ),
    [reasonCounts],
  );
  const helpId = useId();
  const deliveryHelpId = useId();
  const temperatureHelpId = useId();
  const canEditCounts = reasonCollectionStatus === "collected";
  const reasonEntries = Object.entries(reasonCounts);
  const extraReasons = reasonEntries.filter(
    ([key]) => !ANONYMOUS_REASON_KEYS.includes(key as ReasonKey),
  );
  const completedReasons = reasonEntries.filter(([, count]) =>
    validCount(count, actualDiners),
  ).length;
  const selectedCount = reasonCounts[selectedReason];
  const invalidSelectedCount =
    selectedCount !== null && !validCount(selectedCount, actualDiners);
  const invalidDelay =
    teacherContext.deliveryDelayMinutes !== null &&
    !validCount(teacherContext.deliveryDelayMinutes, 1440);
  const temperatureValue =
    teacherContext.temperatureStatus === "legacy-unverified"
      ? "legacy-unverified"
      : teacherContext.temperatureConcern === null
        ? "not-collected"
        : String(teacherContext.temperatureConcern);

  function changeCollectionStatus(status: "not-collected" | "collected") {
    const counts =
      status === "not-collected" ||
      reasonCollectionStatus === "legacy-unverified"
        ? (Object.fromEntries(
            reasonEntries.map(([key]) => [key, null]),
          ) as AnonymousReasonCounts)
        : { ...reasonCounts };
    onReasonCollectionChange(status, counts);
  }

  function describeCount(count: number | null) {
    if (reasonCollectionStatus === "not-collected") return "未收集";
    const text = count === null ? "未填" : `${count} 票`;
    return reasonCollectionStatus === "legacy-unverified"
      ? `${text}（待複核）`
      : text;
  }

  return (
    <>
      <header className={styles.stageHeader}>
        <div>
          <span>STEP 03 · LISTEN</span>
          <h2>讓學生補上重量說不出的原因</h2>
          <p>
            只蒐集班級層級的匿名主要原因，不記姓名、不做個人評分；這些回覆是線索，不是因果證明。
          </p>
        </div>
        <span className={styles.statusPill}>
          <ShieldCheck size={14} /> 不記名
        </span>
      </header>

      <p className={styles.reasonIntro}>
        <strong>學生操作：</strong>
        每位同學選一個最主要原因，再由小組彙整票數。剩食不是責備誰，而是找出菜單、份量與用餐情境能改善的地方。
      </p>

      <div className={styles.feedbackCollection}>
        <label>
          <span>匿名回覆收集狀態</span>
          <select
            value={reasonCollectionStatus}
            aria-describedby={helpId}
            onChange={(event) =>
              changeCollectionStatus(
                event.target.value as "not-collected" | "collected",
              )
            }
          >
            <option value="not-collected">尚未收集（票數留空）</option>
            <option value="collected">已收集，逐項確認票數</option>
            {reasonCollectionStatus === "legacy-unverified" && (
              <option value="legacy-unverified" disabled>
                舊紀錄，尚未複核
              </option>
            )}
          </select>
        </label>
        <p id={helpId}>
          {reasonCollectionStatus === "legacy-unverified"
            ? "舊紀錄沒有收集狀態；原票數保留，但尚未納入統計。請依原始紀錄逐項複核，不能只因畫面有數字就當作已收集。"
            : reasonCollectionStatus === "not-collected"
              ? "尚未收集不等於 0 票。沒有調查時保持留空，不會納入原因統計。"
              : "各項請填實際票數，沒有該原因才填 0；留空表示尚未填完，不會自動補成 0。"}
        </p>
        {reasonCollectionStatus === "legacy-unverified" && (
          <button
            type="button"
            onClick={() =>
              onReasonCollectionChange("collected", { ...reasonCounts })
            }
          >
            已逐項複核，採用原票數
          </button>
        )}
        {canEditCounts && (
          <button
            type="button"
            onClick={() =>
              onReasonCollectionChange(
                "collected",
                Object.fromEntries(
                  reasonEntries.map(([key]) => [key, 0]),
                ) as AnonymousReasonCounts,
              )
            }
          >
            已收集但沒有回覆，全部記為 0 票
          </button>
        )}
      </div>

      <div className={styles.reasonGrid} role="group" aria-label="匿名原因類型">
        {ANONYMOUS_REASON_KEYS.map((key) => {
          const copy = REASON_COPY[key];
          const selected = selectedReason === key;
          return (
            <button
              key={key}
              className={`${styles.reasonButton} ${
                selected ? styles.selectedReason : ""
              }`}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedReason(key)}
            >
              <strong>
                {copy.title} · {describeCount(reasonCounts[key])}
              </strong>
              <small>{copy.description}</small>
            </button>
          );
        })}
      </div>

      <div className={styles.reasonCount}>
        <div>
          <strong>{REASON_COPY[selectedReason].title}票數</strong>
          <span>
            {canEditCounts
              ? completedReasons === reasonEntries.length
                ? `目前共 ${responseCount} 票／實到 ${actualDiners} 人；每人只計一個主要原因。`
                : `已填 ${completedReasons}／${reasonEntries.length} 項；尚未填完或有無效票數，不能作為完整原因統計。`
              : reasonCollectionStatus === "legacy-unverified"
                ? "原值僅供複核，尚未納入原因統計。"
                : "本餐尚未收集匿名回覆。"}
          </span>
        </div>
        <label>
          <span className="sr-only">
            {REASON_COPY[selectedReason].title}票數
          </span>
          <input
            type="number"
            min="0"
            max={actualDiners}
            step="1"
            inputMode="numeric"
            disabled={!canEditCounts}
            placeholder="尚未填寫"
            value={selectedCount ?? ""}
            aria-invalid={canEditCounts && invalidSelectedCount}
            aria-describedby={helpId}
            onChange={(event) =>
              onReasonChange(
                selectedReason,
                numberFromInput(event.target.value),
              )
            }
          />
        </label>
      </div>

      {extraReasons.length > 0 && (
        <div className={styles.contextGrid}>
          {extraReasons.map(([key, count]) => (
            <label key={key}>
              <span>其他已保存原因（{key}）票數</span>
              <input
                type="number"
                min="0"
                max={actualDiners}
                step="1"
                inputMode="numeric"
                disabled={!canEditCounts}
                placeholder="尚未填寫"
                value={count ?? ""}
                aria-invalid={
                  canEditCounts &&
                  count !== null &&
                  !validCount(count, actualDiners)
                }
                onChange={(event) =>
                  onReasonChange(key, numberFromInput(event.target.value))
                }
              />
            </label>
          ))}
        </div>
      )}

      <div className={styles.contextGrid}>
        <label>
          <span>活動／課表情境（選填）</span>
          <input
            value={teacherContext.specialEvent ?? ""}
            placeholder="例如：上午運動會預演"
            maxLength={200}
            onChange={(event) =>
              onContextChange({ specialEvent: event.target.value || undefined })
            }
          />
        </label>
        <div>
          <label>
            <span>配送延遲（分鐘）</span>
            <input
              type="number"
              min="0"
              max="1440"
              step="1"
              inputMode="numeric"
              placeholder="未記錄；準時才填 0"
              value={teacherContext.deliveryDelayMinutes ?? ""}
              aria-describedby={deliveryHelpId}
              aria-invalid={invalidDelay}
              onChange={(event) => {
                const value = numberFromInput(event.target.value);
                onContextChange({
                  deliveryDelayMinutes: value,
                  deliveryStatus: value === null ? "not-collected" : "recorded",
                });
              }}
            />
          </label>
          <small id={deliveryHelpId}>
            {teacherContext.deliveryStatus === "legacy-unverified"
              ? "舊值尚未複核，不當作配送觀察。請查原始紀錄後重新填寫，或明確確認原值。"
              : "沒有記錄就留空；確定未延遲才填 0。請填 0–1440 的整數。"}
          </small>
          {teacherContext.deliveryStatus === "legacy-unverified" &&
            teacherContext.deliveryDelayMinutes !== null && (
              <button
                className={styles.feedbackReviewButton}
                type="button"
                onClick={() => onContextChange({ deliveryStatus: "recorded" })}
              >
                已查證，採用配送原值
              </button>
            )}
        </div>
        <div>
          <label>
            <span>現場溫度觀察（僅作線索）</span>
            <select
              value={temperatureValue}
              aria-describedby={temperatureHelpId}
              onChange={(event) => {
                const value = event.target.value;
                onContextChange({
                  temperatureConcern:
                    value === "not-collected" ? null : value === "true",
                  temperatureStatus:
                    value === "not-collected" ? "not-collected" : "recorded",
                });
              }}
            >
              <option value="not-collected">尚未觀察／未記錄</option>
              <option value="true">已觀察：有溫度疑慮</option>
              <option value="false">已觀察：沒有溫度疑慮</option>
              {teacherContext.temperatureStatus === "legacy-unverified" && (
                <option value="legacy-unverified" disabled>
                  舊值：
                  {teacherContext.temperatureConcern === null
                    ? "未填"
                    : teacherContext.temperatureConcern
                      ? "有疑慮"
                      : "無疑慮"}
                  （待複核）
                </option>
              )}
            </select>
          </label>
          <small id={temperatureHelpId}>
            {teacherContext.temperatureStatus === "legacy-unverified"
              ? "舊值保留但尚未複核；請依現場紀錄重新選擇，不會自動視為沒有疑慮。"
              : "沒有疑慮也需要實際觀察；這是現場線索，不代替食品安全溫度量測。"}
          </small>
        </div>
        <label>
          <span>教師觀察備註</span>
          <textarea
            value={teacherContext.note}
            maxLength={500}
            placeholder="記錄能幫助解釋這餐的情境，不填學生姓名。"
            onChange={(event) => onContextChange({ note: event.target.value })}
          />
        </label>
      </div>

      {error && (
        <p className={styles.validationError} role="alert">
          <MessageSquareText size={14} aria-hidden="true" /> {error}
        </p>
      )}
    </>
  );
}
