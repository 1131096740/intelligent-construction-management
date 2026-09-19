import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

export const USER_FILL_ENTRY_INVENTORY_PATH =
  "docs/product/manifests/user-fill-entry-inventory.json";
export const RETIRED_WRITE_ENTRY_GUARD_PATH =
  "services/api/src/retired-write-entry/retired-write-entry.guard.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function compare(left, right) {
  return left.localeCompare(right, "en");
}

function countBlockers(blockers) {
  return Object.values(blockers).reduce(
    (total, values) => total + values.length,
    0
  );
}

function retiredKey(value) {
  return `${value.controller}.${value.handler}`;
}

export function parseRetiredWriteEntries(source) {
  return [...source.matchAll(
    /\{\s*controller:\s*"([^"]+)",\s*handler:\s*"([^"]+)"\s*\}/g
  )].map((match) => ({ controller: match[1], handler: match[2] }));
}

export function buildUserFillEntryInventory({
  pageManifest,
  routeUsageManifest,
  retiredWriteEntries
}) {
  const activeActions = pageManifest.actions.filter(
    (action) => action.semantic === "business_write"
  );
  const technicalActions = pageManifest.actions.filter(
    (action) => action.semantic === "technical_write"
  );
  const activeEntries = activeActions
    .map((action) => ({
      id: action.id,
      status: "unified_candidate",
      usage: action.usage,
      routePaths: action.routePaths,
      sourceFile: action.sourceFile,
      trigger: action.trigger,
      capability: action.capability,
      bindings: action.bindings.map((binding) => ({
        normalizedKey: binding.normalizedKey,
        acceptedProductionConsumers:
          binding.acceptedProductionConsumers,
        causalVerified: binding.causalVerified
      }))
    }))
    .sort((left, right) => compare(left.id, right.id));

  const exitRoutes = routeUsageManifest.routes.filter(
    (route) => route.usage === "exit_candidate"
  );
  const retiredRoutes = exitRoutes.filter(
    (route) => !SAFE_METHODS.has(route.method)
  );
  const readonlyExitRoutes = exitRoutes.filter((route) =>
    SAFE_METHODS.has(route.method)
  );
  const expectedKeys = new Set(retiredRoutes.map(retiredKey));
  const declaredKeys = new Set(retiredWriteEntries.map(retiredKey));

  const blockers = {
    upstreamManifests: [
      ["web_page_actions", pageManifest.status],
      ["route_usage", routeUsageManifest.status]
    ]
      .filter(([, status]) => status !== "ready")
      .map(([manifest, status]) => `${manifest}:${status}`),
    invalidActiveEntries: activeEntries
      .filter(
        (entry) =>
          entry.bindings.length === 0 ||
          entry.bindings.some(
            (binding) =>
              binding.causalVerified !== true ||
              binding.acceptedProductionConsumers.length === 0
          )
      )
      .map((entry) => entry.id),
    uncoveredRetiredWrites: [...expectedKeys]
      .filter((key) => !declaredKeys.has(key))
      .sort(compare),
    staleRetiredWrites: [...declaredKeys]
      .filter((key) => !expectedKeys.has(key))
      .sort(compare)
  };
  const blockerCount = countBlockers(blockers);

  return {
    schemaVersion: 1,
    scope: {
      authority:
        "POL-19E whole-site user-fill entry closure and legacy write retirement",
      activeSource: "web-page-actions",
      retiredSource: "route-usage exit_candidate mutations",
      semantics:
        "active entries are the single non-production candidate; old reads remain read-only and old mutations return 410"
    },
    status: blockerCount === 0 ? "ready" : "blocked",
    summary: {
      activeBusinessActionCount: activeEntries.length,
      technicalActionCount: technicalActions.length,
      activeBindingCount: activeEntries.reduce(
        (total, entry) => total + entry.bindings.length,
        0
      ),
      retiredWriteEntryCount: retiredRoutes.length,
      retainedReadonlyExitCount: readonlyExitRoutes.length,
      uncoveredRetiredWriteCount: blockers.uncoveredRetiredWrites.length,
      staleRetiredWriteCount: blockers.staleRetiredWrites.length,
      blockerCount
    },
    activeEntries,
    technicalEntries: technicalActions
      .map((action) => ({
        id: action.id,
        status: "technical_only",
        usage: action.usage,
        routePaths: action.routePaths,
        sourceFile: action.sourceFile,
        trigger: action.trigger,
        capability: action.capability,
        bindings: action.bindings.map((binding) => ({
          normalizedKey: binding.normalizedKey,
          acceptedProductionConsumers:
            binding.acceptedProductionConsumers,
          causalVerified: binding.causalVerified
        }))
      }))
      .sort((left, right) => compare(left.id, right.id)),
    retiredEntries: retiredRoutes
      .map((route) => ({
        method: route.method,
        path: route.path,
        normalizedKey: route.normalizedKey,
        controller: route.controller,
        handler: route.handler,
        sourceFile: route.sourceFile,
        status: "gone"
      }))
      .sort((left, right) =>
        compare(left.normalizedKey, right.normalizedKey)
      ),
    readonlyLegacyEntries: readonlyExitRoutes
      .map((route) => ({
        method: route.method,
        path: route.path,
        normalizedKey: route.normalizedKey,
        controller: route.controller,
        handler: route.handler,
        sourceFile: route.sourceFile,
        status: "readonly"
      }))
      .sort((left, right) =>
        compare(left.normalizedKey, right.normalizedKey)
      ),
    blockers
  };
}

export function renderUserFillEntryInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export async function inspectUserFillEntryInventory({ root }) {
  const resolvedRoot = resolve(root);
  const [pageManifest, routeUsageManifest, guardSource] = await Promise.all([
    readFile(
      resolve(
        resolvedRoot,
        "docs/product/manifests/web-page-actions.json"
      ),
      "utf8"
    ).then(JSON.parse),
    readFile(
      resolve(resolvedRoot, "docs/product/manifests/route-usage.json"),
      "utf8"
    ).then(JSON.parse),
    readFile(resolve(resolvedRoot, RETIRED_WRITE_ENTRY_GUARD_PATH), "utf8")
  ]);
  return buildUserFillEntryInventory({
    pageManifest,
    routeUsageManifest,
    retiredWriteEntries: parseRetiredWriteEntries(guardSource)
  });
}

export async function writeOrCheckUserFillEntryInventory({
  mode,
  targetPath,
  rendered
}) {
  if (mode === "write") {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered, "utf8");
    return;
  }
  const current = await readFile(targetPath, "utf8");
  if (current !== rendered) {
    const error = new Error("User-fill entry inventory is stale");
    error.code = "USER_FILL_ENTRY_INVENTORY_STALE";
    throw error;
  }
}
