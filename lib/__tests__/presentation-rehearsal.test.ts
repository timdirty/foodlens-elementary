import { describe, expect, it } from "vitest";
import {
  FINAL_RUBRICS,
  PRESENTATION_PHASES,
  REHEARSAL_QUESTION_BANK,
  REHEARSAL_QUESTION_PACKS,
  SLIDE_RUBRIC_KEYS,
  SLIDE_SECONDS,
  getPhaseTimerState,
  getQuestionPack,
} from "@/lib/presentation-rehearsal";

describe("presentation rehearsal contract", () => {
  it("keeps the official 8 + 5 + 7 minute decision-day structure", () => {
    expect(SLIDE_SECONDS.reduce((total, seconds) => total + seconds, 0)).toBe(
      480,
    );
    expect(
      PRESENTATION_PHASES.map(({ id, durationSeconds }) => ({
        id,
        durationSeconds,
      })),
    ).toEqual([
      { id: "presentation", durationSeconds: 480 },
      { id: "judge-questions", durationSeconds: 300 },
      { id: "team-answers", durationSeconds: 420 },
    ]);
  });

  it("maps every slide to the official 30/30/30/10 final rubric", () => {
    expect(FINAL_RUBRICS.map(({ label, weight }) => [label, weight])).toEqual([
      ["可行性", 30],
      ["完整性", 30],
      ["發展性", 30],
      ["發表", 10],
    ]);
    expect(
      FINAL_RUBRICS.reduce((total, rubric) => total + rubric.weight, 0),
    ).toBe(100);
    expect(SLIDE_RUBRIC_KEYS).toHaveLength(8);
    expect(SLIDE_RUBRIC_KEYS.every((keys) => keys.length > 0)).toBe(true);
    expect(new Set(SLIDE_RUBRIC_KEYS.flat())).toEqual(
      new Set(FINAL_RUBRICS.map((rubric) => rubric.key)),
    );
  });

  it("provides three balanced four-question packs without losing bank items", () => {
    expect(REHEARSAL_QUESTION_BANK).toHaveLength(12);
    expect(REHEARSAL_QUESTION_PACKS).toHaveLength(3);

    for (let index = 0; index < REHEARSAL_QUESTION_PACKS.length; index += 1) {
      const pack = getQuestionPack(index);
      expect(pack).toHaveLength(4);
      expect(new Set(pack.map((question) => question.rubric))).toEqual(
        new Set(FINAL_RUBRICS.map((rubric) => rubric.key)),
      );
    }

    expect(new Set(REHEARSAL_QUESTION_PACKS.flat())).toEqual(
      new Set(REHEARSAL_QUESTION_BANK.map((question) => question.id)),
    );
  });

  it("gives every answer a direct lead, three evidence points, and an honesty boundary", () => {
    for (const question of REHEARSAL_QUESTION_BANK) {
      expect(question.answerLead.length).toBeGreaterThan(10);
      expect(question.answerPoints).toHaveLength(3);
      expect(question.answerPoints.every((point) => point.length > 10)).toBe(
        true,
      );
      expect(question.honestyBoundary.length).toBeGreaterThan(10);
      expect(question.evidenceLabels.length).toBeGreaterThan(0);
    }
  });

  it("reports remaining time and overtime without negative values", () => {
    expect(getPhaseTimerState("judge-questions", 75)).toMatchObject({
      durationSeconds: 300,
      elapsedSeconds: 75,
      remainingSeconds: 225,
      overtimeSeconds: 0,
      isOvertime: false,
      progress: 0.25,
    });
    expect(getPhaseTimerState("team-answers", 430)).toMatchObject({
      remainingSeconds: 0,
      overtimeSeconds: 10,
      isOvertime: true,
      progress: 1,
    });
    expect(getPhaseTimerState("presentation", -12).elapsedSeconds).toBe(0);
  });
});
