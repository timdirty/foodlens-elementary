import { afterEach, describe, expect, it, vi } from "vitest";
import { isProcessedFoodLensImage, prepareMenuImage } from "@/lib/image";
import { importMenuVersion } from "@/lib/menu-intelligence";
import {
  menuOcrAnalysisSchema,
  menuPhotoSourceName,
  MockMenuOcrProvider,
  ServerMenuOcrProvider,
} from "@/lib/menu-ocr";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("智慧菜單照片 provider abstraction", () => {
  it("相同圖片指紋會產生相同的明示 Mock OCR 草稿", async () => {
    vi.useFakeTimers();
    const provider = new MockMenuOcrProvider();
    const firstPromise = provider.analyze({ fingerprint: "menu-photo-a:1200" });
    const secondPromise = provider.analyze({
      fingerprint: "menu-photo-a:1200",
    });
    await vi.runAllTimersAsync();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      provider: "foodlens-deterministic-demo-ocr",
      model: "fixture-v1",
      isMock: true,
    });
    expect(first.warnings.join(" ")).toContain("不會讀取照片內容");
  });

  it("Mock OCR 結果匯入後仍是需人工確認的草稿", async () => {
    vi.useFakeTimers();
    const pending = new MockMenuOcrProvider().analyze({
      fingerprint: "generated-demo-menu",
    });
    await vi.runAllTimersAsync();
    const analysis = await pending;
    const menu = importMenuVersion([
      {
        source: "ocr",
        menuId: "menu-photo-test",
        servedOn: "2026-10-16",
        importedAt: "2026-10-16T04:00:00.000Z",
        rawText: analysis.rawText,
        provider: analysis.provider,
        model: analysis.model,
        isMock: analysis.isMock,
        warnings: analysis.warnings,
      },
    ]);

    expect(menu.status).toBe("draft");
    expect(menu.confirmation).toBeNull();
    expect(menu.sourceEvidence).toMatchObject({
      source: "ocr",
      provider: "foodlens-deterministic-demo-ocr",
      isMock: true,
    });
    expect(menu.sourceEvidence.warnings.join(" ")).toContain(
      "不會讀取照片內容",
    );
  });

  it("AI 生成菜單照片的配對 Mock 草稿與圖上示範菜色一致", async () => {
    vi.useFakeTimers();
    const pending = new MockMenuOcrProvider().analyze({
      fingerprint: `ai-generated-menu-sheet:sha256:${"a".repeat(64)}`,
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.extractedLines).toEqual([
      "主食：糙米飯",
      "主菜：醬燒雞腿",
      "副菜一：清炒高麗菜",
      "副菜二：玉米蛋",
      "水果：芭樂",
    ]);
    expect(result.warnings.join(" ")).toContain("不代表真實 OCR 準確率");
  });

  it("拒絕未揭露的 Mock 結果與過多菜色行", () => {
    const base = {
      schemaVersion: "1" as const,
      provider: "test-provider",
      model: "test-model",
      isMock: true,
      rawText: "主菜：滋味雞腿",
      extractedLines: ["主菜：滋味雞腿"],
      warnings: ["需要再檢查"],
      analyzedAt: "2026-10-16T04:00:00.000Z",
    };
    expect(() => menuOcrAnalysisSchema.parse(base)).toThrow(/Mock OCR/);
    expect(() =>
      menuOcrAnalysisSchema.parse({
        ...base,
        warnings: ["Mock 示範"],
        extractedLines: Array.from(
          { length: 31 },
          (_, index) => `副菜${index + 1}：示範菜`,
        ),
      }),
    ).toThrow();
  });

  it("真實 provider 只送往伺服器 route 並驗證回傳 schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: "1",
          provider: "school-model",
          model: "vision-menu-v1",
          isMock: false,
          rawText: "主食：糙米飯\n主菜：醬燒雞腿",
          extractedLines: ["主食：糙米飯", "主菜：醬燒雞腿"],
          warnings: [],
          analyzedAt: "2026-10-16T04:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ServerMenuOcrProvider().analyze({
      fingerprint: "uploaded-menu",
      image: new Blob(["menu"], { type: "image/webp" }),
    });

    expect(result.isMock).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/ai/menu-analyze");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
  });

  it("真實 provider 失敗時保留追蹤碼，不產生 Mock 結果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "真實菜單 OCR 暫時無法連線",
            requestId: "87654321-aaaa-bbbb-cccc-123456789abc",
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      new ServerMenuOcrProvider().analyze({
        fingerprint: "uploaded-menu",
        image: new Blob(["menu"], { type: "image/webp" }),
      }),
    ).rejects.toThrow("真實菜單 OCR 暫時無法連線（追蹤碼 87654321）");
  });

  it("依照片來源與辨識模式留下不混淆的證據名稱", () => {
    expect(menuPhotoSourceName({ isMock: true, isAiGenerated: true })).toBe(
      "AI 生成示範照片／Mock OCR",
    );
    expect(menuPhotoSourceName({ isMock: true, isAiGenerated: false })).toBe(
      "使用者照片／Mock 固定輸出（未讀取照片）",
    );
    expect(menuPhotoSourceName({ isMock: false, isAiGenerated: false })).toBe(
      "校園菜單照片／真實 AI OCR",
    );
  });
});

describe("菜單照片上傳約束", () => {
  it("拒絕非 JPEG、PNG、WebP 檔案", async () => {
    await expect(
      prepareMenuImage(new File(["menu"], "menu.gif", { type: "image/gif" })),
    ).rejects.toThrow("JPEG、PNG 或 WebP");
  });

  it("在解碼前拒絕超過 5MB 的原檔", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(
      prepareMenuImage(
        new File([oversized], "menu.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("不可超過 5MB");
  });

  it("伺服器端只接受真正的重編碼 WebP，不相信偽裝 MIME", async () => {
    const webp = (
      width: number,
      height: number,
      extraChunks: Array<{ type: string; data: number[] }> = [],
    ) => {
      const chunks = [
        ...extraChunks,
        {
          type: "VP8 ",
          data: [
            0,
            0,
            0,
            0x9d,
            0x01,
            0x2a,
            width & 0xff,
            (width >> 8) & 0x3f,
            height & 0xff,
            (height >> 8) & 0x3f,
          ],
        },
      ];
      const body = chunks.flatMap(({ type, data }) => [
        ...Array.from(type, (character) => character.charCodeAt(0)),
        data.length & 0xff,
        (data.length >> 8) & 0xff,
        (data.length >> 16) & 0xff,
        (data.length >> 24) & 0xff,
        ...data,
        ...(data.length % 2 ? [0] : []),
      ]);
      const riffSize = 4 + body.length;
      return Uint8Array.from([
        0x52,
        0x49,
        0x46,
        0x46,
        riffSize & 0xff,
        (riffSize >> 8) & 0xff,
        (riffSize >> 16) & 0xff,
        (riffSize >> 24) & 0xff,
        0x57,
        0x45,
        0x42,
        0x50,
        ...body,
      ]);
    };
    const validImage = webp(640, 480);
    await expect(
      isProcessedFoodLensImage(new Blob([validImage], { type: "image/webp" })),
    ).resolves.toBe(true);
    await expect(
      isProcessedFoodLensImage(
        new Blob(["not-an-image"], { type: "image/webp" }),
      ),
    ).resolves.toBe(false);
    await expect(
      isProcessedFoodLensImage(new Blob([validImage], { type: "image/png" })),
    ).resolves.toBe(false);
    await expect(
      isProcessedFoodLensImage(
        new Blob([webp(640, 480, [{ type: "EXIF", data: [1, 2] }])], {
          type: "image/webp",
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      isProcessedFoodLensImage(
        new Blob([webp(1_601, 480)], { type: "image/webp" }),
      ),
    ).resolves.toBe(false);
    const mismatchedLength = webp(640, 480);
    mismatchedLength[4] = 0;
    await expect(
      isProcessedFoodLensImage(
        new Blob([mismatchedLength], { type: "image/webp" }),
      ),
    ).resolves.toBe(false);
  });
});
