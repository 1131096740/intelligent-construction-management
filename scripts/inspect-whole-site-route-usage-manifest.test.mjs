import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildWholeSiteRouteUsageManifest,
  inspectWholeSiteRouteUsageManifest,
  renderWholeSiteRouteUsageManifest,
  writeOrCheckWholeSiteRouteUsageManifest
} from "./lib/whole-site-route-usage-manifest.mjs";
import {
  runWholeSiteRouteUsageManifestCli,
  verifyWholeSiteRouteUsageReadyInputs
} from "./inspect-whole-site-route-usage-manifest.mjs";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("..", import.meta.url))
);
const EXIT_CANDIDATE_SEMANTICS =
  "candidate_only_no_deletion_authorization";
const EMPTY_SURFACE_COUNTS = {
  web_api_wrapper: 0,
  auth_store: 0,
  signed_ticket_delivery: 0,
  machine_probe: 0,
  operator_endpoint: 0,
  none: 0
};

function normalizePath(path) {
  return path.replace(/:[^/]+/g, ":param");
}

function route(method, path, overrides = {}) {
  return {
    method,
    path,
    normalizedKey: `${method} ${normalizePath(path)}`,
    controller: "FixtureController",
    handler: "fixture",
    sourceFile: "services/api/src/fixture.controller.ts",
    ...overrides
  };
}

function webManifest({
  wrappers = [],
  authTransportExceptions = []
} = {}) {
  return {
    schemaVersion: 1,
    status: "blocked",
    wrappers,
    authTransportExceptions
  };
}

function wrapper(
  method,
  normalizedPath,
  {
    name = "fixtureRequest",
    productionConsumers = ["apps/web-admin/src/pages/FixturePage.vue"],
    testConsumers = [],
    requests
  } = {}
) {
  return {
    name,
    apiFile: "apps/web-admin/src/api/fixture.api.ts",
    kind: "transport",
    requests:
      requests ??
      [
        {
          kind: "main",
          method,
          normalizedPath,
          normalizedKey: `${method} ${normalizedPath}`,
          sourceLine: 10,
          bodyKind: "none"
        }
      ],
    productionConsumers,
    testConsumers,
    unreachableConsumers: []
  };
}

function expectations({
  routeCount,
  overrideCount = 0,
  derivedPageCount = 0,
  page = 0,
  external = 0,
  exit = 0,
  internal = 0,
  unclassified = 0,
  surfaces = {}
}) {
  return {
    routeCount,
    classificationOverrideCount: overrideCount,
    derivedProductionPageCount: derivedPageCount,
    usageCounts: {
      page,
      external_takeover: external,
      exit_candidate: exit,
      internal_task: internal,
      unclassified
    },
    consumerSurfaceCounts: {
      ...EMPTY_SURFACE_COUNTS,
      ...surfaces
    }
  };
}

function registry({
  expected,
  overrides = [],
  consumerSurfaceOverrides = [],
  schemaVersion = 1,
  exitCandidateSemantics = EXIT_CANDIDATE_SEMANTICS
}) {
  return {
    schemaVersion,
    authorizationScope: "route_usage_classification_only",
    exitCandidateSemantics,
    expectations: {
      ...expected,
      classificationOverrideSha256:
        expected.classificationOverrideSha256 ??
        digestEntries(
          overrides,
          (entry) =>
            `${entry?.method ?? ""} ${entry?.path ?? ""} ${entry?.usage ?? ""}`
        ),
      consumerSurfaceOverrideSha256:
        expected.consumerSurfaceOverrideSha256 ??
        digestEntries(
          consumerSurfaceOverrides,
          (entry) =>
            `${entry?.method ?? ""} ${entry?.path ?? ""} ${entry?.consumerSurface ?? ""}`
        )
    },
    overrides,
    consumerSurfaceOverrides
  };
}

function digestEntries(entries, identityFor) {
  return createHash("sha256")
    .update(entries.map(identityFor).sort().join("\n"))
    .digest("hex");
}

function build({
  routes,
  web = webManifest(),
  overrides = [],
  consumerSurfaceOverrides = [],
  expected
}) {
  return buildWholeSiteRouteUsageManifest({
    nestManifest: { schemaVersion: 1, routes },
    webManifest: web,
    registry: registry({
      expected,
      overrides,
      consumerSurfaceOverrides
    })
  });
}

function usageOverride(method, path, usage) {
  return {
    method,
    path,
    usage,
    reason: `${usage}_fixture`
  };
}

function surfaceOverride(
  method,
  path,
  consumerSurface,
  { ticketFollowups } = {}
) {
  return {
    method,
    path,
    consumerSurface,
    reason: `${consumerSurface}_fixture`,
    ...(ticketFollowups ? { ticketFollowups } : {})
  };
}

async function writeFixture(root, files) {
  for (const [path, value] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      typeof value === "string"
        ? value
        : `${JSON.stringify(value, null, 2)}\n`
    );
  }
}

test("derives an ordinary page route only from a production Web consumer", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures/:fixtureId")],
    web: webManifest({
      wrappers: [wrapper("GET", "/fixtures/:param")]
    }),
    expected: expectations({
      routeCount: 1,
      derivedPageCount: 1,
      page: 1,
      surfaces: { web_api_wrapper: 1 }
    })
  });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.routes[0].usage, "page");
  assert.equal(
    manifest.routes[0].consumerSurface,
    "web_api_wrapper"
  );
  assert.deepEqual(
    manifest.routes[0].consumerEvidence.webApiWrappers[0]
      .productionConsumers,
    ["apps/web-admin/src/pages/FixturePage.vue"]
  );
});

test("fails closed when a wrapper has only test consumers", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    web: webManifest({
      wrappers: [
        wrapper("GET", "/fixtures", {
          productionConsumers: [],
          testConsumers: ["apps/web-admin/src/api/fixture.api.test.ts"]
        })
      ]
    }),
    expected: expectations({
      routeCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.routes[0].usage, "unclassified");
  assert.equal(manifest.routes[0].consumerSurface, "none");
  assert.equal(manifest.blockers.unclassifiedRoutes.length, 1);
});

test("derives an auth-store route as a page surface", () => {
  const manifest = build({
    routes: [route("POST", "/auth/login")],
    web: webManifest({
      authTransportExceptions: [
        {
          method: "POST",
          normalizedPath: "/auth/login",
          normalizedKey: "POST /auth/login",
          sourceFile: "apps/web-admin/src/auth/auth.store.ts",
          transport: "auth_store_exception"
        }
      ]
    }),
    expected: expectations({
      routeCount: 1,
      derivedPageCount: 1,
      page: 1,
      surfaces: { auth_store: 1 }
    })
  });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.routes[0].usage, "page");
  assert.equal(manifest.routes[0].consumerSurface, "auth_store");
});

test("keeps external takeover classification independent from Web surface", () => {
  const manifest = build({
    routes: [route("GET", "/projects/:projectId/contract-takeovers")],
    web: webManifest({
      wrappers: [
        wrapper("GET", "/projects/:param/contract-takeovers")
      ]
    }),
    overrides: [
      usageOverride(
        "GET",
        "/projects/:projectId/contract-takeovers",
        "external_takeover"
      )
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      external: 1,
      surfaces: { web_api_wrapper: 1 }
    })
  });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.routes[0].usage, "external_takeover");
  assert.equal(
    manifest.routes[0].consumerSurface,
    "web_api_wrapper"
  );
});

test("marks exit candidates as evidence only and never deletion authorization", () => {
  const manifest = build({
    routes: [route("POST", "/legacy")],
    overrides: [
      usageOverride("POST", "/legacy", "exit_candidate")
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      exit: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.scope.deletionAuthorized, false);
  assert.equal(manifest.routes[0].deletionAuthorized, false);
  assert.equal(
    manifest.routes[0].exitCandidateSemantics,
    "candidate_only_no_deletion_authorization"
  );
});

test("supports a signed-ticket page without pretending it is a main wrapper request", () => {
  const manifest = build({
    routes: [
      route("GET", "/files/:fileId/download"),
      route("POST", "/files/:fileId/download-ticket")
    ],
    web: webManifest({
      wrappers: [
        wrapper("POST", "/files/:param/download-ticket", {
          name: "openFile",
          requests: [
            {
              kind: "main",
              method: "POST",
              normalizedPath: "/files/:param/download-ticket",
              normalizedKey: "POST /files/:param/download-ticket",
              sourceLine: 10,
              bodyKind: "none"
            },
            {
              kind: "ticket_followup",
              method: "GET",
              ticketField: "downloadPath",
              sourceLine: 11,
              bodyKind: "none"
            }
          ]
        })
      ]
    }),
    overrides: [
      usageOverride(
        "GET",
        "/files/:fileId/download",
        "page"
      )
    ],
    consumerSurfaceOverrides: [
      surfaceOverride(
        "GET",
        "/files/:fileId/download",
        "signed_ticket_delivery",
        {
          ticketFollowups: [
            {
              apiFile:
                "apps/web-admin/src/api/fixture.api.ts",
              wrapper: "openFile",
              method: "GET",
              ticketField: "downloadPath"
            }
          ]
        }
      )
    ],
    expected: expectations({
      routeCount: 2,
      overrideCount: 1,
      derivedPageCount: 1,
      page: 2,
      surfaces: {
        signed_ticket_delivery: 1,
        web_api_wrapper: 1
      }
    })
  });

  assert.equal(manifest.status, "ready");
  const signedDelivery = manifest.routes.find(
    (entry) => entry.method === "GET"
  );
  assert.equal(
    signedDelivery.consumerSurface,
    "signed_ticket_delivery"
  );
  assert.equal(
    signedDelivery.consumerEvidence.ticketFollowups.length,
    1
  );
});

test("fails closed when signed-ticket evidence belongs to another wrapper", () => {
  const manifest = build({
    routes: [
      route("GET", "/files/:fileId/download"),
      route("POST", "/other/:otherId/download-ticket")
    ],
    web: webManifest({
      wrappers: [
        wrapper("POST", "/other/:param/download-ticket", {
          name: "openOther",
          requests: [
            {
              kind: "main",
              method: "POST",
              normalizedPath: "/other/:param/download-ticket",
              normalizedKey:
                "POST /other/:param/download-ticket",
              sourceLine: 10,
              bodyKind: "none"
            },
            {
              kind: "ticket_followup",
              method: "GET",
              ticketField: "downloadPath",
              sourceLine: 11,
              bodyKind: "none"
            }
          ]
        })
      ]
    }),
    overrides: [
      usageOverride(
        "GET",
        "/files/:fileId/download",
        "page"
      )
    ],
    consumerSurfaceOverrides: [
      surfaceOverride(
        "GET",
        "/files/:fileId/download",
        "signed_ticket_delivery",
        {
          ticketFollowups: [
            {
              apiFile:
                "apps/web-admin/src/api/fixture.api.ts",
              wrapper: "openFile",
              method: "GET",
              ticketField: "downloadPath"
            }
          ]
        }
      )
    ],
    expected: expectations({
      routeCount: 2,
      overrideCount: 1,
      derivedPageCount: 1,
      page: 2,
      surfaces: {
        signed_ticket_delivery: 1,
        web_api_wrapper: 1
      }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(
    manifest.blockers.classificationConflicts.map(
      (entry) => entry.code
    ),
    ["SIGNED_TICKET_EVIDENCE_MISSING"]
  );
});

test("supports an internal task with an orthogonal machine surface", () => {
  const manifest = build({
    routes: [route("GET", "/health")],
    overrides: [
      usageOverride("GET", "/health", "internal_task")
    ],
    consumerSurfaceOverrides: [
      surfaceOverride("GET", "/health", "machine_probe")
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      internal: 1,
      surfaces: { machine_probe: 1 }
    })
  });

  assert.equal(manifest.status, "ready");
  assert.equal(manifest.routes[0].usage, "internal_task");
  assert.equal(manifest.routes[0].consumerSurface, "machine_probe");
});

test("rejects an unreadable registry schema instead of guessing", () => {
  assert.throws(
    () =>
      buildWholeSiteRouteUsageManifest({
        nestManifest: { schemaVersion: 1, routes: [] },
        webManifest: webManifest(),
        registry: registry({
          schemaVersion: 2,
          expected: expectations({ routeCount: 0 })
        })
      }),
    (error) => error?.code === "ROUTE_USAGE_REGISTRY_INVALID"
  );
});

test("rejects contradictory exit-candidate semantics in the registry", () => {
  assert.throws(
    () =>
      buildWholeSiteRouteUsageManifest({
        nestManifest: { schemaVersion: 1, routes: [] },
        webManifest: webManifest(),
        registry: registry({
          expected: expectations({ routeCount: 0 }),
          exitCandidateSemantics: "authorized_for_deletion"
        })
      }),
    (error) => error?.code === "ROUTE_USAGE_REGISTRY_INVALID"
  );
});

test("fails closed on malformed classification overrides", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    overrides: [
      {
        method: "get",
        path: "fixtures",
        usage: "delete_now",
        reason: ""
      }
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.blockers.invalidRegistryEntries.length,
    1
  );
});

test("fails closed on duplicate exact classification overrides", () => {
  const duplicate = usageOverride(
    "GET",
    "/fixtures",
    "external_takeover"
  );
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    overrides: [duplicate, { ...duplicate }],
    expected: expectations({
      routeCount: 1,
      overrideCount: 2,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.blockers.duplicateRegistryEntries.length,
    1
  );
});

test("fails closed on stale exact classification overrides", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    overrides: [
      usageOverride("GET", "/missing", "external_takeover")
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(
    manifest.blockers.staleRegistryEntries.map(
      (entry) => entry.exactKey
    ),
    ["GET /missing"]
  );
});

test("fails closed on duplicate consumer-surface overrides", () => {
  const duplicate = surfaceOverride(
    "GET",
    "/health",
    "machine_probe"
  );
  const manifest = build({
    routes: [route("GET", "/health")],
    overrides: [
      usageOverride("GET", "/health", "internal_task")
    ],
    consumerSurfaceOverrides: [duplicate, { ...duplicate }],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      internal: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.blockers.duplicateConsumerSurfaceEntries.length,
    1
  );
});

test("fails closed on stale consumer-surface overrides", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    consumerSurfaceOverrides: [
      surfaceOverride("GET", "/missing", "machine_probe")
    ],
    expected: expectations({
      routeCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.equal(
    manifest.blockers.staleConsumerSurfaceEntries.length,
    1
  );
});

test("rejects duplicate exact Nest routes", () => {
  assert.throws(
    () =>
      build({
        routes: [
          route("GET", "/fixtures"),
          route("GET", "/fixtures")
        ],
        expected: expectations({ routeCount: 2 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_NEST_EXACT_ROUTE_DUPLICATE"
  );
});

test("rejects duplicate normalized Nest routes", () => {
  assert.throws(
    () =>
      build({
        routes: [
          route("GET", "/fixtures/:fixtureId"),
          route("GET", "/fixtures/:otherId")
        ],
        expected: expectations({ routeCount: 2 })
      }),
    (error) =>
      error?.code ===
      "ROUTE_USAGE_NEST_NORMALIZED_ROUTE_DUPLICATE"
  );
});

test("rejects a Nest route whose exact path contradicts normalizedKey", () => {
  assert.throws(
    () =>
      build({
        routes: [
          route("GET", "/real/:fixtureId", {
            normalizedKey: "GET /victim/:param"
          })
        ],
        expected: expectations({ routeCount: 1 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_NEST_MANIFEST_INVALID"
  );
});

test("rejects a Web request whose normalizedPath contradicts normalizedKey", () => {
  assert.throws(
    () =>
      build({
        routes: [route("GET", "/victim")],
        web: webManifest({
          wrappers: [
            wrapper("GET", "/real", {
              requests: [
                {
                  kind: "main",
                  method: "GET",
                  normalizedPath: "/real",
                  normalizedKey: "GET /victim",
                  sourceLine: 10,
                  bodyKind: "none"
                }
              ]
            })
          ]
        }),
        expected: expectations({ routeCount: 1 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_WEB_MANIFEST_INVALID"
  );
});

test("rejects unknown Web request kinds instead of traversing past them", () => {
  assert.throws(
    () =>
      build({
        routes: [route("GET", "/fixtures")],
        web: webManifest({
          wrappers: [
            wrapper("GET", "/fixtures", {
              requests: [
                {
                  kind: "mystery_transport",
                  method: "GET",
                  normalizedPath: "/fixtures",
                  normalizedKey: "GET /fixtures",
                  sourceLine: 10,
                  bodyKind: "none"
                }
              ]
            })
          ]
        }),
        expected: expectations({ routeCount: 1 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_WEB_MANIFEST_INVALID"
  );
});

test("rejects duplicate production wrapper identities", () => {
  const duplicate = wrapper("GET", "/fixtures");
  assert.throws(
    () =>
      build({
        routes: [route("GET", "/fixtures")],
        web: webManifest({
          wrappers: [duplicate, structuredClone(duplicate)]
        }),
        expected: expectations({ routeCount: 1 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_WEB_MANIFEST_INVALID"
  );
});

test("rejects duplicate request identities even across different source lines", () => {
  assert.throws(
    () =>
      build({
        routes: [route("GET", "/fixtures")],
        web: webManifest({
          wrappers: [
            wrapper("GET", "/fixtures", {
              requests: [
                {
                  kind: "main",
                  method: "GET",
                  normalizedPath: "/fixtures",
                  normalizedKey: "GET /fixtures",
                  sourceLine: 10,
                  bodyKind: "none"
                },
                {
                  kind: "main",
                  method: "GET",
                  normalizedPath: "/fixtures",
                  normalizedKey: "GET /fixtures",
                  sourceLine: 20,
                  bodyKind: "none"
                }
              ]
            })
          ]
        }),
        expected: expectations({ routeCount: 1 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_WEB_MANIFEST_INVALID"
  );
});

test("fails closed when a production Web route has no Nest route", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    web: webManifest({
      wrappers: [wrapper("GET", "/missing")]
    }),
    expected: expectations({
      routeCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(
    manifest.blockers.productionWebRoutesWithoutNest.map(
      (entry) => entry.normalizedKey
    ),
    ["GET /missing"]
  );
});

test("fails closed when an auth-store route has no Nest route", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    web: webManifest({
      authTransportExceptions: [
        {
          method: "POST",
          normalizedPath: "/auth/login",
          normalizedKey: "POST /auth/login",
          sourceFile: "apps/web-admin/src/auth/auth.store.ts",
          transport: "auth_store_exception"
        }
      ]
    }),
    expected: expectations({
      routeCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(
    manifest.blockers.authRoutesWithoutNest.map(
      (entry) => entry.normalizedKey
    ),
    ["POST /auth/login"]
  );
});

test("rejects a route claimed by both wrapper and auth-store surfaces", () => {
  assert.throws(
    () =>
      build({
        routes: [route("POST", "/auth/login")],
        web: webManifest({
          wrappers: [wrapper("POST", "/auth/login")],
          authTransportExceptions: [
            {
              method: "POST",
              normalizedPath: "/auth/login",
              normalizedKey: "POST /auth/login",
              sourceFile: "apps/web-admin/src/auth/auth.store.ts",
              transport: "auth_store_exception"
            }
          ]
        }),
        expected: expectations({ routeCount: 1 })
      }),
    (error) =>
      error?.code === "ROUTE_USAGE_CONSUMER_SURFACE_CONFLICT"
  );
});

test("fails closed if an exit candidate regains a production Web consumer", () => {
  const manifest = build({
    routes: [route("POST", "/legacy")],
    web: webManifest({
      wrappers: [wrapper("POST", "/legacy")]
    }),
    overrides: [
      usageOverride("POST", "/legacy", "exit_candidate")
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      exit: 1,
      surfaces: { web_api_wrapper: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(
    manifest.blockers.classificationConflicts.map(
      (entry) => entry.code
    ),
    ["EXIT_CANDIDATE_HAS_PRODUCTION_WEB_CONSUMER"]
  );
});

test("fails closed when a manual page route has no page consumer surface", () => {
  const manifest = build({
    routes: [route("GET", "/manual-page")],
    overrides: [
      usageOverride("GET", "/manual-page", "page")
    ],
    expected: expectations({
      routeCount: 1,
      overrideCount: 1,
      page: 1,
      surfaces: { none: 1 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.deepEqual(
    manifest.blockers.classificationConflicts.map(
      (entry) => entry.code
    ),
    ["PAGE_ROUTE_WITHOUT_PAGE_CONSUMER_SURFACE"]
  );
});

test("fails closed on any locked expectation drift", () => {
  const manifest = build({
    routes: [route("GET", "/fixtures")],
    expected: expectations({
      routeCount: 395,
      page: 279,
      surfaces: { web_api_wrapper: 326 }
    })
  });

  assert.equal(manifest.status, "blocked");
  assert.ok(manifest.blockers.expectationMismatches.length >= 3);
});

test("renders deterministically without wall-clock evidence", () => {
  const input = {
    routes: [route("GET", "/fixtures")],
    expected: expectations({
      routeCount: 1,
      unclassified: 1,
      surfaces: { none: 1 }
    })
  };
  const first = build(input);
  const second = build(input);
  const rendered = renderWholeSiteRouteUsageManifest(first);

  assert.equal(
    rendered,
    renderWholeSiteRouteUsageManifest(second)
  );
  assert.doesNotMatch(rendered, /generatedAt|timestamp/i);
});

test("locks the repository baseline to 497 routes and no route-usage blockers", async () => {
  const manifest = await inspectWholeSiteRouteUsageManifest({
    root: REPOSITORY_ROOT
  });
  const nonZeroBlockers = Object.fromEntries(
    Object.entries(manifest.blockers)
      .filter(([, entries]) => entries.length > 0)
      .map(([name, entries]) => [name, entries.length])
  );
  const externalByController = Object.fromEntries(
    [...new Set(
      manifest.routes
        .filter((entry) => entry.usage === "external_takeover")
        .map((entry) => entry.controller)
    )]
      .sort()
      .map((controller) => [
        controller,
        manifest.routes.filter(
          (entry) =>
            entry.usage === "external_takeover" &&
            entry.controller === controller
        ).length
      ])
  );

  assert.equal(manifest.status, "ready");
  assert.deepEqual(externalByController, {
    BusinessEntryDefinitionController: 7,
    ContractTakeoverController: 41,
    OperatingTakeoverController: 3,
    ProjectController: 19
  });
  assert.deepEqual(
    manifest.routes
      .filter(
        (entry) =>
          entry.usage === "external_takeover" &&
          entry.controller === "ProjectController"
      )
      .map((entry) => entry.handler)
      .sort(),
    [
      "affiliateBusinessFacts",
      "affiliateCompanyContractList",
      "affiliateMappingReport",
      "assignAffiliate",
      "confirmAffiliateCompanyContract",
      "confirmAffiliateContractFact",
      "confirmAffiliatePaymentFact",
      "confirmAffiliateSettlementFact",
      "confirmOwnerContract",
      "confirmUpstreamFundFact",
      "confirmUpstreamSettlement",
      "recordAffiliateCompanyContract",
      "recordAffiliateContractFact",
      "recordAffiliatePaymentFact",
      "recordAffiliateSettlementFact",
      "recordOwnerContract",
      "recordUpstreamFundFact",
      "recordUpstreamSettlement",
      "supplementAffiliateBusinessEvidence"
    ].sort()
  );
  assert.deepEqual(
    Object.fromEntries(
      [
        ["POST", "/business-entry-definitions/business-party/create/probe"],
        ["POST", "/business-entry-definitions/business-party/create/submission-target"],
        ["POST", "/business-parties"],
        ["GET", "/projects/affiliate-mapping-report"],
        ["GET", "/contract-workbench/:contractVersionId/offline-revisions"],
        ["GET", "/contracts/:contractVersionId/authorizations/readiness"],
        ["GET", "/vat-rate-options"],
        ["DELETE", "/contract-workbench/:contractVersionId/parties/:partySnapshotId"],
        ["PATCH", "/contract-workbench/:contractVersionId/parties/:partySnapshotId"],
        ["PATCH", "/vat-rate-options/:optionId"],
        ["POST", "/contract-workbench/:contractVersionId/parties"],
        ["POST", "/contracts/:contractVersionId/approval-submission"],
        ["POST", "/me/signature"],
        ["POST", "/projects/:projectId/affiliate-assignment"],
        ["POST", "/projects/:projectId/receipts"],
        ["POST", "/projects/:projectId/proxy-payments"],
        ["POST", "/invoice-allocations/:allocationId/reversal"],
        ["POST", "/spot-procurements/:procurementId/invoices"],
        ["POST", "/spot-procurements/:procurementId/no-invoice-confirmations"],
        ["POST", "/spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review"],
        ["POST", "/spot-procurements/:procurementId/invoice-exceptions"],
        ["POST", "/spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review"],
        ["POST", "/vat-rate-options"],
        ["POST", "/contract-bill-imports/:importId/apply"],
        ["POST", "/contract-bills/:billId/excel-imports"],
        ["POST", "/spot-procurement-payments/:paymentId/balance-execution"],
        ["POST", "/spot-procurements/:procurementId/supplier-balance-credit"],
        ["PUT", "/contract-bills/:billId/rows"]
      ].map(([method, path]) => {
        const route = manifest.routes.find(
          (entry) => entry.method === method && entry.path === path
        );
        assert.ok(route, `missing audited route ${method} ${path}`);
        return [`${method} ${path}`, route.usage];
      })
    ),
    {
      "POST /business-entry-definitions/business-party/create/probe": "page",
      "POST /business-entry-definitions/business-party/create/submission-target": "page",
      "POST /business-parties": "page",
      "GET /projects/affiliate-mapping-report": "external_takeover",
      "GET /contract-workbench/:contractVersionId/offline-revisions": "exit_candidate",
      "GET /contracts/:contractVersionId/authorizations/readiness": "exit_candidate",
      "GET /vat-rate-options": "exit_candidate",
      "DELETE /contract-workbench/:contractVersionId/parties/:partySnapshotId": "exit_candidate",
      "PATCH /contract-workbench/:contractVersionId/parties/:partySnapshotId": "exit_candidate",
      "PATCH /vat-rate-options/:optionId": "exit_candidate",
      "POST /contract-workbench/:contractVersionId/parties": "exit_candidate",
      "POST /contracts/:contractVersionId/approval-submission": "exit_candidate",
      "POST /me/signature": "exit_candidate",
      "POST /projects/:projectId/affiliate-assignment": "external_takeover",
      "POST /projects/:projectId/receipts": "exit_candidate",
      "POST /projects/:projectId/proxy-payments": "exit_candidate",
      "POST /invoice-allocations/:allocationId/reversal": "exit_candidate",
      "POST /spot-procurements/:procurementId/invoices": "exit_candidate",
      "POST /spot-procurements/:procurementId/no-invoice-confirmations": "exit_candidate",
      "POST /spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review": "exit_candidate",
      "POST /spot-procurements/:procurementId/invoice-exceptions": "exit_candidate",
      "POST /spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review": "exit_candidate",
      "POST /vat-rate-options": "exit_candidate",
      "POST /contract-bill-imports/:importId/apply": "exit_candidate",
      "POST /contract-bills/:billId/excel-imports": "exit_candidate",
      "POST /spot-procurement-payments/:paymentId/balance-execution": "exit_candidate",
      "POST /spot-procurements/:procurementId/supplier-balance-credit": "exit_candidate",
      "PUT /contract-bills/:billId/rows": "exit_candidate"
    }
  );
  assert.equal(manifest.summary.routeCount, 497);
  assert.equal(manifest.summary.classificationOverrideCount, 183);
  assert.equal(
    manifest.summary.classificationOverrideSha256,
    "5426c4732c67c8be80ec75173a9377393550c324b51c3cf1681e821152e6e575"
  );
  assert.equal(
    manifest.summary.consumerSurfaceOverrideSha256,
    "8f88a3b724cf4991ab78bd7cccbc3f115dbe3de71ec3781cf3ba85dde2ab41d1"
  );
  assert.equal(manifest.summary.derivedProductionPageCount, 314);
  assert.equal(manifest.summary.pageRouteCount, 316);
  assert.equal(manifest.summary.externalTakeoverCount, 70);
  assert.equal(manifest.summary.exitCandidateCount, 108);
  assert.equal(manifest.summary.internalTaskCount, 3);
  assert.equal(manifest.summary.unclassifiedCount, 0);
  assert.deepEqual(manifest.summary.consumerSurfaceCounts, {
    web_api_wrapper: 368,
    auth_store: 5,
    signed_ticket_delivery: 1,
    machine_probe: 2,
    operator_endpoint: 1,
    none: 120
  });
  const signedDeliveryRoute = manifest.routes.find(
    (entry) =>
      entry.method === "GET" &&
      entry.path === "/files/:fileId/download"
  );
  assert.equal(
    signedDeliveryRoute.consumerSurface,
    "signed_ticket_delivery"
  );
  assert.deepEqual(
    signedDeliveryRoute.consumerEvidence.ticketFollowups.map(
      (followup) =>
        `${followup.apiFile}#${followup.wrapper}#${followup.method}#${followup.ticketField}`
    ),
    [
      "apps/web-admin/src/api/core-flow-read.api.ts#downloadPrivateFileByTicket#GET#downloadUrl"
    ]
  );
  assert.deepEqual(nonZeroBlockers, {});
  assert.ok(
    manifest.routes
      .filter((entry) => entry.usage === "exit_candidate")
      .every(
        (entry) =>
          entry.consumerSurface === "none" &&
          entry.deletionAuthorized === false
      )
  );
  assert.deepEqual(manifest.blockers.unclassifiedRoutes, []);
});

test("writes and checks a blocked baseline while detecting drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-output-"));
  const targetPath = join(root, "route-usage.json");
  const rendered = "{}\n";
  try {
    await writeOrCheckWholeSiteRouteUsageManifest({
      mode: "write",
      targetPath,
      rendered
    });
    await writeOrCheckWholeSiteRouteUsageManifest({
      mode: "check",
      targetPath,
      rendered
    });
    await assert.rejects(
      writeOrCheckWholeSiteRouteUsageManifest({
        mode: "check",
        targetPath,
        rendered: '{"drift":true}\n'
      }),
      (error) => error?.code === "ROUTE_USAGE_MANIFEST_DRIFT"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inspects the three versioned JSON inputs from disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-input-"));
  try {
    await writeFixture(root, {
      "docs/product/manifests/nest-business-routes.json": {
        schemaVersion: 1,
        routes: [route("GET", "/fixtures")]
      },
      "docs/product/manifests/web-api-wrappers.json": webManifest(),
      "docs/product/manifests/route-usage.registry.json": registry({
        expected: expectations({
          routeCount: 1,
          unclassified: 1,
          surfaces: { none: 1 }
        })
      })
    });

    const manifest = await inspectWholeSiteRouteUsageManifest({
      root
    });
    assert.equal(manifest.status, "blocked");
    assert.equal(manifest.summary.routeCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI rejects write plus require-ready before creating output", async () => {
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-cli-"));
  try {
    await assert.rejects(
      runWholeSiteRouteUsageManifestCli(
        ["--write", "--require-ready"],
        { root }
      ),
      (error) =>
        error?.code === "ROUTE_USAGE_MANIFEST_INVALID_ARGUMENTS"
    );
    await assert.rejects(
      access(
        join(root, "docs/product/manifests/route-usage.json")
      ),
      (error) => error?.code === "ENOENT"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ready input verification recomputes and checks Web before Nest", async () => {
  const calls = [];
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-ready-"));
  try {
    await verifyWholeSiteRouteUsageReadyInputs({
      root,
      inspectWebManifest: async () => {
        calls.push("inspect-web");
        return { status: "ready" };
      },
      renderWebManifest: () => "web\n",
      checkWebManifest: async ({
        mode,
        targetPath,
        rendered
      }) => {
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
      checkNestManifest: async ({
        mode,
        targetPath,
        rendered
      }) => {
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ready input verification does not inspect Nest when Web is blocked", async () => {
  let inspectedNest = false;
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-ready-"));
  try {
    await assert.rejects(
      verifyWholeSiteRouteUsageReadyInputs({
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
      (error) =>
        error?.code === "ROUTE_USAGE_WEB_MANIFEST_BLOCKED"
    );
    assert.equal(inspectedNest, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("require-ready rejects forged JSON baselines without live Web and Nest evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-ready-"));
  try {
    const routes = [route("GET", "/fixtures")];
    const web = webManifest({
      wrappers: [wrapper("GET", "/fixtures")]
    });
    await writeFixture(root, {
      "docs/product/manifests/nest-business-routes.json": {
        schemaVersion: 1,
        routes
      },
      "docs/product/manifests/web-api-wrappers.json": web,
      "docs/product/manifests/route-usage.registry.json": registry({
        expected: expectations({
          routeCount: 1,
          derivedPageCount: 1,
          page: 1,
          surfaces: { web_api_wrapper: 1 }
        })
      })
    });
    const written = await runWholeSiteRouteUsageManifestCli(
      ["--write"],
      { root }
    );
    assert.equal(written.status, "ready");
    await assert.rejects(
      runWholeSiteRouteUsageManifestCli(
        ["--check", "--require-ready"],
        { root }
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI preserves blocked evidence and require-ready fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "jg-route-usage-cli-"));
  try {
    await writeFixture(root, {
      "docs/product/manifests/nest-business-routes.json": {
        schemaVersion: 1,
        routes: [route("GET", "/fixtures")]
      },
      "docs/product/manifests/web-api-wrappers.json": webManifest(),
      "docs/product/manifests/route-usage.registry.json": registry({
        expected: expectations({
          routeCount: 1,
          unclassified: 1,
          surfaces: { none: 1 }
        })
      })
    });

    const manifest = await runWholeSiteRouteUsageManifestCli(
      ["--write"],
      { root }
    );
    assert.equal(manifest.status, "blocked");
    await runWholeSiteRouteUsageManifestCli(["--check"], {
      root
    });
    await assert.rejects(
      runWholeSiteRouteUsageManifestCli(
        ["--check", "--require-ready"],
        { root }
      ),
      (error) =>
        error?.code === "ROUTE_USAGE_MANIFEST_BLOCKED"
    );
    assert.match(
      await readFile(
        join(root, "docs/product/manifests/route-usage.json"),
        "utf8"
      ),
      /"status": "blocked"/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
