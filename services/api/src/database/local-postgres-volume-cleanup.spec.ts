import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const localRequire = createRequire(__filename);
const { cleanupArrays, listPostgresRunners } = localRequire(
  "../../prisma/verify-disposable-postgres-cleanup.cjs"
) as { cleanupArrays: (source: string) => string[]; listPostgresRunners: () => string[] };

describe("disposable PostgreSQL volume cleanup policy", () => {
  const runners = listPostgresRunners();
  it("covers every current disposable PostgreSQL owner", () => {
    expect(runners.length).toBeGreaterThanOrEqual(33);
  });
  it.each(runners)("%s removes its anonymous volumes with the exact container", (file) => {
    const source = readFileSync(join(process.cwd(), "prisma", file), "utf8");
    const commands = cleanupArrays(source);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toContain('"--volumes"');
      expect(command).toMatch(/\b(?:containerName|containerId|name)\b/u);
      expect(command).not.toContain('"--all"');
    }
    expect(source).not.toMatch(/volume[\s\S]{0,15}prune/u);
  });
});
