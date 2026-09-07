import { z } from "zod";
import { menuDishRoleSchema } from "@/lib/menu-intelligence";
import { FOOD_CATEGORIES, type AiAnalysisV1 } from "@/lib/types";

export const MAX_FOOD_ANALYSIS_MENU_CANDIDATES = 30;

const unsafeCandidateTextPattern =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function candidateTextSchema(maximumCharacters: number) {
  return z
    .string()
    .max(maximumCharacters)
    .refine(
      (value) => !unsafeCandidateTextPattern.test(value),
      "菜單候選不可包含控制或雙向文字控制字元",
    )
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(maximumCharacters));
}

/**
 * Only the minimum reviewed-menu fields required to help classify a plate may
 * cross the AI boundary. Database ids, vendor ids, recipe versions, portions,
 * confidence and signatures deliberately stay out of the request.
 */
export const foodAnalysisMenuCandidateSchema = z
  .object({
    label: candidateTextSchema(80),
    rawName: candidateTextSchema(160),
    category: z.enum(FOOD_CATEGORIES),
    role: menuDishRoleSchema,
    basis: z.enum(["planned", "substitution"]),
  })
  .strict();

export const foodAnalysisMenuCandidatesSchema = z
  .array(foodAnalysisMenuCandidateSchema)
  .max(MAX_FOOD_ANALYSIS_MENU_CANDIDATES);

export type FoodAnalysisMenuCandidate = z.infer<
  typeof foodAnalysisMenuCandidateSchema
>;

export interface FoodAnalysisInput {
  fingerprint: string;
  image?: Blob;
  menuCandidates?: readonly FoodAnalysisMenuCandidate[];
}

const detectionSchema = z
  .object({
    category: z.enum(FOOD_CATEGORIES),
    label: z.string().trim().min(1).max(30),
    originalG: z.number().int().min(1).max(1000),
    remainingRatio: z.number().min(0).max(1),
    remainingG: z.number().int().min(0).max(1000),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((value, context) => {
    const calculated = Math.round(value.originalG * value.remainingRatio);
    if (Math.abs(value.remainingG - calculated) > 1) {
      context.addIssue({
        code: "custom",
        path: ["remainingG"],
        message: "剩餘重量必須符合原始份量 × 剩餘比例",
      });
    }
  });

export const aiAnalysisSchema = z.object({
  schemaVersion: z.literal("1"),
  provider: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
  isMock: z.boolean(),
  detections: z.array(detectionSchema).min(1).max(12),
  warnings: z.array(z.string().max(200)).max(8),
  analyzedAt: z.string().min(1),
});

export interface FoodAnalysisProvider {
  readonly id: string;
  analyze(input: FoodAnalysisInput): Promise<AiAnalysisV1>;
}

export class ServerFoodAnalysisProvider implements FoodAnalysisProvider {
  readonly id = "foodlens-server-adapter";
  async analyze({ image, menuCandidates }: FoodAnalysisInput) {
    if (!image) throw new Error("找不到可分析的餐盤影像");
    const safeCandidates = foodAnalysisMenuCandidatesSchema.parse(
      menuCandidates ?? [],
    );
    const formData = new FormData();
    formData.append(
      "image",
      new File([image], "plate.webp", {
        type: image.type || "image/webp",
      }),
    );
    formData.append("menuCandidates", JSON.stringify(safeCandidates));
    const headers: Record<string, string> = {};
    if (typeof window !== "undefined") {
      const storedKey = window.localStorage.getItem("foodlens_gemini_api_key");
      if (storedKey) headers["x-gemini-api-key"] = storedKey.trim();
    }
    const response = await fetch("/api/ai/analyze", {
      method: "POST",
      headers,
      body: formData,
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "真實模型分析失敗";
      const requestId =
        typeof payload === "object" &&
        payload !== null &&
        "requestId" in payload &&
        typeof payload.requestId === "string"
          ? payload.requestId
          : response.headers.get("X-Request-ID");
      throw new Error(
        requestId ? `${message}（追蹤碼 ${requestId.slice(0, 8)}）` : message,
      );
    }
    return aiAnalysisSchema.parse(payload);
  }
}

export function createManualFoodAnalysis(input: {
  staple: string;
  mainDish: string;
  sideDishes: string[];
}): AiAnalysisV1 {
  const stapleIsNoodles = /麵|麵|粉/.test(input.staple);
  const mainIsEgg =
    /蛋/.test(input.mainDish) && !/肉|雞|豬|牛|魚/.test(input.mainDish);
  const side = input.sideDishes[0]?.trim() || "配菜";
  return aiAnalysisSchema.parse({
    schemaVersion: "1",
    provider: "human-manual",
    model: "manual-entry-v1",
    isMock: false,
    detections: [
      {
        category: stapleIsNoodles ? "noodles" : "rice",
        label: input.staple.trim() || (stapleIsNoodles ? "麵類" : "白飯"),
        originalG: stapleIsNoodles ? 150 : 120,
        remainingRatio: 0,
        remainingG: 0,
        confidence: 0,
      },
      {
        category: mainIsEgg ? "egg" : "meat",
        label: input.mainDish.trim() || "主菜",
        originalG: mainIsEgg ? 55 : 75,
        remainingRatio: 0,
        remainingG: 0,
        confidence: 0,
      },
      {
        category: "vegetable",
        label: side,
        originalG: 80,
        remainingRatio: 0,
        remainingG: 0,
        confidence: 0,
      },
    ],
    warnings: [
      "這是學生人工建立的起始項目，沒有 AI 模型輸出；所有類型、份量與比例都需逐項確認。",
    ],
    analyzedAt: new Date().toISOString(),
  });
}

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

const fixtures = [
  [
    {
      category: "rice" as const,
      label: "白飯",
      originalG: 120,
      remainingRatio: 0.34,
      confidence: 0.92,
    },
    {
      category: "vegetable" as const,
      label: "青花菜",
      originalG: 80,
      remainingRatio: 0.58,
      confidence: 0.86,
    },
    {
      category: "meat" as const,
      label: "咖哩雞肉",
      originalG: 75,
      remainingRatio: 0.12,
      confidence: 0.81,
    },
  ],
  [
    {
      category: "vegetable" as const,
      label: "青菜",
      originalG: 80,
      remainingRatio: 0.49,
      confidence: 0.89,
    },
    {
      category: "meat" as const,
      label: "滷雞肉",
      originalG: 75,
      remainingRatio: 0.18,
      confidence: 0.87,
    },
    {
      category: "fruit" as const,
      label: "柳橙",
      originalG: 70,
      remainingRatio: 0.23,
      confidence: 0.78,
    },
  ],
  [
    {
      category: "noodles" as const,
      label: "麵類",
      originalG: 150,
      remainingRatio: 0.24,
      confidence: 0.91,
    },
    {
      category: "egg" as const,
      label: "滷蛋",
      originalG: 55,
      remainingRatio: 0.15,
      confidence: 0.88,
    },
    {
      category: "vegetable" as const,
      label: "高麗菜",
      originalG: 80,
      remainingRatio: 0.41,
      confidence: 0.84,
    },
  ],
];

type FixtureDetection = (typeof fixtures)[number][number];

function expectedRolesForFixture(item: FixtureDetection) {
  switch (item.category) {
    case "rice":
    case "noodles":
      return ["staple"] as const;
    case "meat":
    case "egg":
      return ["main"] as const;
    case "vegetable":
      return ["side"] as const;
    case "fruit":
      return ["fruit"] as const;
    default:
      return ["other", "side"] as const;
  }
}

function detectionLabel(value: string) {
  const characters = Array.from(value.trim());
  return characters.length <= 30
    ? characters.join("")
    : `${characters.slice(0, 29).join("")}…`;
}

/**
 * Prefer an unused same-category item. A same-role candidate is the second
 * choice and keeps its reviewed category. When no defensible match exists the
 * fixed fixture stays intact instead of forcing the photograph into a menu.
 */
function applyMenuCandidatesToFixture(
  fixture: readonly FixtureDetection[],
  candidates: readonly FoodAnalysisMenuCandidate[],
) {
  const usedCandidateIndexes = new Set<number>();
  return fixture.map((item) => {
    let candidateIndex = candidates.findIndex(
      (candidate, index) =>
        !usedCandidateIndexes.has(index) &&
        candidate.category === item.category,
    );
    if (candidateIndex < 0) {
      const expectedRoles = expectedRolesForFixture(item);
      candidateIndex = candidates.findIndex(
        (candidate, index) =>
          !usedCandidateIndexes.has(index) &&
          expectedRoles.some((role) => role === candidate.role),
      );
    }
    if (candidateIndex < 0) return item;
    usedCandidateIndexes.add(candidateIndex);
    const candidate = candidates[candidateIndex];
    return {
      ...item,
      category: candidate.category,
      label: detectionLabel(candidate.label),
    };
  });
}

export class MockFoodAnalysisProvider implements FoodAnalysisProvider {
  readonly id = "foodlens-mock";
  private readonly simulatedLatencyMs: number;

  constructor(options: { simulatedLatencyMs?: number } = {}) {
    this.simulatedLatencyMs = Math.max(0, options.simulatedLatencyMs ?? 900);
  }

  async analyze({
    fingerprint,
    menuCandidates,
  }: FoodAnalysisInput): Promise<AiAnalysisV1> {
    const safeCandidates = foodAnalysisMenuCandidatesSchema.parse(
      menuCandidates ?? [],
    );
    if (this.simulatedLatencyMs > 0)
      await new Promise((resolve) =>
        setTimeout(resolve, this.simulatedLatencyMs),
      );
    const lower = fingerprint.toLowerCase();
    const fixtureIndex = lower.includes("curry")
      ? 0
      : lower.includes("greens")
        ? 1
        : lower.includes("noodles")
          ? 2
          : hash(fingerprint) % fixtures.length;
    const detections = applyMenuCandidatesToFixture(
      fixtures[fixtureIndex],
      safeCandidates,
    );
    return aiAnalysisSchema.parse({
      schemaVersion: "1",
      provider: this.id,
      model: "deterministic-v1",
      isMock: true,
      detections: detections.map((item) => ({
        ...item,
        remainingG: Math.round(item.originalG * item.remainingRatio),
      })),
      warnings: [
        safeCandidates.length > 0
          ? `Mock 未讀取照片；固定比例情境優先套用 ${safeCandidates.length} 道上游菜單候選的名稱與類別，候選不是辨識答案。`
          : "Mock 未讀取照片，也未使用已確認菜單候選；結果來自固定比例情境。",
        "重量為標準原始份量 × 示範比例，並非秤重或影像模型結果。",
      ],
      analyzedAt: new Date().toISOString(),
    });
  }
}
