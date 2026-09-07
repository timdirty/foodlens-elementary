import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650),
});

type PreparedRun = {
  run_id: string;
  image_paths: string[];
  batch_limit: number;
};

const STORAGE_BATCH_SIZE = 500;
const recoveryActions = ["重新預覽", "再試一次", "提供追蹤碼給系統管理員"];
type ExecutionStage =
  "request" | "auth" | "membership" | "prepare" | "storage" | "finalize";

const preparedRunSchema = z.object({
  run_id: z.string().uuid(),
  image_paths: z.array(z.string()),
  batch_limit: z.number().int().positive().max(STORAGE_BATCH_SIZE),
});

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code);
}

export function isSameOriginRetentionRequest(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });

  if (!isSameOriginRetentionRequest(request))
    return respond(
      { error: "請從 FoodLens 管理頁執行資料清理", requestId },
      403,
    );

  let runId: string | undefined;
  let stage: ExecutionStage = "request";
  try {
    const body = requestSchema.parse(await request.json());
    stage = "auth";
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      const status = "status" in authError ? Number(authError.status) : 0;
      const credentialsInvalid =
        authError.name === "AuthSessionMissingError" ||
        (status >= 400 && status < 500);
      if (!credentialsInvalid) throw authError;
      return respond({ error: "管理員登入已失效，請重新登入", requestId }, 401);
    }
    if (!user)
      return respond({ error: "管理員登入已失效，請重新登入", requestId }, 401);

    stage = "membership";
    const { data: memberships, error: membershipError } = await supabase
      .from("memberships")
      .select("school_id,role")
      .eq("user_id", user.id)
      .limit(2);
    if (membershipError) throw membershipError;
    if ((memberships ?? []).length > 1)
      return respond(
        {
          error:
            "此帳號連結多個校園，為避免清錯資料，請由系統管理員設定單一操作校園後再試。",
          requestId,
        },
        409,
      );
    const membership = memberships?.[0];
    if (!membership || membership.role !== "admin")
      return respond(
        { error: "只有校園管理員可以執行不可逆的正式資料清理", requestId },
        403,
      );

    const hasStorageCredential = Boolean(
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    if (!hasStorageCredential)
      return respond(
        {
          error:
            "正式資料清理尚未啟用伺服器端儲存權限；資料沒有被刪除。請由系統管理員完成 SUPABASE_SECRET_KEY 設定。",
          requestId,
        },
        503,
      );

    const schoolId = String(membership.school_id);
    stage = "prepare";
    const { data: preparedData, error: prepareError } = await supabase.rpc(
      "prepare_data_retention",
      {
        target_school: schoolId,
        expected_retention_days: body.retentionDays,
      },
    );
    if (prepareError) throw prepareError;
    const prepared: PreparedRun = preparedRunSchema.parse(preparedData);
    runId = prepared.run_id;
    const paths = prepared.image_paths;
    if (
      paths.length > prepared.batch_limit ||
      paths.some(
        (path) =>
          !path.startsWith(`${schoolId}/`) ||
          path.includes("../") ||
          path.includes("\\"),
      )
    )
      throw new Error("資料庫回傳的圖片清單未通過校園範圍驗證");

    stage = "storage";
    const admin = createSupabaseAdminClient();
    for (let start = 0; start < paths.length; start += STORAGE_BATCH_SIZE) {
      const batch = paths.slice(start, start + STORAGE_BATCH_SIZE);
      const { error } = await admin.storage.from("plate-images").remove(batch);
      if (error) {
        console.error("FoodLens retention storage deletion failed", {
          requestId,
          runId,
          name: error.name,
          message: error.message,
        });
        const { error: auditError } = await supabase.rpc(
          "finalize_data_retention",
          {
            target_run: runId,
            storage_succeeded: false,
            failure_reason: `圖片儲存清理未完成（追蹤碼 ${requestId}）`,
          },
        );
        if (auditError)
          console.error("FoodLens retention failure audit could not be saved", {
            requestId,
            runId,
            name: auditError.name,
            message: auditError.message,
          });
        return respond(
          {
            error: "圖片清理未完整完成，資料庫判讀仍保留；可重新預覽後再試。",
            actions: recoveryActions,
            requestId,
          },
          502,
        );
      }
    }

    stage = "finalize";
    const { data: result, error: finalizeError } = await supabase.rpc(
      "finalize_data_retention",
      {
        target_run: runId,
        storage_succeeded: true,
        failure_reason: null,
      },
    );
    if (finalizeError) throw finalizeError;
    return respond({ result, requestId });
  } catch (error) {
    console.error("FoodLens retention execution failed", {
      requestId,
      runId,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    const code = errorCode(error);
    const invalidRequest =
      stage === "request" &&
      (error instanceof z.ZodError || error instanceof SyntaxError);
    if (code === "40001")
      return respond(
        {
          error: "保存期限設定已更新，請重新預覽後再試。",
          actions: recoveryActions,
          requestId,
        },
        409,
      );
    if (code === "42501")
      return respond(
        {
          error: "目前帳號沒有執行這次資料清理的權限。",
          requestId,
        },
        403,
      );
    const fallback = {
      request: "保存期限格式不正確，請重新預覽。",
      auth: "校園登入服務暫時無法確認權限，請稍後再試。",
      membership: "校園權限暫時無法確認，請稍後再試。",
      prepare: "清理清單無法安全建立，資料沒有被刪除；請重新預覽後再試。",
      storage: "圖片清理狀態無法確認，資料庫判讀仍保留；請重新預覽後再試。",
      finalize:
        "部分圖片可能已移除，但清理流程尚未確認完成；請重新預覽後再試。",
    }[stage];
    return respond(
      {
        error: fallback,
        actions: invalidRequest ? undefined : recoveryActions,
        requestId,
      },
      invalidRequest
        ? 400
        : stage === "auth" || stage === "membership"
          ? 503
          : 500,
    );
  }
}
