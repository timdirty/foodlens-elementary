import { describe, expect, it } from "vitest";
import {
  collectLowConfidenceAcceptances,
  confirmMenuVersion,
  createDeterministicDemoOcr,
  createMenuDishSignature,
  getActualMenuDishes,
  getPlateCandidateLabels,
  getPlateCandidates,
  importMenuVersion,
  LOW_CONFIDENCE_THRESHOLD,
  menuImportInputSchema,
  menuVersionSchema,
  normalizeMenuDish,
  recordMenuSubstitution,
  removeMenuSubstitution,
  selectPreferredMenuInput,
  updateDraftMenuDish,
  type MenuImportInput,
} from "@/lib/menu-intelligence";

const IMPORTED_AT = "2026-09-04T04:00:00.000Z";
const REVIEWED_AT = "2026-09-04T05:00:00.000Z";

function structuredInput(
  overrides: Partial<Extract<MenuImportInput, { source: "structured" }>> = {},
): Extract<MenuImportInput, { source: "structured" }> {
  return {
    source: "structured",
    menuId: "menu-test-001",
    servedOn: "2026-09-04",
    mealPeriod: "lunch",
    importedAt: IMPORTED_AT,
    vendorId: "vendor-a",
    dishes: [
      {
        rawName: "咖哩雞丁",
        role: "main",
        portionG: 85,
        recipeVersion: "recipe-3",
      },
      {
        rawName: "清炒高麗菜",
        role: "side",
        portionG: 70,
        recipeVersion: "recipe-2",
      },
    ],
    ...overrides,
  };
}

function draftMenu(
  overrides: Partial<Extract<MenuImportInput, { source: "structured" }>> = {},
) {
  return importMenuVersion([structuredInput(overrides)]);
}

function lowConfidenceDraft() {
  return importMenuVersion([
    {
      source: "ocr",
      menuId: "low-confidence-menu",
      servedOn: "2026-09-04",
      importedAt: IMPORTED_AT,
      rawText: "主菜：神秘風味拼盤",
      provider: "test-ocr",
      model: "test-v1",
      isMock: false,
    },
  ]);
}

function confirmedMenu() {
  const draft = draftMenu();
  return confirmMenuVersion(draft, {
    reviewedBy: "六年一班學生小組",
    reviewedAt: REVIEWED_AT,
    notes: "已核對供餐公告。",
    acceptedLowConfidence: collectLowConfidenceAcceptances(draft),
  });
}

describe("智慧菜單匯入與來源優先序", () => {
  it("只接受 structured、csv、ocr、demo 四種來源", () => {
    expect(() =>
      menuImportInputSchema.parse({
        source: "photo",
        servedOn: "2026-09-04",
      }),
    ).toThrow();
  });

  it("多來源同時存在時以結構化資料為優先", () => {
    const selected = selectPreferredMenuInput([
      {
        source: "demo",
        servedOn: "2026-09-04",
        fingerprint: "plate-a",
      },
      {
        source: "ocr",
        servedOn: "2026-09-04",
        rawText: "主菜：滷雞腿",
        provider: "ocr-service",
        model: "ocr-v1",
        isMock: false,
      },
      structuredInput(),
    ]);
    expect(selected.source).toBe("structured");
  });

  it("CSV 優先於 OCR 與 Demo", () => {
    const selected = selectPreferredMenuInput([
      {
        source: "demo",
        servedOn: "2026-09-04",
        fingerprint: "plate-a",
      },
      {
        source: "ocr",
        servedOn: "2026-09-04",
        rawText: "主菜：滷雞腿",
        provider: "ocr-service",
        model: "ocr-v1",
        isMock: false,
      },
      {
        source: "csv",
        servedOn: "2026-09-04",
        csvText: "菜色名稱,角色\n糟米飯,主食",
      },
    ]);
    expect(selected.source).toBe("csv");
  });

  it("以草稿建立匯入結果，不會自動當成已確認", () => {
    const menu = draftMenu();
    expect(menu.status).toBe("draft");
    expect(menu.confirmation).toBeNull();
    expect(menu.sourceEvidence.source).toBe("structured");
  });

  it("可解析帶逗號的 CSV 引號欄位並保留解碼後菜名", () => {
    const menu = importMenuVersion([
      {
        source: "csv",
        menuId: "csv-menu",
        servedOn: "2026-09-04",
        importedAt: IMPORTED_AT,
        csvText:
          '菜色名稱,角色,類別,份量,食譜版本,供應商\n"番茄,炒蛋",主菜,蛋類,65,v2,業者甲',
      },
    ]);
    expect(menu.plannedDishes[0]).toMatchObject({
      rawName: "番茄,炒蛋",
      role: "main",
      category: "egg",
      portionG: 65,
      recipeVersion: "v2",
      vendorId: "業者甲",
    });
  });

  it("解析 OCR 角色前綴，同時保留完整原文與模型揭露", () => {
    const rawText =
      "臺北市校園午餐菜單\n主食：五穀飯\n主菜：滷雞腿\n副菜一：清炒高麗菜";
    const menu = importMenuVersion([
      {
        source: "ocr",
        menuId: "ocr-menu",
        servedOn: "2026-09-04",
        importedAt: IMPORTED_AT,
        rawText,
        provider: "school-ocr-adapter",
        model: "ocr-v2",
        isMock: false,
      },
    ]);
    expect(menu.sourceEvidence).toMatchObject({
      source: "ocr",
      provider: "school-ocr-adapter",
      model: "ocr-v2",
      isMock: false,
      rawContent: rawText,
    });
    expect(menu.plannedDishes.map((dish) => dish.role)).toEqual([
      "staple",
      "main",
      "side",
    ]);
  });
});

describe("菜名標準化與信心欄位", () => {
  it("完整保留原始菜名，另建立標準化值", () => {
    const dish = normalizeMenuDish(
      {
        rawName: "  清炒　高麗菜  ",
        portionG: 70,
        recipeVersion: "v1",
        vendorId: "vendor-a",
      },
      { source: "structured" },
    );
    expect(dish.rawName).toBe("  清炒　高麗菜  ");
    expect(dish.normalizedName).toBe("清炒高麗菜");
  });

  it.each([
    ["糟米飯", "rice"],
    ["蔬菜炒麵", "noodles"],
    ["滷雞腿", "meat"],
    ["番茄炒蛋", "egg"],
    ["清炒高麗菜", "vegetable"],
    ["芭樂", "fruit"],
  ] as const)("將「%s」標準化為 %s 類別", (rawName, category) => {
    const dish = normalizeMenuDish(
      {
        rawName,
        portionG: 70,
        recipeVersion: "v1",
        vendorId: "vendor-a",
      },
      { source: "structured" },
    );
    expect(dish.category).toBe(category);
  });

  it.each([
    ["清炒高麗菜", "stir-fried"],
    ["滷雞腿", "braised"],
    ["蒸南瓜", "steamed"],
    ["酥炸魚排", "deep-fried"],
    ["蘿蔔玉米湯", "soup"],
  ] as const)("將「%s」標準化為 %s 烹調法", (rawName, method) => {
    const dish = normalizeMenuDish(
      {
        rawName,
        portionG: 70,
        recipeVersion: "v1",
        vendorId: "vendor-a",
      },
      { source: "structured" },
    );
    expect(dish.cookingMethod).toBe(method);
  });

  it("從菜名提出多個主食材候選與對應類別", () => {
    const dish = normalizeMenuDish(
      {
        rawName: "咖哩雞肉馬鈴薯",
        portionG: 90,
        recipeVersion: "v4",
        vendorId: "vendor-a",
      },
      { source: "structured" },
    );
    expect(dish.primaryIngredientCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalName: "雞肉", category: "meat" }),
        expect.objectContaining({
          canonicalName: "馬鈴薯",
          category: "vegetable",
        }),
      ]),
    );
  });

  it("缺少份量、食譜版本、供應商或無法推斷時列為低信心", () => {
    const dish = normalizeMenuDish(
      { rawName: "特製風味餐點" },
      { source: "ocr" },
    );
    for (const field of dish.lowConfidenceFields) {
      expect(dish.confidenceByField[field]).toBeLessThan(
        LOW_CONFIDENCE_THRESHOLD,
      );
    }
    expect(dish.lowConfidenceFields).toEqual(
      expect.arrayContaining([
        "category",
        "cookingMethod",
        "primaryIngredientCandidates",
        "portionG",
        "recipeVersion",
        "vendorId",
      ]),
    );
  });

  it("結構化明示欄位不會被誤標為低信心", () => {
    const dish = normalizeMenuDish(
      {
        rawName: "風味雞丁",
        role: "main",
        category: "meat",
        cookingMethod: "stewed",
        primaryIngredients: ["雞肉"],
        portionG: 85,
        recipeVersion: "v3",
        vendorId: "vendor-a",
      },
      { source: "structured" },
    );
    expect(dish.lowConfidenceFields).toEqual([]);
  });
});

describe("deterministic Demo OCR", () => {
  it("相同 fingerprint 每次都產生完全相同的結果", () => {
    expect(createDeterministicDemoOcr("same-plate")).toEqual(
      createDeterministicDemoOcr("same-plate"),
    );
  });

  it("明確標示為 Mock，並揭露未呼叫真實模型", () => {
    const result = createDeterministicDemoOcr("judge-demo");
    expect(result).toMatchObject({
      source: "demo",
      provider: "foodlens-deterministic-demo-ocr",
      model: "fixture-v1",
      isMock: true,
    });
    expect(result.warnings.join(" ")).toContain("沒有呼叫真實 AI 模型");
  });

  it("Demo 菜單來源也保留 Mock 揭露", () => {
    const menu = importMenuVersion([
      {
        source: "demo",
        menuId: "demo-menu",
        servedOn: "2026-09-04",
        fingerprint: "judge-demo",
      },
    ]);
    expect(menu.sourceEvidence.isMock).toBe(true);
    expect(menu.sourceEvidence.rawContent).toContain("主食：");
    expect(menu.sourceEvidence.warnings.join(" ")).toContain("Mock OCR");
  });
});

describe("人工確認、候選標籤與實際替換", () => {
  it("草稿菜單不可提供餐盤辨識候選", () => {
    const menu = draftMenu();
    expect(getPlateCandidates(menu)).toEqual([]);
    expect(getPlateCandidateLabels(menu)).toEqual([]);
  });

  it("人工確認後才提供候選，並留下審核軌跡", () => {
    const menu = confirmedMenu();
    expect(menu.status).toBe("confirmed");
    expect(menu.confirmation).toMatchObject({
      reviewedBy: "六年一班學生小組",
      reviewedAt: REVIEWED_AT,
    });
    expect(getPlateCandidateLabels(menu)).toEqual(["咖哩雞丁", "清炒高麗菜"]);
  });

  it("不會把未明確接受的低信心欄位默認成人工已確認", () => {
    const draft = lowConfidenceDraft();
    expect(collectLowConfidenceAcceptances(draft).length).toBeGreaterThan(0);

    expect(() =>
      confirmMenuVersion(draft, {
        reviewedBy: "六年一班學生小組",
        reviewedAt: REVIEWED_AT,
        acceptedLowConfidence: [],
      }),
    ).toThrow("仍有未處理的低信心欄位");
  });

  it("明確接受清單必須完整對應目前菜色簽章與低信心欄位", () => {
    const draft = lowConfidenceDraft();
    const accepted = collectLowConfidenceAcceptances(draft);

    expect(() =>
      confirmMenuVersion(draft, {
        reviewedBy: "六年一班學生小組",
        reviewedAt: REVIEWED_AT,
        acceptedLowConfidence: accepted.map((item, index) =>
          index === 0 ? { ...item, fields: item.fields.slice(1) } : item,
        ),
      }),
    ).toThrow();
  });

  it("未確認時不允許記錄實際替換", () => {
    const menu = draftMenu();
    expect(() =>
      recordMenuSubstitution(menu, {
        plannedDishSignature: menu.plannedDishes[0].signature,
        actualDish: { rawName: "滷雞腿" },
        reason: "原食材缺貨",
        recordedBy: "團膳業者",
        recordedAt: REVIEWED_AT,
      }),
    ).toThrow("必須先經人工確認");
  });

  it("替換另存 actual，不覆蓋 planned，候選改用實際菜色", () => {
    const original = confirmedMenu();
    const planned = original.plannedDishes[0];
    const updated = recordMenuSubstitution(original, {
      plannedDishSignature: planned.signature,
      actualDish: { rawName: "滷雞腿" },
      reason: "原料未到貨，現場替換",
      recordedBy: "供餐業者甲",
      recordedAt: "2026-09-04T03:30:00.000Z",
    });

    expect(updated.plannedDishes[0]).toEqual(planned);
    expect(updated.substitutions[0]).toMatchObject({
      plannedDishSignature: planned.signature,
      actualDish: { rawName: "滷雞腿" },
    });
    expect(getActualMenuDishes(updated)[0].rawName).toBe("滷雞腿");
    expect(getPlateCandidates(updated)[0]).toMatchObject({
      label: "滷雞腿",
      basis: "substitution",
      plannedDishSignature: planned.signature,
    });
  });

  it("不允許替換不存在的原計畫菜色", () => {
    expect(() =>
      recordMenuSubstitution(confirmedMenu(), {
        plannedDishSignature: "missing-dish",
        actualDish: { rawName: "滷雞腿" },
        reason: "現場替換",
        recordedBy: "供餐業者甲",
        recordedAt: REVIEWED_AT,
      }),
    ).toThrow("找不到要替換的原計畫菜色");
  });

  it("不允許同一原計畫菜色重複替換", () => {
    const menu = confirmedMenu();
    const plannedDishSignature = menu.plannedDishes[0].signature;
    const once = recordMenuSubstitution(menu, {
      plannedDishSignature,
      actualDish: { rawName: "滷雞腿" },
      reason: "現場替換",
      recordedBy: "供餐業者甲",
      recordedAt: REVIEWED_AT,
    });
    expect(() =>
      recordMenuSubstitution(once, {
        plannedDishSignature,
        actualDish: { rawName: "烤雞腿" },
        reason: "再次替換",
        recordedBy: "供餐業者甲",
        recordedAt: "2026-09-04T05:30:00.000Z",
      }),
    ).toThrow("已有實際替換紀錄");
  });

  it("可撤回實際替換而不覆寫原計畫菜色", () => {
    const menu = confirmedMenu();
    const planned = menu.plannedDishes[0];
    const substituted = recordMenuSubstitution(menu, {
      plannedDishSignature: planned.signature,
      actualDish: { rawName: "滷雞腿" },
      reason: "現場替換",
      recordedBy: "供餐業者甲",
      recordedAt: REVIEWED_AT,
    });
    const restored = removeMenuSubstitution(substituted, planned.signature);

    expect(restored.substitutions).toEqual([]);
    expect(restored.plannedDishes[0]).toEqual(planned);
    expect(getActualMenuDishes(restored)[0]).toEqual(planned);
  });

  it("資料 schema 拒絕沒有審核紀錄的 confirmed 菜單", () => {
    const draft = draftMenu();
    expect(() =>
      menuVersionSchema.parse({ ...draft, status: "confirmed" }),
    ).toThrow();
  });

  it("人工修正草稿分類後保留原始菜名與原物件", () => {
    const draft = draftMenu();
    const before = draft.plannedDishes[0];
    const updated = updateDraftMenuDish(draft, {
      index: 0,
      category: "egg",
    });

    expect(updated.plannedDishes[0]).toMatchObject({
      rawName: before.rawName,
      category: "egg",
      confidenceByField: { category: 1 },
    });
    expect(draft.plannedDishes[0]).toEqual(before);
    expect(menuVersionSchema.parse(updated)).toEqual(updated);
  });

  it("人工可修正辨識菜名但原始 OCR 文字仍完整保留", () => {
    const draft = draftMenu();
    const before = draft.plannedDishes[0];
    const updated = updateDraftMenuDish(draft, {
      index: 0,
      normalizedName: "糙米飯",
    });

    expect(updated.plannedDishes[0].rawName).toBe(before.rawName);
    expect(updated.plannedDishes[0].normalizedName).toBe("糙米飯");
    expect(updated.plannedDishes[0].signature).not.toBe(before.signature);
    expect(draft.plannedDishes[0]).toEqual(before);
    expect(menuVersionSchema.parse(updated)).toEqual(updated);
  });

  it("角色、份量、食譜版本與供餐業者可逐項人工核對並更新信心", () => {
    const draft = lowConfidenceDraft();
    const updated = updateDraftMenuDish(draft, {
      index: 0,
      role: "other",
      portionG: null,
      recipeVersion: "unversioned",
      vendorId: "unassigned-vendor",
    });

    expect(updated.plannedDishes[0]).toMatchObject({
      role: "other",
      portionG: null,
      recipeVersion: "unversioned",
      vendorId: "unassigned-vendor",
      confidenceByField: {
        role: 1,
        portionG: 1,
        recipeVersion: 1,
        vendorId: 1,
      },
    });
    expect(updated.plannedDishes[0].lowConfidenceFields).not.toEqual(
      expect.arrayContaining(["role", "portionG", "recipeVersion", "vendorId"]),
    );
  });

  it("已確認菜單不可再以草稿修正 API 覆寫", () => {
    expect(() =>
      updateDraftMenuDish(confirmedMenu(), {
        index: 0,
        cookingMethod: "steamed",
      }),
    ).toThrow("已確認菜單不可直接改寫");
  });
});

describe("菜色簽章", () => {
  const base = {
    normalizedName: "咖哩雞丁",
    recipeVersion: "v1",
    portionG: 85,
    vendorId: "vendor-a",
  } as const;

  it("同名但食譜版本不同時簽章不同", () => {
    expect(createMenuDishSignature(base)).not.toBe(
      createMenuDishSignature({ ...base, recipeVersion: "v2" }),
    );
  });

  it("同名但每人份量不同時簽章不同", () => {
    expect(createMenuDishSignature(base)).not.toBe(
      createMenuDishSignature({ ...base, portionG: 95 }),
    );
  });

  it("同名但供應商不同時簽章不同", () => {
    expect(createMenuDishSignature(base)).not.toBe(
      createMenuDishSignature({ ...base, vendorId: "vendor-b" }),
    );
  });
});
