function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3) || fallback;
}

const host = option("host", "127.0.0.1");
const port = Number(option("port", "3000"));
const timeoutMs = Number(option("timeout", "5000"));

if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !Number.isFinite(timeoutMs) ||
  timeoutMs < 100
) {
  console.error("健康檢查參數無效。");
  process.exit(1);
}

try {
  const response = await fetch(`http://${host}:${port}/`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "text/html" },
  });
  const body = await response.text();
  if (response.status !== 200)
    throw new Error(`GET / 回傳 HTTP ${response.status}`);
  if (!body.includes("FoodLens"))
    throw new Error("首頁沒有 FoodLens 識別文字，可能連到其他服務。");
  console.log(`FoodLens 健康檢查通過：http://${host}:${port}/ → 200`);
} catch (error) {
  console.error(
    `FoodLens 健康檢查失敗：${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
