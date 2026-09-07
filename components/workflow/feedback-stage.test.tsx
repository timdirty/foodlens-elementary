// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackStage } from "./feedback-stage";
import type {
  AnonymousReasonCounts,
  TeacherEvidenceContext,
} from "@/lib/evidence-chain";

type StageProps = ComponentProps<typeof FeedbackStage>;

const unknownCounts: AnonymousReasonCounts = {
  portion: null,
  taste: null,
  texture: null,
  temperature: null,
  time: null,
  other: null,
};
const legacyCounts: AnonymousReasonCounts = {
  portion: 4,
  taste: 0,
  texture: 2,
  temperature: 0,
  time: 1,
  other: 0,
};
const unknownContext: TeacherEvidenceContext = {
  deliveryStatus: "not-collected",
  deliveryDelayMinutes: null,
  temperatureStatus: "not-collected",
  temperatureConcern: null,
  note: "",
};
const legacyContext: TeacherEvidenceContext = {
  deliveryStatus: "legacy-unverified",
  deliveryDelayMinutes: 5,
  temperatureStatus: "legacy-unverified",
  temperatureConcern: false,
  note: "舊紀錄",
};

function Harness(props: StageProps) {
  const [status, setStatus] = useState(props.reasonCollectionStatus);
  const [counts, setCounts] = useState(props.reasonCounts);
  const [context, setContext] = useState(props.teacherContext);

  return (
    <FeedbackStage
      {...props}
      reasonCollectionStatus={status}
      reasonCounts={counts}
      teacherContext={context}
      onReasonCollectionChange={(nextStatus, nextCounts) => {
        props.onReasonCollectionChange(nextStatus, nextCounts);
        setStatus(nextStatus);
        setCounts(nextCounts);
      }}
      onReasonChange={(key, count) => {
        props.onReasonChange(key, count);
        setCounts((current) => ({ ...current, [key]: count }));
      }}
      onContextChange={(patch) => {
        props.onContextChange(patch);
        setContext((current) => ({ ...current, ...patch }));
      }}
    />
  );
}

function renderStage(overrides: Partial<StageProps> = {}) {
  const props: StageProps = {
    reasonCollectionStatus: "not-collected",
    reasonCounts: { ...unknownCounts },
    teacherContext: { ...unknownContext },
    actualDiners: 30,
    onReasonCollectionChange: vi.fn(),
    onReasonChange: vi.fn(),
    onContextChange: vi.fn(),
    ...overrides,
  };
  render(<Harness {...props} />);
  return props;
}

afterEach(cleanup);

describe("FeedbackStage unknown and recorded feedback", () => {
  it("does not render uncollected feedback as zero or an unchecked observation", () => {
    const props = renderStage();
    expect(screen.getByLabelText("匿名回覆收集狀態")).toHaveValue(
      "not-collected",
    );
    const count = screen.getByLabelText("份量太多票數");
    expect(count).toBeDisabled();
    expect(count).toHaveValue(null);
    expect(screen.getByLabelText("配送延遲（分鐘）")).toHaveValue(null);
    expect(screen.getByLabelText("現場溫度觀察（僅作線索）")).toHaveValue(
      "not-collected",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/目前共 0 票/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /份量太多 · 未收集/ }),
    ).toBeInTheDocument();
    expect(props.onReasonCollectionChange).not.toHaveBeenCalled();
    expect(props.onContextChange).not.toHaveBeenCalled();
  });

  it("allows zero while keeping an emptied field null without prefilling the other reasons", () => {
    const props = renderStage();
    fireEvent.change(screen.getByLabelText("匿名回覆收集狀態"), {
      target: { value: "collected" },
    });
    expect(props.onReasonCollectionChange).toHaveBeenLastCalledWith(
      "collected",
      unknownCounts,
    );
    const count = screen.getByLabelText("份量太多票數");
    expect(count).toBeEnabled();
    expect(count).toHaveValue(null);
    fireEvent.change(count, { target: { value: "0" } });
    expect(props.onReasonChange).toHaveBeenLastCalledWith("portion", 0);
    expect(count).toHaveValue(0);
    expect(screen.getByText(/已填 1／6 項/)).toBeInTheDocument();
    fireEvent.change(count, { target: { value: "" } });
    expect(props.onReasonChange).toHaveBeenLastCalledWith("portion", null);
    expect(count).toHaveValue(null);
    expect(screen.getByText(/已填 0／6 項/)).toBeInTheDocument();
  });

  it("only records an all-zero response set after an explicit no-responses action", () => {
    const props = renderStage({ reasonCollectionStatus: "collected" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "已收集但沒有回覆，全部記為 0 票",
      }),
    );
    expect(props.onReasonCollectionChange).toHaveBeenLastCalledWith(
      "collected",
      {
        portion: 0,
        taste: 0,
        texture: 0,
        temperature: 0,
        time: 0,
        other: 0,
      },
    );
    expect(screen.getByText(/目前共 0 票／實到 30 人/)).toBeInTheDocument();
  });

  it.each(["-1", "1.5", "31"])(
    "does not silently clamp or round invalid reason count %s",
    (value) => {
      const props = renderStage({ reasonCollectionStatus: "collected" });
      const input = screen.getByLabelText("份量太多票數");
      fireEvent.change(input, { target: { value } });
      expect(props.onReasonChange).toHaveBeenLastCalledWith(
        "portion",
        Number(value),
      );
      expect(input).toHaveValue(Number(value));
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText(/目前共/)).not.toBeInTheDocument();
    },
  );

  it("clears all counts including extensions when explicitly marking the survey uncollected", () => {
    const props = renderStage({
      reasonCollectionStatus: "collected",
      reasonCounts: { ...legacyCounts, unfamiliar: 3 },
    });
    fireEvent.change(screen.getByLabelText("匿名回覆收集狀態"), {
      target: { value: "not-collected" },
    });
    expect(props.onReasonCollectionChange).toHaveBeenLastCalledWith(
      "not-collected",
      { ...unknownCounts, unfamiliar: null },
    );
    expect(
      screen.getByLabelText("其他已保存原因（unfamiliar）票數"),
    ).toBeDisabled();
  });

  it("retains legacy values without counting or confirming them on mount", () => {
    const props = renderStage({
      reasonCollectionStatus: "legacy-unverified",
      reasonCounts: { ...legacyCounts },
    });
    expect(screen.getByLabelText("份量太多票數")).toHaveValue(4);
    expect(screen.getByLabelText("份量太多票數")).toBeDisabled();
    expect(screen.getByText(/舊紀錄沒有收集狀態/)).toBeInTheDocument();
    expect(screen.queryByText(/目前共 7 票/)).not.toBeInTheDocument();
    expect(props.onReasonCollectionChange).not.toHaveBeenCalled();
    expect(props.onReasonChange).not.toHaveBeenCalled();
  });

  it("requires explicit legacy review and keeps extension counts editable and in the total", () => {
    const props = renderStage({
      reasonCollectionStatus: "legacy-unverified",
      reasonCounts: { ...legacyCounts, unfamiliar: 3 },
    });
    const review = screen.getByRole("button", {
      name: "已逐項複核，採用原票數",
    });
    review.focus();
    expect(review).toHaveFocus();
    fireEvent.click(review);
    expect(props.onReasonCollectionChange).toHaveBeenLastCalledWith(
      "collected",
      { ...legacyCounts, unfamiliar: 3 },
    );
    expect(screen.getByText(/目前共 10 票/)).toBeInTheDocument();
    const extra = screen.getByLabelText("其他已保存原因（unfamiliar）票數");
    fireEvent.change(extra, { target: { value: "0" } });
    expect(props.onReasonChange).toHaveBeenLastCalledWith("unfamiliar", 0);
    expect(screen.getByText(/目前共 7 票/)).toBeInTheDocument();
  });

  it("requires re-entry instead of accepting legacy values through the collection-status selector", () => {
    const props = renderStage({
      reasonCollectionStatus: "legacy-unverified",
      reasonCounts: { ...legacyCounts, unfamiliar: 3 },
    });
    fireEvent.change(screen.getByLabelText("匿名回覆收集狀態"), {
      target: { value: "collected" },
    });
    expect(props.onReasonCollectionChange).toHaveBeenLastCalledWith(
      "collected",
      { ...unknownCounts, unfamiliar: null },
    );
    expect(screen.getByLabelText("份量太多票數")).toBeEnabled();
    expect(screen.getByLabelText("份量太多票數")).toHaveValue(null);
    expect(screen.getByText(/已填 0／7 項/)).toBeInTheDocument();
    expect(screen.queryByText(/目前共 10 票/)).not.toBeInTheDocument();
  });
});

describe("FeedbackStage separate teacher observation states", () => {
  it("distinguishes measured zero delivery delay from an empty delay", () => {
    const props = renderStage();
    const delay = screen.getByLabelText("配送延遲（分鐘）");
    fireEvent.change(delay, { target: { value: "0" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      deliveryDelayMinutes: 0,
      deliveryStatus: "recorded",
    });
    expect(delay).toHaveValue(0);
    fireEvent.change(delay, { target: { value: "" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      deliveryDelayMinutes: null,
      deliveryStatus: "not-collected",
    });
    expect(delay).toHaveValue(null);
  });

  it("does not promote a legacy temperature value when the delivery value is explicitly reviewed", () => {
    const props = renderStage({ teacherContext: { ...legacyContext } });
    expect(screen.getByLabelText("配送延遲（分鐘）")).toHaveValue(5);
    expect(
      screen.getByText(/舊值尚未複核，不當作配送觀察/),
    ).toBeInTheDocument();
    expect(props.onContextChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "已查證，採用配送原值" }),
    );
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      deliveryStatus: "recorded",
    });
    expect(screen.getByLabelText("現場溫度觀察（僅作線索）")).toHaveValue(
      "legacy-unverified",
    );
  });

  it("represents no concern, a concern and no observation as three distinct choices", () => {
    const props = renderStage();
    const temperature = screen.getByLabelText("現場溫度觀察（僅作線索）");
    temperature.focus();
    expect(temperature).toHaveFocus();
    fireEvent.change(temperature, { target: { value: "false" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      temperatureConcern: false,
      temperatureStatus: "recorded",
    });
    fireEvent.change(temperature, { target: { value: "true" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      temperatureConcern: true,
      temperatureStatus: "recorded",
    });
    fireEvent.change(temperature, { target: { value: "not-collected" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      temperatureConcern: null,
      temperatureStatus: "not-collected",
    });
    expect(screen.getByLabelText("配送延遲（分鐘）")).toHaveValue(null);
  });

  it("shows legacy false as unverified until that observation is explicitly selected", () => {
    const props = renderStage({ teacherContext: { ...legacyContext } });
    const temperature = screen.getByLabelText("現場溫度觀察（僅作線索）");
    expect(temperature).toHaveValue("legacy-unverified");
    expect(
      screen.getByRole("option", { name: "舊值：無疑慮（待複核）" }),
    ).toBeDisabled();
    fireEvent.change(temperature, { target: { value: "false" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      temperatureConcern: false,
      temperatureStatus: "recorded",
    });
    expect(
      screen.getByRole("button", { name: "已查證，採用配送原值" }),
    ).toBeInTheDocument();
  });

  it("shows validation errors accessibly while preserving invalid numeric input", () => {
    const props = renderStage({ error: "請確認匿名票數不能超過實到人數" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "請確認匿名票數不能超過實到人數",
    );
    const delay = screen.getByLabelText("配送延遲（分鐘）");
    fireEvent.change(delay, { target: { value: "1.5" } });
    expect(props.onContextChange).toHaveBeenLastCalledWith({
      deliveryDelayMinutes: 1.5,
      deliveryStatus: "recorded",
    });
    expect(delay).toHaveValue(1.5);
    expect(delay).toHaveAttribute("aria-invalid", "true");
    expect(delay).toHaveAccessibleDescription(/請填 0–1440 的整數/);
  });
});
