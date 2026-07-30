#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAPABILITY_MATRIX_INPUT_PATHS,
  CAPABILITY_MATRIX_MARKDOWN_PATH,
  CAPABILITY_MATRIX_PATH,
  inspectWholeSiteCapabilityMatrix,
  renderWholeSiteCapabilityMatrix,
  renderWholeSiteCapabilityMatrixMarkdown,
  writeOrCheckWholeSiteCapabilityMatrix
} from "./lib/whole-site-capability-matrix.mjs";
import {
  inspectWholeSitePageActionManifest,
  renderWholeSitePageActionManifest,
  writeOrCheckWholeSitePageActionManifest
} from "./lib/whole-site-page-action-manifest.mjs";
import {
  inspectBuiltNestRouteManifest,
  renderRouteManifest,
  writeOrCheckRouteManifest
} from "./lib/whole-site-route-manifest.mjs";
import {
  inspectWholeSiteRouteUsageManifest,
  renderWholeSiteRouteUsageManifest,
  writeOrCheckWholeSiteRouteUsageManifest
} from "./lib/whole-site-route-usage-manifest.mjs";
import {
  inspectWholeSiteWebApiManifest,
  renderWholeSiteWebApiManifest,
  writeOrCheckWholeSiteWebApiManifest
} from "./lib/whole-site-web-api-manifest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function cliError(code, details = undefined) {
  const error = new Error(
    "Whole-site capability matrix CLI failed"
  );
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function parseArguments(arguments_) {
  if (arguments_.length < 1 || arguments_.length > 2) {
    throw cliError("CAPABILITY_MATRIX_INVALID_ARGUMENTS");
  }
  const mode =
    arguments_[0] === "--write"
      ? "write"
      : arguments_[0] === "--check"
        ? "check"
        : null;
  if (!mode) {
    throw cliError("CAPABILITY_MATRIX_INVALID_ARGUMENTS");
  }
  const requireReady =
    arguments_.length === 2 &&
    arguments_[1] === "--require-ready";
  if (
    (arguments_.length === 2 && !requireReady) ||
    (mode === "write" && requireReady)
  ) {
    throw cliError("CAPABILITY_MATRIX_INVALID_ARGUMENTS");
  }
  return { mode, requireReady };
}

export async function verifyWholeSiteCapabilityMatrixReadyInputs({
  root,
  inspectNestManifest = inspectBuiltNestRouteManifest,
  renderNestManifest = renderRouteManifest,
  checkNestManifest = writeOrCheckRouteManifest,
  inspectWebManifest = inspectWholeSiteWebApiManifest,
  renderWebManifest = renderWholeSiteWebApiManifest,
  checkWebManifest = writeOrCheckWholeSiteWebApiManifest,
  inspectPageManifest = inspectWholeSitePageActionManifest,
  renderPageManifest = renderWholeSitePageActionManifest,
  checkPageManifest = writeOrCheckWholeSitePageActionManifest,
  inspectUsageManifest = inspectWholeSiteRouteUsageManifest,
  renderUsageManifest = renderWholeSiteRouteUsageManifest,
  checkUsageManifest = writeOrCheckWholeSiteRouteUsageManifest
}) {
  const resolvedRoot = resolve(root);
  const [
    nestRoutes,
    webManifest,
    pageManifest,
    usageManifest
  ] = await Promise.all([
    inspectNestManifest({ root: resolvedRoot }),
    inspectWebManifest({ root: resolvedRoot }),
    inspectPageManifest({ root: resolvedRoot }),
    inspectUsageManifest({ root: resolvedRoot })
  ]);
  await Promise.all([
    checkNestManifest({
      mode: "check",
      targetPath: resolve(
        resolvedRoot,
        CAPABILITY_MATRIX_INPUT_PATHS.nestRoutes
      ),
      rendered: renderNestManifest(nestRoutes)
    }),
    checkWebManifest({
      mode: "check",
      targetPath: resolve(
        resolvedRoot,
        CAPABILITY_MATRIX_INPUT_PATHS.webApiWrappers
      ),
      rendered: renderWebManifest(webManifest)
    }),
    checkPageManifest({
      mode: "check",
      targetPath: resolve(
        resolvedRoot,
        CAPABILITY_MATRIX_INPUT_PATHS.webPageActions
      ),
      rendered: renderPageManifest(pageManifest)
    }),
    checkUsageManifest({
      mode: "check",
      targetPath: resolve(
        resolvedRoot,
        CAPABILITY_MATRIX_INPUT_PATHS.routeUsage
      ),
      rendered: renderUsageManifest(usageManifest)
    })
  ]);
  const blockedInputs = [
    ["web_api_wrappers", webManifest.status],
    ["web_page_actions", pageManifest.status],
    ["route_usage", usageManifest.status]
  ]
    .filter(([, status]) => status !== "ready")
    .map(([input, status]) => ({ input, status }));
  if (blockedInputs.length > 0) {
    throw cliError(
      "CAPABILITY_MATRIX_READY_INPUT_BLOCKED",
      blockedInputs
    );
  }
  return {
    nestRoutes,
    webManifest,
    pageManifest,
    usageManifest
  };
}

export async function runWholeSiteCapabilityMatrixCli(
  arguments_,
  {
    root = ROOT,
    verifyReadyInputs =
      verifyWholeSiteCapabilityMatrixReadyInputs,
    inspectMatrix = inspectWholeSiteCapabilityMatrix,
    writeOrCheckMatrix =
      writeOrCheckWholeSiteCapabilityMatrix
  } = {}
) {
  const { mode, requireReady } = parseArguments(arguments_);
  const resolvedRoot = resolve(root);
  if (requireReady) {
    await verifyReadyInputs({ root: resolvedRoot });
  }
  const manifest = await inspectMatrix({ root: resolvedRoot });
  await writeOrCheckMatrix({
    mode,
    jsonTargetPath: resolve(
      resolvedRoot,
      CAPABILITY_MATRIX_PATH
    ),
    markdownTargetPath: resolve(
      resolvedRoot,
      CAPABILITY_MATRIX_MARKDOWN_PATH
    ),
    jsonRendered: renderWholeSiteCapabilityMatrix(manifest),
    markdownRendered:
      renderWholeSiteCapabilityMatrixMarkdown(manifest)
  });
  if (requireReady && manifest.status !== "ready") {
    throw cliError("CAPABILITY_MATRIX_BLOCKED");
  }
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === SCRIPT_PATH
) {
  runWholeSiteCapabilityMatrixCli(process.argv.slice(2))
    .then((manifest) => {
      process.stdout.write(
        `WHOLE_SITE_CAPABILITY_MATRIX_${manifest.status.toUpperCase()}: ` +
          `${manifest.summary.routeCount} routes, ` +
          `${manifest.summary.blockerCount} blockers\n`
      );
    })
    .catch(() => {
      process.stderr.write(
        "WHOLE_SITE_CAPABILITY_MATRIX_FAILED: Whole-site capability matrix inspection failed\n"
      );
      process.exitCode = 1;
    });
}
