import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function workspaceFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("release boundaries", () => {
  it("keeps local Supabase runtime secrets out of Git", () => {
    const ignore = workspaceFile(".gitignore");
    expect(ignore).toMatch(/^\/supabase\/\.temp\/$/m);
    expect(ignore).toMatch(/^\/supabase\/\.branches\/$/m);
    expect(ignore).toMatch(/^\/playwright\.\*\.tmp\.config\.ts$/m);
  });

  it("keeps credentials and local Supabase state out of Vercel uploads", () => {
    const ignore = workspaceFile(".vercelignore");
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toMatch(/^supabase\/\.temp\/$/m);
    expect(ignore).toMatch(/^supabase\/\.branches\/$/m);
    expect(ignore).toMatch(/^playwright\.\*\.tmp\.config\.ts$/m);
    expect(ignore).toMatch(/^\.vercel\/$/m);
  });

  it("runs both browser engines and database lint in CI", () => {
    const workflow = workspaceFile(".github/workflows/quality.yml");
    expect(workflow).toContain(
      "playwright install --with-deps chromium webkit",
    );
    expect(workflow).toContain("npm audit --audit-level=high");
    expect(workflow).toContain(
      "supabase db lint --local --schema public,private",
    );
  });
});
