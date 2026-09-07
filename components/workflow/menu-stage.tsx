"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Check,
  FileSpreadsheet,
  ImagePlus,
  RefreshCw,
  ScanText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
} from "lucide-react";
import styles from "@/app/(dashboard)/workflow/workflow.module.css";
import { sha256Hex } from "@/lib/crypto";
import { prepareMenuImage } from "@/lib/image";
import {
  COOKING_METHODS,
  LOW_CONFIDENCE_THRESHOLD,
  MENU_DISH_ROLES,
  type AcceptedLowConfidence,
  type CookingMethod,
  type MenuConfidenceField,
  type MenuDishRole,
  type MenuImportSource,
  type MenuVersion,
} from "@/lib/menu-intelligence";
import type { MenuOcrAnalysis, MenuOcrAnalysisMode } from "@/lib/menu-ocr";
import { FOOD_CATEGORIES, type FoodCategory } from "@/lib/types";

type EditableDishField =
  | "normalizedName"
  | "role"
  | "category"
  | "cookingMethod"
  | "portionG"
  | "recipeVersion"
  | "vendorId";
type EditableDishValue =
  string | number | null | FoodCategory | CookingMethod | MenuDishRole;
type ActionableMenuSource = Exclude<MenuImportSource, "structured">;

export interface MenuStageProps {
  menu: MenuVersion;
  source: MenuImportSource;
  importText: string;
  onSourceChange: (source: MenuImportSource) => void;
  onImportTextChange: (value: string) => void;
  onImport: () => void | Promise<void>;
  photoAnalysisMode: MenuOcrAnalysisMode;
  allowRealMenuAi: boolean;
  allowGeneratedDemoPhoto: boolean;
  onPhotoAnalysisModeChange: (mode: MenuOcrAnalysisMode) => void;
  onAnalyzePhoto: (input: {
    image: Blob;
    fingerprint: string;
    mode: MenuOcrAnalysisMode;
    isAiGenerated: boolean;
  }) => Promise<MenuOcrAnalysis>;
  onConfirm: (
    acceptedLowConfidence: AcceptedLowConfidence[],
  ) => void | Promise<void>;
  onDishFieldChange: (
    index: number,
    field: EditableDishField,
    value: EditableDishValue,
  ) => void;
  onSubstitutionToggle: (enabled: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
}

const SOURCE_OPTIONS: readonly {
  value: ActionableMenuSource;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "demo",
    label: "示範菜單",
    description: "固定範例，不呼叫真實 AI",
    icon: Sparkles,
  },
  {
    value: "csv",
    label: "表格貼上",
    description: "校方或供餐業者的 CSV",
    icon: FileSpreadsheet,
  },
  {
    value: "ocr",
    label: "菜單照片",
    description: "拍照 OCR 初判，學生再核對",
    icon: ScanText,
  },
] as const;

const SOURCE_LABELS: Record<MenuImportSource, string> = {
  structured: "結構化資料",
  csv: "CSV 表格",
  ocr: "菜單照片／OCR 草稿",
  demo: "Mock 示範",
};

const CATEGORY_LABELS: Record<FoodCategory, string> = {
  rice: "米飯／粥",
  noodles: "麵食",
  meat: "肉／魚",
  vegetable: "蔬菜",
  egg: "蛋",
  fruit: "水果",
  other: "其他",
};

const COOKING_METHOD_LABELS: Record<CookingMethod, string> = {
  steamed: "蒸",
  boiled: "煮／汆燙",
  braised: "滷／紅燒",
  stewed: "燉／燴",
  "stir-fried": "炒",
  "pan-fried": "煎",
  "deep-fried": "炸",
  baked: "烤／焗",
  "cold-mixed": "涼拌",
  soup: "湯／羹",
  raw: "生食",
  unknown: "待確認",
};

const ROLE_LABELS: Record<MenuDishRole, string> = {
  staple: "主食",
  main: "主菜",
  side: "配菜",
  soup: "湯品",
  fruit: "水果",
  other: "其他／未知",
};

const CONFIDENCE_FIELD_LABELS: Record<MenuConfidenceField, string> = {
  rawName: "原始菜名",
  role: "餐點角色",
  category: "食物類別",
  cookingMethod: "烹調法",
  primaryIngredientCandidates: "主食材",
  portionG: "每人份量",
  recipeVersion: "食譜版本",
  vendorId: "供餐業者",
};

function sourceIsActive(
  source: MenuImportSource,
  option: ActionableMenuSource,
) {
  return option === "csv"
    ? source === "csv" || source === "structured"
    : source === option;
}

function importCopy(source: MenuImportSource) {
  if (source === "demo") {
    return {
      label: "示範案例代號（可留空）",
      hint: "相同代號會載入相同的 Mock OCR 菜單，方便重複展示。",
      placeholder: "例如：judge-demo",
      action: "載入示範菜單",
    };
  }
  if (source === "ocr") {
    return {
      label: "OCR 辨識原文",
      hint: "照片初判後可在這裡修正原文；每行可使用「主食：」「主菜：」「副菜：」「湯品：」「水果：」標示。",
      placeholder: "主食：糙米飯\n主菜：咖哩雞丁\n副菜一：清炒高麗菜",
      action: "以修正後原文重新解析",
    };
  }
  return {
    label: source === "structured" ? "已匯入的結構化來源" : "CSV 表格內容",
    hint:
      source === "structured"
        ? "目前版本來自結構化資料；若要重新匯入，選擇上方「表格貼上」。"
        : "至少包含「菜色名稱」欄；可加入角色、類別、烹調法、份量、食譜版本與供應商。",
    placeholder:
      "菜色名稱,角色,類別,烹調法,份量,食譜版本,供應商\n咖哩雞丁,主菜,肉類,燉,85,v3,業者甲",
    action: source === "structured" ? "結構化資料已載入" : "解析 CSV 表格",
  };
}

function lowestConfidence(menu: MenuVersion, dishIndex: number) {
  const values = Object.values(menu.plannedDishes[dishIndex].confidenceByField);
  return Math.min(...values);
}

function substitutionSummary(menu: MenuVersion) {
  if (menu.substitutions.length === 0) {
    return "目前實際供餐與原計畫相同；若現場換菜，請另存實際菜色，不覆蓋原資料。";
  }
  return menu.substitutions
    .map((substitution) => {
      const planned = menu.plannedDishes.find(
        (dish) => dish.signature === substitution.plannedDishSignature,
      );
      return `${planned?.rawName ?? "原計畫菜色"} → ${substitution.actualDish.rawName}`;
    })
    .join("；");
}

export function MenuStage({
  menu,
  source,
  importText,
  onSourceChange,
  onImportTextChange,
  onImport,
  photoAnalysisMode,
  allowRealMenuAi,
  allowGeneratedDemoPhoto,
  onPhotoAnalysisModeChange,
  onAnalyzePhoto,
  onConfirm,
  onDishFieldChange,
  onSubstitutionToggle,
  disabled = false,
  busy = false,
}: MenuStageProps) {
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef("");
  const [selectedPhoto, setSelectedPhoto] = useState<
    | {
        image: Blob;
        name: string;
        fingerprint: string;
        isAiGenerated: boolean;
      }
    | undefined
  >();
  const [previewUrl, setPreviewUrl] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const [photoResult, setPhotoResult] = useState<MenuOcrAnalysis>();
  const [reviewedLowConfidenceDishes, setReviewedLowConfidenceDishes] =
    useState<Set<number>>(() => new Set());
  const controlsDisabled = disabled || busy || photoBusy;
  const menuLocked = controlsDisabled || menu.status === "confirmed";
  const copy = importCopy(source);
  const hasSubstitutions = menu.substitutions.length > 0;
  const canImport = source !== "structured";
  const lowConfidenceDishIndexes = menu.plannedDishes.flatMap((dish, index) =>
    dish.lowConfidenceFields.length > 0 ? [index] : [],
  );
  const unreviewedLowConfidenceCount = lowConfidenceDishIndexes.filter(
    (index) => !reviewedLowConfidenceDishes.has(index),
  ).length;

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const clearSelectedPhoto = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
    setPreviewUrl("");
    setSelectedPhoto(undefined);
    setPhotoResult(undefined);
    setReviewedLowConfidenceDishes(new Set());
  };

  const preparePhoto = async (file: File, isAiGenerated = false) => {
    setPhotoBusy(true);
    setPhotoError(undefined);
    clearSelectedPhoto();
    try {
      const image = await prepareMenuImage(file);
      const contentHash = await sha256Hex(await image.arrayBuffer());
      const url = URL.createObjectURL(image);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setSelectedPhoto({
        image,
        name: file.name,
        fingerprint: `${
          isAiGenerated ? "ai-generated-menu-sheet:" : ""
        }sha256:${contentHash}`,
        isAiGenerated,
      });
    } catch (error) {
      setPhotoError(
        error instanceof Error ? error.message : "無法使用這張菜單圖片",
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const loadGeneratedDemoPhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(undefined);
    clearSelectedPhoto();
    try {
      const response = await fetch("/demo/menu-sheet-ai.png");
      if (!response.ok) throw new Error("示範照片尚未就緒");
      const sourceBlob = await response.blob();
      await preparePhoto(
        new File([sourceBlob], "foodlens-ai-generated-menu.png", {
          type: sourceBlob.type || "image/png",
        }),
        true,
      );
    } catch (error) {
      setPhotoError(
        error instanceof Error ? error.message : "無法載入示範照片",
      );
      setPhotoBusy(false);
    }
  };

  const analyzePhoto = async () => {
    if (!selectedPhoto) {
      setPhotoError("請先選擇或拍攝一張菜單照片");
      return;
    }
    setPhotoBusy(true);
    setPhotoError(undefined);
    setPhotoResult(undefined);
    setReviewedLowConfidenceDishes(new Set());
    try {
      const result = await onAnalyzePhoto({
        image: selectedPhoto.image,
        fingerprint: selectedPhoto.fingerprint,
        mode: photoAnalysisMode,
        isAiGenerated: selectedPhoto.isAiGenerated,
      });
      setPhotoResult(result);
    } catch (error) {
      setPhotoError(
        `${error instanceof Error ? error.message : "菜單照片分析失敗"}；系統沒有偷偷改用 Mock。`,
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const changeDishField = (
    index: number,
    field: EditableDishField,
    next: EditableDishValue,
  ) => {
    setReviewedLowConfidenceDishes((current) => {
      const updated = new Set(current);
      updated.delete(index);
      return updated;
    });
    onDishFieldChange(index, field, next);
  };

  const confirmReviewedMenu = () => {
    const acceptedLowConfidence = lowConfidenceDishIndexes
      .filter((index) => reviewedLowConfidenceDishes.has(index))
      .map((index) => ({
        dishSignature: menu.plannedDishes[index].signature,
        fields: [...menu.plannedDishes[index].lowConfidenceFields],
      }));
    return onConfirm(acceptedLowConfidence);
  };

  return (
    <section aria-labelledby="menu-stage-title" aria-busy={busy || photoBusy}>
      <header className={styles.stageHeader}>
        <div>
          <span>STEP 01 · 建立當日菜單</span>
          <h2 id="menu-stage-title">先認菜，再辨識餐盤</h2>
          <p>
            FoodLens
            保留供餐端的原始菜名，再由學生逐項核對菜名、角色、類別、烹調法、份量與供餐來源；只有確認後的菜單，才會成為餐盤辨識候選。
          </p>
        </div>
        <span
          className={`${styles.statusPill} ${
            menu.status === "draft" ? styles.draft : ""
          }`}
          aria-live="polite"
        >
          {menu.status === "confirmed" ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <TriangleAlert size={13} aria-hidden="true" />
          )}
          {menu.status === "confirmed" ? "人工已確認" : "等待人工確認"}
        </span>
      </header>

      <div
        className={styles.sourceGrid}
        role="group"
        aria-label="選擇菜單匯入方式"
      >
        {SOURCE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = sourceIsActive(source, option.value);
          return (
            <button
              className={`${styles.sourceButton} ${
                active ? styles.activeSource : ""
              }`}
              type="button"
              aria-pressed={active}
              disabled={controlsDisabled}
              onClick={() => {
                if (option.value !== source) clearSelectedPhoto();
                onSourceChange(option.value);
              }}
              key={option.value}
            >
              <Icon size={19} aria-hidden="true" />
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          );
        })}
      </div>

      {source === "ocr" && (
        <div className={styles.photoOcrWorkbench}>
          <div className={styles.photoOcrHeading}>
            <div>
              <span>MENU PHOTO · HUMAN REVIEW</span>
              <h3>拍下紙本菜單，先轉成可修正的草稿</h3>
              <p>
                照片會先在瀏覽器重編碼、移除
                EXIF；請避開人臉、姓名、學號與座號。初版只保存 OCR
                原文與人工修正，菜單照片只用於本次分析。
              </p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>

          <div
            className={styles.photoDropzone}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (controlsDisabled) return;
              const file = event.dataTransfer.files[0];
              if (file) void preparePhoto(file);
            }}
          >
            <input
              hidden
              ref={libraryInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="選擇菜單圖片"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void preparePhoto(file);
              }}
            />
            <input
              hidden
              ref={cameraInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              aria-label="拍攝菜單圖片"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void preparePhoto(file);
              }}
            />

            {previewUrl ? (
              <div className={styles.menuPhotoPreview}>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="開啟菜單照片大圖"
                >
                  <Image
                    src={previewUrl}
                    alt={
                      selectedPhoto?.isAiGenerated
                        ? "AI 生成的校園午餐菜單示範照片"
                        : "待辨識的菜單照片預覽"
                    }
                    fill
                    sizes="240px"
                    unoptimized
                  />
                </a>
                <span>
                  {selectedPhoto?.isAiGenerated
                    ? "AI 生成示範照片"
                    : "使用者上傳照片"}
                </span>
              </div>
            ) : (
              <div className={styles.photoPlaceholder}>
                <ImagePlus size={24} aria-hidden="true" />
                <strong>拖曳菜單照片到這裡</strong>
                <small>JPEG、PNG、WebP 原檔最大 5MB</small>
              </div>
            )}

            <div className={styles.photoActions}>
              <button
                className="secondary-action"
                type="button"
                disabled={controlsDisabled}
                onClick={() => libraryInputRef.current?.click()}
              >
                <Upload size={15} aria-hidden="true" /> 選擇圖片
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={controlsDisabled}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={15} aria-hidden="true" /> 手機拍照
              </button>
              {allowGeneratedDemoPhoto && (
                <button
                  className="ghost-button"
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => void loadGeneratedDemoPhoto()}
                >
                  <Sparkles size={15} aria-hidden="true" /> 載入 AI 生成示範照
                </button>
              )}
            </div>
          </div>

          <div className={styles.ocrModePanel}>
            <div
              className={styles.ocrModeOptions}
              role="group"
              aria-label="菜單照片辨識模式"
            >
              <button
                type="button"
                aria-pressed={photoAnalysisMode === "mock"}
                className={
                  photoAnalysisMode === "mock" ? styles.selectedMode : undefined
                }
                disabled={controlsDisabled}
                onClick={() => {
                  setPhotoError(undefined);
                  setPhotoResult(undefined);
                  onPhotoAnalysisModeChange("mock");
                }}
              >
                Mock 示範
                <small>固定範例，不讀取圖片內容</small>
              </button>
              <button
                type="button"
                aria-pressed={photoAnalysisMode === "real"}
                className={
                  photoAnalysisMode === "real" ? styles.selectedMode : undefined
                }
                disabled={controlsDisabled || !allowRealMenuAi}
                title={
                  allowRealMenuAi
                    ? "使用教師登入的伺服器端 AI"
                    : "Demo 工作區不送出圖片給真實模型"
                }
                onClick={() => {
                  setPhotoError(undefined);
                  setPhotoResult(undefined);
                  onPhotoAnalysisModeChange("real");
                }}
              >
                真實 AI OCR
                <small>僅教師登入的校園模式可用</small>
              </button>
            </div>
            <button
              className="primary-action"
              type="button"
              disabled={controlsDisabled || !selectedPhoto}
              onClick={() => void analyzePhoto()}
            >
              {photoBusy ? (
                <RefreshCw size={15} aria-hidden="true" />
              ) : (
                <ScanText size={15} aria-hidden="true" />
              )}
              {photoBusy
                ? "正在整理圖片線索…"
                : photoResult
                  ? "重新分析這張菜單"
                  : "開始照片初判"}
            </button>
          </div>

          <div className={styles.photoAnalysisStatus} aria-live="polite">
            {photoBusy && (
              <p>正在辨識文字與菜色角色，分析完成前不會更改菜單。</p>
            )}
            {photoError && (
              <div role="alert" className={styles.photoError}>
                <TriangleAlert size={16} aria-hidden="true" />
                <span>{photoError}</span>
                <button
                  type="button"
                  disabled={!selectedPhoto || photoBusy}
                  onClick={() => void analyzePhoto()}
                >
                  重試
                </button>
              </div>
            )}
            {photoResult && (
              <div className={styles.photoSuccess}>
                <Check size={16} aria-hidden="true" />
                <span>
                  <strong>
                    {photoResult.isMock
                      ? "Mock OCR 草稿已建立·尚未人工確認"
                      : "真實 AI OCR 草稿已建立·尚未人工確認"}
                  </strong>
                  {photoResult.extractedLines.length} 行菜色線索 · 辨識器：
                  {photoResult.provider}
                  {photoResult.warnings.length > 0 && (
                    <small>
                      {photoResult.warnings
                        .slice(0, 2)
                        .map((warning) => warning.replace(/[。；]+$/u, ""))
                        .join("；")}
                      。
                    </small>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={styles.importArea}>
        <label htmlFor="menu-import-text">
          <span>
            <strong>{copy.label}</strong>
            <small>目前來源：{SOURCE_LABELS[source]}</small>
          </span>
          <textarea
            id="menu-import-text"
            value={importText}
            placeholder={copy.placeholder}
            disabled={controlsDisabled || !canImport}
            onChange={(event) => onImportTextChange(event.currentTarget.value)}
            spellCheck={false}
          />
        </label>
        <p className={styles.importHelp}>{copy.hint}</p>
        <button
          className="secondary-action"
          type="button"
          disabled={controlsDisabled || !canImport}
          onClick={() => {
            setReviewedLowConfidenceDishes(new Set());
            void onImport();
          }}
        >
          {busy ? "正在處理…" : copy.action}
        </button>
      </div>

      <div className={styles.menuPreview}>
        <div className={styles.menuHeading}>
          <div>
            <strong>原始菜名與標準化確認</strong>
            <span>
              {menu.plannedDishes.length} 道菜 · {menu.servedOn}
            </span>
            {menu.status === "draft" && unreviewedLowConfidenceCount > 0 && (
              <p id="menu-low-confidence-help">
                還有 {unreviewedLowConfidenceCount}
                道菜含低信心欄位。請展開核對每個欄位；查不到可以保留「未知」，但必須明確勾選。
              </p>
            )}
          </div>
          <button
            className="primary-action"
            type="button"
            disabled={menuLocked || unreviewedLowConfidenceCount > 0}
            aria-describedby={
              unreviewedLowConfidenceCount > 0
                ? "menu-low-confidence-help"
                : undefined
            }
            onClick={() => void confirmReviewedMenu()}
          >
            <Check size={15} aria-hidden="true" />
            {busy
              ? "正在處理…"
              : menu.status === "confirmed"
                ? "菜單已確認"
                : unreviewedLowConfidenceCount > 0
                  ? `尚有 ${unreviewedLowConfidenceCount} 道待核對`
                  : "確認這份菜單"}
          </button>
        </div>

        <div className={styles.menuRows} aria-label="待確認菜色">
          {menu.plannedDishes.map((dish, index) => {
            const lowFields = dish.lowConfidenceFields;
            const confidence = lowestConfidence(menu, index);
            const isLow = confidence < LOW_CONFIDENCE_THRESHOLD;
            const confidenceId = `menu-dish-confidence-${index}`;
            const lowFieldCopy = lowFields
              .map((field) => CONFIDENCE_FIELD_LABELS[field])
              .join("、");
            const reviewChecked = reviewedLowConfidenceDishes.has(index);
            const dishHeadingId = `menu-dish-heading-${index}`;

            return (
              <article
                className={styles.menuRow}
                aria-labelledby={dishHeadingId}
                key={`${index}-${dish.signature}`}
              >
                <div className={styles.menuDishTopline}>
                  <h3 id={dishHeadingId}>
                    第 {index + 1} 道 · {dish.rawName}
                  </h3>
                  <div
                    className={`${styles.confidence} ${isLow ? styles.low : ""}`}
                    id={confidenceId}
                    title={
                      lowFieldCopy
                        ? `低信心欄位：${lowFieldCopy}`
                        : "所有欄位皆達信心門檻"
                    }
                  >
                    <b>{Math.round(confidence * 100)}%</b>
                    {lowFieldCopy
                      ? menu.status === "confirmed"
                        ? `已人工接受：${lowFieldCopy}`
                        : `需確認：${lowFieldCopy}`
                      : "欄位信心充足"}
                  </div>
                </div>

                <div className={styles.menuCoreFields}>
                  <label>
                    <span>原始菜名（完整保留）</span>
                    <input
                      value={dish.rawName}
                      readOnly
                      aria-describedby={confidenceId}
                    />
                  </label>

                  <label>
                    <span>人工確認菜名</span>
                    <input
                      value={dish.normalizedName}
                      disabled={menuLocked}
                      maxLength={160}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "normalizedName",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>餐點角色</span>
                    <select
                      value={dish.role}
                      disabled={menuLocked}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "role",
                          event.currentTarget.value as MenuDishRole,
                        )
                      }
                    >
                      {MENU_DISH_ROLES.map((role) => (
                        <option value={role} key={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>標準食物類別</span>
                    <select
                      value={dish.category}
                      disabled={menuLocked}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "category",
                          event.currentTarget.value as FoodCategory,
                        )
                      }
                    >
                      {FOOD_CATEGORIES.map((category) => (
                        <option value={category} key={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>標準烹調法</span>
                    <select
                      value={dish.cookingMethod}
                      disabled={menuLocked}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "cookingMethod",
                          event.currentTarget.value as CookingMethod,
                        )
                      }
                    >
                      {COOKING_METHODS.map((method) => (
                        <option value={method} key={method}>
                          {COOKING_METHOD_LABELS[method]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>每人份量（g，可留空）</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={3000}
                      value={dish.portionG ?? ""}
                      placeholder="未知"
                      disabled={menuLocked}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "portionG",
                          event.currentTarget.value === ""
                            ? null
                            : Number(event.currentTarget.value),
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>食譜版本（可留空）</span>
                    <input
                      value={
                        dish.recipeVersion === "unversioned"
                          ? ""
                          : dish.recipeVersion
                      }
                      placeholder="未知"
                      disabled={menuLocked}
                      maxLength={80}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "recipeVersion",
                          event.currentTarget.value || "unversioned",
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>供餐業者（可留空）</span>
                    <input
                      value={
                        dish.vendorId === "unassigned-vendor"
                          ? ""
                          : dish.vendorId
                      }
                      placeholder="未知"
                      disabled={menuLocked}
                      maxLength={120}
                      aria-describedby={confidenceId}
                      onChange={(event) =>
                        changeDishField(
                          index,
                          "vendorId",
                          event.currentTarget.value || "unassigned-vendor",
                        )
                      }
                    />
                  </label>
                </div>

                <div className={styles.ingredientEvidence}>
                  <span>主食材線索</span>
                  <p>
                    {dish.primaryIngredientCandidates.length > 0
                      ? dish.primaryIngredientCandidates
                          .map((ingredient) => ingredient.canonicalName)
                          .join("、")
                      : "未知；目前沒有足夠線索"}
                  </p>
                </div>

                {lowFields.length > 0 && menu.status === "draft" && (
                  <label className={styles.lowConfidenceReview}>
                    <input
                      type="checkbox"
                      checked={reviewChecked}
                      disabled={menuLocked}
                      aria-describedby={confidenceId}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setReviewedLowConfidenceDishes((current) => {
                          const updated = new Set(current);
                          if (checked) updated.add(index);
                          else updated.delete(index);
                          return updated;
                        });
                      }}
                    />
                    <span>
                      我已核對這道菜的低信心欄位；查不到的資料仍以「未知」保存。
                    </span>
                  </label>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className={styles.actualMenu}>
        <div>
          <strong>原計畫與實際供餐分開保存</strong>
          <p id="menu-substitution-help">{substitutionSummary(menu)}</p>
        </div>
        <label className={styles.switchLabel}>
          <input
            type="checkbox"
            checked={hasSubstitutions}
            disabled={controlsDisabled || menu.status !== "confirmed"}
            aria-describedby="menu-substitution-help"
            onChange={(event) =>
              onSubstitutionToggle(event.currentTarget.checked)
            }
          />
          實際供餐有換菜
        </label>
      </div>
    </section>
  );
}
