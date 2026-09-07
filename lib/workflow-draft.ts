"use client";

import Dexie, { type EntityTable } from "dexie";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  anonymousReasonCountsSchema,
  evidenceSourceKindSchema,
  humanDecisionChoiceSchema,
  reasonCollectionStatusSchema,
  teacherEvidenceContextSchema,
  type MealEvidenceCase,
} from "@/lib/evidence-chain";
import {
  menuVersionSchema,
  type MenuImportSource,
} from "@/lib/menu-intelligence";
import type { DataMode } from "@/lib/types";
import {
  RESPONSIBILITY_KINDS,
  RESPONSIBILITY_OWNERS,
  wasteMeasurementSchema,
} from "@/lib/waste-intelligence";

export const WORKFLOW_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const compactIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[\p{L}\p{N}_.:-]+$/u);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const servedOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "日期不存在");
const countSchema = z.number().int().min(0).max(50_000_000);

/**
 * A workflow may be incomplete, so it deliberately cannot use the final
 * MealEvidenceCase schema. It still validates every stored field and nested
 * object before browser data is allowed back into React state.
 *
 * The final measurement attestation and human decision are omitted on
 * purpose. A resumable draft may remember the student's typed rationale, but
 * it must never be able to re-apply either final confirmation automatically.
 */
const workflowDraftCaseSchema = z
  .object({
    id: compactIdSchema,
    mealRecordId: compactIdSchema.optional(),
    classId: compactIdSchema,
    servedOn: servedOnSchema,
    sourceKind: evidenceSourceKindSchema,
    menuVersion: menuVersionSchema,
    plannedDiners: countSchema,
    actualDiners: countSchema,
    suppliedEdibleG: countSchema,
    observedDiners: countSchema,
    plateSampleSupplyG: countSchema,
    measurements: z.array(wasteMeasurementSchema).min(5).max(200),
    feedbackSchemaVersion: z.literal(2).default(2),
    reasonCollectionStatus: reasonCollectionStatusSchema,
    reasonCounts: anonymousReasonCountsSchema,
    teacherContext: teacherEvidenceContextSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((evidenceCase, context) => {
    if (evidenceCase.menuVersion.servedOn !== evidenceCase.servedOn) {
      context.addIssue({
        code: "custom",
        path: ["menuVersion", "servedOn"],
        message: "草稿案件日期必須與菜單版本日期一致",
      });
    }
  });

const workflowDecisionDraftSchema = z
  .object({
    cardId: z.enum(RESPONSIBILITY_KINDS),
    choice: humanDecisionChoiceSchema,
    rationale: z.string().max(1_000),
    decidedByRole: z.enum(RESPONSIBILITY_OWNERS),
  })
  .strict();

const workflowDraftSchema = z
  .object({
    id: z.string().min(1).max(120),
    schemaVersion: z.literal(1),
    mode: z.enum(["demo-local", "school-cloud"]),
    caseId: compactIdSchema,
    classId: compactIdSchema,
    servedOn: servedOnSchema,
    step: z.number().int().min(0).max(3),
    value: workflowDraftCaseSchema,
    source: z.enum(["demo", "ocr", "structured", "csv"]),
    importText: z.string().max(100_000),
    photoAnalysisMode: z.enum(["mock", "real"]),
    decisionDraft: workflowDecisionDraftSchema,
    touchedMeasurementFields: z
      .array(z.string().min(1).max(240))
      .max(1_000)
      .refine((values) => new Set(values).size === values.length),
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      draft.caseId !== draft.value.id ||
      draft.classId !== draft.value.classId ||
      draft.servedOn !== draft.value.servedOn
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "草稿的案件、班級或日期識別不一致",
      });
    }
    if ((draft.mode === "demo-local") !== (draft.value.sourceKind === "demo")) {
      context.addIssue({
        code: "custom",
        path: ["value", "sourceKind"],
        message: "草稿資料來源與目前模式不一致",
      });
    }
    if (
      draft.id !==
      createWorkflowDraftId({
        mode: draft.mode,
        caseId: draft.caseId,
        classId: draft.classId,
        servedOn: draft.servedOn,
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "草稿隔離識別碼不一致",
      });
    }
  });

export interface WorkflowDecisionDraft {
  cardId: (typeof RESPONSIBILITY_KINDS)[number];
  choice: "pilot" | "more-data" | "reject";
  rationale: string;
  decidedByRole: (typeof RESPONSIBILITY_OWNERS)[number];
}

export interface WorkflowDraft {
  id: string;
  schemaVersion: 1;
  mode: DataMode;
  caseId: string;
  classId: string;
  servedOn: string;
  step: number;
  value: MealEvidenceCase;
  source: MenuImportSource;
  importText: string;
  photoAnalysisMode: "mock" | "real";
  decisionDraft: WorkflowDecisionDraft;
  touchedMeasurementFields: string[];
  updatedAt: string;
}

export type WorkflowDraftInput = Omit<
  WorkflowDraft,
  "id" | "schemaVersion" | "updatedAt"
>;

export interface WorkflowDraftSummary {
  id: string;
  mode: DataMode;
  caseId: string;
  classId: string;
  servedOn: string;
  step: number;
  updatedAt: string;
}

export interface PendingWorkflowDraftInspection {
  mode: DataMode;
  status: "checking" | "ready" | "unavailable";
  count?: number;
  latestUpdatedAt?: string;
}

class WorkflowDraftDatabase extends Dexie {
  drafts!: EntityTable<WorkflowDraft, "id">;

  constructor() {
    super("foodlens-workflow-drafts");
    this.version(1).stores({
      drafts: "&id, mode, caseId, [mode+caseId], updatedAt",
    });
  }
}

let database: WorkflowDraftDatabase | undefined;

function db() {
  database ??= new WorkflowDraftDatabase();
  return database;
}

function scopeHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createWorkflowDraftId({
  mode,
  caseId,
  classId,
  servedOn,
}: {
  mode: DataMode;
  caseId: string;
  classId: string;
  servedOn: string;
}) {
  const identity = `${mode}\u0000${classId}\u0000${servedOn}\u0000${caseId}`;
  return `workflow-draft:${mode}:${scopeHash(identity)}`;
}

export function workflowCaseBelongsToMode(
  mode: DataMode,
  evidenceCase: Pick<MealEvidenceCase, "sourceKind">,
) {
  return mode === "demo-local"
    ? evidenceCase.sourceKind === "demo"
    : evidenceCase.sourceKind !== "demo";
}

export function normalizeWorkflowCaseRequest(value: string | null) {
  if (!value) return undefined;
  const parsed = compactIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function normalizeWorkflowDateRequest(value: string | null) {
  if (!value) return undefined;
  const parsed = servedOnSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function sanitizeCaseForDraft(value: MealEvidenceCase) {
  const { measurementReview, humanDecision, ...unconfirmedValue } = value;
  void measurementReview;
  void humanDecision;
  return workflowDraftCaseSchema.parse(unconfirmedValue) as MealEvidenceCase;
}

function parsedDraft(value: unknown) {
  const result = workflowDraftSchema.safeParse(value);
  return result.success ? (result.data as WorkflowDraft) : undefined;
}

function resumableDraft(draft: WorkflowDraft): WorkflowDraft {
  const safeStep =
    draft.value.menuVersion.status !== "confirmed"
      ? 0
      : draft.mode === "school-cloud"
        ? Math.min(1, draft.step)
        : draft.step;
  return {
    ...draft,
    step: safeStep,
    value: sanitizeCaseForDraft(draft.value),
  };
}

export async function saveWorkflowDraft(
  input: WorkflowDraftInput,
  now = Date.now(),
) {
  const value = sanitizeCaseForDraft(input.value);
  const candidate = {
    ...input,
    id: createWorkflowDraftId({
      mode: input.mode,
      caseId: value.id,
      classId: value.classId,
      servedOn: value.servedOn,
    }),
    schemaVersion: 1 as const,
    caseId: value.id,
    classId: value.classId,
    servedOn: value.servedOn,
    value,
    touchedMeasurementFields: [...new Set(input.touchedMeasurementFields)],
    updatedAt: new Date(now).toISOString(),
  };
  const draft = workflowDraftSchema.parse(candidate) as WorkflowDraft;
  await db().drafts.put(draft);
  return draft;
}

export async function loadWorkflowDraft(id: string, now = Date.now()) {
  const stored = await db().drafts.get(id);
  if (!stored) return undefined;
  const draft = parsedDraft(stored);
  if (!draft || now - Date.parse(draft.updatedAt) > WORKFLOW_DRAFT_MAX_AGE_MS) {
    await db().drafts.delete(id);
    return undefined;
  }
  return resumableDraft(draft);
}

export async function loadWorkflowDraftForCase(
  mode: DataMode,
  caseId: string,
  now = Date.now(),
) {
  const normalizedCaseId = normalizeWorkflowCaseRequest(caseId);
  if (!normalizedCaseId) return undefined;
  const stored = await db()
    .drafts.where("[mode+caseId]")
    .equals([mode, normalizedCaseId])
    .first();
  if (!stored) return undefined;
  return loadWorkflowDraft(stored.id, now);
}

export async function deleteWorkflowDraft(id: string) {
  await db().drafts.delete(id);
}

export async function deleteWorkflowDraftForCase(
  mode: DataMode,
  caseId: string,
) {
  const normalizedCaseId = normalizeWorkflowCaseRequest(caseId);
  if (!normalizedCaseId) return 0;
  return db()
    .drafts.where("[mode+caseId]")
    .equals([mode, normalizedCaseId])
    .delete();
}

export async function listWorkflowDraftSummaries(
  mode: DataMode,
  now = Date.now(),
) {
  const rows = await db().drafts.where("mode").equals(mode).toArray();
  const invalidIds: string[] = [];
  const summaries = rows.flatMap((stored) => {
    const draft = parsedDraft(stored);
    if (
      !draft ||
      now - Date.parse(draft.updatedAt) > WORKFLOW_DRAFT_MAX_AGE_MS
    ) {
      invalidIds.push(stored.id);
      return [];
    }
    return [
      {
        id: draft.id,
        mode: draft.mode,
        caseId: draft.caseId,
        classId: draft.classId,
        servedOn: draft.servedOn,
        step: draft.step,
        updatedAt: draft.updatedAt,
      } satisfies WorkflowDraftSummary,
    ];
  });
  if (invalidIds.length) await db().drafts.bulkDelete(invalidIds);
  return summaries.sort(
    (left, right) =>
      right.servedOn.localeCompare(left.servedOn) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
}

/**
 * Read-only presentation preflight. Invalid and expired browser rows are
 * ignored without changing the student's unfinished work store.
 */
export async function inspectPendingWorkflowDrafts(
  mode: DataMode,
  now = Date.now(),
) {
  const drafts = (await db().drafts.where("mode").equals(mode).toArray())
    .flatMap((stored) => {
      const draft = parsedDraft(stored);
      return draft &&
        now - Date.parse(draft.updatedAt) <= WORKFLOW_DRAFT_MAX_AGE_MS
        ? [draft]
        : [];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    count: drafts.length,
    latestUpdatedAt: drafts[0]?.updatedAt,
  };
}

export function usePendingWorkflowDraftInspection(
  mode: DataMode,
  refreshKey?: unknown,
) {
  const [result, setResult] = useState<
    PendingWorkflowDraftInspection & { refreshKey?: unknown }
  >({
    mode: mode === "demo-local" ? "school-cloud" : "demo-local",
    status: "checking",
  });
  const current: PendingWorkflowDraftInspection =
    result.mode === mode && result.refreshKey === refreshKey
      ? result
      : { mode, status: "checking" };

  useEffect(() => {
    let active = true;
    void inspectPendingWorkflowDrafts(mode)
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

export async function clearWorkflowDrafts(mode: DataMode) {
  return db().drafts.where("mode").equals(mode).delete();
}
