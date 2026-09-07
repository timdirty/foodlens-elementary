import type { MealRecord } from "@/lib/types";
import type { MealSafetyObservation } from "@/lib/meal-safety";

/** New installation / explicit Demo reset only. Never backfill real or legacy data. */
export function createDemoMealSafetyObservations(
  meals: MealRecord[],
): MealSafetyObservation[] {
  return meals.map((meal, index) => {
    const unknown = index % 9 === 0;
    const invited = meal.actualPeople;
    const votes = index % 11 === 0 ? 0 : Math.max(0, invited - 3);
    const improving = meal.servedOn >= "2026-10-14";
    const ratings: [number, number, number, number, number] =
      votes === 0
        ? [0, 0, 0, 0, 0]
        : [
            1,
            1,
            improving ? 2 : 4,
            votes - (improving ? 9 : 10),
            improving ? 5 : 4,
          ];
    return {
      schemaVersion: 1,
      id: `c0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      mealRecordId: meal.id,
      revision: 1,
      previousObservationId: null,
      provenance: "demo",
      mealSnapshot: {
        classId: meal.classId,
        servedOn: meal.servedOn,
        mealPeriod: meal.mealPeriod,
        actualPeople: meal.actualPeople,
        menuSignature: meal.menuSignature,
      },
      sourceTitle: "FoodLens 逐餐安全觀察示範（非實測）",
      sourceReference: `DEMO-SAFETY-${String(index + 1).padStart(3, "0")}；生成測試資料，沒有學生問卷`,
      // Dataset creation time, not a claim that future scenario meals occurred.
      recordedAt: "2026-08-24T06:00:00Z",
      revisionReason: "",
      shortage: unknown
        ? { status: "not-collected", eventCount: null, observedDiners: null }
        : {
            status: "recorded",
            eventCount: improving ? index % 4 : index % 3,
            observedDiners: meal.actualPeople,
          },
      refill: unknown
        ? { status: "not-collected", eventCount: null, observedDiners: null }
        : {
            status: "recorded",
            eventCount: 3 + (index % 5),
            observedDiners: meal.actualPeople,
          },
      satisfaction: unknown
        ? { status: "not-collected", invitedDiners: null, ratings: null }
        : { status: "collected", invitedDiners: invited, ratings },
    };
  });
}
