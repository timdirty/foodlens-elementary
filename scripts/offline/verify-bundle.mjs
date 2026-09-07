import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const bundleRoot = path.dirname(fileURLToPath(import.meta.url));
const manifestFile = path.join(bundleRoot, "SHA256SUMS");

function safeTarget(relativePath) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..") ||
    relativePath.includes("\\")
  )
    throw new Error(`SHA256SUMS 含有不安全路徑：${relativePath}`);
  return path.join(bundleRoot, ...relativePath.split("/"));
}

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

function relativePath(file) {
  return path.relative(bundleRoot, file).split(path.sep).join("/");
}

async function listBundleFiles(current = bundleRoot) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const target = path.join(current, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`離線包不可包含符號連結：${relativePath(target)}`);
    if (entry.isDirectory()) files.push(...(await listBundleFiles(target)));
    else if (entry.isFile()) files.push(target);
    else throw new Error(`離線包含有特殊檔案：${relativePath(target)}`);
  }
  return files;
}

try {
  const manifest = await readFile(manifestFile, "utf8");
  const lines = manifest.trim().split("\n").filter(Boolean);
  if (!lines.length) throw new Error("SHA256SUMS 是空的。");
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error(`SHA256SUMS 格式錯誤：${line}`);
    const [, expected, relativePath] = match;
    if (seen.has(relativePath))
      throw new Error(`SHA256SUMS 有重複路徑：${relativePath}`);
    seen.add(relativePath);
    const target = safeTarget(relativePath);
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink())
      throw new Error(`離線包不可包含符號連結：${relativePath}`);
    if (!targetStat.isFile())
      throw new Error(`離線包檔案不完整：${relativePath}`);
    const actual = await sha256(target);
    if (actual !== expected)
      throw new Error(`離線包檔案已變更或損壞：${relativePath}`);
  }
  const actualFiles = (await listBundleFiles())
    .map(relativePath)
    .filter((file) => file !== "SHA256SUMS");
  const extra = actualFiles.filter((file) => !seen.has(file));
  const missing = [...seen].filter((file) => !actualFiles.includes(file));
  if (extra.length || missing.length)
    throw new Error(
      `SHA256SUMS 與實際檔案集合不一致${
        extra.length ? `；未列入：${extra.slice(0, 3).join("、")}` : ""
      }${missing.length ? `；不存在：${missing.slice(0, 3).join("、")}` : ""}`,
    );
  console.log(`FoodLens 離線包 SHA-256 驗證通過：${lines.length} 個檔案`);
} catch (error) {
  console.error(
    `FoodLens 離線包完整性驗證失敗：${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
