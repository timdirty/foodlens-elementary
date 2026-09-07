import type { MealRecord } from "@/lib/types";

export interface RecordsDeepLinkResolution {
  meal?: MealRecord;
  excludedByGlobalFilters: boolean;
  missing: boolean;
}

/**
 * Resolve a records deep link against the complete repository snapshot first.
 * The scoped list is only used to explain whether the global class/date filter
 * hid an otherwise valid record.
 */
export function resolveRecordsDeepLink(
  allMeals: readonly MealRecord[],
  scopedMeals: readonly MealRecord[],
  requestedMealId?: string,
): RecordsDeepLinkResolution {
  if (!requestedMealId)
    return { excludedByGlobalFilters: false, missing: false };

  const meal = allMeals.find((item) => item.id === requestedMealId);
  if (!meal) return { excludedByGlobalFilters: false, missing: true };

  return {
    meal,
    excludedByGlobalFilters: !scopedMeals.some(
      (item) => item.id === requestedMealId,
    ),
    missing: false,
  };
}

/** Keep a valid deep-linked record visible without changing the global scope. */
export function includeRequestedMeal(
  filteredMeals: readonly MealRecord[],
  requestedMeal?: MealRecord,
) {
  if (
    !requestedMeal ||
    filteredMeals.some((item) => item.id === requestedMeal.id)
  )
    return [...filteredMeals];
  return [...filteredMeals, requestedMeal];
}

/**
 * A local search/filter is a new browsing intent, so stop pinning the record
 * supplied by the inbound deep link while preserving unrelated URL state.
 */
export function recordsUrlWithoutMeal(requestUrl: string) {
  const url = new URL(requestUrl);
  url.searchParams.delete("meal");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** An editor intent belongs only to the specifically linked meal. */
export function requestedSafetyMeal(search: string): string | undefined {
  const params = new URLSearchParams(search);
  return params.get("safety") === "1"
    ? params.get("meal") || undefined
    : undefined;
}
