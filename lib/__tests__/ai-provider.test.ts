import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_FOOD_ANALYSIS_MENU_CANDIDATES,
  ServerFoodAnalysisProvider,
} from "@/lib/ai";

const successfulAnalysis = {
  schemaVersion: "1",
  provider: "test-provider",
  model: "test-model",
  isMock: false,
  detections: [
    {
      category: "rice",
      label: "白飯",
      originalG: 120,
      remainingRatio: 0.25,
      remainingG: 30,
      confidence: 0.9,
    },
  ],
  warnings: ["測試"],
  analyzedAt: "2026-09-05T00:00:00.000Z",
};

describe("真實 AI client 錯誤可觀測性", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("把伺服器追蹤碼帶到可重試的使用者錯誤", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "真實 AI 服務暫時無法連線",
            requestId: "12345678-aaaa-bbbb-cccc-123456789abc",
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": "12345678-aaaa-bbbb-cccc-123456789abc",
            },
          },
        ),
      ),
    );

    await expect(
      new ServerFoodAnalysisProvider().analyze({
        fingerprint: "uploaded-plate",
        image: new Blob(["plate"], { type: "image/webp" }),
      }),
    ).rejects.toThrow("真實 AI 服務暫時無法連線（追蹤碼 12345678）");
  });

  it("只把通過 schema 的最小菜單候選 JSON 送到伺服器", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulAnalysis), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const candidates = [
      {
        label: "咖哩雞丁",
        rawName: "咖哩雞丁（微辣）",
        category: "meat" as const,
        role: "main" as const,
        basis: "substitution" as const,
      },
    ];

    await new ServerFoodAnalysisProvider().analyze({
      fingerprint: "content-sha256",
      image: new Blob(["plate"], { type: "image/webp" }),
      menuCandidates: candidates,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as FormData;
    expect(JSON.parse(String(form.get("menuCandidates")))).toEqual(candidates);
    expect(
      Object.keys(JSON.parse(String(form.get("menuCandidates")))[0]),
    ).toEqual(["label", "rawName", "category", "role", "basis"]);
  });

  it("沒有候選時明確送出空陣列，不會從檔名或菜名自行推測", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulAnalysis), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new ServerFoodAnalysisProvider().analyze({
      fingerprint: "uploaded-plate",
      image: new Blob(["plate"], { type: "image/webp" }),
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((request.body as FormData).get("menuCandidates")).toBe("[]");
  });

  it("在發出網路請求前拒絕超量或帶額外欄位的候選", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const candidate = {
      label: "糙米飯",
      rawName: "糙米飯",
      category: "rice" as const,
      role: "staple" as const,
      basis: "planned" as const,
    };
    const provider = new ServerFoodAnalysisProvider();

    await expect(
      provider.analyze({
        fingerprint: "plate",
        image: new Blob(["plate"], { type: "image/webp" }),
        menuCandidates: Array.from(
          { length: MAX_FOOD_ANALYSIS_MENU_CANDIDATES + 1 },
          () => candidate,
        ),
      }),
    ).rejects.toThrow();
    await expect(
      provider.analyze({
        fingerprint: "plate",
        image: new Blob(["plate"], { type: "image/webp" }),
        menuCandidates: [
          {
            ...candidate,
            vendorId: "must-not-cross-ai-boundary",
          } as typeof candidate,
        ],
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
