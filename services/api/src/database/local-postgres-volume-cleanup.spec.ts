import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const localRequire = createRequire(__filename);
const { cleanupArrays, listPostgresRunners, resolveCleanupArguments } = localRequire(
  "../../prisma/verify-disposable-postgres-cleanup.cjs"
) as {
  cleanupArrays: (source: string) => string[];
  listPostgresRunners: () => string[];
  resolveCleanupArguments: (source: string, variables: Record<string, string>) => string[];
};

describe("disposable PostgreSQL volume cleanup policy", () => {
  const runners = listPostgresRunners();
  it("covers every current disposable PostgreSQL owner", () => {
    expect(runners).toContain("run-contract-classification-local.cjs");
    expect(runners.length).toBeGreaterThanOrEqual(34);
  });

  it.each(["name", "containerName", "containerId"])(
    "reads single and double quoted cleanup arguments for %s without executing source",
    (identifier) => {
      const [command] = cleanupArrays(
        `run('docker', ['--host', endpoint, "rm", '--force', "--volumes", ${identifier}]);`
      );
      expect(command).toBeDefined();
      expect(resolveCleanupArguments(command, {
        endpoint: "unix:///fixture/docker.sock", [identifier]: "this-run-container"
      })).toEqual([
        "--host", "unix:///fixture/docker.sock", "rm", "--force", "--volumes", "this-run-container"
      ]);
    }
  );

  it("keeps string literals separate from identifier substitutions", () => {
    const [command] = cleanupArrays('["rm", "--force", "--volumes", "name"]');
    expect(resolveCleanupArguments(command, { name: "this-run-container" })).toEqual([
      "rm", "--force", "--volumes", "name"
    ]);
  });

  it.each([
    "['rm', '--force', '--volumes', otherContainer]",
    "['rm', '--force', '--volumes', name + '-other']",
    "['rm', '--force', '--volumes', process.exit()]",
    "['rm', '--force', '--volumes', ...containers]"
  ])("rejects cleanup expressions outside the literal allowlist: %s", (source) => {
    expect(() => cleanupArrays(source)).toThrow(/cleanup|清理/u);
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
