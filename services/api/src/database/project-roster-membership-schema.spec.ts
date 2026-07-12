import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("project roster membership schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260713013000_project_roster_membership/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("stores roster assignment separately from project business positions", () => {
    expect(schema).toMatch(/model ProjectRosterMember \{[\s\S]*projectId\s+String/);
    expect(schema).toMatch(/model ProjectRosterMember \{[\s\S]*userId\s+String/);
    expect(schema).toMatch(/model ProjectRosterMember \{[\s\S]*@@unique\(\[projectId, userId\]\)/);
    expect(schema).toMatch(/model ProjectRosterMember \{[\s\S]*@@index\(\[userId\]\)/);
    const model = schema.match(/model ProjectRosterMember \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(model).not.toContain("positionKey");
  });

  it("creates the table and safely backfills existing project position holders", () => {
    expect(migration).toContain('CREATE TABLE "ProjectRosterMember"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectRosterMember_projectId_userId_key"'
    );
    expect(migration).toContain('CREATE INDEX "ProjectRosterMember_userId_idx"');
    expect(migration).toContain('FROM "ProjectMember"');
    expect(migration).toContain('ON CONFLICT ("projectId", "userId") DO NOTHING');
    expect(migration).not.toMatch(/"ProjectRosterMember"[\s\S]*"positionKey"/);
  });
});
