import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceBundle = path.join(projectRoot, "dist", "foodlens-offline");
const offlineEnvironmentKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_URL",
];

async function assertFile(file, message) {
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    throw new Error(message);
  }
}

async function runNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    stdio: "pipe",
    ...options,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(
      `${args.join(" ")} 失敗${signal ? `（${signal}）` : ""}\n${stdout}${stderr}`,
    );
  }
  return { stdout, stderr };
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("無法取得離線包驗收用備用連接埠");
  }
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForFoodLens(port, child, output, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`離線 server 提前結束\n${output.join("")}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.text();
      if (response.status === 200 && body.includes("FoodLens")) return;
    } catch {
      // The standalone server may still be warming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `離線 server 未在 ${timeoutMs / 1000} 秒內就緒\n${output.join("")}`,
  );
}

async function verifyRepresentativeRoutes(port) {
  const routes = [
    "/",
    "/workflow",
    "/scan",
    "/records",
    "/experiments",
    "/lab",
    "/presentation",
  ];
  let home = "";
  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "text/html" },
    });
    const body = await response.text();
    if (response.status !== 200 || !body.includes("FoodLens"))
      throw new Error(
        `離線代表路由 ${route} 驗收失敗（HTTP ${response.status}）`,
      );
    const robots = response.headers.get("x-robots-tag")?.toLowerCase() ?? "";
    if (!robots.includes("noindex") || !robots.includes("nofollow"))
      throw new Error(`離線代表路由 ${route} 缺少 noindex, nofollow`);
    if (route === "/") home = body;
  }

  const assetPath = home.match(
    /src="([^\"]*\/_next\/static\/[^\"]+\.js)"/,
  )?.[1];
  if (!assetPath)
    throw new Error("離線首頁找不到可驗證的 Next.js JavaScript 資產");
  const assetResponse = await fetch(`http://127.0.0.1:${port}${assetPath}`, {
    signal: AbortSignal.timeout(5_000),
  });
  const asset = await assetResponse.arrayBuffer();
  if (
    assetResponse.status !== 200 ||
    !assetResponse.headers.get("content-type")?.includes("javascript") ||
    asset.byteLength < 1_000
  )
    throw new Error("離線 Next.js JavaScript 資產無法完整載入");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = once(child, "exit");
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, 5_000, "timeout"),
  );
  if ((await Promise.race([stopped, timeout])) === "timeout") {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function verifyPortableBundle() {
  await assertFile(
    path.join(sourceBundle, "server.js"),
    "找不到 dist/foodlens-offline/server.js；請先執行 npm run package:offline。",
  );
  await assertFile(
    path.join(sourceBundle, "SHA256SUMS"),
    "離線包缺少 SHA256SUMS。",
  );

  await runNode([path.join(sourceBundle, "verify-bundle.mjs")], {
    cwd: sourceBundle,
  });

  const temporaryParent = await mkdtemp(
    path.join(tmpdir(), "foodlens-offline-smoke-"),
  );
  const portableBundle = path.join(temporaryParent, "foodlens-offline");
  let server;
  const output = [];
  try {
    await cp(sourceBundle, portableBundle, {
      recursive: true,
      dereference: true,
    });
    const port = await availablePort();
    const environment = { ...process.env };
    for (const key of offlineEnvironmentKeys) delete environment[key];

    server = spawn(
      process.execPath,
      [
        path.join(portableBundle, "start-foodlens.mjs"),
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
      ],
      {
        cwd: portableBundle,
        env: environment,
        stdio: "pipe",
      },
    );
    server.stdout?.on("data", (chunk) => output.push(String(chunk)));
    server.stderr?.on("data", (chunk) => output.push(String(chunk)));

    await waitForFoodLens(port, server, output);
    await runNode(
      [
        path.join(portableBundle, "healthcheck.mjs"),
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
      ],
      { cwd: portableBundle, env: environment },
    );
    await verifyRepresentativeRoutes(port);

    const metadata = JSON.parse(
      await readFile(path.join(portableBundle, "bundle-info.json"), "utf8"),
    );
    if (
      metadata.format !== "foodlens-offline-bundle" ||
      metadata.dataMode !== "demo-local" ||
      !["clean", "dirty", "no-head", "unavailable"].includes(
        metadata.sourceState,
      ) ||
      (metadata.sourceRevision !== null &&
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(metadata.sourceRevision))
    )
      throw new Error("離線包 metadata 不符合 FoodLens Demo 格式");

    console.log(`✓ 離線包完整性通過（SHA-256）`);
    console.log(`✓ 已從系統暫存目錄啟動：http://127.0.0.1:${port}`);
    console.log(
      "✓ 首頁、任務台、掃描、每日紀錄、改善實驗、數據實驗室、簡報與代表 JavaScript 資產皆可載入",
    );
  } finally {
    if (server) await stopChild(server);
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

verifyPortableBundle().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
