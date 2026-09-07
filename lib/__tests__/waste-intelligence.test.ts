import { describe, expect, it } from "vitest";
import {
  analyzeWasteIntelligence,
  calculateWasteMetrics,
  DRAINAGE_STATES,
  generateResponsibilityCards,
  WASTE_MEASUREMENT_METHODS,
  WASTE_SOURCES,
  wasteIntelligenceInputSchema,
  wasteMeasurementSchema,
  wasteObservationSchema,
  type WasteMeasurement,
  type WasteObservation,
} from "@/lib/waste-intelligence";

function measurement(
  source: WasteMeasurement["source"],
  netG: number,
  options: Partial<
    Pick<WasteMeasurement, "id" | "drainage" | "method" | "foodCategory">
  > = {},
): WasteMeasurement {
  const tareG = 100;
  return wasteMeasurementSchema.parse({
    id: options.id ?? `${source}-${netG}`,
    source,
    grossG: tareG + netG,
    tareG,
    netG,
    drainage: options.drainage ?? "standard-drained",
    method: options.method ?? "scale",
    foodCategory: options.foodCategory,
  });
}

interface ObservationOptions {
  id?: string;
  servedOn?: string;
  suppliedEdibleG?: number;
  plannedDiners?: number;
  actualDiners?: number;
  observedDiners?: number;
  plateSampleSupplyG?: number;
  measurements?: WasteMeasurement[];
  context?: {
    menuName?: string;
    includesVegetable?: boolean;
    specialEvent?: string;
    feedback?: {
      responseCount: number;
      portionTooMuchCount?: number;
      tasteIssueCount?: number;
      textureIssueCount?: number;
      temperatureIssueCount?: number;
    };
    delivery?: {
      delayMinutes?: number | null;
      temperatureConcern?: boolean | null;
    };
  };
}

function observation(options: ObservationOptions = {}): WasteObservation {
  const measurements = options.measurements ?? [
    measurement("unserved-edible", 100),
    measurement("plate-edible", 180),
  ];
  const hasPlate = measurements.some((item) => item.source === "plate-edible");
  return wasteObservationSchema.parse({
    id: options.id ?? "meal-1",
    servedOn: options.servedOn ?? "2026-09-01",
    suppliedEdibleG: options.suppliedEdibleG ?? 1_000,
    plannedDiners: options.plannedDiners ?? 10,
    actualDiners: options.actualDiners ?? 10,
    observedDiners: options.observedDiners ?? (hasPlate ? 10 : 0),
    plateSampleSupplyG: options.plateSampleSupplyG,
    measurements,
    context: {
      menuName: options.context?.menuName ?? "測試午餐",
      includesVegetable: options.context?.includesVegetable ?? false,
      specialEvent: options.context?.specialEvent,
      feedback: options.context?.feedback,
      delivery: options.context?.delivery,
    },
  });
}

function input(observations: WasteObservation[]) {
  return wasteIntelligenceInputSchema.parse({ observations });
}

function repeatedObservations(
  count: number,
  create: (index: number) => ObservationOptions,
) {
  return Array.from({ length: count }, (_, index) =>
    observation({
      id: `meal-${index + 1}`,
      servedOn: `2026-09-${String(index + 1).padStart(2, "0")}`,
      ...create(index),
    }),
  );
}

describe("剩食來源資料契約", () => {
  it("固定保留五類來源、三種瀝水狀態與三種量測方法", () => {
    expect(WASTE_SOURCES).toEqual([
      "prep",
      "unserved-edible",
      "plate-edible",
      "inedible",
      "liquid-contaminated",
    ]);
    expect(DRAINAGE_STATES).toEqual(["wet", "standard-drained", "dewatered"]);
    expect(WASTE_MEASUREMENT_METHODS).toEqual([
      "scale",
      "ai-estimate",
      "manual-band",
    ]);
  });

  it("拒絕負數重量", () => {
    const result = wasteMeasurementSchema.safeParse({
      id: "negative",
      source: "prep",
      grossG: -1,
      tareG: 0,
      netG: -1,
      drainage: "wet",
      method: "scale",
    });

    expect(result.success).toBe(false);
  });

  it("拒絕毛重小於皮重", () => {
    const result = wasteMeasurementSchema.safeParse({
      id: "bad-tare",
      source: "inedible",
      grossG: 50,
      tareG: 80,
      netG: 0,
      drainage: "standard-drained",
      method: "scale",
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes("毛重")),
    ).toBe(true);
  });

  it("拒絕淨重不等於毛重減皮重", () => {
    const result = wasteMeasurementSchema.safeParse({
      id: "bad-net",
      source: "plate-edible",
      grossG: 300,
      tareG: 100,
      netG: 190,
      drainage: "standard-drained",
      method: "scale",
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.message.includes("淨重")),
    ).toBe(true);
  });

  it("拒絕未供出與餐盤可食剩食合計高於供應量", () => {
    const result = wasteObservationSchema.safeParse({
      id: "too-much-edible",
      servedOn: "2026-09-01",
      suppliedEdibleG: 1_000,
      plannedDiners: 10,
      actualDiners: 10,
      observedDiners: 10,
      measurements: [
        measurement("unserved-edible", 700),
        measurement("plate-edible", 400),
      ],
      context: { menuName: "測試午餐" },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("可食剩食總量"),
      ),
    ).toBe(true);
  });

  it("拒絕盤後剩食高於抽樣餐盤原供應重量", () => {
    const result = wasteObservationSchema.safeParse({
      id: "impossible-plate",
      servedOn: "2026-09-01",
      suppliedEdibleG: 1_000,
      plannedDiners: 10,
      actualDiners: 10,
      observedDiners: 2,
      plateSampleSupplyG: 100,
      measurements: [measurement("plate-edible", 120)],
      context: { menuName: "測試午餐" },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("抽樣餐盤原供應重量"),
      ),
    ).toBe(true);
  });
});

describe("剩食加權指標", () => {
  it("盤後率以抽樣供應重量加權，不直接平均各餐百分比", () => {
    const rows = [
      observation({
        id: "small-sample",
        suppliedEdibleG: 1_000,
        observedDiners: 5,
        plateSampleSupplyG: 200,
        measurements: [measurement("plate-edible", 100)],
      }),
      observation({
        id: "large-sample",
        servedOn: "2026-09-02",
        suppliedEdibleG: 3_000,
        plannedDiners: 20,
        actualDiners: 20,
        observedDiners: 10,
        plateSampleSupplyG: 1_000,
        measurements: [measurement("plate-edible", 100, { id: "plate-large" })],
      }),
    ];

    const metrics = calculateWasteMetrics(input(rows));

    expect(metrics.weightedPlateRate).toBeCloseTo(200 / 1_200, 6);
    expect(metrics.weightedPlateRate).not.toBeCloseTo((0.5 + 0.1) / 2, 3);
  });

  it("未供出率以全部供應重量加權", () => {
    const rows = [
      observation({
        id: "meal-a",
        suppliedEdibleG: 1_000,
        observedDiners: 0,
        measurements: [measurement("unserved-edible", 200)],
      }),
      observation({
        id: "meal-b",
        servedOn: "2026-09-02",
        suppliedEdibleG: 3_000,
        observedDiners: 0,
        measurements: [
          measurement("unserved-edible", 150, { id: "unserved-b" }),
        ],
      }),
    ];

    expect(calculateWasteMetrics(input(rows)).unservedRate).toBeCloseTo(
      350 / 4_000,
      6,
    );
  });

  it("部分餐盤抽樣會按各餐盤後率外推，並揭露覆蓋率", () => {
    const rows = [
      observation({
        id: "meal-a",
        suppliedEdibleG: 1_000,
        actualDiners: 10,
        observedDiners: 5,
        plateSampleSupplyG: 450,
        measurements: [
          measurement("unserved-edible", 100),
          measurement("plate-edible", 90),
        ],
      }),
      observation({
        id: "meal-b",
        servedOn: "2026-09-02",
        suppliedEdibleG: 3_000,
        plannedDiners: 20,
        actualDiners: 20,
        observedDiners: 10,
        plateSampleSupplyG: 1_350,
        measurements: [
          measurement("unserved-edible", 300, { id: "unserved-b" }),
          measurement("plate-edible", 270, { id: "plate-b" }),
        ],
      }),
    ];

    const metrics = calculateWasteMetrics(input(rows));

    expect(metrics.coverageRate).toBe(0.5);
    expect(metrics.estimatedPlateEdibleG).toBe(720);
    expect(metrics.avoidableRate).toBe(0.28);
    expect(metrics.plateEstimateExtrapolated).toBe(true);
  });

  it("備料、不可食殘渣與污染液體不混入可避免率", () => {
    const row = observation({
      suppliedEdibleG: 1_000,
      plateSampleSupplyG: 800,
      measurements: [
        measurement("prep", 300),
        measurement("unserved-edible", 200),
        measurement("plate-edible", 80),
        measurement("inedible", 250),
        measurement("liquid-contaminated", 500),
      ],
    });

    const metrics = calculateWasteMetrics(input([row]));

    expect(metrics).toMatchObject({
      measuredPrepG: 300,
      measuredInedibleG: 250,
      measuredLiquidContaminatedG: 500,
      measuredUnservedEdibleG: 200,
      measuredPlateEdibleG: 80,
      avoidableRate: 0.28,
    });
  });

  it("非標準瀝水與估算方法會降低證據品質但仍保留資料", () => {
    const row = observation({
      measurements: [
        measurement("unserved-edible", 100, {
          drainage: "wet",
          method: "ai-estimate",
        }),
        measurement("plate-edible", 180, {
          drainage: "dewatered",
          method: "manual-band",
        }),
      ],
    });

    const metrics = calculateWasteMetrics(input([row]));

    expect(metrics.evidenceQuality).toBeLessThan(0.4);
    expect(metrics.standardDrainageCoverageRate).toBe(0);
    expect(metrics.drainageComparable).toBe(false);
  });
});

describe("責任決策規則", () => {
  it("大量秤重紀錄不會把單日回饋或配送觀察升成高信心", () => {
    const rows = repeatedObservations(5, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [
        measurement("plate-edible", 300, { id: `plate-${index}` }),
      ],
      context:
        index === 0
          ? {
              feedback: { responseCount: 3, tasteIssueCount: 3 },
              delivery: { delayMinutes: 20, temperatureConcern: null },
            }
          : {},
    }));
    const cards = generateResponsibilityCards(input(rows));
    expect(cards.find((card) => card.id === "recipe-texture")?.confidence).toBe(
      "low",
    );
    expect(cards.find((card) => card.id === "delivery")?.confidence).toBe(
      "low",
    );
  });

  it("沒有回覆的已收集餐期不會增加原因訊號的獨立樣本數", () => {
    const rows = repeatedObservations(5, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [
        measurement("plate-edible", 300, { id: `plate-${index}` }),
      ],
      context: {
        feedback: {
          responseCount: index === 0 ? 3 : 0,
          tasteIssueCount: index === 0 ? 3 : 0,
        },
      },
    }));
    const card = generateResponsibilityCards(input(rows)).find(
      (item) => item.id === "recipe-texture",
    );
    expect(card?.confidence).toBe("low");
    expect(
      card?.evidence.find((item) => item.code === "recipe-feedback")?.detail,
    ).toContain("1 個有有效回覆的獨立供餐日");
  });

  it("未供出率或出席落差觸發人數與備餐責任卡", () => {
    const rows = repeatedObservations(3, (index) => ({
      plannedDiners: 12,
      actualDiners: 10,
      observedDiners: 10,
      measurements: [
        measurement("unserved-edible", 150, { id: `unserved-${index}` }),
        measurement("plate-edible", 50, { id: `plate-${index}` }),
      ],
    }));

    const card = generateResponsibilityCards(input(rows)).find(
      (item) => item.id === "headcount-reserve",
    );

    expect(card).toMatchObject({
      owner: {
        primary: "lunch-secretary",
        collaborators: ["caterer", "dietitian"],
      },
      confidence: "medium",
    });
    expect(card?.evidence.map((item) => item.code)).toContain("unserved-rate");
    expect(card?.action).toContain("核對請假");
    expect(card?.guardrail).toContain("不得用總廚餘直接等比例減餐");
  });

  it("高盤後率加上口味口感回饋才觸發食譜責任卡", () => {
    const rows = repeatedObservations(3, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [
        measurement("plate-edible", 250, { id: `plate-${index}` }),
      ],
      context: {
        feedback: {
          responseCount: 10,
          tasteIssueCount: 3,
          textureIssueCount: 2,
        },
      },
    }));

    const cards = generateResponsibilityCards(input(rows));
    const recipe = cards.find((item) => item.id === "recipe-texture");

    expect(recipe?.owner.primary).toBe("dietitian");
    expect(recipe?.evidence.map((item) => item.code)).toEqual([
      "plate-rate",
      "recipe-feedback",
    ]);
    expect(recipe?.guardrail).toContain("不等同因果");
  });

  it("只有高盤後率而無原因回饋時不冒充食譜診斷", () => {
    const rows = repeatedObservations(3, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [
        measurement("plate-edible", 300, { id: `plate-${index}` }),
      ],
    }));

    expect(
      generateResponsibilityCards(input(rows)).some(
        (item) => item.id === "recipe-texture",
      ),
    ).toBe(false);
  });

  it("配送延遲、現場溫度疑慮或溫度回饋觸發配送責任卡", () => {
    const rows = repeatedObservations(3, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [
        measurement("plate-edible", 100, { id: `plate-${index}` }),
      ],
      context: {
        feedback: {
          responseCount: 10,
          temperatureIssueCount: index === 0 ? 4 : 0,
        },
        delivery: {
          delayMinutes: index === 0 ? 20 : 0,
          temperatureConcern: index === 1,
        },
      },
    }));

    const delivery = generateResponsibilityCards(input(rows)).find(
      (item) => item.id === "delivery",
    );

    expect(delivery?.owner.primary).toBe("caterer");
    expect(delivery?.evidence[0]).toMatchObject({
      code: "delivery-delay",
      value: 20,
      unit: "minutes",
    });
    expect(delivery?.guardrail).toContain("須由校方");
  });

  it("蔬菜占盤後剩食偏高時提供營養護欄，不直接建議減菜", () => {
    const rows = repeatedObservations(3, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [
        measurement("plate-edible", 160, {
          id: `vegetable-${index}`,
          foodCategory: "vegetable",
        }),
        measurement("plate-edible", 90, {
          id: `other-${index}`,
          foodCategory: "meat",
        }),
      ],
      context: { includesVegetable: true },
    }));

    const vegetable = generateResponsibilityCards(input(rows)).find(
      (item) => item.id === "vegetable-guardrail",
    );

    expect(vegetable?.owner.primary).toBe("dietitian");
    expect(vegetable?.evidence[0].value).toBeCloseTo(0.64, 6);
    expect(vegetable?.guardrail).toContain("不可因蔬菜剩食偏高就直接降低");
  });

  it("樣本、覆蓋、秤重品質或瀝水不足時產生需要更多資料卡", () => {
    const row = observation({
      actualDiners: 10,
      observedDiners: 2,
      plateSampleSupplyG: 180,
      measurements: [
        measurement("plate-edible", 40, {
          drainage: "wet",
          method: "manual-band",
        }),
      ],
    });

    const moreData = generateResponsibilityCards(input([row])).find(
      (item) => item.id === "need-more-data",
    );

    expect(moreData).toMatchObject({
      owner: { primary: "teacher-student-team" },
      confidence: "low",
    });
    expect(moreData?.evidence[0].detail).toContain("盤後覆蓋率 20.0%");
    expect(moreData?.guardrail).toContain("不得冒充正式秤重");
  });

  it("五個獨立供餐日且標準秤重時可給高信心責任卡", () => {
    const rows = repeatedObservations(5, (index) => ({
      measurements: [
        measurement("unserved-edible", 150, { id: `unserved-${index}` }),
        measurement("plate-edible", 50, { id: `plate-${index}` }),
      ],
    }));

    const headcount = generateResponsibilityCards(input(rows)).find(
      (item) => item.id === "headcount-reserve",
    );

    expect(headcount?.confidence).toBe("high");
    expect(
      generateResponsibilityCards(input(rows)).some(
        (item) => item.id === "need-more-data",
      ),
    ).toBe(false);
  });

  it("同一天多班不會被誤算成多個獨立供餐日", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      observation({
        id: `class-${index}`,
        servedOn: "2026-09-01",
        measurements: [
          measurement("unserved-edible", 150, { id: `unserved-${index}` }),
          measurement("plate-edible", 50, { id: `plate-${index}` }),
        ],
      }),
    );

    const result = analyzeWasteIntelligence({ observations: rows });
    const headcount = result.responsibilityCards.find(
      (item) => item.id === "headcount-reserve",
    );

    expect(result.metrics.independentMealCount).toBe(1);
    expect(headcount?.confidence).toBe("low");
    expect(result.responsibilityCards.at(-1)?.id).toBe("need-more-data");
  });

  it("沒有規則達門檻時不硬找原因，而是要求繼續觀察", () => {
    const rows = repeatedObservations(3, (index) => ({
      plateSampleSupplyG: 1_000,
      measurements: [measurement("plate-edible", 50, { id: `plate-${index}` })],
    }));

    const result = analyzeWasteIntelligence({ observations: rows });

    expect(result.responsibilityCards).toHaveLength(1);
    expect(result.responsibilityCards[0]).toMatchObject({
      id: "need-more-data",
      confidence: "low",
    });
    expect(result.responsibilityCards[0].evidence[0].detail).toContain(
      "沒有其他規則達到行動門檻",
    );
  });
});
