import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("organization directory schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260711130000_organization_directory_foundation/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("adds compatible user and department directory fields", () => {
    expect(schema).toMatch(/departmentId\s+String\?/);
    expect(schema).toContain("parentId  String?");
    expect(schema).toContain("isActive  Boolean  @default(true)");
    expect(migration).toContain('ALTER TABLE "Department"');
    expect(migration).toContain('ADD COLUMN "parentId" TEXT');
    expect(migration).toContain('ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true');
    expect(migration).toContain('ALTER TABLE "User" ADD COLUMN "departmentId" TEXT');
  });

  it("indexes directory lookup fields without rewriting historical data", () => {
    expect(schema).toContain("@@index([departmentId])");
    expect(schema).toContain("@@index([parentId])");
    expect(migration).toContain('CREATE INDEX "Department_parentId_idx"');
    expect(migration).toContain('CREATE INDEX "User_departmentId_idx"');
    expect(migration).not.toMatch(/\bUPDATE\s+"(?:Department|User)"/i);
  });
});
