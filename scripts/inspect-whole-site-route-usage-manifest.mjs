#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectWholeSiteRouteUsageManifest,
  renderWholeSiteRouteUsageManifest,
  writeOrCheckWholeSiteRouteUsageManifest
} from "./lib/whole-site-route-usage-manifest.mjs";
import {
  inspectBuiltNestRouteManifest,
  renderRouteManifest,
  writeOrCheckRouteManifest
} from "./lib/whole-site-route-manifest.mjs";
import {
  inspectWholeSiteWebApiManifest,
  renderWholeSiteWebApiManifest,
  writeOrCheckWholeSiteWebApiManifest
} from "./lib/whole-site-web-api-manifest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGET_PATH =
  "docs/product/manifests/route-usage.json";
const WEB_TARGET_PATH =
  "docs/product/manifests/web-api-wrappers.json";
const NEST_TARGET_PATH =
  "docs/product/manifests/nest-business-routes.json";

function cliError(code) {
  const error = new Error("Route usage manifest CLI failed");
  error.code = code;
  return error;
}

function parseArguments(arguments_) {
  if (arguments_.length < 1 || arguments_.length > 2) {
    throw cliError("ROUTE_USAGE_MANIFEST_INVALID_ARGUMENTS");
  }
  const mode =
    arguments_[0] === "--write"
      ? "write"
      : arguments_[0] === "--check"
        ? "check"
        : null;
  if (!mode) {
    throw cliError("ROUTE_USAGE_MANIFEST_INVALID_ARGUMENTS");
  }
  const requireReady =
    arguments_.length === 2 &&
    arguments_[1] === "--require-ready";
  if (
    (arguments_.length === 2 && !requireReady) ||
    (mode === "write" && requireReady)
  ) {
    throw cliError("ROUTE_USAGE_MANIFEST_INVALID_ARGUMENTS");
  }
  return { mode, requireReady };
}

export async function verifyWholeSiteRouteUsageReadyInputs({
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
    throw cliError("ROUTE_USAGE_WEB_MANIFEST_BLOCKED");
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

export async function runWholeSiteRouteUsageManifestCli(
  arguments_,
  { root = ROOT } = {}
) {
  const resolvedRoot = resolve(root);
  const { mode, requireReady } = parseArguments(arguments_);
  const manifest = await inspectWholeSiteRouteUsageManifest({
    root: resolvedRoot
  });
  await writeOrCheckWholeSiteRouteUsageManifest({
    mode,
    targetPath: resolve(resolvedRoot, TARGET_PATH),
    rendered: renderWholeSiteRouteUsageManifest(manifest)
  });
  if (requireReady && manifest.status !== "ready") {
    throw cliError("ROUTE_USAGE_MANIFEST_BLOCKED");
  }
  if (requireReady) {
    await verifyWholeSiteRouteUsageReadyInputs({
      root: resolvedRoot
    });
  }
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === SCRIPT_PATH
) {
  runWholeSiteRouteUsageManifestCli(process.argv.slice(2))
    .then((manifest) => {
      process.stdout.write(
        `WHOLE_SITE_ROUTE_USAGE_MANIFEST_${manifest.status.toUpperCase()}: ` +
          `${manifest.summary.routeCount} routes, ` +
          `${manifest.summary.unclassifiedCount} unclassified\n`
      );
    })
    .catch(() => {
      process.stderr.write(
        "WHOLE_SITE_ROUTE_USAGE_MANIFEST_FAILED: Route usage manifest inspection failed\n"
      );
      process.exitCode = 1;
    });
}
