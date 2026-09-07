import { describe, expect, it } from "vitest";
import { buildClosedLoopStory } from "@/components/product-story/closed-loop-case";
import { createDemoSnapshot } from "@/lib/seed";

describe("closed-loop product story", () => {
  it("derives a traceable corrected scan, prediction, and remeasurement from the snapshot", () => {
    const snapshot = createDemoSnapshot();
    const story = buildClosedLoopStory(snapshot);

    expect(story).toBeDefined();
    expect(snapshot.meals.some((meal) => meal.id === story?.mealId)).toBe(true);
    expect(story?.imageUrl).toMatch(/^\/demo\//);
    expect(story?.wasCorrected).toBe(true);
    expect(story?.aiRatio).not.toBe(story?.finalRatio);
    expect(story?.plannedSupplyG).toBeGreaterThan(0);
    expect(story?.recommendedSupplyG).toBeLessThanOrEqual(
      story?.plannedSupplyG ?? 0,
    );
    expect(story?.predictionEvidence).toContain("個獨立供餐日");
    expect(story?.beforeRate).toBeCloseTo(0.27, 2);
    expect(story?.afterRate).toBeCloseTo(0.19, 2);
  });

  it("returns no showcase case when there is no confirmed plate scan", () => {
    const snapshot = createDemoSnapshot();
    snapshot.scans = snapshot.scans.map((scan) => ({
      ...scan,
      status: "failed",
    }));

    expect(buildClosedLoopStory(snapshot)).toBeUndefined();
  });
});
