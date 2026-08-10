#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_MUTATION_AUTHORITY_MANIFEST_PATH,
  buildContractMutationAuthorityManifest,
  renderContractMutationAuthorityManifest,
  writeOrCheckContractMutationAuthorityManifest
} from "./lib/contract-mutation-authority-manifest.mjs";
import {
  inspectBuiltNestRouteManifest,
  renderRouteManifest,
  writeOrCheckRouteManifest
} from "./lib/whole-site-route-manifest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NEST_MANIFEST_PATH = "docs/product/manifests/nest-business-routes.json";
const ROUTE_USAGE_MANIFEST_PATH = "docs/product/manifests/route-usage.json";
const MUTATION_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

function cliError(code) {
  const error = new Error("Contract mutation authority manifest CLI failed");
  error.code = code;
  return error;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 1) {
    throw cliError("CONTRACT_MUTATION_AUTHORITY_INVALID_ARGUMENTS");
  }
  const mode = arguments_[0] === "--write"
    ? "write"
    : arguments_[0] === "--check"
      ? "check"
      : null;
  if (!mode) throw cliError("CONTRACT_MUTATION_AUTHORITY_INVALID_ARGUMENTS");
  return { mode };
}

function loadAuthoritySource(root) {
  const apiRequire = createRequire(resolve(root, "services/api/package.json"));
  const source = apiRequire(
    resolve(
      root,
      "services/api/dist/contract-workbench/contract-mutation-authority.js"
    )
  );
  if (
    typeof source.classifyContractMutationRoute !== "function" ||
    typeof source.classifyContractMutationTarget !== "function" ||
    !source.CONTRACT_DRAFT_OPERATION_TARGETS
  ) {
    throw cliError("CONTRACT_MUTATION_AUTHORITY_SOURCE_INVALID");
  }
  return source;
}

function isContractMutationRoute(route) {
  return route?.contractCutoverSurface === true &&
    MUTATION_METHODS.has(route.method);
}

function runtimeRouteIdentity(route) {
  return [route.method, route.path, route.controller, route.handler].join("\u0000");
}

async function loadRouteUsageManifest(root) {
  let routeUsage;
  try {
    routeUsage = JSON.parse(
      await readFile(resolve(root, ROUTE_USAGE_MANIFEST_PATH), "utf8")
    );
  } catch {
    throw cliError("CONTRACT_MUTATION_AUTHORITY_ROUTE_USAGE_INVALID");
  }
  if (routeUsage?.status !== "ready" || !Array.isArray(routeUsage.routes)) {
    throw cliError("CONTRACT_MUTATION_AUTHORITY_ROUTE_USAGE_INVALID");
  }
  return routeUsage;
}

export function assertRouteUsageMatchesRuntime({ nestManifest, routeUsage }) {
  const runtimeRoutes = nestManifest.filter(isContractMutationRoute);
  const documentedRoutes = routeUsage.routes.filter(isContractMutationRoute);
  const runtimeIdentities = new Set(runtimeRoutes.map(runtimeRouteIdentity));
  const documentedIdentities = new Set(documentedRoutes.map(runtimeRouteIdentity));
  const documentedRoutesByIdentity = new Map(
    documentedRoutes.map((route) => [runtimeRouteIdentity(route), route])
  );
  if (
    runtimeRoutes.length !== documentedRoutes.length ||
    runtimeIdentities.size !== runtimeRoutes.length ||
    documentedIdentities.size !== documentedRoutes.length ||
    [...runtimeIdentities].some((identity) => !documentedIdentities.has(identity)) ||
    [...documentedIdentities].some((identity) => !runtimeIdentities.has(identity)) ||
    runtimeRoutes.some((route) =>
      documentedRoutesByIdentity.get(runtimeRouteIdentity(route))
        ?.contractCutoverLegacyWrite !== route.contractCutoverLegacyWrite
    )
  ) {
    throw cliError("CONTRACT_MUTATION_AUTHORITY_RUNTIME_ROUTE_DRIFT");
  }
}

export async function runContractMutationAuthorityManifestCli(
  arguments_,
  { root = ROOT } = {}
) {
  const resolvedRoot = resolve(root);
  const { mode } = parseArguments(arguments_);
  const [nestManifest, routeUsage] = await Promise.all([
    inspectBuiltNestRouteManifest({ root: resolvedRoot }),
    loadRouteUsageManifest(resolvedRoot)
  ]);
  await writeOrCheckRouteManifest({
    mode: "check",
    targetPath: resolve(resolvedRoot, NEST_MANIFEST_PATH),
    rendered: renderRouteManifest(nestManifest)
  });
  assertRouteUsageMatchesRuntime({ nestManifest, routeUsage });
  const authoritySource = loadAuthoritySource(resolvedRoot);
  const manifest = buildContractMutationAuthorityManifest({
    routeUsage,
    classifyRoute: authoritySource.classifyContractMutationRoute,
    operationTargets: authoritySource.CONTRACT_DRAFT_OPERATION_TARGETS,
    classifyTarget: authoritySource.classifyContractMutationTarget
  });
  await writeOrCheckContractMutationAuthorityManifest({
    mode,
    targetPath: resolve(resolvedRoot, CONTRACT_MUTATION_AUTHORITY_MANIFEST_PATH),
    rendered: renderContractMutationAuthorityManifest(manifest)
  });
  if (manifest.status !== "ready") {
    throw cliError("CONTRACT_MUTATION_AUTHORITY_MANIFEST_BLOCKED");
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runContractMutationAuthorityManifestCli(process.argv.slice(2))
    .then((manifest) => {
      process.stdout.write(
        `CONTRACT_MUTATION_AUTHORITY_MANIFEST_READY: ${manifest.summary.routeCount} routes, ` +
        `${manifest.summary.advertisedActionCount} advertised actions\n`
      );
    })
    .catch(() => {
      process.stderr.write(
        "CONTRACT_MUTATION_AUTHORITY_MANIFEST_FAILED: Contract mutation authority manifest inspection failed\n"
      );
      process.exitCode = 1;
    });
}
