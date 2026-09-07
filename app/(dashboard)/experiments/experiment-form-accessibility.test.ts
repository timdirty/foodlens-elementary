// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  EXPERIMENT_FIELD_IDS,
  experimentFieldDescription,
  experimentFieldErrorId,
  experimentIssuesToFieldErrors,
  firstExperimentErrorField,
  focusFirstExperimentError,
  predictionDecisionErrorField,
  safetyGuardrailErrorField,
  validateExperimentDraftFields,
} from "./experiment-form-accessibility";

const validDraft = {
  title: "減少主食剩食",
  baselineStart: "2026-08-24",
  baselineEnd: "2026-08-28",
  interventionStart: "2026-10-14",
  interventionEnd: "2026-10-16",
  description: "調整盛飯提醒並觀察結果",
  guardrailCheckedAt: "2026-10-16T13:30",
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("experiment form field accessibility", () => {
  it("maps required and date-order errors to the corresponding fields", () => {
    const errors = validateExperimentDraftFields({
      ...validDraft,
      title: " ",
      baselineStart: "2026-09-01",
      baselineEnd: "2026-08-31",
      interventionStart: "2026-08-31",
      interventionEnd: "2026-08-30",
    });

    expect(errors).toMatchObject({
      title: "請填寫實驗名稱",
      baselineEnd: "基準期結束日不可早於開始日",
      interventionStart: "改善期必須在基準期結束後開始，兩段期間不可重疊",
      interventionEnd: "改善期結束日不可早於開始日",
    });
    expect(firstExperimentErrorField(errors)).toBe("title");
  });

  it("maps evidence-range issues to the editable date boundaries", () => {
    expect(
      experimentIssuesToFieldErrors([
        "基準期至少需要 3 個獨立供餐日",
        "改善期至少需要 3 筆班級餐期",
      ]),
    ).toEqual({
      baselineEnd: "基準期至少需要 3 個獨立供餐日",
      interventionEnd: "改善期至少需要 3 筆班級餐期",
    });
  });

  it("maps safety and prediction exceptions to actionable controls", () => {
    expect(
      safetyGuardrailErrorField("填寫滿意度時，必須同時記錄回覆人數"),
    ).toBe("satisfactionResponseCount");
    expect(safetyGuardrailErrorField("可能干擾因素格式或範圍不正確")).toBe(
      "confounders",
    );
    expect(predictionDecisionErrorField("請輸入實際準備量")).toBe(
      "adjustedSupplyKg",
    );
  });

  it("builds stable error descriptions and focuses the first field in DOM order", () => {
    const errors = {
      description: "請填寫實際介入方式",
      title: "請填寫實驗名稱",
    };
    const title = document.createElement("input");
    title.id = EXPERIMENT_FIELD_IDS.title;
    const description = document.createElement("input");
    description.id = EXPERIMENT_FIELD_IDS.description;
    document.body.append(description, title);

    expect(experimentFieldErrorId("title")).toBe("experiment-title-error");
    expect(experimentFieldDescription("title", errors, "title-hint")).toBe(
      "title-hint experiment-title-error",
    );
    expect(focusFirstExperimentError(errors)).toBe(true);
    expect(document.activeElement).toBe(title);
  });
});
