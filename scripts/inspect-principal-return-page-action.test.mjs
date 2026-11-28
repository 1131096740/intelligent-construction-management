import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { proveReadOnlyPrincipalReturnResult } from "./lib/whole-site-page-action-manifest.mjs";

const controller = "services/api/src/fund-account/fund-principal-return.controller.ts";
const service = "services/api/src/fund-account/fund-principal-return.service.ts";

test("principal return lookup proves the real actor-scoped read-only route", async () => {
  assert.equal(await proveReadOnlyPrincipalReturnResult(process.cwd()), true);
});

test("principal return lookup rejects a mutation or omission of the receipt's actor scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "principal-return-lookup-"));
  try {
    await mkdir(dirname(join(root, service)), { recursive: true });
    await writeFile(join(root, controller), await readFile(controller, "utf8"));
    const source = await readFile(service, "utf8");
    for (const changed of [
      source.replace("prior.actorUserId !== actor", "false"),
      source.replace("return this.receipt(prior);", "await tx.registeredPrincipalReturnCommand.delete({where:{idempotencyKey}}); return this.receipt(prior);"),
    ]) {
      assert.notEqual(changed, source);
      await writeFile(join(root, service), changed);
      assert.equal(await proveReadOnlyPrincipalReturnResult(root), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
