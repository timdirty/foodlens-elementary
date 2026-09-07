import { describe, expect, it } from "vitest";
import {
  includeRequestedMeal,
  recordsUrlWithoutMeal,
  requestedSafetyMeal,
  resolveRecordsDeepLink,
} from "@/lib/records-deeplink";
import type { MealRecord } from "@/lib/types";

function meal(id: string, servedOn: string): MealRecord {
  return {
    id,
    classId: "class-5a",
    servedOn,
    mealPeriod: "lunch",
    staple: "白飯",
    mainDish: "咖哩雞",
    sideDishes: ["青菜"],
    menuSignature: "白飯|咖哩雞|青菜",
    plannedPeople: 30,
    actualPeople: 29,
    totalSupplyG: 21_000,
    leftoverG: 3_200,
    measurementMethod: "scale",
    source: "manual",
    notes: "",
    createdAt: `${servedOn}T04:00:00.000Z`,
    updatedAt: `${servedOn}T04:00:00.000Z`,
  };
}

describe("records deep link", () => {
  it("resolves from the complete snapshot and pins a globally filtered meal", () => {
    const recent = meal("meal-recent", "2026-08-31");
    const requested = meal("meal-old", "2026-05-01");

    const resolution = resolveRecordsDeepLink(
      [recent, requested],
      [recent],
      requested.id,
    );

    expect(resolution).toMatchObject({
      meal: requested,
      excludedByGlobalFilters: true,
      missing: false,
    });
    expect(includeRequestedMeal([recent], resolution.meal)).toEqual([
      recent,
      requested,
    ]);
  });

  it("does not invent a record for an unknown deep-link id", () => {
    const recent = meal("meal-recent", "2026-08-31");

    expect(resolveRecordsDeepLink([recent], [recent], "missing")).toEqual({
      excludedByGlobalFilters: false,
      missing: true,
    });
    expect(includeRequestedMeal([recent])).toEqual([recent]);
  });

  it("removes only the pinned meal when a local filter becomes the new intent", () => {
    expect(
      recordsUrlWithoutMeal(
        "https://foodlens.example/records?meal=meal-old&view=cards#results",
      ),
    ).toBe("/records?view=cards#results");
    expect(
      recordsUrlWithoutMeal(
        "https://foodlens.example/records?meal=meal-old#results",
      ),
    ).toBe("/records#results");
  });

  it("opens the safety editor only for the explicitly linked meal, not a later filtered record", () => {
    expect(requestedSafetyMeal("?meal=meal-old&safety=1")).toBe("meal-old");
    expect(requestedSafetyMeal("?meal=meal-old&safety=1")).not.toBe("meal-new");
    expect(requestedSafetyMeal("?meal=meal-old")).toBeUndefined();
    expect(requestedSafetyMeal("?safety=1")).toBeUndefined();
    const filtered = new URL(
      recordsUrlWithoutMeal(
        "https://foodlens.example/records?meal=meal-old&safety=1",
      ),
      "https://foodlens.example",
    );
    expect(requestedSafetyMeal(filtered.search)).toBeUndefined();
  });
});
