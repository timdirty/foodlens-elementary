"use client";

import Dexie, { type EntityTable } from "dexie";
import { useCallback, useEffect, useState } from "react";
import { aiAnalysisSchema, foodAnalysisMenuCandidatesSchema } from "@/lib/ai";
import type { AiAnalysisV1, AiDetectionInput, DataMode } from "@/lib/types";
import type {
  ConfirmedPlateMenuContext,
  ScanFormState,
} from "@/lib/scan-workflow";

export const SCAN_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A resumable local workspace. It is intentionally not part of AppSnapshot. */
export interface ScanDraft {
  id: string;
  schemaVersion: 1;
  mode: DataMode;
  linkedMealId?: string;
  step: 1 | 2 | 4;
  form: ScanFormState;
  selectedImage: string;
  imageSource: "demo" | "upload" | "none";
  /** Already re-encoded by preparePlateImage; IndexedDB keeps it as a Blob. */
  imageBlob?: Blob;
  analysis?: AiAnalysisV1;
  /** Exact candidate context captured when analysis began; legacy drafts omit it. */
  analysisMenuContext?: ConfirmedPlateMenuContext | null;
  corrections: AiDetectionInput[];
  analysisMode: "mock" | "real";
  clientRequestId: string;
  updatedAt: string;
}

export type ScanDraftInput = Omit<ScanDraft, "schemaVersion" | "updatedAt">;

class ScanDraftDatabase extends Dexie {
  drafts!: EntityTable<ScanDraft, "id">;

  constructor() {
    super("foodlens-scan-drafts");
    this.version(1).stores({ drafts: "&id, mode, updatedAt" });
  }
}

let database: ScanDraftDatabase | undefined;

function db() {
  database ??= new ScanDraftDatabase();
  return database;
}

export function createScanDraftId({
  mode,
  linkedMealId,
  workspaceKey = "default",
}: {
  mode: DataMode;
  linkedMealId?: string;
  workspaceKey?: string;
}) {
  let hash = 2166136261;
  for (let index = 0; index < workspaceKey.length; index += 1)
    hash = Math.imul(hash ^ workspaceKey.charCodeAt(index), 16777619);
  return `scan-draft:${mode}:${(hash >>> 0).toString(16).padStart(8, "0")}:${linkedMealId ?? "new"}`;
}

function isNumberField(value: unknown) {
  return (
    value === "" ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isValidForm(value: unknown): value is ScanFormState {
  if (!value || typeof value !== "object") return false;
  const form = value as Partial<ScanFormState>;
  return (
    typeof form.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.date) &&
    typeof form.classId === "string" &&
    typeof form.staple === "string" &&
    typeof form.mainDish === "string" &&
    typeof form.sides === "string" &&
    isNumberField(form.people) &&
    isNumberField(form.supplyKg) &&
    isNumberField(form.leftoverKg) &&
    typeof form.notes === "string"
  );
}

function isValidDraft(value: unknown): value is ScanDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ScanDraft>;
  return (
    draft.schemaVersion === 1 &&
    typeof draft.id === "string" &&
    (draft.mode === "demo-local" || draft.mode === "school-cloud") &&
    (draft.step === 1 || draft.step === 2 || draft.step === 4) &&
    isValidForm(draft.form) &&
    typeof draft.selectedImage === "string" &&
    (draft.imageSource === "demo" ||
      draft.imageSource === "upload" ||
      draft.imageSource === "none") &&
    Array.isArray(draft.corrections) &&
    (draft.analysisMode === "mock" || draft.analysisMode === "real") &&
    typeof draft.clientRequestId === "string" &&
    UUID_PATTERN.test(draft.clientRequestId) &&
    typeof draft.updatedAt === "string" &&
    Number.isFinite(Date.parse(draft.updatedAt)) &&
    (draft.imageBlob === undefined || draft.imageBlob instanceof Blob) &&
    (draft.linkedMealId === undefined ||
      typeof draft.linkedMealId === "string") &&
    isValidMenuContext(draft.analysisMenuContext) &&
    (!draft.analysisMenuContext || draft.analysis !== undefined) &&
    (draft.analysis === undefined
      ? draft.corrections.length === 0
      : aiAnalysisSchema.safeParse({
          ...draft.analysis,
          detections: draft.corrections,
        }).success)
  );
}

function isValidMenuContext(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const context = value as Partial<ConfirmedPlateMenuContext>;
  const candidates = foodAnalysisMenuCandidatesSchema.safeParse(
    context.candidates,
  );
  return (
    candidates.success &&
    typeof context.menuVersionId === "string" &&
    context.menuVersionId.trim().length >= 1 &&
    context.menuVersionId.length <= 120 &&
    typeof context.menuVersionSignature === "string" &&
    context.menuVersionSignature.trim().length >= 1 &&
    context.menuVersionSignature.length <= 160 &&
    (context.source === "demo" ||
      context.source === "ocr" ||
      context.source === "structured" ||
      context.source === "csv") &&
    (context.sourceName === null || typeof context.sourceName === "string") &&
    typeof context.reviewedBy === "string" &&
    context.reviewedBy.trim().length >= 1 &&
    context.reviewedBy.length <= 120 &&
    typeof context.isMock === "boolean" &&
    Number.isInteger(context.substitutionCount) &&
    Number(context.substitutionCount) >= 0 &&
    Number(context.substitutionCount) <= candidates.data.length
  );
}

export async function loadScanDraft(id: string, now = Date.now()) {
  const draft = await db().drafts.get(id);
  if (!draft) return undefined;
  if (
    !isValidDraft(draft) ||
    now - Date.parse(draft.updatedAt) > SCAN_DRAFT_MAX_AGE_MS
  ) {
    await db().drafts.delete(id);
    return undefined;
  }
  return draft;
}

/**
 * Removes every expired draft in this browser, including its image Blob.
 *
 * The indexed cutoff query only returns primary keys for deletion; it never
 * exposes another workspace's draft payload to the active workspace. Drafts
 * exactly seven days old remain available, matching loadScanDraft's policy.
 */
export async function sweepExpiredScanDrafts(now = Date.now()) {
  const cutoff = new Date(now - SCAN_DRAFT_MAX_AGE_MS).toISOString();
  const database = db();
  return database.transaction("rw", database.drafts, () =>
    database.drafts.where("updatedAt").below(cutoff).delete(),
  );
}

async function initializeScanDraftStore(id: string, now = Date.now()) {
  await sweepExpiredScanDrafts(now);
  return loadScanDraft(id, now);
}

export async function saveScanDraft(input: ScanDraftInput) {
  if (input.imageBlob && input.imageBlob.size > 4 * 1024 * 1024)
    throw new Error("草稿圖片超過 4MB 安全上限，請重新選擇照片");
  const draft: ScanDraft = {
    ...input,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  if (!isValidDraft(draft))
    throw new Error("掃描草稿內容格式不完整，未寫入此裝置");
  await db().drafts.put(draft);
  return draft;
}

export async function deleteScanDraft(id: string) {
  await db().drafts.delete(id);
}

/**
 * Clears unfinished scans for one data mode only. Demo reset uses this so the
 * presentation preflight returns to a genuinely clean state without touching
 * drafts that belong to an authenticated school workspace.
 */
export async function clearScanDrafts(mode: DataMode) {
  const database = db();
  return database.transaction("rw", database.drafts, () =>
    database.drafts.where("mode").equals(mode).delete(),
  );
}

export interface PendingScanDraftInspection {
  mode: DataMode;
  status: "checking" | "ready" | "unavailable";
  count?: number;
  latestUpdatedAt?: string;
}

/**
 * Read-only preflight inspection. Unlike loadScanDraft and the explicit
 * maintenance sweep, this never removes malformed or expired browser data.
 */
export async function inspectPendingScanDrafts(
  mode: DataMode,
  now = Date.now(),
) {
  const drafts = (await db().drafts.where("mode").equals(mode).toArray())
    .filter(
      (draft) =>
        isValidDraft(draft) &&
        now - Date.parse(draft.updatedAt) <= SCAN_DRAFT_MAX_AGE_MS,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    count: drafts.length,
    latestUpdatedAt: drafts[0]?.updatedAt,
  };
}

export function usePendingScanDraftInspection(
  mode: DataMode,
  refreshKey?: unknown,
) {
  const [result, setResult] = useState<
    PendingScanDraftInspection & { refreshKey?: unknown }
  >({
    mode: mode === "demo-local" ? "school-cloud" : "demo-local",
    status: "checking",
  });
  const current: PendingScanDraftInspection =
    result.mode === mode && result.refreshKey === refreshKey
      ? result
      : { mode, status: "checking" };

  useEffect(() => {
    let active = true;
    void inspectPendingScanDrafts(mode)
      .then((value) => {
        if (active) setResult({ mode, refreshKey, status: "ready", ...value });
      })
      .catch(() => {
        if (active) setResult({ mode, refreshKey, status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [mode, refreshKey]);

  return current;
}

/**
 * Loads a local-only scan draft. Callers choose when to restore it; this hook
 * never applies a draft to a form and never talks to the official repository.
 */
export function useScanDraft(id: string) {
  const [result, setResult] = useState<{
    id: string;
    draft?: ScanDraft;
    error?: string;
  }>({ id: "", error: undefined });
  const loading = result.id !== id;
  const draft = loading ? undefined : result.draft;
  const error = loading ? undefined : result.error;

  useEffect(() => {
    let current = true;
    void initializeScanDraftStore(id)
      .then((value) => {
        if (current) setResult({ id, draft: value });
      })
      .catch(() => {
        if (current)
          setResult({
            id,
            error: "這個瀏覽器無法讀取本機掃描草稿。",
          });
      });
    return () => {
      current = false;
    };
  }, [id]);

  const save = useCallback(async (input: ScanDraftInput) => {
    try {
      await saveScanDraft(input);
      // Saving the active workspace must not turn into a recovery prompt in
      // the same session. A fresh mount will load it after an interruption.
      setResult((current) => ({ ...current, id: input.id, error: undefined }));
    } catch (reason) {
      setResult({
        id: input.id,
        error:
          reason instanceof Error
            ? reason.message
            : "這個瀏覽器無法儲存本機掃描草稿。",
      });
      throw reason;
    }
  }, []);

  const discard = useCallback(async () => {
    try {
      await deleteScanDraft(id);
      setResult({ id });
    } catch (reason) {
      setResult({ id, error: "這個瀏覽器無法刪除本機掃描草稿。" });
      throw reason;
    }
  }, [id]);

  return { draft, loading, error, save, discard };
}
