import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import nextConfig from "@/next.config";
import { config } from "@/proxy";

describe("Next 16 Proxy matcher", () => {
  it.each(["/", "/auth/callback", "/api/ai/analyze"])(
    "讓 %s 通過登入 cookie 更新",
    (url) => {
      expect(unstable_doesProxyMatch({ config, nextConfig, url })).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunk.js",
    "/_next/image?url=%2Fdemo%2Fplate.png&w=640&q=75",
    "/demo/plate.png",
  ])("排除靜態資源 %s", (url) => {
    expect(unstable_doesProxyMatch({ config, nextConfig, url })).toBe(false);
  });
});
