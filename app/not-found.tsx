import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="standalone-state">
      <Compass size={34} aria-hidden="true" />
      <p className="section-kicker">找不到研究頁面</p>
      <h1>這個網址不在 FoodLens 的研究路徑中</h1>
      <p>你可以回到八週研究總覽，再從左側或手機底部選擇要查看的紀錄。</p>
      <Link className="primary-action" href="/">
        <ArrowLeft size={17} />
        回到控制中心
      </Link>
    </main>
  );
}
