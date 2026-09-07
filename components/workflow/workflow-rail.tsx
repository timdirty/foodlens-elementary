"use client";

import { ArrowLeft, ArrowRight, Check, Database } from "lucide-react";
import type { EvidenceSourceKind } from "@/lib/evidence-chain";
import styles from "@/app/(dashboard)/workflow/workflow.module.css";

export const WORKFLOW_STEPS = [
  { title: "智慧菜單", description: "來源與人工確認" },
  { title: "分流秤重", description: "五類來源與覆蓋率" },
  { title: "學生原因", description: "匿名票數與情境" },
  { title: "責任決策", description: "證據、主責與護欄" },
] as const;

const SOURCE_LABELS: Record<EvidenceSourceKind, string> = {
  demo: "示範資料",
  measured: "現場實測",
  estimated: "估算資料",
  official: "官方紀錄",
};

export function WorkflowRail({
  step,
  completed,
  className,
  servedOn,
  menuName,
  sourceKind,
  measurementDraft,
  busy,
  savedAt,
  onPrevious,
  onNext,
  onSave,
}: {
  step: number;
  completed: readonly boolean[];
  className: string;
  servedOn: string;
  menuName: string;
  sourceKind: EvidenceSourceKind;
  measurementDraft?: boolean;
  busy: boolean;
  savedAt?: string;
  onPrevious: () => void;
  onNext: () => void;
  onSave: () => void;
}) {
  const atLast = step === WORKFLOW_STEPS.length - 1;
  return (
    <aside className={styles.sideRail} aria-label="任務進度與儲存">
      <div className={styles.sideHead}>
        <span>ONE MEAL · ONE EVIDENCE CHAIN</span>
        <h2>一餐證據鏈</h2>
        <p>每一個判斷，都能往回找到菜單、秤重、學生線索與人類決定。</p>
      </div>
      <div className={styles.caseMeta}>
        <div>
          <span>班級</span>
          <strong>{className}</strong>
        </div>
        <div>
          <span>日期</span>
          <strong>{servedOn}</strong>
        </div>
        <div>
          <span>實際菜單</span>
          <strong>{menuName || "等待菜單確認"}</strong>
        </div>
      </div>
      <ol className={styles.progressList}>
        {WORKFLOW_STEPS.map((item, index) => (
          <li
            key={item.title}
            data-step={
              completed[index] ? "✓" : String(index + 1).padStart(2, "0")
            }
            className={
              index === step
                ? styles.current
                : completed[index]
                  ? styles.done
                  : undefined
            }
            aria-current={index === step ? "step" : undefined}
          >
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </li>
        ))}
      </ol>
      <div className={styles.sideSummary}>
        <strong>
          {measurementDraft
            ? "尚未成為實測資料"
            : `${SOURCE_LABELS[sourceKind]} · 決策仍由人負責`}
        </strong>
        <span>
          {measurementDraft
            ? "正式數字目前是未保存草稿；逐項輸入並人工確認後，才可成為現場證據。"
            : sourceKind === "demo"
              ? "這組數字是可重現的模擬情境，不是本校實測成果。"
              : "請依每筆量測方法與來源檢查證據品質。"}
        </span>
      </div>
      <div className={styles.railActions}>
        {step > 0 && (
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={onPrevious}
          >
            <ArrowLeft size={15} /> 上一步
          </button>
        )}
        {!atLast ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={onNext}
          >
            檢查並繼續 <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={onSave}
          >
            {busy ? <Database size={15} /> : <Check size={15} />}
            {busy ? "正在保存…" : "確認並保存證據鏈"}
          </button>
        )}
        {savedAt && (
          <div className={styles.savedState} role="status">
            <Check size={15} aria-hidden="true" />
            <span>
              已保存於這個{sourceKind === "demo" ? "瀏覽器" : "校園工作區"}
              <br />
              {sourceKind === "demo"
                ? "重新整理後仍會保留"
                : new Intl.DateTimeFormat("zh-TW", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(savedAt))}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
