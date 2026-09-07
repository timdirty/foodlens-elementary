import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoSnapshot, DEMO_SEED_VERSION } from "@/lib/seed";
import { createUuid } from "@/lib/crypto";
import {
  parseFoodLensBackup,
  serializeFoodLensBackup,
} from "@/lib/data-portability";
import {
  createEmptyMealSafetyObservation,
  mealSafetyParentIssue,
  type MealSafetyObservation,
} from "@/lib/meal-safety";
import {
  DemoLocalRepository,
  closeDemoLocalDatabaseConnection,
} from "@/lib/repositories/demo-local";
import { MemoryFoodLensRepository } from "@/lib/repositories/memory";
import { scopeSnapshot } from "@/lib/analysis";
import type { FoodLensRepository } from "@/lib/types";

afterEach(() => closeDemoLocalDatabaseConnection());

function fixture() {
  const snapshot = createDemoSnapshot();
  snapshot.mealSafetyObservations = [];
  const meal = snapshot.meals[0];
  // No plate locking: exercise the independent safety-observation parent guard.
  snapshot.scans = [];
  snapshot.detections = [];
  snapshot.corrections = [];
  const observation = createEmptyMealSafetyObservation(meal, "demo");
  return { snapshot, meal, observation };
}

function revise(previous: MealSafetyObservation): MealSafetyObservation {
  return {
    ...structuredClone(previous),
    id: createUuid(),
    revision: previous.revision + 1,
    previousObservationId: previous.id,
    revisionReason: "核對原始班級匿名紀錄",
    recordedAt: new Date(Date.parse(previous.recordedAt) + 1_000).toISOString(),
    sourceTitle: "測試用匿名彙整表",
    sourceReference: "TEST-001 / 第 1 頁",
    shortage: {
      status: "recorded",
      eventCount: 0,
      observedDiners: previous.mealSnapshot.actualPeople,
    },
    satisfaction: {
      status: "collected",
      invitedDiners: previous.mealSnapshot.actualPeople,
      ratings: [0, 0, 0, 0, 0],
    },
  };
}

for (const [name, factory] of [
  ["IndexedDB", () => new DemoLocalRepository()],
  ["memory fallback", () => new MemoryFoodLensRepository()],
] as const) {
  describe(`${name} meal safety persistence`, () => {
    let repository: FoodLensRepository;
    beforeEach(async () => {
      repository = factory();
      await repository.replaceSnapshot(fixture().snapshot);
    });

    it("persists unknown separately from recorded zero and retains immutable prior revisions", async () => {
      const { observation } = fixture();
      await repository.saveMealSafetyObservation(observation);
      const next = revise(observation);
      await repository.saveMealSafetyObservation(next);
      next.shortage.eventCount = 99;
      const rows = (await repository.getSnapshot()).mealSafetyObservations;
      expect(rows).toHaveLength(2);
      expect(rows[0].shortage.eventCount).toBeNull();
      expect(rows[1].shortage.eventCount).toBe(0);
      expect(rows[1].satisfaction.ratings).toEqual([0, 0, 0, 0, 0]);
    });

    it("accepts exact retries, rejects content mutation and competing stale revisions", async () => {
      const { observation } = fixture();
      await repository.saveMealSafetyObservation(observation);
      await repository.saveMealSafetyObservation(structuredClone(observation));
      await expect(
        repository.saveMealSafetyObservation({
          ...observation,
          sourceTitle: "changed",
        }),
      ).rejects.toThrow();
      const left = revise(observation);
      const right = revise(observation);
      const outcomes = await Promise.allSettled([
        repository.saveMealSafetyObservation(left),
        repository.saveMealSafetyObservation(right),
      ]);
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (await repository.getSnapshot()).mealSafetyObservations,
      ).toHaveLength(2);
    });

    it("rejects missing parents, duplicate natural meal keys and cloud provenance without writing", async () => {
      const { observation, snapshot, meal } = fixture();
      await expect(
        repository.saveMealSafetyObservation({
          ...observation,
          mealRecordId: "missing",
        }),
      ).rejects.toThrow();
      await expect(
        repository.saveMealSafetyObservation({
          ...observation,
          provenance: "school-record",
        }),
      ).rejects.toThrow();
      snapshot.meals.push({ ...meal, id: "duplicate-meal" });
      await repository.replaceSnapshot(snapshot);
      await expect(
        repository.saveMealSafetyObservation(observation),
      ).rejects.toThrow(/重複/);
      expect(
        (await repository.getSnapshot()).mealSafetyObservations,
      ).toHaveLength(0);
    });

    it("preserves safety meal identity through CSV import and rejects invalid backup atomically", async () => {
      const { observation, meal } = fixture();
      await repository.saveMealSafetyObservation(observation);
      await expect(
        repository.importMealRecords([{ ...meal, servedOn: "2026-11-02" }]),
      ).rejects.toThrow(/安全觀察/);
      const invalid = await repository.getSnapshot();
      invalid.mealSafetyObservations[0].previousObservationId = createUuid();
      await expect(repository.replaceSnapshot(invalid)).rejects.toThrow();
      expect(
        (await repository.getSnapshot()).mealSafetyObservations[0],
      ).toEqual(observation);
    });

    it("allows local manual meal observations and flags changed attendance until a new sourced revision", async () => {
      const { snapshot, meal } = fixture();
      meal.source = "manual";
      await repository.replaceSnapshot(snapshot);
      const observation = createEmptyMealSafetyObservation(meal, "demo");
      await repository.saveMealSafetyObservation(observation);
      const changed = { ...meal, actualPeople: meal.actualPeople - 1 };
      await repository.importMealRecords([changed]);
      const current = await repository.getSnapshot();
      expect(mealSafetyParentIssue(observation, current.meals)).toMatch(
        /人數或菜單已變更/,
      );
      const next = revise(observation);
      next.mealSnapshot.actualPeople = changed.actualPeople;
      next.shortage.observedDiners = changed.actualPeople;
      next.satisfaction.invitedDiners = changed.actualPeople;
      await repository.saveMealSafetyObservation(next);
      const saved = await repository.getSnapshot();
      expect(
        mealSafetyParentIssue(saved.mealSafetyObservations[1], saved.meals),
      ).toBeUndefined();
      expect(saved.mealSafetyObservations[0].mealSnapshot.actualPeople).toBe(
        meal.actualPeople,
      );
    });
  });
}

describe("safety backup, reload and seed upgrade", () => {
  it("v4 JSON backup and reopening IndexedDB retain every revision and zero-response state", async () => {
    const repository = new DemoLocalRepository();
    const { snapshot, observation } = fixture();
    await repository.replaceSnapshot(snapshot);
    await repository.saveMealSafetyObservation(observation);
    await repository.saveMealSafetyObservation(revise(observation));
    const before = await repository.getSnapshot();
    const text = await serializeFoodLensBackup(before);
    expect(JSON.parse(text).version).toBe(4);
    await repository.replaceSnapshot(await parseFoodLensBackup(text));
    closeDemoLocalDatabaseConnection();
    const restored = await new DemoLocalRepository().getSnapshot();
    expect(restored.mealSafetyObservations).toEqual(
      before.mealSafetyObservations,
    );
  });

  it("v3 backup and pre-v19 local upgrade never create observations from old averages", async () => {
    const old = JSON.parse(await serializeFoodLensBackup(createDemoSnapshot()));
    old.version = 3;
    delete old.snapshot.mealSafetyObservations;
    const parsed = await parseFoodLensBackup(JSON.stringify(old));
    expect(parsed.mealSafetyObservations).toEqual([]);
    expect(parsed.experiments[0].safetyGuardrails?.satisfactionScore).toBe(4.1);
    const repository = new DemoLocalRepository();
    await repository.replaceSnapshot(parsed);
    closeDemoLocalDatabaseConnection();
    const database = new Dexie("foodlens-demo");
    await database.open();
    await database
      .table("state")
      .update("snapshot", { version: DEMO_SEED_VERSION - 1 });
    database.close();
    const upgraded = await repository.getSnapshot();
    expect(upgraded.mealSafetyObservations).toEqual([]);
    await repository.resetDemo();
    const reset = await repository.getSnapshot();
    expect(reset.mealSafetyObservations).toHaveLength(48);
    expect(
      reset.mealSafetyObservations.every((row) => row.provenance === "demo"),
    ).toBe(true);
  });

  it("Demo seed is deterministic, explicitly synthetic, and scoped histories match meal scope", () => {
    const first = createDemoSnapshot();
    expect(first.mealSafetyObservations).toEqual(
      createDemoSnapshot().mealSafetyObservations,
    );
    expect(
      first.mealSafetyObservations.every((row) =>
        row.sourceTitle.includes("非實測"),
      ),
    ).toBe(true);
    const scoped = scopeSnapshot(first, {
      classId: "class-5a",
      range: "month",
    });
    const ids = new Set(scoped.meals.map((meal) => meal.id));
    expect(scoped.mealSafetyObservations.length).toBeGreaterThan(0);
    expect(
      scoped.mealSafetyObservations.every((row) => ids.has(row.mealRecordId)),
    ).toBe(true);
  });
});
