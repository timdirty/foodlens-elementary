import { describe, expect, it } from "vitest";
import {
  createDemoEvidenceCases,
  mealEvidenceCaseSchema,
} from "@/lib/evidence-chain";
import {
  evidenceCaseToMealRecord,
  linkEvidenceCaseToMealRecord,
  localEvidenceMealRecordId,
} from "@/lib/evidence-meal";

describe("餐期證據鏈與既有餐期資料的橋接", () => {
  it("用穩定 ID 建立可供 Dashboard 與掃描共用的餐期摘要", () => {
    const evidenceCase = createDemoEvidenceCases()[0];
    const first = evidenceCaseToMealRecord(evidenceCase);
    const second = evidenceCaseToMealRecord(evidenceCase);

    expect(first).toEqual(second);
    expect(first.id).toBe(localEvidenceMealRecordId(evidenceCase.id));
    expect(first.totalSupplyG).toBe(evidenceCase.suppliedEdibleG);
    expect(first.leftoverG).toBeGreaterThan(0);
    expect(first.leftoverG).toBeLessThanOrEqual(first.totalSupplyG);
    expect(first.measurementMethod).toBe("sample-extrapolation");
    expect(first.notes).toContain("不是把混合廚餘或單張 AI 估重");
  });

  it("只有完整涵蓋全班且相關來源皆為電子秤才標示為 scale", () => {
    const evidenceCase = createDemoEvidenceCases()[0];
    const fullCoverage = mealEvidenceCaseSchema.parse({
      ...evidenceCase,
      observedDiners: evidenceCase.actualDiners,
      plateSampleSupplyG:
        evidenceCase.suppliedEdibleG -
        evidenceCase.measurements
          .filter((item) => item.source === "unserved-edible")
          .reduce((sum, item) => sum + item.netG, 0),
    });

    expect(evidenceCaseToMealRecord(fullCoverage).measurementMethod).toBe(
      "scale",
    );
  });

  it("把 mealRecordId 保存回 aggregate，讓 reload 仍可精確連到同一餐", () => {
    const evidenceCase = createDemoEvidenceCases()[0];
    const linked = linkEvidenceCaseToMealRecord(
      evidenceCase,
      "evidence-meal-linked",
    );

    expect(linked.mealRecordId).toBe("evidence-meal-linked");
    expect(evidenceCase.mealRecordId).toBeUndefined();
  });
});

describe("正式量測不可沿用預填值", () => {
  it("非 Demo 案件沒有現場人工確認時拒絕成為正式證據", () => {
    const evidenceCase = createDemoEvidenceCases()[0];

    expect(() =>
      mealEvidenceCaseSchema.parse({
        ...evidenceCase,
        sourceKind: "measured",
      }),
    ).toThrow("正式資料必須由現場人員逐項確認五源量測");
  });

  it("有餐盤樣本且確認 0g 語意後才接受 measured 案件", () => {
    const evidenceCase = createDemoEvidenceCases()[0];
    const measured = mealEvidenceCaseSchema.parse({
      ...evidenceCase,
      sourceKind: "measured",
      measurementReview: {
        reviewedAt: evidenceCase.updatedAt,
        reviewedBy: "午餐工作小組",
        zeroValuesChecked: true,
      },
    });

    expect(measured.measurementReview?.zeroValuesChecked).toBe(true);
  });
});
