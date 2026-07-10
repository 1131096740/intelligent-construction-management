import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("FileObject integrity metadata schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260710170000_file_integrity_metadata/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const fileObject = schema.match(/model FileObject \{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("keeps historical hashes nullable and gives new storage records an active status", () => {
    expect(fileObject).toMatch(/contentSha256\s+String\?/);
    expect(fileObject).toMatch(/storageStatus\s+String\s+@default\("active"\)/);
    expect(fileObject).toMatch(/supersedesFileObjectId\s+String\?/);
  });

  it("defines a self replacement relation that preserves descendants when an old row is deleted", () => {
    expect(fileObject).toMatch(
      /supersedesFileObject\s+FileObject\?\s+@relation\("FileObjectReplacement", fields: \[supersedesFileObjectId\], references: \[id\], onDelete: SetNull\)/
    );
    expect(fileObject).toMatch(
      /supersededByFileObjects\s+FileObject\[\]\s+@relation\("FileObjectReplacement"\)/
    );
  });

  it("indexes the replacement pointer and storage status", () => {
    expect(fileObject).toContain("@@index([supersedesFileObjectId])");
    expect(fileObject).toContain("@@index([storageStatus])");
  });

  it("adds only compatible metadata columns, the self foreign key, and the two indexes", () => {
    expect(migration).toMatch(/ADD COLUMN\s+"contentSha256" TEXT(?:,|;)/);
    expect(migration).toMatch(
      /ADD COLUMN\s+"storageStatus" TEXT NOT NULL DEFAULT 'active'(?:,|;)/
    );
    expect(migration).toMatch(/ADD COLUMN\s+"supersedesFileObjectId" TEXT(?:,|;)/);
    expect(migration).toContain(
      'FOREIGN KEY ("supersedesFileObjectId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE'
    );
    expect(migration).toContain('CREATE INDEX "FileObject_supersedesFileObjectId_idx"');
    expect(migration).toContain('CREATE INDEX "FileObject_storageStatus_idx"');
    expect(migration).not.toMatch(/contentSha256" TEXT NOT NULL/);
    expect(migration).not.toMatch(/\bUPDATE\s+"FileObject"/i);
  });
});
