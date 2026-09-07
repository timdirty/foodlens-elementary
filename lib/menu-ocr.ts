import { z } from "zod";
import { createDeterministicDemoOcr } from "@/lib/menu-intelligence";

export const MENU_OCR_ANALYSIS_MODES = ["mock", "real"] as const;
export const menuOcrAnalysisModeSchema = z.enum(MENU_OCR_ANALYSIS_MODES);
export type MenuOcrAnalysisMode = z.infer<typeof menuOcrAnalysisModeSchema>;

export const menuOcrAnalysisSchema = z
  .object({
    schemaVersion: z.literal("1"),
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    isMock: z.boolean(),
    rawText: z.string().trim().min(1).max(50_000),
    extractedLines: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
    warnings: z.array(z.string().trim().min(1).max(240)).max(12),
    analyzedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((analysis, context) => {
    if (
      analysis.isMock &&
      !analysis.warnings.some((warning) => /Mock|示範/.test(warning))
    ) {
      context.addIssue({
        code: "custom",
        path: ["warnings"],
        message: "Mock OCR 必須在警示中明確揭露為示範結果",
      });
    }
  });
export type MenuOcrAnalysis = z.infer<typeof menuOcrAnalysisSchema>;

export type MenuOcrAnalyzeInput = {
  fingerprint: string;
  image?: Blob;
};

export function menuPhotoSourceName(input: {
  isMock: boolean;
  isAiGenerated: boolean;
}) {
  if (!input.isMock) return "校園菜單照片／真實 AI OCR";
  return input.isAiGenerated
    ? "AI 生成示範照片／Mock OCR"
    : "使用者照片／Mock 固定輸出（未讀取照片）";
}

/** Model-independent boundary used by both deterministic Demo and server AI. */
export interface MenuOcrProvider {
  readonly id: string;
  analyze(input: MenuOcrAnalyzeInput): Promise<MenuOcrAnalysis>;
}

const GENERATED_MENU_DEMO_LINES = [
  "主食：糙米飯",
  "主菜：醬燒雞腿",
  "副菜一：清炒高麗菜",
  "副菜二：玉米蛋",
  "水果：芭樂",
] as const;

export class MockMenuOcrProvider implements MenuOcrProvider {
  readonly id = "foodlens-deterministic-demo-ocr";

  async analyze({ fingerprint }: MenuOcrAnalyzeInput) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (fingerprint.startsWith("ai-generated-menu-sheet:sha256:")) {
      return menuOcrAnalysisSchema.parse({
        schemaVersion: "1",
        provider: this.id,
        model: "fixture-v1",
        isMock: true,
        rawText: [
          "FoodLens AI 生成示範菜單·2026/10/16",
          ...GENERATED_MENU_DEMO_LINES,
        ].join("\n"),
        extractedLines: GENERATED_MENU_DEMO_LINES,
        warnings: [
          "這張圖與輸出都是配對的 Mock 示範，不代表真實 OCR 準確率。",
          "Mock 只以內容指紋選擇固定範例，不會讀取照片文字。",
        ],
        analyzedAt: "2026-10-16T04:00:00.000Z",
      });
    }
    const result = createDeterministicDemoOcr(fingerprint);
    return menuOcrAnalysisSchema.parse({
      schemaVersion: "1",
      provider: result.provider,
      model: result.model,
      isMock: true,
      rawText: result.rawText,
      extractedLines: result.extractedLines,
      warnings: [
        ...result.warnings,
        "Mock 只以檔案指紋選擇固定範例，不會讀取照片內容。",
      ],
      analyzedAt: result.generatedAt,
    });
  }
}

export class ServerMenuOcrProvider implements MenuOcrProvider {
  readonly id = "foodlens-menu-server-adapter";

  async analyze({ image }: MenuOcrAnalyzeInput) {
    if (!image) throw new Error("找不到可分析的菜單影像");
    const formData = new FormData();
    formData.append(
      "image",
      new File([image], "menu.webp", {
        type: image.type || "image/webp",
      }),
    );
    const response = await fetch("/api/ai/menu-analyze", {
      method: "POST",
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
          : "真實菜單 OCR 分析失敗";
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
    return menuOcrAnalysisSchema.parse(payload);
  }
}
