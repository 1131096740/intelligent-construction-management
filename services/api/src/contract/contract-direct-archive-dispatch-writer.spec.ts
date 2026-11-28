import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { directDispatchBuiltinWriterIsUnreachable, directDispatchLegacySlotReads } from "./contract-direct-archive-dispatch-qualification";

const compact = (value: string) => value.replace(/\s+/gu, " ").trim();
const migration = readFileSync(resolve(__dirname, "../../prisma/migrations/20261109190000_contract_direct_archive_dispatch_install_v1/migration.sql"), "utf8");

it("excludes only the fixed builtin after matching the installer identity and unreachable checks", () => {
  const witness = compact(directDispatchBuiltinWriterIsUnreachable.text);
  const block = migration.split("IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=6182")[1]
    .split("THEN")[0];
  expect(witness).toBe(compact("EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=6182" +
    block.replace(/OR EXISTS/gu, "AND NOT EXISTS")));
  expect(directDispatchBuiltinWriterIsUnreachable.values).toEqual([]);
});

it("retains all column-read obligations for every other effective writer", () => {
  const guard = compact(directDispatchLegacySlotReads.text);
  expect(guard).toContain(compact(directDispatchBuiltinWriterIsUnreachable.text) + " AND NOT EXISTS");
  expect(guard).toContain("WHERE r.oid<>6182");
  expect(guard).toContain("has_table_privilege(r.oid,'public.\"ContractDraftAttachment\"'::regclass,'INSERT,UPDATE,DELETE')");
  expect(guard).toContain("has_any_column_privilege(r.oid,'public.\"ContractDraftAttachment\"'::regclass,'INSERT,UPDATE')");
  expect(guard).toContain("ARRAY['id','contractId','draftData']");
  expect(guard).toContain("has_column_privilege(r.oid,'public.\"ContractVersion\"'::regclass,fields.name,'SELECT') IS DISTINCT FROM TRUE");
});
