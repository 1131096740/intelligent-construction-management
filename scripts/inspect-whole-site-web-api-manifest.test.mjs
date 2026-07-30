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

test("classifies wrapper return provenance without trusting local projections", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        declare function normalizeExternal<T>(value: T): T;
        declare function formatApiErrorMessage(
          message: unknown,
          status: number,
          fallback: string
        ): string;

        function identity<T>(value: T): T {
          const alias = value as T;
          return alias;
        }

        async function readJson<T>(path: string): Promise<T> {
          const response = await apiFetch(path);
          const responseAlias = response;
          return responseAlias.json() as Promise<T>;
        }

        async function ensureOk(
          response: Response,
          fallback = "读取失败"
        ) {
          if (response.ok) return;
          let message = fallback + "：" + response.status;
          try {
            const data = (await response.clone().json()) as {
              message?: unknown;
            };
            if (typeof data.message === "string") {
              message = formatApiErrorMessage(
                data.message,
                response.status,
                fallback
              );
            } else if (Array.isArray(data.message)) {
              message = formatApiErrorMessage(
                data.message.join("；"),
                response.status,
                fallback
              );
            }
          } catch {
            message = formatApiErrorMessage(
              message,
              response.status,
              fallback
            );
          }
          throw new Error(message);
        }

        export function transparentExample() {
          return identity(readJson<{ availableActions: string[] }>("/transparent"));
        }

        export async function validatedTransparentExample() {
          const response = await apiFetch("/validated-transparent");
          await ensureOk(response);
          return response.json();
        }

        export async function validatedDestructuredMetadataExample() {
          const response = await apiFetch("/validated-destructured-metadata");
          const { status } = response;
          formatApiErrorMessage("", status, "读取失败");
          return response.json();
        }

        export async function branchedValidatedTransparentExample(
          first: boolean,
          second: boolean
        ) {
          if (first) {
            const firstMarker = first;
            void firstMarker;
          }
          if (second) {
            const secondMarker = second;
            void secondMarker;
          }
          const response = await apiFetch("/branched-validated-transparent");
          if (response.ok) return response.json();
          throw new Error("读取失败");
        }

        export async function mixedResponseStageExample(
          returnResponse: boolean
        ) {
          const response = await apiFetch("/mixed-response-stage");
          return returnResponse ? response : response.json();
        }

        export async function projectedExample() {
          const values = await readJson<Array<{ enabled: boolean }>>("/projected");
          return values.map((value) => ({ isEnabled: value.enabled }));
        }

        export async function fabricatedExample() {
          await apiFetch("/fabricated");
          return { availableActions: [] };
        }

        export async function arrayExample() {
          const value = await readJson<{ availableActions: string[] }>("/array");
          return [value];
        }

        export async function spreadExample() {
          const value = await readJson<{ availableActions: string[] }>("/spread");
          return { ...value };
        }

        export async function unknownHelperExample() {
          const value = await readJson<{ availableActions: string[] }>("/unknown-helper");
          return normalizeExternal(value);
        }

        export async function mixedExample(useServer: boolean) {
          const response = await apiFetch("/mixed");
          if (useServer) return response.json();
          return [];
        }

        export async function downloadExample() {
          const response = await apiFetch("/download");
          const blob = await response.blob();
          void blob;
        }

        export async function explicitVoidExample() {
          await apiFetch("/explicit-void");
          return;
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          downloadExample,
          explicitVoidExample,
          arrayExample,
          fabricatedExample,
          mixedExample,
          projectedExample,
          spreadExample,
          transparentExample,
          validatedTransparentExample,
          validatedDestructuredMetadataExample,
          branchedValidatedTransparentExample,
          mixedResponseStageExample,
          unknownHelperExample
        } from "../api/example.api";
        void arrayExample();
        void transparentExample();
        void validatedTransparentExample();
        void validatedDestructuredMetadataExample();
        void branchedValidatedTransparentExample(true, true);
        void mixedResponseStageExample(true);
        void projectedExample();
        void fabricatedExample();
        void spreadExample();
        void unknownHelperExample();
        void mixedExample(true);
        void downloadExample();
        void explicitVoidExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "/transparent",
          "/validated-transparent",
          "/validated-destructured-metadata",
          "/branched-validated-transparent",
          "/mixed-response-stage",
          "/projected",
          "/fabricated",
          "/array",
          "/spread",
          "/unknown-helper",
          "/mixed",
          "/download",
          "/explicit-void"
        ].map((path) => ({
          method: "GET",
          path,
          normalizedKey: `GET ${path}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.deepEqual(
        Object.fromEntries(
          manifest.wrappers.map((wrapper) => [
            wrapper.name,
            wrapper.returnProvenance
          ])
        ),
        {
          arrayExample: "unverified",
          branchedValidatedTransparentExample:
            "transparent_main_response",
          downloadExample: "none",
          explicitVoidExample: "none",
          fabricatedExample: "unverified",
          mixedExample: "unverified",
          mixedResponseStageExample: "unverified",
          projectedExample: "unverified",
          spreadExample: "unverified",
          transparentExample: "transparent_main_response",
          validatedTransparentExample:
            "transparent_main_response",
          validatedDestructuredMetadataExample:
            "transparent_main_response",
          unknownHelperExample: "unverified"
        }
      );
      assert.equal(manifest.status, "ready");
    }
  );
});

test("fails return provenance closed for stale aliases and helper cycles", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";

        function identity<T>(value: T): T {
          return value;
        }

        function fabricate<T>(value: T) {
          return { value };
        }

        function recurseLeft<T>(value: T): T {
          return recurseRight(value);
        }

        function recurseRight<T>(value: T): T {
          return recurseLeft(value);
        }

        export async function freshAliasExample() {
          let response: unknown = await apiFetch("/fresh-alias");
          const alias = response as Response;
          response = {};
          return identity(await alias.json());
        }

        export async function staleAliasExample() {
          let result: unknown = await apiFetch("/stale-alias");
          result = [];
          return result;
        }

        export async function compoundAliasExample() {
          let result: unknown = await apiFetch("/compound-alias");
          result ||= {};
          return result;
        }

        export async function staleHelperExample() {
          let helper = identity;
          helper = fabricate;
          return helper(await apiFetch("/stale-helper"));
        }

        export async function cyclicHelperExample() {
          return recurseLeft(await apiFetch("/cycle"));
        }

        export async function unreachableProjectionExample() {
          const response = await apiFetch("/unreachable");
          return response.json();
          return { fabricated: true };
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          compoundAliasExample,
          cyclicHelperExample,
          freshAliasExample,
          staleAliasExample,
          staleHelperExample,
          unreachableProjectionExample
        } from "../api/example.api";
        void compoundAliasExample();
        void cyclicHelperExample();
        void freshAliasExample();
        void staleAliasExample();
        void staleHelperExample();
        void unreachableProjectionExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "/fresh-alias",
          "/stale-alias",
          "/compound-alias",
          "/stale-helper",
          "/cycle",
          "/unreachable"
        ].map((path) => ({
          method: "GET",
          path,
          normalizedKey: `GET ${path}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const provenance = Object.fromEntries(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper.returnProvenance
        ])
      );
      assert.equal(
        provenance.freshAliasExample,
        "transparent_main_response"
      );
      assert.equal(provenance.staleAliasExample, "unverified");
      assert.equal(provenance.compoundAliasExample, "unverified");
      assert.equal(provenance.staleHelperExample, "unverified");
      assert.equal(provenance.cyclicHelperExample, "unverified");
      assert.equal(
        provenance.unreachableProjectionExample,
        "transparent_main_response"
      );
    }
  );
});

test("fails return provenance closed when the main response or a descendant is mutated", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        declare function mutateExternal(value: unknown): void;

        export async function nestedPushExample() {
          const response = await apiFetch("/nested-push");
          const result = await response.json();
          result.availableActions.push({ key: "forged_action" });
          return result;
        }

        export async function descendantAliasMutationExample() {
          const response = await apiFetch("/descendant-alias");
          const result = await response.json();
          const actions = result.availableActions;
          Object.assign(actions, { forged: true });
          return result;
        }

        export async function deleteExample() {
          const response = await apiFetch("/delete");
          const result = await response.json();
          delete result.availableActions;
          return result;
        }

        export async function destructuredDescendantExample() {
          const response = await apiFetch("/destructured-descendant");
          const result = await response.json();
          const { availableActions } = result;
          availableActions.push({ key: "forged_action" });
          return result;
        }

        export async function containerDescendantExample() {
          const response = await apiFetch("/container-descendant");
          const result = await response.json();
          const box = { result };
          box.result.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function dynamicContainerDescendantExample() {
          const response = await apiFetch("/dynamic-container-descendant");
          const result = await response.json();
          const box = { result };
          const key = "result";
          const alias = box[key];
          alias.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function computedContainerDescendantExample() {
          const response = await apiFetch("/computed-container-descendant");
          const result = await response.json();
          const key = "result";
          const box = { [key]: result };
          box.result.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function computedBeforeKnownDescendantExample() {
          const response = await apiFetch("/computed-before-known");
          const result = await response.json();
          const key = "unknown";
          const box = { [key]: 0, result };
          box.result.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function spreadBeforeKnownDescendantExample() {
          const response = await apiFetch("/spread-before-known");
          const result = await response.json();
          const other = {};
          const box = { ...other, result };
          box.result.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function getterContainerDescendantExample() {
          const response = await apiFetch("/getter-container-descendant");
          const result = await response.json();
          const box = {
            get result() {
              return result;
            }
          };
          box.result.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function voidUnknownHelperExample() {
          const response = await apiFetch("/void-unknown-helper");
          const result = await response.json();
          void mutateExternal(result);
          return result;
        }

        export async function conditionalAliasMutationExample(
          flag: boolean
        ) {
          const response = await apiFetch("/conditional-alias");
          const result = await response.json();
          const alias = flag ? result : result;
          alias.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function logicalContainerMutationExample(
          flag: boolean
        ) {
          const response = await apiFetch("/logical-container");
          const result = await response.json();
          const box = flag && { result };
          if (box) {
            box.result.availableActions.push({
              key: "forged_action"
            });
          }
          return result;
        }

        export async function dynamicObjectBindingMutationExample(
          key: string
        ) {
          const response = await apiFetch("/dynamic-object-binding");
          const result = await response.json();
          const box = { result };
          const { [key]: alias } = box;
          alias.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function dynamicObjectAssignmentMutationExample(
          key: string
        ) {
          const response = await apiFetch("/dynamic-object-assignment");
          const result = await response.json();
          const box = { result };
          let alias;
          ({ [key]: alias } = box);
          alias.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function staticObjectAssignmentMutationExample() {
          const response = await apiFetch("/static-object-assignment");
          const result = await response.json();
          const box = { result };
          let alias;
          ({ result: alias } = box);
          alias.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function arrayAssignmentMutationExample() {
          const response = await apiFetch("/array-assignment");
          const result = await response.json();
          const box = [result];
          let alias;
          [alias] = box;
          alias.availableActions.push({
            key: "forged_action"
          });
          return result;
        }

        export async function finallyMutationExample() {
          const response = await apiFetch("/finally-mutation");
          const result = await response.json();
          try {
            return result;
          } finally {
            result.availableActions.push({
              key: "forged_action"
            });
          }
        }

        export async function finallyAssignedMutationExample() {
          let result;
          try {
            const response = await apiFetch("/finally-assigned");
            result = await response.json();
            return result;
          } finally {
            result.availableActions.push({
              key: "forged_action"
            });
          }
        }

        function mutateDestructured({
          availableActions
        }: {
          availableActions: Array<{ key: string }>;
        }) {
          availableActions.push({ key: "forged_action" });
        }

        export async function destructuredHelperExample() {
          const response = await apiFetch("/destructured-helper");
          const result = await response.json();
          mutateDestructured(result);
          return result;
        }

        export async function nestedClosureExample() {
          const response = await apiFetch("/nested-closure");
          const result = await response.json();
          function mutate() {
            result.availableActions.push({
              key: "forged_action"
            });
          }
          mutate();
          return result;
        }

        export async function loopReplacementExample() {
          const response = await apiFetch("/loop-replacement");
          let result = await response.json();
          let pending = true;
          while (pending) {
            result = { availableActions: [{ key: "forged_action" }] };
            pending = false;
          }
          return result;
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          deleteExample,
          descendantAliasMutationExample,
          destructuredDescendantExample,
          containerDescendantExample,
          dynamicContainerDescendantExample,
          computedContainerDescendantExample,
          computedBeforeKnownDescendantExample,
          spreadBeforeKnownDescendantExample,
          getterContainerDescendantExample,
          voidUnknownHelperExample,
          conditionalAliasMutationExample,
          logicalContainerMutationExample,
          dynamicObjectBindingMutationExample,
          dynamicObjectAssignmentMutationExample,
          staticObjectAssignmentMutationExample,
          arrayAssignmentMutationExample,
          finallyMutationExample,
          finallyAssignedMutationExample,
          destructuredHelperExample,
          nestedClosureExample,
          loopReplacementExample,
          nestedPushExample
        } from "../api/example.api";
        void deleteExample();
        void descendantAliasMutationExample();
        void destructuredDescendantExample();
        void containerDescendantExample();
        void dynamicContainerDescendantExample();
        void computedContainerDescendantExample();
        void computedBeforeKnownDescendantExample();
        void spreadBeforeKnownDescendantExample();
        void getterContainerDescendantExample();
        void voidUnknownHelperExample();
        void conditionalAliasMutationExample(true);
        void logicalContainerMutationExample(true);
        void dynamicObjectBindingMutationExample("result");
        void dynamicObjectAssignmentMutationExample("result");
        void staticObjectAssignmentMutationExample();
        void arrayAssignmentMutationExample();
        void finallyMutationExample();
        void finallyAssignedMutationExample();
        void destructuredHelperExample();
        void nestedClosureExample();
        void loopReplacementExample();
        void nestedPushExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "/nested-push",
          "/descendant-alias",
          "/delete",
          "/destructured-descendant",
          "/container-descendant",
          "/dynamic-container-descendant",
          "/computed-container-descendant",
          "/computed-before-known",
          "/spread-before-known",
          "/getter-container-descendant",
          "/void-unknown-helper",
          "/conditional-alias",
          "/logical-container",
          "/dynamic-object-binding",
          "/dynamic-object-assignment",
          "/static-object-assignment",
          "/array-assignment",
          "/finally-mutation",
          "/finally-assigned",
          "/destructured-helper",
          "/nested-closure",
          "/loop-replacement"
        ].map((path) => ({
          method: "GET",
          path,
          normalizedKey: `GET ${path}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const provenance = Object.fromEntries(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper.returnProvenance
        ])
      );
      assert.equal(provenance.nestedPushExample, "unverified");
      assert.equal(
        provenance.descendantAliasMutationExample,
        "unverified"
      );
      assert.equal(provenance.deleteExample, "unverified");
      assert.equal(
        provenance.destructuredDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.containerDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.dynamicContainerDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.computedContainerDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.computedBeforeKnownDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.spreadBeforeKnownDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.getterContainerDescendantExample,
        "unverified"
      );
      assert.equal(
        provenance.voidUnknownHelperExample,
        "unverified"
      );
      assert.equal(
        provenance.conditionalAliasMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.logicalContainerMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.dynamicObjectBindingMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.dynamicObjectAssignmentMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.staticObjectAssignmentMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.arrayAssignmentMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.finallyMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.finallyAssignedMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.destructuredHelperExample,
        "unverified"
      );
      assert.equal(
        provenance.nestedClosureExample,
        "unverified"
      );
      assert.equal(provenance.loopReplacementExample, "unverified");
    }
  );
});

test("does not bind transparent provenance to multiple main request edges", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        export async function loadExample(useFirst: boolean) {
          const first = await apiFetch("/examples/first");
          if (useFirst) return first.json();
          const second = await apiFetch("/examples/second");
          return second.json();
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import { loadExample } from "../api/example.api";
        void loadExample(true);
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "GET",
            path: "/examples/first",
            normalizedKey: "GET /examples/first"
          },
          {
            method: "GET",
            path: "/examples/second",
            normalizedKey: "GET /examples/second"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      assert.equal(
        manifest.wrappers[0].returnProvenance,
        "unverified"
      );
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
