import { z } from "zod";
import {
  FOOD_CATEGORIES,
  type FoodCategory,
  type MealPeriod,
} from "@/lib/types";

/**
 * 智慧菜單 domain v1
 *
 * 這個模組刻意不處理 UI 或資料庫：它只負責把來自各種來源的菜單，
 * 轉成可稽核、可人工確認的結構化資料。原始菜名永遠保留，
 * 標準化值不會回寫覆蓋原始輸入。
 */

export const MENU_IMPORT_SOURCES = [
  "structured",
  "csv",
  "ocr",
  "demo",
] as const;
export const menuImportSourceSchema = z.enum(MENU_IMPORT_SOURCES);
export type MenuImportSource = z.infer<typeof menuImportSourceSchema>;

export const MENU_VERSION_STATUSES = ["draft", "confirmed"] as const;
export const menuVersionStatusSchema = z.enum(MENU_VERSION_STATUSES);
export type MenuVersionStatus = z.infer<typeof menuVersionStatusSchema>;

export const MENU_DISH_ROLES = [
  "staple",
  "main",
  "side",
  "soup",
  "fruit",
  "other",
] as const;
export const menuDishRoleSchema = z.enum(MENU_DISH_ROLES);
export type MenuDishRole = z.infer<typeof menuDishRoleSchema>;

export const COOKING_METHODS = [
  "steamed",
  "boiled",
  "braised",
  "stewed",
  "stir-fried",
  "pan-fried",
  "deep-fried",
  "baked",
  "cold-mixed",
  "soup",
  "raw",
  "unknown",
] as const;
export const cookingMethodSchema = z.enum(COOKING_METHODS);
export type CookingMethod = z.infer<typeof cookingMethodSchema>;

export const MENU_LOW_CONFIDENCE_FIELDS = [
  "rawName",
  "role",
  "category",
  "cookingMethod",
  "primaryIngredientCandidates",
  "portionG",
  "recipeVersion",
  "vendorId",
] as const;
export const menuConfidenceFieldSchema = z.enum(MENU_LOW_CONFIDENCE_FIELDS);
export type MenuConfidenceField = z.infer<typeof menuConfidenceFieldSchema>;

export const LOW_CONFIDENCE_THRESHOLD = 0.7;
// URL encoding can expand one CJK character to nine ASCII characters. Keep the
// complete deterministic signature while bounding every source field itself.
export const MENU_DISH_SIGNATURE_MAX = 3_600;

const nonBlankPreservedString = z
  .string()
  .max(160)
  .refine((value) => value.trim().length > 0, "不可為空白");
const compactTextSchema = z.string().trim().min(1).max(160);
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "必須是 YYYY-MM-DD 日期");
const isoDateTimeSchema = z.string().datetime({ offset: true });
const confidenceSchema = z.number().min(0).max(1);

export const ingredientCandidateSchema = z
  .object({
    canonicalName: compactTextSchema,
    matchedText: compactTextSchema,
    category: z.enum(FOOD_CATEGORIES),
    confidence: confidenceSchema,
  })
  .strict();
export type IngredientCandidate = z.infer<typeof ingredientCandidateSchema>;

export const menuConfidenceByFieldSchema = z
  .object({
    rawName: confidenceSchema,
    role: confidenceSchema,
    category: confidenceSchema,
    cookingMethod: confidenceSchema,
    primaryIngredientCandidates: confidenceSchema,
    portionG: confidenceSchema,
    recipeVersion: confidenceSchema,
    vendorId: confidenceSchema,
  })
  .strict();
export type MenuConfidenceByField = z.infer<typeof menuConfidenceByFieldSchema>;

export const menuDishImportRowSchema = z
  .object({
    /** 原始輸入必須逐字保留，所以這裡不使用 trim transform。 */
    rawName: nonBlankPreservedString,
    role: menuDishRoleSchema.optional(),
    category: z.enum(FOOD_CATEGORIES).optional(),
    cookingMethod: cookingMethodSchema.optional(),
    primaryIngredients: z.array(compactTextSchema).max(8).optional(),
    portionG: z.number().int().positive().max(3_000).optional(),
    recipeVersion: compactTextSchema.max(80).optional(),
    vendorId: compactTextSchema.max(120).optional(),
  })
  .strict();
export type MenuDishImportRow = z.infer<typeof menuDishImportRowSchema>;

export const normalizedMenuDishSchema = z
  .object({
    rawName: nonBlankPreservedString,
    normalizedName: compactTextSchema,
    role: menuDishRoleSchema,
    category: z.enum(FOOD_CATEGORIES),
    cookingMethod: cookingMethodSchema,
    primaryIngredientCandidates: z.array(ingredientCandidateSchema).max(8),
    portionG: z.number().int().positive().max(3_000).nullable(),
    recipeVersion: compactTextSchema.max(80),
    vendorId: compactTextSchema.max(120),
    confidenceByField: menuConfidenceByFieldSchema,
    lowConfidenceFields: z.array(menuConfidenceFieldSchema),
    signature: z.string().min(1).max(MENU_DISH_SIGNATURE_MAX),
  })
  .strict()
  .superRefine((dish, context) => {
    const expectedLowConfidenceFields = MENU_LOW_CONFIDENCE_FIELDS.filter(
      (field) => dish.confidenceByField[field] < LOW_CONFIDENCE_THRESHOLD,
    );
    if (
      expectedLowConfidenceFields.length !== dish.lowConfidenceFields.length ||
      expectedLowConfidenceFields.some(
        (field, index) => dish.lowConfidenceFields[index] !== field,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["lowConfidenceFields"],
        message: "低信心欄位必須與各欄位信心值一致",
      });
    }
    if (dish.signature !== createMenuDishSignature(dish)) {
      context.addIssue({
        code: "custom",
        path: ["signature"],
        message: "菜色簽章與標準名、食譜版本、份量或供應商不符",
      });
    }
  });
export type NormalizedMenuDish = z.infer<typeof normalizedMenuDishSchema>;

const commonImportFields = {
  menuId: compactTextSchema.max(120).optional(),
  servedOn: isoDateSchema,
  mealPeriod: z.literal("lunch").default("lunch"),
  importedAt: isoDateTimeSchema.optional(),
  vendorId: compactTextSchema.max(120).optional(),
  sourceName: compactTextSchema.max(160).optional(),
};

export const structuredMenuImportSchema = z
  .object({
    ...commonImportFields,
    source: z.literal("structured"),
    dishes: z.array(menuDishImportRowSchema).min(1).max(30),
  })
  .strict();
export type StructuredMenuImport = z.infer<typeof structuredMenuImportSchema>;

export const csvMenuImportSchema = z
  .object({
    ...commonImportFields,
    source: z.literal("csv"),
    csvText: z.string().min(1).max(200_000),
  })
  .strict();
export type CsvMenuImport = z.infer<typeof csvMenuImportSchema>;

export const ocrMenuImportSchema = z
  .object({
    ...commonImportFields,
    source: z.literal("ocr"),
    rawText: z.string().min(1).max(50_000),
    provider: compactTextSchema.max(80),
    model: compactTextSchema.max(120),
    isMock: z.boolean(),
    warnings: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
  })
  .strict();
export type OcrMenuImport = z.infer<typeof ocrMenuImportSchema>;

export const demoMenuImportSchema = z
  .object({
    ...commonImportFields,
    source: z.literal("demo"),
    fingerprint: z.string().min(1).max(240).default("foodlens-demo-menu"),
  })
  .strict();
export type DemoMenuImport = z.infer<typeof demoMenuImportSchema>;

export const menuImportInputSchema = z.discriminatedUnion("source", [
  structuredMenuImportSchema,
  csvMenuImportSchema,
  ocrMenuImportSchema,
  demoMenuImportSchema,
]);
export type MenuImportInput = z.infer<typeof menuImportInputSchema>;

export const menuSourceEvidenceSchema = z
  .object({
    source: menuImportSourceSchema,
    sourceName: z.string().max(160).nullable(),
    provider: compactTextSchema.max(80),
    model: compactTextSchema.max(120),
    isMock: z.boolean(),
    rawContent: z.string().max(200_000).nullable(),
    selectedFrom: z.array(menuImportSourceSchema).min(1),
    warnings: z.array(z.string().trim().min(1).max(240)).max(20),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.source === "demo" && !evidence.isMock) {
      context.addIssue({
        code: "custom",
        path: ["isMock"],
        message: "Demo OCR 必須標示 isMock: true",
      });
    }
  });
export type MenuSourceEvidence = z.infer<typeof menuSourceEvidenceSchema>;

export const acceptedLowConfidenceSchema = z
  .object({
    dishSignature: z.string().min(1).max(MENU_DISH_SIGNATURE_MAX),
    fields: z.array(menuConfidenceFieldSchema).min(1),
  })
  .strict()
  .superRefine((acceptance, context) => {
    if (new Set(acceptance.fields).size !== acceptance.fields.length) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "同一低信心欄位不可重複接受",
      });
    }
  });
export type AcceptedLowConfidence = z.infer<typeof acceptedLowConfidenceSchema>;

export const menuConfirmationSchema = z
  .object({
    reviewedBy: compactTextSchema.max(120),
    reviewedAt: isoDateTimeSchema,
    notes: z.string().trim().max(500).default(""),
    acceptedLowConfidence: z.array(acceptedLowConfidenceSchema),
  })
  .strict();
export type MenuConfirmation = z.infer<typeof menuConfirmationSchema>;

export const menuSubstitutionSchema = z
  .object({
    plannedDishSignature: z.string().min(1).max(MENU_DISH_SIGNATURE_MAX),
    actualDish: normalizedMenuDishSchema,
    reason: z.string().trim().min(1).max(300),
    recordedBy: compactTextSchema.max(120),
    recordedAt: isoDateTimeSchema,
  })
  .strict();
export type MenuSubstitution = z.infer<typeof menuSubstitutionSchema>;

export const menuVersionSchema = z
  .object({
    schemaVersion: z.literal("1"),
    id: compactTextSchema.max(120),
    servedOn: isoDateSchema,
    mealPeriod: z.literal("lunch"),
    status: menuVersionStatusSchema,
    sourceEvidence: menuSourceEvidenceSchema,
    plannedDishes: z.array(normalizedMenuDishSchema).min(1).max(30),
    substitutions: z.array(menuSubstitutionSchema).max(30),
    importedAt: isoDateTimeSchema,
    confirmation: menuConfirmationSchema.nullable(),
    signature: z.string().min(1).max(160),
  })
  .strict()
  .superRefine((menu, context) => {
    if (menu.status === "confirmed" && !menu.confirmation) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "已確認菜單必須保留人工審核紀錄",
      });
    }
    if (menu.status === "draft" && menu.confirmation) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "草稿菜單不能帶有確認紀錄",
      });
    }
    if (menu.status === "draft" && menu.substitutions.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["substitutions"],
        message: "菜單確認後才能記錄實際替換",
      });
    }

    if (menu.status === "confirmed" && menu.confirmation) {
      const expected = new Map(
        menu.plannedDishes
          .filter((dish) => dish.lowConfidenceFields.length > 0)
          .map((dish) => [dish.signature, dish.lowConfidenceFields] as const),
      );
      const acceptedSignatures = new Set<string>();

      menu.confirmation.acceptedLowConfidence.forEach((acceptance, index) => {
        const expectedFields = expected.get(acceptance.dishSignature);
        if (!expectedFields) {
          context.addIssue({
            code: "custom",
            path: ["confirmation", "acceptedLowConfidence", index],
            message: "低信心接受紀錄已失效或不屬於目前菜單",
          });
          return;
        }
        if (acceptedSignatures.has(acceptance.dishSignature)) {
          context.addIssue({
            code: "custom",
            path: ["confirmation", "acceptedLowConfidence", index],
            message: "同一道菜只能有一筆低信心接受紀錄",
          });
        }
        acceptedSignatures.add(acceptance.dishSignature);
        const acceptedFields = new Set(acceptance.fields);
        if (
          acceptedFields.size !== expectedFields.length ||
          expectedFields.some((field) => !acceptedFields.has(field))
        ) {
          context.addIssue({
            code: "custom",
            path: ["confirmation", "acceptedLowConfidence", index, "fields"],
            message: "人工接受欄位必須完整對應目前仍存在的低信心欄位",
          });
        }
      });

      expected.forEach((_fields, signature) => {
        if (!acceptedSignatures.has(signature)) {
          context.addIssue({
            code: "custom",
            path: ["confirmation", "acceptedLowConfidence"],
            message: "仍有低信心欄位未經人工明確接受",
          });
        }
      });
    }

    const plannedSignatures = menu.plannedDishes.map((dish) => dish.signature);
    if (new Set(plannedSignatures).size !== plannedSignatures.length) {
      context.addIssue({
        code: "custom",
        path: ["plannedDishes"],
        message: "同一版菜單不可包含重複菜色簽章",
      });
    }

    const substituted = new Set<string>();
    menu.substitutions.forEach((substitution, index) => {
      if (!plannedSignatures.includes(substitution.plannedDishSignature)) {
        context.addIssue({
          code: "custom",
          path: ["substitutions", index, "plannedDishSignature"],
          message: "找不到對應的原計畫菜色",
        });
      }
      if (substituted.has(substitution.plannedDishSignature)) {
        context.addIssue({
          code: "custom",
          path: ["substitutions", index, "plannedDishSignature"],
          message: "同一原計畫菜色只能記錄一次實際替換",
        });
      }
      substituted.add(substitution.plannedDishSignature);
      if (
        substitution.actualDish.signature === substitution.plannedDishSignature
      ) {
        context.addIssue({
          code: "custom",
          path: ["substitutions", index, "actualDish", "signature"],
          message: "實際菜色與原計畫相同，不需建立替換紀錄",
        });
      }
    });

    if (menu.signature !== createMenuVersionSignature(menu)) {
      context.addIssue({
        code: "custom",
        path: ["signature"],
        message: "菜單版本簽章與日期、菜色或替換紀錄不符",
      });
    }
  });
export type MenuVersion = z.infer<typeof menuVersionSchema>;

export const confirmMenuCommandSchema = z
  .object({
    reviewedBy: compactTextSchema.max(120),
    reviewedAt: isoDateTimeSchema,
    notes: z.string().trim().max(500).optional(),
    acceptedLowConfidence: z.array(acceptedLowConfidenceSchema),
  })
  .strict();
export type ConfirmMenuCommand = z.infer<typeof confirmMenuCommandSchema>;

export const updateDraftMenuDishCommandSchema = z
  .object({
    index: z.number().int().min(0),
    normalizedName: compactTextSchema.optional(),
    role: menuDishRoleSchema.optional(),
    category: z.enum(FOOD_CATEGORIES).optional(),
    cookingMethod: cookingMethodSchema.optional(),
    portionG: z.number().int().positive().max(3_000).nullable().optional(),
    recipeVersion: compactTextSchema.max(80).optional(),
    vendorId: compactTextSchema.max(120).optional(),
  })
  .strict()
  .refine(
    (command) =>
      command.normalizedName !== undefined ||
      command.role !== undefined ||
      command.category !== undefined ||
      command.cookingMethod !== undefined ||
      command.portionG !== undefined ||
      command.recipeVersion !== undefined ||
      command.vendorId !== undefined,
    "至少需要修正一個欄位",
  );
export type UpdateDraftMenuDishCommand = z.infer<
  typeof updateDraftMenuDishCommandSchema
>;

export const recordMenuSubstitutionCommandSchema = z
  .object({
    plannedDishSignature: z.string().min(1).max(MENU_DISH_SIGNATURE_MAX),
    actualDish: menuDishImportRowSchema,
    reason: z.string().trim().min(1).max(300),
    recordedBy: compactTextSchema.max(120),
    recordedAt: isoDateTimeSchema,
  })
  .strict();
export type RecordMenuSubstitutionCommand = z.infer<
  typeof recordMenuSubstitutionCommandSchema
>;

export const plateCandidateSchema = z
  .object({
    label: compactTextSchema,
    rawName: nonBlankPreservedString,
    category: z.enum(FOOD_CATEGORIES),
    role: menuDishRoleSchema,
    dishSignature: z.string().min(1).max(MENU_DISH_SIGNATURE_MAX),
    basis: z.enum(["planned", "substitution"]),
    plannedDishSignature: z.string().min(1).max(MENU_DISH_SIGNATURE_MAX),
  })
  .strict();
export type PlateCandidate = z.infer<typeof plateCandidateSchema>;

export const deterministicDemoOcrSchema = z
  .object({
    schemaVersion: z.literal("1"),
    source: z.literal("demo"),
    fingerprint: z.string().min(1),
    provider: z.literal("foodlens-deterministic-demo-ocr"),
    model: z.literal("fixture-v1"),
    isMock: z.literal(true),
    generatedAt: z.literal("2026-01-05T04:00:00.000Z"),
    rawText: z.string().min(1),
    extractedLines: z.array(z.string().min(1)).min(1),
    warnings: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type DeterministicDemoOcr = z.infer<typeof deterministicDemoOcrSchema>;

export const MENU_SOURCE_PRIORITY: Readonly<Record<MenuImportSource, number>> =
  {
    structured: 4,
    csv: 3,
    ocr: 2,
    demo: 1,
  };

const SOURCE_FIELD_CONFIDENCE: Readonly<Record<MenuImportSource, number>> = {
  structured: 1,
  csv: 0.96,
  ocr: 0.82,
  demo: 0.82,
};

const ROLE_ALIASES: Readonly<Record<string, MenuDishRole>> = {
  主食: "staple",
  staple: "staple",
  主菜: "main",
  main: "main",
  副菜: "side",
  配菜: "side",
  side: "side",
  湯: "soup",
  湯品: "soup",
  soup: "soup",
  水果: "fruit",
  fruit: "fruit",
  其他: "other",
  other: "other",
};

const CATEGORY_ALIASES: Readonly<Record<string, FoodCategory>> = {
  白飯: "rice",
  米食: "rice",
  飯: "rice",
  rice: "rice",
  麵類: "noodles",
  麵食: "noodles",
  noodles: "noodles",
  肉類: "meat",
  肉: "meat",
  meat: "meat",
  蔬菜: "vegetable",
  蔬菜類: "vegetable",
  vegetable: "vegetable",
  蛋: "egg",
  蛋類: "egg",
  egg: "egg",
  水果: "fruit",
  水果類: "fruit",
  fruit: "fruit",
  其他: "other",
  other: "other",
};

const COOKING_METHOD_ALIASES: Readonly<Record<string, CookingMethod>> = {
  清蒸: "steamed",
  蒸: "steamed",
  steamed: "steamed",
  水煮: "boiled",
  煮: "boiled",
  boiled: "boiled",
  紅燒: "braised",
  滷: "braised",
  braised: "braised",
  燉: "stewed",
  燴: "stewed",
  燴煮: "stewed",
  stewed: "stewed",
  清炒: "stir-fried",
  炒: "stir-fried",
  "stir-fried": "stir-fried",
  煎: "pan-fried",
  "pan-fried": "pan-fried",
  油炸: "deep-fried",
  炸: "deep-fried",
  "deep-fried": "deep-fried",
  烤: "baked",
  焗: "baked",
  baked: "baked",
  涼拌: "cold-mixed",
  "cold-mixed": "cold-mixed",
  湯: "soup",
  soup: "soup",
  生食: "raw",
  raw: "raw",
  未知: "unknown",
  unknown: "unknown",
};

type IngredientRule = {
  canonicalName: string;
  category: FoodCategory;
  aliases: readonly string[];
};

const INGREDIENT_RULES: readonly IngredientRule[] = [
  {
    canonicalName: "米",
    category: "rice",
    aliases: ["糟米", "白米", "米飯", "飯", "粥"],
  },
  {
    canonicalName: "麵",
    category: "noodles",
    aliases: ["麵條", "意麵", "油麵", "麵"],
  },
  { canonicalName: "米粉", category: "noodles", aliases: ["米粉"] },
  {
    canonicalName: "雞肉",
    category: "meat",
    aliases: ["雞腿", "雞丁", "雞肉", "雞"],
  },
  {
    canonicalName: "豬肉",
    category: "meat",
    aliases: ["排骨", "豬肉", "肉燥", "豬"],
  },
  { canonicalName: "牛肉", category: "meat", aliases: ["牛肉", "牛腩", "牛"] },
  { canonicalName: "魚", category: "meat", aliases: ["魚排", "魚片", "魚"] },
  { canonicalName: "蝦", category: "meat", aliases: ["蝦仁", "蝦"] },
  {
    canonicalName: "蛋",
    category: "egg",
    aliases: ["雞蛋", "滷蛋", "炒蛋", "蛋"],
  },
  {
    canonicalName: "豆腐",
    category: "other",
    aliases: ["豆腐", "豆乾", "豆干"],
  },
  {
    canonicalName: "高麗菜",
    category: "vegetable",
    aliases: ["高麗菜", "甘藍"],
  },
  {
    canonicalName: "花椰菜",
    category: "vegetable",
    aliases: ["青花菜", "綠花椰", "花椰菜"],
  },
  {
    canonicalName: "葉菜",
    category: "vegetable",
    aliases: ["青江菜", "菠菜", "小白菜", "青菜", "時蔬"],
  },
  {
    canonicalName: "胡蘿蔔",
    category: "vegetable",
    aliases: ["胡蘿蔔", "紅蘿蔔"],
  },
  {
    canonicalName: "白蘿蔔",
    category: "vegetable",
    aliases: ["白蘿蔔", "蘿蔔"],
  },
  {
    canonicalName: "馬鈴薯",
    category: "vegetable",
    aliases: ["馬鈴薯", "洋芋"],
  },
  { canonicalName: "番茄", category: "vegetable", aliases: ["番茄", "蕃茄"] },
  {
    canonicalName: "菇類",
    category: "vegetable",
    aliases: ["香菇", "鴻喜菇", "金針菇", "菇"],
  },
  { canonicalName: "玉米", category: "vegetable", aliases: ["玉米"] },
  { canonicalName: "南瓜", category: "vegetable", aliases: ["南瓜"] },
  { canonicalName: "蘋果", category: "fruit", aliases: ["蘋果"] },
  { canonicalName: "芭樂", category: "fruit", aliases: ["芭樂", "番石榴"] },
  { canonicalName: "香蕉", category: "fruit", aliases: ["香蕉"] },
  {
    canonicalName: "柳橙",
    category: "fruit",
    aliases: ["柳橙", "橘子", "柑橘"],
  },
  { canonicalName: "鳳梨", category: "fruit", aliases: ["鳳梨"] },
  { canonicalName: "西瓜", category: "fruit", aliases: ["西瓜"] },
] as const;

const DEMO_OCR_FIXTURES = [
  [
    "FoodLens AI 生成示範菜單",
    "主食：糟米飯",
    "主菜：咖哩雞丁",
    "副菜一：清炒高麗菜",
    "副菜二：紅燒豆腐",
    "水果：芭樂",
  ],
  [
    "FoodLens AI 生成示範菜單",
    "主食：五穀飯",
    "主菜：紅燒魚片",
    "副菜一：蒜炒青江菜",
    "副菜二：番茄炒蛋",
    "湯品：蘿蔔玉米湯",
  ],
  [
    "FoodLens AI 生成示範菜單",
    "主食：蔬菜炒麵",
    "主菜：滷雞腿",
    "副菜一：涼拌花椰菜",
    "副菜二：蒸南瓜",
    "水果：柳橙",
  ],
] as const;

export type NormalizeMenuDishOptions = {
  source: MenuImportSource;
  defaultRole?: MenuDishRole;
  defaultPortionG?: number | null;
  defaultRecipeVersion?: string;
  defaultVendorId?: string;
};

type CsvExtraction = {
  dishes: MenuDishImportRow[];
  warnings: string[];
};

type OcrExtraction = {
  dishes: MenuDishImportRow[];
  warnings: string[];
};

function normalizeComparableText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，,。．.、；;]+$/g, "");
}

function normalizeIdentifier(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-Hant-TW");
}

function encodeSignaturePart(value: string | number | null) {
  return encodeURIComponent(value === null ? "\u2400" : String(value));
}

/**
 * 簽章不只看菜名。同名菜色只要食譜版本、每人份量或供應商不同，
 * 就會得到不同簽章，避免將不同批次當成同一個資料點。
 */
export function createMenuDishSignature(input: {
  normalizedName: string;
  recipeVersion: string;
  portionG: number | null;
  vendorId: string;
}) {
  return [
    "menu-dish-v1",
    normalizeIdentifier(input.normalizedName),
    normalizeIdentifier(input.recipeVersion),
    input.portionG,
    normalizeIdentifier(input.vendorId),
  ]
    .map(encodeSignaturePart)
    .join("|");
}

function fnv1a(text: string) {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16_777_619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

function createMenuVersionSignature(input: {
  id: string;
  servedOn: string;
  mealPeriod: MealPeriod;
  plannedDishes: readonly Pick<NormalizedMenuDish, "signature">[];
  substitutions: readonly Pick<
    MenuSubstitution,
    "plannedDishSignature" | "actualDish"
  >[];
}) {
  const auditText = JSON.stringify({
    schemaVersion: "1",
    id: input.id,
    servedOn: input.servedOn,
    mealPeriod: input.mealPeriod,
    planned: input.plannedDishes.map((dish) => dish.signature),
    actual: input.substitutions.map((substitution) => [
      substitution.plannedDishSignature,
      substitution.actualDish.signature,
    ]),
  });
  return `menu-version-v1-${fnv1a(auditText)}`;
}

function inferCategory(name: string): {
  value: FoodCategory;
  confidence: number;
} {
  const rules: readonly [FoodCategory, RegExp][] = [
    ["noodles", /麵|麺|米粉|冬粉|河粉|粿條/],
    ["rice", /飯|粥|米糕|糟米|白米/],
    ["meat", /雞|豬|牛|魚|蝦|肉|排骨|鴨/],
    ["egg", /蛋/],
    ["fruit", /芭樂|蘋果|柳橙|橘子|香蕉|鳳梨|西瓜|水果|番石榴/],
    [
      "vegetable",
      /高麗菜|甘藍|花椰|青江菜|菠菜|小白菜|青菜|蔬菜|時蔬|菇|蘿蔔|玉米|南瓜|番茄|蕃茄|馬鈴薯|洋芋|絲瓜|冬瓜|瓜/,
    ],
  ];
  const match = rules.find(([, pattern]) => pattern.test(name));
  return match
    ? { value: match[0], confidence: 0.86 }
    : { value: "other", confidence: 0.42 };
}

function inferCookingMethod(name: string): {
  value: CookingMethod;
  confidence: number;
} {
  const rules: readonly [CookingMethod, RegExp][] = [
    ["deep-fried", /酥炸|油炸|香酥|炸/],
    ["cold-mixed", /涼拌|涼拌/],
    ["stir-fried", /炒/],
    ["steamed", /清蒸|蒸/],
    ["braised", /紅燒|滷/],
    ["stewed", /咖哩|燉|燴|燴/],
    ["pan-fried", /香煎|煎/],
    ["baked", /焗|烤/],
    ["boiled", /水煮|汆|煮/],
    ["soup", /湯|羹/],
    ["raw", /生菜|鮮果|生食/],
  ];
  const match = rules.find(([, pattern]) => pattern.test(name));
  return match
    ? { value: match[0], confidence: 0.84 }
    : { value: "unknown", confidence: 0.35 };
}

function inferRole(
  category: FoodCategory,
  cookingMethod: CookingMethod,
): { value: MenuDishRole; confidence: number } {
  if (category === "rice" || category === "noodles") {
    return { value: "staple", confidence: 0.82 };
  }
  if (category === "fruit") return { value: "fruit", confidence: 0.92 };
  if (cookingMethod === "soup") return { value: "soup", confidence: 0.88 };
  if (category === "meat" || category === "egg") {
    return { value: "main", confidence: 0.8 };
  }
  if (category === "vegetable") return { value: "side", confidence: 0.78 };
  return { value: "other", confidence: 0.45 };
}

function findIngredientCandidates(
  name: string,
  explicit: readonly string[] | undefined,
  explicitConfidence: number,
): IngredientCandidate[] {
  if (explicit && explicit.length > 0) {
    return explicit.slice(0, 8).map((ingredient) => {
      const comparable = normalizeComparableText(ingredient);
      const rule = INGREDIENT_RULES.find((candidate) =>
        candidate.aliases.some(
          (alias) => normalizeComparableText(alias) === comparable,
        ),
      );
      return ingredientCandidateSchema.parse({
        canonicalName: rule?.canonicalName ?? ingredient.trim(),
        matchedText: ingredient.trim(),
        category: rule?.category ?? "other",
        confidence: explicitConfidence,
      });
    });
  }

  const candidates: IngredientCandidate[] = [];
  const usedCanonicalNames = new Set<string>();
  for (const rule of INGREDIENT_RULES) {
    const matchedAlias = [...rule.aliases]
      .sort((left, right) => right.length - left.length)
      .find((alias) => name.includes(alias));
    if (!matchedAlias || usedCanonicalNames.has(rule.canonicalName)) continue;
    usedCanonicalNames.add(rule.canonicalName);
    candidates.push({
      canonicalName: rule.canonicalName,
      matchedText: matchedAlias,
      category: rule.category,
      confidence: matchedAlias.length >= 2 ? 0.88 : 0.76,
    });
  }
  return candidates
    .slice(0, 8)
    .map((candidate) => ingredientCandidateSchema.parse(candidate));
}

function buildLowConfidenceFields(confidenceByField: MenuConfidenceByField) {
  return MENU_LOW_CONFIDENCE_FIELDS.filter(
    (field) => confidenceByField[field] < LOW_CONFIDENCE_THRESHOLD,
  );
}

/** 把一筆原始菜色轉成可稽核的標準化菜色。 */
export function normalizeMenuDish(
  rawInput: MenuDishImportRow,
  options: NormalizeMenuDishOptions,
): NormalizedMenuDish {
  const input = menuDishImportRowSchema.parse(rawInput);
  const sourceConfidence = SOURCE_FIELD_CONFIDENCE[options.source];
  const normalizedName = normalizeComparableText(input.rawName);
  const inferredCategory = inferCategory(normalizedName);
  const inferredCookingMethod = inferCookingMethod(normalizedName);
  const category = input.category ?? inferredCategory.value;
  const cookingMethod = input.cookingMethod ?? inferredCookingMethod.value;
  const inferredRole = inferRole(category, cookingMethod);
  const role = input.role ?? options.defaultRole ?? inferredRole.value;
  const portionG = input.portionG ?? options.defaultPortionG ?? null;
  const recipeVersion =
    input.recipeVersion ?? options.defaultRecipeVersion ?? "unversioned";
  const vendorId =
    input.vendorId ?? options.defaultVendorId ?? "unassigned-vendor";
  const candidates = findIngredientCandidates(
    normalizedName,
    input.primaryIngredients,
    sourceConfidence,
  );

  const confidenceByField: MenuConfidenceByField = {
    rawName: sourceConfidence,
    role: input.role
      ? sourceConfidence
      : options.defaultRole
        ? 0.9
        : inferredRole.confidence,
    category: input.category ? sourceConfidence : inferredCategory.confidence,
    cookingMethod: input.cookingMethod
      ? sourceConfidence
      : inferredCookingMethod.confidence,
    primaryIngredientCandidates: input.primaryIngredients?.length
      ? sourceConfidence
      : candidates.length > 0
        ? Math.max(...candidates.map((candidate) => candidate.confidence))
        : 0.35,
    portionG: input.portionG
      ? sourceConfidence
      : options.defaultPortionG
        ? 0.9
        : 0,
    recipeVersion: input.recipeVersion
      ? sourceConfidence
      : options.defaultRecipeVersion
        ? 0.9
        : 0.25,
    vendorId: input.vendorId
      ? sourceConfidence
      : options.defaultVendorId
        ? 0.9
        : 0.2,
  };

  const signature = createMenuDishSignature({
    normalizedName,
    recipeVersion,
    portionG,
    vendorId,
  });

  return normalizedMenuDishSchema.parse({
    rawName: input.rawName,
    normalizedName,
    role,
    category,
    cookingMethod,
    primaryIngredientCandidates: candidates,
    portionG,
    recipeVersion,
    vendorId,
    confidenceByField,
    lowConfidenceFields: buildLowConfidenceFields(confidenceByField),
    signature,
  });
}

function stableHashNumber(text: string) {
  return Number.parseInt(fnv1a(text), 16) >>> 0;
}

/**
 * 產生可重現的 Demo OCR 結果。這裡只選取內建 fixture，
 * 不會上傳圖片，也不會呼叫任何真實模型。
 */
export function createDeterministicDemoOcr(
  fingerprint = "foodlens-demo-menu",
): DeterministicDemoOcr {
  const fixture =
    DEMO_OCR_FIXTURES[stableHashNumber(fingerprint) % DEMO_OCR_FIXTURES.length];
  return deterministicDemoOcrSchema.parse({
    schemaVersion: "1",
    source: "demo",
    fingerprint,
    provider: "foodlens-deterministic-demo-ocr",
    model: "fixture-v1",
    isMock: true,
    generatedAt: "2026-01-05T04:00:00.000Z",
    rawText: fixture.join("\n"),
    extractedLines: fixture.slice(1),
    warnings: ["這是內建、可重現的 Mock OCR 結果，沒有呼叫真實 AI 模型。"],
  });
}

function parseCsvRecords(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  if (quoted) throw new Error("CSV 存在未關閉的引號");
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-Hant-TW")
    .replace(/[\s_\-()（）]/g, "");
}

const CSV_HEADERS = {
  rawName: ["菜色名稱", "菜色", "菜名", "rawname", "name", "dish"],
  role: ["菜色角色", "角色", "role"],
  category: ["食物類別", "食物分類", "類別", "category"],
  cookingMethod: ["烹調法", "烹調方式", "cookingmethod", "method"],
  primaryIngredients: ["主要食材", "主食材", "ingredients", "ingredient"],
  portionG: ["每人份量g", "每人份量", "份量g", "份量", "portiong"],
  recipeVersion: ["食譜版本", "recipeversion", "version"],
  vendorId: ["供餐業者", "供應商", "vendorid", "vendor"],
} as const;

function findHeaderIndex(
  headers: readonly string[],
  aliases: readonly string[],
) {
  return headers.findIndex((header) => aliases.includes(header));
}

function readCsvCell(row: readonly string[], index: number) {
  return index < 0 ? "" : (row[index] ?? "").trim();
}

function mapRole(value: string): MenuDishRole | undefined {
  if (!value) return undefined;
  const normalized = normalizeComparableText(value).replace(
    /[一二三四五六七八九\d]+$/g,
    "",
  );
  return ROLE_ALIASES[normalized.toLocaleLowerCase("zh-Hant-TW")];
}

function mapCategory(value: string): FoodCategory | undefined {
  if (!value) return undefined;
  return CATEGORY_ALIASES[
    normalizeComparableText(value).toLocaleLowerCase("zh-Hant-TW")
  ];
}

function mapCookingMethod(value: string): CookingMethod | undefined {
  if (!value) return undefined;
  return COOKING_METHOD_ALIASES[
    normalizeComparableText(value).toLocaleLowerCase("zh-Hant-TW")
  ];
}

function extractCsvDishes(csvText: string): CsvExtraction {
  const records = parseCsvRecords(csvText);
  if (records.length < 2) throw new Error("CSV 必須包含標題列與至少一筆菜色");
  const headers = records[0].map(normalizeHeader);
  const indexes = {
    rawName: findHeaderIndex(headers, CSV_HEADERS.rawName),
    role: findHeaderIndex(headers, CSV_HEADERS.role),
    category: findHeaderIndex(headers, CSV_HEADERS.category),
    cookingMethod: findHeaderIndex(headers, CSV_HEADERS.cookingMethod),
    primaryIngredients: findHeaderIndex(
      headers,
      CSV_HEADERS.primaryIngredients,
    ),
    portionG: findHeaderIndex(headers, CSV_HEADERS.portionG),
    recipeVersion: findHeaderIndex(headers, CSV_HEADERS.recipeVersion),
    vendorId: findHeaderIndex(headers, CSV_HEADERS.vendorId),
  };
  if (indexes.rawName < 0) {
    throw new Error("CSV 找不到「菜色名稱」欄位");
  }

  const warnings: string[] = [];
  const dishes = records.slice(1).flatMap((record, rowIndex) => {
    // CSV 解碼後的原始菜名不去除內部或前後空白。
    const rawName = indexes.rawName < 0 ? "" : (record[indexes.rawName] ?? "");
    if (!rawName.trim()) return [];

    const rawRole = readCsvCell(record, indexes.role);
    const rawCategory = readCsvCell(record, indexes.category);
    const rawCookingMethod = readCsvCell(record, indexes.cookingMethod);
    const rawIngredients = readCsvCell(record, indexes.primaryIngredients);
    const rawPortion = readCsvCell(record, indexes.portionG);
    const role = mapRole(rawRole);
    const category = mapCategory(rawCategory);
    const cookingMethod = mapCookingMethod(rawCookingMethod);

    if (rawRole && !role)
      warnings.push(
        `CSV 第 ${rowIndex + 2} 列角色無法標準化，已改用菜名推論。`,
      );
    if (rawCategory && !category)
      warnings.push(
        `CSV 第 ${rowIndex + 2} 列類別無法標準化，已改用菜名推論。`,
      );
    if (rawCookingMethod && !cookingMethod)
      warnings.push(
        `CSV 第 ${rowIndex + 2} 列烹調法無法標準化，已改用菜名推論。`,
      );

    let portionG: number | undefined;
    if (rawPortion) {
      const parsed = Number(rawPortion.replace(/\s*g$/i, ""));
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 3_000) {
        portionG = parsed;
      } else {
        warnings.push(`CSV 第 ${rowIndex + 2} 列份量無效，已留待人工確認。`);
      }
    }

    return [
      menuDishImportRowSchema.parse({
        rawName,
        ...(role ? { role } : {}),
        ...(category ? { category } : {}),
        ...(cookingMethod ? { cookingMethod } : {}),
        ...(rawIngredients
          ? {
              primaryIngredients: rawIngredients
                .split(/[|;/、；]/)
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : {}),
        ...(portionG ? { portionG } : {}),
        ...(readCsvCell(record, indexes.recipeVersion)
          ? { recipeVersion: readCsvCell(record, indexes.recipeVersion) }
          : {}),
        ...(readCsvCell(record, indexes.vendorId)
          ? { vendorId: readCsvCell(record, indexes.vendorId) }
          : {}),
      }),
    ];
  });

  if (dishes.length === 0) throw new Error("CSV 沒有可匯入的菜色資料");
  return { dishes, warnings };
}

function extractOcrDishes(rawText: string): OcrExtraction {
  const warnings: string[] = [];
  const dishes: MenuDishImportRow[] = [];
  const rolePattern =
    /^(?:[\-*•·]\s*)?(主食|主菜|副菜(?:[一二三四五六七八九\d]+)?|配菜(?:[一二三四五六七八九\d]+)?|湯品?|水果|其他)\s*(?:[:：\-] ?|\s+)\s*(.+)$/;

  for (const sourceLine of rawText.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;
    if (/菜單|餐點|日期|AI\s*生成示範/i.test(line)) continue;
    if (/^\d{3,4}[\-/年]\d{1,2}/.test(line)) continue;

    const match = line.match(rolePattern);
    if (match) {
      const role = mapRole(match[1]);
      const rawName = match[2];
      if (role && rawName.trim()) {
        dishes.push(menuDishImportRowSchema.parse({ rawName, role }));
      }
      continue;
    }

    const cleaned = line.replace(/^(?:[\-*•·]|\d+[.)、])\s*/, "");
    if (cleaned.length >= 2 && cleaned.length <= 160) {
      dishes.push(menuDishImportRowSchema.parse({ rawName: cleaned }));
      warnings.push(`「${cleaned}」沒有角色標記，已留待人工確認。`);
    }
  }

  if (dishes.length === 0) throw new Error("OCR 文字中找不到可辨識的菜色");
  return { dishes, warnings };
}

/** 來源優先序：結構化 > CSV > OCR > Demo。同層級保留傳入順序。 */
export function selectPreferredMenuInput(
  rawInputs: readonly unknown[],
): MenuImportInput {
  if (rawInputs.length === 0) throw new Error("至少需要一個菜單來源");
  const inputs = rawInputs.map((input) => menuImportInputSchema.parse(input));
  return inputs.reduce((preferred, candidate) =>
    MENU_SOURCE_PRIORITY[candidate.source] >
    MENU_SOURCE_PRIORITY[preferred.source]
      ? candidate
      : preferred,
  );
}

function deriveImportedAt(input: MenuImportInput) {
  if (input.importedAt) return input.importedAt;
  if (input.source === "demo") return "2026-01-05T04:00:00.000Z";
  return new Date().toISOString();
}

function deriveMenuId(input: MenuImportInput) {
  return input.menuId ?? `menu-${input.servedOn}-${input.mealPeriod}`;
}

/**
 * 匯入後永遠先是 draft。即使是結構化來源，也不會跳過人工確認。
 */
export function importMenuVersion(rawInputs: readonly unknown[]): MenuVersion {
  const input = selectPreferredMenuInput(rawInputs);
  let rows: MenuDishImportRow[];
  let warnings: string[] = [];
  let rawContent: string | null = null;
  let provider: string;
  let model: string;
  let isMock: boolean;

  if (input.source === "structured") {
    rows = input.dishes;
    provider = "structured-import";
    model = "foodlens-menu-schema-v1";
    isMock = false;
  } else if (input.source === "csv") {
    const extraction = extractCsvDishes(input.csvText);
    rows = extraction.dishes;
    warnings = extraction.warnings;
    rawContent = input.csvText;
    provider = "csv-parser";
    model = "foodlens-csv-v1";
    isMock = false;
  } else if (input.source === "ocr") {
    const extraction = extractOcrDishes(input.rawText);
    rows = extraction.dishes;
    warnings = [...(input.warnings ?? []), ...extraction.warnings];
    rawContent = input.rawText;
    provider = input.provider;
    model = input.model;
    isMock = input.isMock;
  } else {
    const result = createDeterministicDemoOcr(input.fingerprint);
    const extraction = extractOcrDishes(result.rawText);
    rows = extraction.dishes;
    warnings = [...result.warnings, ...extraction.warnings];
    rawContent = result.rawText;
    provider = result.provider;
    model = result.model;
    isMock = result.isMock;
  }

  const plannedDishes = rows.map((row) =>
    normalizeMenuDish(row, {
      source: input.source,
      defaultVendorId: input.vendorId,
    }),
  );
  const id = deriveMenuId(input);
  const substitutions: MenuSubstitution[] = [];
  const base = {
    schemaVersion: "1" as const,
    id,
    servedOn: input.servedOn,
    mealPeriod: input.mealPeriod,
    status: "draft" as const,
    sourceEvidence: {
      source: input.source,
      sourceName: input.sourceName ?? null,
      provider,
      model,
      isMock,
      rawContent,
      selectedFrom: rawInputs.map(
        (candidate) => menuImportInputSchema.parse(candidate).source,
      ),
      warnings: warnings.slice(0, 20),
    },
    plannedDishes,
    substitutions,
    importedAt: deriveImportedAt(input),
    confirmation: null,
  };

  return menuVersionSchema.parse({
    ...base,
    signature: createMenuVersionSignature(base),
  });
}

/**
 * 學生在確認前修正標準化欄位。原始菜名不變；有信心欄位的修正值改為 1，
 * 並重新計算菜色與菜單簽章，避免 UI 直接竄改稽核資料。
 */
export function updateDraftMenuDish(
  rawMenu: MenuVersion,
  rawCommand: UpdateDraftMenuDishCommand,
): MenuVersion {
  const menu = menuVersionSchema.parse(rawMenu);
  const command = updateDraftMenuDishCommandSchema.parse(rawCommand);
  if (menu.status !== "draft") throw new Error("已確認菜單不可直接改寫");
  const current = menu.plannedDishes[command.index];
  if (!current) throw new Error("找不到要修正的菜色");

  const confidenceByField = {
    ...current.confidenceByField,
    ...(command.role !== undefined ? { role: 1 } : {}),
    ...(command.category !== undefined ? { category: 1 } : {}),
    ...(command.cookingMethod !== undefined ? { cookingMethod: 1 } : {}),
    ...(command.portionG !== undefined ? { portionG: 1 } : {}),
    ...(command.recipeVersion !== undefined ? { recipeVersion: 1 } : {}),
    ...(command.vendorId !== undefined ? { vendorId: 1 } : {}),
  };
  const nextDishBase = {
    ...current,
    ...(command.normalizedName !== undefined
      ? { normalizedName: command.normalizedName }
      : {}),
    ...(command.role !== undefined ? { role: command.role } : {}),
    ...(command.category !== undefined ? { category: command.category } : {}),
    ...(command.cookingMethod !== undefined
      ? { cookingMethod: command.cookingMethod }
      : {}),
    ...(command.portionG !== undefined ? { portionG: command.portionG } : {}),
    ...(command.recipeVersion !== undefined
      ? { recipeVersion: command.recipeVersion }
      : {}),
    ...(command.vendorId !== undefined ? { vendorId: command.vendorId } : {}),
    confidenceByField,
    lowConfidenceFields: MENU_LOW_CONFIDENCE_FIELDS.filter(
      (field) => confidenceByField[field] < LOW_CONFIDENCE_THRESHOLD,
    ),
  };
  const nextDish = normalizedMenuDishSchema.parse({
    ...nextDishBase,
    signature: createMenuDishSignature(nextDishBase),
  });
  const plannedDishes = menu.plannedDishes.map((dish, index) =>
    index === command.index ? nextDish : dish,
  );
  const next = { ...menu, plannedDishes };
  return menuVersionSchema.parse({
    ...next,
    signature: createMenuVersionSignature(next),
  });
}

/** 建立低信心欄位清單；呼叫端仍須在人工核對後主動交回確認命令。 */
export function collectLowConfidenceAcceptances(
  rawMenu: MenuVersion,
): AcceptedLowConfidence[] {
  const menu = menuVersionSchema.parse(rawMenu);
  return menu.plannedDishes
    .filter((dish) => dish.lowConfidenceFields.length > 0)
    .map((dish) => ({
      dishSignature: dish.signature,
      fields: [...dish.lowConfidenceFields],
    }));
}

/** 人工確認時，只保存呼叫端明確傳入且完整涵蓋的低信心接受紀錄。 */
export function confirmMenuVersion(
  rawMenu: MenuVersion,
  rawCommand: ConfirmMenuCommand,
): MenuVersion {
  const menu = menuVersionSchema.parse(rawMenu);
  const command = confirmMenuCommandSchema.parse(rawCommand);
  if (menu.status !== "draft") throw new Error("這份菜單已經確認");

  const expectedBySignature = new Map(
    collectLowConfidenceAcceptances(menu).map((acceptance) => [
      acceptance.dishSignature,
      new Set(acceptance.fields),
    ]),
  );
  const providedBySignature = new Map<string, Set<MenuConfidenceField>>();
  for (const acceptance of command.acceptedLowConfidence) {
    if (providedBySignature.has(acceptance.dishSignature)) {
      throw new Error("同一道菜只能有一筆低信心接受紀錄");
    }
    providedBySignature.set(
      acceptance.dishSignature,
      new Set(acceptance.fields),
    );
  }
  const acceptanceIsExact =
    providedBySignature.size === expectedBySignature.size &&
    [...expectedBySignature].every(([signature, expectedFields]) => {
      const providedFields = providedBySignature.get(signature);
      return (
        providedFields?.size === expectedFields.size &&
        [...expectedFields].every((field) => providedFields.has(field))
      );
    });
  if (!acceptanceIsExact) {
    throw new Error(
      "仍有未處理的低信心欄位；請逐道核對，並明確接受仍未知的欄位。",
    );
  }

  const next = {
    ...menu,
    status: "confirmed" as const,
    confirmation: {
      reviewedBy: command.reviewedBy,
      reviewedAt: command.reviewedAt,
      notes: command.notes ?? "",
      acceptedLowConfidence: command.acceptedLowConfidence,
    },
  };
  return menuVersionSchema.parse(next);
}

/**
 * 記錄「原計畫」與「實際供應」的差異，而不修改原菜單。
 * 這讓剩食資料可以連回當天真正吃到的菜色。
 */
export function recordMenuSubstitution(
  rawMenu: MenuVersion,
  rawCommand: RecordMenuSubstitutionCommand,
): MenuVersion {
  const menu = menuVersionSchema.parse(rawMenu);
  const command = recordMenuSubstitutionCommandSchema.parse(rawCommand);
  if (menu.status !== "confirmed") {
    throw new Error("菜單必須先經人工確認，才能記錄實際替換");
  }
  const planned = menu.plannedDishes.find(
    (dish) => dish.signature === command.plannedDishSignature,
  );
  if (!planned) throw new Error("找不到要替換的原計畫菜色");
  if (
    menu.substitutions.some(
      (substitution) =>
        substitution.plannedDishSignature === command.plannedDishSignature,
    )
  ) {
    throw new Error("這道原計畫菜色已有實際替換紀錄");
  }

  const actualDish = normalizeMenuDish(command.actualDish, {
    source: "structured",
    defaultRole: planned.role,
    defaultPortionG: planned.portionG,
    defaultRecipeVersion: planned.recipeVersion,
    defaultVendorId: planned.vendorId,
  });
  if (actualDish.signature === planned.signature) {
    throw new Error("實際菜色與原計畫相同，不需建立替換紀錄");
  }

  const substitutions = [
    ...menu.substitutions,
    {
      plannedDishSignature: planned.signature,
      actualDish,
      reason: command.reason,
      recordedBy: command.recordedBy,
      recordedAt: command.recordedAt,
    },
  ];
  const next = { ...menu, substitutions };
  return menuVersionSchema.parse({
    ...next,
    signature: createMenuVersionSignature(next),
  });
}

/** 移除一筆現場換菜紀錄時，原計畫仍原封不動並重新計算版本簽章。 */
export function removeMenuSubstitution(
  rawMenu: MenuVersion,
  plannedDishSignature: string,
): MenuVersion {
  const menu = menuVersionSchema.parse(rawMenu);
  if (menu.status !== "confirmed") throw new Error("菜單必須先經人工確認");
  if (
    !menu.substitutions.some(
      (item) => item.plannedDishSignature === plannedDishSignature,
    )
  )
    return menu;
  const next = {
    ...menu,
    substitutions: menu.substitutions.filter(
      (item) => item.plannedDishSignature !== plannedDishSignature,
    ),
  };
  return menuVersionSchema.parse({
    ...next,
    signature: createMenuVersionSignature(next),
  });
}

/** 回傳當天實際供應的菜色，沒有替換時才使用原計畫。 */
export function getActualMenuDishes(rawMenu: MenuVersion) {
  const menu = menuVersionSchema.parse(rawMenu);
  const replacements = new Map(
    menu.substitutions.map((substitution) => [
      substitution.plannedDishSignature,
      substitution.actualDish,
    ]),
  );
  return menu.plannedDishes.map(
    (planned) => replacements.get(planned.signature) ?? planned,
  );
}

/** 未確認菜單回傳空陣列，不會暗中影響餐盤 AI 候選。 */
export function getPlateCandidates(rawMenu: MenuVersion): PlateCandidate[] {
  const menu = menuVersionSchema.parse(rawMenu);
  if (menu.status !== "confirmed") return [];
  const substitutions = new Map(
    menu.substitutions.map((substitution) => [
      substitution.plannedDishSignature,
      substitution.actualDish,
    ]),
  );
  return menu.plannedDishes.map((planned) => {
    const actual = substitutions.get(planned.signature);
    const dish = actual ?? planned;
    return plateCandidateSchema.parse({
      label: dish.normalizedName,
      rawName: dish.rawName,
      category: dish.category,
      role: dish.role,
      dishSignature: dish.signature,
      basis: actual ? "substitution" : "planned",
      plannedDishSignature: planned.signature,
    });
  });
}

export function getPlateCandidateLabels(rawMenu: MenuVersion) {
  return [
    ...new Set(getPlateCandidates(rawMenu).map((candidate) => candidate.label)),
  ];
}
