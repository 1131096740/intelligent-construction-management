#!/usr/bin/env node

import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectBuiltNestRouteManifest,
  renderRouteManifest,
  writeOrCheckRouteManifest
} from "./lib/whole-site-route-manifest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArguments(arguments_, root) {
  if (arguments_.length < 1 || arguments_.length > 2) {
    throw new Error("Invalid CLI arguments");
  }
  const mode =
    arguments_[0] === "--write"
      ? "write"
      : arguments_[0] === "--check"
        ? "check"
        : null;
  if (!mode) throw new Error("Invalid CLI arguments");

  const defaultTarget = resolve(
    root,
    "docs/product/manifests/nest-business-routes.json"
  );
  const targetPath =
    arguments_.length === 2 ? resolve(root, arguments_[1]) : defaultTarget;
  if (
    targetPath === root ||
    !targetPath.startsWith(`${root}${sep}`) ||
    targetPath !== defaultTarget
  ) {
    throw new Error("Invalid CLI arguments");
  }
  return { mode, targetPath };
}

export async function runWholeSiteRouteManifestCli(
  arguments_,
  { root = ROOT } = {}
) {
  const resolvedRoot = resolve(root);
  const { mode, targetPath } = parseArguments(arguments_, resolvedRoot);
  const routes = await inspectBuiltNestRouteManifest({ root: resolvedRoot });
  await writeOrCheckRouteManifest({
    mode,
    targetPath,
    rendered: renderRouteManifest(routes)
  });
  return routes.length;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runWholeSiteRouteManifestCli(process.argv.slice(2))
    .then((routeCount) => {
      process.stdout.write(
        `WHOLE_SITE_ROUTE_MANIFEST_OK: ${routeCount} routes\n`
      );
    })
    .catch(() => {
      process.stderr.write(
        "WHOLE_SITE_ROUTE_MANIFEST_FAILED: Route manifest inspection failed\n"
      );
      process.exitCode = 1;
    });
}
