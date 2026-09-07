import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("scan upload accessibility contract", () => {
  it("keeps gallery and camera controls visible while both proxy inputs stay out of the tab order", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(dashboard)/scan/page.tsx"),
      "utf8",
    );
    const galleryInput = source.match(
      /<input\s+ref=\{galleryInputRef\}[\s\S]*?\/>/,
    )?.[0];
    const cameraInput = source.match(
      /<input\s+ref=\{cameraInputRef\}[\s\S]*?\/>/,
    )?.[0];

    expect(source).toContain('className="dropzone"');
    expect(source).toContain(
      "onClick={() => galleryInputRef.current?.click()}",
    );
    expect(source).toContain("onClick={() => cameraInputRef.current?.click()}");
    expect(source).toContain("從相簿或檔案選擇");
    expect(source).toContain("使用手機相機拍照");
    for (const proxyInput of [galleryInput, cameraInput]) {
      expect(proxyInput).toContain("tabIndex={-1}");
      expect(proxyInput).toContain('aria-hidden="true"');
      expect(proxyInput).toContain('accept="image/jpeg,image/png,image/webp"');
    }
    expect(galleryInput).not.toContain('capture="environment"');
    expect(cameraInput).toContain('capture="environment"');
  });

  it("passes only the resolver-approved menu candidates to either analysis provider", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(dashboard)/scan/page.tsx"),
      "utf8",
    );

    expect(source).toContain("resolveConfirmedPlateMenuContext({");
    expect(source).toContain(
      "menuCandidates: candidateContextAtStart?.candidates",
    );
    expect(
      source.match(/menuCandidates: candidateContextAtStart\?\.candidates/g),
    ).toHaveLength(2);
  });
});
