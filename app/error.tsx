"use client";

import { useEffect } from "react";
import Link from "next/link";
import { House, RefreshCw } from "lucide-react";
import { ErrorState } from "@/components/ui/page";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("FoodLens route error", error);
  }, [error]);

  return (
    <div className="page-wrap">
      <ErrorState
        title="這個畫面暫時無法完成"
        description="已保存的餐期資料不會因此消失。請重新載入這個畫面；若問題持續，可回到控制中心或由教師匯出備份檢查。"
        actions={
          <>
            <button className="primary-action" type="button" onClick={retry}>
              <RefreshCw size={17} />
              重新載入畫面
            </button>
            <Link className="secondary-action" href="/">
              <House size={17} />
              回到控制中心
            </Link>
          </>
        }
      />
    </div>
  );
}
