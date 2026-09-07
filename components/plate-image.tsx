"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

export function PlateImage({
  blob,
  url,
  alt,
  className = "",
  loading = "lazy",
}: {
  blob?: Blob;
  url?: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const validBlob = blob instanceof Blob ? blob : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  const source = useMemo(
    () => (validBlob ? URL.createObjectURL(validBlob) : url),
    [validBlob, url],
  );
  useEffect(() => {
    if (!validBlob || !source) return;
    return () => URL.revokeObjectURL(source);
  }, [validBlob, source]);
  if (!source || failedSource === source)
    return (
      <div
        className={`image-placeholder ${className}`}
        role="img"
        aria-label={alt}
      >
        圖片暫時無法載入
      </div>
    );
  return (
    <div className={`record-image ${className}`}>
      <Image
        src={source}
        alt={alt}
        fill
        unoptimized={source.startsWith("blob:") || /^https?:\/\//.test(source)}
        sizes="220px"
        loading={loading}
        fetchPriority={loading === "eager" ? "high" : undefined}
        onError={() => setFailedSource(source)}
      />
    </div>
  );
}
