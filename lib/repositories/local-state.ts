import { createUuid, sha256Hex } from "@/lib/crypto";
import { getPlateCandidates } from "@/lib/menu-intelligence";
import {
  derivePlateScanAnalysisKind,
  validatedPlateScanMenuContext,
  type AppSnapshot,
  type ConfirmScanCommand,
  type MealRecord,
  type PlateScanAnalysisKind,
  type PlateScanMenuContext,
} from "@/lib/types";

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function scanCommandHash(command: ConfirmScanCommand) {
  const imageSha256 = command.imageBlob
    ? await sha256Hex(await command.imageBlob.arrayBuffer())
    : undefined;
  return sha256Hex(
    new TextEncoder().encode(
      stableJson({
        meal: command.meal,
        imageSha256,
        imageUrl: command.imageUrl,
        analysis: command.analysis,
        menuContext: command.menuContext ?? null,
        corrections: command.corrections,
        correctionNotes: command.correctionNotes,
      }),
    ),
  );
}

export function resolvePersistedPlateMenuContext({
  state,
  mealId,
  analysisKind,
  context,
}: {
  state: AppSnapshot;
  mealId: string;
  analysisKind: PlateScanAnalysisKind;
  context: PlateScanMenuContext | null | undefined;
}) {
  const value = validatedPlateScanMenuContext(context);
  if (!value) return null;
  if (analysisKind === "human-manual")
    throw new Error("人工判讀不會保存為 AI 菜單候選脈絡");
  const meal = state.meals.find((item) => item.id === mealId);
  if (!meal) throw new Error("已確認菜單候選只能連結到既有餐期，請重新分析");
  if (meal.menuSignature !== value.menuVersionSignature)
    throw new Error("餐期菜單已變更，請以最新確認菜單重新分析");
  const matchingContexts = state.evidenceCases.filter(
    (evidenceCase) =>
      evidenceCase.mealRecordId === mealId &&
      evidenceCase.menuVersion.id === value.menuVersionId &&
      evidenceCase.menuVersion.signature === value.menuVersionSignature &&
      evidenceCase.menuVersion.status === "confirmed" &&
      Boolean(evidenceCase.menuVersion.confirmation) &&
      getPlateCandidates(evidenceCase.menuVersion).length ===
        value.candidateCount,
  );
  if (matchingContexts.length !== 1)
    throw new Error("找不到唯一且已確認的菜單候選脈絡，請重新分析");
  return value;
}

export function applyConfirmedScan(
  state: AppSnapshot,
  command: ConfirmScanCommand,
  contentSha256: string,
) {
  const now = new Date().toISOString();
  const mealId = command.meal.id ?? `meal-${createUuid()}`;
  const scanId = `scan-${command.clientRequestId}`;
  const existingScan = state.scans.find((scan) => scan.id === scanId);
  if (existingScan) {
    if (existingScan.contentSha256 === contentSha256)
      return {
        mealId: existingScan.mealRecordId,
        scanId: existingScan.id,
      };
    throw new Error(
      existingScan.contentSha256
        ? "同一送出識別碼已保存另一份內容；請先到每日紀錄確認，再將新餐盤另行送出。"
        : "這筆舊版紀錄缺少內容指紋，為避免誤判重試，請將新餐盤另行送出。",
    );
  }
  const analysisKind = derivePlateScanAnalysisKind(command.analysis);

  const menuSignature =
    `${command.meal.staple}|${command.meal.mainDish}`.toLowerCase();
  const existingMealIndex = state.meals.findIndex((meal) => meal.id === mealId);
  if (command.meal.id && existingMealIndex < 0)
    throw new Error("指定的既有餐期不存在，請重新選擇餐期");
  const menuContext = resolvePersistedPlateMenuContext({
    state,
    mealId,
    analysisKind,
    context: command.menuContext,
  });
  if (existingMealIndex < 0) {
    if (
      !Number.isInteger(command.meal.leftoverG) ||
      command.meal.leftoverG < 0 ||
      command.meal.leftoverG > command.meal.totalSupplyG
    )
      throw new Error("全班剩食秤重必須介於 0 與總供應重量之間");
    if (
      command.meal.measurementMethod !== "scale" &&
      command.meal.measurementMethod !== "manual"
    )
      throw new Error("班級剩食重量必須來自秤重或人工登錄，不能由單張餐盤推算");
    state.meals.push({
      ...command.meal,
      id: mealId,
      menuSignature,
      createdAt: now,
      updatedAt: now,
    });
  }
  state.scans.push({
    id: scanId,
    mealRecordId: mealId,
    imageBlob: command.imageBlob,
    imageUrl: command.imageUrl,
    analysisKind,
    menuContext,
    provider: command.analysis.provider,
    model: command.analysis.model,
    schemaVersion: "1",
    status: "confirmed",
    reviewedAt: now,
    createdAt: now,
    contentSha256,
  });
  command.analysis.detections.forEach((original, index) => {
    const detectionId = `${scanId}-d${index + 1}`;
    state.detections.push({
      id: detectionId,
      scanId,
      category: original.category,
      label: original.label,
      aiOriginalG: original.originalG,
      aiRemainingRatio: original.remainingRatio,
      aiRemainingG: original.remainingG,
      confidence: original.confidence,
      sortOrder: index,
    });
    const corrected = command.corrections[index];
    if (
      corrected &&
      (corrected.category !== original.category ||
        corrected.label !== original.label ||
        corrected.originalG !== original.originalG ||
        corrected.remainingRatio !== original.remainingRatio)
    ) {
      state.corrections.push({
        id: `${detectionId}-correction`,
        detectionId,
        correctedCategory: corrected.category,
        correctedLabel: corrected.label,
        correctedOriginalG: corrected.originalG,
        correctedRemainingRatio: corrected.remainingRatio,
        correctedRemainingG: corrected.remainingG,
        note: command.correctionNotes?.[index] ?? "學生人工確認與修正",
        correctedAt: now,
      });
    }
  });
  return { mealId, scanId };
}

export function mergeMealRecords(state: AppSnapshot, records: MealRecord[]) {
  const classIds = new Set(state.classes.map((item) => item.id));
  const merged = new Map(state.meals.map((item) => [item.id, item]));
  for (const record of records) {
    if (!classIds.has(record.classId))
      throw new Error(`餐期 ${record.id} 指向不存在的班級`);
    const existing = merged.get(record.id);
    if (
      existing &&
      state.mealSafetyObservations?.some(
        (item) => item.mealRecordId === record.id,
      ) &&
      (existing.classId !== record.classId ||
        existing.servedOn !== record.servedOn ||
        existing.mealPeriod !== record.mealPeriod)
    )
      throw new Error(
        `餐期 ${record.id} 已有逐餐安全觀察，不能改寫日期、班級或餐期；請保留原始紀錄。`,
      );
    if (
      existing &&
      state.scans.some((scan) => scan.mealRecordId === record.id) &&
      !hasSameMealEvidence(existing, record)
    )
      throw new Error(
        `餐期 ${record.id} 已有餐盤判讀，不能用 CSV 改寫日期、班級、菜單、人數或秤重；請改用新的餐期 ID。`,
      );
    merged.set(record.id, { ...record, source: "import" });
  }
  state.meals = [...merged.values()].sort((left, right) =>
    left.servedOn.localeCompare(right.servedOn),
  );
  return records.length;
}

type MealEvidence = Pick<
  MealRecord,
  | "classId"
  | "servedOn"
  | "mealPeriod"
  | "staple"
  | "mainDish"
  | "sideDishes"
  | "menuSignature"
  | "plannedPeople"
  | "actualPeople"
  | "totalSupplyG"
  | "leftoverG"
  | "measurementMethod"
>;

export function hasSameMealEvidence(
  existing: MealEvidence,
  incoming: MealEvidence,
) {
  return stableJson(existing) === stableJson(incoming);
}
