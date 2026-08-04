import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  inspectProductionRouteHits
} from "./inspect-production-route-hits.mjs";

const FROM = "2026-07-30T00:00:00.000Z";
const TO = "2026-07-30T01:00:00.000Z";
const COVERAGE_FROM = "2026-07-29T23:55:00.000Z";
const COVERAGE_TO = "2026-07-30T01:05:00.000Z";
const API_PREFIX = "/api";
const SCRIPT_PATH = fileURLToPath(
  new URL("./inspect-production-route-hits.mjs", import.meta.url)
);

function combinedLine({
  timestamp,
  method = "GET",
  target = "/health",
  status = 200,
  ip = "198.51.100.42",
  userAgent = "CanaryTokenAgent/1.0"
}) {
  return `${ip} - - [${timestamp}] "${method} ${target} HTTP/1.1" ${status} 123 "-" "${userAgent}"`;
}

function errorCode(error) {
  return error?.code;
}

test("counts normalized dynamic and wx-login routes without leaking request data", () => {
  const logText = [
    combinedLine({
      timestamp: "29/Jul/2026:23:59:59 +0000",
      target: "/health"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:00:00:00 +0000",
      method: "PATCH",
      target: "/api/contract-workbench/version-secret?token=do-not-leak"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:00:30:00 +0000",
      method: "POST",
      target: "/api/auth/wx-login?code=sensitive-login-code"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:00:45:00 +0000",
      method: "PATCH",
      target: "/api/contract-workbench/another-secret?access_token=do-not-leak"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:00:46:00 +0000",
      method: "PATCH",
      target: "/contract-workbench/no-public-prefix"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:00:47:00 +0000",
      method: "PATCH",
      target: "/api2/contract-workbench/wrong-prefix"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:00:48:00 +0000",
      method: "PATCH",
      target: "/api/api/contract-workbench/double-prefix"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:01:00:00 +0000",
      method: "POST",
      target: "/api/auth/wx-login?code=outside-window"
    })
  ].join("\n");

  const report = inspectProductionRouteHits({
    logText,
    from: FROM,
    to: TO,
    coverageFrom: COVERAGE_FROM,
    coverageTo: COVERAGE_TO,
    apiPrefix: API_PREFIX,
    routes: [
      "PATCH /contract-workbench/:contractVersionId",
      "POST /auth/wx-login"
    ]
  });

  assert.deepEqual(report, {
    schemaVersion: 1,
    status: "ready",
    observationWindow: `${FROM}/${TO}`,
    counts: {
      "PATCH /contract-workbench/:param": 2,
      "POST /auth/wx-login": 1
    },
    evidence: {
      complete: true,
      coverageWindow: `${COVERAGE_FROM}/${COVERAGE_TO}`,
      coverageBasis: "operator_attested",
      apiPrefix: API_PREFIX,
      inWindowApiPrefixedRequests: 4,
      inputSourceCount: 1,
      nonEmptyLines: 8,
      parsedLines: 8,
      beforeWindowLines: 1,
      inWindowLines: 6,
      atOrAfterWindowLines: 1,
      matchedRequests: 3,
      unmatchedRequests: 3,
      parseFailures: 0
    }
  });

  const serialized = JSON.stringify(report);
  for (const sensitiveValue of [
    "198.51.100.42",
    "CanaryTokenAgent",
    "version-secret",
    "another-secret",
    "do-not-leak",
    "sensitive-login-code",
    "access_token"
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test("counts unmatched in-window requests only as a safe aggregate", () => {
  const report = inspectProductionRouteHits({
    from: FROM,
    to: TO,
    coverageFrom: COVERAGE_FROM,
    coverageTo: COVERAGE_TO,
    apiPrefix: API_PREFIX,
    routes: ["POST /auth/wx-login"],
    logText: combinedLine({
      timestamp: "30/Jul/2026:00:30:00 +0000",
      target: "/api/contracts/private-id?token=private-token"
    })
  });

  assert.equal(report.counts["POST /auth/wx-login"], 0);
  assert.equal(report.evidence.matchedRequests, 0);
  assert.equal(report.evidence.unmatchedRequests, 1);
  assert.equal(JSON.stringify(report).includes("private"), false);
});

test("counts target calls regardless of 410 or 503 response status", () => {
  const report = inspectProductionRouteHits({
    from: FROM,
    to: TO,
    coverageFrom: COVERAGE_FROM,
    coverageTo: COVERAGE_TO,
    apiPrefix: API_PREFIX,
    routes: [
      "PATCH /contract-workbench/:contractVersionId",
      "POST /auth/wx-login"
    ],
    logText: [
      combinedLine({
        timestamp: "30/Jul/2026:00:10:00 +0000",
        method: "PATCH",
        target: "/api/contract-workbench/version-id",
        status: 410
      }),
      combinedLine({
        timestamp: "30/Jul/2026:00:20:00 +0000",
        method: "POST",
        target: "/api/auth/wx-login",
        status: 503
      })
    ].join("\n")
  });

  assert.equal(report.counts["PATCH /contract-workbench/:param"], 1);
  assert.equal(report.counts["POST /auth/wx-login"], 1);
});

test("counts HEAD as GET and blocks matching OPTIONS preflight ambiguity", () => {
  const headReport = inspectProductionRouteHits({
    from: FROM,
    to: TO,
    coverageFrom: COVERAGE_FROM,
    coverageTo: COVERAGE_TO,
    apiPrefix: API_PREFIX,
    routes: ["GET /contract-workbench/:contractVersionId"],
    logText: combinedLine({
      timestamp: "30/Jul/2026:00:30:00 +0000",
      method: "HEAD",
      target: "/api/contract-workbench/uuid-value"
    })
  });
  assert.equal(
    headReport.counts["GET /contract-workbench/:param"],
    1
  );

  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: ["PATCH /contract-workbench/:contractVersionId"],
        logText: combinedLine({
          timestamp: "30/Jul/2026:00:30:00 +0000",
          method: "OPTIONS",
          target: "/api/contract-workbench/uuid-value"
        })
      }),
    (error) => errorCode(error) === "ambiguous_preflight_request"
  );
});

test("fails closed when the declared API prefix has no positive observation", () => {
  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: "/apix",
        routes: ["POST /auth/wx-login"],
        logText: combinedLine({
          timestamp: "30/Jul/2026:00:30:00 +0000",
          method: "POST",
          target: "/api/auth/wx-login"
        })
      }),
    (error) => errorCode(error) === "unproven_api_prefix"
  );
});

test("does not use API-prefixed requests outside the observation window as proof", () => {
  const outsideOnly = [
    combinedLine({
      timestamp: "29/Jul/2026:23:59:59 +0000",
      target: "/api/health"
    }),
    combinedLine({
      timestamp: "30/Jul/2026:01:00:00 +0000",
      target: "/api/health"
    })
  ].join("\n");
  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: ["POST /auth/wx-login"],
        logText: outsideOnly
      }),
    (error) => errorCode(error) === "incomplete_log_coverage"
  );

  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: ["POST /auth/wx-login"],
        logText: [
          combinedLine({
            timestamp: "29/Jul/2026:23:59:59 +0000",
            target: "/api/health"
          }),
          combinedLine({
            timestamp: "30/Jul/2026:00:30:00 +0000",
            target: "/health"
          }),
          combinedLine({
            timestamp: "30/Jul/2026:01:00:00 +0000",
            target: "/api/health"
          })
        ].join("\n")
      }),
    (error) => errorCode(error) === "unproven_api_prefix"
  );
});

test("fails closed on every non-empty unparseable combined-log line", () => {
  const unsafeLine =
    "203.0.113.9 token=super-secret this is not an nginx combined access log";

  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: ["POST /auth/wx-login"],
        logText: [
          combinedLine({
            timestamp: "30/Jul/2026:00:00:00 +0000",
            target: "/health"
          }),
          unsafeLine,
          combinedLine({
            timestamp: "30/Jul/2026:01:00:00 +0000",
            target: "/health"
          })
        ].join("\n")
      }),
    (error) => {
      assert.equal(errorCode(error), "unparseable_log_line");
      assert.equal(error.message.includes("super-secret"), false);
      assert.equal(error.message.includes("203.0.113.9"), false);
      return true;
    }
  );
});

test("rejects invalid or non-explicit observation windows", () => {
  for (const [from, to] of [
    ["2026-07-30T00:00:00", TO],
    [TO, FROM],
    [FROM, FROM],
    ["not-a-date", TO]
  ]) {
    assert.throws(
      () =>
        inspectProductionRouteHits({
          from,
          to,
          coverageFrom: COVERAGE_FROM,
          coverageTo: COVERAGE_TO,
          apiPrefix: API_PREFIX,
          routes: ["POST /auth/wx-login"],
          logText: ""
        }),
      (error) => errorCode(error) === "invalid_observation_window"
    );
  }
});

test("rejects observation or claimed coverage that ends in the future", () => {
  const logText = combinedLine({
    timestamp: "30/Jul/2026:00:30:00 +0000",
    target: "/health"
  });
  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: ["POST /auth/wx-login"],
        logText,
        now: Date.parse("2026-07-30T00:59:59.999Z")
      }),
    (error) => errorCode(error) === "future_observation_window"
  );

  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: ["POST /auth/wx-login"],
        logText,
        now: Date.parse("2026-07-30T01:01:00.000Z")
      }),
    (error) => errorCode(error) === "future_coverage_window"
  );
});

test("rejects semantically duplicate and conflicting candidate routes", () => {
  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: [
          "PATCH /api/contract-workbench/:contractVersionId",
          "patch /contract-workbench/:id"
        ],
        logText: ""
      }),
    (error) => errorCode(error) === "duplicate_candidate_route"
  );

  assert.throws(
    () =>
      inspectProductionRouteHits({
        from: FROM,
        to: TO,
        coverageFrom: COVERAGE_FROM,
        coverageTo: COVERAGE_TO,
        apiPrefix: API_PREFIX,
        routes: [
          "GET /contracts/:contractId",
          "GET /api/contracts/current"
        ],
        logText: ""
      }),
    (error) => errorCode(error) === "conflicting_candidate_routes"
  );
});

test("validates versioned object manifest schema and API prefix", () => {
  const common = {
    from: FROM,
    to: TO,
    coverageFrom: COVERAGE_FROM,
    coverageTo: COVERAGE_TO,
    apiPrefix: API_PREFIX,
    logText: combinedLine({
      timestamp: "30/Jul/2026:00:30:00 +0000",
      target: "/api/health"
    })
  };

  const normalizedMatch = inspectProductionRouteHits({
    ...common,
    routes: {
      schemaVersion: 1,
      apiPrefix: "/api/",
      routes: ["POST /auth/wx-login"]
    }
  });
  assert.equal(normalizedMatch.status, "ready");

  assert.throws(
    () =>
      inspectProductionRouteHits({
        ...common,
        routes: {
          schemaVersion: 1,
          apiPrefix: "/gateway",
          routes: ["POST /auth/wx-login"]
        }
      }),
    (error) => errorCode(error) === "route_manifest_api_prefix_mismatch"
  );

  for (const routeManifest of [
    { apiPrefix: "/api", routes: ["POST /auth/wx-login"] },
    {
      schemaVersion: 2,
      apiPrefix: "/api",
      routes: ["POST /auth/wx-login"]
    }
  ]) {
    assert.throws(
      () =>
        inspectProductionRouteHits({
          ...common,
          routes: routeManifest
        }),
      (error) => errorCode(error) === "invalid_route_manifest_schema_version"
    );
  }
});

test("uses explicit coverage metadata and rejects incomplete or empty evidence", () => {
  const logText = combinedLine({
    timestamp: "30/Jul/2026:00:30:00 +0000",
    target: "/health"
  });
  for (const [coverageFrom, coverageTo, source] of [
    ["2026-07-30T00:00:01.000Z", COVERAGE_TO, logText],
    [COVERAGE_FROM, "2026-07-30T00:59:59.000Z", logText],
    [COVERAGE_FROM, COVERAGE_TO, ""]
  ]) {
    assert.throws(
      () =>
        inspectProductionRouteHits({
          from: FROM,
          to: TO,
          coverageFrom,
          coverageTo,
          apiPrefix: API_PREFIX,
          routes: ["POST /auth/wx-login"],
          logText: source
        }),
      (error) => errorCode(error) === "incomplete_log_coverage"
    );
  }
});

test("CLI accepts a log file and a JSON route manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "route-hit-inspector-"));
  try {
    const logPath = join(root, "access.log");
    const routesPath = join(root, "routes.json");
    await writeFile(
      logPath,
      [
        combinedLine({
          timestamp: "30/Jul/2026:00:00:00 +0000",
          method: "POST",
          target: "/api/auth/wx-login?code=cli-secret"
        }),
        combinedLine({
          timestamp: "30/Jul/2026:01:00:00 +0000",
          target: "/health"
        })
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      routesPath,
      JSON.stringify({
        schemaVersion: 1,
        apiPrefix: API_PREFIX,
        routes: ["POST /auth/wx-login"]
      }),
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--from",
        FROM,
        "--to",
        TO,
        "--coverage-from",
        COVERAGE_FROM,
        "--coverage-to",
        COVERAGE_TO,
        "--api-prefix",
        API_PREFIX,
        "--routes",
        routesPath,
        "--log",
        logPath
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.counts["POST /auth/wx-login"], 1);
    assert.equal(result.stdout.includes("cli-secret"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI reads the access log from stdin and emits safe errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "route-hit-inspector-"));
  try {
    const routesPath = join(root, "routes.json");
    await writeFile(
      routesPath,
      JSON.stringify(["POST /auth/wx-login"]),
      "utf8"
    );
    const input = [
      combinedLine({
        timestamp: "30/Jul/2026:00:00:00 +0000",
        method: "POST",
        target: "/api/auth/wx-login?code=stdin-secret"
      }),
      combinedLine({
        timestamp: "30/Jul/2026:01:00:00 +0000",
        target: "/health"
      })
    ].join("\n");

    const ok = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--from",
        FROM,
        "--to",
        TO,
        "--coverage-from",
        COVERAGE_FROM,
        "--coverage-to",
        COVERAGE_TO,
        "--api-prefix",
        API_PREFIX,
        "--routes",
        routesPath
      ],
      { encoding: "utf8", input }
    );
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).counts["POST /auth/wx-login"], 1);

    const failed = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--from",
        FROM,
        "--to",
        TO,
        "--coverage-from",
        COVERAGE_FROM,
        "--coverage-to",
        COVERAGE_TO,
        "--api-prefix",
        API_PREFIX,
        "--routes",
        routesPath
      ],
      {
        encoding: "utf8",
        input: `${input}\n203.0.113.8 token=stdin-secret malformed`
      }
    );
    assert.notEqual(failed.status, 0);
    assert.equal(failed.stdout, "");
    assert.equal(failed.stderr.includes("stdin-secret"), false);
    assert.equal(failed.stderr.includes("203.0.113.8"), false);
    assert.equal(
      JSON.parse(failed.stderr).code,
      "unparseable_log_line"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI reads multiple chronological plain and gzip log files", async () => {
  const root = await mkdtemp(join(tmpdir(), "route-hit-inspector-"));
  try {
    const olderLogPath = join(root, "access.log.1.gz");
    const currentLogPath = join(root, "access.log");
    const routesPath = join(root, "routes.json");
    await writeFile(
      olderLogPath,
      gzipSync(
        `${combinedLine({
          timestamp: "30/Jul/2026:00:10:00 +0000",
          method: "POST",
          target: "/api/auth/wx-login?code=gzip-secret"
        })}\n`
      )
    );
    await writeFile(
      currentLogPath,
      combinedLine({
        timestamp: "30/Jul/2026:00:50:00 +0000",
        target: "/health"
      }),
      "utf8"
    );
    await writeFile(
      routesPath,
      JSON.stringify(["POST /auth/wx-login"]),
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--from",
        FROM,
        "--to",
        TO,
        "--coverage-from",
        COVERAGE_FROM,
        "--coverage-to",
        COVERAGE_TO,
        "--api-prefix",
        API_PREFIX,
        "--routes",
        routesPath,
        "--log",
        olderLogPath,
        "--log",
        currentLogPath
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).counts["POST /auth/wx-login"], 1);
    assert.equal(result.stdout.includes("gzip-secret"), false);

    await writeFile(olderLogPath, "not-a-gzip-stream", "utf8");
    const corrupt = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--from",
        FROM,
        "--to",
        TO,
        "--coverage-from",
        COVERAGE_FROM,
        "--coverage-to",
        COVERAGE_TO,
        "--api-prefix",
        API_PREFIX,
        "--routes",
        routesPath,
        "--log",
        olderLogPath
      ],
      { encoding: "utf8" }
    );
    assert.notEqual(corrupt.status, 0);
    assert.equal(corrupt.stdout, "");
    assert.equal(JSON.parse(corrupt.stderr).code, "access_log_unreadable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
