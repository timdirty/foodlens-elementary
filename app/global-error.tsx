"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("FoodLens root error", error);
  }, [error]);

  return (
    <html lang="zh-Hant">
      <title>FoodLens 系統錯誤</title>
      <body
        style={{
          boxSizing: "border-box",
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f7f3e8",
          color: "#173a2d",
          fontFamily:
            '"Noto Sans TC", ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <main
          style={{
            boxSizing: "border-box",
            width: "min(100%, 560px)",
            padding: "32px",
            border: "1px solid #d9dfd4",
            borderRadius: "24px",
            background: "#fffdf7",
            boxShadow: "0 20px 60px rgba(29, 55, 43, 0.1)",
          }}
        >
          <p style={{ margin: "0 0 12px", color: "#527062", fontWeight: 700 }}>
            FoodLens 系統復原
          </p>
          <h1
            style={{
              margin: "0 0 12px",
              fontSize: "clamp(1.75rem, 5vw, 2.4rem)",
            }}
          >
            系統外殼暫時無法載入
          </h1>
          <p style={{ margin: "0 0 24px", lineHeight: 1.75, color: "#44574e" }}>
            瀏覽器內已保存的示範資料不會因此消失。請先重新載入；若仍無法使用，可回到控制中心重新開始。
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            <button
              type="button"
              onClick={retry}
              style={{
                minHeight: "44px",
                padding: "0 18px",
                border: 0,
                borderRadius: "999px",
                background: "#236445",
                color: "#ffffff",
                font: "inherit",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              重新載入系統
            </button>
            <Link
              href="/"
              style={{
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 18px",
                border: "1px solid #9fb3a7",
                borderRadius: "999px",
                color: "#234e3a",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              回到控制中心
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
