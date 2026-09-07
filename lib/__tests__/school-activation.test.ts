import { describe, expect, it } from "vitest";
import {
  assessSchoolActivation,
  createSchoolActivationHandoff,
  normalizeSiteOrigin,
} from "@/lib/school-activation";

describe("school activation handoff", () => {
  it("keeps optional AI outside the required readiness score", () => {
    const assessment = assessSchoolActivation({
      supabaseConfigured: true,
      cloudConnected: true,
      storageEvidence: "verified",
      hasRealAiEvidence: false,
    });

    expect(assessment).toMatchObject({
      requiredReady: 4,
      requiredTotal: 4,
      ready: true,
    });
    expect(
      assessment.checks.find((check) => check.id === "real-ai"),
    ).toMatchObject({
      required: false,
      status: "optional",
      statusLabel: "Mock 可完整替代",
    });
  });

  it("does not mark untested private storage as ready", () => {
    const assessment = assessSchoolActivation({
      supabaseConfigured: true,
      cloudConnected: true,
      storageEvidence: "untested",
      hasRealAiEvidence: true,
    });

    expect(assessment).toMatchObject({
      requiredReady: 3,
      requiredTotal: 4,
      ready: false,
    });
    expect(
      assessment.checks.find((check) => check.id === "private-storage"),
    ).toMatchObject({
      status: "verify",
      statusLabel: "需用一張測試餐盤驗證",
    });
  });

  it("creates a deployable handoff without secrets and safely quotes school names", () => {
    const handoff = createSchoolActivationHandoff({
      siteOrigin: "https://operator:secret@foodlens.example/path?q=1",
      schoolName: "光明'國小\n第二行",
      generatedAt: "2026-08-31T12:00:00.000Z\nignored",
    });

    expect(handoff).toContain("站點：https://foodlens.example");
    expect(handoff).toContain(
      "Redirect URL：https://foodlens.example/auth/callback",
    );
    expect(handoff).toContain(
      "values ('光明''國小 第二行', 'Asia/Taipei', 'TWD')",
    );
    expect(handoff).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(handoff).toContain("AI_API_KEY");
    expect(handoff).not.toContain("operator:secret");
    expect(handoff).not.toContain("service_role");
    expect(handoff).toContain("產生時間：2026-08-31T12:00:00.000Z ignored");
    expect(handoff).not.toContain("12:00:00.000Z\nignored");
  });

  it("falls back to a safe placeholder for non-http origins", () => {
    expect(normalizeSiteOrigin("javascript:alert(1)")).toBe(
      "https://your-foodlens-domain.example",
    );
  });
});
