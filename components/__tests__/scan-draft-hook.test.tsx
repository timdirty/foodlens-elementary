// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createScanDraftId,
  deleteScanDraft,
  loadScanDraft,
  SCAN_DRAFT_MAX_AGE_MS,
  saveScanDraft,
  useScanDraft,
} from "@/lib/scan-draft";

const id = createScanDraftId({
  mode: "demo-local",
  workspaceKey: "hook-regression",
});
const expiredForeignId = createScanDraftId({
  mode: "school-cloud",
  workspaceKey: "hook-expired-foreign-workspace",
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all([deleteScanDraft(id), deleteScanDraft(expiredForeignId)]);
});

describe("useScanDraft", () => {
  it("does not show a recovery prompt while saving the active session", async () => {
    const first = renderHook(() => useScanDraft(id));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    await act(async () => {
      await first.result.current.save({
        id,
        mode: "demo-local",
        step: 2,
        form: {
          date: "2026-08-31",
          classId: "class-5a",
          staple: "白飯",
          mainDish: "雞肉",
          sides: "青菜",
          people: 25,
          supplyKg: 6,
          leftoverKg: 1,
          notes: "",
        },
        selectedImage: "/demo/plate-curry.png",
        imageSource: "demo",
        corrections: [],
        analysisMode: "mock",
        clientRequestId: "77777777-7777-4777-8777-777777777777",
      });
    });

    expect(first.result.current.draft).toBeUndefined();
    first.unmount();

    const interrupted = renderHook(() => useScanDraft(id));
    await waitFor(() =>
      expect(interrupted.result.current.draft?.form.mainDish).toBe("雞肉"),
    );
  });

  it("sweeps expired drafts from other workspaces when the scan store starts", async () => {
    const stored = await saveScanDraft({
      id: expiredForeignId,
      mode: "school-cloud",
      step: 2,
      form: {
        date: "2026-08-31",
        classId: "class-5a",
        staple: "白飯",
        mainDish: "雞肉",
        sides: "青菜",
        people: 25,
        supplyKg: 6,
        leftoverKg: 1,
        notes: "",
      },
      selectedImage: "plate.webp",
      imageSource: "upload",
      imageBlob: new Blob(["expired-image"], { type: "image/webp" }),
      corrections: [],
      analysisMode: "mock",
      clientRequestId: "77777777-7777-4777-8777-777777777777",
    });
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse(stored.updatedAt) + SCAN_DRAFT_MAX_AGE_MS + 1,
    );

    const activeWorkspace = renderHook(() => useScanDraft(id));
    await waitFor(() =>
      expect(activeWorkspace.result.current.loading).toBe(false),
    );

    await expect(
      loadScanDraft(expiredForeignId, Date.parse(stored.updatedAt)),
    ).resolves.toBeUndefined();
  });
});
