#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectWholeSitePageActionManifest,
  renderWholeSitePageActionManifest,
  writeOrCheckWholeSitePageActionManifest
} from "./lib/whole-site-page-action-manifest.mjs";
import {
  inspectWholeSiteWebApiManifest,
  renderWholeSiteWebApiManifest,
  writeOrCheckWholeSiteWebApiManifest
} from "./lib/whole-site-web-api-manifest.mjs";
import {
  inspectBuiltNestRouteManifest,
  renderRouteManifest,
  writeOrCheckRouteManifest
} from "./lib/whole-site-route-manifest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGET_PATH = "docs/product/manifests/web-page-actions.json";
const WEB_TARGET_PATH = "docs/product/manifests/web-api-wrappers.json";
const NEST_TARGET_PATH =
  "docs/product/manifests/nest-business-routes.json";

function cliError(code) {
  const error = new Error("Page action manifest CLI failed");
  error.code = code;
  return error;
}

function parseArguments(arguments_) {
  if (arguments_.length < 1 || arguments_.length > 2) {
    throw cliError("PAGE_ACTION_MANIFEST_INVALID_ARGUMENTS");
  }
  const mode =
    arguments_[0] === "--write"
      ? "write"
      : arguments_[0] === "--check"
        ? "check"
        : null;
  if (!mode) throw cliError("PAGE_ACTION_MANIFEST_INVALID_ARGUMENTS");
  const requireReady =
    arguments_.length === 2 && arguments_[1] === "--require-ready";
  if (arguments_.length === 2 && !requireReady) {
    throw cliError("PAGE_ACTION_MANIFEST_INVALID_ARGUMENTS");
  }
  if (mode === "write" && requireReady) {
    throw cliError("PAGE_ACTION_MANIFEST_INVALID_ARGUMENTS");
  }
  return { mode, requireReady };
}

export async function verifyWholeSitePageActionReadyInputs({
  root,
  inspectWebManifest = inspectWholeSiteWebApiManifest,
  renderWebManifest = renderWholeSiteWebApiManifest,
  checkWebManifest = writeOrCheckWholeSiteWebApiManifest,
  inspectNestManifest = inspectBuiltNestRouteManifest,
  renderNestManifest = renderRouteManifest,
  checkNestManifest = writeOrCheckRouteManifest
}) {
  const resolvedRoot = resolve(root);
  const webManifest = await inspectWebManifest({
    root: resolvedRoot
  });
  await checkWebManifest({
    mode: "check",
    targetPath: resolve(resolvedRoot, WEB_TARGET_PATH),
    rendered: renderWebManifest(webManifest)
  });
  if (webManifest.status !== "ready") {
    throw cliError("PAGE_ACTION_WEB_MANIFEST_BLOCKED");
  }
  const nestManifest = await inspectNestManifest({
    root: resolvedRoot
  });
  await checkNestManifest({
    mode: "check",
    targetPath: resolve(resolvedRoot, NEST_TARGET_PATH),
    rendered: renderNestManifest(nestManifest)
  });
}

export async function runWholeSitePageActionManifestCli(
  arguments_,
  { root = ROOT } = {}
) {
  const resolvedRoot = resolve(root);
  const { mode, requireReady } = parseArguments(arguments_);
  const manifest = await inspectWholeSitePageActionManifest({
    root: resolvedRoot
  });
  await writeOrCheckWholeSitePageActionManifest({
    mode,
    targetPath: resolve(resolvedRoot, TARGET_PATH),
    rendered: renderWholeSitePageActionManifest(manifest)
  });
  if (requireReady && manifest.status !== "ready") {
    throw cliError("PAGE_ACTION_MANIFEST_BLOCKED");
  }
  if (requireReady) {
    await verifyWholeSitePageActionReadyInputs({
      root: resolvedRoot
    });
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runWholeSitePageActionManifestCli(process.argv.slice(2))
    .then((manifest) => {
      const actionCount =
        manifest.summary?.registeredActionCount ??
        manifest.summary?.actionCount ??
        0;
      const blockerCount =
        manifest.summary?.blockerCount ??
        Object.values(manifest.blockers ?? {}).reduce(
          (sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0),
          0
        );
      process.stdout.write(
        `WHOLE_SITE_PAGE_ACTION_MANIFEST_${manifest.status.toUpperCase()}: ${actionCount} actions, ${blockerCount} blockers\n`
      );
    })
    .catch(() => {
      process.stderr.write(
        "WHOLE_SITE_PAGE_ACTION_MANIFEST_FAILED: Page action manifest inspection failed\n"
      );
      process.exitCode = 1;
    });
}
