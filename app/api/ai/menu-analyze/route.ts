import { NextResponse } from "next/server";
import { isProcessedFoodLensImage } from "@/lib/image";
import { menuOcrAnalysisSchema } from "@/lib/menu-ocr";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_MULTIPART_BYTES = 4_400_000;
const MAX_PROCESSED_IMAGE_BYTES = 4_000_000;
const PROVIDER_TIMEOUT_MS = 30_000;
const RECOVERY_ACTIONS = ["重試", "人工貼上 OCR 原文", "明確切換 Mock 示範"];

type AnalyzeStage = "auth" | "upload" | "quota" | "provider" | "validation";

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? text);
}

export function isSameOriginMenuOcrRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function safeFailureCode(stage: AnalyzeStage, error: unknown) {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "provider_timeout";
  }
  if (stage === "validation" && error instanceof SyntaxError) {
    return "provider_json_invalid";
  }
  return `${stage}_failed`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const respond = (
    body: unknown,
    status = 200,
    headers?: Record<string, string>,
  ) =>
    NextResponse.json(body, {
      status,
      headers: {
        ...headers,
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return respond(
      {
        error:
          "送出內容過大；請重新選圖，系統會將 5MB 以下原圖處理為 4MB 以下再送出。",
        requestId,
      },
      413,
    );
  }

  if (!isSameOriginMenuOcrRequest(request)) {
    return respond(
      {
        error: "無法確認菜單分析請求來源，請回到 FoodLens 後重試。",
        requestId,
      },
      403,
    );
  }

  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const baseUrl = process.env.AI_BASE_URL;
  const provider = process.env.AI_PROVIDER ?? "openai-compatible";
  if (!apiKey || !model || !baseUrl) {
    return respond(
      {
        error: "真實菜單 OCR 尚未設定；請人工貼上原文，或明確切換 Mock 示範。",
        actions: RECOVERY_ACTIONS,
        requestId,
      },
      503,
    );
  }

  let stage: AnalyzeStage = "auth";
  try {
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
      if (credentialsInvalid) {
        return respond({ error: "教師登入已失效，請重新登入", requestId }, 401);
      }
      throw authError;
    }
    if (!user) {
      return respond({ error: "請先以教師帳號登入", requestId }, 401);
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("school_id,role")
      .eq("user_id", user.id)
      .in("role", ["teacher", "admin"])
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      return respond(
        { error: "此帳號沒有教師或管理員的校園資料權限", requestId },
        403,
      );
    }

    stage = "upload";
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return respond({ error: "缺少菜單圖片", requestId }, 400);
    }
    if (file.size > MAX_PROCESSED_IMAGE_BYTES) {
      return respond(
        {
          error: "圖片處理後仍超過 4MB，請改用解析度較低的照片。",
          requestId,
        },
        413,
      );
    }
    if (!(await isProcessedFoodLensImage(file))) {
      return respond(
        {
          error:
            "圖片未通過安全重編碼檢查；請回到 FoodLens 重新選擇 JPEG、PNG 或 WebP 原圖。",
          requestId,
        },
        400,
      );
    }

    stage = "quota";
    const { data: quotaGranted, error: quotaError } = await supabase.rpc(
      "consume_ai_quota",
      { target_school: membership.school_id },
    );
    if (quotaError) throw quotaError;
    if (quotaGranted !== true) {
      return respond(
        {
          error:
            "真實模型每位教師每分鐘最多分析 10 次，請稍後重試或改用人工輸入。",
          actions: RECOVERY_ACTIONS,
          requestId,
        },
        429,
        { "Retry-After": "60" },
      );
    }

    const dataUrl = `data:${file.type};base64,${Buffer.from(
      await file.arrayBuffer(),
    ).toString("base64")}`;
    const prompt = [
      "讀取這張臺灣校園午餐菜單照片。",
      "只回傳 JSON：rawText 是可辨識原文；extractedLines 僅放菜色，每行保留主食／主菜／副菜／湯品／水果角色前綴；warnings 列出模糊、裁切或無法確定的內容。",
      "不可猜測看不清的菜名，不可輸出姓名、學號或其他個人資料。",
      "schemaVersion 固定為 1。",
    ].join(" ");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    let response: Response;
    stage = "provider";
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "你是 FoodLens 菜單文字初判模組，只輸出可驗證的嚴格 JSON。",
            },
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn("FoodLens menu OCR provider returned an error", {
        requestId,
        status: response.status,
      });
      return respond(
        {
          error: "真實菜單 OCR 暫時無法處理這張圖片",
          actions: RECOVERY_ACTIONS,
          requestId,
        },
        502,
      );
    }

    stage = "validation";
    const providerPayload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = providerPayload.choices?.[0]?.message?.content;
    if (!raw) throw new Error("模型沒有回傳內容");
    const parsed = extractJson(raw) as Record<string, unknown>;
    const result = menuOcrAnalysisSchema.parse({
      ...parsed,
      schemaVersion: "1",
      provider,
      model,
      isMock: false,
      analyzedAt: new Date().toISOString(),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    });
    return respond(result);
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    console.error("FoodLens menu OCR request failed", {
      requestId,
      stage,
      code: safeFailureCode(stage, error),
    });
    const fallback = {
      auth: {
        status: 503,
        message: "校園登入服務暫時無法確認權限，請稍後重試。",
      },
      quota: {
        status: 503,
        message: "真實模型用量服務暫時無法確認，請改用人工輸入。",
      },
      upload: {
        status: 400,
        message: "上傳內容無法解析，請重新選擇菜單圖片。",
      },
      provider: {
        status: 502,
        message: "真實菜單 OCR 暫時無法連線，請稍後重試。",
      },
      validation: {
        status: 422,
        message: "模型回傳格式無法驗證，這次結果沒有寫入菜單。",
      },
    }[stage];
    return respond(
      {
        error: timedOut
          ? "真實菜單 OCR 逾時（30 秒），請改用人工輸入或稍後重試。"
          : fallback.message,
        actions: RECOVERY_ACTIONS,
        requestId,
      },
      timedOut ? 504 : fallback.status,
    );
  }
}
