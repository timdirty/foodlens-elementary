import { describe, expect, it } from "vitest";
import {
  isSameOriginMenuOcrRequest,
  maxDuration,
  POST,
} from "@/app/api/ai/menu-analyze/route";

describe("真實菜單 OCR route 防護", () => {
  it("在解析 multipart 前拒絕明顯過大的請求", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/menu-analyze", {
        method: "POST",
        headers: { "content-length": String(6 * 1024 * 1024 + 1) },
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("5MB"),
    });
  });

  it("未設定真實模型時明確提供人工或 Mock 選項", async () => {
    const previous = {
      key: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
      url: process.env.AI_BASE_URL,
    };
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    try {
      const response = await POST(
        new Request("http://localhost/api/ai/menu-analyze", {
          method: "POST",
          headers: { origin: "http://localhost" },
        }),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("Mock 示範"),
        actions: expect.arrayContaining(["人工貼上 OCR 原文"]),
      });
    } finally {
      if (previous.key === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = previous.key;
      if (previous.model === undefined) delete process.env.AI_MODEL;
      else process.env.AI_MODEL = previous.model;
      if (previous.url === undefined) delete process.env.AI_BASE_URL;
      else process.env.AI_BASE_URL = previous.url;
    }
  });

  it("平台執行上限長於模型逾時", () => {
    expect(maxDuration).toBeGreaterThan(30);
  });

  it("拒絕跨來源與缺少 Origin 的 cookie-auth POST", async () => {
    expect(
      isSameOriginMenuOcrRequest(
        new Request("https://foodlens.example/api/ai/menu-analyze", {
          method: "POST",
          headers: { origin: "https://foodlens.example" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginMenuOcrRequest(
        new Request("https://foodlens.example/api/ai/menu-analyze", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
    expect(
      isSameOriginMenuOcrRequest(
        new Request("https://foodlens.example/api/ai/menu-analyze", {
          method: "POST",
        }),
      ),
    ).toBe(false);

    const response = await POST(
      new Request("https://foodlens.example/api/ai/menu-analyze", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("請求來源"),
    });
  });
});
