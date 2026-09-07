import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { MockFoodAnalysisProvider } from "@/lib/ai";
import { createPredictionDecisionTrace } from "@/lib/experiment-decision";
import {
  createPrediction,
  JUDGE_DEMO_PREDICTION_INPUT,
} from "@/lib/prediction";
import {
  closeDemoLocalDatabaseConnection,
  DemoLocalRepository,
} from "@/lib/repositories/demo-local";
import { MemoryFoodLensRepository } from "@/lib/repositories/memory";
import {
  plateScanMenuContext,
  resolveConfirmedPlateMenuContext,
} from "@/lib/scan-workflow";
import { createDemoSnapshot, DEMO_SEED_VERSION } from "@/lib/seed";
import {
  derivePlateScanAnalysisKind,
  persistedPlateScanAnalysisKind,
} from "@/lib/types";
import type {
  AiAnalysisV1,
  AppSnapshot,
  ConfirmScanCommand,
} from "@/lib/types";

async function createMockAnalysis(fingerprint: string): Promise<AiAnalysisV1> {
  return new MockFoodAnalysisProvider({ simulatedLatencyMs: 0 }).analyze({
    fingerprint,
  });
}

afterEach(() => {
  closeDemoLocalDatabaseConnection();
});

function normalizeRepositorySnapshot(snapshot: AppSnapshot) {
  const normalized = structuredClone(snapshot);
  normalized.meals.forEach((meal) => {
    meal.createdAt = "<write-time>";
    meal.updatedAt = "<write-time>";
  });
  normalized.scans.forEach((scan) => {
    scan.reviewedAt = "<write-time>";
    scan.createdAt = "<write-time>";
  });
  normalized.corrections.forEach((correction) => {
    correction.correctedAt = "<write-time>";
  });
  return normalized;
}

function existingMealCommand(snapshot: AppSnapshot): ConfirmScanCommand {
  const meal = snapshot.meals[0];
  const detection = {
    category: "rice" as const,
    label: "白飯",
    originalG: 120,
    remainingRatio: 0.25,
    remainingG: 30,
    confidence: 0.9,
  };
  const analysis: AiAnalysisV1 = {
    schemaVersion: "1",
    provider: "repository-contract-test",
    model: "deterministic-contract-v1",
    isMock: true,
    detections: [detection],
    warnings: [],
    analyzedAt: "2026-10-26T12:00:00+08:00",
  };
  return {
    clientRequestId: "77777777-7777-4777-8777-777777777777",
    meal: {
      id: meal.id,
      classId: meal.classId,
      servedOn: meal.servedOn,
      mealPeriod: meal.mealPeriod,
      staple: meal.staple,
      mainDish: meal.mainDish,
      sideDishes: meal.sideDishes,
      plannedPeople: meal.plannedPeople,
      actualPeople: meal.actualPeople,
      totalSupplyG: meal.totalSupplyG,
      leftoverG: meal.leftoverG,
      measurementMethod: meal.measurementMethod,
      notes: meal.notes,
      source: meal.source,
    },
    imageUrl: "/demo/plate-curry.png",
    analysis,
    corrections: [
      {
        ...detection,
        remainingRatio: 0.4,
        remainingG: 48,
      },
    ],
  };
}

describe("plate scan source identity", () => {
  it("uses structured isMock instead of arbitrary provider wording", () => {
    expect(
      derivePlateScanAnalysisKind({
        provider: "convincing-real-provider-name",
        isMock: true,
      }),
    ).toBe("mock-ai");
    expect(
      derivePlateScanAnalysisKind({
        provider: "school-approved-provider",
        isMock: false,
      }),
    ).toBe("real-ai");
    expect(
      derivePlateScanAnalysisKind({ provider: "human-manual", isMock: false }),
    ).toBe("human-manual");
  });

  it("rejects contradictory reserved providers", () => {
    expect(() =>
      derivePlateScanAnalysisKind({ provider: "foodlens-mock", isMock: false }),
    ).toThrow("必須標示為 Mock AI");
    expect(() =>
      derivePlateScanAnalysisKind({ provider: "human-manual", isMock: true }),
    ).toThrow("不可同時標示為 Mock AI");
  });

  it("maps missing or invalid cloud provenance to source-unverified", () => {
    expect(persistedPlateScanAnalysisKind("real-ai")).toBe("real-ai");
    expect(persistedPlateScanAnalysisKind("school-approved-provider")).toBe(
      "source-unverified",
    );
    expect(persistedPlateScanAnalysisKind(undefined)).toBe("source-unverified");
  });
});

describe("DemoLocalRepository", () => {
  const repository = new DemoLocalRepository();
  beforeEach(async () => {
    await repository.resetDemo();
  });
  it("固定 Demo seed 包含三筆可追溯餐期證據鏈", () => {
    const snapshot = createDemoSnapshot();

    expect(snapshot.evidenceCases).toHaveLength(3);
    expect(
      snapshot.evidenceCases.map((evidenceCase) => evidenceCase.id),
    ).toEqual(["demo-evidence-1", "demo-evidence-2", "demo-evidence-3"]);
    expect(
      snapshot.evidenceCases.every(
        (evidenceCase) =>
          evidenceCase.sourceKind === "demo" &&
          evidenceCase.classId === "class-5a" &&
          evidenceCase.menuVersion.status === "confirmed",
      ),
    ).toBe(true);
  });
  it("固定 Demo 研究敘事與目前雙循環產品一致", () => {
    const snapshot = createDemoSnapshot();
    const research = snapshot.researchSections
      .map((section) => `${section.title}\n${section.bodyMarkdown}`)
      .join("\n");

    expect(research).toContain("紙本菜單 OCR");
    expect(research).toContain("五源量測");
    expect(research).toContain("八個角色");
    expect(research).toContain("處理端收據");
    expect(research).toContain("預定去向不算已驗證成果");
  });
  it("saveEvidenceCase 在重建 DemoLocalRepository 後仍持久化", async () => {
    const before = await repository.getSnapshot();
    const saved = {
      ...structuredClone(before.evidenceCases[0]),
      id: "evidence-repository-persistence",
    };

    const { mealRecordId } = await repository.saveEvidenceCase(saved);

    const reloaded = await new DemoLocalRepository().getSnapshot();
    expect(reloaded.evidenceCases).toHaveLength(4);
    expect(
      reloaded.evidenceCases.find(
        (evidenceCase) => evidenceCase.id === saved.id,
      ),
    ).toEqual({ ...saved, mealRecordId });
    expect(
      reloaded.meals.find((meal) => meal.id === mealRecordId),
    ).toMatchObject({
      classId: saved.classId,
      servedOn: saved.servedOn,
      measurementMethod: "sample-extrapolation",
    });
  });
  it("未確認時不會寫入任何資料", async () => {
    const before = await repository.getSnapshot();
    await createMockAnalysis("draft-only");
    const after = await repository.getSnapshot();
    expect(after.meals).toHaveLength(before.meals.length);
    expect(after.scans).toHaveLength(before.scans.length);
  });
  it("確認後保存 AI 原始值與獨立人工修正，班級秤重不取自單張餐盤", async () => {
    const analysis = await createMockAnalysis("plate-curry.png");
    const corrections = analysis.detections.map((item, index) =>
      index === 0
        ? {
            ...item,
            remainingRatio: 0.25,
            remainingG: Math.round(item.originalG * 0.25),
          }
        : { ...item },
    );
    await repository.confirmScan({
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      meal: {
        classId: "class-5a",
        servedOn: "2026-10-26",
        mealPeriod: "lunch",
        staple: "白飯",
        mainDish: "測試雞肉",
        sideDishes: ["青菜"],
        plannedPeople: 25,
        actualPeople: 25,
        totalSupplyG: 6500,
        leftoverG: 1300,
        measurementMethod: "scale",
        notes: "測試",
        source: "manual",
      },
      analysis,
      corrections,
      imageUrl: "/demo/plate-curry.png",
    });
    const state = await repository.getSnapshot();
    expect(state.meals).toHaveLength(49);
    expect(state.scans).toHaveLength(97);
    expect(state.meals.at(-1)?.leftoverG).toBe(1300);
    const newest = state.scans.at(-1);
    expect(newest?.analysisKind).toBe("mock-ai");
    const original = state.detections.find(
      (item) => item.scanId === newest?.id,
    );
    const correction = state.corrections.find(
      (item) => item.detectionId === original?.id,
    );
    expect(original?.aiRemainingRatio).toBe(0.34);
    expect(correction?.correctedRemainingRatio).toBe(0.25);
  });
  it("保存並重載掃描時實際提供的唯一已確認菜單候選脈絡", async () => {
    const initial = await repository.getSnapshot();
    const { mealRecordId } = await repository.saveEvidenceCase({
      ...initial.evidenceCases[0],
      id: "evidence-menu-context-persist",
    });
    const linked = await repository.getSnapshot();
    const meal = linked.meals.find((item) => item.id === mealRecordId)!;
    const resolved = resolveConfirmedPlateMenuContext({
      evidenceCases: linked.evidenceCases,
      meal,
    });
    expect(resolved).toBeDefined();
    const menuContext = plateScanMenuContext(resolved);
    const command = existingMealCommand({
      ...linked,
      meals: [meal, ...linked.meals.filter((item) => item.id !== meal.id)],
    });
    command.clientRequestId = "33333333-3333-4333-8333-333333333334";
    command.menuContext = menuContext;

    const saved = await repository.confirmScan(command);
    const reloaded = await new DemoLocalRepository().getSnapshot();

    expect(
      reloaded.scans.find((scan) => scan.id === saved.scanId)?.menuContext,
    ).toEqual(menuContext);
  });
  it("拒絕把過時數量或未連結的菜單聲明保存成候選證據", async () => {
    const initial = await repository.getSnapshot();
    const { mealRecordId } = await repository.saveEvidenceCase({
      ...initial.evidenceCases[0],
      id: "evidence-menu-context-reject",
    });
    const linked = await repository.getSnapshot();
    const meal = linked.meals.find((item) => item.id === mealRecordId)!;
    const resolved = resolveConfirmedPlateMenuContext({
      evidenceCases: linked.evidenceCases,
      meal,
    })!;
    const command = existingMealCommand({
      ...linked,
      meals: [meal, ...linked.meals.filter((item) => item.id !== meal.id)],
    });
    command.clientRequestId = "33333333-3333-4333-8333-333333333335";
    command.menuContext = {
      ...plateScanMenuContext(resolved)!,
      candidateCount: resolved.candidates.length + 1,
    };

    await expect(repository.confirmScan(command)).rejects.toThrow(
      "找不到唯一且已確認的菜單候選脈絡",
    );

    const unrelated = existingMealCommand(initial);
    unrelated.clientRequestId = "33333333-3333-4333-8333-333333333336";
    unrelated.menuContext = plateScanMenuContext(resolved);
    await expect(repository.confirmScan(unrelated)).rejects.toThrow(
      "餐期菜單已變更",
    );
  });
  it("新餐期拒絕把 AI 估計冒充班級剩食量測", async () => {
    const analysis = await createMockAnalysis("invalid-meal-measurement");
    await expect(
      repository.confirmScan({
        clientRequestId: "44444444-4444-4444-8444-444444444444",
        meal: {
          classId: "class-5a",
          servedOn: "2026-10-26",
          mealPeriod: "lunch",
          staple: "白飯",
          mainDish: "測試主菜",
          sideDishes: ["青菜"],
          plannedPeople: 25,
          actualPeople: 25,
          totalSupplyG: 6500,
          leftoverG: 900,
          measurementMethod: "ai-estimate",
          notes: "不應保存",
          source: "manual",
        },
        analysis,
        corrections: analysis.detections.map((item) => ({ ...item })),
      }),
    ).rejects.toThrow("不能由單張餐盤推算");
    const state = await repository.getSnapshot();
    expect(state.meals).toHaveLength(48);
    expect(state.scans).toHaveLength(96);
  });
  it("相同送出識別碼重試不會重複建立餐期或掃描", async () => {
    const analysis = await createMockAnalysis("idempotent-plate");
    const command = {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      meal: {
        classId: "class-5a",
        servedOn: "2026-10-26",
        mealPeriod: "lunch" as const,
        staple: "白飯",
        mainDish: "重試測試雞肉",
        sideDishes: ["青菜"],
        plannedPeople: 25,
        actualPeople: 25,
        totalSupplyG: 6500,
        leftoverG: 1250,
        measurementMethod: "scale" as const,
        notes: "測試重複送出保護",
        source: "manual" as const,
      },
      analysis,
      corrections: analysis.detections.map((item) => ({ ...item })),
      imageUrl: "/demo/plate-curry.png",
    };

    const first = await repository.confirmScan(command);
    const retry = await repository.confirmScan(command);
    const state = await repository.getSnapshot();

    expect(retry).toEqual(first);
    expect(state.meals).toHaveLength(49);
    expect(state.scans).toHaveLength(97);
  });
  it("同一餐期可新增多份餐盤且不覆寫班級秤重", async () => {
    const before = await repository.getSnapshot();
    const existing = before.meals[0];
    const analysis = await createMockAnalysis("same-meal-extra-plate");

    await repository.confirmScan({
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      meal: {
        id: existing.id,
        classId: existing.classId,
        servedOn: existing.servedOn,
        mealPeriod: "lunch",
        staple: existing.staple,
        mainDish: existing.mainDish,
        sideDishes: existing.sideDishes,
        plannedPeople: existing.plannedPeople,
        actualPeople: existing.actualPeople,
        totalSupplyG: existing.totalSupplyG,
        leftoverG: existing.leftoverG,
        measurementMethod: "ai-estimate",
        notes: "同餐期追加樣本",
        source: "manual",
      },
      analysis,
      corrections: analysis.detections.map((item) => ({ ...item })),
    });
    const after = await repository.getSnapshot();

    expect(after.meals).toHaveLength(48);
    expect(after.scans).toHaveLength(97);
    expect(after.meals.find((meal) => meal.id === existing.id)?.leftoverG).toBe(
      existing.leftoverG,
    );
  });
  it("reset 只重建固定 Demo", async () => {
    await repository.resetDemo();
    const state = await repository.getSnapshot();
    expect(state.meals).toHaveLength(48);
    expect(state.scans).toHaveLength(96);
    expect(state.evidenceCases).toHaveLength(3);
  });
  it("釋放 IndexedDB 連線不會刪除或重設本機資料", async () => {
    const before = await repository.getSnapshot();
    const saved = {
      ...createPrediction(before, JUDGE_DEMO_PREDICTION_INPUT),
      id: "prediction-survives-connection-close",
    };
    await repository.savePrediction(saved);

    closeDemoLocalDatabaseConnection();

    const reopened = await new DemoLocalRepository().getSnapshot();
    expect(
      reopened.predictions.some((prediction) => prediction.id === saved.id),
    ).toBe(true);
  });
  it("保存的供餐建議與改善實驗連結在重新建立 repository 後仍可追溯", async () => {
    const before = await repository.getSnapshot();
    const prediction = createPrediction(before, JUDGE_DEMO_PREDICTION_INPUT);
    const experiment = {
      ...before.experiments[0],
      id: "experiment-linked-prediction-test",
      linkedPredictionId: prediction.id,
      decisionTrace: createPredictionDecisionTrace(prediction, {
        adoptionMode: "adjusted",
        adjustedSupplyG: Math.round(
          (prediction.plannedSupplyG + prediction.recommendedSupplyG) / 2,
        ),
        adoptionNote: "Repository 重載後仍須保留人類決策。",
        recordedAt: "2026-08-31T11:55:00.000Z",
      }),
      safetyGuardrails: {
        shortageReportCount: 0,
        refillRequestCount: 4,
        satisfactionScore: 4.4,
        satisfactionResponseCount: 27,
        dietitianReview: "confirmed" as const,
        dietitianNote: "Repository 重載後仍須保留供餐安全判讀。",
        confounders: ["測試期間有戶外活動"],
        checkedAt: "2026-10-16T07:30:00.000Z",
      },
      createdAt: "2026-08-31T12:00:00.000Z",
    };

    await repository.savePrediction(prediction);
    await repository.saveExperiment(experiment);

    const reloaded = await new DemoLocalRepository().getSnapshot();
    expect(
      reloaded.predictions.find((item) => item.id === prediction.id),
    ).toMatchObject({
      plannedSupplyG: prediction.plannedSupplyG,
      recommendedSupplyG: prediction.recommendedSupplyG,
    });
    expect(
      reloaded.experiments.find((item) => item.id === experiment.id),
    ).toMatchObject({
      linkedPredictionId: prediction.id,
      decisionTrace: {
        predictionId: prediction.id,
        plannedSupplyG: prediction.plannedSupplyG,
        recommendedSupplyG: prediction.recommendedSupplyG,
        adoptionMode: "adjusted",
      },
      safetyGuardrails: {
        shortageReportCount: 0,
        refillRequestCount: 4,
        satisfactionScore: 4.4,
        satisfactionResponseCount: 27,
        dietitianReview: "confirmed",
      },
    });
  });
  it("IndexedDB 快照損壞時保留復原副本並重建固定 Demo seed", async () => {
    const raw = new Dexie("foodlens-demo");
    raw.version(1).stores({ state: "id,version" });
    await raw.table("state").put({
      id: "snapshot",
      version: DEMO_SEED_VERSION,
      schemaVersion: 1,
      value: { ...createDemoSnapshot(), meals: "corrupt-meals" },
      customized: {
        profile: false,
        settings: false,
        researchSectionIds: [],
      },
    });
    raw.close();

    const reseeded = await repository.getSnapshot();
    expect(reseeded).toEqual(createDemoSnapshot());

    const audit = new Dexie("foodlens-demo");
    audit.version(1).stores({ state: "id,version" });
    const recovery = await audit.table("state").get("recovery");
    expect(recovery).toMatchObject({
      id: "recovery",
      version: DEMO_SEED_VERSION,
      schemaVersion: 1,
    });
    expect(recovery?.value.meals).toBe("corrupt-meals");
    expect(recovery?.recoveryCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    audit.close();
  });
  it("reset 後 restoreRecovery 會完整復原 IndexedDB 圖片 Blob", async () => {
    const customized = createDemoSnapshot();
    const imageBytes = new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69]);
    customized.scans[0] = {
      ...customized.scans[0],
      imageUrl: undefined,
      imageBlob: new Blob([imageBytes], { type: "image/webp" }),
    };
    await repository.replaceSnapshot(customized);

    await repository.resetDemo();
    const reset = await repository.getSnapshot();
    expect(reset.scans[0].imageBlob).toBeUndefined();
    expect(await repository.getRecoveryMetadata()).toMatchObject({
      mealCount: 48,
      scanCount: 96,
    });

    await expect(repository.restoreRecovery()).resolves.toBe(true);
    const restored = await repository.getSnapshot();
    const restoredBlob = restored.scans[0].imageBlob;
    expect(restoredBlob).toBeInstanceOf(Blob);
    expect(restoredBlob?.type).toBe("image/webp");
    expect(new Uint8Array(await restoredBlob!.arrayBuffer())).toEqual(
      imageBytes,
    );
  });
  it("seed 升級保留手動餐期，但會更新官方示範實驗期間", async () => {
    const legacy = createDemoSnapshot();
    legacy.meals.push({
      ...legacy.meals[0],
      id: "meal-preserved-across-seed-upgrade",
      source: "manual",
      mainDish: "學生新增測試主菜",
    });
    legacy.experiments[0] = {
      ...legacy.experiments[0],
      baselineStart: "2026-09-02",
      baselineEnd: "2026-09-04",
      interventionStart: "2026-10-21",
      interventionEnd: "2026-10-23",
    };
    const raw = new Dexie("foodlens-demo");
    raw.version(1).stores({ state: "id,version" });
    await raw.table("state").put({
      id: "snapshot",
      version: DEMO_SEED_VERSION - 1,
      schemaVersion: 1,
      value: legacy,
      customized: {
        profile: false,
        settings: false,
        researchSectionIds: [],
      },
    });
    raw.close();

    const migrated = await repository.getSnapshot();
    expect(
      migrated.meals.some(
        (meal) => meal.id === "meal-preserved-across-seed-upgrade",
      ),
    ).toBe(true);
    expect(migrated.experiments[0]).toMatchObject({
      baselineStart: "2026-08-24",
      baselineEnd: "2026-08-28",
      interventionStart: "2026-10-14",
      interventionEnd: "2026-10-16",
    });
  });

  it("seed 升級不會把未知舊 provider 猜成真實 AI", async () => {
    const legacy = createDemoSnapshot();
    const legacyScan = {
      ...legacy.scans[0],
      id: "scan-legacy-source-unverified",
      provider: "convincing-real-provider-name",
    };
    delete (legacyScan as Partial<typeof legacyScan>).analysisKind;
    (legacy.scans as unknown[]).push(legacyScan);

    const raw = new Dexie("foodlens-demo");
    raw.version(1).stores({ state: "id,version" });
    await raw.table("state").put({
      id: "snapshot",
      version: DEMO_SEED_VERSION - 1,
      schemaVersion: 1,
      value: legacy,
      customized: {
        profile: false,
        settings: false,
        researchSectionIds: [],
        classIds: [],
      },
    });
    raw.close();

    const migrated = await repository.getSnapshot();
    expect(
      migrated.scans.find((scan) => scan.id === legacyScan.id)?.analysisKind,
    ).toBe("source-unverified");
  });

  it("seed 升級不覆寫使用者已完成的清運流程", async () => {
    const legacy = createDemoSnapshot();
    const scheduledIndex = legacy.collectionEvents.findIndex(
      (event) => event.id === "demo-collection-scheduled",
    );
    legacy.collectionEvents[scheduledIndex] = {
      ...legacy.collectionEvents[scheduledIndex],
      status: "collected",
      collectedAt: "2026-10-02T05:00:00.000Z",
      haulerName: "使用者已確認的清運單位",
      netCollectedWeightG: 6_800,
      updatedAt: "2026-10-02T05:01:00.000Z",
    };
    const raw = new Dexie("foodlens-demo");
    raw.version(1).stores({ state: "id,version" });
    await raw.table("state").put({
      id: "snapshot",
      version: DEMO_SEED_VERSION - 1,
      schemaVersion: 1,
      value: legacy,
      customized: {
        profile: false,
        settings: false,
        researchSectionIds: [],
        classIds: [],
      },
    });
    raw.close();

    const migrated = await repository.getSnapshot();
    expect(
      migrated.collectionEvents.find(
        (event) => event.id === "demo-collection-scheduled",
      ),
    ).toMatchObject({
      status: "collected",
      haulerName: "使用者已確認的清運單位",
      netCollectedWeightG: 6_800,
    });
  });

  it("v12 缺少來源與菜單覆核新欄位時，只汰換不可推定的去向鏈並保留其餘使用者資料", async () => {
    const legacy = structuredClone(createDemoSnapshot());
    legacy.meals.push({
      ...legacy.meals[0],
      id: "meal-user-preserved-v12",
      mainDish: "使用者自訂主菜",
      menuSignature: "白飯|使用者自訂主菜",
      source: "manual",
    });
    legacy.profile = {
      ...legacy.profile,
      teamName: "不可被重置的使用者團隊",
      updatedAt: "2026-11-01T08:00:00.000Z",
    };
    delete (legacy.collectionEvents[0] as unknown as Record<string, unknown>)
      .wasteSources;
    for (const evidenceCase of legacy.evidenceCases) {
      delete (
        evidenceCase.menuVersion.sourceEvidence as unknown as Record<
          string,
          unknown
        >
      ).warnings;
      if (evidenceCase.menuVersion.confirmation)
        delete (
          evidenceCase.menuVersion.confirmation as unknown as Record<
            string,
            unknown
          >
        ).acceptedLowConfidence;
    }

    const raw = new Dexie("foodlens-demo");
    raw.version(1).stores({ state: "id,version" });
    await raw.table("state").put({
      id: "snapshot",
      version: DEMO_SEED_VERSION - 1,
      schemaVersion: 1,
      value: legacy,
      customized: {
        profile: true,
        settings: false,
        researchSectionIds: [],
        classIds: [],
      },
    });
    raw.close();

    const migrated = await repository.getSnapshot();
    expect(
      migrated.meals.some((meal) => meal.id === "meal-user-preserved-v12"),
    ).toBe(true);
    expect(migrated.profile.teamName).toBe("不可被重置的使用者團隊");
    expect(migrated.collectionEvents).toHaveLength(3);
    expect(
      migrated.collectionEvents.every((event) => event.wasteSources.length),
    ).toBe(true);
    expect(migrated.destinationReceipts).toHaveLength(2);
    expect(
      migrated.evidenceCases[0].menuVersion.sourceEvidence.warnings.join(" "),
    ).toContain("v12");
    expect(
      migrated.evidenceCases[0].menuVersion.confirmation?.acceptedLowConfidence,
    ).toBeDefined();
  });

  it("新增與停用的班級可持久化，並在 seed 升級時保留教師調整", async () => {
    const editedSeedClass = {
      id: "class-5a",
      name: "五年甲班（午餐組）",
      grade: 5 as const,
      active: false,
    };
    const addedClass = {
      id: "class-school-custom",
      name: "六年丁班",
      grade: 6 as const,
      active: true,
    };
    await repository.upsertClass(editedSeedClass);
    await repository.upsertClass(addedClass);
    expect(await repository.getSnapshot()).toMatchObject({
      classes: expect.arrayContaining([editedSeedClass, addedClass]),
    });

    const raw = new Dexie("foodlens-demo");
    raw.version(1).stores({ state: "id,version" });
    const state = await raw.table("state").get("snapshot");
    await raw.table("state").put({
      ...state,
      version: DEMO_SEED_VERSION - 1,
    });
    raw.close();

    const migrated = await repository.getSnapshot();
    expect(migrated.classes).toEqual(
      expect.arrayContaining([editedSeedClass, addedClass]),
    );
  });
});

describe("MemoryFoodLensRepository", () => {
  it("兩種本機 repository 都拒絕用 CSV 相同 ID 改寫已有餐盤的餐期證據", async () => {
    const repositories = [
      new DemoLocalRepository(),
      new MemoryFoodLensRepository(),
    ];

    for (const repository of repositories) {
      await repository.resetDemo();
      const before = await repository.getSnapshot();
      const protectedMeal = before.meals[0];
      const scanIds = before.scans
        .filter((scan) => scan.mealRecordId === protectedMeal.id)
        .map((scan) => scan.id);
      const conflictingImport = {
        ...protectedMeal,
        mainDish: "CSV 不應覆寫的主菜",
        menuSignature: `${protectedMeal.staple}|csv 不應覆寫的主菜`,
        source: "import" as const,
      };

      await expect(
        repository.importMealRecords([conflictingImport]),
      ).rejects.toThrow("已有餐盤判讀，不能用 CSV 改寫");

      const after = await repository.getSnapshot();
      expect(after.meals.find((meal) => meal.id === protectedMeal.id)).toEqual(
        protectedMeal,
      );
      expect(
        after.scans
          .filter((scan) => scan.mealRecordId === protectedMeal.id)
          .map((scan) => scan.id),
      ).toEqual(scanIds);
    }
  });

  it("基本寫入、重設與復原語意和 IndexedDB repository 等價", async () => {
    const indexed = new DemoLocalRepository();
    const memory = new MemoryFoodLensRepository();
    await indexed.resetDemo();
    await memory.resetDemo();

    const initialIndexed = await indexed.getSnapshot();
    const initialMemory = await memory.getSnapshot();
    expect(normalizeRepositorySnapshot(initialMemory)).toEqual(
      normalizeRepositorySnapshot(initialIndexed),
    );

    const command = existingMealCommand(initialIndexed);
    const [indexedResult, memoryResult] = await Promise.all([
      indexed.confirmScan(command),
      memory.confirmScan(command),
    ]);
    expect(memoryResult).toEqual(indexedResult);

    const importedMeal = {
      ...initialIndexed.meals[0],
      id: "meal-repository-contract-import",
      servedOn: "2026-10-27",
      mainDish: "Repository 契約測試主菜",
      menuSignature: "白飯|repository 契約測試主菜",
      source: "import" as const,
    };
    await Promise.all([
      indexed.importMealRecords([importedMeal]),
      memory.importMealRecords([importedMeal]),
    ]);
    expect(normalizeRepositorySnapshot(await memory.getSnapshot())).toEqual(
      normalizeRepositorySnapshot(await indexed.getSnapshot()),
    );

    await Promise.all([indexed.resetDemo(), memory.resetDemo()]);
    expect(await memory.getRecoveryMetadata()).toMatchObject({
      mealCount: 49,
      scanCount: 97,
    });
    expect(await indexed.getRecoveryMetadata()).toMatchObject({
      mealCount: 49,
      scanCount: 97,
    });
    await expect(memory.restoreRecovery()).resolves.toBe(true);
    await expect(indexed.restoreRecovery()).resolves.toBe(true);
    expect(normalizeRepositorySnapshot(await memory.getSnapshot())).toEqual(
      normalizeRepositorySnapshot(await indexed.getSnapshot()),
    );
  });

  it("兩種本機 repository 對班級新增與停用的契約等價", async () => {
    const indexed = new DemoLocalRepository();
    const memory = new MemoryFoodLensRepository();
    await Promise.all([indexed.resetDemo(), memory.resetDemo()]);

    const added = {
      id: "class-contract-added",
      name: "五年測試班",
      grade: 5 as const,
      active: true,
    };
    const inactive = {
      id: "class-5a",
      name: "五年甲班",
      grade: 5 as const,
      active: false,
    };
    await Promise.all([
      indexed.upsertClass(added),
      memory.upsertClass(added),
      indexed.upsertClass(inactive),
      memory.upsertClass(inactive),
    ]);

    expect(normalizeRepositorySnapshot(await memory.getSnapshot())).toEqual(
      normalizeRepositorySnapshot(await indexed.getSnapshot()),
    );
  });

  it("保存期限清理在 IndexedDB 與記憶體模式採相同範圍，並保留餐期秤重", async () => {
    const indexed = new DemoLocalRepository();
    const memory = new MemoryFoodLensRepository();
    await Promise.all([indexed.resetDemo(), memory.resetDemo()]);
    const before = await indexed.getSnapshot();
    const [indexedPreview, memoryPreview] = await Promise.all([
      indexed.previewDataRetention(45),
      memory.previewDataRetention(45),
    ]);
    expect(memoryPreview).toMatchObject({
      cutoffDate: indexedPreview.cutoffDate,
      eligibleScanCount: indexedPreview.eligibleScanCount,
      affectedMealCount: indexedPreview.affectedMealCount,
      preservedMealCount: 48,
    });

    const [indexedRun, memoryRun] = await Promise.all([
      indexed.executeDataRetention(45),
      memory.executeDataRetention(45),
    ]);
    expect(memoryRun).toMatchObject({
      status: "completed",
      candidateScanCount: indexedRun.candidateScanCount,
      deletedScanCount: indexedRun.deletedScanCount,
    });
    const [indexedAfter, memoryAfter] = await Promise.all([
      indexed.getSnapshot(),
      memory.getSnapshot(),
    ]);
    expect(indexedAfter.meals).toHaveLength(before.meals.length);
    expect(memoryAfter.meals).toHaveLength(before.meals.length);
    expect(indexedAfter.scans.length).toBe(
      before.scans.length - indexedRun.deletedScanCount,
    );
    expect(normalizeRepositorySnapshot(memoryAfter)).toEqual(
      normalizeRepositorySnapshot(indexedAfter),
    );
  });

  it("IndexedDB 清理同步洗掉 recovery，還原不會讓到期 Blob 或判讀復活", async () => {
    const repository = new DemoLocalRepository();
    await repository.resetDemo();
    const run = await repository.executeDataRetention(45);
    expect(run.deletedScanCount).toBeGreaterThan(0);
    const afterCleanup = await repository.getSnapshot();

    await expect(repository.restoreRecovery()).resolves.toBe(true);
    const restored = await repository.getSnapshot();
    expect(restored.scans).toHaveLength(afterCleanup.scans.length);
    expect((await repository.listDataRetentionRuns())[0]).toMatchObject({
      id: run.id,
      status: "completed",
      deletedScanCount: run.deletedScanCount,
    });
  });
});
