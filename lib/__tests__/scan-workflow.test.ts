import { describe, expect, it } from "vitest";
import {
  canPersistScanImage,
  createScanInitialForm,
  findSameDayLunchMeals,
  hasResolvedScanMealChoice,
  isDemoPlateUrl,
  plateScanMenuContext,
  resolveConfirmedPlateMenuContext,
  resolveScanMealTarget,
} from "@/lib/scan-workflow";
import { evidenceCaseToMealRecord } from "@/lib/evidence-meal";
import type { MealEvidenceCase } from "@/lib/evidence-chain";
import { createDemoSnapshot, DEMO_REFERENCE_DATE } from "@/lib/seed";

describe("scan workflow initialization", () => {
  const snapshot = createDemoSnapshot();
  const activeClasses = snapshot.classes.filter((item) => item.active);

  it("starts school cloud with the first active class and blank meal data", () => {
    expect(
      createScanInitialForm({
        mode: "school-cloud",
        activeClasses,
        now: new Date("2026-08-30T16:30:00.000Z"),
      }),
    ).toEqual({
      date: "2026-08-31",
      classId: activeClasses[0]?.id,
      staple: "",
      mainDish: "",
      sides: "",
      people: "",
      supplyKg: "",
      leftoverKg: "",
      notes: "",
    });
  });

  it("keeps the existing demo defaults", () => {
    expect(
      createScanInitialForm({ mode: "demo-local", activeClasses }),
    ).toEqual({
      date: DEMO_REFERENCE_DATE,
      classId: "class-5a",
      staple: "陽春麵",
      mainDish: "滷雞腿",
      sides: "高麗菜、芭樂",
      people: 25,
      supplyKg: 6.6,
      leftoverKg: 1.2,
      notes: "",
    });
  });

  it("prefills an explicitly linked meal exactly in either mode", () => {
    const linkedMeal = snapshot.meals.find(
      (meal) => meal.id === "meal-12-class-5a",
    );
    expect(linkedMeal).toBeDefined();

    expect(
      createScanInitialForm({
        mode: "school-cloud",
        activeClasses,
        linkedMeal,
      }),
    ).toEqual({
      date: linkedMeal?.servedOn,
      classId: linkedMeal?.classId,
      staple: linkedMeal?.staple,
      mainDish: linkedMeal?.mainDish,
      sides: linkedMeal?.sideDishes.join("、"),
      people: linkedMeal?.actualPeople,
      supplyKg: linkedMeal ? linkedMeal.totalSupplyG / 1000 : undefined,
      leftoverKg: linkedMeal ? linkedMeal.leftoverG / 1000 : undefined,
      notes: linkedMeal?.notes,
    });
  });
});

describe("school cloud demo image guard", () => {
  it.each([
    "/demo/plate-noodles.png",
    "https://school.example/demo/plate-greens.png?size=large",
  ])("recognizes demo image URLs: %s", (value) => {
    expect(isDemoPlateUrl(value)).toBe(true);
  });

  it.each(["blob:https://school.example/upload-id", "/uploads/plate.jpg", ""])(
    "allows non-demo image references: %s",
    (value) => {
      expect(isDemoPlateUrl(value)).toBe(false);
    },
  );

  it("requires a fresh upload and rejects demo references in school cloud", () => {
    expect(
      canPersistScanImage({
        mode: "school-cloud",
        hasUploadedImage: false,
        previewUrl: "",
      }),
    ).toBe(false);
    expect(
      canPersistScanImage({
        mode: "school-cloud",
        hasUploadedImage: true,
        selectedImage: "/demo/plate-noodles.png",
        previewUrl: "blob:https://school.example/upload-id",
      }),
    ).toBe(false);
    expect(
      canPersistScanImage({
        mode: "school-cloud",
        hasUploadedImage: true,
        selectedImage: "student-plate.jpg",
        previewUrl: "blob:https://school.example/upload-id",
      }),
    ).toBe(true);
  });
});

describe("scan meal ownership decision", () => {
  const snapshot = createDemoSnapshot();
  const existingMeal = snapshot.meals.find(
    (meal) => meal.id === "meal-12-class-5a",
  );

  it("requires an explicit choice even when the typed menu exactly matches", () => {
    expect(existingMeal).toBeDefined();
    const sameDayMeals = findSameDayLunchMeals({
      meals: snapshot.meals,
      classId: existingMeal?.classId ?? "",
      servedOn: existingMeal?.servedOn ?? "",
    });

    expect(
      hasResolvedScanMealChoice({
        sameDayMeals,
        choice: null,
      }),
    ).toBe(false);
    expect(
      resolveScanMealTarget({
        sameDayMeals,
        choice: null,
      }),
    ).toBeUndefined();
  });

  it("attaches only to the exact meal the student selected", () => {
    expect(existingMeal).toBeDefined();
    const sameDayMeals = existingMeal ? [existingMeal] : [];

    expect(
      resolveScanMealTarget({
        sameDayMeals,
        choice: { kind: "attach", mealId: existingMeal?.id ?? "" },
      }),
    ).toEqual(existingMeal);
    expect(
      hasResolvedScanMealChoice({
        sameDayMeals,
        choice: { kind: "attach", mealId: "meal-no-longer-exists" },
      }),
    ).toBe(false);
    expect(
      hasResolvedScanMealChoice({
        sameDayMeals: [],
        choice: { kind: "attach", mealId: existingMeal?.id ?? "" },
      }),
    ).toBe(false);
  });

  it("keeps an explicit new-meal decision separate from an identical menu", () => {
    expect(existingMeal).toBeDefined();
    const sameDayMeals = existingMeal ? [existingMeal] : [];

    expect(
      hasResolvedScanMealChoice({
        sameDayMeals,
        choice: { kind: "new" },
      }),
    ).toBe(true);
    expect(
      resolveScanMealTarget({
        sameDayMeals,
        choice: { kind: "new" },
      }),
    ).toBeUndefined();
  });

  it("does not add a decision step when no same-day meal exists", () => {
    expect(hasResolvedScanMealChoice({ sameDayMeals: [], choice: null })).toBe(
      true,
    );
  });

  it("treats a deep-linked record as an explicit attachment", () => {
    expect(existingMeal).toBeDefined();
    expect(
      resolveScanMealTarget({
        linkedMeal: existingMeal,
        sameDayMeals: [],
        choice: null,
      }),
    ).toEqual(existingMeal);
    expect(
      hasResolvedScanMealChoice({
        linkedMeal: existingMeal,
        sameDayMeals: [],
        choice: null,
      }),
    ).toBe(true);
  });
});

describe("confirmed menu candidates for plate analysis", () => {
  const snapshot = createDemoSnapshot();
  const evidenceCase = structuredClone(snapshot.evidenceCases[0]);
  const meal = evidenceCaseToMealRecord(evidenceCase);
  const linkedCase: MealEvidenceCase = {
    ...evidenceCase,
    mealRecordId: meal.id,
  };

  it("uses only the confirmed menu linked to the exact target meal", () => {
    expect(
      resolveConfirmedPlateMenuContext({
        evidenceCases: [linkedCase],
        meal,
      }),
    ).toMatchObject({
      menuVersionId: linkedCase.menuVersion.id,
      menuVersionSignature: linkedCase.menuVersion.signature,
      source: "demo",
      isMock: true,
      reviewedBy: "FoodLens 示範學生小組",
    });

    const context = resolveConfirmedPlateMenuContext({
      evidenceCases: [linkedCase],
      meal,
    });
    expect(context?.candidates).toHaveLength(
      linkedCase.menuVersion.plannedDishes.length,
    );
    expect(Object.keys(context?.candidates[0] ?? {}).sort()).toEqual([
      "basis",
      "category",
      "label",
      "rawName",
      "role",
    ]);
    expect(plateScanMenuContext(context)).toEqual({
      menuVersionId: linkedCase.menuVersion.id,
      menuVersionSignature: linkedCase.menuVersion.signature,
      candidateCount: linkedCase.menuVersion.plannedDishes.length,
    });
    expect(plateScanMenuContext(undefined)).toBeNull();
  });

  it("does not infer a menu from matching class, date or dish text", () => {
    expect(
      resolveConfirmedPlateMenuContext({
        evidenceCases: [evidenceCase],
        meal,
      }),
    ).toBeUndefined();
  });

  it("ignores an unconfirmed or stale linked menu", () => {
    const draftLinkedCase = {
      ...linkedCase,
      menuVersion: {
        ...linkedCase.menuVersion,
        status: "draft" as const,
        confirmation: null,
      },
    } as MealEvidenceCase;
    expect(
      resolveConfirmedPlateMenuContext({
        evidenceCases: [draftLinkedCase],
        meal,
      }),
    ).toBeUndefined();
    expect(
      resolveConfirmedPlateMenuContext({
        evidenceCases: [linkedCase],
        meal: { ...meal, menuSignature: "different-menu-version" },
      }),
    ).toBeUndefined();
  });

  it("refuses ambiguous duplicate evidence links instead of picking one", () => {
    const duplicate = {
      ...structuredClone(linkedCase),
      id: `${linkedCase.id}-duplicate`,
    };
    expect(
      resolveConfirmedPlateMenuContext({
        evidenceCases: [linkedCase, duplicate],
        meal,
      }),
    ).toBeUndefined();
  });
});
