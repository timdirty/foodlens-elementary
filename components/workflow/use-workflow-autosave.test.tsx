// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowAutosave } from "@/components/workflow/use-workflow-autosave";
import { createDemoEvidenceCases } from "@/lib/evidence-chain";
import {
  saveWorkflowDraft,
  type WorkflowDraft,
  type WorkflowDraftInput,
} from "@/lib/workflow-draft";

vi.mock("@/lib/workflow-draft", () => ({
  saveWorkflowDraft: vi.fn(),
}));

const saveDraft = vi.mocked(saveWorkflowDraft);

function inputFor(text = "第一版菜單原文"): WorkflowDraftInput {
  const source = structuredClone(createDemoEvidenceCases()[2]);
  const value = {
    ...source,
    id: "workflow-autosave-case",
    classId: "class-5a",
    sourceKind: "demo" as const,
  };
  return {
    mode: "demo-local",
    caseId: value.id,
    classId: value.classId,
    servedOn: value.servedOn,
    step: 3,
    value,
    source: value.menuVersion.sourceEvidence.source,
    importText: text,
    photoAnalysisMode: "mock",
    decisionDraft: {
      cardId: "headcount-reserve",
      choice: "pilot",
      rationale: "保留現場添餐能力，先做一次小型試驗。",
      decidedByRole: "dietitian",
    },
    touchedMeasurementFields: ["plannedDiners"],
  };
}

function stored(input: WorkflowDraftInput, second = 0): WorkflowDraft {
  return {
    ...structuredClone(input),
    id: "workflow-draft:demo-local:autosave-test",
    schemaVersion: 1,
    updatedAt: new Date(Date.UTC(2026, 8, 6, 4, 0, second)).toISOString(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(input = inputFor(), paused = false) {
  const onPersisted = vi.fn<(draft: WorkflowDraft) => void>();
  const view = renderHook(
    (props: { input: WorkflowDraftInput; paused: boolean }) =>
      useWorkflowAutosave({ ...props, onPersisted }),
    { initialProps: { input, paused } },
  );
  return { ...view, onPersisted };
}

beforeEach(() => {
  vi.useFakeTimers();
  saveDraft.mockReset();
  saveDraft.mockImplementation(async (input) => stored(input));
});

afterEach(async () => {
  cleanup();
  // An interrupted editor's best-effort write may finish after cleanup.
  await Promise.resolve();
  await Promise.resolve();
  vi.useRealTimers();
});

describe("useWorkflowAutosave", () => {
  it("keeps edits made during a delayed save dirty until the latest revision is saved", async () => {
    const firstInput = inputFor();
    const latestInput = inputFor("保存期間又修正的第二版菜單");
    const firstWrite = deferred<WorkflowDraft>();
    const latestWrite = deferred<WorkflowDraft>();
    saveDraft
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(latestWrite.promise);
    const view = setup(firstInput);

    act(() => view.result.current.markDirty());
    await act(async () => vi.advanceTimersByTime(600));
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenNthCalledWith(1, firstInput);

    act(() => {
      view.rerender({ input: latestInput, paused: false });
      view.result.current.markDirty();
    });
    await act(async () => firstWrite.resolve(stored(firstInput)));

    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenNthCalledWith(2, latestInput);
    expect(view.result.current.dirty).toBe(true);
    expect(view.result.current.status).not.toBe("saved");
    expect(view.onPersisted).not.toHaveBeenCalled();

    const latestStored = stored(latestInput, 1);
    await act(async () => latestWrite.resolve(latestStored));

    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.status).toBe("saved");
    expect(view.result.current.updatedAt).toBe(latestStored.updatedAt);
    expect(view.onPersisted).toHaveBeenCalledExactlyOnceWith(latestStored);
    await act(async () => vi.advanceTimersByTime(600));
    expect(saveDraft).toHaveBeenCalledTimes(2);
  });

  it("serializes simultaneous flush requests and waits for a newer edit before allowing either to complete", async () => {
    const firstInput = inputFor();
    const latestInput = inputFor("切換案件之前最後修正的菜單");
    const firstWrite = deferred<WorkflowDraft>();
    const latestWrite = deferred<WorkflowDraft>();
    saveDraft
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(latestWrite.promise);
    const view = setup(firstInput);
    let firstFlush!: Promise<boolean>;
    let secondFlush!: Promise<boolean>;
    const completed = vi.fn();

    act(() => {
      view.result.current.markDirty();
      firstFlush = view.result.current.flush();
    });
    act(() => {
      view.rerender({ input: latestInput, paused: false });
      view.result.current.markDirty();
      secondFlush = view.result.current.flush();
    });
    void firstFlush.then(completed);
    void secondFlush.then(completed);

    expect(saveDraft).toHaveBeenCalledTimes(1);
    await act(async () => firstWrite.resolve(stored(firstInput)));
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenNthCalledWith(2, latestInput);
    expect(completed).not.toHaveBeenCalled();

    await act(async () => {
      latestWrite.resolve(stored(latestInput, 1));
      expect(await Promise.all([firstFlush, secondFlush])).toEqual([
        true,
        true,
      ]);
    });
    expect(completed).toHaveBeenCalledTimes(2);
    expect(view.result.current.dirty).toBe(false);
    expect(saveDraft).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejected latest write dirty and retries the current input", async () => {
    const input = inputFor();
    const failure = deferred<WorkflowDraft>();
    saveDraft.mockReturnValueOnce(failure.promise);
    const view = setup(input);
    let flush!: Promise<boolean>;

    act(() => {
      view.result.current.markDirty();
      flush = view.result.current.flush();
    });
    await act(async () => {
      failure.reject(new Error("IndexedDB temporarily unavailable"));
      expect(await flush).toBe(false);
    });
    expect(view.result.current.dirty).toBe(true);
    expect(view.result.current.status).toBe("error");
    expect(view.onPersisted).not.toHaveBeenCalled();

    await act(async () => {
      expect(await view.result.current.flush()).toBe(true);
    });
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenNthCalledWith(2, input);
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.status).toBe("saved");
  });

  it("joins the existing writer on unmount, drains the latest input, and never calls the old view back", async () => {
    const firstInput = inputFor();
    const latestInput = inputFor("離頁前最後一筆修改");
    const firstWrite = deferred<WorkflowDraft>();
    const latestWrite = deferred<WorkflowDraft>();
    saveDraft
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(latestWrite.promise);
    const view = setup(firstInput);

    act(() => view.result.current.markDirty());
    await act(async () => vi.advanceTimersByTime(600));
    act(() => {
      view.rerender({ input: latestInput, paused: false });
      view.result.current.markDirty();
    });
    view.unmount();
    expect(saveDraft).toHaveBeenCalledTimes(1);

    await act(async () => firstWrite.resolve(stored(firstInput)));
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenNthCalledWith(2, latestInput);
    await act(async () => latestWrite.resolve(stored(latestInput, 1)));
    await act(async () => vi.advanceTimersByTime(2_000));

    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(view.onPersisted).not.toHaveBeenCalled();
  });

  it("waits for the old writer before clearing a committed draft and cancels pending edits without resurrection", async () => {
    const firstInput = inputFor();
    const committedInput = inputFor("已正式保存的最後修正版");
    const firstWrite = deferred<WorkflowDraft>();
    saveDraft.mockReturnValueOnce(firstWrite.promise);
    const view = setup(firstInput);
    let clear!: Promise<void>;
    const cleared = vi.fn();

    act(() => view.result.current.markDirty());
    await act(async () => vi.advanceTimersByTime(600));
    act(() => {
      view.rerender({ input: committedInput, paused: false });
      view.result.current.markDirty();
    });
    act(() => {
      clear = view.result.current.clearAfterCommit();
    });
    void clear.then(cleared);
    await act(async () => vi.advanceTimersByTime(600));
    expect(cleared).not.toHaveBeenCalled();
    expect(saveDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve(stored(firstInput));
      await clear;
    });
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.updatedAt).toBeUndefined();
    expect(view.onPersisted).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(2_000));
    view.unmount();
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("clears a pending debounce after commit before any local write begins", async () => {
    const view = setup();
    act(() => view.result.current.markDirty());
    await act(async () => {
      await view.result.current.clearAfterCommit();
      vi.advanceTimersByTime(2_000);
    });
    view.unmount();

    expect(saveDraft).not.toHaveBeenCalled();
    expect(view.onPersisted).not.toHaveBeenCalled();
  });

  it("does not autosave while paused and saves once when editing resumes", async () => {
    const input = inputFor();
    const view = setup(input, true);
    act(() => view.result.current.markDirty());
    await act(async () => vi.advanceTimersByTime(2_000));

    expect(saveDraft).not.toHaveBeenCalled();
    expect(view.result.current.dirty).toBe(true);
    act(() => view.rerender({ input, paused: false }));
    await act(async () => vi.advanceTimersByTime(599));
    expect(saveDraft).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith(input);
    expect(view.result.current.dirty).toBe(false);
  });

  it("does not write an untouched editor during flush, timers, or unmount", async () => {
    const view = setup();
    await act(async () => {
      expect(await view.result.current.flush()).toBe(true);
      vi.advanceTimersByTime(2_000);
    });
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.status).toBe("idle");
    view.unmount();

    expect(saveDraft).not.toHaveBeenCalled();
    expect(view.onPersisted).not.toHaveBeenCalled();
  });
});
