/** Keep acceptance tests separate from an operator's open Demo or cloud session. */
export function createE2eRuntime(rawPort = process.env.FOODLENS_E2E_PORT) {
  const value = rawPort ?? "3311";
  if (!/^\d{4,5}$/.test(value))
    throw new Error("FOODLENS_E2E_PORT 必須是 1024–65535 的整數");
  const port = Number(value);
  if (port < 1024 || port > 65535)
    throw new Error("FOODLENS_E2E_PORT 必須是 1024–65535 的整數");
  const baseURL = `http://127.0.0.1:${port}`;
  return {
    baseURL,
    webServer: {
      command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
      url: baseURL,
      // Occupied means stop. Never accept a different app as our test server.
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_APP_URL: baseURL,
        VERCEL_URL: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        SUPABASE_SECRET_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        AI_PROVIDER: "",
        AI_API_KEY: "",
        AI_MODEL: "",
        AI_BASE_URL: "",
      },
    },
  };
}

export function assertFoodLensTestServer(input: {
  status: number;
  contentType: string | null;
  robots: string | null;
  html: string;
}) {
  if (
    input.status !== 200 ||
    !input.contentType?.includes("text/html") ||
    !/<title>FoodLens 食光偵探[｜|]/.test(input.html) ||
    !input.robots?.toLowerCase().includes("noindex") ||
    !input.robots?.toLowerCase().includes("nofollow")
  )
    throw new Error(
      "驗收網址不是預期的 FoodLens，已停止，未執行任何資料寫入測試。",
    );
}
