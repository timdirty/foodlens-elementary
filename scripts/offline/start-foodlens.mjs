import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const bundleRoot = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(bundleRoot, "server.js");
const bundleInfoFile = path.join(bundleRoot, "bundle-info.json");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3) || fallback;
}

// Keep the default private and deterministic. A machine-level HOSTNAME is
// often a container ID or an address that cannot be bound on another laptop.
const host = option("host", "127.0.0.1");
const port = Number(option("port", process.env.PORT || "3000"));

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("連接埠必須是 1024–65535 的整數。");
  process.exit(1);
}

try {
  if (!(await stat(serverFile)).isFile()) throw new Error();
} catch {
  console.error("離線包不完整：找不到 server.js。");
  process.exit(1);
}

try {
  const bundleInfo = JSON.parse(await readFile(bundleInfoFile, "utf8"));
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== bundleInfo.requiredNodeMajor) {
    throw new Error(
      `需要 Node.js ${bundleInfo.requiredNodeMajor}.x，目前是 ${process.versions.node}`,
    );
  }
  if (
    bundleInfo.buildPlatform !== process.platform ||
    bundleInfo.buildArch !== process.arch
  ) {
    throw new Error(
      `此包建置於 ${bundleInfo.buildPlatform}/${bundleInfo.buildArch}，目前電腦是 ${process.platform}/${process.arch}；請在相同平台重新製包`,
    );
  }
} catch (error) {
  console.error(
    `離線包執行環境不相容：${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

const probe = createServer();
probe.once("error", (error) => {
  console.error(
    `無法使用 ${host}:${port}：${error.code === "EADDRINUSE" ? "連接埠已被佔用" : error.message}`,
  );
  process.exit(1);
});
probe.listen(port, host);
await once(probe, "listening");
probe.close();
await once(probe, "close");

const environment = {
  ...process.env,
  NODE_ENV: "production",
  HOSTNAME: host,
  PORT: String(port),
};
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_BASE_URL",
])
  delete environment[key];

console.log(`FoodLens 離線備援啟動中：http://${host}:${port}`);
console.log("此啟動器不讀取 Supabase 或真實 AI 憑證。");

const child = spawn(process.execPath, [serverFile], {
  cwd: bundleRoot,
  env: environment,
  stdio: "inherit",
});

let forwardingSignal = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (forwardingSignal || child.exitCode !== null) return;
    forwardingSignal = true;
    child.kill(signal);
  });
}

child.once("error", (error) => {
  console.error(`FoodLens 離線 server 無法啟動：${error.message}`);
});
const [code, signal] = await once(child, "exit");
if (signal) process.kill(process.pid, signal);
else process.exitCode = code ?? 1;
