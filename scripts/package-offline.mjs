import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundleRoot = path.join(projectRoot, "dist", "foodlens-offline");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const staticRoot = path.join(projectRoot, ".next", "static");
const publicRoot = path.join(projectRoot, "public");
const offlineAssetsRoot = path.join(projectRoot, "scripts", "offline");
const skipBuild = process.argv.includes("--skip-build");

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

function normalizedRelativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function assertDirectory(target, explanation) {
  try {
    if (!(await stat(target)).isDirectory()) throw new Error();
  } catch {
    throw new Error(explanation);
  }
}

async function runBuild() {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const environment = { ...process.env };
  for (const key of offlineEnvironmentKeys) environment[key] = "";

  await new Promise((resolve, reject) => {
    const child = spawn(executable, ["run", "build"], {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Next.js 離線建置失敗${
              signal ? `（signal ${signal}）` : `（exit ${code ?? "unknown"}）`
            }`,
          ),
        );
    });
  });
}

async function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output.join("").trim());
      else reject(new Error(`${command} ${args.join(" ")} failed`));
    });
  });
}

async function sourceIdentity() {
  let status = "";
  try {
    status = await capture("git", ["status", "--porcelain"]);
  } catch {
    return { sourceRevision: null, sourceState: "unavailable" };
  }
  try {
    const revision = await capture("git", ["rev-parse", "--verify", "HEAD"]);
    return {
      sourceRevision: revision,
      sourceState: status ? "dirty" : "clean",
    };
  } catch {
    return { sourceRevision: null, sourceState: "no-head" };
  }
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, target)));
    else if (entry.isFile()) files.push(target);
    else
      throw new Error(
        `離線包含有無法完整性驗證的特殊檔案：${normalizedRelativePath(root, target)}`,
      );
  }
  return files;
}

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function buildManifest() {
  const files = (await listFiles(bundleRoot)).filter(
    (file) => path.basename(file) !== "SHA256SUMS",
  );
  const lines = [];
  for (const file of files) {
    lines.push(
      `${await sha256(file)}  ${normalizedRelativePath(bundleRoot, file)}`,
    );
  }
  await writeFile(
    path.join(bundleRoot, "SHA256SUMS"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  return lines.length;
}

async function packageOfflineBundle() {
  if (!skipBuild) await runBuild();

  await assertDirectory(
    standaloneRoot,
    "找不到 .next/standalone；請先使用 output: standalone 完成 Next.js production build。",
  );
  await assertDirectory(staticRoot, "找不到 .next/static，離線包無法建立。");
  await assertDirectory(publicRoot, "找不到 public 目錄，離線包無法建立。");
  await assertDirectory(
    offlineAssetsRoot,
    "找不到 scripts/offline 啟動與驗證檔案。",
  );

  // This is the only directory the packager replaces. It is generated output
  // and is deliberately ignored by Git.
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });
  await cp(standaloneRoot, bundleRoot, {
    recursive: true,
    dereference: true,
  });
  await cp(staticRoot, path.join(bundleRoot, ".next", "static"), {
    recursive: true,
    dereference: true,
  });
  await cp(publicRoot, path.join(bundleRoot, "public"), {
    recursive: true,
    dereference: true,
  });

  const packagedAssets = [
    ["start-foodlens.mjs", "start-foodlens.mjs"],
    ["healthcheck.mjs", "healthcheck.mjs"],
    ["verify-bundle.mjs", "verify-bundle.mjs"],
    ["OFFLINE-README.md", "OFFLINE-README.md"],
  ];
  for (const [source, destination] of packagedAssets) {
    await cp(
      path.join(offlineAssetsRoot, source),
      path.join(bundleRoot, destination),
    );
  }

  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  const buildId = (
    await readFile(path.join(projectRoot, ".next", "BUILD_ID"), "utf8")
  ).trim();
  const source = await sourceIdentity();
  const bundleInfo = {
    format: "foodlens-offline-bundle",
    formatVersion: 1,
    appVersion: packageJson.version,
    nextVersion: packageJson.dependencies.next,
    buildId,
    ...source,
    requiredNodeMajor: 22,
    buildPlatform: process.platform,
    buildArch: process.arch,
    entrypoint: "server.js",
    defaultUrl: "http://127.0.0.1:3000",
    dataMode: "demo-local",
  };
  await writeFile(
    path.join(bundleRoot, "bundle-info.json"),
    `${JSON.stringify(bundleInfo, null, 2)}\n`,
    "utf8",
  );

  const manifestEntries = await buildManifest();
  console.log(`\n✓ FoodLens 離線包已建立：${bundleRoot}`);
  console.log(`✓ SHA-256 清單已覆蓋 ${manifestEntries} 個檔案`);
}

packageOfflineBundle().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
