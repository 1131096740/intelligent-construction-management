import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { directOutsideOperatingReaderCatalog } from "./contract-direct-outside-operating-reader-catalog";

it("matches only the installed completion trigger body in the archive reader catalog", () => {
  const migration = readFileSync(resolve(__dirname,
    "../../prisma/migrations/20261111090000_contract_direct_archive_outside_operating_claim_completion_v2/migration.sql"
  ), "utf8");
  const postimage = /new_guard TEXT:=\$postimage\$([\s\S]+?)\$postimage\$;/u.exec(migration)?.[1];
  expect(postimage).toBeDefined();
  const postimageDigest = createHash("sha256").update(postimage!).digest("hex");
  const sql = directOutsideOperatingReaderCatalog.text;
  const expectedRow = /'public\.jg_require_direct_outside_operating_completion_v2\(\)'::regprocedure,5,TRUE,'([a-f0-9]{64})'/u;
  expect(sql.match(expectedRow)?.[1]).toBe(postimageDigest);
  expect(sql).not.toContain("201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd");
  expect(sql).toContain("AND 5=(SELECT count(*) FROM expected");
  expect(sql).toMatch(/AND encode\(public\.digest\(convert_to\(f\.prosrc,'UTF8'\),'sha256'\),'hex'\)=x\.body_sha/u);
});
