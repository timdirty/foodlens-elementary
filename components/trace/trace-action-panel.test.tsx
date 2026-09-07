// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceActionPanel } from "@/components/trace/trace-action-panel";
import type { CollectionEvent, DestinationReceipt } from "@/lib/circularity";

afterEach(cleanup);

const scheduledEvent: CollectionEvent = {
  id: "trace-focus-event",
  evidenceCaseId: "evidence-focus-case",
  status: "scheduled",
  scheduledAt: "2026-09-05T05:00:00.000Z",
  weightState: "standard_drained",
  plannedDestinationName: "示範資源處理場",
  plannedTreatmentMethod: "composting",
  wasteSources: ["preparation", "plate_edible"],
  provenance: "demo",
  createdAt: "2026-09-05T04:00:00.000Z",
  updatedAt: "2026-09-05T04:00:00.000Z",
};

const collectedEvent: CollectionEvent = {
  ...scheduledEvent,
  status: "collected",
  collectedAt: "2026-09-05T05:15:00.000Z",
  haulerName: "示範清運合作單位",
  netCollectedWeightG: 6_800,
  updatedAt: "2026-09-05T05:16:00.000Z",
};

const submittedReceipt: DestinationReceipt = {
  id: "trace-focus-receipt",
  collectionEventId: collectedEvent.id,
  receiptReference: "DEMO-RC-FOCUS",
  facilityName: "示範資源處理場",
  actualTreatmentMethod: "composting",
  acceptedWeightG: 6_680,
  receivedAt: "2026-09-05T06:00:00.000Z",
  status: "submitted",
  provenance: "demo",
  createdAt: "2026-09-05T06:01:00.000Z",
  updatedAt: "2026-09-05T06:01:00.000Z",
};

function renderPanel(event: CollectionEvent, receipt?: DestinationReceipt) {
  render(
    <TraceActionPanel
      event={event}
      receipt={receipt}
      suggestedWeightG={6_800}
      mode="demo-local"
      busy={false}
      onSaveCollection={vi.fn(async () => undefined)}
      onSaveReceipt={vi.fn(async () => undefined)}
    />,
  );
}

function expectReviewAndReturn(triggerName: string) {
  const trigger = screen.getByRole("button", { name: triggerName });
  fireEvent.click(trigger);
  expect(screen.getByRole("region", { name: "送出前二次確認" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
  expect(screen.getByRole("button", { name: triggerName })).toHaveFocus();
}

describe("TraceActionPanel confirmation focus", () => {
  it("returns to the correct collection or cancellation trigger", () => {
    renderPanel(scheduledEvent);

    expectReviewAndReturn("檢查交接資料");
    expectReviewAndReturn("取消這筆安排");
  });

  it("returns to the receipt submission trigger", () => {
    renderPanel(collectedEvent);

    expectReviewAndReturn("檢查申報資料");
  });

  it("returns to the verification or rejection trigger", () => {
    renderPanel(collectedEvent, submittedReceipt);

    expectReviewAndReturn("檢查核驗內容");
    fireEvent.change(
      screen.getByPlaceholderText(
        "例如：收料重量與原始入場單不符，請重新提供文件",
      ),
      { target: { value: "文件內容不符，請重新提供" } },
    );
    expectReviewAndReturn("檢查退回原因");
  });
});
