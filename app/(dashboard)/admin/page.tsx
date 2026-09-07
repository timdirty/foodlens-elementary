"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import {
  ArrowRight,
  Check,
  Cloud,
  Database,
  Download,
  FileJson,
  FileText,
  LogIn,
  Plus,
  RotateCcw,
  Rocket,
  Save,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  Undo2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { SchoolActivationHandoff } from "@/components/admin/school-activation-handoff";
import { DataRetentionManager } from "@/components/admin/data-retention-manager";
import { useFoodLens } from "@/components/data-provider";
import { useJudgePreflightRuntime } from "@/components/use-judge-preflight";
import {
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import {
  MAX_BACKUP_BYTES,
  parseFoodLensBackup,
  parseMealRecordsCsv,
  serializeFoodLensBackup,
  serializeMealRecordsCsv,
} from "@/lib/data-portability";
import { createUuid } from "@/lib/crypto";
import { assessProductReadiness } from "@/lib/product-readiness";
import { clearScanDrafts } from "@/lib/scan-draft";
import { createDemoSnapshot } from "@/lib/seed";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getRovingTabTargetIndex } from "@/lib/tab-navigation";
import type { AppSnapshot, SchoolClass } from "@/lib/types";
import { clearWorkflowDrafts } from "@/lib/workflow-draft";

type Tab =
  | "launch"
  | "project"
  | "classes"
  | "governance"
  | "research"
  | "settings"
  | "data"
  | "cloud";
const tabs: [Tab, string, typeof Settings2][] = [
  ["launch", "啟用中心", Rocket],
  ["project", "專案資料", Settings2],
  ["classes", "班級管理", Users],
  ["governance", "資料治理", ShieldCheck],
  ["research", "研究內容", FileText],
  ["settings", "估算係數", SlidersHorizontal],
  ["data", "備份與重設", Database],
  ["cloud", "校園雲端", Cloud],
];

function isAdminTab(value: string | null): value is Tab {
  return tabs.some(([id]) => id === value);
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const profileInputSchema = z.object({
  projectName: z.string().trim().min(2, "專案名稱至少 2 個字"),
  subtitle: z.string().trim().min(4, "副標題至少 4 個字"),
  schoolName: z.string().trim().min(2, "請填寫學校名稱"),
  teamName: z.string().trim().min(2, "請填寫團隊名稱"),
  teamMembers: z.string().trim().min(2, "請填寫參賽成員或匿名代號"),
  researchPeriod: z.string().trim().min(4, "請說明研究期間"),
  aiDisclosure: z.string().trim().min(10, "AI 使用揭露至少 10 個字"),
});

const teacherEmailSchema = z
  .string()
  .trim()
  .min(1, "請輸入教師 Email")
  .email("請輸入有效的教師 Email");

const settingsInputSchema = z
  .object({
    costTwdPerKg: z.number().finite().min(0).max(100_000),
    schoolDailyBaselineG: z.number().int().min(0).max(100_000_000),
    schoolDaysPerWeek: z.number().int().min(1).max(7),
    weeksPerSemester: z.number().int().min(1).max(52),
    semestersPerYear: z.number().int().min(1).max(4),
    sourceTitle: z.string().trim().max(500).optional(),
    sourceUrl: z.union([z.literal(""), z.url("來源網址格式不正確")]).optional(),
    retrievedAt: z.string().optional(),
    disclaimer: z.string().trim().min(10, "估算聲明至少 10 個字"),
  })
  .superRefine((value, context) => {
    if (value.sourceUrl && !value.sourceTitle) {
      context.addIssue({
        code: "custom",
        path: ["sourceTitle"],
        message: "填寫來源網址時，也需填寫來源名稱",
      });
    }
    if (value.sourceUrl && !value.retrievedAt) {
      context.addIssue({
        code: "custom",
        path: ["retrievedAt"],
        message: "填寫來源網址時，也需填寫取得日期",
      });
    }
  });

const classInputSchema = z.object({
  name: z.string().trim().min(2, "班級名稱至少 2 個字").max(20),
  grade: z.union([z.literal(5), z.literal(6)]),
  active: z.boolean(),
});

const governanceInputSchema = z.object({
  privacyContact: z.string().trim().min(2, "請填寫資料負責人").max(80),
  dataRetentionDays: z.number().int().min(1).max(3650),
  governanceReviewedAt: z.string().min(1, "請確認已讀資料治理規則"),
});

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "請檢查表單內容";
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="page-wrap">
          <LoadingState />
        </div>
      }
    >
      <AdminPageContent />
    </Suspense>
  );
}

function AdminPageContent() {
  const { snapshot, loading, mode } = useFoodLens();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(() =>
    isAdminTab(requestedTab) ? requestedTab : "launch",
  );
  if (loading || !snapshot)
    return (
      <div className="page-wrap">
        <LoadingState />
      </div>
    );
  return (
    <AdminContent
      key={`${mode}-${snapshot.profile.updatedAt}-${snapshot.impactSettings.updatedAt}-${snapshot.classes.map((item) => `${item.id}:${item.name}:${item.grade}:${item.active}`).join("|")}-${snapshot.researchSections.map((item) => `${item.id}:${item.updatedAt}`).join("|")}`}
      initialSnapshot={snapshot}
      tab={tab}
      setTab={setTab}
    />
  );
}

function AdminContent({
  initialSnapshot: snapshot,
  tab,
  setTab,
}: {
  initialSnapshot: AppSnapshot;
  tab: Tab;
  setTab: (tab: Tab) => void;
}) {
  const { repository, refresh, mode, setMode } = useFoodLens();
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex = getRovingTabTargetIndex(event.key, index, tabs.length);
    if (nextIndex === undefined) return;
    event.preventDefault();
    setTab(tabs[nextIndex][0]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  };
  const initialSection = snapshot.researchSections[0];
  const [profile, setProfile] = useState(snapshot.profile);
  const [settings, setSettings] = useState(snapshot.impactSettings);
  const [classDrafts, setClassDrafts] = useState(snapshot.classes);
  const [newClass, setNewClass] = useState<Pick<SchoolClass, "name" | "grade">>(
    {
      name: "",
      grade: 5,
    },
  );
  const [sectionId, setSectionId] = useState(initialSection?.id ?? "");
  const [sectionBody, setSectionBody] = useState(
    initialSection?.bodyMarkdown ?? "",
  );
  const [armReset, setArmReset] = useState(false);
  const [email, setEmail] = useState("");
  const [authSending, setAuthSending] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [recoveryMetadata, setRecoveryMetadata] = useState<{
    savedAt?: string;
    mealCount: number;
    scanCount: number;
  } | null>();
  const preflightRuntime = useJudgePreflightRuntime(mode, snapshot);
  const readiness = useMemo(
    () => assessProductReadiness(snapshot, mode, preflightRuntime),
    [mode, snapshot, preflightRuntime],
  );
  const demoStatusLabel = readiness.demoReady
    ? "已就緒"
    : readiness.judgePreflight.draftStatus === "checking"
      ? "檢查中"
      : readiness.judgePreflight.draftStatus === "unavailable"
        ? "無法檢查草稿"
        : readiness.judgePreflight.draftStatus === "blocked"
          ? `尚有 ${readiness.judgePreflight.pendingDraftCount} 份草稿`
          : "待確認展示資料";
  const storageEvidence = useMemo(() => {
    if (mode !== "school-cloud") return "untested" as const;
    if (
      snapshot.scans.some(
        (scan) => scan.imagePath && scan.imageUrl && !scan.imageLoadError,
      )
    )
      return "verified" as const;
    if (snapshot.scans.some((scan) => scan.imagePath && scan.imageLoadError))
      return "failed" as const;
    return "untested" as const;
  }, [mode, snapshot.scans]);
  const hasRealAiEvidence = useMemo(
    () =>
      mode === "school-cloud" &&
      snapshot.scans.some(
        (scan) =>
          scan.status === "confirmed" && scan.analysisKind === "real-ai",
      ),
    [mode, snapshot.scans],
  );
  useEffect(() => {
    let active = true;
    const loadRecoveryMetadata = async () => {
      if (!repository.getRecoveryMetadata) {
        if (active) setRecoveryMetadata(null);
        return;
      }
      try {
        const metadata = await repository.getRecoveryMetadata();
        if (active) setRecoveryMetadata(metadata);
      } catch {
        if (active) setRecoveryMetadata(null);
      }
    };
    void loadRecoveryMetadata();
    return () => {
      active = false;
    };
  }, [repository, snapshot.meals.length, snapshot.scans.length]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const cloudResult = url.searchParams.get("cloud");
    if (!cloudResult) return;
    url.searchParams.delete("cloud");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setTab("cloud");
      if (cloudResult === "error") {
        toast.error("教師登入連結已失效或無法完成，請重新寄送。");
        return;
      }
      setBusyAction("cloud-connect");
      try {
        await setMode("school-cloud");
        if (!cancelled) toast.success("教師登入成功，已連線至校園私有資料。");
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error
              ? `登入已完成，但無法讀取校園資料：${error.message}`
              : "登入已完成，但無法讀取校園資料",
          );
      } finally {
        if (!cancelled) setBusyAction(undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setMode, setTab]);
  const runAction = async (
    key: string,
    action: () => Promise<void>,
    success: string,
  ) => {
    setBusyAction(key);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "操作失敗，請再試一次",
      );
    } finally {
      setBusyAction(undefined);
    }
  };
  const saveProfile = async () => {
    const validation = profileInputSchema.safeParse(profile);
    if (!validation.success) {
      toast.error(validationMessage(validation.error));
      return;
    }
    await runAction(
      "profile",
      async () => {
        await repository.updateProfile({
          ...profile,
          ...validation.data,
          updatedAt: new Date().toISOString(),
        });
        await refresh();
      },
      mode === "demo-local"
        ? "專案資料已保存在這台裝置"
        : "專案資料已保存至校園雲端",
    );
  };
  const saveGovernance = async () => {
    const validation = governanceInputSchema.safeParse({
      privacyContact: profile.privacyContact ?? "",
      dataRetentionDays: profile.dataRetentionDays,
      governanceReviewedAt: profile.governanceReviewedAt ?? "",
    });
    if (!validation.success) {
      toast.error(validationMessage(validation.error));
      return;
    }
    await runAction(
      "governance",
      async () => {
        await repository.updateProfile({
          ...profile,
          ...validation.data,
          updatedAt: new Date().toISOString(),
        });
        await refresh();
      },
      "資料治理規則已記錄，可先預覽到期餐盤證據",
    );
  };
  const ensureUniqueClassName = (value: SchoolClass) => {
    const normalized = value.name.trim().toLocaleLowerCase("zh-TW");
    if (
      snapshot.classes.some(
        (item) =>
          item.id !== value.id &&
          item.name.trim().toLocaleLowerCase("zh-TW") === normalized,
      )
    )
      throw new Error("班級名稱不可重複");
  };
  const saveClass = async (value: SchoolClass) => {
    const validation = classInputSchema.safeParse(value);
    if (!validation.success) {
      toast.error(validationMessage(validation.error));
      return;
    }
    if (
      !validation.data.active &&
      snapshot.classes.filter((item) => item.active).length <= 1 &&
      snapshot.classes.find((item) => item.id === value.id)?.active
    ) {
      toast.error("至少保留一個使用中班級，才能繼續新增餐期");
      return;
    }
    await runAction(
      `class-${value.id}`,
      async () => {
        const schoolClass = { ...value, ...validation.data };
        ensureUniqueClassName(schoolClass);
        await repository.upsertClass(schoolClass);
        await refresh();
      },
      validation.data.active
        ? `${validation.data.name} 已更新`
        : `${validation.data.name} 已停用，歷史紀錄仍保留`,
    );
  };
  const createClass = async () => {
    const schoolClass: SchoolClass = {
      id: createUuid(),
      name: newClass.name,
      grade: newClass.grade,
      active: true,
    };
    const validation = classInputSchema.safeParse(schoolClass);
    if (!validation.success) {
      toast.error(validationMessage(validation.error));
      return;
    }
    await runAction(
      "class-new",
      async () => {
        ensureUniqueClassName(schoolClass);
        await repository.upsertClass({ ...schoolClass, ...validation.data });
        setNewClass({ name: "", grade: 5 });
        await refresh();
      },
      `${validation.data.name} 已建立，可立即用於掃描與紀錄`,
    );
  };
  const saveSettings = async () => {
    const validation = settingsInputSchema.safeParse({
      ...settings,
      sourceTitle: settings.sourceTitle?.trim() || undefined,
      sourceUrl: settings.sourceUrl?.trim() || undefined,
      retrievedAt: settings.retrievedAt || undefined,
    });
    if (!validation.success) {
      toast.error(validationMessage(validation.error));
      return;
    }
    await runAction(
      "settings",
      async () => {
        await repository.updateSettings({
          ...settings,
          ...validation.data,
          sourceTitle: validation.data.sourceTitle || undefined,
          sourceUrl: validation.data.sourceUrl || undefined,
          retrievedAt: validation.data.retrievedAt || undefined,
          updatedAt: new Date().toISOString(),
        });
        await refresh();
      },
      "估算係數已更新，全站即時套用",
    );
  };
  const saveSection = async () => {
    const section = snapshot.researchSections.find(
      (item) => item.id === sectionId,
    );
    if (!section) {
      toast.error("找不到這個研究章節");
      return;
    }
    if (sectionBody.trim().length < 20) {
      toast.error("研究章節至少需要 20 個字");
      return;
    }
    await runAction(
      "research",
      async () => {
        await repository.updateResearchSection({
          ...section,
          bodyMarkdown: sectionBody.trim(),
          updatedAt: new Date().toISOString(),
        });
        await refresh();
      },
      "研究章節已更新",
    );
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    if (mode !== "demo-local") {
      toast.error("整份 JSON 還原只開放此裝置示範模式");
      return;
    }
    await runAction(
      "import-backup",
      async () => {
        if (file.size > MAX_BACKUP_BYTES)
          throw new Error("備份檔超過 200MB，為保護瀏覽器已停止匯入");
        const value = await parseFoodLensBackup(await file.text());
        await repository.replaceSnapshot(value);
        await refresh();
      },
      "JSON 完整備份已匯入，圖片與修正資料皆已復原",
    );
  };
  const exportBackup = async () => {
    await runAction(
      "export-backup",
      async () => {
        // Cloud image URLs are intentionally short-lived. Refresh the snapshot
        // at export time so a teacher never receives a JSON file with expired
        // or silently omitted plate evidence.
        const exportSnapshot =
          mode === "school-cloud" ? await repository.getSnapshot() : snapshot;
        const unavailableCloudImage = exportSnapshot.scans.find(
          (scan) => scan.imagePath && !scan.imageUrl && !scan.imageBlob,
        );
        if (unavailableCloudImage)
          throw new Error(
            `餐盤 ${unavailableCloudImage.id} 的私有圖片授權失敗；請重新連線後再下載，避免產生不完整備份。`,
          );
        download(
          "foodlens-complete-backup-v1.json",
          await serializeFoodLensBackup(exportSnapshot),
          "application/json",
        );
      },
      "完整備份已下載",
    );
  };
  const importCsv = async (file?: File) => {
    if (!file) return;
    await runAction(
      "import-csv",
      async () => {
        if (file.size > 10 * 1024 * 1024)
          throw new Error("CSV 檔超過 10MB，請先分批整理");
        const records = parseMealRecordsCsv(
          await file.text(),
          snapshot.classes,
        );
        const count = await repository.importMealRecords(records);
        await refresh();
        toast.message(
          `已驗證 ${count} 筆餐期；已有餐盤判讀的餐期不允許改寫核心證據。`,
        );
      },
      "CSV 餐期資料已匯入",
    );
  };
  const reset = async () => {
    if (mode !== "demo-local") {
      toast.error("校園雲端資料不能用示範資料重設功能處理");
      return;
    }
    if (!armReset) {
      setArmReset(true);
      window.setTimeout(() => setArmReset(false), 8000);
      return;
    }
    await runAction(
      "reset",
      async () => {
        await repository.resetDemo();
        await Promise.all([
          clearScanDrafts("demo-local"),
          clearWorkflowDrafts("demo-local"),
        ]);
        await refresh();
        setArmReset(false);
      },
      "已重建固定版本的 48 筆示範資料，並清除未完成草稿",
    );
  };
  const restoreRecovery = async () => {
    if (mode !== "demo-local" || !repository.restoreRecovery) {
      toast.error("目前資料模式沒有可還原的示範快照");
      return;
    }
    await runAction(
      "restore-recovery",
      async () => {
        const restored = await repository.restoreRecovery!();
        if (!restored) throw new Error("目前沒有上次重設或整份匯入前的資料");
        await refresh();
      },
      "已還原上次操作前的餐期、餐盤圖片與研究內容",
    );
  };
  const sendMagicLink = async () => {
    const parsedEmail = teacherEmailSchema.safeParse(email);
    if (!parsedEmail.success) {
      setAuthError(parsedEmail.error.issues[0]?.message ?? "請檢查教師 Email");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("請先在 .env.local 設定 Supabase");
      return;
    }
    setAuthError(undefined);
    setAuthSending(true);
    try {
      const client = createSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOtp({
        email: parsedEmail.data,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      toast.success("登入連結已寄出，請查看信箱");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "寄送失敗");
    } finally {
      setAuthSending(false);
    }
  };
  const switchDataMode = async () => {
    try {
      await setMode(mode === "demo-local" ? "school-cloud" : "demo-local");
      toast.success(
        mode === "demo-local" ? "已切換到校園記錄" : "已回到此裝置示範模式",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切換失敗");
    }
  };
  const signOutAndReturnToDemo = async () => {
    await runAction(
      "cloud-sign-out",
      async () => {
        const client = createSupabaseBrowserClient();
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) throw error;
        await setMode("demo-local");
      },
      "已登出教師帳號，並回到此裝置示範模式",
    );
  };
  const initializeCloudWorkspace = async () => {
    if (mode !== "school-cloud" || !repository.initializeSchoolWorkspace) {
      toast.error("請先完成教師登入並連線校園資料");
      return;
    }
    await runAction(
      "cloud-bootstrap",
      async () => {
        await repository.initializeSchoolWorkspace!(createDemoSnapshot());
        await refresh();
      },
      "已建立班級、研究章節與估算設定範本",
    );
  };
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="教師管理"
        title="把示範作品轉成可長期研究的校園工具"
        description="研究文字、估算假設、不收集姓名／學號的班級層級資料與雲端登入集中管理；公開訪客預設只能操作自己的示範資料。"
        icon={Settings2}
      />
      <div className="admin-tabs" role="tablist" aria-label="教師管理區段">
        {tabs.map(([id, label, Icon], index) => (
          <button
            id={`admin-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`admin-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            key={id}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      {tabs
        .filter(([id]) => id !== tab)
        .map(([id]) => (
          <div
            id={`admin-panel-${id}`}
            role="tabpanel"
            aria-labelledby={`admin-tab-${id}`}
            hidden
            key={id}
          />
        ))}
      <div
        id={`admin-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${tab}`}
      >
        {tab === "launch" && (
          <>
            <section className="launch-overview" aria-labelledby="launch-title">
              <div className="launch-overview-copy">
                <span className="launch-kicker">
                  {mode === "demo-local" ? "此裝置示範沙盒" : "校園私有工作區"}
                </span>
                <h2 id="launch-title">
                  {readiness.schoolReady
                    ? "基本資料已備齊，仍需校方核准與校園雲端驗證"
                    : "展示已可操作，正式蒐集仍有待辦"}
                </h2>
                <p>
                  把「比賽現場能展示」與「學校真的能長期使用」分開檢查。完成下列項目後，再開始蒐集實際餐盤與班級秤重。
                </p>
                <div className="launch-state-row">
                  <span className={readiness.demoReady ? "ready" : "pending"}>
                    <Check size={14} />
                    Live Demo {demoStatusLabel}
                  </span>
                  <span className={readiness.schoolReady ? "ready" : "pending"}>
                    <ShieldCheck size={14} />
                    校園基本設定 {readiness.readyCount}/{readiness.totalCount}
                  </span>
                </div>
                <p role="status" aria-live="polite">
                  {readiness.judgePreflight.draftStatus === "checking"
                    ? "正在唯讀檢查此工作區的掃描與午餐任務草稿。"
                    : readiness.judgePreflight.draftStatus === "unavailable"
                      ? "本機草稿目前無法讀取，不能視為零份；請重新整理後再檢查。既有草稿不會被清除。"
                      : readiness.judgePreflight.draftStatus === "blocked"
                        ? `未完成掃描 ${readiness.judgePreflight.pendingScanDraftCount ?? 0} 份、午餐任務 ${readiness.judgePreflight.pendingWorkflowDraftCount ?? 0} 份；請先處理或在簡報入口明確選擇預覽。`
                        : readiness.demoReady
                          ? mode === "demo-local"
                            ? "正式身分、固定示範證據與未完成草稿檢查已通過；模擬資料仍維持示範標示。"
                            : "正式身分與未完成草稿檢查已通過；校園資料沿用每筆來源標示，不把展示預檢當成研究成果驗證。"
                          : "本機沒有未完成草稿；請至簡報入口確認正式身分與展示證據。"}{" "}
                  <Link href="/presentation">查看完整展示預檢</Link>
                </p>
              </div>
              <div
                className="readiness-dial"
                style={
                  {
                    "--readiness-score": `${readiness.score * 3.6}deg`,
                    "--readiness-percent": `${readiness.score}%`,
                  } as CSSProperties
                }
                aria-label={`校園基本設定完成度 ${readiness.score}%`}
              >
                <div>
                  <strong>{readiness.score}%</strong>
                  <span>基本設定</span>
                </div>
              </div>
            </section>
            <div className="launch-grid">
              <Panel className="readiness-checklist">
                <PanelTitle
                  kicker="上線前檢查"
                  title="六項基本設定檢查"
                  note="基本設定完成後，仍需在校園雲端完成私有圖片與權限驗證，並由校方核准正式蒐集。"
                />
                <div className="readiness-list">
                  {readiness.checks.map((check, index) => (
                    <article
                      className={check.ready ? "ready" : ""}
                      key={check.id}
                    >
                      <span className="readiness-index" aria-hidden="true">
                        {check.ready ? <Check size={15} /> : index + 1}
                      </span>
                      <div>
                        <strong>{check.title}</strong>
                        <p>{check.detail}</p>
                      </div>
                      <button onClick={() => setTab(check.destination)}>
                        {check.ready ? "檢視" : check.actionLabel}
                        <ArrowRight size={14} />
                      </button>
                    </article>
                  ))}
                </div>
              </Panel>
              <div className="launch-side">
                <Panel className="next-action-card">
                  <span>建議下一步</span>
                  <h2>
                    {readiness.nextCheck?.title ?? "完成校園雲端驗證與校方核准"}
                  </h2>
                  <p>
                    {readiness.nextCheck?.detail ??
                      "基本資料檢查已通過。請再確認私有圖片讀寫、教師權限與校方核准，完成後才開始正式蒐集。"}
                  </p>
                  {readiness.nextCheck ? (
                    <button
                      className="primary-action full"
                      onClick={() => setTab(readiness.nextCheck!.destination)}
                    >
                      {readiness.nextCheck.actionLabel}
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      className="primary-action full"
                      onClick={() => setTab("cloud")}
                    >
                      前往校園雲端驗證
                      <ArrowRight size={16} />
                    </button>
                  )}
                </Panel>
                <Panel className="launch-health-card">
                  <PanelTitle kicker="目前環境" title="可用性與資料邊界" />
                  <dl>
                    <div>
                      <dt>資料位置</dt>
                      <dd>
                        {mode === "demo-local"
                          ? "本機 IndexedDB"
                          : "校園 Supabase"}
                      </dd>
                    </div>
                    <div>
                      <dt>餐期／餐盤</dt>
                      <dd>
                        {snapshot.meals.length}／{snapshot.scans.length} 筆
                      </dd>
                    </div>
                    <div>
                      <dt>離線展示</dt>
                      <dd>Mock 分析可用</dd>
                    </div>
                    <div>
                      <dt>正式資料</dt>
                      <dd>
                        {mode === "school-cloud" ? "教師登入保護" : "尚未連線"}
                      </dd>
                    </div>
                  </dl>
                  <p>
                    正式上線前仍需依主辦規定確認公開部署時機；Preview 保持
                    noindex，不把模擬數據當成研究成果。
                  </p>
                </Panel>
              </div>
            </div>
          </>
        )}
        {tab === "project" && (
          <Panel>
            <PanelTitle
              kicker="專案識別"
              title="團隊與研究資訊"
              note="儲存後，專案名稱與副標題會顯示在首頁與專題研究頁。"
            />
            <div className="form-grid two">
              <label>
                <span>專案名稱</span>
                <input
                  value={profile.projectName}
                  onChange={(e) =>
                    setProfile({ ...profile, projectName: e.target.value })
                  }
                />
              </label>
              <label>
                <span>副標題</span>
                <input
                  value={profile.subtitle}
                  onChange={(e) =>
                    setProfile({ ...profile, subtitle: e.target.value })
                  }
                />
              </label>
              <label>
                <span>學校名稱</span>
                <input
                  value={profile.schoolName}
                  onChange={(e) =>
                    setProfile({ ...profile, schoolName: e.target.value })
                  }
                />
              </label>
              <label>
                <span>團隊名稱</span>
                <input
                  value={profile.teamName}
                  onChange={(e) =>
                    setProfile({ ...profile, teamName: e.target.value })
                  }
                />
              </label>
              <label>
                <span>團隊成員（匿名或依規定）</span>
                <input
                  value={profile.teamMembers}
                  onChange={(e) =>
                    setProfile({ ...profile, teamMembers: e.target.value })
                  }
                />
              </label>
              <label>
                <span>研究期間</span>
                <input
                  value={profile.researchPeriod}
                  onChange={(e) =>
                    setProfile({ ...profile, researchPeriod: e.target.value })
                  }
                />
              </label>
              <label className="span-2">
                <span>AI 使用揭露</span>
                <textarea
                  rows={4}
                  value={profile.aiDisclosure}
                  onChange={(e) =>
                    setProfile({ ...profile, aiDisclosure: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="button-row end">
              <button
                className="primary-action"
                disabled={busyAction === "profile"}
                onClick={() => void saveProfile()}
              >
                <Save size={17} />
                {busyAction === "profile" ? "儲存中…" : "儲存專案資料"}
              </button>
            </div>
          </Panel>
        )}
        {tab === "classes" && (
          <div className="class-admin-layout">
            <Panel>
              <PanelTitle
                kicker="研究範圍"
                title="班級管理"
                note="停用只會阻止新增餐期，不會刪除既有量測、餐盤或修正軌跡。"
              />
              <div className="class-list">
                {classDrafts.map((schoolClass) => {
                  const mealCount = snapshot.meals.filter(
                    (meal) => meal.classId === schoolClass.id,
                  ).length;
                  const isBusy = busyAction === `class-${schoolClass.id}`;
                  return (
                    <article
                      className={schoolClass.active ? "" : "inactive"}
                      key={schoolClass.id}
                    >
                      <div className="class-fields">
                        <label>
                          <span>班級名稱</span>
                          <input
                            value={schoolClass.name}
                            onChange={(event) =>
                              setClassDrafts((items) =>
                                items.map((item) =>
                                  item.id === schoolClass.id
                                    ? { ...item, name: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>年級</span>
                          <select
                            value={schoolClass.grade}
                            onChange={(event) =>
                              setClassDrafts((items) =>
                                items.map((item) =>
                                  item.id === schoolClass.id
                                    ? {
                                        ...item,
                                        grade: Number(event.target.value) as
                                          5 | 6,
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            <option value="5">五年級</option>
                            <option value="6">六年級</option>
                          </select>
                        </label>
                      </div>
                      <div className="class-meta">
                        <span
                          className={schoolClass.active ? "active" : "archived"}
                        >
                          {schoolClass.active ? "使用中" : "已停用"}
                        </span>
                        <small>{mealCount} 筆歷史餐期</small>
                      </div>
                      <div className="class-actions">
                        <button
                          className="secondary-action"
                          disabled={isBusy}
                          onClick={() => void saveClass(schoolClass)}
                        >
                          <Save size={15} />
                          {isBusy ? "儲存中…" : "儲存"}
                        </button>
                        <button
                          className="class-state-action"
                          disabled={isBusy}
                          onClick={() =>
                            void saveClass({
                              ...schoolClass,
                              active: !schoolClass.active,
                            })
                          }
                        >
                          {schoolClass.active ? "停用" : "重新啟用"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </Panel>
            <div className="class-admin-side">
              <Panel className="new-class-card">
                <PanelTitle kicker="新增研究單位" title="建立班級" />
                <label>
                  <span>班級名稱</span>
                  <input
                    value={newClass.name}
                    placeholder="例如：五年三班"
                    onChange={(event) =>
                      setNewClass({ ...newClass, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>年級</span>
                  <select
                    value={newClass.grade}
                    onChange={(event) =>
                      setNewClass({
                        ...newClass,
                        grade: Number(event.target.value) as 5 | 6,
                      })
                    }
                  >
                    <option value="5">五年級</option>
                    <option value="6">六年級</option>
                  </select>
                </label>
                <button
                  className="primary-action full"
                  disabled={busyAction === "class-new"}
                  onClick={() => void createClass()}
                >
                  <Plus size={17} />
                  {busyAction === "class-new" ? "建立中…" : "建立並啟用班級"}
                </button>
              </Panel>
              <Panel className="class-policy-card">
                <Users size={24} />
                <h2>只記錄班級，不記錄學生身分</h2>
                <p>
                  FoodLens
                  的研究單位是「班級餐期」與匿名餐盤。班級名稱不得放入座號、姓名或可回推個人的標記。
                </p>
                <ul>
                  <li>新增：可立即出現在掃描與篩選。</li>
                  <li>停用：保留歷史，不再接受新餐期。</li>
                  <li>不提供刪除：避免研究證據鏈被意外破壞。</li>
                </ul>
              </Panel>
            </div>
          </div>
        )}
        {tab === "governance" && (
          <div className="governance-layout">
            <Panel>
              <PanelTitle
                kicker="正式蒐集前必填"
                title="資料治理與拍攝規則"
                note="這裡記錄責任與期限；不會宣稱系統已代替學校完成法規判斷。"
              />
              <div className="form-grid two">
                <label>
                  <span>資料負責人／角色</span>
                  <input
                    value={profile.privacyContact ?? ""}
                    placeholder="例如：午餐秘書或指導教師"
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        privacyContact: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>餐盤原始證據保存期限（天）</span>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    value={profile.dataRetentionDays ?? 180}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        dataRetentionDays: Number(event.target.value),
                        governanceReviewedAt: undefined,
                      })
                    }
                  />
                </label>
              </div>
              <label className="governance-confirmation">
                <input
                  type="checkbox"
                  checked={Boolean(profile.governanceReviewedAt)}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      governanceReviewedAt: event.target.checked
                        ? new Date().toISOString()
                        : undefined,
                    })
                  }
                />
                <span>
                  <strong>我已檢查拍攝與資料處理規則</strong>
                  <small>
                    餐盤照片不得含人臉、姓名、學號或座號；只有授權教師可處理正式校園資料，並依上方期限定期檢視與刪除。
                  </small>
                </span>
              </label>
              <div className="button-row end">
                <button
                  className="primary-action"
                  disabled={busyAction === "governance"}
                  onClick={() => void saveGovernance()}
                >
                  <ShieldCheck size={17} />
                  {busyAction === "governance" ? "儲存中…" : "記錄治理確認"}
                </button>
              </div>
            </Panel>
            <Panel className="governance-ledger">
              <span>資料生命週期</span>
              <ol>
                <li>
                  <strong>拍攝前</strong>
                  <p>清除可識別學生的資訊，只拍餐盤與食物。</p>
                </li>
                <li>
                  <strong>分析中</strong>
                  <p>保留 AI 原始值；學生修正另存，不覆蓋原判讀。</p>
                </li>
                <li>
                  <strong>研究期間</strong>
                  <p>只以班級與日期比較，公開展示一律使用去識別資料。</p>
                </li>
                <li>
                  <strong>期限到達</strong>
                  <p>先匯出必要研究證據，再由負責人依校規檢視或刪除圖片。</p>
                </li>
              </ol>
              <div className="governance-note">
                <ShieldCheck size={18} />
                <p>
                  系統不會排程自動刪除。每次都要先預覽，再由管理員明確確認；正式圖片先經
                  Storage API 處理，資料庫才清除判讀。
                </p>
              </div>
            </Panel>
            <DataRetentionManager
              repository={repository}
              mode={mode}
              retentionDays={profile.dataRetentionDays ?? 180}
              schoolName={profile.schoolName}
              policySaved={
                Boolean(profile.governanceReviewedAt) &&
                profile.dataRetentionDays ===
                  snapshot.profile.dataRetentionDays &&
                profile.governanceReviewedAt ===
                  snapshot.profile.governanceReviewedAt
              }
              onCompleted={refresh}
            />
          </div>
        )}
        {tab === "research" && (
          <div className="admin-editor">
            <Panel>
              <PanelTitle
                kicker="研究內容編輯（Markdown）"
                title="研究章節"
                note="公開頁只顯示已發布章節。"
              />
              <label>
                <span>選擇章節</span>
                <select
                  value={sectionId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSectionId(next);
                    setSectionBody(
                      snapshot.researchSections.find((item) => item.id === next)
                        ?.bodyMarkdown ?? "",
                    );
                  }}
                >
                  {[...snapshot.researchSections]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>內容</span>
                <textarea
                  className="markdown-editor"
                  value={sectionBody}
                  onChange={(e) => setSectionBody(e.target.value)}
                />
              </label>
              <button
                className="primary-action"
                disabled={busyAction === "research"}
                onClick={() => void saveSection()}
              >
                <Save size={17} />
                {busyAction === "research" ? "儲存中…" : "儲存章節"}
              </button>
            </Panel>
            <Panel className="markdown-preview">
              <PanelTitle
                kicker="即時預覽"
                title={
                  snapshot.researchSections.find(
                    (item) => item.id === sectionId,
                  )?.title ?? "章節"
                }
              />
              <ReactMarkdown>{sectionBody}</ReactMarkdown>
            </Panel>
          </div>
        )}
        {tab === "settings" && (
          <Panel>
            <PanelTitle
              kicker="永續估算設定"
              title="成本與全校情境假設"
              note="所有係數都會在永續影響頁公開，不藏在程式裡。"
            />
            <div className="form-grid two">
              <label>
                <span>示範成本（NT$/kg）</span>
                <input
                  type="number"
                  min="0"
                  value={settings.costTwdPerKg}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      costTwdPerKg: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>全校每日剩食基準（g）</span>
                <input
                  type="number"
                  min="0"
                  value={settings.schoolDailyBaselineG}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      schoolDailyBaselineG: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>每週供餐日</span>
                <input
                  type="number"
                  min="1"
                  max="7"
                  value={settings.schoolDaysPerWeek}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      schoolDaysPerWeek: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>每學期週數</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.weeksPerSemester}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      weeksPerSemester: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>每學年學期數</span>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={settings.semestersPerYear}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      semestersPerYear: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>碳排係數</span>
                <input disabled value="未啟用：等待可追溯來源" />
              </label>
              <label className="span-2">
                <span>全校剩食基準來源名稱</span>
                <input
                  value={settings.sourceTitle ?? ""}
                  placeholder="例如：本校 2026/09 午餐廚餘秤重紀錄"
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sourceTitle: e.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="span-2">
                <span>來源網址（若有）</span>
                <input
                  type="url"
                  value={settings.sourceUrl ?? ""}
                  placeholder="https://…"
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sourceUrl: e.target.value || undefined,
                    })
                  }
                />
              </label>
              <label>
                <span>來源取得／量測日期</span>
                <input
                  type="date"
                  value={settings.retrievedAt?.slice(0, 10) ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      retrievedAt: e.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="span-2">
                <span>估算聲明</span>
                <textarea
                  rows={3}
                  value={settings.disclaimer}
                  onChange={(e) =>
                    setSettings({ ...settings, disclaimer: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="button-row end">
              <button
                className="primary-action"
                disabled={busyAction === "settings"}
                onClick={() => void saveSettings()}
              >
                <Save size={17} />
                {busyAction === "settings" ? "套用中…" : "套用全站係數"}
              </button>
            </div>
          </Panel>
        )}
        {tab === "data" && (
          <div className="admin-data-grid">
            <Panel>
              <PanelTitle
                kicker="可攜資料"
                title="匯出與還原"
                note={
                  mode === "demo-local"
                    ? "完整備份會連同學生上傳圖片一起封裝；CSV 可跨示範模式與校園雲端匯入。"
                    : "校園雲端可匯入餐期 CSV；整份 JSON 還原為保護正式資料而關閉。"
                }
              />
              <div className="data-actions">
                <button
                  disabled={busyAction === "export-backup"}
                  onClick={() => void exportBackup()}
                >
                  <FileJson />
                  <span>
                    <strong>
                      {busyAction === "export-backup"
                        ? "正在封裝圖片…"
                        : "下載 JSON 完整備份"}
                    </strong>
                    <small>
                      含餐期、圖片 Blob、原始判讀、修正、設定與研究內容
                    </small>
                  </span>
                  <Download />
                </button>
                <button
                  onClick={() =>
                    download(
                      "foodlens-meal-records.csv",
                      serializeMealRecordsCsv(snapshot),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <FileText />
                  <span>
                    <strong>下載 CSV 餐期資料</strong>
                    <small>含人數、量測方式、備註與完整稽核欄位</small>
                  </span>
                  <Download />
                </button>
                <label
                  className={`file-action${mode !== "demo-local" ? " disabled" : ""}`}
                  aria-disabled={mode !== "demo-local"}
                >
                  <Upload />
                  <span>
                    <strong>
                      {busyAction === "import-backup"
                        ? "正在驗證與還原…"
                        : "匯入 JSON 完整備份"}
                    </strong>
                    <small>
                      {mode === "demo-local"
                        ? "驗證版本與資料關聯後，取代目前示範資料沙盒"
                        : "校園模式禁止整庫覆寫"}
                    </small>
                  </span>
                  <input
                    type="file"
                    disabled={mode !== "demo-local" || Boolean(busyAction)}
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void importBackup(file);
                    }}
                  />
                </label>
                <label className="file-action">
                  <Upload />
                  <span>
                    <strong>
                      {busyAction === "import-csv"
                        ? "正在驗證餐期…"
                        : "匯入 CSV 餐期資料"}
                    </strong>
                    <small>
                      先檢查班級、日期、人數、重量與餐盤證據，通過才寫入
                    </small>
                  </span>
                  <input
                    type="file"
                    disabled={Boolean(busyAction)}
                    accept="text/csv,.csv"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void importCsv(file);
                    }}
                  />
                </label>
              </div>
            </Panel>
            <Panel className="danger-panel">
              <Undo2 size={26} />
              <h2>復原上次整份操作</h2>
              <p>
                {recoveryMetadata
                  ? `已保留 ${recoveryMetadata.mealCount} 筆餐期、${recoveryMetadata.scanCount} 份餐盤與圖片，可還原上次重設或 JSON 匯入前的狀態。`
                  : "完成一次重設或 JSON 匯入後，這裡會保留上一份資料供立即復原。"}
              </p>
              <button
                className="secondary-action full"
                disabled={
                  mode !== "demo-local" ||
                  !recoveryMetadata ||
                  busyAction === "restore-recovery"
                }
                onClick={() => void restoreRecovery()}
              >
                <Undo2 size={17} />
                {busyAction === "restore-recovery"
                  ? "正在還原…"
                  : recoveryMetadata
                    ? "還原上次操作前資料"
                    : "目前沒有可還原資料"}
              </button>
              {recoveryMetadata?.savedAt && (
                <small>
                  保留時間：
                  {new Date(recoveryMetadata.savedAt).toLocaleString("zh-TW")}
                </small>
              )}
              <hr />
              <RotateCcw size={26} />
              <h2>重設示範資料</h2>
              <p>
                只會重設目前瀏覽器，不會影響其他訪客。重設後恢復固定 48
                筆餐期、96
                份掃描與研究內容，並清除未完成的示範掃描與午餐任務草稿。
              </p>
              <button
                className={armReset ? "danger armed" : "danger"}
                disabled={mode !== "demo-local" || busyAction === "reset"}
                onClick={() => void reset()}
              >
                {mode !== "demo-local"
                  ? "校園資料不可重設"
                  : busyAction === "reset"
                    ? "正在重建…"
                    : armReset
                      ? "再按一次確認重設"
                      : "準備重設示範資料"}
              </button>
              {armReset && <small>8 秒後自動取消</small>}
            </Panel>
          </div>
        )}
        {tab === "cloud" && (
          <div className="cloud-layout">
            <SchoolActivationHandoff
              schoolName={snapshot.profile.schoolName}
              supabaseConfigured={isSupabaseConfigured()}
              cloudConnected={mode === "school-cloud"}
              storageEvidence={storageEvidence}
              hasRealAiEvidence={hasRealAiEvidence}
            />
            <Panel>
              <PanelTitle
                kicker="校園雲端"
                title="教師 Email Magic Link"
                note={
                  isSupabaseConfigured()
                    ? "Supabase 已設定，可寄送登入連結。"
                    : "目前零環境變數，完整示範模式仍可操作。"
                }
              />
              <div className="cloud-status">
                <span className={isSupabaseConfigured() ? "ready" : "local"} />
                <div>
                  <strong>
                    {mode === "school-cloud"
                      ? "目前使用校園記錄"
                      : isSupabaseConfigured()
                        ? "校園雲端連線已設定"
                        : "目前使用此裝置示範模式"}
                  </strong>
                  <p>
                    正式校園資料與示範資料完全隔離；匿名公開訪客沒有正式資料表權限。
                  </p>
                </div>
              </div>
              {mode === "school-cloud" &&
                (snapshot.classes.length === 0 ||
                  snapshot.researchSections.length === 0) && (
                  <div className="privacy-callout">
                    <Database size={20} />
                    <div>
                      <strong>這個校園工作區還沒有初始資料</strong>
                      <p>
                        可建立四個五／六年級班級、十個可編輯研究章節與估算設定；不會匯入
                        48 筆示範餐期或 96 份示範掃描。
                      </p>
                      <button
                        className="secondary-action mt-2"
                        disabled={busyAction === "cloud-bootstrap"}
                        onClick={() => void initializeCloudWorkspace()}
                      >
                        <Database size={16} />
                        {busyAction === "cloud-bootstrap"
                          ? "建立中…"
                          : "建立校園工作區範本"}
                      </button>
                    </div>
                  </div>
                )}
              <form
                className="cloud-auth-form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMagicLink();
                }}
              >
                <label>
                  <span>教師 Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setAuthError(undefined);
                    }}
                    placeholder="teacher@school.edu.tw"
                    autoComplete="email"
                    required
                    aria-invalid={Boolean(authError)}
                    aria-describedby="teacher-email-hint teacher-email-error"
                  />
                  <small id="teacher-email-hint" className="cloud-auth-hint">
                    只允許已由 Supabase 專案管理員建立的教師帳號；輸入新 Email
                    不會自動建立使用者或取得校園權限。
                  </small>
                  <small
                    id="teacher-email-error"
                    className="cloud-auth-error"
                    role={authError ? "alert" : undefined}
                  >
                    {authError}
                  </small>
                </label>
                <button
                  type="submit"
                  className="primary-action full"
                  disabled={!email.trim() || authSending}
                >
                  <LogIn size={17} />
                  {authSending ? "寄送中…" : "寄送登入連結"}
                </button>
              </form>
              <button
                className="secondary-action full mt-2"
                disabled={busyAction === "cloud-sign-out"}
                onClick={() =>
                  void (mode === "demo-local"
                    ? switchDataMode()
                    : signOutAndReturnToDemo())
                }
              >
                {mode === "demo-local"
                  ? "登入後連線校園資料"
                  : busyAction === "cloud-sign-out"
                    ? "登出中…"
                    : "登出教師帳號並返回此裝置示範模式"}
              </button>
            </Panel>
            <Panel className="cloud-principles">
              <Cloud size={28} />
              <h2>為什麼不讓所有人共用一份公開資料？</h2>
              <ul>
                <li>評審與學生可自由操作自己的示範資料，不會互相破壞。</li>
                <li>真實餐期需要教師登入與同校權限隔離。</li>
                <li>圖片存於 private bucket，只用短效 signed URL 讀取。</li>
                <li>Supabase 中斷不會讓比賽現場無法展示。</li>
              </ul>
              <code>
                NEXT_PUBLIC_SUPABASE_URL
                <br />
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
              </code>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
