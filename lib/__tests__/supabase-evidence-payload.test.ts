import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collectLowConfidenceAcceptances,
  confirmMenuVersion,
  importMenuVersion,
  type MenuImportSource,
} from "@/lib/menu-intelligence";
import { createDemoEvidenceCases } from "@/lib/evidence-chain";
import {
  createEvidenceChainPayload,
  createPlateScanCorrectionNotesPayload,
  createPlateScanMenuContextAssertion,
  MAX_SCAN_CORRECTION_NOTE_CHARACTERS,
  persistedPlateScanMenuContext,
  evidenceCasesFromRows,
  SupabaseRepository,
} from "@/lib/repositories/supabase";

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const CLASS_ID = "22222222-2222-4222-8222-222222222222";

describe("Supabase meal evidence payload", () => {
  it.each(["not-collected", "legacy-unverified"] as const)(
    "%s 狀態不製造投票列且保存 nullable 與原值",
    async (status) => {
      const original = createDemoEvidenceCases()[0];
      const reasonCounts = Object.fromEntries(
        Object.entries(original.reasonCounts).map(([key, count]) => [
          key,
          status === "not-collected" ? null : count,
        ]),
      ) as typeof original.reasonCounts;
      const payload = await createEvidenceChainPayload(SCHOOL_ID, {
        ...original,
        classId: CLASS_ID,
        reasonCollectionStatus: status,
        reasonCounts,
        teacherContext: {
          ...original.teacherContext,
          deliveryStatus: status,
          temperatureStatus: status,
          deliveryDelayMinutes: status === "not-collected" ? null : 5,
          temperatureConcern: status === "not-collected" ? null : false,
        },
      });
      expect(payload.feedback).toEqual([]);
      expect(payload.audit_payload.reasonCollectionStatus).toBe(status);
      expect(
        payload.contexts.find((item) => item.context_type === "operational"),
      ).toMatchObject({
        status: "recorded",
        context_value: {
          feedback_schema_version: 2,
          reason_collection_status: status,
          reason_counts: reasonCounts,
          delivery_status: status,
          temperature_status: status,
          delivery_delay_minutes: status === "not-collected" ? null : 5,
          temperature_concern: status === "not-collected" ? null : false,
        },
      });
    },
  );
  it("已收集 0 票與已觀察 0 分鐘／false 保留明確身分", async () => {
    const original = createDemoEvidenceCases()[0];
    const payload = await createEvidenceChainPayload(SCHOOL_ID, {
      ...original,
      classId: CLASS_ID,
      reasonCounts: {
        portion: 0,
        taste: 0,
        texture: 0,
        temperature: 0,
        time: 0,
        other: 0,
      },
      teacherContext: {
        ...original.teacherContext,
        deliveryDelayMinutes: 0,
        temperatureConcern: false,
      },
    });
    expect(payload.feedback).toEqual([]);
    expect(
      payload.contexts.find((item) => item.context_type === "operational"),
    ).toMatchObject({
      status: "confirmed",
      context_value: {
        reason_collection_status: "collected",
        delivery_delay_minutes: 0,
        temperature_concern: false,
      },
    });
  });
  it("雲端舊快照 hydrate 保留舊值但不推定收集或觀察", () => {
    const raw = structuredClone(
      createDemoEvidenceCases()[0],
    ) as unknown as Record<string, unknown>;
    delete raw.feedbackSchemaVersion;
    delete raw.reasonCollectionStatus;
    const teacher = raw.teacherContext as Record<string, unknown>;
    delete teacher.deliveryStatus;
    delete teacher.temperatureStatus;
    const before = structuredClone(raw);
    const [hydrated] = evidenceCasesFromRows([
      { id: "legacy", audit_payload: raw },
    ]);
    expect(hydrated.feedbackSchemaVersion).toBe(2);
    expect(hydrated.reasonCollectionStatus).toBe("legacy-unverified");
    expect(hydrated.teacherContext.deliveryStatus).toBe("legacy-unverified");
    expect(hydrated.teacherContext.temperatureStatus).toBe("legacy-unverified");
    expect(hydrated.reasonCounts).toEqual(raw.reasonCounts);
    expect(raw).toEqual(before);
  });
  it.each([
    { data: 1, error: null },
    { data: null, error: { message: "missing RPC" } },
  ])("舊後端先失敗而非讀取或寫入新版快照", async (response) => {
    const membership = {
      select: () => membership,
      eq: () => membership,
      order: () => membership,
      limit: async () => ({
        data: [{ school_id: SCHOOL_ID, role: "teacher" }],
        error: null,
      }),
    };
    const rpc = vi.fn().mockResolvedValue(response);
    const from = vi.fn().mockReturnValue(membership);
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: { id: "teacher" } },
          error: null,
        }),
      },
      from,
      rpc,
    } as unknown as SupabaseClient;
    const repository = new SupabaseRepository(client);
    await expect(repository.getSnapshot()).rejects.toThrow("回饋收集狀態 v2");
    await expect(
      repository.saveEvidenceCase(createDemoEvidenceCases()[0]),
    ).rejects.toThrow("回饋收集狀態 v2");
    expect(from.mock.calls).toEqual([["memberships"]]);
    expect(
      rpc.mock.calls.every(
        ([name]) => name === "foodlens_feedback_contract_version",
      ),
    ).toBe(true);
  });
  it("只在呼叫端提供註記時加入 correction_notes，避免改寫舊重試指紋", () => {
    expect(createPlateScanCorrectionNotesPayload(undefined, 2)).toEqual({});
    expect(createPlateScanCorrectionNotesPayload(["份量修正"], 2)).toEqual({
      correction_notes: ["份量修正", null],
    });
  });

  it("保留索引對齊的修正註記，並以 Unicode 字元數限制長度", () => {
    const maximumLengthNote = "餐".repeat(MAX_SCAN_CORRECTION_NOTE_CHARACTERS);

    expect(
      createPlateScanCorrectionNotesPayload(
        [maximumLengthNote, "學生以秤重結果修正"],
        2,
      ),
    ).toEqual({
      correction_notes: [maximumLengthNote, "學生以秤重結果修正"],
    });
    expect(() =>
      createPlateScanCorrectionNotesPayload(
        ["餐".repeat(MAX_SCAN_CORRECTION_NOTE_CHARACTERS + 1)],
        1,
      ),
    ).toThrow(`不可超過 ${MAX_SCAN_CORRECTION_NOTE_CHARACTERS} 個字`);
  });

  it("拒絕無法與 correction 索引一一對齊的額外註記", () => {
    expect(() =>
      createPlateScanCorrectionNotesPayload(["第一筆", "多出的第二筆"], 1),
    ).toThrow("修正註記數量不可超過餐盤辨識結果");
  });

  it("菜單候選 assertion 不讓瀏覽器指定資料庫版本 ID", () => {
    expect(
      createPlateScanMenuContextAssertion({
        menuVersionId: "client-local-menu-id",
        menuVersionSignature: "confirmed-menu-signature-v1",
        candidateCount: 3,
      }),
    ).toEqual({
      menu_version_signature: "confirmed-menu-signature-v1",
      candidate_count: 3,
    });
    expect(createPlateScanMenuContextAssertion(null)).toBeUndefined();
  });

  it("將完整資料庫菜單候選欄位映射成掃描稽核脈絡", () => {
    expect(
      persistedPlateScanMenuContext({
        id: "scan-menu-context",
        menu_context_version_id: "aaaaaaaa-7000-4700-8700-000000000001",
        menu_context_signature: "confirmed-menu-signature-v1",
        menu_context_candidate_count: 3,
      }),
    ).toEqual({
      menuVersionId: "aaaaaaaa-7000-4700-8700-000000000001",
      menuVersionSignature: "confirmed-menu-signature-v1",
      candidateCount: 3,
    });
    expect(persistedPlateScanMenuContext({ id: "legacy-scan" })).toBeNull();
  });

  it("不會把資料庫半套菜單欄位降級成看似完整的證據", () => {
    expect(() =>
      persistedPlateScanMenuContext({
        id: "broken-scan",
        menu_context_version_id: "aaaaaaaa-7000-4700-8700-000000000001",
        menu_context_signature: null,
        menu_context_candidate_count: 3,
      }),
    ).toThrow("菜單候選稽核資料不完整");
  });

  it("在呼叫 RPC 前拒絕非資料庫班級識別碼", async () => {
    await expect(
      createEvidenceChainPayload(SCHOOL_ID, createDemoEvidenceCases()[0]),
    ).rejects.toThrow("資料庫班級識別碼");
  });

  it.each([
    ["demo", "demo"],
    ["ocr", "estimated"],
    ["structured", "official"],
    ["csv", "official"],
  ] as const)(
    "%s 菜單依自身來源寫入 %s provenance，不沿用剩食案件來源",
    async (source, expectedProvenance) => {
      const original = createDemoEvidenceCases()[0];
      const common = {
        menuId: `provenance-${source}`,
        servedOn: original.servedOn,
        importedAt: original.createdAt,
        sourceName: `測試 ${source} 來源`,
      };
      const sourceInputs: Record<
        MenuImportSource,
        Parameters<typeof importMenuVersion>[0][number]
      > = {
        demo: {
          source: "demo",
          ...common,
          fingerprint: "provenance-demo",
        },
        ocr: {
          source: "ocr",
          ...common,
          rawText: "主食：糙米飯\n主菜：咖哩雞丁",
          provider: "test-ocr",
          model: "test-v1",
          isMock: false,
        },
        structured: {
          source: "structured",
          ...common,
          dishes: [
            {
              rawName: "咖哩雞丁",
              role: "main",
              category: "meat",
              cookingMethod: "stewed",
              portionG: 85,
              recipeVersion: "v1",
              vendorId: "vendor-a",
            },
          ],
        },
        csv: {
          source: "csv",
          ...common,
          csvText:
            "菜色名稱,角色,類別,烹調法,份量,食譜版本,供應商\n咖哩雞丁,主菜,肉類,燉,85,v1,vendor-a",
        },
      };
      const draft = importMenuVersion([sourceInputs[source]]);
      const menuVersion = confirmMenuVersion(draft, {
        reviewedBy: "測試教師",
        reviewedAt: original.updatedAt,
        acceptedLowConfidence: collectLowConfidenceAcceptances(draft),
      });

      const payload = await createEvidenceChainPayload(SCHOOL_ID, {
        ...original,
        classId: CLASS_ID,
        menuVersion,
      });

      expect(payload.menu_version.provenance).toBe(expectedProvenance);
      expect(
        payload.menu_items.every(
          (item) => item.provenance === expectedProvenance,
        ),
      ).toBe(true);
      expect(payload.contexts.every((item) => item.provenance === "demo")).toBe(
        true,
      );
    },
  );

  it("長菜單摘要符合資料庫上限，完整菜色仍保留在 audit payload", async () => {
    const original = createDemoEvidenceCases()[0];
    const draftMenu = importMenuVersion([
      {
        source: "structured",
        menuId: "long-menu",
        servedOn: original.servedOn,
        importedAt: original.createdAt,
        sourceName: "上限測試",
        dishes: Array.from({ length: 30 }, (_, index) => ({
          rawName: `${String(index + 1).padStart(2, "0")}號${"校園午餐菜色".repeat(18)}`,
          role: index === 0 ? ("staple" as const) : ("side" as const),
          category: index === 0 ? ("rice" as const) : ("vegetable" as const),
          cookingMethod: "steamed" as const,
          recipeVersion: `v${index + 1}`,
        })),
      },
    ]);
    const menuVersion = confirmMenuVersion(draftMenu, {
      reviewedBy: "測試教師",
      reviewedAt: original.updatedAt,
      acceptedLowConfidence: collectLowConfidenceAcceptances(draftMenu),
    });
    const evidenceCase = {
      ...original,
      classId: CLASS_ID,
      menuVersion,
    };

    const payload = await createEvidenceChainPayload(SCHOOL_ID, evidenceCase);

    expect(Array.from(payload.menu_version.title)).toHaveLength(200);
    expect(payload.menu_version.title.endsWith("…")).toBe(true);
    expect(payload.audit_payload.menuVersion.plannedDishes).toHaveLength(30);
    expect(
      payload.audit_payload.menuVersion.plannedDishes[29].rawName,
    ).toContain("30號");
  });

  it("擴充匿名原因不會無聲消失，決策角色也會進正規化資料", async () => {
    const original = createDemoEvidenceCases()[2];
    const evidenceCase = {
      ...original,
      classId: CLASS_ID,
      reasonCounts: {
        portion: 0,
        taste: 0,
        texture: 0,
        temperature: 0,
        time: 0,
        other: 1,
        nutrition: 2,
        social: 3,
      },
    };

    const payload = await createEvidenceChainPayload(SCHOOL_ID, evidenceCase);
    const feedback = new Map(
      payload.feedback.map((item) => [item.reason_code, item]),
    );

    expect(feedback.get("nutrition")?.response_count).toBe(2);
    expect(feedback.get("other")?.response_count).toBe(4);
    expect(feedback.get("other")?.note).toContain("social");
    expect(payload.human_decision?.decided_by_role).toBe("dietitian");
  });

  it("不會用班級供應重量冒充通知、計畫、生產或交貨階段的量測", async () => {
    const original = createDemoEvidenceCases()[0];
    const payload = await createEvidenceChainPayload(SCHOOL_ID, {
      ...original,
      classId: CLASS_ID,
    });

    expect(payload.meal_batch).toMatchObject({
      status: "closed",
      actual_people: original.actualDiners,
      served_weight_g:
        original.suppliedEdibleG -
        original.measurements
          .filter((item) => item.source === "unserved-edible")
          .reduce((sum, item) => sum + item.netG, 0),
    });
    expect(payload.meal_batch.notified_people).toBeUndefined();
    expect(payload.meal_batch.planned_supply_g).toBeUndefined();
    expect(payload.meal_batch.produced_weight_g).toBeUndefined();
    expect(payload.meal_batch.delivered_weight_g).toBeUndefined();
  });
});
