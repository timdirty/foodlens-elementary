import type { Metadata } from "next";
import localFont from "next/font/local";
import { DataProvider } from "@/components/data-provider";
import "./globals.css";

const notoSans = localFont({
  src: "./fonts/noto-sans-tc-foodlens-vf.woff2",
  variable: "--font-noto-sans-tc",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: [
    "PingFang TC",
    "Microsoft JhengHei",
    "Noto Sans TC",
    "system-ui",
    "sans-serif",
  ],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"),
  ),
  title: {
    default: "FoodLens 食光偵探｜把剩食變成下一餐的證據",
    template: "%s｜FoodLens 食光偵探",
  },
  description:
    "學生確認菜單、分流秤重、修正影像初判、試算供餐並核驗廚餘去向，把「今天剩很多」變成下一餐可討論的證據。",
  robots: { index: false, follow: false },
  openGraph: {
    title: "FoodLens 食光偵探",
    description: "讓剩食，成為下一餐更好的答案",
    images: [
      {
        url: "/brand/field-note-hero.jpg",
        width: 1672,
        height: 941,
        alt: "FoodLens 食光偵探校園剩食研究桌品牌視覺",
      },
    ],
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/brand/field-note-hero.jpg"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className={notoSans.variable}>
      <body>
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
