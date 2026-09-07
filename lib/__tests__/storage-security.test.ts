import { describe, expect, it } from "vitest";
import { PLATE_IMAGE_SIGNED_URL_TTL_SECONDS } from "@/lib/storage-security";

describe("private plate image authorization", () => {
  it("keeps signed URLs at a short, centralized ten-minute TTL", () => {
    expect(PLATE_IMAGE_SIGNED_URL_TTL_SECONDS).toBe(600);
    expect(PLATE_IMAGE_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(10 * 60);
  });
});
