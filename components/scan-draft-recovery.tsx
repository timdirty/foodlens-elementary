"use client";

import { Clock3, RotateCcw, Trash2 } from "lucide-react";
import type { ScanDraft } from "@/lib/scan-draft";

export function ScanDraftRecovery({
  draft,
  onResume,
  onDiscard,
  busy = false,
}: {
  draft: ScanDraft;
  onResume: () => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="analysis-warning analysis-recovery"
      role="region"
      aria-label="未送出掃描草稿"
    >
      <Clock3 size={20} aria-hidden="true" />
      <div>
        <strong>發現未送出的掃描草稿</strong>
        <p>
          已於 {new Date(draft.updatedAt).toLocaleString("zh-TW")}{" "}
          儲存在此裝置的
          IndexedDB；尚未新增餐期、掃描或上傳正式記錄。未完成草稿會在 7
          天後自動移除。
        </p>
        <div className="button-row">
          <button
            className="primary-action"
            type="button"
            onClick={onResume}
            disabled={busy}
          >
            <RotateCcw size={16} />
            繼續草稿
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={onDiscard}
            disabled={busy}
          >
            <Trash2 size={16} />
            捨棄草稿
          </button>
        </div>
      </div>
    </div>
  );
}
