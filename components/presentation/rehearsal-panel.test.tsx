// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RehearsalPanel } from "@/components/presentation/rehearsal-panel";
import { getQuestionPack } from "@/lib/presentation-rehearsal";

afterEach(cleanup);

const questions = getQuestionPack(0);

function renderPanel(
  overrides: Partial<ComponentProps<typeof RehearsalPanel>> = {},
) {
  const props: ComponentProps<typeof RehearsalPanel> = {
    phase: "judge-questions",
    mode: "demo-local",
    packIndex: 0,
    questions,
    activeIndex: 0,
    revealedQuestionIds: new Set(),
    completedQuestionIds: new Set(),
    onSelectQuestion: vi.fn(),
    onPreviousQuestion: vi.fn(),
    onNextQuestion: vi.fn(),
    onToggleReveal: vi.fn(),
    onToggleComplete: vi.fn(),
    onCyclePack: vi.fn(),
    onOpenAnswers: vi.fn(),
    onOpenQuestions: vi.fn(),
    onChooseFromBank: vi.fn(),
    ...overrides,
  };
  render(<RehearsalPanel {...props} />);
  return props;
}

describe("RehearsalPanel", () => {
  it("keeps answer points hidden during the five-minute listening phase", () => {
    const props = renderPanel({ activeIndex: questions.length - 1 });

    expect(
      screen.getByRole("heading", {
        name: "先把問題聽完整，再決定怎麼回答",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("這一段先不顯示答案")).toBeInTheDocument();
    expect(
      screen.queryByText(questions[questions.length - 1].answerLead),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/目前是示範資料/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /完成記題，進入 7 分鐘答詢/,
      }),
    );
    expect(props.onOpenAnswers).toHaveBeenCalledOnce();
  });

  it("lets students reveal and mark one answer during team practice", () => {
    const onToggleReveal = vi.fn();
    const onToggleComplete = vi.fn();
    renderPanel({
      phase: "team-answers",
      onToggleReveal,
      onToggleComplete,
    });

    expect(screen.getByText(/先由隊員口頭回答/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "顯示答案重點" }));
    fireEvent.click(screen.getByRole("button", { name: "標記已完成" }));
    expect(onToggleReveal).toHaveBeenCalledWith(questions[0].id);
    expect(onToggleComplete).toHaveBeenCalledWith(questions[0].id);
  });

  it("shows a direct answer, evidence points, and the honesty boundary after reveal", () => {
    renderPanel({
      phase: "team-answers",
      revealedQuestionIds: new Set([questions[0].id]),
    });

    expect(screen.getByText(questions[0].answerLead)).toBeInTheDocument();
    for (const point of questions[0].answerPoints) {
      expect(screen.getByText(point)).toBeInTheDocument();
    }
    expect(screen.getByText(questions[0].honestyBoundary)).toBeInTheDocument();
    expect(screen.getByText(/可出示證據/)).toBeInTheDocument();
  });
});
