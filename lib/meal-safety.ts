import { z } from "zod";
import { createUuid } from "@/lib/crypto";
import { epochDay } from "@/lib/date";
import { selectExperimentMeals } from "@/lib/analysis";
import type { DataMode, ImprovementExperiment, MealRecord } from "@/lib/types";

const count = z.number().int().min(0).max(20_000);
const identity = z.string().trim().min(1).max(200);
const eventObservationSchema = z
  .object({
    status: z.enum(["not-collected", "recorded"]),
    eventCount: count.nullable(),
    observedDiners: count.nullable(),
  })
  .strict();
const ratingsSchema = z.tuple([count, count, count, count, count]);

export const mealSafetyObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    mealRecordId: identity,
    revision: z.number().int().min(1),
    previousObservationId: z.string().uuid().nullable(),
    provenance: z.enum(["demo", "school-record"]),
    mealSnapshot: z
      .object({
        classId: identity,
        servedOn: z.string().refine((value) => {
          try {
            epochDay(value);
            return true;
          } catch {
            return false;
          }
        }, "供餐日期無效"),
        mealPeriod: z.literal("lunch"),
        actualPeople: count,
        menuSignature: z.string().trim().min(1).max(1000),
      })
      .strict(),
    sourceTitle: z.string().trim().max(160),
    sourceReference: z.string().trim().max(240),
    recordedAt: z.string().datetime({ offset: true }),
    revisionReason: z.string().trim().max(500),
    shortage: eventObservationSchema,
    refill: eventObservationSchema,
    satisfaction: z
      .object({
        status: z.enum(["not-collected", "collected"]),
        invitedDiners: count.nullable(),
        ratings: ratingsSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if ((value.revision === 1) !== (value.previousObservationId === null))
      issue(["previousObservationId"], "第一版不得有前版；修訂必須指向上一版");
    if (value.revision > 1 && value.revisionReason.length < 3)
      issue(["revisionReason"], "修訂須填寫至少 3 字理由，原版會保留");
    for (const metric of ["shortage", "refill"] as const) {
      const observation = value[metric];
      if (observation.status === "not-collected") {
        if (
          observation.eventCount !== null ||
          observation.observedDiners !== null
        )
          issue([metric], "尚未觀察須保持空白，不可推定為零事件");
      } else {
        if (observation.eventCount === null)
          issue(
            [metric, "eventCount"],
            "已觀察須填寫事件人次；確認沒有事件才填 0",
          );
        if (
          observation.observedDiners === null ||
          observation.observedDiners < 1 ||
          observation.observedDiners > value.mealSnapshot.actualPeople
        )
          issue(
            [metric, "observedDiners"],
            "觀察用餐人次須介於 1 與本餐實到人數之間",
          );
      }
    }
    const satisfaction = value.satisfaction;
    if (satisfaction.status === "not-collected") {
      if (satisfaction.invitedDiners !== null || satisfaction.ratings !== null)
        issue(["satisfaction"], "未收集滿意度須保持空白，不可推定為零票");
    } else {
      if (
        satisfaction.invitedDiners === null ||
        satisfaction.invitedDiners < 1 ||
        satisfaction.invitedDiners > value.mealSnapshot.actualPeople
      )
        issue(
          ["satisfaction", "invitedDiners"],
          "邀請填答人次須介於 1 與本餐實到人數之間",
        );
      if (satisfaction.ratings === null)
        issue(
          ["satisfaction", "ratings"],
          "已收集須逐項填寫 1–5 分票數；沒有回覆可明確記為全 0",
        );
      else if (
        satisfaction.ratings.reduce((sum, votes) => sum + votes, 0) >
        (satisfaction.invitedDiners ?? 0)
      )
        issue(
          ["satisfaction", "ratings"],
          "每餐每人最多一份滿意度回覆；票數不可高於邀請人次",
        );
    }
    if (
      value.shortage.status === "recorded" ||
      value.refill.status === "recorded" ||
      satisfaction.status === "collected"
    ) {
      if (value.sourceTitle.length < 3)
        issue(["sourceTitle"], "已收集觀察須填寫至少 3 字來源名稱");
      if (value.sourceReference.length < 3)
        issue(["sourceReference"], "已收集觀察須填寫至少 3 字來源索引");
    }
  });

export type MealSafetyObservation = z.infer<typeof mealSafetyObservationSchema>;

export function createEmptyMealSafetyObservation(
  meal: MealRecord,
  provenance: MealSafetyObservation["provenance"],
  id = createUuid(),
  recordedAt = new Date().toISOString(),
): MealSafetyObservation {
  return mealSafetyObservationSchema.parse({
    schemaVersion: 1,
    id,
    mealRecordId: meal.id,
    revision: 1,
    previousObservationId: null,
    provenance,
    mealSnapshot: {
      classId: meal.classId,
      servedOn: meal.servedOn,
      mealPeriod: meal.mealPeriod,
      actualPeople: meal.actualPeople,
      menuSignature: meal.menuSignature,
    },
    sourceTitle: "",
    sourceReference: "",
    recordedAt,
    revisionReason: "",
    shortage: {
      status: "not-collected",
      eventCount: null,
      observedDiners: null,
    },
    refill: { status: "not-collected", eventCount: null, observedDiners: null },
    satisfaction: {
      status: "not-collected",
      invitedDiners: null,
      ratings: null,
    },
  });
}

function naturalKey(
  meal: Pick<MealRecord, "classId" | "servedOn" | "mealPeriod">,
) {
  return JSON.stringify([meal.classId, meal.servedOn, meal.mealPeriod]);
}

function indexMeals(meals: readonly MealRecord[]) {
  const byId = new Map<string, MealRecord[]>();
  const naturalCounts = new Map<string, number>();
  for (const meal of meals) {
    const entries = byId.get(meal.id);
    if (entries) entries.push(meal);
    else byId.set(meal.id, [meal]);
    const key = naturalKey(meal);
    naturalCounts.set(key, (naturalCounts.get(key) ?? 0) + 1);
  }
  return { byId, naturalCounts };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function checkedHistory(raw: readonly unknown[]) {
  const rows = raw.map((row) => mealSafetyObservationSchema.parse(row));
  const ids = new Set<string>();
  const byMeal = new Map<string, MealSafetyObservation[]>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error("安全觀察編號重複，歷史未變更");
    ids.add(row.id);
    const history = byMeal.get(row.mealRecordId);
    if (history) history.push(row);
    else byMeal.set(row.mealRecordId, [row]);
  }
  for (const history of byMeal.values()) {
    history.sort((a, b) => a.revision - b.revision);
    history.forEach((row, index) => {
      const previous = history[index - 1];
      if (
        row.revision !== index + 1 ||
        row.previousObservationId !== (previous?.id ?? null)
      )
        throw new Error("安全觀察修訂鏈不連續，請重新讀取最新版本");
      if (
        previous &&
        (naturalKey(previous.mealSnapshot) !== naturalKey(row.mealSnapshot) ||
          previous.provenance !== row.provenance)
      )
        throw new Error("修訂不可改接班級、日期、餐期或資料身分");
      if (
        previous &&
        Date.parse(row.recordedAt) < Date.parse(previous.recordedAt)
      )
        throw new Error("修訂時間不可早於上一版");
    });
  }
  return rows;
}

export function validateMealSafetyHistory(
  observations: readonly unknown[],
  meals: readonly MealRecord[],
): void {
  const indexed = indexMeals(meals);
  for (const row of checkedHistory(observations)) {
    const parents = indexed.byId.get(row.mealRecordId) ?? [];
    if (parents.length !== 1)
      throw new Error("安全觀察找不到唯一餐期，歷史未變更");
    const parent = parents[0];
    if (naturalKey(parent) !== naturalKey(row.mealSnapshot))
      throw new Error("安全觀察的班級、日期或餐期與原餐期不一致");
    if (parent.source === "demo" && row.provenance === "school-record")
      throw new Error("示範與正式校園安全觀察不可混接");
    // Actual attendance/menu can be corrected later. Historical snapshots remain
    // valid audit evidence; only a current matching revision enters comparison.
  }
}

export function latestMealSafetyObservations(
  all: readonly MealSafetyObservation[],
): MealSafetyObservation[] {
  const latest = new Map<string, MealSafetyObservation>();
  for (const row of checkedHistory(all)) {
    const previous = latest.get(row.mealRecordId);
    if (!previous || row.revision > previous.revision)
      latest.set(row.mealRecordId, row);
  }
  return [...latest.values()];
}

/** A retained history may no longer be suitable for current comparison. */
export function mealSafetyParentIssue(
  observation: MealSafetyObservation,
  meals: readonly MealRecord[],
): string | undefined {
  return parentIssue(observation, indexMeals(meals));
}

function parentIssue(
  observation: MealSafetyObservation,
  indexed: ReturnType<typeof indexMeals>,
): string | undefined {
  const parents = indexed.byId.get(observation.mealRecordId) ?? [];
  if (parents.length !== 1) return "找不到唯一原餐期，已排除本餐安全觀察";
  const parent = parents[0];
  if (indexed.naturalCounts.get(naturalKey(parent)) !== 1)
    return "同班、同日、同餐期有重複餐期，全部相關觀察暫不比較；請先由人釐清";
  if (naturalKey(parent) !== naturalKey(observation.mealSnapshot))
    return "觀察與餐期的班級或日期不一致，已排除";
  if (parent.source === "demo" && observation.provenance === "school-record")
    return "觀察與餐期的示範／正式身分不一致，已排除";
  if (
    parent.actualPeople !== observation.mealSnapshot.actualPeople ||
    parent.menuSignature !== observation.mealSnapshot.menuSignature
  )
    return "餐期人數或菜單已變更，舊觀察保留但暫不比較；需新增修訂重新確認";
}

export function appendMealSafetyObservation(
  existing: readonly MealSafetyObservation[],
  input: MealSafetyObservation,
  meals: readonly MealRecord[],
  mode: DataMode,
): MealSafetyObservation[] {
  validateMealSafetyHistory(existing, meals);
  const candidate = mealSafetyObservationSchema.parse(input);
  const modeProvenance = mode === "demo-local" ? "demo" : "school-record";
  if (
    candidate.provenance !== modeProvenance ||
    existing.some((row) => row.provenance !== modeProvenance)
  )
    throw new Error("安全觀察不屬於目前資料模式");
  const repeated = existing.find((row) => row.id === candidate.id);
  if (repeated) {
    if (stableJson(repeated) !== stableJson(candidate))
      throw new Error("同一觀察編號內容不同，不可覆寫歷史");
    return structuredClone([...existing]);
  }
  const issue = mealSafetyParentIssue(candidate, meals);
  if (issue) throw new Error(issue);
  const latest = latestMealSafetyObservations(existing).find(
    (row) => row.mealRecordId === candidate.mealRecordId,
  );
  if (
    candidate.revision !== (latest?.revision ?? 0) + 1 ||
    candidate.previousObservationId !== (latest?.id ?? null)
  )
    throw new Error("已有較新安全觀察，請重新讀取後再修訂");
  const result = [...existing, candidate];
  validateMealSafetyHistory(result, meals);
  return structuredClone(result);
}

function fraction(numerator: number, denominator: number | null) {
  return denominator !== null && denominator > 0
    ? numerator / denominator
    : null;
}
function dateCount(rows: readonly MealSafetyObservation[]) {
  return new Set(rows.map((row) => row.mealSnapshot.servedOn)).size;
}

export function compareMealSafetyForExperiment(
  snapshot: {
    meals: MealRecord[];
    mealSafetyObservations: MealSafetyObservation[];
  },
  experiment: ImprovementExperiment,
  mode?: DataMode,
) {
  const periods = selectExperimentMeals(snapshot, experiment);
  const indexed = indexMeals(snapshot.meals);
  let latest: MealSafetyObservation[] = [];
  let historyIssue: string | undefined;
  try {
    latest = latestMealSafetyObservations(snapshot.mealSafetyObservations);
  } catch {
    historyIssue = "安全觀察修訂鏈無法驗證，本次暫不計算；請檢查原始資料";
  }
  const period = (meals: MealRecord[], start: string, end: string) => {
    const ids = new Set(meals.map((meal) => meal.id));
    const duplicates = meals.filter(
      (meal) => (indexed.naturalCounts.get(naturalKey(meal)) ?? 0) > 1,
    );
    const relevant = latest.filter(
      (row) =>
        ids.has(row.mealRecordId) ||
        (!indexed.byId.has(row.mealRecordId) &&
          (!experiment.classId ||
            row.mealSnapshot.classId === experiment.classId) &&
          row.mealSnapshot.servedOn >= start &&
          row.mealSnapshot.servedOn <= end),
    );
    const relevantIds = new Set(relevant.map((row) => row.mealRecordId));
    const rejected = relevant
      .map((row) => ({
        row,
        issue:
          mode &&
          row.provenance !== (mode === "demo-local" ? "demo" : "school-record")
            ? "安全觀察不屬於目前資料模式，已排除"
            : parentIssue(row, indexed),
      }))
      .filter((item) => item.issue);
    const rejectedIds = new Set(rejected.map((item) => item.row.id));
    const valid = relevant.filter((row) => !rejectedIds.has(row.id));
    const issues = [
      ...new Set([
        ...(historyIssue ? [historyIssue] : []),
        ...rejected.map((item) => item.issue!),
        ...(duplicates.length
          ? ["同班同日同餐期重複，相關安全觀察均排除；涵蓋率總分母無法確認"]
          : []),
      ]),
    ];
    const eligibleDinerMeals = duplicates.length
      ? null
      : meals.reduce((sum, meal) => sum + meal.actualPeople, 0);
    const event = (key: "shortage" | "refill") => {
      const recorded = valid.filter((row) => row[key].status === "recorded");
      const eventCount = recorded.reduce(
        (sum, row) => sum + row[key].eventCount!,
        0,
      );
      const observedDinerMeals = recorded.reduce(
        (sum, row) => sum + row[key].observedDiners!,
        0,
      );
      return {
        eventCount: recorded.length ? eventCount : null,
        observedDinerMeals,
        observedMeals: recorded.length,
        observedDates: dateCount(recorded),
        uncollectedMeals: valid.length - recorded.length,
        per100DinerMeals:
          observedDinerMeals > 0
            ? (eventCount / observedDinerMeals) * 100
            : null,
        mealCoverage: fraction(recorded.length, meals.length),
        dinerCoverage: fraction(observedDinerMeals, eligibleDinerMeals),
      };
    };
    const surveyed = valid.filter(
      (row) => row.satisfaction.status === "collected",
    );
    const responding = surveyed.filter((row) =>
      row.satisfaction.ratings!.some((votes) => votes > 0),
    );
    const ratings = [0, 0, 0, 0, 0].map((_, index) =>
      surveyed.reduce((sum, row) => sum + row.satisfaction.ratings![index], 0),
    ) as [number, number, number, number, number];
    const responseCount = ratings.reduce((sum, votes) => sum + votes, 0);
    const invitedDinerMeals = surveyed.reduce(
      (sum, row) => sum + row.satisfaction.invitedDiners!,
      0,
    );
    const menus = new Map<
      string,
      { signature: string; mealCount: number; dinerMeals: number }
    >();
    for (const meal of meals) {
      const entry = menus.get(meal.menuSignature) ?? {
        signature: meal.menuSignature,
        mealCount: 0,
        dinerMeals: 0,
      };
      entry.mealCount += 1;
      entry.dinerMeals += meal.actualPeople;
      menus.set(meal.menuSignature, entry);
    }
    return {
      eligibleMeals: meals.length,
      eligibleDates: new Set(meals.map((meal) => meal.servedOn)).size,
      eligibleDinerMeals,
      missingMeals: meals.filter((meal) => !relevantIds.has(meal.id)).length,
      excludedMeals: new Set([
        ...rejected.map((item) => item.row.mealRecordId),
        ...duplicates.map((meal) => meal.id),
      ]).size,
      issues,
      observations: valid,
      shortage: event("shortage"),
      refill: event("refill"),
      satisfaction: {
        ratings,
        responseCount,
        invitedDinerMeals,
        mean:
          responseCount > 0
            ? ratings.reduce(
                (sum, votes, index) => sum + votes * (index + 1),
                0,
              ) / responseCount
            : null,
        collectedMeals: surveyed.length,
        collectedDates: dateCount(surveyed),
        respondingMeals: responding.length,
        respondingDates: dateCount(responding),
        zeroResponseMeals: surveyed.filter((row) =>
          row.satisfaction.ratings!.every((votes) => votes === 0),
        ).length,
        uncollectedMeals: valid.length - surveyed.length,
        mealCoverage: fraction(surveyed.length, meals.length),
        dinerCoverage: fraction(invitedDinerMeals, eligibleDinerMeals),
        responseRate: fraction(responseCount, invitedDinerMeals),
      },
      menuComposition: [...menus.values()],
    };
  };
  const before = period(
    periods.baseline,
    experiment.baselineStart,
    experiment.baselineEnd,
  );
  const after = period(
    periods.after,
    experiment.interventionStart,
    experiment.interventionEnd,
  );
  const validDates = [
    experiment.baselineStart,
    experiment.baselineEnd,
    experiment.interventionStart,
    experiment.interventionEnd,
  ].every((date) => {
    try {
      epochDay(date);
      return true;
    } catch {
      return false;
    }
  });
  const invalidPeriod =
    !validDates ||
    experiment.baselineStart > experiment.baselineEnd ||
    experiment.interventionStart > experiment.interventionEnd ||
    experiment.baselineEnd >= experiment.interventionStart;
  const mixedSources =
    new Set(
      [...before.observations, ...after.observations].map(
        (row) => row.provenance,
      ),
    ).size > 1;
  const comparisonBlocked =
    mixedSources ||
    invalidPeriod ||
    before.excludedMeals > 0 ||
    after.excludedMeals > 0 ||
    Boolean(historyIssue);
  const difference = (left: number | null, right: number | null) =>
    comparisonBlocked || left === null || right === null ? null : right - left;
  const menuKeys = new Set(
    [...before.menuComposition, ...after.menuComposition].map(
      (row) => row.signature,
    ),
  );
  const beforeMenus = new Map(
    before.menuComposition.map((row) => [row.signature, row.dinerMeals]),
  );
  const afterMenus = new Map(
    after.menuComposition.map((row) => [row.signature, row.dinerMeals]),
  );
  const menuComparisonIncomplete =
    !before.eligibleDinerMeals || !after.eligibleDinerMeals;
  const menuMixDiffers = [...menuKeys].some(
    (signature) =>
      fraction(beforeMenus.get(signature) ?? 0, before.eligibleDinerMeals) !==
      fraction(afterMenus.get(signature) ?? 0, after.eligibleDinerMeals),
  );
  return {
    before,
    after,
    comparisonBlocked,
    issues: [
      ...new Set([
        ...before.issues,
        ...after.issues,
        ...(invalidPeriod ? ["實驗期別無效或重疊，不能計算前後差異"] : []),
        ...(mixedSources
          ? ["前後期含不同示範／校園資料身分，不能合併比較"]
          : []),
      ]),
    ],
    differences: {
      shortagePer100: difference(
        before.shortage.per100DinerMeals,
        after.shortage.per100DinerMeals,
      ),
      refillPer100: difference(
        before.refill.per100DinerMeals,
        after.refill.per100DinerMeals,
      ),
      satisfaction: difference(
        before.satisfaction.mean,
        after.satisfaction.mean,
      ),
    },
    menuMixDiffers,
    menuComparisonIncomplete,
    sharedMenuSignatures: before.menuComposition
      .filter((row) => afterMenus.has(row.signature))
      .map((row) => row.signature),
  };
}

export type MealSafetyComparison = ReturnType<
  typeof compareMealSafetyForExperiment
>;
