import { describe, expect, it } from "vitest";
import {
  assertExperimentSafetyGuardrails,
  createPredictionDecisionTrace,
  decodeExperimentDescription,
  encodeExperimentDescription,
  validatePredictionDecision,
} from "@/lib/experiment-decision";
import {
  createPrediction,
  JUDGE_DEMO_PREDICTION_INPUT,
} from "@/lib/prediction";
import { createDemoSnapshot } from "@/lib/seed";
import type { ImprovementExperiment } from "@/lib/types";

function prediction() {
  return createPrediction(createDemoSnapshot(), JUDGE_DEMO_PREDICTION_INPUT);
}

describe("供餐建議採用決策", () => {
  it("保存建立實驗當下的原計畫、建議量與調整後採用量", () => {
    const source = prediction();
    const adoptedSupplyG = Math.round(
      (source.plannedSupplyG + source.recommendedSupplyG) / 2,
    );
    const trace = createPredictionDecisionTrace(source, {
      adoptionMode: "adjusted",
      adjustedSupplyG: adoptedSupplyG,
      adoptionNote: "營養師保留現場補餐緩衝。",
      recordedAt: "2026-08-31T12:30:00.000Z",
    });

    expect(trace).toMatchObject({
      predictionId: source.id,
      plannedSupplyG: source.plannedSupplyG,
      recommendedSupplyG: source.recommendedSupplyG,
      adoptionMode: "adjusted",
      adoptedSupplyG,
      adoptionNote: "營養師保留現場補餐緩衝。",
    });
  });

  it("不允許調整後採用量低於安全參考量或高於原計畫", () => {
    const source = prediction();
    expect(
      validatePredictionDecision(source, {
        adoptionMode: "adjusted",
        adjustedSupplyG: source.recommendedSupplyG - 1,
      }),
    ).toContain("不可低於");
    expect(
      validatePredictionDecision(source, {
        adoptionMode: "adjusted",
        adjustedSupplyG: source.plannedSupplyG + 1,
      }),
    ).toContain("不可高於原計畫");
  });

  it("在既有文字欄位可向後相容保存與還原決策快照", () => {
    const source = prediction();
    const experiment: ImprovementExperiment = {
      ...createDemoSnapshot().experiments[0],
      linkedPredictionId: source.id,
      decisionTrace: createPredictionDecisionTrace(source, {
        adoptionMode: "recommended",
        adoptionNote: "先採建議量試行。",
        recordedAt: "2026-08-31T12:30:00.000Z",
      }),
      safetyGuardrails: {
        shortageReportCount: 0,
        refillRequestCount: 3,
        satisfactionScore: 4.2,
        satisfactionResponseCount: 24,
        dietitianReview: "confirmed",
        dietitianNote: "保留現場補餐，營養師確認可試行。",
        confounders: ["改善期有戶外教學"],
        checkedAt: "2026-10-16T07:30:00.000Z",
      },
    };

    expect(
      decodeExperimentDescription(encodeExperimentDescription(experiment)),
    ).toEqual({
      interventionDescription: experiment.interventionDescription,
      decisionTrace: experiment.decisionTrace,
      safetyGuardrails: experiment.safetyGuardrails,
    });
    expect(decodeExperimentDescription("舊版純文字介入內容")).toEqual({
      interventionDescription: "舊版純文字介入內容",
    });
  });

  it("仍可讀取 V1 雲端決策封裝，未臆造安全護欄", () => {
    const source = prediction();
    const decisionTrace = createPredictionDecisionTrace(source, {
      adoptionMode: "original",
      adoptionNote: "舊版決策紀錄",
      recordedAt: "2026-08-31T12:30:00.000Z",
    });
    const value = `[[FOODLENS_EXPERIMENT_DECISION_V1]]${JSON.stringify({
      version: 1,
      interventionDescription: "舊版介入",
      decisionTrace,
    })}`;

    expect(decodeExperimentDescription(value)).toEqual({
      interventionDescription: "舊版介入",
      decisionTrace,
    });
  });

  it("沒有連結供餐建議時，雲端封裝仍會保存安全護欄", () => {
    const experiment: ImprovementExperiment = {
      ...createDemoSnapshot().experiments[0],
      decisionTrace: undefined,
      linkedPredictionId: undefined,
      safetyGuardrails: {
        shortageReportCount: null,
        refillRequestCount: 2,
        satisfactionScore: null,
        satisfactionResponseCount: 0,
        dietitianReview: "pending",
        dietitianNote: "待營養師確認。",
        confounders: [],
        checkedAt: "2026-10-16T07:30:00.000Z",
      },
    };

    expect(
      decodeExperimentDescription(encodeExperimentDescription(experiment)),
    ).toEqual({
      interventionDescription: experiment.interventionDescription,
      safetyGuardrails: experiment.safetyGuardrails,
    });
  });

  it("安全護欄保留未量測，並拒絕沒有回覆樣本的滿意度", () => {
    expect(
      assertExperimentSafetyGuardrails({
        shortageReportCount: null,
        refillRequestCount: null,
        satisfactionScore: null,
        satisfactionResponseCount: 0,
        dietitianReview: "pending",
        dietitianNote: "",
        confounders: [],
        checkedAt: "2026-10-16T07:30:00.000Z",
      }),
    ).toMatchObject({
      shortageReportCount: null,
      satisfactionScore: null,
    });

    expect(() =>
      assertExperimentSafetyGuardrails({
        shortageReportCount: 0,
        refillRequestCount: 0,
        satisfactionScore: 4.5,
        satisfactionResponseCount: 0,
        dietitianReview: "confirmed",
        dietitianNote: "",
        confounders: [],
        checkedAt: "2026-10-16T07:30:00.000Z",
      }),
    ).toThrow("必須同時記錄回覆人數");
  });
});
