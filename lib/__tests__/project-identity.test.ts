import { describe, expect, it } from "vitest";
import {
  FALLBACK_PROJECT_IDENTITY,
  resolveProjectIdentity,
} from "@/lib/project-identity";

describe("resolveProjectIdentity", () => {
  it("uses the saved project name and subtitle after trimming whitespace", () => {
    expect(
      resolveProjectIdentity({
        projectName: "  午餐觀察隊  ",
        subtitle: "  從剩食證據改善下一餐  ",
      }),
    ).toEqual({
      projectName: "午餐觀察隊",
      subtitle: "從剩食證據改善下一餐",
    });
  });

  it("falls back to honest product copy when legacy values are blank", () => {
    expect(
      resolveProjectIdentity({ projectName: "  ", subtitle: "\n" }),
    ).toEqual(FALLBACK_PROJECT_IDENTITY);
  });
});
