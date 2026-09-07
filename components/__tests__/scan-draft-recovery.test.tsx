// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanDraftRecovery } from "@/components/scan-draft-recovery";
import type { ScanDraft } from "@/lib/scan-draft";

const draft: ScanDraft = {
  id: "scan-draft:demo-local:new",
  schemaVersion: 1,
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
  updatedAt: "2026-08-31T08:00:00.000Z",
};

afterEach(cleanup);

describe("ScanDraftRecovery", () => {
  it("requires an explicit resume or discard choice", () => {
    const onResume = vi.fn();
    const onDiscard = vi.fn();
    render(
      <ScanDraftRecovery
        draft={draft}
        onResume={onResume}
        onDiscard={onDiscard}
      />,
    );

    expect(
      screen.getByRole("region", { name: "未送出掃描草稿" }),
    ).toHaveTextContent("尚未新增餐期、掃描或上傳正式記錄");
    fireEvent.click(screen.getByRole("button", { name: "繼續草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "捨棄草稿" }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
