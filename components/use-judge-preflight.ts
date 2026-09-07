"use client";

import { useMemo } from "react";
import type { JudgePreflightRuntime } from "@/lib/product-readiness";
import { usePendingScanDraftInspection } from "@/lib/scan-draft";
import type { DataMode } from "@/lib/types";
import { usePendingWorkflowDraftInspection } from "@/lib/workflow-draft";

/** Both entry points inspect local drafts without restoring or deleting them. */
export function useJudgePreflightRuntime(mode: DataMode, refreshKey?: unknown) {
  const scan = usePendingScanDraftInspection(mode, refreshKey);
  const workflow = usePendingWorkflowDraftInspection(mode, refreshKey);

  return useMemo<JudgePreflightRuntime>(
    () => ({
      pendingScanDraftCount: scan.status === "ready" ? scan.count : undefined,
      pendingWorkflowDraftCount:
        workflow.status === "ready" ? workflow.count : undefined,
      scanDraftInspectionFailed: scan.status === "unavailable",
      workflowDraftInspectionFailed: workflow.status === "unavailable",
    }),
    [scan.status, scan.count, workflow.status, workflow.count],
  );
}
