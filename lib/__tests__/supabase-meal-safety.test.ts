import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmptyMealSafetyObservation } from "@/lib/meal-safety";
import type { MealRecord } from "@/lib/types";
import {
  mealSafetyObservationsFromRows,
  SupabaseRepository,
} from "@/lib/repositories/supabase";

const schoolId = "aaaaaaaa-0000-4000-8000-000000000001";
const meal: MealRecord = {
  id: "aaaaaaaa-3000-4000-8000-000000000001",
  classId: "aaaaaaaa-1111-4111-8111-111111111111",
  servedOn: "2026-09-01",
  mealPeriod: "lunch",
  menuSignature: "rice|tofu",
  actualPeople: 20,
  plannedPeople: 20,
  staple: "白飯",
  mainDish: "豆腐",
  sideDishes: [],
  totalSupplyG: 10000,
  leftoverG: 2000,
  measurementMethod: "scale",
  notes: "",
  source: "manual",
  createdAt: "2026-09-01T04:00:00Z",
  updatedAt: "2026-09-01T04:00:00Z",
};
function observation() {
  return createEmptyMealSafetyObservation(
    meal,
    "school-record",
    "aaaaaaaa-1000-4000-8000-000000000001",
    "2026-09-01T04:00:00Z",
  );
}
function row(value = observation()) {
  return {
    id: value.id,
    school_id: schoolId,
    meal_record_id: value.mealRecordId,
    revision: value.revision,
    previous_observation_id: value.previousObservationId,
    observation: value,
  };
}
function clientMock(
  gate: { data: unknown; error: unknown } = { data: 1, error: null },
  rows: unknown[] = [],
) {
  const membership = {
    select: () => membership,
    eq: () => membership,
    order: () => membership,
    limit: async () => ({
      data: [{ school_id: schoolId, role: "teacher" }],
      error: null,
    }),
  };
  const from = vi.fn((table: string) => {
    if (table === "memberships") return membership;
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: async () => ({
        data:
          table === "meal_safety_observations"
            ? rows
            : table === "meal_records"
              ? [
                  {
                    id: meal.id,
                    class_id: meal.classId,
                    served_on: meal.servedOn,
                    meal_period: meal.mealPeriod,
                    menu_signature: meal.menuSignature,
                    actual_people: meal.actualPeople,
                    source: meal.source,
                  },
                ]
              : [],
        error: null,
      }),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string, _args?: unknown) => {
    void _args;
    if (name === "foodlens_feedback_contract_version")
      return { data: 2, error: null };
    if (name === "foodlens_meal_safety_contract_version") return gate;
    return { data: null, error: null };
  });
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "teacher" } }, error: null }),
    },
    from,
    rpc,
    storage: { from: () => ({ createSignedUrls: vi.fn() }) },
  } as unknown as SupabaseClient;
  return { client, from, rpc };
}

describe("Supabase per-meal safety", () => {
  it.each([
    { data: null, error: { message: "missing RPC" } },
    { data: 0, error: null },
    { data: 2, error: null },
  ])(
    "missing or wrong readiness blocks both read and write before formal tables",
    async (gate) => {
      const mock = clientMock(gate);
      const repository = new SupabaseRepository(mock.client);
      await expect(repository.getSnapshot()).rejects.toThrow("逐餐安全觀察 v1");
      await expect(
        repository.saveMealSafetyObservation(observation()),
      ).rejects.toThrow("逐餐安全觀察 v1");
      expect(mock.from.mock.calls).toEqual([["memberships"]]);
      expect(
        mock.rpc.mock.calls.some(
          ([name]) => name === "save_meal_safety_observation",
        ),
      ).toBe(false);
    },
  );
  it("snapshot hydrates explicit nulls and empty history without manufacturing summaries", async () => {
    const mock = clientMock(undefined, [row()]);
    const result = await new SupabaseRepository(mock.client).getSnapshot();
    expect(result.mealSafetyObservations).toEqual([observation()]);
    expect(result.mealSafetyObservations[0].satisfaction.ratings).toBeNull();
    expect(
      (await new SupabaseRepository(clientMock().client).getSnapshot())
        .mealSafetyObservations,
    ).toEqual([]);
  });
  it("saves exact versioned payload through the atomic RPC only", async () => {
    const mock = clientMock();
    const value = observation();
    await new SupabaseRepository(mock.client).saveMealSafetyObservation(value);
    expect(mock.rpc).toHaveBeenLastCalledWith("save_meal_safety_observation", {
      p_school_id: schoolId,
      p_observation: value,
    });
    expect(mock.from.mock.calls).toEqual([["memberships"]]);
  });
  it("fails closed on torn revision chains during snapshot hydration", async () => {
    const value = {
      ...observation(),
      id: "aaaaaaaa-1000-4000-8000-000000000002",
      revision: 2,
      previousObservationId: observation().id,
      revisionReason: "補記觀察資料",
    };
    const mock = clientMock(undefined, [row(value)]);
    await expect(
      new SupabaseRepository(mock.client).getSnapshot(),
    ).rejects.toThrow("修訂鏈不連續");
  });
  it("does not relabel a demo observation as school data", async () => {
    const mock = clientMock();
    await expect(
      new SupabaseRepository(mock.client).saveMealSafetyObservation({
        ...observation(),
        provenance: "demo",
      }),
    ).rejects.toThrow("正式逐餐安全觀察");
    expect(
      mock.rpc.mock.calls.some(
        ([name]) => name === "save_meal_safety_observation",
      ),
    ).toBe(false);
  });
  it("malformed unknown values fail before writing", async () => {
    const mock = clientMock();
    const value = observation();
    value.shortage.eventCount = 0;
    await expect(
      new SupabaseRepository(mock.client).saveMealSafetyObservation(value),
    ).rejects.toThrow();
    expect(
      mock.rpc.mock.calls.some(
        ([name]) => name === "save_meal_safety_observation",
      ),
    ).toBe(false);
  });
  it.each([
    ["40001", "meal safety revision conflict", "重新讀取最新資料"],
    [
      "23505",
      "ambiguous class/date/meal period; resolve duplicate meals first",
      "釐清重複餐期",
    ],
    [
      "23505",
      "same meal safety id has different payload",
      "編號已保存不同內容",
    ],
    ["23505", "unique constraint violation", "修訂編號重複"],
    ["42501", "meal safety requires same-school staff", "確認教師或管理員身分"],
    [
      "22023",
      "meal safety snapshot is stale or mismatched",
      "核對人數、菜單、來源及數值",
    ],
    ["55000", "meal safety observations are append-only", "新增修訂並說明原因"],
    ["PGRST999", "unexpected backend failure", "安全觀察保存未完成"],
    ["", "network unavailable", "安全觀察保存未完成"],
  ])(
    "RPC %s becomes an actionable Error without exposing database content",
    async (code, sourceMessage, expected) => {
      const mock = clientMock();
      mock.rpc.mockImplementation(async (name) =>
        name === "save_meal_safety_observation"
          ? {
              data: null,
              error: {
                code,
                message: `${sourceMessage}; private source A001`,
                details: "sensitive context",
              },
            }
          : { data: 1, error: null },
      );
      const error = await new SupabaseRepository(mock.client)
        .saveMealSafetyObservation(observation())
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain("private source");
      expect((error as Error).cause).toEqual({ code: code || null });
      expect(mock.from.mock.calls).toEqual([["memberships"]]);
      expect(
        mock.rpc.mock.calls.filter(
          ([name]) => name === "save_meal_safety_observation",
        ),
      ).toHaveLength(1);
    },
  );
  it("a rejected RPC promise is also a safe actionable Error", async () => {
    const mock = clientMock();
    mock.rpc.mockImplementation(async (name) => {
      if (name === "save_meal_safety_observation")
        throw new TypeError("Failed to fetch private endpoint");
      return { data: 1, error: null };
    });
    await expect(
      new SupabaseRepository(mock.client).saveMealSafetyObservation(
        observation(),
      ),
    ).rejects.toThrow("安全觀察保存未完成");
  });
  it("preserves recorded zero and a zero-response distribution", () => {
    const value = observation();
    value.sourceTitle = "單餐量測表";
    value.sourceReference = "匿名表 A001";
    value.shortage = { status: "recorded", eventCount: 0, observedDiners: 20 };
    value.satisfaction = {
      status: "collected",
      invitedDiners: 20,
      ratings: [0, 0, 0, 0, 0],
    };
    expect(mealSafetyObservationsFromRows([row(value)])).toEqual([value]);
  });
  it.each(["id", "meal_record_id", "revision", "previous_observation_id"])(
    "rejects corrupted %s projection",
    (key) => {
      expect(() =>
        mealSafetyObservationsFromRows([{ ...row(), [key]: "different" }]),
      ).toThrow("索引與原始資料不一致");
    },
  );
  it("does not silently hydrate legacy or demo JSON", () => {
    expect(() =>
      mealSafetyObservationsFromRows([{ ...row(), observation: {} }]),
    ).toThrow("不會推定為零");
    expect(() =>
      mealSafetyObservationsFromRows([
        row({ ...observation(), provenance: "demo" }),
      ]),
    ).toThrow("不會推定為零");
  });
});
