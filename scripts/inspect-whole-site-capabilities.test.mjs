import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBuildArtifactFresh,
  assertRuntimeRouteParity,
  collectControllerRouteManifest,
  collectExpressRouteKeys,
  controllerSourceKey,
  indexControllerSources,
  inspectBuiltNestRouteManifest,
  renderRouteManifest,
  writeOrCheckRouteManifest
} from "./lib/whole-site-route-manifest.mjs";
import { runWholeSiteRouteManifestCli } from "./inspect-whole-site-capabilities.mjs";

const apiRequire = createRequire(
  new URL("../services/api/package.json", import.meta.url)
);
apiRequire("reflect-metadata");
const { METHOD_METADATA, PATH_METADATA } = apiRequire(
  "@nestjs/common/constants"
);
const { RequestMethod } = apiRequire(
  "@nestjs/common/enums/request-method.enum"
);
const { MetadataScanner, Reflector } = apiRequire("@nestjs/core");
const ts = apiRequire("typescript");

const SCRIPT_PATH = fileURLToPath(
  new URL("./inspect-whole-site-capabilities.mjs", import.meta.url)
);
const ROLE_KEYS = ["chairman", "employee"];
const BUSINESS_ACTIONS = ["contract.approve", "contract.read"];

function methodNames() {
  return new Map(
    Object.entries(RequestMethod)
      .filter(([key, value]) => Number.isInteger(value) && key !== "ALL")
      .map(([key, value]) => [value, key])
  );
}

function sourceIndex(entries) {
  return new Map(
    entries.map(([controller, handler, sourceFile]) => [
      controllerSourceKey(controller, handler),
      sourceFile
    ])
  );
}

function modulesFor(...controllerClasses) {
  return new Map([
    [
      "fixture-module",
      {
        controllers: new Map(
          controllerClasses.map((controllerClass) => [
            controllerClass,
            {
              metatype: controllerClass,
              instance: new controllerClass()
            }
          ])
        )
      }
    ]
  ]);
}

function route(target, method, path) {
  Reflect.defineMetadata(METHOD_METADATA, method, target);
  Reflect.defineMetadata(PATH_METADATA, path, target);
}

function controller(target, path) {
  Reflect.defineMetadata(PATH_METADATA, path, target);
}

function collect(controllerClasses, sources, overrides = {}) {
  return collectControllerRouteManifest({
    modulesContainer: modulesFor(...controllerClasses),
    metadataScanner: new MetadataScanner(),
    reflector: new Reflector(),
    sourceIndex: sources,
    metadataKeys: {
      path: PATH_METADATA,
      method: METHOD_METADATA,
      isPublic: "isPublic",
      requiredPositions: "requiredPositions",
      requiredProjectAction: "requiredProjectAction",
      contractCutoverSurface: "contract_cutover_surface",
      contractCutoverLegacyWrite: "contract_cutover_legacy_write"
    },
    requestMethodNames: methodNames(),
    roleKeys: ROLE_KEYS,
    businessActions: BUSINESS_ACTIONS,
    ...overrides
  });
}

test("defaults an undecorated guard surface to authenticated_only", () => {
  class DefaultController {
    read() {}
  }
  controller(DefaultController, "defaults");
  route(DefaultController.prototype.read, RequestMethod.GET, ":recordId");

  const routes = collect(
    [DefaultController],
    sourceIndex([
      ["DefaultController", "read", "services/api/src/default.controller.ts"]
    ])
  );

  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], {
    method: "GET",
    path: "/defaults/:recordId",
    normalizedKey: "GET /defaults/:param",
    controller: "DefaultController",
    handler: "read",
    sourceFile: "services/api/src/default.controller.ts",
    authorizationScope: "guard_metadata_only",
    authentication: "authenticated",
    guardAuthorization: "authenticated_only",
    isPublic: false,
    requiredPositions: [],
    requiredProjectAction: null,
    authorizationCombination: null,
    contractCutoverSurface: false,
    contractCutoverLegacyWrite: false
  });
});

test("uses handler metadata before class metadata for public access", () => {
  class OverrideController {
    inherited() {}
    overridden() {}
  }
  controller(OverrideController, "overrides");
  route(OverrideController.prototype.inherited, RequestMethod.GET, "inherited");
  route(OverrideController.prototype.overridden, RequestMethod.POST, "overridden");
  Reflect.defineMetadata("isPublic", true, OverrideController);
  Reflect.defineMetadata("isPublic", false, OverrideController.prototype.overridden);
  Reflect.defineMetadata(
    "requiredPositions",
    ["employee"],
    OverrideController.prototype.overridden
  );

  const routes = collect(
    [OverrideController],
    sourceIndex([
      [
        "OverrideController",
        "inherited",
        "services/api/src/override.controller.ts"
      ],
      [
        "OverrideController",
        "overridden",
        "services/api/src/override.controller.ts"
      ]
    ])
  );
  const inherited = routes.find((item) => item.handler === "inherited");
  const overridden = routes.find((item) => item.handler === "overridden");

  assert.equal(inherited?.isPublic, true);
  assert.deepEqual(inherited?.requiredPositions, []);
  assert.equal(overridden?.isPublic, false);
  assert.deepEqual(overridden?.requiredPositions, ["employee"]);
});

test("fails closed instead of calling public routes with business guards public", () => {
  class ConflictingPublicController {
    read() {}
  }
  controller(ConflictingPublicController, "public-conflict");
  route(ConflictingPublicController.prototype.read, RequestMethod.GET, "");
  Reflect.defineMetadata("isPublic", true, ConflictingPublicController);
  Reflect.defineMetadata(
    "requiredPositions",
    ["chairman"],
    ConflictingPublicController.prototype.read
  );

  assert.throws(
    () =>
      collect(
        [ConflictingPublicController],
        sourceIndex([
          [
            "ConflictingPublicController",
            "read",
            "services/api/src/public-conflict.controller.ts"
          ]
        ])
      ),
    (error) => error?.code === "ROUTE_MANIFEST_CONFLICTING_GUARD_METADATA"
  );
});

test("marks positions and project action metadata as AND", () => {
  class PermissionController {
    approve() {}
  }
  controller(PermissionController, "contracts");
  route(
    PermissionController.prototype.approve,
    RequestMethod.POST,
    ":contractId/approval"
  );
  Reflect.defineMetadata(
    "requiredPositions",
    ["chairman"],
    PermissionController.prototype.approve
  );
  Reflect.defineMetadata(
    "requiredProjectAction",
    "contract.approve",
    PermissionController.prototype.approve
  );

  const [entry] = collect(
    [PermissionController],
    sourceIndex([
      [
        "PermissionController",
        "approve",
        "services/api/src/permission.controller.ts"
      ]
    ])
  );

  assert.equal(entry.guardAuthorization, "positions_and_project_action");
  assert.equal(entry.authorizationCombination, "AND");
});

test("captures contract cutover surface and legacy write metadata", () => {
  class CutoverController {
    save() {}
  }
  controller(CutoverController, "contract-workbench");
  route(CutoverController.prototype.save, RequestMethod.PATCH, ":versionId");
  Reflect.defineMetadata("contract_cutover_surface", true, CutoverController);
  Reflect.defineMetadata(
    "contract_cutover_legacy_write",
    true,
    CutoverController.prototype.save
  );

  const [entry] = collect(
    [CutoverController],
    sourceIndex([
      [
        "CutoverController",
        "save",
        "services/api/src/cutover.controller.ts"
      ]
    ])
  );

  assert.equal(entry.contractCutoverSurface, true);
  assert.equal(entry.contractCutoverLegacyWrite, true);
});

test("expands controller, handler and method arrays and normalizes parameters", () => {
  class ArrayController {
    run() {}
  }
  controller(ArrayController, ["alpha/:projectId", "beta/:projectId"]);
  route(
    ArrayController.prototype.run,
    [RequestMethod.GET, RequestMethod.POST],
    [":recordId", ":recordId/detail"]
  );

  const routes = collect(
    [ArrayController],
    sourceIndex([
      ["ArrayController", "run", "services/api/src/array.controller.ts"]
    ])
  );

  assert.equal(routes.length, 8);
  assert.ok(
    routes.some(
      (item) => item.normalizedKey === "POST /beta/:param/:param/detail"
    )
  );
  assert.ok(
    routes.some((item) => item.path === "/beta/:projectId/:recordId/detail")
  );
});

test("fails closed for duplicate normalized method and path", () => {
  class FirstController {
    read() {}
  }
  class SecondController {
    read() {}
  }
  controller(FirstController, "items");
  controller(SecondController, "items");
  route(FirstController.prototype.read, RequestMethod.GET, ":firstId");
  route(SecondController.prototype.read, RequestMethod.GET, ":secondId");

  assert.throws(
    () =>
      collect(
        [FirstController, SecondController],
        sourceIndex([
          [
            "FirstController",
            "read",
            "services/api/src/first.controller.ts"
          ],
          [
            "SecondController",
            "read",
            "services/api/src/second.controller.ts"
          ]
        ])
      ),
    (error) => error?.code === "ROUTE_MANIFEST_DUPLICATE_ROUTE"
  );
});

test("fails closed for unknown role and project action metadata", () => {
  class UnknownController {
    role() {}
    action() {}
  }
  controller(UnknownController, "unknown");
  route(UnknownController.prototype.role, RequestMethod.GET, "role");
  route(UnknownController.prototype.action, RequestMethod.GET, "action");
  Reflect.defineMetadata(
    "requiredPositions",
    ["invented_role"],
    UnknownController.prototype.role
  );
  Reflect.defineMetadata(
    "requiredProjectAction",
    "invented.action",
    UnknownController.prototype.action
  );
  const sources = sourceIndex([
    ["UnknownController", "role", "services/api/src/unknown.controller.ts"],
    ["UnknownController", "action", "services/api/src/unknown.controller.ts"]
  ]);

  assert.throws(
    () => collect([UnknownController], sources),
    (error) => error?.code === "ROUTE_MANIFEST_UNKNOWN_POSITION"
  );

  Reflect.deleteMetadata("requiredPositions", UnknownController.prototype.role);
  assert.throws(
    () => collect([UnknownController], sources),
    (error) => error?.code === "ROUTE_MANIFEST_UNKNOWN_ACTION"
  );
});

test("indexes class and handler source files and rejects missing or duplicate mappings", async () => {
  const root = await mkdtemp(join(tmpdir(), "whole-site-source-map-"));
  try {
    await mkdir(join(root, "services/api/src/first"), { recursive: true });
    await mkdir(join(root, "services/api/src/second"), { recursive: true });
    await writeFile(
      join(root, "services/api/src/first/example.controller.ts"),
      "export class SourceController { read() {} }\n",
      "utf8"
    );
    const indexed = await indexControllerSources({ root, typescript: ts });
    assert.equal(
      indexed.get(controllerSourceKey("SourceController", "read")),
      "services/api/src/first/example.controller.ts"
    );

    class MissingController {
      read() {}
    }
    controller(MissingController, "missing");
    route(MissingController.prototype.read, RequestMethod.GET, "");
    assert.throws(
      () => collect([MissingController], indexed),
      (error) => error?.code === "ROUTE_MANIFEST_SOURCE_MAPPING_MISSING"
    );

    await writeFile(
      join(root, "services/api/src/second/example.controller.ts"),
      "export class SourceController { read() {} }\n",
      "utf8"
    );
    await assert.rejects(
      indexControllerSources({ root, typescript: ts }),
      (error) => error?.code === "ROUTE_MANIFEST_SOURCE_MAPPING_DUPLICATE"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compares metadata and Express route normalized-key multisets", () => {
  const metadataRoutes = [
    {
      method: "GET",
      path: "/items/:param",
      normalizedKey: "GET /items/:param"
    },
    {
      method: "POST",
      path: "/items",
      normalizedKey: "POST /items"
    }
  ];
  assert.doesNotThrow(() =>
    assertRuntimeRouteParity(metadataRoutes, [
      "POST /items",
      "GET /items/:itemId"
    ])
  );
  assert.throws(
    () =>
      assertRuntimeRouteParity(metadataRoutes, [
        "GET /items/:itemId",
        "GET /items/:anotherId"
      ]),
    (error) => error?.code === "ROUTE_MANIFEST_RUNTIME_DRIFT"
  );
});

test("collapses an actual Express app.all route to one ALL entry", () => {
  const platformExpressRequire = createRequire(
    apiRequire.resolve("@nestjs/platform-express/package.json")
  );
  const express = platformExpressRequire("express");
  const allMethods = platformExpressRequire("methods");
  const expressApp = express();
  expressApp.all("/all/:recordId", (_request, response) => response.end());
  const app = {
    getHttpAdapter() {
      return {
        getInstance() {
          return expressApp;
        }
      };
    }
  };

  assert.deepEqual(collectExpressRouteKeys(app, allMethods), [
    "ALL /all/:recordId"
  ]);
});

test("fails closed when any build input is newer than app.module.js", async () => {
  const root = await mkdtemp(join(tmpdir(), "whole-site-build-freshness-"));
  const artifact = "services/api/dist/app.module.js";
  const inputs = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "services/api/package.json",
    "services/api/nest-cli.json",
    "services/api/tsconfig.json",
    "services/api/tsconfig.build.json",
    "services/api/src/example.ts",
    "packages/shared-domain/package.json",
    "packages/shared-domain/tsconfig.json",
    "packages/shared-domain/src/example.ts"
  ];
  async function fixtureFile(relativePath) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${relativePath}\n`, "utf8");
    return target;
  }

  try {
    const artifactPath = await fixtureFile(artifact);
    for (const input of inputs) await fixtureFile(input);
    const artifactTime = 1_700_000_000.0001;
    const newerInputTime = 1_700_000_000.0008;
    for (const input of inputs) {
      await utimes(join(root, input), artifactTime - 10, artifactTime - 10);
    }
    await utimes(artifactPath, artifactTime, artifactTime);
    await assertBuildArtifactFresh({ root });

    for (const input of inputs) {
      const inputPath = join(root, input);
      await utimes(inputPath, newerInputTime, newerInputTime);
      const [artifactStats, inputStats] = await Promise.all([
        stat(artifactPath, { bigint: true }),
        stat(inputPath, { bigint: true })
      ]);
      assert.equal(
        artifactStats.mtimeNs / 1_000_000n,
        inputStats.mtimeNs / 1_000_000n
      );
      assert.ok(inputStats.mtimeNs > artifactStats.mtimeNs);
      await assert.rejects(
        assertBuildArtifactFresh({ root }),
        (error) => error?.code === "ROUTE_MANIFEST_BUILD_STALE"
      );
      if (input === inputs[0]) {
        await assert.rejects(
          runWholeSiteRouteManifestCli(["--check"], { root }),
          (error) => error?.code === "ROUTE_MANIFEST_BUILD_STALE"
        );
      }
      await utimes(inputPath, artifactTime - 10, artifactTime - 10);
    }

    await rm(artifactPath);
    await assert.rejects(
      assertBuildArtifactFresh({ root }),
      (error) => error?.code === "ROUTE_MANIFEST_BUILD_STALE"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads the built AppModule and restores the inspection environment", async () => {
  const keys = [
    "SKIP_DATABASE_CONNECT",
    "FILE_STORAGE_DRIVER",
    "FILE_STORAGE_ROOT",
    "FILE_DOWNLOAD_SECRET",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET"
  ];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = `restore-${key}`;
  try {
    const routes = await inspectBuiltNestRouteManifest({
      root: fileURLToPath(new URL("..", import.meta.url))
    });
    assert.ok(routes.length > 300);
    assert.ok(
      routes.every((item) =>
        item.sourceFile.startsWith("services/api/src/")
      )
    );
    for (const key of keys) {
      assert.equal(process.env[key], `restore-${key}`);
    }
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("renders stable schema-versioned JSON without generatedAt", () => {
  const routes = [
    { normalizedKey: "POST /z", method: "POST", path: "/z" },
    { normalizedKey: "GET /a", method: "GET", path: "/a" }
  ];
  const first = renderRouteManifest(routes);
  const second = renderRouteManifest([...routes].reverse());
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.authorizationScope, "guard_metadata_only");
  assert.equal("generatedAt" in parsed, false);
  assert.deepEqual(
    parsed.routes.map((item) => item.normalizedKey),
    ["GET /a", "POST /z"]
  );
});

test("writes a manifest and fails closed when the checked baseline drifts", async () => {
  const root = await mkdtemp(join(tmpdir(), "whole-site-baseline-"));
  const targetPath = join(root, "manifest.json");
  try {
    const rendered = renderRouteManifest([
      { normalizedKey: "GET /health", method: "GET", path: "/health" }
    ]);
    await writeOrCheckRouteManifest({
      mode: "write",
      targetPath,
      rendered
    });
    assert.equal(await readFile(targetPath, "utf8"), rendered);
    await writeOrCheckRouteManifest({
      mode: "check",
      targetPath,
      rendered
    });
    await writeFile(targetPath, "{}\n", "utf8");
    await assert.rejects(
      writeOrCheckRouteManifest({
        mode: "check",
        targetPath,
        rendered
      }),
      (error) => error?.code === "ROUTE_MANIFEST_BASELINE_DRIFT"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI rejects unknown arguments without echoing sensitive input", () => {
  const sensitive = "/tmp/private-token-value";
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--unknown", sensitive], {
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.equal(
    result.stderr,
    "WHOLE_SITE_ROUTE_MANIFEST_FAILED: Route manifest inspection failed\n"
  );
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.includes(sensitive), false);
});
