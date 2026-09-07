import { describe, expect, it } from "vitest";
import {
  collectionEventSchema,
  collectionReceiptWeightDifference,
  createDemoCircularityTrace,
  destinationReceiptSchema,
  upsertCollectionEvent,
  upsertDestinationReceipt,
  verifiedOutcome,
} from "@/lib/circularity";
import { MemoryFoodLensRepository } from "@/lib/repositories/memory";

describe("廚餘清運與最終去向證據", () => {
  it("固定 Demo 同時涵蓋 verified、submitted、scheduled 三種流程狀態", () => {
    const trace = createDemoCircularityTrace();
    expect(trace.collectionEvents).toHaveLength(3);
    expect(trace.destinationReceipts).toHaveLength(2);
    expect(trace.collectionEvents.map((event) => event.status).sort()).toEqual([
      "collected",
      "collected",
      "scheduled",
    ]);
    expect(
      trace.destinationReceipts.map((receipt) => receipt.status).sort(),
    ).toEqual(["submitted", "verified"]);
  });

  it("清運提早到達是有效實況，不會被誤判成壞資料", () => {
    const { collectionEvents } = createDemoCircularityTrace();
    const scheduled = collectionEvents[2];
    expect(() =>
      collectionEventSchema.parse({
        ...scheduled,
        status: "collected",
        collectedAt: "2026-10-02T05:00:00.000Z",
        haulerName: "示範清運單位",
        netCollectedWeightG: 6_800,
        updatedAt: "2026-10-02T05:01:00.000Z",
      }),
    ).not.toThrow();
  });

  it("未核驗收據不能產生實際處理宣稱", () => {
    const { destinationReceipts } = createDemoCircularityTrace();
    const submitted = destinationReceipts.find(
      (receipt) => receipt.status === "submitted",
    );
    const verified = destinationReceipts.find(
      (receipt) => receipt.status === "verified",
    );
    expect(verifiedOutcome(submitted)).toBeUndefined();
    expect(verifiedOutcome(verified)?.treatmentMethod).toBe(
      "anaerobic_digestion",
    );
  });

  it("核驗收據必須有處理方式、正重量、核驗者與時間", () => {
    const { destinationReceipts } = createDemoCircularityTrace();
    const submitted = destinationReceipts.find(
      (receipt) => receipt.status === "submitted",
    )!;
    expect(() =>
      destinationReceiptSchema.parse({
        ...submitted,
        status: "verified",
      }),
    ).toThrow();
  });

  it("正式收據沒有原文件 SHA-256 指紋時不可升級為已核驗", () => {
    const { destinationReceipts } = createDemoCircularityTrace();
    const submitted = destinationReceipts.find(
      (receipt) => receipt.status === "submitted",
    )!;
    expect(() =>
      destinationReceiptSchema.parse({
        ...submitted,
        status: "verified",
        actualTreatmentMethod: "composting",
        acceptedWeightG: 6_900,
        verifiedBy: "teacher-id",
        verifiedAt: "2026-09-18T07:00:00.000Z",
        provenance: "official",
      }),
    ).toThrow("SHA-256");
  });

  it("同餐期任一來源重疊都會阻擋，但取消安排會釋放來源", () => {
    const { collectionEvents } = createDemoCircularityTrace();
    const scheduled = collectionEvents[2];
    expect(() =>
      upsertCollectionEvent(collectionEvents, {
        ...scheduled,
        id: "overlapping-route",
        wasteSources: ["plate_edible", "inedible"],
        createdAt: "2026-10-02T04:45:00.000Z",
        updatedAt: "2026-10-02T04:45:00.000Z",
      }),
    ).toThrow("不可重複分派");

    const cancelled = collectionEventSchema.parse({
      ...scheduled,
      status: "cancelled",
      updatedAt: "2026-10-02T04:45:00.000Z",
    });
    const afterCancellation = upsertCollectionEvent(
      collectionEvents,
      cancelled,
    );
    expect(() =>
      upsertCollectionEvent(afterCancellation, {
        ...scheduled,
        id: "replacement-route",
        wasteSources: ["plate_edible"],
        createdAt: "2026-10-02T04:46:00.000Z",
        updatedAt: "2026-10-02T04:46:00.000Z",
      }),
    ).not.toThrow();
  });

  it("重量差異只在校方交接與處理場收據都具證據時提供", () => {
    const { collectionEvents, destinationReceipts } =
      createDemoCircularityTrace();
    const verifiedEvent = collectionEvents[0];
    const verifiedReceipt = destinationReceipts[0];
    expect(
      collectionReceiptWeightDifference(verifiedEvent, verifiedReceipt),
    ).toMatchObject({
      collectedWeightG: 7_600,
      acceptedWeightG: 7_420,
      differenceG: -180,
    });
    expect(
      collectionReceiptWeightDifference(
        collectionEvents[1],
        destinationReceipts[1],
      ),
    ).toBeUndefined();
  });

  it("完成狀態不可退回，也不可用相同狀態改寫內容", () => {
    const { collectionEvents, destinationReceipts } =
      createDemoCircularityTrace();
    expect(() =>
      upsertCollectionEvent(collectionEvents, {
        ...collectionEvents[0],
        status: "scheduled",
        updatedAt: "2026-09-05T02:00:00.000Z",
      }),
    ).toThrow("不可改寫");
    expect(() =>
      upsertDestinationReceipt(destinationReceipts, {
        ...destinationReceipts[0],
        facilityName: "另一處理場",
      }),
    ).toThrow("不可改寫");
  });

  it("待核驗收據可填寫原因退回，退回後內容不可改寫", () => {
    const { destinationReceipts } = createDemoCircularityTrace();
    const submitted = destinationReceipts.find(
      (receipt) => receipt.status === "submitted",
    )!;
    const rejected = destinationReceiptSchema.parse({
      ...submitted,
      status: "rejected",
      rejectionReason: "收料重量與原始入場單不符",
      updatedAt: "2026-09-18T07:00:00.000Z",
    });
    const afterRejection = upsertDestinationReceipt(
      destinationReceipts,
      rejected,
    );
    expect(
      afterRejection.find((receipt) => receipt.id === rejected.id),
    ).toEqual(rejected);
    expect(() =>
      upsertDestinationReceipt(afterRejection, {
        ...rejected,
        rejectionReason: "事後改寫原因",
        updatedAt: "2026-09-18T07:01:00.000Z",
      }),
    ).toThrow("不可改寫");
  });

  it("Memory repository 保存清運與收據後可重新讀取", async () => {
    const repository = new MemoryFoodLensRepository();
    const snapshot = await repository.getSnapshot();
    const scheduled = snapshot.collectionEvents.find(
      (event) => event.status === "scheduled",
    )!;
    const collected = collectionEventSchema.parse({
      ...scheduled,
      status: "collected",
      collectedAt: "2026-10-02T05:00:00.000Z",
      haulerName: "示範清運單位",
      netCollectedWeightG: 6_800,
      updatedAt: "2026-10-02T05:01:00.000Z",
    });
    await repository.saveCollectionEvent(collected);
    const receipt = destinationReceiptSchema.parse({
      id: "memory-receipt",
      collectionEventId: collected.id,
      receiptReference: "MEMORY-RC-1",
      facilityName: "示範處理場",
      actualTreatmentMethod: "composting",
      acceptedWeightG: 6_700,
      receivedAt: "2026-10-02T06:00:00.000Z",
      status: "submitted",
      provenance: "demo",
      createdAt: "2026-10-02T06:01:00.000Z",
      updatedAt: "2026-10-02T06:01:00.000Z",
    });
    await repository.saveDestinationReceipt(receipt);
    const reloaded = await repository.getSnapshot();
    expect(
      reloaded.collectionEvents.find((event) => event.id === collected.id)
        ?.status,
    ).toBe("collected");
    expect(
      reloaded.destinationReceipts.find((item) => item.id === receipt.id),
    ).toEqual(receipt);
  });

  it("repository 不接受尚未交接的清運事件掛上處理場收據", async () => {
    const repository = new MemoryFoodLensRepository();
    const snapshot = await repository.getSnapshot();
    const scheduled = snapshot.collectionEvents.find(
      (event) => event.status === "scheduled",
    )!;
    const submitted = destinationReceiptSchema.parse({
      id: "premature-receipt",
      collectionEventId: scheduled.id,
      receiptReference: "PREMATURE-RC-1",
      facilityName: "示範處理場",
      actualTreatmentMethod: "unknown",
      receivedAt: "2026-10-02T06:00:00.000Z",
      status: "submitted",
      provenance: "demo",
      createdAt: "2026-10-02T06:01:00.000Z",
      updatedAt: "2026-10-02T06:01:00.000Z",
    });

    await expect(repository.saveDestinationReceipt(submitted)).rejects.toThrow(
      "尚未完成",
    );
  });
});
