import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_BACKUP_IMAGE_BYTES,
  parseFoodLensBackup,
  parseMealRecordsCsv,
  serializeFoodLensBackup,
  serializeMealRecordsCsv,
} from "@/lib/data-portability";
import { createPredictionDecisionTrace } from "@/lib/experiment-decision";
import {
  createPrediction,
  JUDGE_DEMO_PREDICTION_INPUT,
} from "@/lib/prediction";
import {
  closeDemoLocalDatabaseConnection,
  DemoLocalRepository,
} from "@/lib/repositories/demo-local";
import { createDemoSnapshot } from "@/lib/seed";
import {
  caseToWasteObservation,
  emptyReasonCounts,
} from "@/lib/evidence-chain";
import type {
  AiAnalysisV1,
  ConfirmScanCommand,
  SupplyPrediction,
} from "@/lib/types";

const repository = new DemoLocalRepository();

afterEach(() => {
  closeDemoLocalDatabaseConnection();
});

function command(
  clientRequestId: string,
  mainDish = "併發保存測試雞肉",
): ConfirmScanCommand {
  const detections = [
    {
      category: "rice" as const,
      label: "白飯",
      originalG: 120,
      remainingRatio: 0.25,
      remainingG: 30,
      confidence: 0.9,
    },
  ];
  const analysis: AiAnalysisV1 = {
    schemaVersion: "1",
    provider: "test-provider",
    model: "test-model",
    isMock: true,
    detections,
    warnings: [],
    analyzedAt: "2026-10-26T12:00:00+08:00",
  };
  return {
    clientRequestId,
    meal: {
      classId: "class-5a",
      servedOn: "2026-10-26",
      mealPeriod: "lunch",
      staple: "白飯",
      mainDish,
      sideDishes: ["青菜"],
      plannedPeople: 25,
      actualPeople: 25,
      totalSupplyG: 6500,
      leftoverG: 1300,
      measurementMethod: "scale",
      notes: "資料可攜性回歸測試",
      source: "manual",
    },
    analysis,
    corrections: detections,
  };
}

function prediction(id: string): SupplyPrediction {
  return {
    id,
    createdAt: "2026-10-26T12:00:00+08:00",
    plannedPeople: 25,
    menuName: `併發預測 ${id}`,
    plannedSupplyG: 6500,
    recommendedSupplyG: 6000,
    averageLeftoverRate: 0.2,
    possibleSavingG: 500,
    possibleSavingTwd: 25,
    confidence: "medium",
    matchLevel: "similar",
    sampleSize: 12,
    independentDateCount: 6,
    evidenceMealIds: ["meal-01-class-5a"],
    reason: "測試用預測",
    algorithmVersion: "foodlens-v1",
  };
}

describe("data portability regression coverage", () => {
  beforeEach(async () => {
    await repository.resetDemo();
  });

  it("JSON backup retains unknown feedback and legacy values without promoting them to observations", async () => {
    const snapshot = createDemoSnapshot();
    snapshot.evidenceCases[0].reasonCollectionStatus = "not-collected";
    snapshot.evidenceCases[0].reasonCounts = emptyReasonCounts();
    const backup = JSON.parse(await serializeFoodLensBackup(snapshot));
    const legacy = backup.snapshot.evidenceCases[1];
    delete legacy.feedbackSchemaVersion;
    delete legacy.reasonCollectionStatus;
    delete legacy.teacherContext.deliveryStatus;
    delete legacy.teacherContext.temperatureStatus;
    const originalLegacy = structuredClone(legacy);
    const restored = await parseFoodLensBackup(JSON.stringify(backup));
    expect(restored.evidenceCases[0].reasonCounts).toEqual(emptyReasonCounts());
    expect(restored.evidenceCases[0].reasonCollectionStatus).toBe(
      "not-collected",
    );
    expect(restored.evidenceCases[1].reasonCollectionStatus).toBe(
      "legacy-unverified",
    );
    expect(restored.evidenceCases[1].reasonCounts).toEqual(
      originalLegacy.reasonCounts,
    );
    expect(restored.evidenceCases[1].teacherContext.deliveryDelayMinutes).toBe(
      originalLegacy.teacherContext.deliveryDelayMinutes,
    );
    expect(
      caseToWasteObservation(restored.evidenceCases[1]).context.feedback,
    ).toBeUndefined();
    expect(
      caseToWasteObservation(restored.evidenceCases[1]).context.delivery
        ?.delayMinutes,
    ).toBeNull();
    await repository.replaceSnapshot(restored);
    closeDemoLocalDatabaseConnection();
    const reloaded = await repository.getSnapshot();
    expect(reloaded.evidenceCases[0].reasonCounts).toEqual(emptyReasonCounts());
    expect(reloaded.evidenceCases[1].reasonCollectionStatus).toBe(
      "legacy-unverified",
    );
  });

  it("JSON backup parse round-trip 完整保留三筆餐期證據鏈", async () => {
    const snapshot = createDemoSnapshot();

    const restored = await parseFoodLensBackup(
      await serializeFoodLensBackup(snapshot),
    );

    expect(snapshot.evidenceCases).toHaveLength(3);
    expect(restored.evidenceCases).toEqual(snapshot.evidenceCases);
    expect(
      restored.evidenceCases.map((evidenceCase) => evidenceCase.id),
    ).toEqual(["demo-evidence-1", "demo-evidence-2", "demo-evidence-3"]);
  });

  it("JSON backup 完整保留清運與處理場收據證據", async () => {
    const snapshot = createDemoSnapshot();

    const restored = await parseFoodLensBackup(
      await serializeFoodLensBackup(snapshot),
    );

    expect(restored.collectionEvents).toEqual(snapshot.collectionEvents);
    expect(restored.destinationReceipts).toEqual(snapshot.destinationReceipts);
  });

  it("JSON backup 明確保存分析來源，v1 舊資料只安全升級已知來源", async () => {
    const current = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    expect(current.version).toBe(4);
    expect(current.snapshot.scans[0].analysisKind).toBe("mock-ai");
    expect(current.snapshot.scans[0].menuContext).toBeNull();

    const missingCurrentSource = structuredClone(current);
    delete missingCurrentSource.snapshot.scans[0].analysisKind;
    await expect(
      parseFoodLensBackup(JSON.stringify(missingCurrentSource)),
    ).rejects.toThrow("備份格式錯誤");

    const missingCurrentMenuContext = structuredClone(current);
    delete missingCurrentMenuContext.snapshot.scans[0].menuContext;
    await expect(
      parseFoodLensBackup(JSON.stringify(missingCurrentMenuContext)),
    ).rejects.toThrow("備份格式錯誤");

    current.version = 1;
    current.snapshot.scans[0].provider = "foodlens-mock";
    current.snapshot.scans[1].provider = "human-manual";
    current.snapshot.scans[2].provider = "looks-like-real-ai";
    delete current.snapshot.scans[0].analysisKind;
    delete current.snapshot.scans[1].analysisKind;
    // v1 never defined this field. An injected claim must not upgrade an
    // arbitrary old provider to real AI.
    current.snapshot.scans[2].analysisKind = "real-ai";

    const restored = await parseFoodLensBackup(JSON.stringify(current));
    expect(restored.scans.slice(0, 3).map((scan) => scan.analysisKind)).toEqual(
      ["mock-ai", "human-manual", "source-unverified"],
    );
  });

  it("v2 備份不採信當時未定義的菜單候選聲明", async () => {
    const legacy = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    legacy.version = 2;
    legacy.snapshot.scans[0].menuContext = {
      menuVersionId: "forged-legacy-menu",
      menuVersionSignature: "forged-legacy-signature",
      candidateCount: 3,
    };
    delete legacy.snapshot.scans[1].menuContext;

    const restored = await parseFoodLensBackup(JSON.stringify(legacy));

    expect(restored.scans[0].menuContext).toBeNull();
    expect(restored.scans[1].menuContext).toBeNull();
    expect(restored.scans[0].analysisKind).toBe("mock-ai");
  });

  it("v3 備份往返保留可稽核菜單候選脈絡", async () => {
    const snapshot = createDemoSnapshot();
    snapshot.scans[0].menuContext = {
      menuVersionId: "confirmed-menu-v1",
      menuVersionSignature: "confirmed-menu-signature-v1",
      candidateCount: 3,
    };

    const restored = await parseFoodLensBackup(
      await serializeFoodLensBackup(snapshot),
    );

    expect(restored.scans[0].menuContext).toEqual(
      snapshot.scans[0].menuContext,
    );
  });

  it("JSON backup 拒絕同餐期把任一分流來源重複指派給兩筆有效清運", async () => {
    const snapshot = createDemoSnapshot();
    const scheduled = snapshot.collectionEvents.find(
      (event) => event.status === "scheduled",
    )!;
    snapshot.collectionEvents.push({
      ...scheduled,
      id: "backup-overlapping-route",
      wasteSources: ["plate_edible", "inedible"],
      createdAt: "2026-10-02T04:45:00.000Z",
      updatedAt: "2026-10-02T04:45:00.000Z",
    });

    await expect(serializeFoodLensBackup(snapshot)).rejects.toThrow("重複分派");
  });

  it("拒絕指向不存在清運事件的處理場收據", async () => {
    const backup = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    backup.snapshot.destinationReceipts[0].collectionEventId =
      "missing-collection-event";

    await expect(parseFoodLensBackup(JSON.stringify(backup))).rejects.toThrow(
      "指向不存在的清運事件",
    );
  });

  it("JSON backup round-trips Blob images without retaining an object URL", async () => {
    const snapshot = createDemoSnapshot();
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    snapshot.scans[0] = {
      ...snapshot.scans[0],
      imageUrl: undefined,
      imageBlob: new Blob([imageBytes], { type: "image/png" }),
    };

    const restored = await parseFoodLensBackup(
      await serializeFoodLensBackup(snapshot),
    );
    const restoredScan = restored.scans[0];

    expect(restoredScan.imageUrl).toBeUndefined();
    expect(restoredScan.imageBlob).toBeInstanceOf(Blob);
    expect(restoredScan.imageBlob?.type).toBe("image/png");
    expect(new Uint8Array(await restoredScan.imageBlob!.arrayBuffer())).toEqual(
      imageBytes,
    );
  });

  it("round-trips optional governance fields while accepting legacy profiles", async () => {
    const snapshot = createDemoSnapshot();
    snapshot.profile = {
      ...snapshot.profile,
      privacyContact: "午餐秘書 office@example.edu.tw",
      dataRetentionDays: 365,
      governanceReviewedAt: "2026-10-26T12:00:00+08:00",
    };

    const restored = await parseFoodLensBackup(
      await serializeFoodLensBackup(snapshot),
    );
    expect(restored.profile).toMatchObject({
      privacyContact: "午餐秘書 office@example.edu.tw",
      dataRetentionDays: 365,
      governanceReviewedAt: "2026-10-26T12:00:00+08:00",
    });

    const legacy = JSON.parse(await serializeFoodLensBackup(snapshot));
    delete legacy.snapshot.profile.privacyContact;
    delete legacy.snapshot.profile.dataRetentionDays;
    delete legacy.snapshot.profile.governanceReviewedAt;
    await expect(
      parseFoodLensBackup(JSON.stringify(legacy)),
    ).resolves.toMatchObject({
      profile: { projectName: "FoodLens 食光偵探" },
    });
  });

  it("round-trips a linked experiment decision snapshot", async () => {
    const snapshot = createDemoSnapshot();
    const linked = createPrediction(snapshot, JUDGE_DEMO_PREDICTION_INPUT);
    snapshot.predictions.push(linked);
    snapshot.experiments[0] = {
      ...snapshot.experiments[0],
      linkedPredictionId: linked.id,
      decisionTrace: createPredictionDecisionTrace(linked, {
        adoptionMode: "recommended",
        adoptionNote: "採建議量試行並保留補餐。",
        recordedAt: "2026-08-31T12:30:00.000Z",
      }),
      safetyGuardrails: {
        shortageReportCount: 0,
        refillRequestCount: 2,
        satisfactionScore: 4.3,
        satisfactionResponseCount: 26,
        dietitianReview: "confirmed",
        dietitianNote: "營養師確認保留補餐備援。",
        confounders: ["改善週氣溫較低"],
        checkedAt: "2026-10-16T07:30:00.000Z",
      },
    };

    const restored = await parseFoodLensBackup(
      await serializeFoodLensBackup(snapshot),
    );
    expect(restored.experiments[0].decisionTrace).toMatchObject({
      predictionId: linked.id,
      plannedSupplyG: linked.plannedSupplyG,
      recommendedSupplyG: linked.recommendedSupplyG,
      adoptedSupplyG: linked.recommendedSupplyG,
      adoptionMode: "recommended",
    });
    expect(restored.experiments[0].safetyGuardrails).toEqual(
      snapshot.experiments[0].safetyGuardrails,
    );

    const legacy = JSON.parse(await serializeFoodLensBackup(snapshot));
    delete legacy.snapshot.experiments[0].safetyGuardrails;
    await expect(
      parseFoodLensBackup(JSON.stringify(legacy)),
    ).resolves.toMatchObject({
      experiments: [{ decisionTrace: { predictionId: linked.id } }],
    });
  });

  it("upgrades a v0 backup only when its missing meal signature is deterministic", async () => {
    const legacy = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    legacy.version = 0;
    delete legacy.snapshot.meals[0].menuSignature;
    delete legacy.snapshot.scans[0].analysisKind;

    const restored = await parseFoodLensBackup(JSON.stringify(legacy));
    expect(restored.meals[0]).toMatchObject({
      id: legacy.snapshot.meals[0].id,
      menuSignature:
        `${legacy.snapshot.meals[0].staple}|${legacy.snapshot.meals[0].mainDish}`.toLowerCase(),
    });

    delete legacy.snapshot.meals[0].source;
    await expect(parseFoodLensBackup(JSON.stringify(legacy))).rejects.toThrow(
      "備份格式錯誤",
    );
  });

  it("rejects a newer backup version before validating its snapshot", async () => {
    const backup = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    backup.version = 5;
    delete backup.snapshot.profile;

    await expect(parseFoodLensBackup(JSON.stringify(backup))).rejects.toThrow(
      "不支援的備份版本 5；目前最高支援版本為 4，請更新 FoodLens 後再匯入",
    );
  });

  it("rejects governance retention values outside the declared range", async () => {
    const backup = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    backup.snapshot.profile.dataRetentionDays = 0;
    await expect(parseFoodLensBackup(JSON.stringify(backup))).rejects.toThrow(
      "備份格式錯誤",
    );
  });

  it("serializes image Blobs sequentially to avoid concurrent backup spikes", async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    class ObservedBlob extends Blob {
      override async arrayBuffer() {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        try {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return await super.arrayBuffer();
        } finally {
          activeReads -= 1;
        }
      }
    }

    const snapshot = createDemoSnapshot();
    snapshot.scans[0] = {
      ...snapshot.scans[0],
      imageUrl: undefined,
      imageBlob: new ObservedBlob([new Uint8Array([1, 2, 3])], {
        type: "image/png",
      }),
    };
    snapshot.scans[1] = {
      ...snapshot.scans[1],
      imageUrl: undefined,
      imageBlob: new ObservedBlob([new Uint8Array([4, 5, 6])], {
        type: "image/png",
      }),
    };

    await serializeFoodLensBackup(snapshot);

    expect(maxActiveReads).toBe(1);
  });

  it("rejects an imported data URL whose decoded image exceeds 5MB", async () => {
    const backup = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    const oversizedImage = Buffer.alloc(MAX_BACKUP_IMAGE_BYTES + 1);
    delete backup.snapshot.scans[0].imageUrl;
    backup.snapshot.scans[0].imageDataUrl = `data:image/png;base64,${oversizedImage.toString("base64")}`;

    await expect(parseFoodLensBackup(JSON.stringify(backup))).rejects.toThrow(
      "單張圖片超過 5MB",
    );
  });

  it("rejects backups with broken references, missing required fields, or injected fields", async () => {
    const backup = JSON.parse(
      await serializeFoodLensBackup(createDemoSnapshot()),
    );
    backup.snapshot.scans[0].mealRecordId = "meal-that-does-not-exist";
    await expect(parseFoodLensBackup(JSON.stringify(backup))).rejects.toThrow(
      "指向不存在的餐期",
    );

    const missingProfile = JSON.parse(JSON.stringify(backup));
    missingProfile.snapshot.scans[0].mealRecordId = "meal-01-class-5a";
    delete missingProfile.snapshot.profile;
    await expect(
      parseFoodLensBackup(JSON.stringify(missingProfile)),
    ).rejects.toThrow("備份格式錯誤");

    const injected = JSON.parse(JSON.stringify(missingProfile));
    injected.snapshot.profile = createDemoSnapshot().profile;
    const injectedJson = JSON.stringify(injected).replace(
      '"snapshot":{',
      '"snapshot":{"__proto__":{"polluted":true},',
    );
    await expect(parseFoodLensBackup(injectedJson)).rejects.toThrow(
      "備份格式錯誤",
    );
  });

  it("CSV round-trips quoted commas, quotes, and line breaks", () => {
    const snapshot = createDemoSnapshot();
    snapshot.meals = [
      {
        ...snapshot.meals[0],
        staple: "糙米,飯",
        mainDish: '「特製」\n"香草,雞肉"',
        notes: '第一行, 含逗號\n第二行含 "雙引號"',
      },
    ];

    const imported = parseMealRecordsCsv(
      serializeMealRecordsCsv(snapshot),
      snapshot.classes,
    );

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      staple: "糙米,飯",
      mainDish: '「特製」\n"香草,雞肉"',
      notes: '第一行, 含逗號\n第二行含 "雙引號"',
    });
  });

  it("CSV export neutralizes spreadsheet formulas from editable text", () => {
    const snapshot = createDemoSnapshot();
    snapshot.meals = [
      {
        ...snapshot.meals[0],
        mainDish: '=HYPERLINK("https://example.invalid","open")',
        notes: "  +SUM(1,1)",
      },
    ];

    const csv = serializeMealRecordsCsv(snapshot);

    expect(csv).toContain(
      `"'=HYPERLINK(""https://example.invalid"",""open"")"`,
    );
    expect(csv).toContain(`"'  +SUM(1,1)"`);
    expect(csv).not.toContain(
      `"=HYPERLINK(""https://example.invalid"",""open"")"`,
    );
  });

  it("rejects calendar dates that JavaScript would otherwise normalize", () => {
    const snapshot = createDemoSnapshot();
    const csv = serializeMealRecordsCsv(snapshot).replace(
      snapshot.meals[0].servedOn,
      "2026-02-31",
    );

    expect(() => parseMealRecordsCsv(csv, snapshot.classes)).toThrow(
      "日期無效",
    );
  });

  it("rejects a reused request ID when its content changed", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    await repository.confirmScan(command(requestId));

    await expect(
      repository.confirmScan(command(requestId, "不同內容的主菜")),
    ).rejects.toThrow("同一送出識別碼已保存另一份內容");
  });

  it("does not lose concurrent prediction saves", async () => {
    const values = Array.from({ length: 12 }, (_, index) =>
      prediction(`concurrent-prediction-${index}`),
    );

    await Promise.all(values.map((value) => repository.savePrediction(value)));
    const snapshot = await repository.getSnapshot();

    expect(
      snapshot.predictions
        .filter((value) => value.id.startsWith("concurrent-prediction-"))
        .map((value) => value.id)
        .sort(),
    ).toEqual(values.map((value) => value.id).sort());
  });
});
