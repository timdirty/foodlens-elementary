"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DataMode,
  DataRetentionPreview,
  DataRetentionRun,
  FoodLensRepository,
} from "@/lib/types";
import { Panel, PanelTitle } from "@/components/ui/page";

function dateLabel(value?: string) {
  if (!value) return "—";
  return value.replaceAll("-", "/");
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DataRetentionManager({
  repository,
  mode,
  retentionDays,
  schoolName,
  policySaved,
  onCompleted,
}: {
  repository: FoodLensRepository;
  mode: DataMode;
  retentionDays: number;
  schoolName: string;
  policySaved: boolean;
  onCompleted: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<DataRetentionPreview>();
  const [runs, setRuns] = useState<DataRetentionRun[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string>();
  const resultRef = useRef<HTMLDivElement>(null);
  const confirmationTarget = schoolName.trim() || "FoodLens";

  const load = useCallback(async () => {
    if (!policySaved) {
      setPreview(undefined);
      setError(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const [nextPreview, nextRuns] = await Promise.all([
        repository.previewDataRetention(retentionDays),
        repository.listDataRetentionRuns(),
      ]);
      setPreview(nextPreview);
      setRuns(nextRuns);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法產生清理預覽");
    } finally {
      setLoading(false);
    }
  }, [policySaved, repository, retentionDays]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const execute = async () => {
    if (!preview || confirmation !== confirmationTarget) return;
    setExecuting(true);
    setError(undefined);
    try {
      const run = await repository.executeDataRetention(retentionDays);
      setConfirmation("");
      await onCompleted();
      await load();
      toast.success(
        "已清理 " +
          run.deletedScanCount +
          " 份到期餐盤原始證據；班級秤重資料仍保留。",
      );
      window.setTimeout(() => resultRef.current?.focus(), 0);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "資料清理未完成";
      setError(message);
      toast.error(message);
    } finally {
      setExecuting(false);
    }
  };

  const hasCandidates = Boolean(preview?.eligibleScanCount);
  return (
    <section className="retention-manager" aria-label="資料保存期限清理">
      <Panel className="retention-preview-panel">
        <PanelTitle
          kicker="可執行的保存政策"
          title="先預覽，再清理餐盤原始證據"
          note="只移除到期照片、餐盤判讀、AI 原始值與人工修正；班級餐期秤重保留，才能繼續做前後比較。"
        />
        {!policySaved ? (
          <div className="retention-gate" role="status">
            <ShieldAlert size={21} />
            <div>
              <strong>請先記錄目前的治理規則</strong>
              <p>保存天數或確認狀態有變更時，舊預覽立即失效。</p>
            </div>
          </div>
        ) : loading && !preview ? (
          <div className="retention-loading" role="status">
            <RefreshCw size={18} className="spin" /> 正在核對到期證據…
          </div>
        ) : preview ? (
          <>
            <div className="retention-cutoff">
              <CalendarClock size={23} />
              <div>
                <span>{retentionDays} 天政策的清理界線</span>
                <strong>{dateLabel(preview.cutoffDate)} 以前</strong>
              </div>
              <button
                className="secondary-action"
                disabled={loading || executing}
                onClick={() => void load()}
              >
                <RefreshCw size={15} />
                重新預覽
              </button>
            </div>
            <dl className="retention-metrics">
              <div>
                <dt>到期餐盤判讀</dt>
                <dd>{preview.eligibleScanCount} 份</dd>
              </div>
              <div>
                <dt>私有圖片／Blob</dt>
                <dd>{preview.eligibleImageCount} 個</dd>
              </div>
              <div>
                <dt>涉及餐期</dt>
                <dd>{preview.affectedMealCount} 筆</dd>
              </div>
              <div className="preserved">
                <dt>仍保留的班級秤重</dt>
                <dd>{preview.preservedMealCount} 筆</dd>
              </div>
            </dl>
            <div className="retention-scope-note">
              <Archive size={18} />
              <p>
                {hasCandidates
                  ? "本批涵蓋 " +
                    dateLabel(preview.oldestEligibleDate) +
                    " 至 " +
                    dateLabel(preview.newestEligibleDate) +
                    "；單次最多處理 " +
                    preview.batchLimit +
                    " 份，超過時可再執行下一批。"
                  : "目前沒有超過保存期限的餐盤原始證據，不會刪除任何內容。"}
              </p>
            </div>
            {hasCandidates && (
              <div className="retention-confirmation-box">
                <div>
                  <span>不可逆操作</span>
                  <strong>輸入「{confirmationTarget}」確認清理</strong>
                  <p>
                    {mode === "school-cloud"
                      ? "正式校園模式會先經 Supabase Storage API 清除圖片，資料庫確認路徑已不存在後才刪除判讀。"
                      : "示範模式只影響這個瀏覽器，並同步清除還原快照中的到期 Blob，避免舊照片復原。"}
                  </p>
                </div>
                <label>
                  <span className="sr-only">輸入確認名稱</span>
                  <input
                    value={confirmation}
                    autoComplete="off"
                    placeholder={confirmationTarget}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
                <button
                  className="retention-delete-action"
                  disabled={executing || confirmation !== confirmationTarget}
                  onClick={() => void execute()}
                >
                  <Trash2 size={17} />
                  {executing ? "正在分批清理…" : "清理這批到期證據"}
                </button>
              </div>
            )}
          </>
        ) : null}
        {error && (
          <div className="retention-error" role="alert">
            <ShieldAlert size={18} />
            <p>{error}</p>
          </div>
        )}
        <p className="retention-backup-note">
          FoodLens
          完成的是應用層資料清理；雲端供應商的系統備份仍依學校方案與供應商保留政策處理，不能宣稱立即從所有備份消失。
        </p>
      </Panel>

      <Panel className="retention-history">
        <PanelTitle
          kicker="不含照片的操作證據"
          title="最近清理紀錄"
          note="只留下界線、數量、結果與時間，不保存圖片路徑或餐盤內容。"
        />
        <div ref={resultRef} tabIndex={-1} aria-live="polite">
          {runs.length ? (
            <ol>
              {runs.slice(0, 6).map((run) => (
                <li key={run.id} className={run.status}>
                  <span>
                    {run.status === "completed" ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <ShieldAlert size={17} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {run.status === "completed"
                        ? "已清理 " + run.deletedScanCount + " 份餐盤證據"
                        : "本次未刪除資料"}
                    </strong>
                    <p>
                      界線 {dateLabel(run.cutoffDate)} · 圖片{" "}
                      {run.deletedImageCount} 個 · {timeLabel(run.startedAt)}
                    </p>
                    {run.failureReason && <small>{run.failureReason}</small>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="retention-empty">
              <CalendarClock size={24} />
              <p>尚未執行清理；第一次完成後會在這裡留下稽核摘要。</p>
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
}
