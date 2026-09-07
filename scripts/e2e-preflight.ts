import type { FullConfig } from "@playwright/test";
import { assertFoodLensTestServer } from "./e2e-runtime";

export default async function preflight(config: FullConfig) {
  const url = new URL(config.projects[0].use.baseURL!);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("驗收僅允許專用的本機 loopback 網址");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assertFoodLensTestServer({
    status: response.status,
    contentType: response.headers.get("content-type"),
    robots: response.headers.get("x-robots-tag"),
    html: await response.text(),
  });
}
