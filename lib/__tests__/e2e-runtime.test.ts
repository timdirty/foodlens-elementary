import { describe, expect, it } from "vitest";
import {
  assertFoodLensTestServer,
  createE2eRuntime,
} from "@/scripts/e2e-runtime";

describe("isolated browser acceptance runtime", () => {
  it("uses a dedicated loopback origin and refuses existing servers", () => {
    const runtime = createE2eRuntime("3311");
    expect(runtime.baseURL).toBe("http://127.0.0.1:3311");
    expect(runtime.webServer.url).toBe(runtime.baseURL);
    expect(runtime.webServer.reuseExistingServer).toBe(false);
    expect(runtime.webServer.command).toContain(
      "--hostname 127.0.0.1 --port 3311",
    );
  });

  it("clears live AI and school-cloud credentials for both build and server", () => {
    const { env } = createE2eRuntime("3312").webServer;
    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "AI_PROVIDER",
      "AI_API_KEY",
      "AI_MODEL",
      "AI_BASE_URL",
      "VERCEL_URL",
    ] as const)
      expect(env[key]).toBe("");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3312");
  });

  it.each([
    "",
    "80",
    "65536",
    "-3311",
    "3311; echo unsafe",
    "3311.0",
    "https://example.com",
  ])("rejects an unsafe port: %s", (value) =>
    expect(() => createE2eRuntime(value)).toThrow(),
  );

  const expected = {
    status: 200,
    contentType: "text/html; charset=utf-8",
    robots: "noindex, nofollow",
    html: "<html><head><title>FoodLens 食光偵探｜把剩食變成下一餐的證據</title></head></html>",
  };
  it("checks product identity and publication headers before write journeys", () => {
    expect(() => assertFoodLensTestServer(expected)).not.toThrow();
    for (const patch of [
      { status: 404 },
      { contentType: "application/json" },
      { robots: null },
      { robots: "index, follow" },
      { html: "<title>PY.LAB</title><p>FoodLens</p>" },
    ])
      expect(() => assertFoodLensTestServer({ ...expected, ...patch })).toThrow(
        "未執行任何資料寫入測試",
      );
  });
});
