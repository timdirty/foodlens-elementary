import type { AppSnapshot, DataMode } from "@/lib/types";
import { createDemoSnapshot } from "@/lib/seed";

export type ReadinessDestination =
  "project" | "classes" | "governance" | "settings" | "data" | "cloud";

export interface ReadinessCheck {
  id:
    | "identity"
    | "classes"
    | "measured-data"
    | "impact-source"
    | "governance"
    | "cloud";
  title: string;
  detail: string;
  ready: boolean;
  destination: ReadinessDestination;
  actionLabel: string;
}

export interface ProductReadiness {
  demoReady: boolean;
  schoolReady: boolean;
  readyCount: number;
  totalCount: number;
  score: number;
  checks: ReadinessCheck[];
  nextCheck?: ReadinessCheck;
  judgePreflight: JudgePreflight;
}

export interface JudgePreflightRuntime {
  /** Undefined means the browser-local draft store has not been inspected yet. */
  pendingScanDraftCount?: number;
  /** Undefined means the browser-local workflow draft store is still loading. */
  pendingWorkflowDraftCount?: number;
  scanDraftInspectionFailed?: boolean;
  workflowDraftInspectionFailed?: boolean;
}

export interface JudgePreflight {
  identityReady: boolean;
  fixedSeedReady: boolean;
  draftStatus: "checking" | "clear" | "blocked" | "unavailable";
  pendingDraftCount?: number;
  pendingScanDraftCount?: number;
  pendingWorkflowDraftCount?: number;
  ready: boolean;
}

const placeholderPattern =
  /示範|尚待|待填|請填|未設定|學生研究團隊|example|demo/i;

function isSpecificIdentity(value: string) {
  const normalized = value.trim();
  return normalized.length >= 2 && !placeholderPattern.test(normalized);
}

export function hasFormalProjectIdentity(snapshot: AppSnapshot) {
  return (
    isSpecificIdentity(snapshot.profile.schoolName) &&
    isSpecificIdentity(snapshot.profile.teamName) &&
    isSpecificIdentity(snapshot.profile.teamMembers)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Verifies the reproducible evidence set, while allowing teachers to replace
 * identity, research copy, assumptions and class display names.
 */
export function hasFixedDemoEvidence(snapshot: AppSnapshot) {
  const seeded = createDemoSnapshot();
  const evidenceKeys = [
    "meals",
    "scans",
    "detections",
    "corrections",
    "predictions",
    "experiments",
  ] as const;
  return evidenceKeys.every(
    (key) => stableJson(snapshot[key]) === stableJson(seeded[key]),
  );
}

export function evaluateJudgePreflight(
  snapshot: AppSnapshot,
  mode: DataMode,
  runtime: JudgePreflightRuntime = {},
): JudgePreflight {
  const identityReady = hasFormalProjectIdentity(snapshot);
  const fixedSeedReady =
    mode !== "demo-local" || hasFixedDemoEvidence(snapshot);
  const draftInspectionUnavailable =
    runtime.scanDraftInspectionFailed || runtime.workflowDraftInspectionFailed;
  const draftInspectionPending =
    runtime.pendingScanDraftCount === undefined ||
    runtime.pendingWorkflowDraftCount === undefined;
  const pendingDraftCount = draftInspectionPending
    ? undefined
    : runtime.pendingScanDraftCount! + runtime.pendingWorkflowDraftCount!;
  const draftStatus = draftInspectionUnavailable
    ? "unavailable"
    : draftInspectionPending
      ? "checking"
      : pendingDraftCount! > 0
        ? "blocked"
        : "clear";
  return {
    identityReady,
    fixedSeedReady,
    draftStatus,
    pendingDraftCount,
    pendingScanDraftCount: runtime.pendingScanDraftCount,
    pendingWorkflowDraftCount: runtime.pendingWorkflowDraftCount,
    ready: identityReady && fixedSeedReady && draftStatus === "clear",
  };
}

export function assessProductReadiness(
  snapshot: AppSnapshot,
  mode: DataMode,
  runtime: JudgePreflightRuntime = {},
): ProductReadiness {
  const judgePreflight = evaluateJudgePreflight(snapshot, mode, runtime);
  const activeClasses = snapshot.classes.filter((item) => item.active);
  const measuredMeals = snapshot.meals.filter(
    (meal) =>
      meal.source !== "demo" &&
      meal.measurementMethod === "scale" &&
      meal.totalSupplyG > 0,
  );
  const sourceTitle = snapshot.impactSettings.sourceTitle?.trim() ?? "";
  const hasTraceableImpactSource =
    sourceTitle.length >= 4 &&
    !placeholderPattern.test(sourceTitle) &&
    Boolean(snapshot.impactSettings.retrievedAt);
  const retentionDays = snapshot.profile.dataRetentionDays;
  const hasGovernance =
    Boolean(snapshot.profile.privacyContact?.trim()) &&
    Boolean(retentionDays && retentionDays >= 1 && retentionDays <= 3_650) &&
    Boolean(snapshot.profile.governanceReviewedAt);

  const checks: ReadinessCheck[] = [
    {
      id: "identity",
      title: "完成參賽與學校識別",
      detail: judgePreflight.identityReady
        ? `${snapshot.profile.schoolName}・${snapshot.profile.teamName}`
        : "把示範名稱換成實際學校、團隊與參賽成員。",
      ready: judgePreflight.identityReady,
      destination: "project",
      actionLabel: "填寫專案資料",
    },
    {
      id: "classes",
      title: "設定研究班級",
      detail: activeClasses.length
        ? `已有 ${activeClasses.length} 個使用中班級；停用班級仍保留歷史紀錄。`
        : "至少建立一個使用中班級，學生才可新增餐期。",
      ready: activeClasses.length > 0,
      destination: "classes",
      actionLabel: "管理班級",
    },
    {
      id: "measured-data",
      title: "建立第一筆實測基準",
      detail: measuredMeals.length
        ? `已有 ${measuredMeals.length} 筆非示範秤重餐期，可開始累積校園基準。`
        : "用磅秤記錄至少一筆真實供應量與剩食量；影像估計不能代替全班秤重。",
      ready: measuredMeals.length > 0,
      destination: "data",
      actionLabel: "匯入或開始量測",
    },
    {
      id: "impact-source",
      title: "補上永續估算來源",
      detail: hasTraceableImpactSource
        ? `${sourceTitle}（${snapshot.impactSettings.retrievedAt}）`
        : "把示範係數換成本校秤重紀錄，並填寫量測日期。",
      ready: hasTraceableImpactSource,
      destination: "settings",
      actionLabel: "設定資料來源",
    },
    {
      id: "governance",
      title: "確認隱私與保存規則",
      detail: hasGovernance
        ? `由 ${snapshot.profile.privacyContact?.trim()} 負責，資料保存 ${retentionDays} 天後重新檢視。`
        : "指定資料負責人、保存期限，並確認拍攝不含個資的作業規則。",
      ready: hasGovernance,
      destination: "governance",
      actionLabel: "完成資料治理",
    },
    {
      id: "cloud",
      title: "啟用校園私有工作區",
      detail:
        mode === "school-cloud"
          ? "目前已連線校園私有資料；公開訪客無法讀取。"
          : "正式蒐集前，以教師 Email 登入並確認同校權限隔離。",
      ready: mode === "school-cloud",
      destination: "cloud",
      actionLabel: "設定校園雲端",
    },
  ];
  const readyCount = checks.filter((item) => item.ready).length;
  const demoReady =
    judgePreflight.ready &&
    snapshot.meals.length > 0 &&
    snapshot.scans.length > 0 &&
    snapshot.researchSections.some((item) => item.isPublished);

  return {
    demoReady,
    schoolReady: readyCount === checks.length,
    readyCount,
    totalCount: checks.length,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    nextCheck: checks.find((item) => !item.ready),
    judgePreflight,
  };
}
