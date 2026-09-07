"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRight, Camera, ClipboardCheck, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { useFoodLens } from "@/components/data-provider";
import {
  DecisionStage,
  type DecisionDraft,
} from "@/components/workflow/decision-stage";
import { FeedbackStage } from "@/components/workflow/feedback-stage";
import { MenuStage } from "@/components/workflow/menu-stage";
import { WasteStage } from "@/components/workflow/waste-stage";
import { CulpritClueBoard } from "@/components/game/culprit-clue-board";
import { useGameMode } from "@/components/game/game-mode-context";
import { focusWorkflowStageHeading } from "@/components/workflow/workflow-step-accessibility";
import { useWorkflowAutosave } from "@/components/workflow/use-workflow-autosave";
import {
  WORKFLOW_STEPS,
  WorkflowRail,
} from "@/components/workflow/workflow-rail";
import { PageHeader, ErrorState, LoadingState } from "@/components/ui/page";
import {
  analyzeEvidenceCases,
  buildComparableEvidenceCohort,
  emptyReasonCounts,
  mealEvidenceCaseSchema,
  reasonCollectionIssue,
  type MealEvidenceCase,
} from "@/lib/evidence-chain";
import {
  confirmMenuVersion,
  getActualMenuDishes,
  importMenuVersion,
  recordMenuSubstitution,
  removeMenuSubstitution,
  updateDraftMenuDish,
  type AcceptedLowConfidence,
  type CookingMethod,
  type MenuDishRole,
  type MenuImportSource,
} from "@/lib/menu-intelligence";
import {
  menuPhotoSourceName,
  MockMenuOcrProvider,
  ServerMenuOcrProvider,
  type MenuOcrAnalysisMode,
} from "@/lib/menu-ocr";
import type {
  AppSnapshot,
  DataMode,
  FoodCategory,
  FoodLensRepository,
} from "@/lib/types";
import type { WasteMeasurement } from "@/lib/waste-intelligence";
import {
  deleteWorkflowDraftForCase,
  listWorkflowDraftSummaries,
  loadWorkflowDraftForCase,
  normalizeWorkflowCaseRequest,
  normalizeWorkflowDateRequest,
  workflowCaseBelongsToMode,
  type WorkflowDraft,
  type WorkflowDraftSummary,
} from "@/lib/workflow-draft";
import styles from "./workflow.module.css";

const LIVE_DEMO_CASE_ID = "workflow-live-demo";
const LIVE_DEMO_DATE = "2026-10-16";
const DEFAULT_CSV =
  "菜色名稱,角色,類別,烹調法,份量,食譜版本,供應商\n糙米飯,主食,米食,蒸,120,v2,示範供餐公司\n醬燒雞腿,主菜,肉類,滷,85,v3,示範供餐公司\n清炒高麗菜,配菜,蔬菜,炒,70,v4,示範供餐公司\n玉米蛋,配菜,蛋類,炒,55,v1,示範供餐公司\n芭樂,水果,水果類,生食,70,v1,示範供餐公司";
const DEFAULT_OCR =
  "臺北市校園午餐菜單\n主食：糙米飯\n主菜：醬燒雞腿\n副菜一：清炒高麗菜\n副菜二：玉米蛋\n水果：芭樂";

function workflowCaseId(
  mode: "demo-local" | "school-cloud",
  servedOn: string,
  classId: string,
) {
  if (
    mode === "demo-local" &&
    servedOn === LIVE_DEMO_DATE &&
    classId === "class-5a"
  )
    return LIVE_DEMO_CASE_ID;
  return `${mode === "demo-local" ? "workflow-demo" : "workflow"}-${servedOn}-${classId}`;
}

function auditTimestamp(current?: MealEvidenceCase) {
  const previous = current ? Date.parse(current.updatedAt) : 0;
  return new Date(Math.max(Date.now(), previous + 1_000)).toISOString();
}

function measurement(
  prefix: string,
  source: WasteMeasurement["source"],
  netG: number,
  foodCategory?: WasteMeasurement["foodCategory"],
): WasteMeasurement {
  const tareG = 300;
  return {
    id: `${prefix}-${source}-${foodCategory ?? "all"}`,
    source,
    grossG: tareG + netG,
    tareG,
    netG,
    drainage:
      source === "prep" || source === "liquid-contaminated"
        ? "wet"
        : "standard-drained",
    method: "scale",
    foodCategory,
  };
}

function emptyMeasurement(
  prefix: string,
  source: WasteMeasurement["source"],
  foodCategory?: WasteMeasurement["foodCategory"],
): WasteMeasurement {
  return {
    id: `${prefix}-${source}-${foodCategory ?? "all"}`,
    source,
    grossG: 0,
    tareG: 0,
    netG: 0,
    drainage:
      source === "prep" || source === "liquid-contaminated"
        ? "wet"
        : "standard-drained",
    method: "scale",
    foodCategory,
  };
}

function createWorkflowDraft(
  mode: "demo-local" | "school-cloud",
  classId: string,
  requestedServedOn?: string,
): MealEvidenceCase {
  const servedOn =
    requestedServedOn ??
    (mode === "demo-local"
      ? LIVE_DEMO_DATE
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()));
  const id = workflowCaseId(mode, servedOn, classId);
  const menuVersion = importMenuVersion([
    mode === "demo-local"
      ? {
          source: "demo" as const,
          menuId: `${id}-menu`,
          servedOn,
          fingerprint: "foodlens-live-judge-demo",
        }
      : {
          source: "structured" as const,
          menuId: `${id}-menu`,
          servedOn,
          sourceName: "教師建立的新餐期",
          importedAt: new Date().toISOString(),
          dishes: [
            { rawName: "待確認主食", role: "staple" as const },
            { rawName: "待確認主菜", role: "main" as const },
            { rawName: "待確認蔬菜", role: "side" as const },
          ],
        },
  ]);
  const createdAt =
    mode === "demo-local"
      ? `${servedOn}T05:00:00.000Z`
      : new Date().toISOString();
  const isDemo = mode === "demo-local";
  return {
    id,
    classId,
    servedOn,
    sourceKind: isDemo ? "demo" : "measured",
    menuVersion,
    plannedDiners: isDemo ? 28 : 0,
    actualDiners: isDemo ? 25 : 0,
    suppliedEdibleG: isDemo ? 7_000 : 0,
    observedDiners: isDemo ? 15 : 0,
    plateSampleSupplyG: isDemo ? 3_600 : 0,
    measurements: isDemo
      ? [
          measurement(id, "prep", 120),
          measurement(id, "unserved-edible", 820),
          measurement(id, "plate-edible", 620, "vegetable"),
          measurement(id, "plate-edible", 260, "meat"),
          measurement(id, "inedible", 180),
          measurement(id, "liquid-contaminated", 140),
        ]
      : [
          emptyMeasurement(id, "prep"),
          emptyMeasurement(id, "unserved-edible"),
          emptyMeasurement(id, "plate-edible", "vegetable"),
          emptyMeasurement(id, "inedible"),
          emptyMeasurement(id, "liquid-contaminated"),
        ],
    feedbackSchemaVersion: 2,
    reasonCollectionStatus:
      mode === "demo-local" ? "collected" : "not-collected",
    reasonCounts:
      mode === "demo-local"
        ? {
            portion: 5,
            taste: 3,
            texture: 4,
            temperature: 1,
            time: 1,
            other: 0,
          }
        : emptyReasonCounts(),
    teacherContext: {
      deliveryStatus: mode === "demo-local" ? "recorded" : "not-collected",
      temperatureStatus: mode === "demo-local" ? "recorded" : "not-collected",
      deliveryDelayMinutes: mode === "demo-local" ? 5 : null,
      temperatureConcern: mode === "demo-local" ? false : null,
      note:
        mode === "demo-local"
          ? "固定 Demo 情境：數字為模擬，不代表本校實測。"
          : "",
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function firstIssue(error: { issues: Array<{ message: string }> }) {
  return error.issues[0]?.message ?? "請檢查欄位內容";
}

export default function MealEvidenceWorkflowPage() {
  return (
    <Suspense fallback={<LoadingState label="正在準備午餐任務台…" />}>
      <MealEvidenceWorkflowRoute />
    </Suspense>
  );
}

interface WorkflowCaseOption {
  id: string;
  label: string;
  isDraft: boolean;
  isSaved: boolean;
}

function workflowCaseOptionLabel(
  evidenceCase: MealEvidenceCase,
  snapshot: AppSnapshot,
) {
  const classLabel =
    snapshot.classes.find((item) => item.id === evidenceCase.classId)?.name ??
    "未知班級";
  const menuLabel = getActualMenuDishes(evidenceCase.menuVersion)
    .slice(0, 2)
    .map((dish) => dish.normalizedName)
    .join("、");
  return `${evidenceCase.servedOn} · ${classLabel} · ${menuLabel || "菜單待確認"}`;
}

function MealEvidenceWorkflowRoute() {
  const { snapshot, loading, error, mode, repository, refresh } = useFoodLens();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRequestedCaseId = searchParams.get("case");
  const requestedCaseId = normalizeWorkflowCaseRequest(rawRequestedCaseId);
  const rawRequestedClassId = searchParams.get("class");
  const rawRequestedDate = searchParams.get("date");
  const requestedClassId = normalizeWorkflowCaseRequest(rawRequestedClassId);
  const requestedDate = normalizeWorkflowDateRequest(rawRequestedDate);
  const hasCreationContext = Boolean(rawRequestedClassId || rawRequestedDate);
  const [draftSummaries, setDraftSummaries] = useState<WorkflowDraftSummary[]>(
    [],
  );
  const [draftIndexError, setDraftIndexError] = useState<string>();

  const refreshDraftSummaries = useCallback(async () => {
    try {
      setDraftSummaries(await listWorkflowDraftSummaries(mode));
      setDraftIndexError(undefined);
    } catch {
      setDraftSummaries([]);
      setDraftIndexError("這個瀏覽器無法列出未完成草稿");
    }
  }, [mode]);

  useEffect(() => {
    let active = true;
    void listWorkflowDraftSummaries(mode)
      .then((summaries) => {
        if (!active) return;
        setDraftSummaries(summaries);
        setDraftIndexError(undefined);
      })
      .catch(() => {
        if (!active) return;
        setDraftSummaries([]);
        setDraftIndexError("這個瀏覽器無法列出未完成草稿");
      });
    return () => {
      active = false;
    };
  }, [mode]);

  const openCase = useCallback(
    (caseId: string) => {
      const normalized = normalizeWorkflowCaseRequest(caseId);
      if (!normalized) return;
      router.replace(`/workflow?case=${encodeURIComponent(normalized)}`, {
        scroll: false,
      });
    },
    [router],
  );

  const openNewCase = useCallback(
    (classId: string, servedOn: string) => {
      const caseId = workflowCaseId(mode, servedOn, classId);
      const params = new URLSearchParams({
        case: caseId,
        class: classId,
        date: servedOn,
      });
      router.replace(`/workflow?${params.toString()}`, { scroll: false });
    },
    [mode, router],
  );

  const notePersistedCase = useCallback(
    (caseId: string) => {
      if (caseId !== requestedCaseId || hasCreationContext) openCase(caseId);
    },
    [hasCreationContext, openCase, requestedCaseId],
  );

  if (loading && !snapshot) return <LoadingState label="正在準備午餐任務台…" />;
  if (!snapshot)
    return (
      <ErrorState
        title="午餐任務台尚未就緒"
        description={error ?? "目前無法讀取工作區資料，請稍後再試。"}
      />
    );

  const compatibleCases = snapshot.evidenceCases
    .filter((item) => workflowCaseBelongsToMode(mode, item))
    .sort(
      (left, right) =>
        right.servedOn.localeCompare(left.servedOn) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  const requestedSavedCase = requestedCaseId
    ? compatibleCases.find((item) => item.id === requestedCaseId)
    : undefined;
  const requestedDraftSummary = requestedCaseId
    ? draftSummaries.find((item) => item.caseId === requestedCaseId)
    : undefined;
  const activeClass = snapshot.classes.find((item) => item.active);
  const requestedClass = requestedClassId
    ? snapshot.classes.find(
        (item) => item.id === requestedClassId && item.active,
      )
    : undefined;
  const caseClass = snapshot.classes.find(
    (item) =>
      item.id ===
      (requestedSavedCase?.classId ??
        requestedDraftSummary?.classId ??
        requestedClass?.id),
  );
  const freshClass = caseClass ?? activeClass;
  if (!freshClass)
    return (
      <ErrorState
        title="午餐任務台尚未就緒"
        description="請先在教師管理建立至少一個使用中的班級，再開始記錄。"
        actions={
          <Link className="primary-button" href="/admin">
            前往教師管理 <ArrowRight size={15} />
          </Link>
        }
      />
    );

  const requestedNewCase =
    requestedCaseId &&
    requestedClass &&
    requestedDate &&
    requestedCaseId === workflowCaseId(mode, requestedDate, requestedClass.id)
      ? createWorkflowDraft(mode, requestedClass.id, requestedDate)
      : undefined;
  const freshCase = createWorkflowDraft(mode, freshClass.id);
  const defaultSavedCase = compatibleCases.find(
    (item) => item.id === freshCase.id,
  );
  const initialValue = structuredClone(
    requestedSavedCase ?? requestedNewCase ?? defaultSavedCase ?? freshCase,
  );
  const optionMap = new Map<string, WorkflowCaseOption>();
  compatibleCases.forEach((evidenceCase) => {
    optionMap.set(evidenceCase.id, {
      id: evidenceCase.id,
      label: workflowCaseOptionLabel(evidenceCase, snapshot),
      isDraft: draftSummaries.some((draft) => draft.caseId === evidenceCase.id),
      isSaved: true,
    });
  });
  draftSummaries.forEach((draft) => {
    if (optionMap.has(draft.caseId)) return;
    const classLabel =
      snapshot.classes.find((item) => item.id === draft.classId)?.name ??
      "未知班級";
    optionMap.set(draft.caseId, {
      id: draft.caseId,
      label: `${draft.servedOn} · ${classLabel} · 未完成草稿`,
      isDraft: true,
      isSaved: false,
    });
  });
  const caseOptions = [...optionMap.values()].sort((left, right) =>
    right.label.localeCompare(left.label, "zh-Hant"),
  );
  const invalidCaseRequest =
    rawRequestedCaseId && !requestedCaseId
      ? "網址中的案件識別碼格式不正確，未載入任何外部內容。"
      : hasCreationContext &&
          (!requestedClass || !requestedDate || !requestedNewCase)
        ? "新餐期網址的班級、日期或案件識別不一致；未載入任何外部內容。"
        : undefined;

  return (
    <MealEvidenceWorkflowContent
      key={`${mode}-${requestedCaseId ?? initialValue.id}`}
      snapshot={snapshot}
      mode={mode}
      repository={repository}
      refresh={refresh}
      initialValue={initialValue}
      requestedCaseId={requestedCaseId}
      initialLoadNotice={invalidCaseRequest ?? draftIndexError}
      caseOptions={caseOptions}
      onSelectCase={openCase}
      onCreateCase={openNewCase}
      onCaseIdentityPersisted={notePersistedCase}
      onDraftListChanged={refreshDraftSummaries}
    />
  );
}

function MealEvidenceWorkflowContent({
  snapshot,
  mode,
  repository,
  refresh,
  initialValue,
  requestedCaseId,
  initialLoadNotice,
  caseOptions,
  onSelectCase,
  onCreateCase,
  onCaseIdentityPersisted,
  onDraftListChanged,
}: {
  snapshot: AppSnapshot;
  mode: DataMode;
  repository: FoodLensRepository;
  refresh: () => Promise<void>;
  initialValue: MealEvidenceCase;
  requestedCaseId?: string;
  initialLoadNotice?: string;
  caseOptions: WorkflowCaseOption[];
  onSelectCase: (caseId: string) => void;
  onCreateCase: (classId: string, servedOn: string) => void;
  onCaseIdentityPersisted: (caseId: string) => void;
  onDraftListChanged: () => Promise<void>;
}) {
  const targetCaseId = requestedCaseId ?? initialValue.id;
  const [loadState, setLoadState] = useState<{
    key: string;
    status: "loading" | "ready";
    draft?: WorkflowDraft;
    error?: string;
  }>({ key: targetCaseId, status: "loading" });

  useEffect(() => {
    let active = true;
    void loadWorkflowDraftForCase(mode, targetCaseId)
      .then((draft) => {
        if (active) setLoadState({ key: targetCaseId, status: "ready", draft });
      })
      .catch(() => {
        if (active)
          setLoadState({
            key: targetCaseId,
            status: "ready",
            error: "這個瀏覽器無法讀取午餐任務草稿；正式資料未受影響。",
          });
      });
    return () => {
      active = false;
    };
  }, [mode, targetCaseId]);

  const currentLoad =
    loadState.key === targetCaseId
      ? loadState
      : { key: targetCaseId, status: "loading" as const };
  if (currentLoad.status === "loading")
    return (
      <div className={`${styles.workflowPage} page-stack`}>
        <LoadingState label="正在檢查這筆餐期的未完成草稿…" />
      </div>
    );

  const classStillExists = currentLoad.draft
    ? snapshot.classes.some(
        (schoolClass) => schoolClass.id === currentLoad.draft?.classId,
      )
    : false;
  const restoredDraft = classStillExists ? currentLoad.draft : undefined;
  const missingRequestedCase =
    requestedCaseId && requestedCaseId !== initialValue.id && !restoredDraft
      ? `找不到案件「${requestedCaseId}」；目前顯示預設餐期，沒有改寫任何正式資料。`
      : undefined;
  const missingClassNotice =
    currentLoad.draft && !classStillExists
      ? "草稿原班級已不存在，為避免接錯班級，這次沒有自動恢復。"
      : undefined;

  return (
    <MealEvidenceWorkflowWorkbench
      key={restoredDraft?.id ?? `repository:${initialValue.id}`}
      snapshot={snapshot}
      mode={mode}
      repository={repository}
      refresh={refresh}
      initialValue={restoredDraft?.value ?? initialValue}
      initialDraft={restoredDraft}
      initialLoadNotice={
        currentLoad.error ??
        missingClassNotice ??
        missingRequestedCase ??
        initialLoadNotice
      }
      caseOptions={caseOptions}
      onSelectCase={onSelectCase}
      onCreateCase={onCreateCase}
      onCaseIdentityPersisted={onCaseIdentityPersisted}
      onDraftListChanged={onDraftListChanged}
    />
  );
}

function MealEvidenceWorkflowWorkbench({
  snapshot,
  mode,
  repository,
  refresh,
  initialValue,
  initialDraft,
  initialLoadNotice,
  caseOptions,
  onSelectCase,
  onCreateCase,
  onCaseIdentityPersisted,
  onDraftListChanged,
}: {
  snapshot: AppSnapshot;
  mode: DataMode;
  repository: FoodLensRepository;
  refresh: () => Promise<void>;
  initialValue: MealEvidenceCase;
  initialDraft?: WorkflowDraft;
  initialLoadNotice?: string;
  caseOptions: WorkflowCaseOption[];
  onSelectCase: (caseId: string) => void;
  onCreateCase: (classId: string, servedOn: string) => void;
  onCaseIdentityPersisted: (caseId: string) => void;
  onDraftListChanged: () => Promise<void>;
}) {
  const [step, setStep] = useState(initialDraft?.step ?? 0);
  const [value, setValue] = useState<MealEvidenceCase>(() =>
    structuredClone(initialValue),
  );
  const [source, setSource] = useState<MenuImportSource>(
    initialDraft?.source ?? initialValue.menuVersion.sourceEvidence.source,
  );
  const [importText, setImportText] = useState(() =>
    initialDraft
      ? initialDraft.importText
      : initialValue.menuVersion.sourceEvidence.source === "ocr" ||
          initialValue.menuVersion.sourceEvidence.source === "csv"
        ? (initialValue.menuVersion.sourceEvidence.rawContent ?? "")
        : "",
  );
  const [photoAnalysisMode, setPhotoAnalysisMode] =
    useState<MenuOcrAnalysisMode>(
      initialDraft?.photoAnalysisMode ??
        (mode === "demo-local" ? "mock" : "real"),
    );
  const [stageError, setStageError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { triggerCelebration } = useGameMode();
  const [savedAt, setSavedAt] = useState<string | undefined>(() =>
    initialValue.humanDecision ? initialValue.updatedAt : undefined,
  );
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft>(() =>
    initialDraft
      ? initialDraft.decisionDraft
      : initialValue.humanDecision
        ? {
            cardId: initialValue.humanDecision.cardId,
            choice: initialValue.humanDecision.choice,
            rationale: initialValue.humanDecision.rationale,
            decidedByRole: initialValue.humanDecision.decidedByRole,
          }
        : {
            cardId:
              mode === "school-cloud" ? "need-more-data" : "headcount-reserve",
            choice: mode === "school-cloud" ? "more-data" : "pilot",
            rationale:
              mode === "school-cloud"
                ? "先累積至少三個可比較供餐日，再由營養師評估是否進行小型試驗。"
                : "保留現場添餐與營養護欄，先做一次小型試驗再比較。",
            decidedByRole:
              mode === "school-cloud" ? "teacher-student-team" : "dietitian",
          },
  );
  const [touchedMeasurementFields, setTouchedMeasurementFields] = useState<
    Set<string>
  >(() => new Set(initialDraft?.touchedMeasurementFields ?? []));
  const [caseTransitionPending, setCaseTransitionPending] = useState(false);
  const [newCaseClassId, setNewCaseClassId] = useState(value.classId);
  const [newCaseServedOn, setNewCaseServedOn] = useState(value.servedOn);
  const stagePanelRef = useRef<HTMLFieldSetElement>(null);
  const previousStepRef = useRef(step);
  const mockMenuOcrProvider = useMemo(() => new MockMenuOcrProvider(), []);
  const serverMenuOcrProvider = useMemo(() => new ServerMenuOcrProvider(), []);

  const workflowDraftInput = useMemo(
    () => ({
      mode,
      caseId: value.id,
      classId: value.classId,
      servedOn: value.servedOn,
      step,
      value,
      source,
      importText,
      photoAnalysisMode,
      decisionDraft,
      touchedMeasurementFields: [...touchedMeasurementFields],
    }),
    [
      decisionDraft,
      importText,
      mode,
      photoAnalysisMode,
      source,
      step,
      touchedMeasurementFields,
      value,
    ],
  );
  const {
    dirty: draftDirty,
    status: draftStatus,
    updatedAt: draftUpdatedAt,
    markDirty,
    flush: flushDraft,
    clearAfterCommit,
  } = useWorkflowAutosave({
    input: workflowDraftInput,
    paused: busy || caseTransitionPending,
    initialDraft,
    onPersisted: async (draft) => {
      onCaseIdentityPersisted(draft.caseId);
      await onDraftListChanged();
    },
  });
  const markDraftDirty = useCallback(() => {
    markDirty();
    setSavedAt(undefined);
  }, [markDirty]);
  const preserveDraftStep = () => {
    // Reading a saved case is not a content edit. Only unfinished work needs
    // its navigation progress persisted as a draft.
    if (!savedAt) markDraftDirty();
  };

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() =>
      focusWorkflowStageHeading(stagePanelRef.current),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const currentValidation = useMemo(
    () => (value ? mealEvidenceCaseSchema.safeParse(value) : undefined),
    [value],
  );
  // A restored draft can have incomplete feedback. Do not trap it in the
  // measurement step before the user can reach the fields needing attention.
  const measurementIssue = currentValidation?.success
    ? undefined
    : currentValidation?.error.issues.find(
        (issue) =>
          ![
            "reasonCounts",
            "reasonCollectionStatus",
            "teacherContext",
            "feedbackSchemaVersion",
          ].includes(String(issue.path[0])),
      );
  const persistedVersion = useMemo(
    () =>
      value
        ? snapshot?.evidenceCases.find((item) => item.id === value.id)
        : undefined,
    [snapshot, value],
  );
  const completed = useMemo(() => {
    const menuComplete = value?.menuVersion.status === "confirmed";
    const measurementComplete = Boolean(
      menuComplete && currentValidation && !measurementIssue,
    );
    const feedbackComplete = Boolean(
      measurementComplete && value && currentValidation?.success,
    );
    const decisionComplete = Boolean(
      feedbackComplete &&
      value?.humanDecision &&
      persistedVersion?.updatedAt === value.updatedAt,
    );
    return [
      menuComplete,
      measurementComplete,
      feedbackComplete,
      decisionComplete,
    ];
  }, [currentValidation, measurementIssue, persistedVersion, value]);
  const cohort = useMemo(() => {
    if (!snapshot || !currentValidation?.success) return undefined;
    try {
      return buildComparableEvidenceCohort(
        snapshot.evidenceCases,
        currentValidation.data,
      );
    } catch {
      return buildComparableEvidenceCohort([], currentValidation.data);
    }
  }, [currentValidation, snapshot]);
  const analysis = useMemo(() => {
    if (!snapshot || !currentValidation?.success || !cohort) return undefined;
    const casesById = new Map(
      [...snapshot.evidenceCases, currentValidation.data].map((item) => [
        item.id,
        item,
      ]),
    );
    const comparableCases = cohort.caseIds.flatMap((id) => {
      const item = casesById.get(id);
      return item ? [item] : [];
    });
    return analyzeEvidenceCases(comparableCases);
  }, [cohort, currentValidation, snapshot]);

  const classLabel =
    snapshot.classes.find((item) => item.id === value.classId)?.name ??
    "未選班級";
  const menuName =
    value.menuVersion.status === "confirmed"
      ? getActualMenuDishes(value.menuVersion)
          .map((dish) => dish.normalizedName)
          .join("、")
      : "等待人工確認";

  const updateCase = (patch: Partial<MealEvidenceCase>) => {
    markDraftDirty();
    setStageError(undefined);
    setValue((current) =>
      current
        ? (() => {
            const invalidatesMeasurementReview = [
              "classId",
              "servedOn",
              "menuVersion",
              "plannedDiners",
              "actualDiners",
              "suppliedEdibleG",
              "observedDiners",
              "plateSampleSupplyG",
              "measurements",
            ].some((key) => Object.hasOwn(patch, key));
            return {
              ...current,
              ...patch,
              measurementReview: Object.hasOwn(patch, "measurementReview")
                ? patch.measurementReview
                : invalidatesMeasurementReview
                  ? undefined
                  : current.measurementReview,
              humanDecision: Object.hasOwn(patch, "humanDecision")
                ? patch.humanDecision
                : undefined,
              updatedAt: auditTimestamp(current),
            };
          })()
        : current,
    );
  };

  const markMeasurementFieldsTouched = (...keys: string[]) => {
    setTouchedMeasurementFields((current) => {
      const next = new Set(current);
      keys.forEach((key) => next.add(key));
      return next;
    });
  };

  const analyzeMenuPhoto = async (input: {
    image: Blob;
    fingerprint: string;
    mode: MenuOcrAnalysisMode;
    isAiGenerated: boolean;
  }) => {
    if (busy || caseTransitionPending)
      throw new Error("請等待目前操作完成後再辨識菜單");
    setBusy(true);
    try {
      const provider =
        input.mode === "real" ? serverMenuOcrProvider : mockMenuOcrProvider;
      const result = await provider.analyze({
        image: input.image,
        fingerprint: input.fingerprint,
      });
      const menuVersion = importMenuVersion([
        {
          source: "ocr",
          menuId: value.menuVersion.id,
          servedOn: value.servedOn,
          importedAt: auditTimestamp(value),
          rawText: result.rawText,
          provider: result.provider,
          model: result.model,
          isMock: result.isMock,
          sourceName: menuPhotoSourceName({
            isMock: result.isMock,
            isAiGenerated: input.isAiGenerated,
          }),
          warnings: result.warnings,
        },
      ]);
      setSource("ocr");
      setImportText(result.rawText);
      updateCase({ menuVersion, humanDecision: undefined });
      toast.success(
        result.isMock
          ? "Mock 草稿已建立；這不代表 OCR 準確率，請逐項確認"
          : "真實 OCR 草稿已建立；請逐項核對後再確認",
      );
      return result;
    } finally {
      setBusy(false);
    }
  };

  const importMenu = () => {
    try {
      const importedAt = auditTimestamp(value);
      const menu = importMenuVersion([
        source === "demo"
          ? {
              source: "demo" as const,
              menuId: value.menuVersion.id,
              servedOn: value.servedOn,
              fingerprint: importText.trim() || "foodlens-live-judge-demo",
            }
          : source === "ocr"
            ? {
                source: "ocr" as const,
                menuId: value.menuVersion.id,
                servedOn: value.servedOn,
                importedAt,
                rawText: importText.trim() || DEFAULT_OCR,
                provider:
                  value.menuVersion.sourceEvidence.source === "ocr"
                    ? value.menuVersion.sourceEvidence.provider
                    : "human-transcribed-menu",
                model:
                  value.menuVersion.sourceEvidence.source === "ocr"
                    ? value.menuVersion.sourceEvidence.model
                    : "foodlens-menu-rules-v1",
                isMock:
                  value.menuVersion.sourceEvidence.source === "ocr"
                    ? value.menuVersion.sourceEvidence.isMock
                    : false,
                warnings:
                  value.menuVersion.sourceEvidence.source === "ocr"
                    ? value.menuVersion.sourceEvidence.warnings
                    : ["此原文由人工貼上或修正，需逐項核對。"],
                sourceName: "菜單照片 OCR 原文（人工可修正）",
              }
            : {
                source: "csv" as const,
                menuId: value.menuVersion.id,
                servedOn: value.servedOn,
                importedAt,
                csvText: importText.trim() || DEFAULT_CSV,
                sourceName: "學校／供餐公司 CSV",
              },
      ]);
      updateCase({ menuVersion: menu, humanDecision: undefined });
      toast.success("菜單已匯入為草稿，請逐項核對後再確認");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "菜單匯入失敗";
      setStageError(message);
      toast.error(message);
    }
  };

  const confirmMenu = (acceptedLowConfidence: AcceptedLowConfidence[]) => {
    try {
      const reviewedAt = auditTimestamp(value);
      const menuVersion = confirmMenuVersion(value.menuVersion, {
        reviewedBy: mode === "demo-local" ? "示範學生研究小組" : "教師帳號",
        reviewedAt,
        notes:
          mode === "demo-local"
            ? "已確認示範菜單；內容不是學校實際供餐。"
            : "已依當日供餐資訊人工核對。",
        acceptedLowConfidence,
      });
      updateCase({ menuVersion });
      toast.success("菜單已由人確認，現在可進行分流秤重");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "菜單確認失敗";
      setStageError(message);
      toast.error(message);
    }
  };

  const toggleSubstitution = (enabled: boolean) => {
    try {
      const existing = value.menuVersion.substitutions[0];
      if (!enabled && existing) {
        updateCase({
          menuVersion: removeMenuSubstitution(
            value.menuVersion,
            existing.plannedDishSignature,
          ),
        });
        toast.message("已撤回換菜紀錄；原計畫菜單仍完整保留");
        return;
      }
      if (!enabled || existing) return;
      const planned =
        value.menuVersion.plannedDishes.find((dish) => dish.role === "main") ??
        value.menuVersion.plannedDishes[0];
      const menuVersion = recordMenuSubstitution(value.menuVersion, {
        plannedDishSignature: planned.signature,
        actualDish: {
          rawName: "香草烤雞腿（現場替換）",
          role: planned.role,
          category: "meat",
          cookingMethod: "baked",
          portionG: planned.portionG ?? undefined,
          recipeVersion: "現場替換-v1",
          vendorId: planned.vendorId,
        },
        reason: "示範：原食材臨時調整，保留 planned／actual 差異",
        recordedBy: "供餐端與學生共同確認",
        recordedAt: auditTimestamp(value),
      });
      updateCase({ menuVersion });
      toast.success("已另存實際換菜，不會覆蓋原計畫");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "無法更新換菜紀錄";
      setStageError(message);
      toast.error(message);
    }
  };

  const validateStep = (index: number) => {
    if (index === 0 && value.menuVersion.status !== "confirmed")
      return "請先由學生或教師人工確認菜單";
    if (index === 1 && measurementIssue) return measurementIssue.message;
    if (index === 2) {
      const feedbackIssue = reasonCollectionIssue(value);
      if (feedbackIssue) return feedbackIssue;
      if (!currentValidation?.success)
        return firstIssue(currentValidation?.error ?? { issues: [] });
    }
    if (index === 3 && decisionDraft.rationale.trim().length < 5)
      return "請寫下至少 5 個字的人工決策理由";
    if (
      index === 3 &&
      cohort?.level === "current-only" &&
      decisionDraft.choice === "pilot"
    )
      return "目前只有一個可比供餐日；請先選擇「需要更多資料」或「這次不採用」";
    return undefined;
  };

  const goForward = () => {
    const issue = validateStep(step);
    if (issue) {
      setStageError(issue);
      toast.error(issue);
      return;
    }
    setStageError(undefined);
    preserveDraftStep();
    setStep((current) => Math.min(WORKFLOW_STEPS.length - 1, current + 1));
  };

  const selectStep = (target: number) => {
    if (target <= step) {
      setStageError(undefined);
      preserveDraftStep();
      setStep(target);
      return;
    }
    for (let index = 0; index < target; index += 1) {
      const issue = validateStep(index);
      if (issue) {
        setStep(index);
        setStageError(issue);
        toast.error(issue);
        return;
      }
    }
    setStageError(undefined);
    preserveDraftStep();
    setStep(target);
  };

  const save = async () => {
    if (busy || caseTransitionPending) return;
    const issue = [0, 1, 2, 3]
      .map((index) => validateStep(index))
      .find(Boolean);
    const selectedCard =
      analysis?.responsibilityCards.find(
        (card) => card.id === decisionDraft.cardId,
      ) ?? analysis?.responsibilityCards[0];
    if (issue || !analysis || !selectedCard) {
      const message = issue ?? "請先完成四個步驟，讓系統產生可追溯建議";
      setStageError(message);
      toast.error(message);
      return;
    }
    const timestamp = auditTimestamp(value);
    const candidate = {
      ...value,
      humanDecision: {
        ...decisionDraft,
        cardId: selectedCard.id,
        decidedAt: timestamp,
      },
      updatedAt: timestamp,
    };
    const result = mealEvidenceCaseSchema.safeParse(candidate);
    if (!result.success) {
      const message = firstIssue(result.error);
      setStageError(message);
      toast.error(message);
      return;
    }
    setBusy(true);
    try {
      const { mealRecordId } = await repository.saveEvidenceCase(result.data);
      const linkedResult = mealEvidenceCaseSchema.parse({
        ...result.data,
        mealRecordId,
      });
      await clearAfterCommit();
      await deleteWorkflowDraftForCase(mode, result.data.id);
      setValue(linkedResult);
      await refresh();
      const saved = new Date().toISOString();
      setSavedAt(saved);
      setStageError(undefined);
      onCaseIdentityPersisted(linkedResult.id);
      await onDraftListChanged();
      toast.success("一餐證據鏈已保存；重新整理後仍可追溯");
      triggerCelebration(
        `${linkedResult.servedOn} · ${snapshot.classes.find((c) => c.id === linkedResult.classId)?.name ?? "午餐任務"}`,
        14
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "保存失敗";
      setStageError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const linkedMealReady = Boolean(savedAt && value.mealRecordId);
  const linkedScanHref = value.mealRecordId
    ? `/scan?meal=${encodeURIComponent(value.mealRecordId)}`
    : "/scan";
  const displayedCaseOptions = caseOptions.some(
    (option) => option.id === value.id,
  )
    ? caseOptions.map((option) =>
        option.id === value.id
          ? {
              ...option,
              isDraft: Boolean(
                option.isDraft || initialDraft || draftDirty || draftUpdatedAt,
              ),
            }
          : option,
      )
    : [
        {
          id: value.id,
          label: `${value.servedOn} · ${classLabel} · ${menuName || "菜單待確認"}`,
          isDraft: Boolean(initialDraft || draftDirty || draftUpdatedAt),
          isSaved: Boolean(persistedVersion),
        },
        ...caseOptions,
      ];
  const draftStatusCopy =
    draftStatus === "restored"
      ? {
          title: "已恢復這台裝置的未完成草稿",
          detail: "量測確認與最後人類決策沒有被代簽；請重新檢查後再正式保存。",
        }
      : draftStatus === "pending"
        ? {
            title: "有新的草稿變更",
            detail: "停止輸入約 0.6 秒後會自動保存到這台裝置。",
          }
        : draftStatus === "saving"
          ? {
              title: "正在保存本機草稿…",
              detail: "尚未寫入正式餐期；請保持此頁開啟。",
            }
          : draftStatus === "saved"
            ? {
                title: "未完成草稿已保存",
                detail: `${draftUpdatedAt ? new Date(draftUpdatedAt).toLocaleTimeString("zh-TW") : "剛剛"} · 可重新整理或保留目前 ?case= 網址後返回。`,
              }
            : draftStatus === "error"
              ? {
                  title: "本機草稿暫時無法保存",
                  detail:
                    "輸入仍留在畫面上。請重試保存；成功前先不要離開此頁。",
                }
              : savedAt
                ? {
                    title: "目前顯示已正式保存的證據鏈",
                    detail:
                      "再次修改後會先另存本機草稿，不會直接覆寫正式資料。",
                  }
                : {
                    title: "尚未建立本機草稿",
                    detail:
                      "開始輸入或換步後即會自動保存；正式資料仍只在最後確認後寫入。",
                  };

  const navigateAfterDraftFlush = async (navigate: () => void) => {
    if (caseTransitionPending || busy) return;
    setCaseTransitionPending(true);
    const saved = await flushDraft();
    if (!saved) {
      setCaseTransitionPending(false);
      toast.error("本機草稿尚未保存，已留在目前案件，請稍後再試");
      return;
    }
    navigate();
  };
  const openingCurrentCase =
    workflowCaseId(mode, newCaseServedOn, newCaseClassId) === value.id;

  return (
    <div className={`${styles.workflowPage} page-stack`}>
      <PageHeader
        eyebrow="ONE MEAL · FULL EVIDENCE"
        title="午餐任務台"
        description="從供餐菜單到人類決定，把一餐的問題、證據與下一步真正接起來。"
        icon={ClipboardCheck}
        actions={
          linkedMealReady ? (
            <>
              <Link
                className="ghost-button"
                href={`/records?meal=${encodeURIComponent(value.mealRecordId!)}&safety=1`}
              >
                補記本餐安全觀察
              </Link>
              <Link className="ghost-button" href={linkedScanHref}>
                <Camera size={16} /> 為本餐拍餐盤
              </Link>
            </>
          ) : (
            <button
              className="ghost-button"
              type="button"
              disabled
              title="先完成並保存四步證據鏈"
            >
              <Camera size={16} /> 保存後連結餐盤
            </button>
          )
        }
      />

      <section
        className={styles.caseWorkspace}
        aria-labelledby="workflow-case-workspace-title"
      >
        <div className={styles.caseWorkspaceCopy}>
          <span>CASE WORKSPACE</span>
          <h2 id="workflow-case-workspace-title">先確認正在處理哪一餐</h2>
          <p>
            可切換已保存案例或未完成草稿，也能先選班級與日期建立新餐期；
            網址會鎖定 <code>?case=</code>，避免重新整理時接錯資料。
          </p>
        </div>
        <label className={styles.caseSelector}>
          <span>目前案件</span>
          <select
            value={value.id}
            disabled={busy || caseTransitionPending}
            onChange={(event) => {
              const caseId = event.target.value;
              if (caseId === value.id) return;
              void navigateAfterDraftFlush(() => onSelectCase(caseId));
            }}
          >
            {displayedCaseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.isDraft
                  ? " · 有草稿"
                  : option.isSaved
                    ? " · 已保存"
                    : " · 新案件"}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.caseCreator}>
          <label>
            <span>新增餐期班級</span>
            <select
              value={newCaseClassId}
              disabled={busy || caseTransitionPending}
              onChange={(event) => setNewCaseClassId(event.target.value)}
            >
              {snapshot.classes
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>供餐日期</span>
            <input
              type="date"
              value={newCaseServedOn}
              disabled={busy || caseTransitionPending}
              onChange={(event) => setNewCaseServedOn(event.target.value)}
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            disabled={
              busy ||
              caseTransitionPending ||
              openingCurrentCase ||
              !newCaseClassId ||
              !newCaseServedOn
            }
            onClick={() =>
              void navigateAfterDraftFlush(() =>
                onCreateCase(newCaseClassId, newCaseServedOn),
              )
            }
          >
            {caseTransitionPending
              ? "保存目前草稿…"
              : openingCurrentCase
                ? "目前正在編輯此餐"
                : "建立／開啟這個餐期"}
          </button>
        </div>
        <div
          className={`${styles.draftState} ${
            draftStatus === "error" ? styles.draftError : ""
          }`}
          role={draftStatus === "error" ? "alert" : "status"}
          aria-live={draftStatus === "error" ? "assertive" : "polite"}
        >
          <strong>{draftStatusCopy.title}</strong>
          <span>{draftStatusCopy.detail}</span>
          {draftStatus === "error" && (
            <button
              className="ghost-button"
              type="button"
              disabled={busy || caseTransitionPending}
              onClick={() => void flushDraft()}
            >
              重試保存草稿
            </button>
          )}
          {mode === "school-cloud" && draftStatus !== "idle" && (
            <small>草稿只在此瀏覽器；尚未成為校園正式資料。</small>
          )}
        </div>
      </section>

      {initialLoadNotice && (
        <p className={styles.draftLoadNotice} role="alert">
          {initialLoadNotice}
        </p>
      )}

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        目前第 {step + 1} 步：{WORKFLOW_STEPS[step]?.title}，
        {WORKFLOW_STEPS[step]?.description}
      </p>

      <section className={styles.proofStrip} aria-label="這條證據鏈回答什麼">
        <div className={styles.proofCopy}>
          <span>FOODLENS IS MORE THAN A CLASSIFIER</span>
          <strong>
            AI 幫忙整理線索；學生核對現場，營養師與學校保留最後決定權。
          </strong>
        </div>
        <div className={styles.proofMeta}>
          <div>
            <b>5</b>
            <small>類廚餘分流</small>
          </div>
          <div>
            <b>
              {analysis?.metrics.independentMealCount ??
                (mode === "demo-local" ? 3 : 0)}
            </b>
            <small>獨立供餐日</small>
          </div>
          <div>
            <b>1</b>
            <small>人類最終決策</small>
          </div>
        </div>
      </section>

      <nav className={styles.stageNav} aria-label="午餐任務四步驟">
        {WORKFLOW_STEPS.map((item, index) => (
          <button
            key={item.title}
            className={index === step ? styles.active : undefined}
            type="button"
            aria-current={index === step ? "step" : undefined}
            disabled={busy || caseTransitionPending}
            onClick={() => selectStep(index)}
          >
            <span className={styles.stageNumber}>
              {completed[index] ? "✓" : String(index + 1).padStart(2, "0")}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className={styles.workspace}>
        <fieldset
          className={styles.stagePanel}
          ref={stagePanelRef}
          aria-label={`${WORKFLOW_STEPS[step].title}輸入`}
          aria-busy={busy || caseTransitionPending}
          disabled={busy || caseTransitionPending}
        >
          {step === 0 && (
            <MenuStage
              menu={value.menuVersion}
              source={source}
              importText={importText}
              busy={busy}
              onSourceChange={(nextSource) => {
                markDraftDirty();
                setSource(nextSource);
                setImportText(
                  nextSource === "csv"
                    ? DEFAULT_CSV
                    : nextSource === "ocr"
                      ? DEFAULT_OCR
                      : "",
                );
              }}
              onImportTextChange={(nextText) => {
                markDraftDirty();
                setImportText(nextText);
              }}
              onImport={importMenu}
              photoAnalysisMode={photoAnalysisMode}
              allowRealMenuAi={mode === "school-cloud"}
              allowGeneratedDemoPhoto={mode === "demo-local"}
              onPhotoAnalysisModeChange={(nextMode) => {
                markDraftDirty();
                setPhotoAnalysisMode(nextMode);
              }}
              onAnalyzePhoto={analyzeMenuPhoto}
              onConfirm={confirmMenu}
              onDishFieldChange={(index, field, next) => {
                try {
                  const menuVersion = updateDraftMenuDish(value.menuVersion, {
                    index,
                    ...(field === "normalizedName"
                      ? { normalizedName: String(next) }
                      : field === "role"
                        ? { role: next as MenuDishRole }
                        : field === "category"
                          ? { category: next as FoodCategory }
                          : field === "cookingMethod"
                            ? { cookingMethod: next as CookingMethod }
                            : field === "portionG"
                              ? { portionG: next as number | null }
                              : field === "recipeVersion"
                                ? { recipeVersion: String(next) }
                                : { vendorId: String(next) }),
                  });
                  updateCase({ menuVersion });
                } catch (caught) {
                  setStageError(
                    caught instanceof Error ? caught.message : "無法修正菜單",
                  );
                }
              }}
              onSubstitutionToggle={toggleSubstitution}
            />
          )}
          {step === 1 && (
            <WasteStage
              value={value}
              classes={snapshot.classes.filter(
                (item) => item.active || item.id === value.classId,
              )}
              error={stageError}
              requireExplicitReview={mode === "school-cloud"}
              touchedFields={touchedMeasurementFields}
              onTextFieldChange={(field, next) => {
                if (field === "classId") {
                  updateCase({
                    id: workflowCaseId(mode, value.servedOn, next),
                    classId: next,
                  });
                  return;
                }
                if (next === value.servedOn) return;
                const menuVersion = importMenuVersion([
                  {
                    source: "structured",
                    menuId: `${value.id}-menu-${next}`,
                    servedOn: next,
                    importedAt: auditTimestamp(value),
                    sourceName: "由已匯入菜單複製，待重新確認",
                    dishes: value.menuVersion.plannedDishes.map((dish) => ({
                      rawName: dish.rawName,
                      role: dish.role,
                      category: dish.category,
                      cookingMethod: dish.cookingMethod,
                      primaryIngredients: dish.primaryIngredientCandidates.map(
                        (ingredient) => ingredient.canonicalName,
                      ),
                      portionG: dish.portionG ?? undefined,
                      recipeVersion: dish.recipeVersion,
                      vendorId: dish.vendorId,
                    })),
                  },
                ]);
                updateCase({
                  id: workflowCaseId(mode, next, value.classId),
                  servedOn: next,
                  menuVersion,
                  humanDecision: undefined,
                });
                setSource("structured");
                setStep(0);
                toast.message("日期已更新；為保留稽核，需要重新確認菜單");
              }}
              onNumberFieldChange={(field, next) => {
                markMeasurementFieldsTouched(field);
                updateCase({ [field]: next } as Partial<MealEvidenceCase>);
              }}
              onMeasurementChange={(measurementId, patch) => {
                markMeasurementFieldsTouched(
                  ...Object.keys(patch).map(
                    (field) => `${measurementId}.${field}`,
                  ),
                );
                updateCase({
                  measurements: value.measurements.map((item) =>
                    item.id === measurementId ? { ...item, ...patch } : item,
                  ),
                });
              }}
              onMeasurementReviewChange={(confirmed) => {
                updateCase({
                  measurementReview: confirmed
                    ? {
                        reviewedAt: auditTimestamp(value),
                        reviewedBy: "現場教師／午餐工作小組",
                        zeroValuesChecked: true,
                      }
                    : undefined,
                });
              }}
            />
          )}
          {step === 2 && (
            <>
              <CulpritClueBoard />
              <FeedbackStage
                reasonCollectionStatus={value.reasonCollectionStatus}
              reasonCounts={value.reasonCounts}
              teacherContext={value.teacherContext}
              actualDiners={value.actualDiners}
              error={stageError}
              onReasonCollectionChange={(
                reasonCollectionStatus,
                reasonCounts,
              ) => updateCase({ reasonCollectionStatus, reasonCounts })}
              onReasonChange={(key, count) =>
                updateCase({
                  reasonCounts: { ...value.reasonCounts, [key]: count },
                })
              }
              onContextChange={(patch) =>
                updateCase({
                  teacherContext: { ...value.teacherContext, ...patch },
                })
              }
            />
          </>
        )}
          {step === 3 && analysis && cohort && (
            <DecisionStage
              analysis={analysis}
              cohort={cohort}
              draft={decisionDraft}
              error={stageError}
              onDraftChange={(patch) => {
                setStageError(undefined);
                markDraftDirty();
                setDecisionDraft((current) => ({ ...current, ...patch }));
              }}
            />
          )}
          {step === 3 && (!analysis || !cohort) && (
            <ErrorState
              title="還不能產生責任決策卡"
              description={
                currentValidation?.success
                  ? "需要至少一筆完整資料。"
                  : firstIssue(currentValidation?.error ?? { issues: [] })
              }
              actions={
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setStep(1)}
                >
                  回到分流秤重 <ArrowRight size={15} />
                </button>
              }
            />
          )}
        </fieldset>

        <WorkflowRail
          step={step}
          completed={completed}
          className={classLabel}
          servedOn={value.servedOn}
          menuName={menuName}
          sourceKind={value.sourceKind}
          measurementDraft={mode === "school-cloud" && !value.measurementReview}
          busy={busy || caseTransitionPending}
          savedAt={savedAt}
          onPrevious={() => {
            setStageError(undefined);
            preserveDraftStep();
            setStep((current) => Math.max(0, current - 1));
          }}
          onNext={goForward}
          onSave={() => void save()}
        />
      </div>

      <section className="panel" aria-label="下一段操作">
        <div className="panel-title">
          <div>
            <p>完整循環的下一步</p>
            <h2>餐期證據保存後，再拍餐盤補上 AI 與學生修正</h2>
            <span>
              任務台量的是班級／供餐流程；掃描頁看的是餐盤樣本。兩者用途不同，不互相冒充。
            </span>
          </div>
          {linkedMealReady ? (
            <Link className="primary-button" href={linkedScanHref}>
              <ScanLine size={16} /> 為本餐新增餐盤樣本
            </Link>
          ) : (
            <button className="primary-button" type="button" disabled>
              <ScanLine size={16} /> 先保存這餐，再連結掃描
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
