"use client";

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CircleDashed,
  ClipboardCopy,
  Download,
  ExternalLink,
  Image,
  KeyRound,
  LockKeyhole,
  ServerCog,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Panel, PanelTitle } from "@/components/ui/page";
import {
  assessSchoolActivation,
  createSchoolActivationHandoff,
  type SchoolActivationId,
} from "@/lib/school-activation";

interface SchoolActivationHandoffProps {
  schoolName: string;
  supabaseConfigured: boolean;
  cloudConnected: boolean;
  storageEvidence: "verified" | "failed" | "untested";
  hasRealAiEvidence: boolean;
}

const checkIcons: Record<SchoolActivationId, LucideIcon> = {
  "public-env": ServerCog,
  "teacher-auth": KeyRound,
  membership: LockKeyhole,
  "private-storage": Image,
  "real-ai": Sparkles,
};

function downloadMarkdown(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(content: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("這個瀏覽器不允許複製剪貼簿");
}

export function SchoolActivationHandoff({
  schoolName,
  supabaseConfigured,
  cloudConnected,
  storageEvidence,
  hasRealAiEvidence,
}: SchoolActivationHandoffProps) {
  const activation = assessSchoolActivation({
    supabaseConfigured,
    cloudConnected,
    storageEvidence,
    hasRealAiEvidence,
  });
  const getHandoff = () =>
    createSchoolActivationHandoff({
      siteOrigin: window.location.origin,
      schoolName,
      generatedAt: new Date().toISOString(),
    });
  const copyHandoff = async () => {
    try {
      await copyToClipboard(getHandoff());
      toast.success("正式啟用交接單已複製；內容不含任何金鑰值");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "無法複製交接單");
    }
  };
  const saveHandoff = () => {
    downloadMarkdown("foodlens-school-activation-handoff.md", getHandoff());
    toast.success("正式啟用交接單已下載");
  };

  return (
    <section
      className="school-activation-handoff"
      aria-labelledby="school-activation-title"
    >
      <Panel className="activation-status-panel">
        <div className="activation-status-heading">
          <PanelTitle
            kicker="正式上線狀態"
            title="瀏覽器能證明什麼，管理員還要完成什麼"
            note="狀態只根據目前工作階段的可驗證證據，不把尚未實測的 migration 或外部模型標成完成。"
          />
          <div
            className={
              activation.ready ? "activation-score ready" : "activation-score"
            }
            aria-label={`正式校園必要檢查 ${activation.requiredReady} / ${activation.requiredTotal}`}
          >
            <strong>
              {activation.requiredReady}/{activation.requiredTotal}
            </strong>
            <span>必要檢查</span>
          </div>
        </div>
        <ol className="activation-checks">
          {activation.checks.map((check) => {
            const Icon = checkIcons[check.id];
            return (
              <li className={check.status} key={check.id}>
                <span className="activation-check-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div>
                  <div className="activation-check-title">
                    <strong>{check.title}</strong>
                    <span>{check.statusLabel}</span>
                  </div>
                  <p>{check.detail}</p>
                </div>
                {check.status === "ready" ? (
                  <CheckCircle2
                    className="activation-check-mark"
                    aria-label="已驗證"
                    size={20}
                  />
                ) : (
                  <CircleDashed
                    className="activation-check-mark"
                    aria-label={check.required ? "待完成" : "選配"}
                    size={20}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel className="activation-transfer-panel">
        <PanelTitle
          kicker="交給校方資訊管理員"
          title="一份不含秘密值的正式啟用交接單"
          note="包含 deployment env 名稱、migration、精確 callback、教師 membership SQL placeholder、Storage 與登出驗收。"
        />
        <div className="activation-security-note">
          <LockKeyhole size={20} />
          <div>
            <strong>教師授權不在這個網頁建立</strong>
            <p>
              本頁不接收、不顯示、也不匯出高權限金鑰。學校與角色只能由受信任的
              Supabase 專案管理員在 Dashboard／SQL Editor 完成。
            </p>
          </div>
        </div>
        <div className="activation-transfer-actions">
          <button className="primary-action" onClick={() => void copyHandoff()}>
            <ClipboardCopy size={17} />
            複製交接單
          </button>
          <button className="secondary-action" onClick={saveHandoff}>
            <Download size={17} />
            下載 Markdown
          </button>
        </div>
        <a
          className="activation-dashboard-link"
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
        >
          開啟 Supabase Dashboard
          <ExternalLink size={15} />
        </a>
        <details className="activation-proof-list">
          <summary>交接單會要求哪些驗收證據？</summary>
          <ul>
            <li>教師 Auth user 與同校 membership 查詢結果。</li>
            <li>精確的正式站點／auth callback allowlist。</li>
            <li>Private Storage 上傳、signed URL 讀取與重新整理。</li>
            <li>登出後匿名訪客無法讀取正式校園資料。</li>
            <li>真實 AI 若啟用，另做授權教師測試與供應商治理審查。</li>
          </ul>
        </details>
      </Panel>
    </section>
  );
}
