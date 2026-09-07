import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import {
  isSameOriginRetentionRequest,
  POST,
} from "@/app/api/retention/execute/route";

const schoolA = "11111111-1111-4111-8111-111111111111";
const schoolB = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

type ServerOptions = {
  authError?: Record<string, unknown> | null;
  memberships?: Array<{ school_id: string; role: string }>;
  membershipError?: Record<string, unknown> | null;
  prepareError?: Record<string, unknown> | null;
  finalizeError?: Record<string, unknown> | null;
};

function configureServer(options: ServerOptions = {}) {
  const limit = vi.fn().mockResolvedValue({
    data: options.memberships ?? [{ school_id: schoolA, role: "admin" }],
    error: options.membershipError ?? null,
  });
  const query = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        limit,
      })),
    })),
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "prepare_data_retention")
      return {
        data: {
          run_id: runId,
          image_paths: [`${schoolA}/plate.webp`],
          batch_limit: 500,
        },
        error: options.prepareError ?? null,
      };
    if (name === "finalize_data_retention")
      return {
        data: {
          id: args.target_run,
          status: args.storage_succeeded ? "completed" : "failed",
        },
        error: options.finalizeError ?? null,
      };
    throw new Error(`unexpected rpc ${name}`);
  });
  const server = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "teacher-1" } },
        error: options.authError ?? null,
      }),
    },
    from: vi.fn(() => query),
    rpc,
  };
  mocks.createServer.mockResolvedValue(server);
  return { limit, rpc, server };
}

function configureAdmin(storageError: Record<string, unknown> | null = null) {
  const remove = vi.fn().mockResolvedValue({ error: storageError });
  const from = vi.fn(() => ({ remove }));
  mocks.createAdmin.mockReturnValue({ storage: { from } });
  return { from, remove };
}

function request(body = JSON.stringify({ retentionDays: 180 })) {
  return new Request("http://localhost/api/retention/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body,
  });
}

describe("正式資料保存期限 route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SECRET_KEY = "server-test-secret";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    configureAdmin();
  });

  afterEach(() => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.restoreAllMocks();
  });

  it("缺少或跨站 Origin 時，在接觸登入與資料清理前拒絕請求", async () => {
    const missingOrigin = new Request(
      "https://foodlens.example/api/retention/execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: 180 }),
      },
    );
    const crossOrigin = new Request(
      "https://foodlens.example/api/retention/execute",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ retentionDays: 180 }),
      },
    );

    expect(isSameOriginRetentionRequest(missingOrigin)).toBe(false);
    expect(isSameOriginRetentionRequest(crossOrigin)).toBe(false);
    expect(
      isSameOriginRetentionRequest(
        new Request("https://foodlens.example/api/retention/execute", {
          method: "POST",
          headers: { Origin: "https://foodlens.example" },
        }),
      ),
    ).toBe(true);

    const missingResponse = await POST(missingOrigin);
    const crossResponse = await POST(crossOrigin);

    expect(missingResponse.status).toBe(403);
    expect(crossResponse.status).toBe(403);
    expect(missingResponse.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("拒絕多校帳號，避免任選第一所學校執行不可逆清理", async () => {
    const { rpc } = configureServer({
      memberships: [
        { school_id: schoolA, role: "admin" },
        { school_id: schoolB, role: "viewer" },
      ],
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("多個校園");
    expect(payload.requestId).toBe(response.headers.get("x-request-id"));
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("不把資料庫內部錯誤內容回傳給瀏覽器，並保留重試與追蹤資訊", async () => {
    configureServer({
      membershipError: {
        code: "XX000",
        name: "PostgrestError",
        message: "internal relation memberships leaked-token-123",
      },
    });

    const response = await POST(request());
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(503);
    expect(payload.error).toContain("權限暫時無法確認");
    expect(payload.actions).toContain("再試一次");
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(serialized).not.toContain("memberships");
    expect(serialized).not.toContain("leaked-token-123");
  });

  it("把保存期限競態轉為可理解的重新預覽提示", async () => {
    configureServer({
      prepareError: {
        code: "40001",
        name: "PostgrestError",
        message: "retention policy changed; internal detail",
      },
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("重新預覽");
    expect(JSON.stringify(payload)).not.toContain("internal detail");
  });

  it("儲存刪除失敗時只保存安全追蹤碼，不保存供應商內部錯誤", async () => {
    const { rpc } = configureServer();
    configureAdmin({
      name: "StorageUnknownError",
      message: "bucket backend secret-host failed",
    });

    const response = await POST(request());
    const payload = await response.json();
    const failureCall = rpc.mock.calls.find(
      ([name, args]) =>
        name === "finalize_data_retention" && args.storage_succeeded === false,
    );

    expect(response.status).toBe(502);
    expect(payload.error).toContain("資料庫判讀仍保留");
    expect(payload.requestId).toBe(response.headers.get("x-request-id"));
    expect(failureCall?.[1].failure_reason).toContain(payload.requestId);
    expect(failureCall?.[1].failure_reason).not.toContain("secret-host");
    expect(JSON.stringify(payload)).not.toContain("secret-host");
  });

  it("成功流程不將伺服器密鑰帶入管理 client 或 HTTP 回應", async () => {
    const { rpc } = configureServer();
    const { remove } = configureAdmin();

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createAdmin).toHaveBeenCalledWith();
    expect(remove).toHaveBeenCalledWith([`${schoolA}/plate.webp`]);
    expect(rpc).toHaveBeenLastCalledWith("finalize_data_retention", {
      target_run: runId,
      storage_succeeded: true,
      failure_reason: null,
    });
    expect(payload.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(payload)).not.toContain("server-test-secret");
  });

  it("破損 JSON 回傳 400，不洩漏解析器訊息或呼叫資料庫", async () => {
    const response = await POST(request("{"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("格式不正確");
    expect(JSON.stringify(payload)).not.toContain("Unexpected end");
    expect(mocks.createServer).not.toHaveBeenCalled();
  });
});
