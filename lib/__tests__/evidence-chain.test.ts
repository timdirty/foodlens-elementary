import { describe, expect, it } from "vitest";
import {
  analyzeEvidenceCases,
  ANONYMOUS_REASON_KEYS,
  buildComparableEvidenceCohort,
  caseToWasteObservation,
  COMPARABLE_EVIDENCE_LOOKBACK_DAYS,
  createDemoEvidenceCases,
  EVIDENCE_SOURCE_KINDS,
  evidenceSourceKindSchema,
  mealEvidenceCaseSchema,
  type EvidenceSourceKind,
  type MealEvidenceCase,
  upsertEvidenceCase,
} from "@/lib/evidence-chain";
import {
  collectLowConfidenceAcceptances,
  confirmMenuVersion,
  importMenuVersion,
  type MenuDishImportRow,
} from "@/lib/menu-intelligence";
import { WASTE_SOURCES } from "@/lib/waste-intelligence";

const EXACT_MENU: readonly MenuDishImportRow[] = [
  {
    rawName: "糙米飯",
    role: "staple",
    category: "rice",
    cookingMethod: "steamed",
    recipeVersion: "rice-r1",
  },
  {
    rawName: "咖哩雞丁",
    role: "main",
    category: "meat",
    cookingMethod: "stewed",
    recipeVersion: "curry-r1",
  },
  {
    rawName: "清炒高麗菜",
    role: "side",
    category: "vegetable",
    cookingMethod: "stir-fried",
    recipeVersion: "vegetable-r1",
  },
];

function evidenceCaseOn({
  id,
  servedOn,
  dishes = EXACT_MENU,
  classId = "class-5a",
  sourceKind = "demo",
  vendorId = "vendor-a",
}: {
  id: string;
  servedOn: string;
  dishes?: readonly MenuDishImportRow[];
  classId?: string;
  sourceKind?: EvidenceSourceKind;
  vendorId?: string;
}): MealEvidenceCase {
  const candidate = structuredClone(createDemoEvidenceCases()[0]);
  const draftMenu = importMenuVersion([
    {
      source: "structured",
      menuId: `menu-${id}`,
      servedOn,
      importedAt: `${servedOn}T01:00:00.000Z`,
      vendorId,
      dishes: [...dishes],
    },
  ]);
  candidate.id = id;
  candidate.classId = classId;
  candidate.servedOn = servedOn;
  candidate.sourceKind = sourceKind;
  candidate.menuVersion = confirmMenuVersion(draftMenu, {
    reviewedBy: "測試審核者",
    reviewedAt: `${servedOn}T02:00:00.000Z`,
    notes: "建立 cohort 測試用的人工確認菜單。",
    acceptedLowConfidence: collectLowConfidenceAcceptances(draftMenu),
  });
  candidate.measurements = candidate.measurements.map((measurement, index) => ({
    ...measurement,
    id: `${id}-measurement-${index + 1}`,
  }));
  candidate.measurementReview =
    sourceKind === "demo"
      ? undefined
      : {
          reviewedAt: `${servedOn}T05:30:00.000Z`,
          reviewedBy: "現場測試人員",
          zeroValuesChecked: true,
        };
  candidate.humanDecision = undefined;
  candidate.createdAt = `${servedOn}T05:00:00.000Z`;
  candidate.updatedAt = `${servedOn}T06:00:00.000Z`;
  return mealEvidenceCaseSchema.parse(candidate);
}

describe("MealEvidenceCase 資料契約", () => {
  it("固定提供四種證據 provenance 與六個可擴充匿名原因", () => {
    expect(EVIDENCE_SOURCE_KINDS).toEqual([
      "demo",
      "measured",
      "estimated",
      "official",
    ]);
    expect(ANONYMOUS_REASON_KEYS).toEqual([
      "portion",
      "taste",
      "texture",
      "temperature",
      "time",
      "other",
    ]);
  });

  it.each(["demo", "measured", "estimated", "official"] as const)(
    "接受 %s 證據來源",
    (sourceKind) => {
      expect(evidenceSourceKindSchema.parse(sourceKind)).toBe(sourceKind);
    },
  );

  it.each(["imported", "manual", ""])("拒絕舊版或未知來源 %j", (sourceKind) => {
    expect(evidenceSourceKindSchema.safeParse(sourceKind).success).toBe(false);
  });

  it("案件日期必須與菜單版本日期一致", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.servedOn = "2026-01-07";

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("案件日期必須與菜單版本日期一致"),
      ),
    ).toBe(true);
  });

  it("菜單仍是草稿時不可完成整案", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.menuVersion = importMenuVersion([
      {
        source: "demo",
        menuId: "draft-menu",
        servedOn: candidate.servedOn,
        fingerprint: "draft-evidence-menu",
      },
    ]);

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("菜單必須經人工確認"),
      ),
    ).toBe(true);
  });

  it("示範餐期可搭配經人工確認的 CSV 菜單", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    const draftMenu = importMenuVersion([
      {
        source: "csv",
        menuId: "demo-flow-csv-menu",
        servedOn: candidate.servedOn,
        csvText: "菜色名稱,角色\n咖哩飯,主食\n清炒高麗菜,副菜",
      },
    ]);
    candidate.menuVersion = confirmMenuVersion(draftMenu, {
      reviewedBy: "FoodLens 示範學生小組",
      reviewedAt: `${candidate.servedOn}T02:00:00.000Z`,
      notes: "Demo Mode 示範 CSV 匯入後，由學生逐項確認菜單。",
      acceptedLowConfidence: collectLowConfidenceAcceptances(draftMenu),
    });

    const parsed = mealEvidenceCaseSchema.parse(candidate);

    expect(parsed.sourceKind).toBe("demo");
    expect(parsed.menuVersion.sourceEvidence).toMatchObject({
      source: "csv",
      isMock: false,
    });
  });

  it("菜單來源為 demo 時不可移除 Mock 揭露", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.menuVersion.sourceEvidence.isMock = false;

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("Demo OCR 必須標示 isMock: true"),
      ),
    ).toBe(true);
  });

  it("拒絕空白或帶路徑符號的班級識別碼", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.classId = "../六年一班";

    expect(mealEvidenceCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it("沿用重量引擎拒絕負數與毛皮淨重不一致", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.measurements[0].grossG = -1;

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.path.join(".").includes("measurements.0.grossG"),
      ),
    ).toBe(true);
  });

  it("完成案件必須逐一明示五類來源，0g 也要留下量測列", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.measurements = candidate.measurements.filter(
      (measurement) => measurement.source !== "prep",
    );

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes("prep")),
    ).toBe(true);
  });

  it("盤後觀察人數不可高於實到人數", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.observedDiners = candidate.actualDiners + 1;

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("觀察人數不可高於實到"),
      ),
    ).toBe(true);
  });

  it("匿名主要原因合計不可高於實到人數", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.reasonCounts.portion = candidate.actualDiners;
    candidate.reasonCounts.taste = 1;

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("主要原因票數合計"),
      ),
    ).toBe(true);
  });

  it("匿名原因可增加新代碼，仍受非負整數與總人數限制", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.reasonCounts = {
      portion: 1,
      taste: 1,
      texture: 1,
      temperature: 0,
      time: 1,
      other: 0,
      unfamiliar: 2,
    };

    const parsed = mealEvidenceCaseSchema.parse(candidate);

    expect(parsed.reasonCounts.unfamiliar).toBe(2);
  });

  it("人工決策必須有具體理由", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.humanDecision = {
      cardId: "recipe-texture",
      choice: "pilot",
      rationale: " ",
      decidedAt: `${candidate.servedOn}T05:30:00.000Z`,
      decidedByRole: "dietitian",
    };

    expect(mealEvidenceCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it("人工決策時間必須落在案件建立至更新之間", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.humanDecision = {
      cardId: "recipe-texture",
      choice: "reject",
      rationale: "目前資料波動過大，本輪先不採用此建議。",
      decidedAt: `${candidate.servedOn}T07:00:00.000Z`,
      decidedByRole: "dietitian",
    };

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("人工決策時間"),
      ),
    ).toBe(true);
  });

  it("需要更多資料卡不可直接記錄為 pilot", () => {
    const candidate = structuredClone(createDemoEvidenceCases()[0]);
    candidate.humanDecision = {
      cardId: "need-more-data",
      choice: "pilot",
      rationale: "尚未補足資料卻直接試行，應被資料契約拒絕。",
      decidedAt: `${candidate.servedOn}T05:30:00.000Z`,
      decidedByRole: "lunch-secretary",
    };

    const result = mealEvidenceCaseSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("不可直接進入試行"),
      ),
    ).toBe(true);
  });
});

describe("菜單與剩食證據整合", () => {
  it("把已確認菜單、匿名原因及教師情境轉成 WasteObservation", () => {
    const evidenceCase = createDemoEvidenceCases()[1];

    const observation = caseToWasteObservation(evidenceCase);

    expect(observation).toMatchObject({
      id: evidenceCase.id,
      servedOn: evidenceCase.servedOn,
      plannedDiners: 30,
      actualDiners: 27,
      observedDiners: 18,
      context: {
        classId: "class-5a",
        includesVegetable: true,
        feedback: {
          responseCount: 15,
          portionTooMuchCount: 4,
          tasteIssueCount: 5,
          textureIssueCount: 4,
          temperatureIssueCount: 0,
        },
        delivery: { delayMinutes: 4, temperatureConcern: false },
      },
    });
    expect(observation.context.menuName.length).toBeGreaterThan(0);
    expect(
      new Set(observation.measurements.map((item) => item.source)),
    ).toEqual(new Set(WASTE_SOURCES));
  });

  it("轉換不會修改原始菜單、量測或原因紀錄", () => {
    const evidenceCase = createDemoEvidenceCases()[0];
    const before = JSON.stringify(evidenceCase);

    const observation = caseToWasteObservation(evidenceCase);
    observation.measurements[0].note = "只改回傳物件";

    expect(JSON.stringify(evidenceCase)).toBe(before);
    expect(evidenceCase.measurements[0].note).toBeUndefined();
  });

  it("Demo 分析依抽樣供應重量加權，不平均三天百分比", () => {
    const cases = createDemoEvidenceCases();

    const result = analyzeEvidenceCases(cases);
    const expectedPlateRate = (2_600 + 2_400 + 2_600) / 33_000;

    expect(result.metrics.weightedPlateRate).toBeCloseTo(expectedPlateRate, 6);
    expect(result.metrics.unservedRate).toBe(0.15);
    expect(result.metrics.coverageRate).toBeCloseTo(54 / 81, 6);
    expect(result.metrics.independentMealCount).toBe(3);
  });

  it("固定 Demo 至少產生兩張具責任人的非補資料卡", () => {
    const result = analyzeEvidenceCases(createDemoEvidenceCases());
    const actionableCards = result.responsibilityCards.filter(
      (card) => card.id !== "need-more-data",
    );

    expect(actionableCards.length).toBeGreaterThanOrEqual(2);
    expect(actionableCards.map((card) => card.id)).toEqual(
      expect.arrayContaining([
        "headcount-reserve",
        "recipe-texture",
        "vegetable-guardrail",
      ]),
    );
    actionableCards.forEach((card) => {
      expect(card.evidence.length).toBeGreaterThan(0);
      expect(card.owner.primary).toBeTruthy();
      expect(card.action).toBeTruthy();
      expect(card.guardrail).toBeTruthy();
      expect(card.confidence).toBe("medium");
    });
  });

  it("固定 Demo 每次完全相同、跨三日且全部醒目標示 demo", () => {
    const first = createDemoEvidenceCases();
    const second = createDemoEvidenceCases();

    expect(first).toEqual(second);
    expect(
      new Set(first.map((item) => item.servedOn)).size,
    ).toBeGreaterThanOrEqual(3);
    first.forEach((item) => {
      expect(item.classId).toBe("class-5a");
      expect(item.sourceKind).toBe("demo");
      expect(item.menuVersion.status).toBe("confirmed");
      expect(item.menuVersion.sourceEvidence).toMatchObject({
        source: "demo",
        isMock: true,
      });
    });
  });

  it("分析結果保留醒目的 Demo 數量與禁止冒充實測提示", () => {
    const result = analyzeEvidenceCases(createDemoEvidenceCases());

    expect(result.sourceSummary).toEqual({
      demo: 3,
      measured: 0,
      estimated: 0,
      official: 0,
      containsDemoData: true,
      disclosureLabel: "示範資料：3 筆，不代表本校實測成果",
    });
  });
});

describe("可比較證據 cohort", () => {
  it("固定 Demo 在 180 天內形成三個獨立日的同菜單 cohort", () => {
    const cases = createDemoEvidenceCases();
    const current = cases[2];

    const first = buildComparableEvidenceCohort(cases.slice(0, 2), current);
    const second = buildComparableEvidenceCohort(cases.slice(0, 2), current);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      level: "exact-menu",
      label: "同一實際菜單、食譜與供應商",
      window: {
        start: "2026-04-05",
        end: "2026-10-02",
        lookbackDays: COMPARABLE_EVIDENCE_LOOKBACK_DAYS,
      },
      caseIds: cases.map((evidenceCase) => evidenceCase.id),
      independentMealCount: 3,
    });
    expect(first.reason).toContain("3 個獨立供餐日");
  });

  it("完整菜單不足時降級為同主菜與供應商", () => {
    const sameMainMenuA: readonly MenuDishImportRow[] = [
      EXACT_MENU[0],
      EXACT_MENU[1],
      {
        rawName: "蒸南瓜",
        role: "side",
        category: "vegetable",
        cookingMethod: "steamed",
        recipeVersion: "pumpkin-r1",
      },
    ];
    const sameMainMenuB: readonly MenuDishImportRow[] = [
      {
        ...EXACT_MENU[0],
        rawName: "白飯",
        recipeVersion: "rice-r2",
      },
      EXACT_MENU[1],
      {
        rawName: "番茄炒蛋",
        role: "side",
        category: "egg",
        cookingMethod: "stir-fried",
        recipeVersion: "egg-r1",
      },
    ];
    const history = [
      evidenceCaseOn({
        id: "same-main-a",
        servedOn: "2026-08-07",
        dishes: sameMainMenuA,
      }),
      evidenceCaseOn({
        id: "same-main-b",
        servedOn: "2026-09-11",
        dishes: sameMainMenuB,
      }),
    ];
    const current = evidenceCaseOn({
      id: "same-main-current",
      servedOn: "2026-10-16",
    });

    const cohort = buildComparableEvidenceCohort(history, current);

    expect(cohort.level).toBe("same-main-supplier");
    expect(cohort.caseIds).toEqual([
      "same-main-a",
      "same-main-b",
      "same-main-current",
    ]);
    expect(cohort.independentMealCount).toBe(3);
    expect(cohort.reason).toContain("完整菜單只有 1 個可比供餐日");
  });

  it("主菜也不足時降級為同班近期基準", () => {
    const fishMenu: readonly MenuDishImportRow[] = [
      EXACT_MENU[0],
      {
        rawName: "紅燒魚片",
        role: "main",
        category: "meat",
        cookingMethod: "braised",
        recipeVersion: "fish-r1",
      },
    ];
    const chickenMenu: readonly MenuDishImportRow[] = [
      EXACT_MENU[0],
      {
        rawName: "滷雞腿",
        role: "main",
        category: "meat",
        cookingMethod: "braised",
        recipeVersion: "chicken-r1",
      },
    ];
    const history = [
      evidenceCaseOn({
        id: "class-baseline-a",
        servedOn: "2026-08-07",
        dishes: fishMenu,
      }),
      evidenceCaseOn({
        id: "class-baseline-b",
        servedOn: "2026-09-11",
        dishes: chickenMenu,
        vendorId: "vendor-b",
      }),
    ];
    const current = evidenceCaseOn({
      id: "class-baseline-current",
      servedOn: "2026-10-16",
    });

    const cohort = buildComparableEvidenceCohort(history, current);

    expect(cohort.level).toBe("class-baseline");
    expect(cohort.independentMealCount).toBe(3);
    expect(cohort.reason).toContain("同班最近 180 天");
  });

  it("三筆案件若只有兩個獨立供餐日仍只回傳 current", () => {
    const history = [
      evidenceCaseOn({ id: "same-day-a", servedOn: "2026-09-18" }),
      evidenceCaseOn({ id: "same-day-b", servedOn: "2026-09-18" }),
    ];
    const current = evidenceCaseOn({
      id: "threshold-current",
      servedOn: "2026-10-16",
    });

    const cohort = buildComparableEvidenceCohort(history, current);

    expect(cohort).toMatchObject({
      level: "current-only",
      caseIds: ["threshold-current"],
      independentMealCount: 1,
    });
    expect(cohort.reason).toContain("未達 3 個獨立供餐日");
  });

  it("排除未來、超過 180 天與不同 sourceKind，足量合法資料仍可成組", () => {
    const history = [
      evidenceCaseOn({ id: "eligible-a", servedOn: "2026-08-07" }),
      evidenceCaseOn({ id: "eligible-b", servedOn: "2026-09-11" }),
      evidenceCaseOn({ id: "future", servedOn: "2026-10-17" }),
      evidenceCaseOn({ id: "too-old", servedOn: "2026-04-18" }),
      evidenceCaseOn({
        id: "measured-source",
        servedOn: "2026-09-25",
        sourceKind: "measured",
      }),
    ];
    const current = evidenceCaseOn({
      id: "isolation-current",
      servedOn: "2026-10-16",
    });

    const cohort = buildComparableEvidenceCohort(history, current);

    expect(cohort).toMatchObject({
      level: "exact-menu",
      window: {
        start: "2026-04-19",
        end: "2026-10-16",
        lookbackDays: 180,
      },
      caseIds: ["eligible-a", "eligible-b", "isolation-current"],
      independentMealCount: 3,
    });
    expect(cohort.caseIds).not.toEqual(
      expect.arrayContaining(["future", "too-old", "measured-source"]),
    );
  });
});

describe("純函式 upsert", () => {
  it("新增案件時保留既有順序且不突變輸入陣列", () => {
    const demo = createDemoEvidenceCases();
    const existing = [demo[0]];
    const before = JSON.stringify(existing);

    const result = upsertEvidenceCase(existing, demo[1]);

    expect(result.map((item) => item.id)).toEqual([
      "demo-evidence-1",
      "demo-evidence-2",
    ]);
    expect(JSON.stringify(existing)).toBe(before);
    expect(result).not.toBe(existing);
    expect(result[0]).not.toBe(existing[0]);
  });

  it("更新案件可加入具理由的人類決策且不修改原物件", () => {
    const existing = [createDemoEvidenceCases()[0]];
    const next = structuredClone(existing[0]);
    next.updatedAt = `${next.servedOn}T07:00:00.000Z`;
    next.humanDecision = {
      cardId: "recipe-texture",
      choice: "pilot",
      rationale: "由營養師確認營養護欄後，只試行一次食譜口感調整。",
      decidedAt: `${next.servedOn}T06:30:00.000Z`,
      decidedByRole: "dietitian",
    };

    const result = upsertEvidenceCase(existing, next);

    expect(result).toHaveLength(1);
    expect(result[0].humanDecision).toEqual(next.humanDecision);
    expect(existing[0].humanDecision).toBeUndefined();
  });

  it("拒絕較舊版本覆寫新案件", () => {
    const existing = [createDemoEvidenceCases()[0]];
    const stale = structuredClone(existing[0]);
    stale.updatedAt = `${stale.servedOn}T05:30:00.000Z`;

    expect(() => upsertEvidenceCase(existing, stale)).toThrow(
      "不可用較舊版本覆寫證據案件",
    );
  });

  it("拒絕用相同案件 id 偷換班級或日期", () => {
    const existing = [createDemoEvidenceCases()[0]];
    const moved = structuredClone(existing[0]);
    moved.classId = "demo-class-6b";
    moved.updatedAt = `${moved.servedOn}T07:00:00.000Z`;

    expect(() => upsertEvidenceCase(existing, moved)).toThrow(
      "不可更改身分、日期、來源或建立時間",
    );
  });

  it("拒絕既有清單中的重複案件 id", () => {
    const duplicate = createDemoEvidenceCases()[0];

    expect(() =>
      upsertEvidenceCase([duplicate, structuredClone(duplicate)], duplicate),
    ).toThrow("證據案件編號不可重複");
  });
});
