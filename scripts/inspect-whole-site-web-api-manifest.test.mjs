import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectWholeSiteWebApiManifest,
  renderWholeSiteWebApiManifest,
  writeOrCheckWholeSiteWebApiManifest
} from "./lib/whole-site-web-api-manifest.mjs";
import { runWholeSiteWebApiManifestCli } from "./inspect-whole-site-web-api-manifest.mjs";

async function writeFixture(root, files) {
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
}

async function withFixture(files, callback) {
  const root = await mkdtemp(join(tmpdir(), "jg-web-api-manifest-"));
  try {
    await writeFixture(root, {
      "apps/web-admin/package.json": JSON.stringify({
        name: "@fixture/web",
        private: true,
        type: "module"
      }),
      "apps/web-admin/src/api/api-fetch.ts": `
        export async function apiFetch(path: string, init: RequestInit = {}) {
          return fetch("/api" + path, init);
        }
      `,
      "apps/web-admin/src/main.ts": `
        import "./routes";
      `,
      "apps/web-admin/src/routes/index.ts": `
        export { routes } from "./route-records";
      `,
      "apps/web-admin/src/routes/route-records.ts": `
        export const routes = [{
          path: "/fixture",
          component: () => import("../pages/FixturePage.vue")
        }];
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts"></script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: []
      }),
      ...files
    });
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("follows helper parameters and finite method and path unions", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        async function send(path: string, method: "POST" | "PATCH", body: unknown) {
          const response = await apiFetch(path, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          return response.json();
        }
        export function saveExample(id: string, method: "POST" | "PATCH") {
          return send("/examples/" + encodeURIComponent(id), method, { id });
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { saveExample } from "../api/example.api";
        void saveExample("example-1", "POST");
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          { method: "POST", path: "/examples/:id", normalizedKey: "POST /examples/:param" },
          { method: "PATCH", path: "/examples/:id", normalizedKey: "PATCH /examples/:param" }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.deepEqual(
        manifest.wrappers[0].requests.map(({ method, normalizedPath, bodyKind }) => ({
          method,
          normalizedPath,
          bodyKind
        })),
        [
          { method: "PATCH", normalizedPath: "/examples/:param", bodyKind: "json" },
          { method: "POST", normalizedPath: "/examples/:param", bodyKind: "json" }
        ]
      );
      assert.equal(manifest.status, "ready");
    }
  );
});

test("rendering is deterministic and omits wall-clock fields", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        export function pureHelper(value: string) { return value.trim(); }
      `
    },
    async (root) => {
      const first = await inspectWholeSiteWebApiManifest({ root });
      const second = await inspectWholeSiteWebApiManifest({ root });
      const rendered = renderWholeSiteWebApiManifest(first);
      assert.equal(rendered, renderWholeSiteWebApiManifest(second));
      assert.doesNotMatch(rendered, /generatedAt/);
      assert.deepEqual(first.summary, {
        apiModuleCount: 1,
        exportedFunctionCount: 1,
        transportWrapperCount: 0,
        pureExportCount: 1,
        mainRequestBindingCount: 0,
        ticketFollowupCount: 0,
        requestEdgeCount: 0,
        productionConsumerCount: 0,
        orphanWrapperCount: 0,
        testOnlyWrapperCount: 0,
        unreferencedWrapperCount: 0,
        duplicateNormalizedRouteGroupCount: 0,
        authTransportExceptionCount: 0
      });
    }
  );
});

test("captures nested request calls without double-counting finite bindings", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        async function post(path: string) {
          return apiFetch(path, { method: "POST" });
        }
        function normalize(value: unknown) {
          return value as { downloadPath: string };
        }
        export async function openExample(id: string) {
          const ticket = normalize(await post(
            "/examples/" + encodeURIComponent(id) + "/download-ticket"
          ));
          return apiFetch(ticket.downloadPath);
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { openExample } from "../api/example.api";
        void openExample("example-1");
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "POST",
            path: "/examples/:id/download-ticket",
            normalizedKey: "POST /examples/:param/download-ticket"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.equal(manifest.summary.mainRequestBindingCount, 1);
      assert.equal(manifest.summary.ticketFollowupCount, 1);
      assert.equal(manifest.summary.requestEdgeCount, 2);
      assert.equal(manifest.status, "ready");
    }
  );
});

test("fails closed for unreachable wrappers, duplicate bindings, and dangling routes", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        export function first() { return apiFetch("/examples"); }
        export function duplicate() { return apiFetch("/examples"); }
        export function dangling() { return apiFetch("/missing"); }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { first } from "../api/example.api";
        void first();
        </script>
        <template><main>fixture</main></template>
      `,
      "apps/web-admin/src/api/example.api.test.ts": `
        import { duplicate } from "./example.api";
        void duplicate();
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "GET",
            path: "/examples",
            normalizedKey: "GET /examples"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.equal(manifest.status, "blocked");
      assert.equal(manifest.summary.orphanWrapperCount, 2);
      assert.equal(manifest.summary.testOnlyWrapperCount, 1);
      assert.equal(manifest.summary.unreferencedWrapperCount, 1);
      assert.equal(
        manifest.summary.duplicateNormalizedRouteGroupCount,
        1
      );
      assert.deepEqual(
        manifest.blockers.frontendWithoutBackend.map(
          (item) => item.normalizedKey
        ),
        ["GET /missing"]
      );
    }
  );
});

test("write and check preserve blocked evidence while require-ready fails", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        export function orphan() { return apiFetch("/examples"); }
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "GET",
            path: "/examples",
            normalizedKey: "GET /examples"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await runWholeSiteWebApiManifestCli(["--write"], {
        root
      });
      assert.equal(manifest.status, "blocked");
      await runWholeSiteWebApiManifestCli(["--check"], { root });
      await assert.rejects(
        runWholeSiteWebApiManifestCli(
          ["--check", "--require-ready"],
          { root }
        ),
        (error) => error.code === "WEB_API_MANIFEST_BLOCKED"
      );

      const target = join(
        root,
        "docs/product/manifests/web-api-wrappers.json"
      );
      await writeOrCheckWholeSiteWebApiManifest({
        mode: "check",
        targetPath: target,
        rendered: await readFile(target, "utf8")
      });
    }
  );
});

test("classifies JSON string bodies and verifies auth transport exceptions", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        export function applyExample() {
          return apiFetch("/examples/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
        }
      `,
      "apps/web-admin/src/auth/auth.store.ts": `
        async function postAuth(path: string, body: unknown) {
          return fetch("/api/auth/" + path, {
            method: "POST",
            body: JSON.stringify(body)
          });
        }
        export function login(body: unknown) {
          return postAuth("login", body);
        }
        export function updateProfile(body: unknown) {
          return fetch("/api/auth/profile", {
            method: "PATCH",
            body: JSON.stringify(body)
          });
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { applyExample } from "../api/example.api";
        void applyExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "POST",
            path: "/examples/apply",
            normalizedKey: "POST /examples/apply"
          },
          {
            method: "POST",
            path: "/auth/login",
            normalizedKey: "POST /auth/login"
          },
          {
            method: "PATCH",
            path: "/auth/profile",
            normalizedKey: "PATCH /auth/profile"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.equal(manifest.wrappers[0].requests[0].bodyKind, "json");
      assert.deepEqual(
        manifest.authTransportExceptions.map((item) => item.normalizedKey),
        ["PATCH /auth/profile", "POST /auth/login"]
      );
      assert.deepEqual(manifest.blockers.authWithoutBackend, []);
      assert.equal(manifest.status, "ready");
    }
  );
});

test("separates unreachable consumers and rejects unknown HTTP methods", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        async function send(path: string, method: string) {
          return apiFetch(path, { method });
        }
        export function hidden(method: string) {
          return send("/examples", method);
        }
      `,
      "apps/web-admin/src/pages/UnusedPage.vue": `
        <script setup lang="ts">
        import { hidden } from "../api/example.api";
        void hidden("POST");
        </script>
        <template><main>unused</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: []
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.equal(manifest.status, "blocked");
      assert.deepEqual(
        manifest.wrappers[0].unreachableConsumers,
        ["apps/web-admin/src/pages/UnusedPage.vue"]
      );
      assert.deepEqual(manifest.wrappers[0].testConsumers, []);
      assert.equal(
        manifest.blockers.orphanWrappers[0].classification,
        "unreachable_only"
      );
      assert.equal(
        manifest.blockers.unresolvedRequests[0].reason,
        "dynamic_method"
      );
    }
  );
});

test("does not accept a dead wrapper reference as a production consumer", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        export function unusedExample() {
          return apiFetch("/examples");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { unusedExample } from "../api/example.api";
        const neverUsed = unusedExample;
        void neverUsed;
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "GET",
            path: "/examples",
            normalizedKey: "GET /examples"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.equal(manifest.status, "blocked");
      assert.equal(manifest.summary.productionConsumerCount, 0);
      assert.equal(
        manifest.blockers.orphanWrappers[0].classification,
        "unreferenced"
      );
    }
  );
});

test("resolves apiFetch aliases and blocks unknown transport delegates", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/transport.ts": `
        export async function request(path: string) {
          return fetch("/api" + path);
        }
      `,
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch as request } from "./api-fetch";
        export function aliasedExample() {
          return request("/examples");
        }
      `,
      "apps/web-admin/src/api/unknown.api.ts": `
        import { request } from "./transport";
        export function delegatedExample() {
          return request("/delegated");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { aliasedExample } from "../api/example.api";
        import { delegatedExample } from "../api/unknown.api";
        void aliasedExample();
        void delegatedExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "GET",
            path: "/examples",
            normalizedKey: "GET /examples"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const aliased = manifest.wrappers.find(
        (wrapper) => wrapper.name === "aliasedExample"
      );
      const delegated = manifest.wrappers.find(
        (wrapper) => wrapper.name === "delegatedExample"
      );
      assert.equal(
        aliased.requests[0].normalizedKey,
        "GET /examples"
      );
      assert.equal(delegated.kind, "transport");
      assert.equal(
        delegated.requests[0].unresolvedReason,
        "unknown_transport_delegate"
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("require-ready rejects a ready web report when Nest evidence is stale", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        export function loadExample() {
          return apiFetch("/examples");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { loadExample } from "../api/example.api";
        void loadExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "GET",
            path: "/examples",
            normalizedKey: "GET /examples"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await runWholeSiteWebApiManifestCli(["--write"], {
        root
      });
      assert.equal(manifest.status, "ready");
      await assert.rejects(
        runWholeSiteWebApiManifestCli(
          ["--check", "--require-ready"],
          { root }
        ),
        (error) => error.code === "ROUTE_MANIFEST_BUILD_STALE"
      );
    }
  );
});
