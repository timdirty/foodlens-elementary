"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileImage,
  Info,
  Pencil,
  ScanLine,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useFoodLens } from "@/components/data-provider";
import {
  getBrowserStorage,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
} from "@/lib/browser-storage";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  PanelTitle,
} from "@/components/ui/page";
import { ScanStorageLocation } from "@/components/scan-storage-location";
import { ScanDraftRecovery } from "@/components/scan-draft-recovery";
import { DetectiveNotebookInspector } from "@/components/game/detective-notebook-inspector";
import {
  aiAnalysisSchema,
  createManualFoodAnalysis,
  MockFoodAnalysisProvider,
  ServerFoodAnalysisProvider,
} from "@/lib/ai";
import { preparePlateImage } from "@/lib/image";
import { createUuid, sha256Hex } from "@/lib/crypto";
import {
  canPersistScanImage,
  createScanInitialForm,
  findSameDayLunchMeals,
  hasResolvedScanMealChoice,
  plateScanMenuContext,
  resolveConfirmedPlateMenuContext,
  resolveScanMealTarget,
  type ConfirmedPlateMenuContext,
  type ScanMealChoice,
  type ScanFormState,
} from "@/lib/scan-workflow";
import { createScanDraftId, useScanDraft } from "@/lib/scan-draft";
import {
  CATEGORY_LABELS,
  FOOD_CATEGORIES,
  type AiAnalysisV1,
  type AiDetectionInput,
  type AppSnapshot,
  type DataMode,
  type FoodLensRepository,
  type MealRecord,
} from "@/lib/types";

const demoImages = [
  { src: "/demo/plate-curry.png", name: "咖哩飯餐盤", hint: "curry" },
  { src: "/demo/plate-greens.png", name: "雞肉青菜餐盤", hint: "greens" },
  { src: "/demo/plate-noodles.png", name: "麵類餐盤", hint: "noodles" },
];
const stages = [
  "檢查影像品質",
  "辨識食物類型",
  "估計剩餘比例",
  "整理人工確認項目",
];
const scanSteps = ["餐期歸屬", "選擇照片", "影像初判", "學生修正"] as const;
const REQUEST_STORAGE_KEY = "foodlens-scan-request-id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSideDishes(value: string) {
  return value
    .split(/[、,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function classNameForScan(snapshot: AppSnapshot, classId: string) {
  return snapshot.classes.find((item) => item.id === classId)?.name ?? classId;
}

const menuSourceLabels = {
  structured: "校方結構化菜單",
  csv: "CSV 菜單",
  ocr: "菜單照片辨識",
  demo: "示範菜單",
} as const;

function menuContextSourceLabel(context: ConfirmedPlateMenuContext) {
  const sourceName = context.sourceName?.trim();
  const source = `${menuSourceLabels[context.source]}${sourceName ? `・${sourceName}` : ""}`;
  return `${source}${context.isMock ? "（Mock 示範來源）" : ""}`;
}

export default function ScanPage() {
  return (
    <Suspense
      fallback={
        <div className="page-wrap">
          <LoadingState label="正在準備掃描工作台…" />
        </div>
      }
    >
      <ScanPageContent />
    </Suspense>
  );
}

function ScanPageContent() {
  const searchParams = useSearchParams();
  const requestedMealId = searchParams.get("meal")?.trim() || undefined;
  const { snapshot, loading, repository, refresh, mode, storageMode } =
    useFoodLens();
  if (loading || !snapshot)
    return (
      <div className="page-wrap">
        <LoadingState label="正在準備掃描工作台…" />
      </div>
    );

  const linkedMeal = requestedMealId
    ? snapshot.meals.find((meal) => meal.id === requestedMealId)
    : undefined;
  if (requestedMealId && !linkedMeal)
    return (
      <div className="page-wrap">
        <ErrorState
          title="找不到指定的餐期"
          description="這個連結指向的餐期不存在，或已不在目前資料工作區。系統不會改用其他餐期繼續新增。"
          actions={
            <>
              <Link className="secondary-action" href="/records">
                返回餐期日誌
              </Link>
              <Link className="primary-action" href="/scan">
                建立新的餐期
              </Link>
            </>
          }
        />
      </div>
    );

  return (
    <ScanWorkspace
      key={`${mode}:${requestedMealId ?? "new"}`}
      snapshot={snapshot}
      linkedMeal={linkedMeal}
      repository={repository}
      refresh={refresh}
      mode={mode}
      storageMode={storageMode}
    />
  );
}

function ScanWorkspace({
  snapshot,
  linkedMeal,
  repository,
  refresh,
  mode,
  storageMode,
}: {
  snapshot: AppSnapshot;
  linkedMeal?: MealRecord;
  repository: FoodLensRepository;
  refresh: () => Promise<void>;
  mode: DataMode;
  storageMode: "indexeddb" | "memory" | "cloud";
}) {
  const provider = useMemo(() => new MockFoodAnalysisProvider(), []);
  const serverProvider = useMemo(() => new ServerFoodAnalysisProvider(), []);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(1);
  const formBeforeAttachmentRef = useRef<ScanFormState | undefined>(undefined);
  const requestIdRef = useRef(createUuid());
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [stage, setStage] = useState(0);
  const [saving, setSaving] = useState(false);
  const initialImage = mode === "demo-local" ? demoImages[2].src : "";
  const [selectedImage, setSelectedImage] = useState(initialImage);
  const [imageBlob, setImageBlob] = useState<Blob>();
  const [previewUrl, setPreviewUrl] = useState(initialImage);
  const [analysis, setAnalysis] = useState<AiAnalysisV1>();
  const [corrections, setCorrections] = useState<AiDetectionInput[]>([]);
  const [humanChecked, setHumanChecked] = useState(false);
  const [saved, setSaved] = useState<{ mealId: string; scanId: string }>();
  const [analysisMode, setAnalysisMode] = useState<"mock" | "real">("real");
  const [analysisError, setAnalysisError] = useState<string>();
  const [analysisMenuContext, setAnalysisMenuContext] = useState<
    ConfirmedPlateMenuContext | null | undefined
  >();
  const [mealChoice, setMealChoice] = useState<ScanMealChoice>(null);
  const draftId = createScanDraftId({
    mode,
    linkedMealId: linkedMeal?.id,
    workspaceKey:
      mode === "school-cloud"
        ? snapshot.classes
            .map((item) => item.id)
            .sort()
            .join("|") || snapshot.profile.schoolName
        : "foodlens-demo-v1",
  });
  const {
    draft,
    loading: draftLoading,
    error: draftError,
    save: saveDraft,
    discard: discardDraft,
  } = useScanDraft(draftId);
  const [draftDecisionMade, setDraftDecisionMade] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const secureContext = useSyncExternalStore(
    () => () => undefined,
    () => window.isSecureContext,
    () => true,
  );
  const [form, setForm] = useState<ScanFormState>(() =>
    createScanInitialForm({
      mode,
      activeClasses: snapshot.classes.filter((item) => item.active),
      linkedMeal,
    }),
  );
  useEffect(
    () => () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  useEffect(() => {
    const stored = safeStorageGet(
      getBrowserStorage("session"),
      REQUEST_STORAGE_KEY,
    );
    if (stored && UUID_PATTERN.test(stored)) requestIdRef.current = stored;
    else
      safeStorageSet(
        getBrowserStorage("session"),
        REQUEST_STORAGE_KEY,
        requestIdRef.current,
      );
  }, []);
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() =>
      stepHeadingRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const canPersistLocalDraft = draftDecisionMade || (!draftLoading && !draft);

  useEffect(() => {
    if (!draftDirty || !canPersistLocalDraft || saved) return;
    const timeout = window.setTimeout(() => {
      void saveDraft({
        id: draftId,
        mode,
        linkedMealId: linkedMeal?.id,
        step: step === 3 ? 2 : step,
        form,
        selectedImage,
        imageSource: imageBlob ? "upload" : selectedImage ? "demo" : "none",
        imageBlob,
        analysis,
        analysisMenuContext,
        corrections,
        analysisMode,
        clientRequestId: requestIdRef.current,
      }).catch(() => {
        // The persistent warning below gives the student a visible next step.
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    analysis,
    analysisMenuContext,
    analysisMode,
    corrections,
    canPersistLocalDraft,
    draftDirty,
    draftId,
    draftLoading,
    form,
    imageBlob,
    linkedMeal?.id,
    mode,
    saveDraft,
    saved,
    selectedImage,
    step,
  ]);

  const activeClasses = snapshot.classes.filter((item) => item.active);
  const selectableClasses = linkedMeal
    ? snapshot.classes.filter((item) => item.id === linkedMeal.classId)
    : activeClasses;
  const selectedClassId = linkedMeal
    ? linkedMeal.classId
    : activeClasses.some((item) => item.id === form.classId)
      ? form.classId
      : (activeClasses[0]?.id ?? "");
  const formSideDishes = parseSideDishes(form.sides);
  const sameDayMeals = linkedMeal
    ? []
    : findSameDayLunchMeals({
        meals: snapshot.meals,
        classId: selectedClassId,
        servedOn: form.date,
      });
  const targetMeal = resolveScanMealTarget({
    linkedMeal,
    sameDayMeals,
    choice: mealChoice,
  });
  const menuCandidateContext = resolveConfirmedPlateMenuContext({
    evidenceCases: snapshot.evidenceCases,
    meal: targetMeal,
  });
  const mealChoiceResolved = hasResolvedScanMealChoice({
    linkedMeal,
    sameDayMeals,
    choice: mealChoice,
  });
  const stepOneMissingRequirements = [
    !form.date ? "日期" : undefined,
    !selectedClassId ? "班級" : undefined,
    !form.staple.trim() ? "主食" : undefined,
    !form.mainDish.trim() ? "主菜" : undefined,
    form.people === "" || form.people < 1 ? "至少 1 位用餐人數" : undefined,
    form.supplyKg === "" || form.supplyKg <= 0
      ? "大於 0 kg 的供應重量"
      : undefined,
    !mealChoiceResolved
      ? "餐期歸屬（加入既有餐期或建立新的獨立餐期）"
      : undefined,
    !targetMeal &&
    (form.leftoverKg === "" ||
      form.leftoverKg < 0 ||
      (form.supplyKg !== "" && form.leftoverKg > form.supplyKg))
      ? "介於 0 與供應重量之間的班級剩食秤重"
      : undefined,
  ].filter((item): item is string => Boolean(item));
  const targetScanCount = targetMeal
    ? snapshot.scans.filter((scan) => scan.mealRecordId === targetMeal.id)
        .length
    : 0;
  const isManualAnalysis = analysis?.provider === "human-manual";
  const cloudImageMissing = mode === "school-cloud" && !imageBlob;
  const markDraftDirty = () => setDraftDirty(true);
  const updateForm = (
    next: ScanFormState | ((current: ScanFormState) => ScanFormState),
  ) => {
    markDraftDirty();
    setForm(next);
  };

  const chooseExistingMeal = (meal: MealRecord) => {
    if (mealChoice?.kind !== "attach") formBeforeAttachmentRef.current = form;
    setMealChoice({ kind: "attach", mealId: meal.id });
    updateForm({
      date: meal.servedOn,
      classId: meal.classId,
      staple: meal.staple,
      mainDish: meal.mainDish,
      sides: meal.sideDishes.join("、"),
      people: meal.actualPeople,
      supplyKg: meal.totalSupplyG / 1000,
      leftoverKg: meal.leftoverG / 1000,
      notes: meal.notes,
    });
  };

  const reconsiderMealChoice = () => {
    if (formBeforeAttachmentRef.current)
      updateForm(formBeforeAttachmentRef.current);
    formBeforeAttachmentRef.current = undefined;
    setMealChoice(null);
  };

  const resetWorkspace = () => {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setStep(1);
    setStage(0);
    setSelectedImage(initialImage);
    setImageBlob(undefined);
    setPreviewUrl(initialImage);
    setAnalysis(undefined);
    setCorrections([]);
    setHumanChecked(false);
    setAnalysisMode("mock");
    setAnalysisError(undefined);
    setAnalysisMenuContext(undefined);
    setMealChoice(null);
    formBeforeAttachmentRef.current = undefined;
    setForm(
      createScanInitialForm({
        mode,
        activeClasses,
        linkedMeal,
      }),
    );
    requestIdRef.current = createUuid();
    safeStorageSet(
      getBrowserStorage("session"),
      REQUEST_STORAGE_KEY,
      requestIdRef.current,
    );
    setDraftDirty(false);
  };

  const resumeDraft = () => {
    if (!draft) return;
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setForm(draft.form);
    const draftHasSameDayMeal = findSameDayLunchMeals({
      meals: snapshot.meals,
      classId: draft.form.classId,
      servedOn: draft.form.date,
    }).length;
    setStep(!linkedMeal && draftHasSameDayMeal ? 1 : draft.step);
    setMealChoice(null);
    formBeforeAttachmentRef.current = undefined;
    setSelectedImage(draft.selectedImage);
    setImageBlob(draft.imageBlob);
    setPreviewUrl(
      draft.imageBlob
        ? URL.createObjectURL(draft.imageBlob)
        : draft.imageSource === "demo"
          ? draft.selectedImage
          : "",
    );
    setAnalysis(draft.analysis);
    setCorrections(draft.corrections);
    setAnalysisMode(draft.analysisMode);
    setAnalysisMenuContext(draft.analysisMenuContext);
    setHumanChecked(false);
    setAnalysisError(undefined);
    requestIdRef.current = draft.clientRequestId;
    safeStorageSet(
      getBrowserStorage("session"),
      REQUEST_STORAGE_KEY,
      requestIdRef.current,
    );
    setDraftDecisionMade(true);
    setDraftDirty(false);
    window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    toast.message(
      !linkedMeal && draftHasSameDayMeal
        ? "已回復草稿；同日已有餐期，請重新確認照片要加入既有餐期或建立新餐期。"
        : "已回復未送出的草稿；請重新勾選人工確認後才可寫入資料。",
    );
  };

  const discardCurrentDraft = async () => {
    setDiscardingDraft(true);
    try {
      await discardDraft();
      resetWorkspace();
      setDraftDecisionMade(true);
      toast.message("已捨棄本機掃描草稿，沒有建立任何正式記錄。");
    } catch {
      toast.error("無法刪除本機草稿，請確認瀏覽器儲存空間後再試一次。");
    } finally {
      setDiscardingDraft(false);
    }
  };

  const chooseDemo = (item: (typeof demoImages)[number]) => {
    if (mode !== "demo-local") {
      toast.error("校園正式記錄不可使用 AI 生成示範照片");
      return;
    }
    markDraftDirty();
    setSelectedImage(item.src);
    setImageBlob(undefined);
    setPreviewUrl(item.src);
    setAnalysis(undefined);
    setCorrections([]);
    setAnalysisError(undefined);
    setAnalysisMenuContext(undefined);
    setHumanChecked(false);
  };
  const chooseFile = async (file?: File) => {
    if (!file) return;
    try {
      const blob = await preparePlateImage(file);
      markDraftDirty();
      const url = URL.createObjectURL(blob);
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setImageBlob(blob);
      setPreviewUrl(url);
      setSelectedImage(file.name);
      setAnalysis(undefined);
      setCorrections([]);
      setAnalysisError(undefined);
      setAnalysisMenuContext(undefined);
      setHumanChecked(false);
      toast.success("圖片已安全重編碼並移除 EXIF");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "無法使用這張圖片");
    }
  };
  const runAnalysis = async () => {
    if (cloudImageMissing) {
      toast.error("請先上傳這一餐的真實餐盤照片");
      return;
    }
    markDraftDirty();
    setStep(3);
    setStage(0);
    setAnalysis(undefined);
    setCorrections([]);
    setAnalysisError(undefined);
    setAnalysisMenuContext(undefined);
    const candidateContextAtStart = menuCandidateContext;
    setAnalysisMenuContext(candidateContextAtStart ?? null);
    const interval = window.setInterval(
      () => setStage((value) => Math.min(stages.length - 1, value + 1)),
      330,
    );
    try {
      let result: AiAnalysisV1;
      const fingerprint = imageBlob
        ? await sha256Hex(await imageBlob.arrayBuffer())
        : selectedImage;
      if (analysisMode === "real") {
        const blob =
          imageBlob ??
          (await fetch(previewUrl).then((response) => response.blob()));
        result = await serverProvider.analyze({
          fingerprint,
          image: blob,
          menuCandidates: candidateContextAtStart?.candidates,
        });
      } else
        result = await provider.analyze({
          fingerprint,
          menuCandidates: candidateContextAtStart?.candidates,
        });
      setAnalysis(result);
      setCorrections(result.detections.map((item) => ({ ...item })));
      setStep(4);
    } catch (error) {
      const message = error instanceof Error ? error.message : "分析失敗";
      setAnalysisMenuContext(undefined);
      setAnalysisError(message);
      toast.error(`${message}；系統沒有偷偷改成示範結果。`);
      setStep(2);
    } finally {
      window.clearInterval(interval);
    }
  };
  const startManualReview = () => {
    if (cloudImageMissing) {
      toast.error("請先上傳這一餐的真實餐盤照片，再建立人工判讀表");
      return;
    }
    markDraftDirty();
    const result = createManualFoodAnalysis({
      staple: form.staple,
      mainDish: form.mainDish,
      sideDishes: formSideDishes,
    });
    setAnalysis(result);
    setCorrections(result.detections.map((item) => ({ ...item })));
    setHumanChecked(false);
    setAnalysisError(undefined);
    setAnalysisMenuContext(null);
    setStep(4);
    toast.message("已建立人工判讀表：這份資料不會被標示成 AI 輸出。");
  };
  const updateCorrection = (
    index: number,
    field: keyof AiDetectionInput,
    value: string | number,
  ) => {
    markDraftDirty();
    setCorrections((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, [field]: value } as AiDetectionInput;
        if (field === "originalG" || field === "remainingRatio")
          next.remainingG = Math.round(
            Number(next.originalG) * Number(next.remainingRatio),
          );
        return next;
      }),
    );
    setHumanChecked(false);
  };
  const save = async () => {
    if (!analysis || !humanChecked) return;
    setSaving(true);
    try {
      if (!mealChoiceResolved) {
        throw new Error(
          "同班同日已有午餐資料；請返回第一步，明確選擇加入既有餐期或建立新的獨立餐期",
        );
      }
      if (
        !canPersistScanImage({
          mode,
          hasUploadedImage: Boolean(imageBlob),
          selectedImage,
          previewUrl,
        })
      ) {
        throw new Error(
          "校園正式記錄必須使用本次上傳的真實餐盤照片；示範照片不會寫入校園資料",
        );
      }
      const correctionValidation = aiAnalysisSchema.safeParse({
        ...analysis,
        detections: corrections,
      });
      if (!correctionValidation.success) {
        throw new Error(
          "人工修正包含空白名稱或不合理的份量，請逐項檢查後再確認。",
        );
      }
      const persistedBlob = imageBlob;
      const result = await repository.confirmScan({
        clientRequestId: requestIdRef.current,
        meal: {
          id: targetMeal?.id,
          classId: selectedClassId,
          servedOn: form.date,
          mealPeriod: "lunch",
          staple: form.staple,
          mainDish: form.mainDish,
          sideDishes: formSideDishes,
          plannedPeople: Number(form.people),
          actualPeople: targetMeal?.actualPeople ?? Number(form.people),
          totalSupplyG:
            targetMeal?.totalSupplyG ??
            Math.round(Number(form.supplyKg) * 1000),
          leftoverG:
            targetMeal?.leftoverG ?? Math.round(Number(form.leftoverKg) * 1000),
          measurementMethod: targetMeal?.measurementMethod ?? "scale",
          notes:
            form.notes ||
            "班級剩食以電子秤登錄；餐盤影像僅作食物類型與比例觀察",
          source: "manual",
        },
        imageBlob: persistedBlob,
        imageUrl: persistedBlob ? undefined : previewUrl,
        analysis,
        menuContext: plateScanMenuContext(analysisMenuContext),
        corrections: correctionValidation.data.detections,
      });
      await refresh();
      try {
        await discardDraft();
      } catch {
        toast.message("正式記錄已建立；本機草稿稍後可再手動捨棄。");
      }
      safeStorageRemove(getBrowserStorage("session"), REQUEST_STORAGE_KEY);
      setSaved(result);
      toast.success(
        analysis.provider === "human-manual"
          ? "已保存人工判讀與學生確認"
          : "已保存 AI 原始判斷與學生修正",
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("同一送出識別碼")) {
        await refresh();
        requestIdRef.current = createUuid();
        safeStorageSet(
          getBrowserStorage("session"),
          REQUEST_STORAGE_KEY,
          requestIdRef.current,
        );
      }
      toast.error(
        error instanceof Error ? error.message : "儲存失敗，草稿仍保留在畫面上",
      );
    } finally {
      setSaving(false);
    }
  };

  if (saved)
    return (
      <div className="page-wrap narrow">
        <PageHeader
          eyebrow="餐盤觀察表"
          title="這份餐盤已完成學生確認"
          description={
            storageMode === "cloud"
              ? "影像初步整理與人工修正已保存到學校私有雲端。"
              : storageMode === "indexeddb"
                ? "影像初步整理與人工修正已保存在這個瀏覽器，重新整理後仍可讀取。"
                : "影像初步整理與人工修正目前只在暫存記憶體；請立即下載備份，重新整理或關閉頁面後資料會遺失。"
          }
          icon={ShieldCheck}
        />
        <Panel className="success-panel">
          <span className="success-icon">
            <Check size={30} />
          </span>
          <h2>掃描紀錄建立完成</h2>
          <p>
            資料已進入「蒐集 → 分析 →
            修正」循環，接下來可以在每日紀錄與數據實驗室檢查它如何影響整體結果。
          </p>
          <div className="receipt">
            <span>
              餐期 ID <code>{saved.mealId}</code>
            </span>
            <span>
              掃描 ID <code>{saved.scanId}</code>
            </span>
            <span>
              儲存位置 <ScanStorageLocation storageMode={storageMode} />
            </span>
          </div>
          <nav className="scan-success-path" aria-label="完成掃描後的建議路徑">
            <p>
              <strong>讓這份餐盤繼續往前走</strong>
              先核對人機修正證據，再觀察整體資料，最後試算下一餐。
            </p>
            <ol>
              <li>
                <Link
                  href={`/records?meal=${encodeURIComponent(saved.mealId)}`}
                >
                  <span>01</span>
                  <strong>核對修正證據</strong>
                  <small>原始判斷與學生結果</small>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </li>
              <li>
                <Link href="/lab">
                  <span>02</span>
                  <strong>看資料如何改變</strong>
                  <small>跨日規律與樣本門檻</small>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </li>
              <li>
                <Link href="/forecast">
                  <span>03</span>
                  <strong>試算下一餐</strong>
                  <small>保守建議仍由人決定</small>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </li>
            </ol>
          </nav>
          <div className="button-row">
            {storageMode === "memory" && (
              <Link className="primary-action" href="/admin?tab=data">
                立即下載備份
                <ArrowRight size={17} />
              </Link>
            )}
            <button
              className="secondary-action"
              onClick={() => {
                setSaved(undefined);
                resetWorkspace();
              }}
            >
              再掃一份
            </button>
            <Link className="primary-action" href="/records">
              查看每日紀錄
              <ArrowRight size={17} />
            </Link>
          </div>
        </Panel>
      </div>
    );

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow={
          "餐盤觀察表｜No. " +
          String(snapshot.scans.length + 1).padStart(3, "0")
        }
        title="影像先整理，學生做最後確認"
        description="四步驟保留影像初判與學生修正證據；未勾選人工確認前，系統絕不寫入資料。"
        icon={ScanLine}
      />
      {draft && !draftDecisionMade && (
        <ScanDraftRecovery
          draft={draft}
          onResume={resumeDraft}
          onDiscard={() => void discardCurrentDraft()}
          busy={discardingDraft}
        />
      )}
      {draftError && (
        <div className="analysis-warning" role="status">
          <AlertTriangle size={18} />
          <span>{draftError}；正式資料不會受影響。</span>
        </div>
      )}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        目前第 {step} 步：{scanSteps[step - 1]}
      </p>
      <ol className="stepper" aria-label="掃描進度">
        {scanSteps.map((label, index) => (
          <li
            className={
              step === index + 1 ? "active" : step > index + 1 ? "done" : ""
            }
            aria-current={step === index + 1 ? "step" : undefined}
            key={label}
          >
            <span>{step > index + 1 ? <Check size={14} /> : index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      {step === 1 && (
        <Panel>
          <PanelTitle
            kicker="第 1 步"
            title="先確認這張照片屬於哪一餐"
            note="照片歸屬由學生明確選擇，不靠菜名自動猜測。"
            headingRef={stepHeadingRef}
            headingTabIndex={-1}
          />
          <div className="form-grid three">
            <label>
              <span>{mode === "demo-local" ? "示範記錄日期" : "日期"}</span>
              <input
                aria-label="日期"
                type="date"
                disabled={Boolean(targetMeal)}
                value={form.date}
                onChange={(event) => {
                  setMealChoice(null);
                  formBeforeAttachmentRef.current = undefined;
                  updateForm({ ...form, date: event.target.value });
                }}
              />
            </label>
            <label>
              <span>班級</span>
              <select
                aria-label="班級"
                disabled={Boolean(targetMeal)}
                value={selectedClassId}
                onChange={(event) => {
                  setMealChoice(null);
                  formBeforeAttachmentRef.current = undefined;
                  updateForm({ ...form, classId: event.target.value });
                }}
              >
                {selectableClasses.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>餐期</span>
              <select disabled>
                <option>午餐</option>
              </select>
            </label>
            <label>
              <span>主食</span>
              <input
                disabled={Boolean(targetMeal)}
                value={form.staple}
                onChange={(event) =>
                  updateForm({ ...form, staple: event.target.value })
                }
              />
            </label>
            <label>
              <span>主菜</span>
              <input
                disabled={Boolean(targetMeal)}
                value={form.mainDish}
                onChange={(event) =>
                  updateForm({ ...form, mainDish: event.target.value })
                }
              />
            </label>
            <label>
              <span>配菜（用頓號分隔）</span>
              <input
                disabled={Boolean(targetMeal)}
                value={form.sides}
                onChange={(event) =>
                  updateForm({ ...form, sides: event.target.value })
                }
              />
            </label>
            <label>
              <span>實際人數</span>
              <input
                type="number"
                min="1"
                max="100"
                disabled={Boolean(targetMeal)}
                value={form.people}
                onChange={(event) =>
                  updateForm({
                    ...form,
                    people:
                      event.target.value === ""
                        ? ""
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>總供應重量（kg）</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                disabled={Boolean(targetMeal)}
                value={form.supplyKg}
                onChange={(event) =>
                  updateForm({
                    ...form,
                    supplyKg:
                      event.target.value === ""
                        ? ""
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>全班餐後剩食秤重（kg）</span>
              <input
                type="number"
                min="0"
                max={
                  targetMeal ? targetMeal.totalSupplyG / 1000 : form.supplyKg
                }
                step="0.1"
                disabled={Boolean(targetMeal)}
                value={
                  targetMeal ? targetMeal.leftoverG / 1000 : form.leftoverKg
                }
                onChange={(event) =>
                  updateForm({
                    ...form,
                    leftoverKg:
                      event.target.value === ""
                        ? ""
                        : Number(event.target.value),
                  })
                }
              />
              <small>
                班級剩食率只使用這筆餐期量測，不會拿單張餐盤估計代替。
              </small>
            </label>
            <label className="span-3">
              <span>備註（選填）</span>
              <input
                disabled={Boolean(targetMeal)}
                value={form.notes}
                placeholder="例如：今天有戶外課、雨天、菜色第一次供應"
                onChange={(event) =>
                  updateForm({ ...form, notes: event.target.value })
                }
              />
            </label>
          </div>
          {targetMeal && (
            <div
              className="privacy-callout meal-target-confirmation"
              role="status"
            >
              <Info size={20} />
              <div>
                <strong>
                  {linkedMeal ? "已鎖定指定餐期" : "已選擇加入這筆既有餐期"}
                </strong>
                <p>
                  將為 {targetMeal.servedOn}・
                  {classNameForScan(snapshot, targetMeal.classId)}・
                  {targetMeal.staple}／{targetMeal.mainDish} 新增第
                  {targetScanCount + 1}
                  份餐盤；日期、班級、菜單、人數、供應與剩食秤重均已鎖定。原餐期的{" "}
                  {(targetMeal.leftoverG / 1000).toFixed(1)} kg
                  秤重保持不變，這張照片只會追加餐盤證據。
                </p>
                {!linkedMeal && (
                  <button
                    type="button"
                    className="text-action meal-choice-change"
                    onClick={reconsiderMealChoice}
                  >
                    重新選擇餐期歸屬
                  </button>
                )}
              </div>
            </div>
          )}
          {!linkedMeal && sameDayMeals.length > 0 && mealChoice === null && (
            <section
              className="meal-choice-panel"
              aria-labelledby="meal-choice-title"
            >
              <AlertTriangle size={20} />
              <div>
                <strong id="meal-choice-title">
                  此班今天已有午餐資料，請選擇照片歸屬
                </strong>
                <p>
                  即使菜單文字完全相同，系統也不會自行合併。先檢查既有秤重，再決定加入舊餐期或建立另一筆獨立供餐。
                </p>
                <div className="meal-option-grid">
                  {sameDayMeals.map((meal) => (
                    <article className="meal-option-card" key={meal.id}>
                      <div>
                        <span>既有午餐</span>
                        <strong>
                          {meal.staple}・{meal.mainDish}
                        </strong>
                        <p>配菜：{meal.sideDishes.join("、") || "未登錄"}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>供應</dt>
                          <dd>{(meal.totalSupplyG / 1000).toFixed(1)} kg</dd>
                        </div>
                        <div>
                          <dt>餐後秤重</dt>
                          <dd>{(meal.leftoverG / 1000).toFixed(1)} kg</dd>
                        </div>
                        <div>
                          <dt>已有餐盤</dt>
                          <dd>
                            {
                              snapshot.scans.filter(
                                (scan) => scan.mealRecordId === meal.id,
                              ).length
                            }{" "}
                            份
                          </dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="primary-action"
                        aria-label={`加入既有餐期：${meal.staple}・${meal.mainDish}`}
                        onClick={() => chooseExistingMeal(meal)}
                      >
                        加入這筆既有餐期
                      </button>
                    </article>
                  ))}
                </div>
                <div className="new-meal-option">
                  <div>
                    <strong>這是另一批獨立供餐？</strong>
                    <p>
                      只有供應與全班秤重確實分開時，才建立新餐期；既有資料不會被改寫。
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      markDraftDirty();
                      formBeforeAttachmentRef.current = undefined;
                      setMealChoice({ kind: "new" });
                    }}
                  >
                    建立新的獨立餐期
                  </button>
                </div>
              </div>
            </section>
          )}
          {!linkedMeal && mealChoice?.kind === "new" && (
            <div
              className="analysis-warning new-meal-confirmation"
              role="status"
            >
              <Check size={20} />
              <div>
                <strong>已選擇建立新的獨立餐期</strong>
                <p>
                  系統會使用目前欄位建立新餐期，不會連到今天任何既有秤重。請再確認這確實是另一批供餐。
                </p>
                <button
                  type="button"
                  className="text-action meal-choice-change"
                  onClick={reconsiderMealChoice}
                >
                  重新選擇餐期歸屬
                </button>
              </div>
            </div>
          )}
          <p
            id="scan-meal-requirements"
            className="cta-requirements"
            role="status"
            aria-live="polite"
          >
            {stepOneMissingRequirements.length
              ? `還缺：${stepOneMissingRequirements.join("、")}`
              : "餐期資料已齊全，可以選擇餐盤。"}
          </p>
          <div className="button-row end">
            <button
              className="primary-action"
              disabled={stepOneMissingRequirements.length > 0}
              aria-describedby="scan-meal-requirements"
              onClick={() => {
                updateForm({ ...form, classId: selectedClassId });
                markDraftDirty();
                setStep(2);
              }}
            >
              下一步：選擇餐盤
              <ArrowRight size={17} />
            </button>
          </div>
        </Panel>
      )}
      {step === 2 && (
        <div className="scan-layout">
          <Panel>
            <PanelTitle
              kicker="第 2 步"
              title="拍攝或選擇剩食餐盤"
              note={
                mode === "school-cloud"
                  ? "校園正式記錄必須先上傳本餐的真實餐盤照片，才能分析、人工判讀或保存。"
                  : "支援手機相機、圖片上傳與三張獨家示範照片。"
              }
              headingRef={stepHeadingRef}
              headingTabIndex={-1}
            />
            {mode === "school-cloud" && (
              <div className="analysis-warning" role="status">
                <Upload size={18} />
                <span>
                  尚未上傳時，分析、人工判讀與保存功能會保持鎖定；AI
                  生成示範照片不會出現在校園正式流程，也不能寫入雲端。
                </span>
              </div>
            )}
            <div className="privacy-callout">
              <ShieldCheck size={20} />
              <div>
                <strong>拍攝前隱私檢查</strong>
                <p>
                  只拍餐盤，請勿包含人臉、姓名、學號、座號或學生作品。上傳後會重編碼並移除
                  EXIF。
                </p>
              </div>
            </div>
            <div
              className={
                menuCandidateContext ? "privacy-callout" : "analysis-warning"
              }
              role="status"
            >
              {menuCandidateContext ? (
                <ShieldCheck size={20} />
              ) : (
                <Info size={18} />
              )}
              <div>
                <strong>
                  {menuCandidateContext
                    ? `可提供 ${menuCandidateContext.candidates.length} 道已確認菜單候選`
                    : "本次不使用菜單候選"}
                </strong>
                <p>
                  {menuCandidateContext
                    ? `來源：${menuContextSourceLabel(menuCandidateContext)}，由 ${menuCandidateContext.reviewedBy} 人工確認${menuCandidateContext.substitutionCount > 0 ? `，含 ${menuCandidateContext.substitutionCount} 道現場換菜` : ""}。候選只協助名稱與類型；臨時換菜和照片證據仍可優先，份量與剩餘比例不由菜單決定。`
                    : "目前餐期找不到一筆精確連結、版本一致且已人工確認的菜單；模型只依照片初判，不會把同日菜名或手動輸入冒充確認資料。"}
                </p>
              </div>
            </div>
            {!secureContext && (
              <div className="analysis-warning" role="status">
                <AlertTriangle size={18} />
                <span>
                  {mode === "school-cloud"
                    ? "目前是區網 HTTP 連線；仍可從圖庫上傳真實照片。若手機沒有出現相機選項，請改用受信任的 HTTPS 現場連結。"
                    : "目前是區網 HTTP 連線；圖庫、示範照片與人工判讀仍可使用。若手機沒有出現相機選項，請改用受信任的 HTTPS 現場連結。"}
                </span>
              </div>
            )}
            {analysisError && (
              <div className="analysis-warning analysis-recovery" role="alert">
                <AlertTriangle size={18} />
                <div>
                  <span>
                    <strong>分析未完成：</strong>
                    {analysisError}
                    。系統沒有無聲改用示範辨識，請由你選擇接下來的路徑。
                  </span>
                  <div className="button-row">
                    <button
                      className="secondary-action"
                      disabled={cloudImageMissing}
                      onClick={() => void runAnalysis()}
                    >
                      重試真實分析
                    </button>
                    <button
                      className="secondary-action"
                      onClick={() => {
                        markDraftDirty();
                        setAnalysisMode("mock");
                        setAnalysisError(undefined);
                      }}
                    >
                      改用示範辨識
                    </button>
                    <button
                      className="primary-action"
                      disabled={cloudImageMissing}
                      onClick={startManualReview}
                    >
                      <Pencil size={16} />
                      建立人工判讀表
                    </button>
                  </div>
                </div>
              </div>
            )}
            <button
              className="dropzone"
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void chooseFile(event.dataTransfer.files[0]);
              }}
            >
              <Upload size={28} />
              <strong>
                {mode === "school-cloud"
                  ? "上傳本餐的真實餐盤照片"
                  : "拖曳圖片到這裡，或點擊選擇"}
              </strong>
              <span>JPEG / PNG / WebP · 原檔 5MB 以下 · 處理後最多 4MB</span>
            </button>
            <input
              ref={galleryInputRef}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                void chooseFile(file);
              }}
            />
            <input
              ref={cameraInputRef}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                void chooseFile(file);
              }}
            />
            <div className="photo-source-actions" aria-label="餐盤照片來源">
              <button
                type="button"
                className="secondary-action"
                onClick={() => galleryInputRef.current?.click()}
              >
                <FileImage size={16} />
                從相簿或檔案選擇
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={16} />
                使用手機相機拍照
              </button>
            </div>
            {mode === "demo-local" && (
              <>
                <div className="demo-title">
                  <FileImage size={16} />
                  <strong>AI 生成示範照片</strong>
                  <span>僅供競賽流程展示，不是實測餐盤</span>
                </div>
                <div className="demo-image-grid">
                  {demoImages.map((item) => (
                    <button
                      className={selectedImage === item.src ? "selected" : ""}
                      onClick={() => chooseDemo(item)}
                      key={item.src}
                    >
                      <Image
                        src={item.src}
                        alt={`${item.name}，AI 生成示範照片`}
                        width={220}
                        height={250}
                        loading={item === demoImages[0] ? "eager" : "lazy"}
                        fetchPriority={
                          item === demoImages[0] ? "high" : undefined
                        }
                      />
                      <span>{item.name}</span>
                      {selectedImage === item.src && (
                        <i>
                          <Check size={14} />
                        </i>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="analysis-mode">
              <span>辨識模型</span>
              <button
                type="button"
                className={analysisMode === "real" ? "active" : ""}
                onClick={() => {
                  markDraftDirty();
                  setAnalysisMode("real");
                }}
              >
                ✨ Gemini AI（真實視覺辨識）
              </button>
              <button
                type="button"
                className={analysisMode === "mock" ? "active" : ""}
                onClick={() => {
                  markDraftDirty();
                  setAnalysisMode("mock");
                }}
              >
                示範情境（離線展示）
              </button>
            </div>
            <div className="mt-2.5 flex items-center justify-between p-2 rounded bg-[#f6faf6] border border-[#c8e6c9] text-xs">
              <span className="text-[#2e7d32] font-semibold flex items-center gap-1">
                <span>✨</span>
                {typeof window !== "undefined" &&
                window.localStorage.getItem("foodlens_gemini_api_key")
                  ? "已載入自訂 Gemini API Key"
                  : "Google Gemini 2.0 Flash 多模態辨識"}
              </span>
              <button
                type="button"
                className="px-2 py-0.5 rounded bg-white border border-[#81c784] text-[#2e7d32] font-bold hover:bg-[#c8e6c9] transition"
                onClick={() => {
                  const current =
                    window.localStorage.getItem("foodlens_gemini_api_key") ||
                    "";
                  const input = window.prompt(
                    "請輸入 Google Gemini API Key（可至 aistudio.google.com 免費取得；留空則使用系統預設）：",
                    current,
                  );
                  if (input !== null) {
                    if (input.trim()) {
                      window.localStorage.setItem(
                        "foodlens_gemini_api_key",
                        input.trim(),
                      );
                      toast.success("Gemini API Key 已儲存至瀏覽器！");
                    } else {
                      window.localStorage.removeItem(
                        "foodlens_gemini_api_key",
                      );
                      toast.info("已清除自訂 Key，將使用系統環境設定。");
                    }
                  }
                }}
              >
                🔑 自訂 Key
              </button>
            </div>
          </Panel>
          <aside className="preview-panel">
            {previewUrl ? (
              <div className="image-frame">
                <Image
                  src={previewUrl}
                  alt="準備分析的餐盤預覽"
                  fill
                  unoptimized={previewUrl.startsWith("blob:")}
                  sizes="(max-width: 600px) 62vw, (max-width: 850px) 220px, 36vw"
                  loading="eager"
                  fetchPriority="high"
                />
              </div>
            ) : (
              <div className="image-frame upload-required" role="status">
                <Upload size={32} />
                <strong>等待真實餐盤照片</strong>
                <span>上傳完成後才會顯示預覽並開放下一步。</span>
              </div>
            )}
            <span className="source-badge">
              <ScanLine size={14} />
              {imageBlob
                ? "本次上傳照片"
                : mode === "demo-local"
                  ? "AI 生成示範照片"
                  : "尚未上傳"}
            </span>
            <p>
              <Info size={15} />
              影像只能估計比例；克數會以標準原始份量 × 估計比例計算。
            </p>
            <p id="manual-review-note">
              <Pencil size={15} />
              已完成觀察時可直接建立人工判讀表；這個操作不會呼叫 AI 或任何模型。
            </p>
          </aside>
          <div className="button-row span-all">
            <button
              className="secondary-action"
              onClick={() => {
                markDraftDirty();
                setStep(1);
              }}
            >
              <ArrowLeft size={17} />
              上一步
            </button>
            <button
              className="secondary-action"
              aria-describedby="manual-review-note scan-photo-requirements"
              disabled={cloudImageMissing}
              onClick={startManualReview}
            >
              <Pencil size={16} />
              直接建立人工判讀表
            </button>
            <button
              className="primary-action"
              aria-describedby="scan-photo-requirements"
              disabled={cloudImageMissing}
              onClick={() => void runAnalysis()}
            >
              <ScanLine size={17} />
              開始{analysisMode === "mock" ? "示範辨識" : "真實模型分析"}
            </button>
          </div>
          <p
            id="scan-photo-requirements"
            className="cta-requirements span-all"
            role="status"
            aria-live="polite"
          >
            {cloudImageMissing
              ? "還缺：一張本餐的真實餐盤照片。"
              : "照片條件已符合，可以選擇人工判讀或影像分析。"}
          </p>
        </div>
      )}
      {step === 3 && (
        <Panel className="analysis-running">
          <div className="scanner-visual">
            <div className="scan-photo">
              <Image
                src={previewUrl}
                alt="正在分析的餐盤"
                fill
                unoptimized={previewUrl.startsWith("blob:")}
                sizes="(max-width: 600px) 240px, (max-width: 850px) 360px, 480px"
                loading="eager"
                fetchPriority="high"
              />
            </div>
          </div>
          <div aria-live="polite" className="analysis-status">
            <span className="source-badge">
              <ScanLine size={14} />
              {analysisMode === "mock"
                ? "示範辨識 · 固定規則 v1"
                : "真實模型 · 教師登入"}
            </span>
            <h2 ref={stepHeadingRef} tabIndex={-1}>
              正在把餐盤變成可檢查的資料
            </h2>
            <div className="analysis-progress" aria-hidden="true">
              <span
                style={{ width: `${((stage + 1) / stages.length) * 100}%` }}
              />
            </div>
            <div className="stage-list">
              {stages.map((label, index) => (
                <div className={stage >= index ? "active" : ""} key={label}>
                  <span>{stage > index ? <Check size={14} /> : index + 1}</span>
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
            <p>
              {analysisMode === "mock"
                ? "示範辨識不需要 API Key；相同照片會得到可重現的結果。"
                : "照片只送往教師設定的伺服器端模型，不會在瀏覽器暴露 API Key。"}
            </p>
            <p>
              {analysisMenuContext
                ? `同時提供 ${analysisMenuContext.candidates.length} 道已確認菜單候選；照片證據仍可推翻候選。`
                : "本次沒有提供已確認菜單候選，不會用菜名替照片作答。"}
            </p>
          </div>
        </Panel>
      )}
      {step === 4 && analysis && (
        <div className="review-layout">
          <Panel>
            <PanelTitle
              kicker="第 4 步｜學生校正"
              title={
                isManualAnalysis
                  ? "沒有模型也能建立可稽核資料"
                  : "逐項檢查影像初判"
              }
              note={
                isManualAnalysis
                  ? "系統已依菜單建立三個起始項目；請由學生填寫類型、標準份量與剩餘比例。"
                  : "調整滑桿後，剩餘克數會重新計算。"
              }
              headingRef={stepHeadingRef}
              headingTabIndex={-1}
            />
            <div className="analysis-warning" role="status">
              <AlertTriangle size={18} />
              <div>
                <strong>辨識限制與資料來源</strong>
                {analysis.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </div>
            <div
              className={
                analysisMenuContext ? "privacy-callout" : "analysis-warning"
              }
              role="status"
            >
              {analysisMenuContext ? (
                <ShieldCheck size={20} />
              ) : (
                <Info size={18} />
              )}
              <div>
                <strong>
                  {analysisMenuContext
                    ? `這次辨識使用了 ${analysisMenuContext.candidates.length} 道菜單候選`
                    : analysisMenuContext === null
                      ? "這次辨識沒有使用菜單候選"
                      : "草稿未保留當時的菜單候選來源"}
                </strong>
                <p>
                  {analysisMenuContext
                    ? `來源：${menuContextSourceLabel(analysisMenuContext)}；候選只幫助初判名稱與類型，沒有取代照片證據或學生修正。`
                    : analysisMenuContext === null
                      ? "結果沒有受到已確認菜單提示影響；仍需逐項由學生檢查。"
                      : "為避免把目前菜單冒充成分析當時的來源，系統不作推定；如需菜單輔助，請返回上一步重新分析。"}
                </p>
              </div>
            </div>
            <div className="detection-list">
              {corrections.map((item, index) => {
                const original = analysis.detections[index];
                const changed =
                  JSON.stringify(item) !== JSON.stringify(original);
                return (
                  <article
                    className={changed ? "changed" : ""}
                    key={`${item.category}-${index}`}
                  >
                    <div className="detection-head">
                      <span>項目 {index + 1}</span>
                      <b>
                        {isManualAnalysis
                          ? "人工起始項目"
                          : analysis.isMock
                            ? `示範分數 ${Math.round(original.confidence * 100)}%`
                            : `AI 信心 ${Math.round(original.confidence * 100)}%`}
                      </b>
                      {changed && (
                        <em>
                          <Pencil size={12} />
                          已人工修正
                        </em>
                      )}
                    </div>
                    <div className="detection-fields">
                      <label>
                        <span>類型</span>
                        <select
                          value={item.category}
                          onChange={(event) =>
                            updateCorrection(
                              index,
                              "category",
                              event.target.value,
                            )
                          }
                        >
                          {FOOD_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {CATEGORY_LABELS[category]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>
                          {isManualAnalysis ? "食物名稱" : "辨識名稱"}
                        </span>
                        <input
                          value={item.label}
                          onChange={(event) =>
                            updateCorrection(index, "label", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>標準原始份量</span>
                        <div className="suffix-input">
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={item.originalG}
                            onChange={(event) =>
                              updateCorrection(
                                index,
                                "originalG",
                                Number(event.target.value),
                              )
                            }
                          />
                          <i>g</i>
                        </div>
                      </label>
                    </div>
                    <div className="ratio-editor">
                      <div>
                        <span>剩餘比例</span>
                        <strong>
                          {Math.round(item.remainingRatio * 100)}%
                        </strong>
                      </div>
                      <input
                        aria-label={`${item.label}剩餘比例`}
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(item.remainingRatio * 100)}
                        onChange={(event) =>
                          updateCorrection(
                            index,
                            "remainingRatio",
                            Number(event.target.value) / 100,
                          )
                        }
                      />
                      <output>
                        約 <strong>{item.remainingG}g</strong> 剩餘
                      </output>
                    </div>
                    <details>
                      <summary>
                        {isManualAnalysis ? "比較人工起始值" : "比較 AI 原始值"}
                      </summary>
                      <p>
                        {CATEGORY_LABELS[original.category]} ·{" "}
                        {Math.round(original.remainingRatio * 100)}% ·{" "}
                        {original.remainingG}g
                      </p>
                    </details>
                  </article>
                );
              })}
            </div>
            <DetectiveNotebookInspector />
          </Panel>
          <aside className="review-summary">
            <div className="image-frame compact">
              <Image
                src={previewUrl}
                alt="已完成分析的餐盤"
                fill
                unoptimized={previewUrl.startsWith("blob:")}
                sizes="(max-width: 600px) 58vw, (max-width: 850px) 96px, 330px"
                loading="eager"
                fetchPriority="high"
              />
            </div>
            <span className="source-badge">
              <ScanLine size={14} />
              {isManualAnalysis
                ? "人工判讀 · 無 AI 模型輸出"
                : analysis.isMock
                  ? "示範辨識 · 固定規則 v1"
                  : `真實 AI · ${analysis.provider} / ${analysis.model}`}
            </span>
            <h2>人工確認後的總估計</h2>
            <strong className="big-number">
              {corrections.reduce((sum, item) => sum + item.remainingG, 0)}
              <small>g</small>
            </strong>
            <p>此數字是目前項目的估計值加總，不是電子秤實測。</p>
            <p>班級統計另用第 1 步的全班秤重；這份影像只增加食物類型觀察。</p>
            <label className="check-card">
              <input
                type="checkbox"
                checked={humanChecked}
                onChange={(event) => setHumanChecked(event.target.checked)}
              />
              <span>
                <strong>我已逐項人工檢查</strong>
                <small>確認照片沒有個資，並理解重量只是估計。</small>
              </span>
            </label>
            <button
              className="primary-action full"
              disabled={!humanChecked || saving || cloudImageMissing}
              onClick={() => void save()}
            >
              {saving ? "正在儲存…" : "確認並寫入資料"}
              <Check size={17} />
            </button>
            <button
              className="secondary-action full"
              onClick={() => {
                markDraftDirty();
                setStep(2);
              }}
            >
              <FileImage size={16} />
              更換照片
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
