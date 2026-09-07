import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const healthcheck = path.join(
  projectRoot,
  "scripts",
  "offline",
  "healthcheck.mjs",
);
const bundleVerifier = path.join(
  projectRoot,
  "scripts",
  "offline",
  "verify-bundle.mjs",
);

async function runNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    stdio: "pipe",
    ...options,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

test("healthcheck accepts only a 200 FoodLens page", async (context) => {
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/" ? 200 : 404, {
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(request.url === "/" ? "<title>FoodLens</title>" : "missing");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const result = await runNode([
    healthcheck,
    "--host",
    "127.0.0.1",
    "--port",
    String(address.port),
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /FoodLens .*200/);
});

test("bundle verifier detects a changed packaged file", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "foodlens-hash-test-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await copyFile(bundleVerifier, path.join(fixture, "verify-bundle.mjs"));
  const payload = "FoodLens portable fixture\n";
  await writeFile(path.join(fixture, "payload.txt"), payload, "utf8");
  const hash = createHash("sha256").update(payload).digest("hex");
  const verifier = await readFile(path.join(fixture, "verify-bundle.mjs"));
  const verifierHash = createHash("sha256").update(verifier).digest("hex");
  await writeFile(
    path.join(fixture, "SHA256SUMS"),
    `${hash}  payload.txt\n${verifierHash}  verify-bundle.mjs\n`,
    "utf8",
  );

  const valid = await runNode([path.join(fixture, "verify-bundle.mjs")], {
    cwd: fixture,
  });
  assert.equal(valid.code, 0, valid.stderr);

  await writeFile(path.join(fixture, "payload.txt"), "changed\n", "utf8");
  const changed = await runNode([path.join(fixture, "verify-bundle.mjs")], {
    cwd: fixture,
  });
  assert.notEqual(changed.code, 0);
  assert.match(changed.stderr, /已變更或損壞/);
});

test("bundle verifier rejects unlisted and symbolic-link files", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "foodlens-set-test-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await copyFile(bundleVerifier, path.join(fixture, "verify-bundle.mjs"));
  const payload = "FoodLens portable fixture\n";
  await writeFile(path.join(fixture, "payload.txt"), payload, "utf8");
  const verifier = await readFile(path.join(fixture, "verify-bundle.mjs"));
  await writeFile(
    path.join(fixture, "SHA256SUMS"),
    `${createHash("sha256").update(payload).digest("hex")}  payload.txt\n${createHash("sha256").update(verifier).digest("hex")}  verify-bundle.mjs\n`,
    "utf8",
  );

  await writeFile(path.join(fixture, "unlisted.txt"), "unexpected\n", "utf8");
  const unlisted = await runNode([path.join(fixture, "verify-bundle.mjs")], {
    cwd: fixture,
  });
  assert.notEqual(unlisted.code, 0);
  assert.match(unlisted.stderr, /檔案集合不一致/);

  await rm(path.join(fixture, "unlisted.txt"));
  await symlink("payload.txt", path.join(fixture, "linked.txt"));
  const linked = await runNode([path.join(fixture, "verify-bundle.mjs")], {
    cwd: fixture,
  });
  assert.notEqual(linked.code, 0);
  assert.match(linked.stderr, /不可包含符號連結/);
});
