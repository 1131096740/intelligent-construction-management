import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { inspectWholeSitePageActionManifest } from "./lib/whole-site-page-action-manifest.mjs";
import { inspectWholeSiteWebApiManifest } from "./lib/whole-site-web-api-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("PR1 remediation has no duplicate mutation routes or web requests without Nest routes", async () => {
  const manifest = await inspectWholeSiteWebApiManifest({ root });
  const pageManifest = await inspectWholeSitePageActionManifest({ root });

  assert.deepEqual(manifest.blockers.orphanWrappers, []);
  assert.deepEqual(manifest.blockers.duplicateWriteWrappers, []);
  assert.deepEqual(manifest.blockers.frontendWithoutBackend, []);
  assert.deepEqual(pageManifest.blockers.unresolvedComponentForwards, []);
});

test("contract workbench authority snapshot remains a verified server capability gate", async () => {
  const pageManifest = await inspectWholeSitePageActionManifest({ root });

  assert.equal(
    pageManifest.status,
    "ready",
    JSON.stringify(pageManifest.blockers)
  );
  assert.deepEqual(pageManifest.blockers.unresolvedWrappers, []);
  assert.deepEqual(pageManifest.blockers.writeWithoutServerCapability, []);
  assert.deepEqual(pageManifest.blockers.uncoveredMutationWrappers, []);
});
