import { NextResponse } from "next/server";
import {
  AUTH_CALLBACK_RESPONSE_HEADERS,
  authCallbackDestination,
  isValidAuthCallbackCode,
} from "@/lib/auth-callback";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function callbackRedirect(requestUrl: string, status: "ready" | "error") {
  return NextResponse.redirect(authCallbackDestination(requestUrl, status), {
    status: 303,
    headers: AUTH_CALLBACK_RESPONSE_HEADERS,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (isValidAuthCallbackCode(code)) {
    try {
      const client = await createSupabaseServerClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return callbackRedirect(request.url, "ready");
    } catch {
      /* fall through to a visible admin error */
    }
  }
  return callbackRedirect(request.url, "error");
}
