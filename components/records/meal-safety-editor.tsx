"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { ClipboardCheck, LoaderCircle } from "lucide-react";
import {
  createEmptyMealSafetyObservation,
  mealSafetyParentIssue,
  mealSafetyObservationSchema,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import type { MealRecord } from "@/lib/types";
import styles from "./meal-safety-editor.module.css";

type EventObservation = MealSafetyObservation["shortage"];
type SafetyDraft = Omit<MealSafetyObservation, "satisfaction"> & {
  satisfaction: Omit<MealSafetyObservation["satisfaction"], "ratings"> & {
    ratings: (number | null)[] | null;
  };
};

function inputNumber(value: string) {
  if (!value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function newDraft(
  meal: MealRecord,
  provenance: MealSafetyObservation["provenance"],
  previous?: MealSafetyObservation,
): SafetyDraft {
  const empty = createEmptyMealSafetyObservation(meal, provenance);
  if (!previous) return empty;
  return {
    ...previous,
    ...empty,
    sourceTitle: previous.sourceTitle,
    sourceReference: previous.sourceReference,
    shortage: { ...previous.shortage },
    refill: { ...previous.refill },
    satisfaction: {
      ...previous.satisfaction,
      ratings: previous.satisfaction.ratings
        ? [...previous.satisfaction.ratings]
        : null,
    },
    revision: previous.revision + 1,
    previousObservationId: previous.id,
    revisionReason: "",
  };
}

function eventSummary(label: string, value: EventObservation) {
  return value.status === "not-collected"
    ? `${label}：尚未觀察`
    : `${label}：${value.eventCount} 次／觀察 ${value.observedDiners} 人`;
}

function EventFields({
  label,
  value,
  actualPeople,
  onChange,
}: {
  label: string;
  value: EventObservation;
  actualPeople: number;
  onChange: (value: EventObservation) => void;
}) {
  return (
    <fieldset className={styles.observation}>
      <legend>{label}</legend>
      <label>
        <span>{label}收集狀態</span>
        <select
          value={value.status}
          onChange={(event) =>
            onChange({
              status: event.target.value as EventObservation["status"],
              eventCount: null,
              observedDiners: null,
            })
          }
        >
          <option value="not-collected">尚未觀察／未記錄</option>
          <option value="recorded">已觀察，填寫實際紀錄</option>
        </select>
      </label>
      <div className={styles.fields}>
        <label>
          <span>{label}事件次數</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            disabled={value.status === "not-collected"}
            placeholder="確定沒有才填 0"
            value={value.eventCount ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                eventCount: inputNumber(event.target.value),
              })
            }
          />
        </label>
        <label>
          <span>{label}觀察人數</span>
          <input
            type="number"
            min="1"
            max={actualPeople}
            step="1"
            inputMode="numeric"
            disabled={value.status === "not-collected"}
            placeholder={`1–${actualPeople} 人`}
            value={value.observedDiners ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                observedDiners: inputNumber(event.target.value),
              })
            }
          />
        </label>
      </div>
      <p>
        {label === "供應不足"
          ? "記錄需要用餐或添餐、卻沒有足夠餐點的事件；不可把未詢問當作沒有不足。"
          : "記錄實際添餐事件；同一人可添餐多次，因此次數不是不重複人數。"}
        兩項各自記錄，未觀察不會代填 0。
      </p>
    </fieldset>
  );
}

export function MealSafetyEditor({
  meal,
  observations,
  meals,
  provenance,
  onSave,
  initialOpen = false,
}: {
  meal: MealRecord;
  observations: readonly MealSafetyObservation[];
  meals?: readonly MealRecord[];
  provenance: MealSafetyObservation["provenance"];
  onSave: (observation: MealSafetyObservation) => Promise<void>;
  initialOpen?: boolean;
}) {
  const history = observations
    .filter((item) => item.mealRecordId === meal.id)
    .toSorted((a, b) => b.revision - a.revision);
  const latest = history[0];
  const latestParentIssue = latest
    ? mealSafetyParentIssue(latest, meals ?? [meal])
    : undefined;
  const [draft, setDraft] = useState<SafetyDraft | null>(() =>
    initialOpen ? newDraft(meal, provenance, latest) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const [acknowledged, setAcknowledged] = useState(false);
  const savingRef = useRef(false);
  const attemptedObservationRef = useRef<MealSafetyObservation | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<"error" | "title" | "button" | null>(null);
  const helpId = useId();

  const focusCommittedTarget = useCallback(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const element =
      target === "error"
        ? errorRef.current
        : target === "title"
          ? titleRef.current
          : buttonRef.current;
    if (!element?.isConnected) return;
    element.focus();
    if (document.activeElement === element) pendingFocusRef.current = null;
  }, []);

  // Focus the node only after React commits its conditional DOM and ref.
  // An animation frame can run before that commit under concurrent rendering.
  useLayoutEffect(focusCommittedTarget, [
    draft,
    error,
    savedMessage,
    focusCommittedTarget,
  ]);

  function patch(patchValue: Partial<SafetyDraft>) {
    attemptedObservationRef.current = null;
    setDraft((current) => (current ? { ...current, ...patchValue } : current));
    setError(undefined);
    setAcknowledged(false);
  }

  function reportError(message: string) {
    pendingFocusRef.current = "error";
    // Repeating the same validation message need not cause a React commit.
    if (message === error) focusCommittedTarget();
    setError(message);
  }

  function openEditor() {
    pendingFocusRef.current = "title";
    attemptedObservationRef.current = null;
    setDraft(newDraft(meal, provenance, latest));
    setAcknowledged(false);
    setError(undefined);
    setSavedMessage(undefined);
  }

  async function save() {
    if (!draft || savingRef.current) return;
    if (!acknowledged) {
      reportError("請先確認收集狀態與資料來源，未觀察的項目應留空。");
      return;
    }
    const parsed = mealSafetyObservationSchema.safeParse(
      attemptedObservationRef.current ?? {
        ...draft,
        recordedAt: new Date(
          provenance === "demo" && latest
            ? Math.max(Date.now(), Date.parse(latest.recordedAt) + 1)
            : Date.now(),
        ).toISOString(),
      },
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      reportError(
        issue && !/^[A-Za-z]/.test(issue)
          ? issue
          : "請逐項確認：已收集欄位不能留空，人數與票數須為有效的非負整數。",
      );
      return;
    }
    attemptedObservationRef.current = parsed.data;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(parsed.data);
      attemptedObservationRef.current = null;
      pendingFocusRef.current = "button";
      setSavedMessage(
        `本餐安全觀察第 ${parsed.data.revision} 版已保存；${
          provenance === "demo"
            ? "這是本機示範紀錄，不代表實測成果。"
            : "已保存於校園資料，請依原始紀錄持續核對。"
        }`,
      );
      setDraft(null);
    } catch (caught) {
      reportError(
        `尚未完成保存：${
          caught instanceof Error ? caught.message : "請檢查連線後重試。"
        } 若提示版本衝突，請重新整理後再編輯；目前輸入仍留在畫面。`,
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className={styles.safety} aria-label="本餐安全觀察">
      <div className={styles.heading}>
        <div>
          <h3>少了剩食，也要確認大家有吃飽</h3>
          <p>
            {meal.servedOn} · 本餐實到 {meal.actualPeople} 人 ·{" "}
            {provenance === "demo" ? "示範資料" : "校園觀察紀錄"}
          </p>
        </div>
        {!draft && (
          <button
            ref={buttonRef}
            type="button"
            className="secondary-action"
            onClick={openEditor}
          >
            <ClipboardCheck size={16} aria-hidden="true" />
            {latest ? "新增修訂版安全觀察" : "補記本餐安全觀察"}
          </button>
        )}
      </div>
      <p id={helpId}>
        每項資料獨立記錄。未知不等於 0，滿意度高也不能證明沒有供應不足。
        只填班級彙總與不含個資的來源編號，不填姓名、學號或座號。
      </p>
      {latest ? (
        <div className={styles.summary}>
          <strong>最新保存：第 {latest.revision} 版</strong>
          <p>{eventSummary("供應不足", latest.shortage)}</p>
          <p>{eventSummary("添餐", latest.refill)}</p>
          <p>
            滿意度：
            {latest.satisfaction.status === "not-collected"
              ? "尚未收集"
              : `已邀請 ${latest.satisfaction.invitedDiners} 人，共 ${
                  latest.satisfaction.ratings?.reduce(
                    (sum, count) => sum + count,
                    0,
                  ) ?? 0
                } 份回覆；零回覆不計算平均。`}
          </p>
        </div>
      ) : (
        <p className={styles.summary}>
          本餐尚無安全觀察紀錄，不能當作沒有不足或沒有添餐。
        </p>
      )}
      {savedMessage && <p role="status">{savedMessage}</p>}
      {latestParentIssue && (
        <p className={styles.error} role="status">
          最新安全觀察與目前餐期條件不一致：{latestParentIssue}
          請查核後新增修訂版；原紀錄仍保留，不可直接當作本餐目前條件的安全證據。
        </p>
      )}
      {draft && (
        <form
          className={styles.editor}
          aria-label="本餐安全觀察表單"
          aria-describedby={helpId}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          noValidate
        >
          <h4 ref={titleRef} tabIndex={-1}>
            {draft.revision === 1
              ? "補上這餐的現場紀錄"
              : `新增第 ${draft.revision} 版；不覆寫舊紀錄`}
          </h4>
          {provenance === "demo" &&
            latest &&
            Date.parse(latest.recordedAt) >= Date.parse(draft.recordedAt) && (
              <p>
                這筆示範紀錄使用模擬時序；修訂時間會接在上一版之後，不代表實際觀察時間。
              </p>
            )}
          <fieldset
            className={styles.inputs}
            disabled={saving}
            aria-busy={saving}
          >
            <legend className="sr-only">安全觀察輸入</legend>
            <EventFields
              label="供應不足"
              value={draft.shortage}
              actualPeople={meal.actualPeople}
              onChange={(shortage) => patch({ shortage })}
            />
            <EventFields
              label="添餐"
              value={draft.refill}
              actualPeople={meal.actualPeople}
              onChange={(refill) => patch({ refill })}
            />
            <fieldset className={styles.observation}>
              <legend>餐後滿意度</legend>
              <label>
                <span>滿意度收集狀態</span>
                <select
                  value={draft.satisfaction.status}
                  onChange={(event) => {
                    const status = event.target.value as
                      "not-collected" | "collected";
                    patch({
                      satisfaction: {
                        status,
                        invitedDiners: null,
                        ratings:
                          status === "collected"
                            ? [null, null, null, null, null]
                            : null,
                      },
                    });
                  }}
                >
                  <option value="not-collected">尚未收集</option>
                  <option value="collected">已收集，填寫五級票數</option>
                </select>
              </label>
              <label>
                <span>滿意度邀請人數</span>
                <input
                  type="number"
                  min="1"
                  max={meal.actualPeople}
                  step="1"
                  inputMode="numeric"
                  disabled={draft.satisfaction.status !== "collected"}
                  value={draft.satisfaction.invitedDiners ?? ""}
                  onChange={(event) =>
                    patch({
                      satisfaction: {
                        ...draft.satisfaction,
                        invitedDiners: inputNumber(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <div className={styles.ratings}>
                {[1, 2, 3, 4, 5].map((rating, index) => (
                  <label key={rating}>
                    <span>滿意度 {rating} 分票數</span>
                    <input
                      type="number"
                      min="0"
                      max={meal.actualPeople}
                      step="1"
                      inputMode="numeric"
                      disabled={draft.satisfaction.status !== "collected"}
                      placeholder="未填"
                      value={draft.satisfaction.ratings?.[index] ?? ""}
                      onChange={(event) => {
                        const ratings = [
                          ...(draft.satisfaction.ratings ?? [
                            null,
                            null,
                            null,
                            null,
                            null,
                          ]),
                        ];
                        ratings[index] = inputNumber(event.target.value);
                        patch({
                          satisfaction: { ...draft.satisfaction, ratings },
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
              {draft.satisfaction.status === "collected" && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() =>
                    patch({
                      satisfaction: {
                        ...draft.satisfaction,
                        ratings: [0, 0, 0, 0, 0],
                      },
                    })
                  }
                >
                  已邀請但沒有回覆，五項記為 0 票
                </button>
              )}
              <p>
                1 分＝很不滿意、5
                分＝很滿意；每人每餐一票。這是本研究題項，不是標準化量表。請填滿五項；沒收到回覆仍須記錄邀請人數。
              </p>
            </fieldset>
            <div className={styles.fields}>
              <label>
                <span>資料來源名稱</span>
                <input
                  value={draft.sourceTitle}
                  maxLength={160}
                  placeholder="例如：單餐量測紀錄表"
                  onChange={(event) =>
                    patch({ sourceTitle: event.target.value })
                  }
                />
              </label>
              <label>
                <span>來源編號／查核位置</span>
                <input
                  value={draft.sourceReference}
                  maxLength={240}
                  placeholder="例如：匿名餐期紀錄 FL-001，第 2 頁"
                  onChange={(event) =>
                    patch({ sourceReference: event.target.value })
                  }
                />
              </label>
            </div>
            <p>
              任一項已有觀察，兩項來源欄位都要填；請保留可由教師查核的原始表單，不上傳含個資名冊。
            </p>
            {draft.revision > 1 && (
              <label>
                <span>本次修訂原因</span>
                <textarea
                  value={draft.revisionReason}
                  minLength={3}
                  maxLength={500}
                  placeholder="說明更正哪一項、依據什麼來源。"
                  onChange={(event) =>
                    patch({ revisionReason: event.target.value })
                  }
                />
              </label>
            )}
            <label className={styles.confirm}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                我已核對收集狀態與來源；未觀察不填 0，修訂保留舊版本。
              </span>
            </label>
            <div className={styles.actions}>
              <button className="primary-action" type="submit">
                {saving && <LoaderCircle size={16} aria-hidden="true" />}
                {saving ? "正在保存安全觀察…" : "確認並保存本餐安全觀察"}
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  pendingFocusRef.current = "button";
                  setDraft(null);
                  setError(undefined);
                }}
              >
                取消編輯
              </button>
            </div>
          </fieldset>
          {error && (
            <p
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className={styles.error}
            >
              {error}
            </p>
          )}
        </form>
      )}
      {history.length > 0 && (
        <details className={styles.history}>
          <summary>查看安全觀察歷史（{history.length} 版）</summary>
          {history.map((item) => (
            <article key={item.id}>
              <h4>
                第 {item.revision} 版 ·{" "}
                {new Date(item.recordedAt).toLocaleString("zh-TW", {
                  timeZone: "Asia/Taipei",
                })}
              </h4>
              <p>
                {eventSummary("供應不足", item.shortage)}；
                {eventSummary("添餐", item.refill)}
              </p>
              <p>
                滿意度：
                {item.satisfaction.status === "not-collected"
                  ? "尚未收集"
                  : `五級票數 ${item.satisfaction.ratings?.join("／")}；邀請 ${item.satisfaction.invitedDiners} 人`}
              </p>
              <p>
                來源：{item.sourceTitle || "未收集，未提供來源"} ·{" "}
                {item.sourceReference || "—"}
              </p>
              <p>修訂原因：{item.revisionReason || "首次紀錄"}</p>
              <small>
                紀錄編號 {item.id}
                {item.previousObservationId
                  ? `；承接 ${item.previousObservationId}`
                  : ""}
              </small>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
