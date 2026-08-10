import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_LEGACY_ROUTES } from "../inspect-contract-workbench-capabilities.mjs";
import { inspectProductionRouteHits } from "./inspect-production-route-hits.mjs";

const MANIFEST_PATH = new URL(
  "./production-route-observation-targets.json",
  import.meta.url
);
const WX_LOGIN_ROUTE = "POST /auth/wx-login";
const DRAFT_DELETION_ROUTE = "DELETE /contract-drafts/:param";
const PARTY_MUTATION_ROUTES = [
  "POST /contract-workbench/:param/parties",
  "PATCH /contract-workbench/:param/parties/:param",
  "DELETE /contract-workbench/:param/parties/:param"
];

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

test("observation targets track legacy routes, draft deletion, the party mutation family, plus wx-login", () => {
  const manifest = readManifest();
  const expectedRoutes = [
    ...DEFAULT_LEGACY_ROUTES.slice(0, 7),
    DRAFT_DELETION_ROUTE,
    ...PARTY_MUTATION_ROUTES,
    ...DEFAULT_LEGACY_ROUTES.slice(7),
    WX_LOGIN_ROUTE
  ];

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.apiPrefix, "/api");
  assert.deepEqual(manifest.routes, expectedRoutes);
  assert.equal(new Set(manifest.routes).size, manifest.routes.length);
  assert.deepEqual(
    manifest.routes.filter((route) => !DEFAULT_LEGACY_ROUTES.includes(route)),
    [DRAFT_DELETION_ROUTE, ...PARTY_MUTATION_ROUTES, WX_LOGIN_ROUTE]
  );
});

test("production route observer accepts the versioned target manifest", () => {
  const manifest = readManifest();
  const report = inspectProductionRouteHits({
    logText:
      '127.0.0.1 - - [30/Jul/2026:00:30:00 +0000] "GET /api/health HTTP/1.1" 200 2 "-" "observer"',
    from: "2026-07-30T00:00:00.000Z",
    to: "2026-07-30T01:00:00.000Z",
    coverageFrom: "2026-07-30T00:00:00.000Z",
    coverageTo: "2026-07-30T01:00:00.000Z",
    apiPrefix: manifest.apiPrefix,
    routes: manifest,
    now: Date.parse("2026-07-30T02:00:00.000Z")
  });

  assert.equal(report.status, "ready");
  assert.deepEqual(Object.keys(report.counts), manifest.routes);
  assert.deepEqual(
    Object.values(report.counts),
    manifest.routes.map(() => 0)
  );
});
