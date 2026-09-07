import { describe, expect, it } from "vitest";
import {
  AUTH_CALLBACK_RESPONSE_HEADERS,
  authCallbackDestination,
  isValidAuthCallbackCode,
} from "@/lib/auth-callback";

describe("Supabase auth callback boundary", () => {
  it("rejects missing, short, oversized, or whitespace-bearing codes", () => {
    expect(isValidAuthCallbackCode(null)).toBe(false);
    expect(isValidAuthCallbackCode("short")).toBe(false);
    expect(isValidAuthCallbackCode(`valid-code-${"a".repeat(30)}\n`)).toBe(
      false,
    );
    expect(isValidAuthCallbackCode("a".repeat(2049))).toBe(false);
  });

  it("accepts a bounded opaque PKCE code without interpreting it", () => {
    expect(
      isValidAuthCallbackCode(
        "d587ff95-3098-4ca7-b2f2-6f569eae9afe.ABC_def-123",
      ),
    ).toBe(true);
  });

  it("redirects only to the local admin result and prevents token URL caching", () => {
    expect(
      authCallbackDestination(
        "https://foodlens.example/auth/callback?code=secret",
        "ready",
      ).toString(),
    ).toBe("https://foodlens.example/admin?cloud=ready");
    expect(AUTH_CALLBACK_RESPONSE_HEADERS).toMatchObject({
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
  });
});
