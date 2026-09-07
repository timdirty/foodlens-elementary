import { describe, expect, it } from "vitest";
import { createUuid, sha256Hex } from "@/lib/crypto";

describe("不安全區網來源的本機相容層", () => {
  it("沒有 randomUUID 時仍建立標準 v4 UUID 格式", () => {
    expect(createUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("沒有 SubtleCrypto 時仍產生真正的 SHA-256", async () => {
    const bytes = new TextEncoder().encode("abc");
    await expect(sha256Hex(bytes, { subtle: null })).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
