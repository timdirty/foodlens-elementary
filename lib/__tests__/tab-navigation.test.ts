import { describe, expect, it } from "vitest";
import { getRovingTabTargetIndex } from "@/lib/tab-navigation";

describe("getRovingTabTargetIndex", () => {
  it("用左右方向鍵循環移動", () => {
    expect(getRovingTabTargetIndex("ArrowRight", 1, 3)).toBe(2);
    expect(getRovingTabTargetIndex("ArrowRight", 2, 3)).toBe(0);
    expect(getRovingTabTargetIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(getRovingTabTargetIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("用 Home 與 End 到達首尾", () => {
    expect(getRovingTabTargetIndex("Home", 2, 4)).toBe(0);
    expect(getRovingTabTargetIndex("End", 1, 4)).toBe(3);
  });

  it("忽略非分頁鍵與空集合", () => {
    expect(getRovingTabTargetIndex("Tab", 0, 3)).toBeUndefined();
    expect(getRovingTabTargetIndex("ArrowRight", 0, 0)).toBeUndefined();
  });
});
