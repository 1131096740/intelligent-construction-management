import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runWholeSitePageActionManifestCli,
  verifyWholeSitePageActionReadyInputs
} from "./inspect-whole-site-page-action-manifest.mjs";

test("rejects write plus require-ready before inspecting or writing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "jgzg-page-action-cli-"));

  await assert.rejects(
    runWholeSitePageActionManifestCli(
      ["--write", "--require-ready"],
      { root }
    ),
    (error) =>
      error?.code === "PAGE_ACTION_MANIFEST_INVALID_ARGUMENTS"
  );
  await assert.rejects(
    access(
      join(
        root,
        "docs/product/manifests/web-page-actions.json"
      )
    ),
    (error) => error?.code === "ENOENT"
  );
});

test("checks a ready Web manifest before recomputing the built Nest manifest", async () => {
  const calls = [];
  const root = await mkdtemp(join(tmpdir(), "jgzg-page-action-cli-"));

  await verifyWholeSitePageActionReadyInputs({
    root,
    inspectWebManifest: async () => {
      calls.push("inspect-web");
      return { status: "ready" };
    },
    renderWebManifest: () => "web\n",
    checkWebManifest: async ({ mode, targetPath, rendered }) => {
      assert.equal(mode, "check");
      assert.equal(
        targetPath,
        join(
          root,
          "docs/product/manifests/web-api-wrappers.json"
        )
      );
      assert.equal(rendered, "web\n");
      calls.push("check-web");
    },
    inspectNestManifest: async () => {
      calls.push("inspect-nest");
      return { routes: [] };
    },
    renderNestManifest: () => "nest\n",
    checkNestManifest: async ({ mode, targetPath, rendered }) => {
      assert.equal(mode, "check");
      assert.equal(
        targetPath,
        join(
          root,
          "docs/product/manifests/nest-business-routes.json"
        )
      );
      assert.equal(rendered, "nest\n");
      calls.push("check-nest");
    }
  });

  assert.deepEqual(calls, [
    "inspect-web",
    "check-web",
    "inspect-nest",
    "check-nest"
  ]);
});

test("does not inspect a built Nest manifest when the Web manifest is blocked", async () => {
  let inspectedNest = false;
  const root = await mkdtemp(join(tmpdir(), "jgzg-page-action-cli-"));

  await assert.rejects(
    verifyWholeSitePageActionReadyInputs({
      root,
      inspectWebManifest: async () => ({ status: "blocked" }),
      renderWebManifest: () => "web\n",
      checkWebManifest: async () => undefined,
      inspectNestManifest: async () => {
        inspectedNest = true;
        return { routes: [] };
      },
      renderNestManifest: () => "nest\n",
      checkNestManifest: async () => undefined
    }),
    (error) => error?.code === "PAGE_ACTION_WEB_MANIFEST_BLOCKED"
  );
  assert.equal(inspectedNest, false);
});
