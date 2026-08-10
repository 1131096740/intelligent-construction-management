import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CONTRACT_MUTATION_AUTHORITY_MANIFEST_PATH =
  "docs/product/manifests/contract-mutation-authority.json";

const MUTATION_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const AUTHORITIES = new Set([
  "aggregate_member_writer",
  "governed_specialized_command",
  "exit_candidate"
]);

function authorityManifestError(code) {
  const error = new Error("Contract mutation authority manifest failed");
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function targetKey(target) {
  return `${target.method}\u0000${target.controller}\u0000${target.handler}`;
}

function routeKey(route) {
  return `${route.method}\u0000${route.path}`;
}

function sortRoutes(routes) {
  return routes.sort((left, right) =>
    compareStrings(routeKey(left), routeKey(right))
  );
}

function sortActions(actions) {
  return actions.sort((left, right) => compareStrings(left.key, right.key));
}

function emptyBlockers() {
  return {
    actionAuthorityDrift: [],
    actionTargetDrift: [],
    invalidActionTargets: [],
    invalidRoutes: [],
    routeAuthorityDrift: []
  };
}

function blockerCount(blockers) {
  return Object.values(blockers).reduce(
    (count, entries) => count + entries.length,
    0
  );
}

function isContractMutationRoute(route) {
  return route.contractCutoverSurface === true &&
    MUTATION_METHODS.has(route.method);
}

function routeIsValid(route) {
  return isRecord(route) &&
    MUTATION_METHODS.has(route.method) &&
    isNonEmptyString(route.path) &&
    isNonEmptyString(route.controller) &&
    isNonEmptyString(route.handler) &&
    typeof route.contractCutoverSurface === "boolean" &&
    typeof route.contractCutoverLegacyWrite === "boolean" &&
    isNonEmptyString(route.usage);
}

function classificationIsValid(classification) {
  return isRecord(classification) &&
    AUTHORITIES.has(classification.authority) &&
    isNonEmptyString(classification.authorityRule);
}

function targetIsValid(target) {
  return isRecord(target) &&
    MUTATION_METHODS.has(target.method) &&
    isNonEmptyString(target.controller) &&
    isNonEmptyString(target.handler);
}

function routeAuthorityMismatch(route, classification) {
  return (route.usage === "exit_candidate") !==
    (classification.authority === "exit_candidate");
}

export function buildContractMutationAuthorityManifest({
  routeUsage,
  classifyRoute,
  operationTargets,
  classifyTarget
}) {
  if (
    !isRecord(routeUsage) ||
    !Array.isArray(routeUsage.routes) ||
    typeof classifyRoute !== "function" ||
    !isRecord(operationTargets) ||
    typeof classifyTarget !== "function"
  ) {
    throw authorityManifestError("CONTRACT_MUTATION_AUTHORITY_INPUT_INVALID");
  }

  const blockers = emptyBlockers();
  const allRoutes = routeUsage.routes.filter(isRecord);
  const scopedRoutes = [];
  const routeByTarget = new Map();

  for (const route of allRoutes) {
    if (!MUTATION_METHODS.has(route.method)) continue;
    if (!routeIsValid(route)) {
      blockers.invalidRoutes.push({
        method: route.method ?? null,
        path: route.path ?? null
      });
      continue;
    }
    const key = targetKey(route);
    const matches = routeByTarget.get(key) ?? [];
    matches.push(route);
    routeByTarget.set(key, matches);
    if (!isContractMutationRoute(route)) continue;

    const classification = classifyRoute(route);
    if (!classificationIsValid(classification)) {
      blockers.invalidRoutes.push({ method: route.method, path: route.path });
      continue;
    }
    if (routeAuthorityMismatch(route, classification)) {
      blockers.routeAuthorityDrift.push({
        method: route.method,
        path: route.path,
        usage: route.usage,
        authority: classification.authority
      });
    }
    scopedRoutes.push({
      method: route.method,
      path: route.path,
      controller: route.controller,
      handler: route.handler,
      authority: classification.authority,
      authorityRule: classification.authorityRule
    });
  }

  const actionTargets = [];
  for (const [key, target] of Object.entries(operationTargets)) {
    if (!isNonEmptyString(key) || !targetIsValid(target)) {
      blockers.invalidActionTargets.push({ key });
      continue;
    }
    const matchingRoutes = routeByTarget.get(targetKey(target)) ?? [];
    const classification = classifyTarget(target);
    if (!classificationIsValid(classification) || matchingRoutes.length !== 1) {
      blockers.invalidActionTargets.push({ key });
      continue;
    }
    const [route] = matchingRoutes;
    if (routeAuthorityMismatch(route, classification)) {
      blockers.actionTargetDrift.push({
        key,
        method: target.method,
        controller: target.controller,
        handler: target.handler,
        usage: route.usage,
        authority: classification.authority
      });
    }
    const classifiedRoute = scopedRoutes.find(
      (candidate) =>
        candidate.method === route.method &&
        candidate.path === route.path
    );
    if (
      classifiedRoute &&
      classifiedRoute.authority !== classification.authority
    ) {
      blockers.actionAuthorityDrift.push({
        key,
        method: route.method,
        path: route.path,
        authority: classification.authority,
        routeAuthority: classifiedRoute.authority
      });
    }
    actionTargets.push({
      key,
      method: target.method,
      controller: target.controller,
      handler: target.handler,
      authority: classification.authority,
      authorityRule: classification.authorityRule,
      advertised: classification.authority !== "exit_candidate"
    });
  }

  sortRoutes(scopedRoutes);
  sortActions(actionTargets);
  for (const entries of Object.values(blockers)) {
    entries.sort((left, right) =>
      compareStrings(JSON.stringify(left), JSON.stringify(right))
    );
  }
  const authorityCounts = {
    aggregate_member_writer: 0,
    governed_specialized_command: 0,
    exit_candidate: 0
  };
  for (const route of scopedRoutes) {
    authorityCounts[route.authority] += 1;
  }
  const advertisedActionKeys = actionTargets
    .filter((target) => target.advertised)
    .map((target) => target.key);
  const totalBlockers = blockerCount(blockers);

  return {
    schemaVersion: 1,
    status: totalBlockers === 0 ? "ready" : "blocked",
    scope: {
      mutationMethods: [...MUTATION_METHODS].sort(compareStrings),
      routeSelector: "contractCutoverSurface=true",
      deletionAuthorized: false
    },
    summary: {
      routeCount: scopedRoutes.length,
      authorityCounts,
      actionTargetCount: actionTargets.length,
      advertisedActionCount: advertisedActionKeys.length,
      blockerCount: totalBlockers
    },
    routes: scopedRoutes,
    actionProjection: {
      targets: actionTargets,
      advertisedActionKeys
    },
    blockers
  };
}

export function renderContractMutationAuthorityManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeOrCheckContractMutationAuthorityManifest({
  mode,
  targetPath,
  rendered
}) {
  if (!isNonEmptyString(targetPath) || typeof rendered !== "string") {
    throw authorityManifestError("CONTRACT_MUTATION_AUTHORITY_OUTPUT_INVALID");
  }
  if (mode === "write") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered);
    return;
  }
  if (mode !== "check") {
    throw authorityManifestError("CONTRACT_MUTATION_AUTHORITY_MODE_INVALID");
  }
  const existing = await readFile(targetPath, "utf8");
  if (existing !== rendered) {
    throw authorityManifestError("CONTRACT_MUTATION_AUTHORITY_MANIFEST_DRIFT");
  }
}
