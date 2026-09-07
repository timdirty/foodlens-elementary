"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  saveWorkflowDraft,
  type WorkflowDraft,
  type WorkflowDraftInput,
} from "@/lib/workflow-draft";

type DraftStatus =
  "idle" | "restored" | "pending" | "saving" | "saved" | "error";

/** One writer per workbench: a completed write only acknowledges its own edits. */
export function useWorkflowAutosave({
  input,
  paused,
  initialDraft,
  onPersisted,
}: {
  input: WorkflowDraftInput;
  paused: boolean;
  initialDraft?: WorkflowDraft;
  onPersisted: (draft: WorkflowDraft) => void | Promise<void>;
}) {
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<DraftStatus>(
    initialDraft ? "restored" : "idle",
  );
  const [updatedAt, setUpdatedAt] = useState(initialDraft?.updatedAt);
  const inputRef = useRef(input);
  const onPersistedRef = useRef(onPersisted);
  const revision = useRef(0);
  const persistedRevision = useRef(0);
  const statusEpoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingWrite = useRef<Promise<WorkflowDraft | undefined> | undefined>(
    undefined,
  );
  const mounted = useRef(true);

  useLayoutEffect(() => {
    inputRef.current = input;
    onPersistedRef.current = onPersisted;
  }, [input, onPersisted]);

  const cancelTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const markDirty = useCallback(() => {
    revision.current += 1;
    setDirty(true);
    setStatus("pending");
  }, []);

  const drainWrites = useCallback(() => {
    if (pendingWrite.current) return pendingWrite.current;
    const drain = async () => {
      let last: WorkflowDraft | undefined;
      while (persistedRevision.current < revision.current) {
        const savingRevision = revision.current;
        last = await saveWorkflowDraft(inputRef.current);
        persistedRevision.current = Math.max(
          persistedRevision.current,
          savingRevision,
        );
      }
      return last;
    };
    const write = drain().finally(() => {
      pendingWrite.current = undefined;
    });
    pendingWrite.current = write;
    return write;
  }, []);

  const flush = useCallback(async () => {
    cancelTimer();
    const epoch = statusEpoch.current;
    if (revision.current > persistedRevision.current) setStatus("saving");
    let stored: WorkflowDraft | undefined;
    try {
      stored = await drainWrites();
    } catch {
      if (mounted.current && epoch === statusEpoch.current) setStatus("error");
      return false;
    }
    if (!mounted.current || epoch !== statusEpoch.current) return true;
    // An edit can arrive between promise completion and this continuation.
    if (revision.current > persistedRevision.current) {
      setStatus("pending");
      return false;
    }
    setDirty(false);
    if (stored) {
      setStatus("saved");
      setUpdatedAt(stored.updatedAt);
      // Listing/navigation errors must not relabel a successful IndexedDB write.
      await Promise.resolve()
        .then(() => onPersistedRef.current(stored))
        .catch(() => undefined);
    }
    return true;
  }, [cancelTimer, drainWrites]);

  /** Call only after the formal save succeeds, with editing controls locked. */
  const clearAfterCommit = useCallback(async () => {
    cancelTimer();
    statusEpoch.current += 1;
    persistedRevision.current = revision.current;
    // Finish the in-flight write before the caller deletes its local draft.
    await pendingWrite.current?.catch(() => undefined);
    if (!mounted.current) return;
    setDirty(false);
    setStatus("idle");
    setUpdatedAt(undefined);
  }, [cancelTimer]);

  useEffect(() => {
    if (!dirty || paused) return;
    timer.current = setTimeout(() => void flush(), 600);
    return cancelTimer;
  }, [cancelTimer, dirty, flush, input, paused]);

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelTimer();
      // Best effort on route unmount; join the same queue, never start a rival writer.
      void drainWrites().catch(() => undefined);
    };
  }, [cancelTimer, drainWrites]);

  return { dirty, status, updatedAt, markDirty, flush, clearAfterCommit };
}
