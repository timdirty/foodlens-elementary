import { describe, expect, it } from "vitest";
import { createDemoCircularityTrace } from "@/lib/circularity";
import {
  createCollectionEventRow,
  createDestinationReceiptRow,
  sameCollectionEventMaterial,
  sameDestinationReceiptMaterial,
} from "@/lib/repositories/supabase";

describe("Supabase circularity row contract", () => {
  const schoolId = "aaaaaaaa-0000-4000-8000-000000000001";
  const mealBatchId = "bbbbbbbb-0000-4000-8000-000000000001";
  const collectionId = "cccccccc-0000-4000-8000-000000000001";
  const receiptId = "dddddddd-0000-4000-8000-000000000001";
  const verifierId = "eeeeeeee-0000-4000-8000-000000000001";

  it("keeps planned destination distinct from pickup evidence", () => {
    const event = createDemoCircularityTrace().collectionEvents[0];
    expect(
      createCollectionEventRow(schoolId, event, {
        id: collectionId,
        mealBatchId,
      }),
    ).toMatchObject({
      id: collectionId,
      school_id: schoolId,
      meal_batch_id: mealBatchId,
      status: "collected",
      hauler_name: "示範清運合作單位",
      net_collected_weight_g: 7_600,
      planned_destination_name: "北區有機資源示範場",
      planned_treatment_method: "composting",
      waste_sources: ["preparation", "unserved_edible", "plate_edible"],
    });
  });

  it("writes verified_by only for a verified facility receipt", () => {
    const { destinationReceipts } = createDemoCircularityTrace();
    const verified = createDestinationReceiptRow(
      schoolId,
      { ...destinationReceipts[0], collectionEventId: collectionId },
      { id: receiptId, verifiedBy: verifierId },
    );
    const submitted = createDestinationReceiptRow(
      schoolId,
      { ...destinationReceipts[1], collectionEventId: collectionId },
      { id: receiptId, verifiedBy: verifierId },
    );

    expect(verified).toMatchObject({
      collection_event_id: collectionId,
      status: "verified",
      verified_by: verifierId,
      actual_treatment_method: "anaerobic_digestion",
      accepted_weight_g: 7_420,
    });
    expect(submitted.verified_by).toBeNull();
    expect(submitted.verified_at).toBeNull();
  });

  it("treats a committed final-state retry as idempotent while detecting material changes", () => {
    const { collectionEvents, destinationReceipts } =
      createDemoCircularityTrace();
    const collection = collectionEvents[0];
    expect(
      sameCollectionEventMaterial(collection, {
        ...collection,
        createdAt: "2026-09-04T12:40:00.000+08:00",
        scheduledAt: "2026-09-04T13:10:00.000+08:00",
        collectedAt: "2026-09-04T13:24:00.000+08:00",
        updatedAt: "2026-09-05T02:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      sameCollectionEventMaterial(collection, {
        ...collection,
        netCollectedWeightG: collection.netCollectedWeightG! + 1,
      }),
    ).toBe(false);

    const receipt = destinationReceipts[0];
    expect(
      sameDestinationReceiptMaterial(receipt, {
        ...receipt,
        createdAt: "2026-09-04T14:10:00.000+08:00",
        receivedAt: "2026-09-04T14:02:00.000+08:00",
        verifiedBy: "current-school-user",
        verifiedAt: "2026-09-05T01:30:01.000Z",
        updatedAt: "2026-09-05T01:30:01.000Z",
      }),
    ).toBe(true);
    expect(
      sameDestinationReceiptMaterial(receipt, {
        ...receipt,
        acceptedWeightG: receipt.acceptedWeightG! + 1,
      }),
    ).toBe(false);
  });
});
