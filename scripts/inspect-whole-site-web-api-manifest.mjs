#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const TARGET_PATH = "docs/product/manifests/web-api-wrappers.json";
const NEST_TARGET_PATH =
  "docs/product/manifests/nest-business-routes.json";

function cliError(code) {
  const error = new Error("Web API manifest CLI failed");
  error.code = code;
  return error;
}

function parseArguments(arguments_) {
  if (arguments_.length < 1 || arguments_.length > 2) {
    throw cliError("WEB_API_MANIFEST_INVALID_ARGUMENTS");
  }
  const mode =
    arguments_[0] === "--write"
      ? "write"
      : arguments_[0] === "--check"
        ? "check"
        : null;
  if (!mode) throw cliError("WEB_API_MANIFEST_INVALID_ARGUMENTS");
  const requireReady =
    arguments_.length === 2 && arguments_[1] === "--require-ready";
  if (arguments_.length === 2 && !requireReady) {
    throw cliError("WEB_API_MANIFEST_INVALID_ARGUMENTS");
  }
  return { mode, requireReady };
}

export async function runWholeSiteWebApiManifestCli(
  arguments_,
  { root = ROOT } = {}
) {
  const resolvedRoot = resolve(root);
  const { mode, requireReady } = parseArguments(arguments_);
  const manifest = await inspectWholeSiteWebApiManifest({
    root: resolvedRoot
  });
  await writeOrCheckWholeSiteWebApiManifest({
    mode,
    targetPath: resolve(resolvedRoot, TARGET_PATH),
    rendered: renderWholeSiteWebApiManifest(manifest)
  });
  if (requireReady && manifest.status !== "ready") {
    throw cliError("WEB_API_MANIFEST_BLOCKED");
  }
  if (requireReady) {
    const routes = await inspectBuiltNestRouteManifest({
      root: resolvedRoot
    });
    await writeOrCheckRouteManifest({
      mode: "check",
      targetPath: resolve(resolvedRoot, NEST_TARGET_PATH),
      rendered: renderRouteManifest(routes)
    });
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runWholeSiteWebApiManifestCli(process.argv.slice(2))
    .then((manifest) => {
      process.stdout.write(
        `WHOLE_SITE_WEB_API_MANIFEST_${manifest.status.toUpperCase()}: ${manifest.summary.transportWrapperCount} wrappers, ${manifest.summary.mainRequestBindingCount} bindings\n`
      );
    })
    .catch(() => {
      process.stderr.write(
        "WHOLE_SITE_WEB_API_MANIFEST_FAILED: Web API manifest inspection failed\n"
      );
      process.exitCode = 1;
    });
}
