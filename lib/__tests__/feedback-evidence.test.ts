import { describe, expect, it } from "vitest";
import {
  analyzeEvidenceCases,
  caseToWasteObservation,
  createDemoEvidenceCases,
  emptyReasonCounts,
  mealEvidenceCaseSchema,
  teacherEvidenceContextSchema,
} from "@/lib/evidence-chain";

function unknownCase() {
  return {
    ...structuredClone(createDemoEvidenceCases()[0]),
    reasonCollectionStatus: "not-collected" as const,
    reasonCounts: emptyReasonCounts(),
    teacherContext: {
      deliveryStatus: "not-collected" as const,
      temperatureStatus: "not-collected" as const,
      deliveryDelayMinutes: null,
      temperatureConcern: null,
      note: "尚未收集現場回饋",
    },
  };
}

describe("explicit feedback evidence contract", () => {
  it("keeps unknown distinct from an explicitly collected zero and observed false", () => {
    const unknown = unknownCase();
    expect(
      mealEvidenceCaseSchema.parse(unknown).reasonCounts.portion,
    ).toBeNull();
    expect(caseToWasteObservation(unknown).context).toMatchObject({
      delivery: { delayMinutes: null, temperatureConcern: null },
    });
    expect(caseToWasteObservation(unknown).context.feedback).toBeUndefined();

    const zero = {
      ...unknown,
      reasonCollectionStatus: "collected",
      reasonCounts: Object.fromEntries(
        Object.keys(unknown.reasonCounts).map((key) => [key, 0]),
      ),
      teacherContext: {
        ...unknown.teacherContext,
        deliveryStatus: "recorded",
        temperatureStatus: "recorded",
        deliveryDelayMinutes: 0,
        temperatureConcern: false,
      },
    };
    expect(caseToWasteObservation(zero).context).toMatchObject({
      feedback: { responseCount: 0, portionTooMuchCount: 0 },
      delivery: { delayMinutes: 0, temperatureConcern: false },
    });
    expect(analyzeEvidenceCases([zero]).feedbackCoverage).toEqual({
      collectedMeals: 1,
      zeroResponseMeals: 1,
      uncollectedMeals: 0,
      legacyUnverifiedMeals: 0,
      confirmedResponseCount: 0,
      deliveryObservedMeals: 1,
      temperatureObservedMeals: 1,
    });
  });

  it("preserves old numeric values but never assumes they were collected", () => {
    const raw = JSON.parse(JSON.stringify(createDemoEvidenceCases()[0]));
    delete raw.feedbackSchemaVersion;
    delete raw.reasonCollectionStatus;
    delete raw.teacherContext.deliveryStatus;
    delete raw.teacherContext.temperatureStatus;
    raw.teacherContext.deliveryDelayMinutes = 99;
    raw.teacherContext.temperatureConcern = true;
    const before = JSON.stringify(raw);
    const parsed = mealEvidenceCaseSchema.parse(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(parsed.reasonCounts).toEqual(raw.reasonCounts);
    expect(parsed.teacherContext.deliveryDelayMinutes).toBe(99);
    expect(parsed.reasonCollectionStatus).toBe("legacy-unverified");
    expect(parsed.teacherContext.deliveryStatus).toBe("legacy-unverified");
    expect(caseToWasteObservation(parsed).context.feedback).toBeUndefined();
    expect(caseToWasteObservation(parsed).context.delivery).toEqual({
      delayMinutes: null,
      temperatureConcern: null,
    });
    const analysis = analyzeEvidenceCases([parsed]);
    expect(analysis.feedbackCoverage.legacyUnverifiedMeals).toBe(1);
    expect(analysis.feedbackCoverage.confirmedResponseCount).toBe(0);
    expect(
      analysis.responsibilityCards.some((card) => card.id === "delivery"),
    ).toBe(false);
  });

  it("keeps missing legacy subfields null instead of fabricating zero or false", () => {
    const raw = JSON.parse(JSON.stringify(createDemoEvidenceCases()[0]));
    delete raw.reasonCollectionStatus;
    raw.reasonCounts = { portion: 2 };
    raw.teacherContext = { note: "舊版只留下備註" };
    const parsed = mealEvidenceCaseSchema.parse(raw);
    expect(parsed.reasonCounts).toMatchObject({ portion: 2, taste: null });
    expect(parsed.teacherContext).toMatchObject({
      deliveryStatus: "legacy-unverified",
      deliveryDelayMinutes: null,
      temperatureStatus: "legacy-unverified",
      temperatureConcern: null,
    });
  });

  it("rejects contradictory states, partial collected counts, and out-of-range values", () => {
    const unknown = unknownCase();
    for (const candidate of [
      { ...unknown, reasonCounts: { ...unknown.reasonCounts, portion: 0 } },
      { ...unknown, reasonCollectionStatus: "collected" },
      { ...unknown, feedbackSchemaVersion: 3 },
      {
        ...unknown,
        reasonCollectionStatus: "legacy-unverified",
        reasonCounts: { ...unknown.reasonCounts, portion: -1 },
      },
      {
        ...unknown,
        reasonCollectionStatus: "legacy-unverified",
        reasonCounts: { ...unknown.reasonCounts, portion: 0.5 },
      },
    ])
      expect(mealEvidenceCaseSchema.safeParse(candidate).success).toBe(false);
    for (const teacherContext of [
      { ...unknown.teacherContext, deliveryStatus: "recorded" },
      { ...unknown.teacherContext, deliveryDelayMinutes: 0 },
      { ...unknown.teacherContext, temperatureConcern: false },
      { ...unknown.teacherContext, temperatureStatus: "recorded" },
    ])
      expect(
        teacherEvidenceContextSchema.safeParse(teacherContext).success,
      ).toBe(false);
  });

  it("does not emit a fictitious maximum delay when only temperature was observed", () => {
    const current = unknownCase();
    const analysis = analyzeEvidenceCases([
      {
        ...current,
        teacherContext: {
          ...current.teacherContext,
          temperatureStatus: "recorded",
          temperatureConcern: true,
        },
      },
    ]);
    const card = analysis.responsibilityCards.find(
      (item) => item.id === "delivery",
    );
    expect(card).toBeDefined();
    const delay = card!.evidence.find((item) => item.code === "delivery-delay");
    expect(delay?.value).toBeUndefined();
    expect(delay?.label).toContain("尚無觀察");
    const temperature = card!.evidence.find(
      (item) => item.code === "temperature-feedback",
    );
    expect(temperature?.value).toBeUndefined();
    expect(temperature?.label).toContain("尚未收集");
    expect(analysis.feedbackCoverage.temperatureObservedMeals).toBe(1);
    expect(analysis.feedbackCoverage.deliveryObservedMeals).toBe(0);
  });

  it("uses only collected responses as the feedback denominator in mixed cohorts", () => {
    const cases = createDemoEvidenceCases();
    cases[1].reasonCollectionStatus = "legacy-unverified";
    const unknown = { ...unknownCase(), id: "unknown-case" };
    const result = analyzeEvidenceCases([cases[0], cases[1], unknown]);
    expect(result.feedbackCoverage).toMatchObject({
      collectedMeals: 1,
      uncollectedMeals: 1,
      legacyUnverifiedMeals: 1,
      confirmedResponseCount: 15,
    });
  });
});
