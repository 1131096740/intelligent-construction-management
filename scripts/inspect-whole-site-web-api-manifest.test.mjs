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
        declare function scheduleExternal(
          callback: () => void
        ): void;

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

        export async function objectClosureMutationExample() {
          const result = await (
            await apiFetch("/object-closure-mutation")
          ).json();
          const mutator = {
            run: () => {
              result.availableActions.push({
                key: "forged_action"
              });
            }
          };
          mutator.run();
          return result;
        }

        export async function objectClosureArgumentMutationExample() {
          const result = await (
            await apiFetch("/object-closure-argument-mutation")
          ).json();
          const mutator = {
            run: (_reason: string) => {
              result.availableActions.push({
                key: "forged_action"
              });
            }
          };
          mutator.run("forged");
          return result;
        }

        export async function aliasedClosureMutationExample() {
          const result = await (
            await apiFetch("/aliased-closure-mutation")
          ).json();
          const mutate = (_reason: string) => {
            result.availableActions.push({
              key: "forged_action"
            });
          };
          const run = mutate;
          run("forged");
          return result;
        }

        export async function queuedClosureMutationExample() {
          const result = await (
            await apiFetch("/queued-closure-mutation")
          ).json();
          queueMicrotask(() => {
            result.availableActions.push({
              key: "forged_action"
            });
          });
          return result;
        }

        export async function timerClosureMutationExample() {
          const result = await (
            await apiFetch("/timer-closure-mutation")
          ).json();
          setTimeout(() => {
            result.availableActions.push({
              key: "forged_action"
            });
          }, 0);
          return result;
        }

        export async function promiseClosureMutationExample() {
          const result = await (
            await apiFetch("/promise-closure-mutation")
          ).json();
          Promise.resolve().then(() => {
            result.availableActions.push({
              key: "forged_action"
            });
          });
          return result;
        }

        export async function unknownClosureMutationExample() {
          const result = await (
            await apiFetch("/unknown-closure-mutation")
          ).json();
          scheduleExternal(() => {
            result.availableActions.push({
              key: "forged_action"
            });
          });
          return result;
        }

        export async function objectCallbackEscapeExample() {
          const result = await (
            await apiFetch("/object-callback-escape")
          ).json();
          scheduleExternal({
            run: () => {
              result.availableActions.push({
                key: "forged_action"
              });
            }
          });
          return result;
        }

        export async function arrayCallbackEscapeExample() {
          const result = await (
            await apiFetch("/array-callback-escape")
          ).json();
          scheduleExternal([
            [
              () => {
                result.availableActions.push({
                  key: "forged_action"
                });
              }
            ]
          ]);
          return result;
        }

        export async function classConstructorMutationExample() {
          const result = await (
            await apiFetch("/class-constructor-mutation")
          ).json();
          new class {
            constructor() {
              result.availableActions.push({
                key: "forged_action"
              });
            }
          }();
          return result;
        }

        export async function closureRebindingExample() {
          let result = await (
            await apiFetch("/closure-rebinding")
          ).json();
          const replace = () => {
            result = {
              availableActions: [{ key: "forged_action" }]
            };
          };
          replace();
          return result;
        }

        export async function classConstructorRebindingExample() {
          let result = await (
            await apiFetch("/class-constructor-rebinding")
          ).json();
          new class {
            constructor() {
              result = {
                availableActions: [{ key: "forged_action" }]
              };
            }
          }();
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
          objectClosureMutationExample,
          objectClosureArgumentMutationExample,
          aliasedClosureMutationExample,
          queuedClosureMutationExample,
          timerClosureMutationExample,
          promiseClosureMutationExample,
          unknownClosureMutationExample,
          objectCallbackEscapeExample,
          arrayCallbackEscapeExample,
          classConstructorMutationExample,
          closureRebindingExample,
          classConstructorRebindingExample,
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
        void objectClosureMutationExample();
        void objectClosureArgumentMutationExample();
        void aliasedClosureMutationExample();
        void queuedClosureMutationExample();
        void timerClosureMutationExample();
        void promiseClosureMutationExample();
        void unknownClosureMutationExample();
        void objectCallbackEscapeExample();
        void arrayCallbackEscapeExample();
        void classConstructorMutationExample();
        void closureRebindingExample();
        void classConstructorRebindingExample();
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
          "/object-closure-mutation",
          "/object-closure-argument-mutation",
          "/aliased-closure-mutation",
          "/queued-closure-mutation",
          "/timer-closure-mutation",
          "/promise-closure-mutation",
          "/unknown-closure-mutation",
          "/object-callback-escape",
          "/array-callback-escape",
          "/class-constructor-mutation",
          "/closure-rebinding",
          "/class-constructor-rebinding",
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
      assert.equal(
        provenance.objectClosureMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.objectClosureArgumentMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.aliasedClosureMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.queuedClosureMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.timerClosureMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.promiseClosureMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.unknownClosureMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.objectCallbackEscapeExample,
        "unverified"
      );
      assert.equal(
        provenance.arrayCallbackEscapeExample,
        "unverified"
      );
      assert.equal(
        provenance.classConstructorMutationExample,
        "unverified"
      );
      assert.equal(
        provenance.closureRebindingExample,
        "unverified"
      );
      assert.equal(
        provenance.classConstructorRebindingExample,
        "unverified"
      );
      assert.equal(provenance.loopReplacementExample, "unverified");
    }
  );
});

test("preserves transparent provenance for harmless callbacks and constructors", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        import { apiFetch } from "./api-fetch";
        declare function scheduleExternal(value: unknown): void;

        export async function noCaptureCallbackExample() {
          const result = await (
            await apiFetch("/no-capture-callback")
          ).json();
          queueMicrotask(() => {
            void "done";
          });
          return result;
        }

        export async function readonlyCallbackExample() {
          const result = await (
            await apiFetch("/readonly-callback")
          ).json();
          queueMicrotask(() => {
            void result.availableActions.length;
          });
          return result;
        }

        export async function readonlyNestedCallbackExample() {
          const result = await (
            await apiFetch("/readonly-nested-callback")
          ).json();
          scheduleExternal({
            run: () => {
              void result.availableActions.length;
            }
          });
          return result;
        }

        export async function harmlessConstructorExample() {
          const result = await (
            await apiFetch("/harmless-constructor")
          ).json();
          void new class {
            readonly kind = "local";
          }();
          return result;
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          noCaptureCallbackExample,
          readonlyCallbackExample,
          readonlyNestedCallbackExample,
          harmlessConstructorExample
        } from "../api/example.api";
        void noCaptureCallbackExample();
        void readonlyCallbackExample();
        void readonlyNestedCallbackExample();
        void harmlessConstructorExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "/no-capture-callback",
          "/readonly-callback",
          "/readonly-nested-callback",
          "/harmless-constructor"
        ].map((path) => ({
          method: "GET",
          path,
          normalizedKey: `GET ${path}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      for (const name of [
        "noCaptureCallbackExample",
        "readonlyCallbackExample",
        "readonlyNestedCallbackExample",
        "harmlessConstructorExample"
      ]) {
        const wrapper = manifest.wrappers.find(
          (candidate) => candidate.name === name
        );
        assert.equal(
          wrapper.returnProvenance,
          "transparent_main_response",
          name
        );
      }
      assert.equal(
        manifest.status,
        "ready",
        JSON.stringify(manifest.blockers)
      );
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

test("tracks global fetch aliases through containers, destructuring, and rebinding", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        export function globalAliasExample() {
          const send = globalThis.fetch;
          return send("/api/examples/global", {
            method: "POST",
            body: "{}"
          });
        }

        export function windowContainerExample() {
          const transports = {
            run: window.fetch
          };
          return transports.run("/api/examples/window", {
            method: "POST",
            body: "{}"
          });
        }

        export function selfDestructuredExample() {
          const { fetch: send } = self;
          return send("/api/examples/self", {
            method: "POST",
            body: "{}"
          });
        }

        export function reboundGlobalExample() {
          let send = (_path: string) => ({ local: true });
          send = globalThis.fetch;
          return send("/api/examples/rebound", {
            method: "POST",
            body: "{}"
          });
        }

        export function overwrittenLocalExample() {
          let send = globalThis.fetch;
          send = (_path: string) => ({ local: true });
          return send("/api/examples/local");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          globalAliasExample,
          windowContainerExample,
          selfDestructuredExample,
          reboundGlobalExample,
          overwrittenLocalExample
        } from "../api/example.api";
        void globalAliasExample();
        void windowContainerExample();
        void selfDestructuredExample();
        void reboundGlobalExample();
        void overwrittenLocalExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: ["global", "window", "self", "rebound"].map(
          (name) => ({
            method: "POST",
            path: `/examples/${name}`,
            normalizedKey: `POST /examples/${name}`
          })
        )
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const name of [
        "globalAliasExample",
        "windowContainerExample",
        "selfDestructuredExample",
        "reboundGlobalExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "transport", name);
        assert.equal(wrappers.get(name).requests.length, 1, name);
      }
      assert.equal(
        wrappers.get("globalAliasExample").requests[0].normalizedKey,
        "POST /examples/global"
      );
      assert.equal(
        wrappers.get("windowContainerExample").requests[0]
          .normalizedKey,
        "POST /examples/window"
      );
      assert.equal(
        wrappers.get("selfDestructuredExample").requests[0]
          .normalizedKey,
        "POST /examples/self"
      );
      assert.equal(
        wrappers.get("reboundGlobalExample").requests[0]
          .normalizedKey,
        "POST /examples/rebound"
      );
      assert.equal(
        wrappers.get("overwrittenLocalExample").kind,
        "pure"
      );
      assert.deepEqual(
        wrappers.get("overwrittenLocalExample").requests,
        []
      );
      assert.equal(
        manifest.status,
        "ready",
        JSON.stringify(manifest.blockers)
      );
    }
  );
});

test("lets imports shadow intrinsic fetch in transport and provenance analysis", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/helper.ts": `
        export const fetch = (_path: string) => ({
          local: true
        });
        export default fetch;
      `,
      "apps/web-admin/src/api/example.api.ts": `
        import defaultFetch from "./helper";
        import { fetch } from "./helper";
        import * as helper from "./helper";

        export function namedShadowExample() {
          return fetch("/api/examples/named-shadow");
        }

        export function defaultShadowExample() {
          return defaultFetch("/api/examples/default-shadow");
        }

        export function namespaceShadowExample() {
          return helper.fetch("/api/examples/namespace-shadow");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          namedShadowExample,
          defaultShadowExample,
          namespaceShadowExample
        } from "../api/example.api";
        void namedShadowExample();
        void defaultShadowExample();
        void namespaceShadowExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json":
        JSON.stringify({ schemaVersion: 1, routes: [] })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const name of [
        "namedShadowExample",
        "defaultShadowExample",
        "namespaceShadowExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "transport", name);
        assert.equal(
          wrappers.get(name).requests[0].unresolvedReason,
          "unknown_transport_delegate",
          name
        );
        assert.equal(
          wrappers.get(name).returnProvenance,
          "unverified",
          name
        );
      }
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("tracks computed global fetch keys and fails closed for unresolved keys", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        export function binaryKeyExample() {
          const send = globalThis["f" + "etch"];
          return send("/api/examples/binary-key");
        }

        export function constKeyExample() {
          const key = "fetch";
          const send = window[key];
          return send("/api/examples/const-key");
        }

        export function templateKeyExample() {
          const send = self[\`fetch\`];
          return send("/api/examples/template-key");
        }

        export function conditionalKeyExample(enabled: boolean) {
          const key = enabled ? "fetch" : "fetch";
          return globalThis[key](
            "/api/examples/conditional-key"
          );
        }

        export function unresolvedKeyExample(key: string) {
          const send = globalThis[key];
          return send("/api/examples/unresolved-key");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          binaryKeyExample,
          constKeyExample,
          templateKeyExample,
          conditionalKeyExample,
          unresolvedKeyExample
        } from "../api/example.api";
        void binaryKeyExample();
        void constKeyExample();
        void templateKeyExample();
        void conditionalKeyExample(true);
        void unresolvedKeyExample("customFetch");
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "binary-key",
          "const-key",
          "template-key",
          "conditional-key"
        ].map((name) => ({
          method: "GET",
          path: `/examples/${name}`,
          normalizedKey: `GET /examples/${name}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const name of [
        "binaryKeyExample",
        "constKeyExample",
        "templateKeyExample",
        "conditionalKeyExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "transport", name);
        assert.equal(wrappers.get(name).requests.length, 1, name);
      }
      assert.equal(
        wrappers.get("binaryKeyExample").requests[0].normalizedKey,
        "GET /examples/binary-key"
      );
      assert.equal(
        wrappers.get("constKeyExample").requests[0].normalizedKey,
        "GET /examples/const-key"
      );
      assert.equal(
        wrappers.get("templateKeyExample").requests[0].normalizedKey,
        "GET /examples/template-key"
      );
      assert.equal(
        wrappers.get("conditionalKeyExample").requests[0]
          .normalizedKey,
        "GET /examples/conditional-key"
      );
      assert.equal(
        wrappers.get("unresolvedKeyExample").kind,
        "transport"
      );
      assert.equal(
        wrappers.get("unresolvedKeyExample").requests[0]
          .unresolvedReason,
        "unknown_transport_delegate"
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("tracks comma-expression transports and scans prefix side effects", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        export function commaAliasExample() {
          const send = (0, globalThis.fetch);
          return send("/api/examples/comma-alias", {
            method: "POST"
          });
        }

        export function directCommaExample() {
          return (0, fetch)("/api/examples/direct-comma", {
            method: "POST"
          });
        }

        export function commaPrefixExample() {
          return (
            globalThis.fetch("/api/examples/comma-prefix"),
            fetch
          )("/api/examples/comma-final");
        }

        export function dynamicCommaExample(key: string) {
          return (0, globalThis[key])(
            "/api/examples/dynamic-comma"
          );
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          commaAliasExample,
          directCommaExample,
          commaPrefixExample,
          dynamicCommaExample
        } from "../api/example.api";
        void commaAliasExample();
        void directCommaExample();
        void commaPrefixExample();
        void dynamicCommaExample("customFetch");
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "comma-alias",
          "direct-comma",
          "comma-prefix",
          "comma-final"
        ].map((name) => ({
          method: ["comma-alias", "direct-comma"].includes(name)
            ? "POST"
            : "GET",
          path: `/examples/${name}`,
          normalizedKey: `${
            ["comma-alias", "direct-comma"].includes(name)
              ? "POST"
              : "GET"
          } /examples/${name}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      assert.equal(
        wrappers.get("commaAliasExample").requests[0].normalizedKey,
        "POST /examples/comma-alias"
      );
      assert.equal(
        wrappers.get("directCommaExample").requests[0]
          .normalizedKey,
        "POST /examples/direct-comma"
      );
      assert.deepEqual(
        wrappers
          .get("commaPrefixExample")
          .requests.map((request) => request.normalizedKey)
          .sort(),
        [
          "GET /examples/comma-final",
          "GET /examples/comma-prefix"
        ]
      );
      assert.equal(
        wrappers.get("dynamicCommaExample").requests[0]
          .unresolvedReason,
        "unknown_transport_delegate"
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("merges transport bindings across branches, exceptions, and loops", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        const local = (_path: string) => ({ local: true });

        export function ifMixedExample(enabled: boolean) {
          let send = local;
          if (enabled) {
            send = globalThis.fetch;
          }
          return send("/api/examples/if-mixed");
        }

        export function ifBothTransportExample(enabled: boolean) {
          let send = local;
          if (enabled) {
            send = globalThis.fetch;
          } else {
            send = window.fetch;
          }
          return send("/api/examples/if-both-transport", {
            method: "POST"
          });
        }

        export function blockSequentialExample(enabled: boolean) {
          let send = local;
          if (enabled) {
            send = globalThis.fetch;
            send("/api/examples/block-sequential");
          }
          return false;
        }

        export function tryCatchMixedExample(enabled: boolean) {
          let send = local;
          try {
            if (enabled) throw new Error("retry");
            send = globalThis.fetch;
          } catch {
            send = local;
          }
          return send("/api/examples/try-catch-mixed");
        }

        export function finallyMixedExample(enabled: boolean) {
          let send = local;
          try {
            void enabled;
          } finally {
            if (enabled) {
              send = globalThis.fetch;
            }
          }
          return send("/api/examples/finally-mixed");
        }

        export function loopMixedExample(enabled: boolean) {
          let send = local;
          while (enabled) {
            send = globalThis.fetch;
            enabled = false;
          }
          return send("/api/examples/loop-mixed");
        }

        export function deterministicSafeFinallyExample() {
          let send = globalThis.fetch;
          try {
            void "work";
          } finally {
            send = local;
          }
          return send("/local");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          ifMixedExample,
          ifBothTransportExample,
          blockSequentialExample,
          tryCatchMixedExample,
          finallyMixedExample,
          loopMixedExample,
          deterministicSafeFinallyExample
        } from "../api/example.api";
        void ifMixedExample(true);
        void ifBothTransportExample(true);
        void blockSequentialExample(true);
        void tryCatchMixedExample(true);
        void finallyMixedExample(true);
        void loopMixedExample(true);
        void deterministicSafeFinallyExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          {
            method: "POST",
            path: "/examples/if-both-transport",
            normalizedKey: "POST /examples/if-both-transport"
          },
          {
            method: "GET",
            path: "/examples/block-sequential",
            normalizedKey: "GET /examples/block-sequential"
          }
        ]
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const name of [
        "ifMixedExample",
        "tryCatchMixedExample",
        "finallyMixedExample",
        "loopMixedExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "transport", name);
        assert.equal(
          wrappers.get(name).requests[0].unresolvedReason,
          "unknown_transport_delegate",
          name
        );
      }
      assert.equal(
        wrappers.get("ifBothTransportExample").requests[0]
          .normalizedKey,
        "POST /examples/if-both-transport"
      );
      assert.equal(
        wrappers.get("blockSequentialExample").requests[0]
          .normalizedKey,
        "GET /examples/block-sequential"
      );
      assert.equal(
        wrappers.get("deterministicSafeFinallyExample").kind,
        "pure"
      );
      assert.deepEqual(
        wrappers.get("deterministicSafeFinallyExample").requests,
        []
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("tracks transport state through expression and container assignments", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        const local = (_path: string) => ({ local: true });

        export function immediateAssignmentExample() {
          let send = local;
          return (send = globalThis.fetch)(
            "/api/examples/immediate-assignment",
            { method: "POST" }
          );
        }

        export function commaAssignmentExample() {
          let send = local;
          (0, send = globalThis.fetch);
          return send("/api/examples/comma-assignment", {
            method: "POST"
          });
        }

        export function conditionalAssignmentExample(
          enabled: boolean
        ) {
          let send = local;
          enabled
            ? (send = globalThis.fetch)
            : (send = local);
          return send("/api/examples/conditional-assignment");
        }

        export function containerAssignmentExample() {
          const network = { send: local };
          network.send = globalThis.fetch;
          return network.send(
            "/api/examples/container-assignment",
            { method: "POST" }
          );
        }

        export function safeContainerOverrideExample() {
          const network = { send: local };
          network.send = globalThis.fetch;
          network.send = local;
          return network.send("/local");
        }

        export function dynamicContainerAssignmentExample(
          key: string
        ) {
          const network = { send: local };
          network[key] = globalThis.fetch;
          return network.send(
            "/api/examples/dynamic-container-assignment"
          );
        }

        export function objectAssignmentExample() {
          let send = local;
          ({ send } = { send: globalThis.fetch });
          return send("/api/examples/object-assignment", {
            method: "POST"
          });
        }

        export function arrayAssignmentExample() {
          let send = local;
          [send] = [globalThis.fetch];
          return send("/api/examples/array-assignment", {
            method: "POST"
          });
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          immediateAssignmentExample,
          commaAssignmentExample,
          conditionalAssignmentExample,
          containerAssignmentExample,
          safeContainerOverrideExample,
          dynamicContainerAssignmentExample,
          objectAssignmentExample,
          arrayAssignmentExample
        } from "../api/example.api";
        void immediateAssignmentExample();
        void commaAssignmentExample();
        void conditionalAssignmentExample(true);
        void containerAssignmentExample();
        void safeContainerOverrideExample();
        void dynamicContainerAssignmentExample("send");
        void objectAssignmentExample();
        void arrayAssignmentExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "immediate-assignment",
          "comma-assignment",
          "container-assignment",
          "object-assignment",
          "array-assignment"
        ].map((name) => ({
          method: "POST",
          path: `/examples/${name}`,
          normalizedKey: `POST /examples/${name}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const [name, path] of [
        ["immediateAssignmentExample", "immediate-assignment"],
        ["commaAssignmentExample", "comma-assignment"],
        ["containerAssignmentExample", "container-assignment"],
        ["objectAssignmentExample", "object-assignment"],
        ["arrayAssignmentExample", "array-assignment"]
      ]) {
        assert.equal(
          wrappers.get(name).requests[0].normalizedKey,
          `POST /examples/${path}`,
          name
        );
      }
      for (const name of [
        "conditionalAssignmentExample",
        "dynamicContainerAssignmentExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "transport", name);
        assert.equal(
          wrappers.get(name).requests[0].unresolvedReason,
          "unknown_transport_delegate",
          name
        );
      }
      assert.equal(
        wrappers.get("safeContainerOverrideExample").kind,
        "pure"
      );
      assert.deepEqual(
        wrappers.get("safeContainerOverrideExample").requests,
        []
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("binds nested default and rest destructuring for declarations assignments and parameters", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        const local = (_path: string) => ({ local: true });

        function invokeObject({
          nested: { send = local },
          ...rest
        }: {
          nested: { send?: typeof globalThis.fetch };
          extra?: unknown;
        }) {
          void rest;
          return send("/api/examples/object-parameter");
        }

        function invokeArray([
          send = local,
          ...rest
        ]: Array<typeof globalThis.fetch | typeof local>) {
          void rest;
          return send("/api/examples/array-parameter");
        }

        export function nestedDeclarationExample() {
          const {
            nested: { send }
          } = {
            nested: { send: globalThis.fetch }
          };
          return send("/api/examples/nested-declaration");
        }

        export function defaultDeclarationExample() {
          const {
            send = globalThis.fetch
          } = {};
          return send("/api/examples/default-declaration");
        }

        export function restDeclarationExample() {
          const {
            safe,
            ...network
          } = {
            safe: local,
            send: globalThis.fetch
          };
          void safe;
          return network.send("/api/examples/rest-declaration");
        }

        export function nestedAssignmentExample() {
          let send = local;
          ({
            nested: { send }
          } = {
            nested: { send: globalThis.fetch }
          });
          return send("/api/examples/nested-assignment");
        }

        export function defaultAssignmentExample() {
          let send = local;
          ({
            missing: send = globalThis.fetch
          } = {});
          return send("/api/examples/default-assignment");
        }

        export function restAssignmentExample() {
          let safe = local;
          let network = { send: local };
          ({
            safe,
            ...network
          } = {
            safe: local,
            send: globalThis.fetch
          });
          return network.send("/api/examples/rest-assignment");
        }

        export function objectParameterExample() {
          return invokeObject({
            nested: { send: globalThis.fetch }
          });
        }

        export function arrayParameterExample() {
          return invokeArray([globalThis.fetch]);
        }

        export function dynamicShapeExample(key: string) {
          const {
            [key]: send
          } = { send: globalThis.fetch };
          return send("/api/examples/dynamic-shape");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          nestedDeclarationExample,
          defaultDeclarationExample,
          restDeclarationExample,
          nestedAssignmentExample,
          defaultAssignmentExample,
          restAssignmentExample,
          objectParameterExample,
          arrayParameterExample,
          dynamicShapeExample
        } from "../api/example.api";
        void nestedDeclarationExample();
        void defaultDeclarationExample();
        void restDeclarationExample();
        void nestedAssignmentExample();
        void defaultAssignmentExample();
        void restAssignmentExample();
        void objectParameterExample();
        void arrayParameterExample();
        void dynamicShapeExample("send");
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "nested-declaration",
          "default-declaration",
          "rest-declaration",
          "nested-assignment",
          "default-assignment",
          "rest-assignment",
          "object-parameter",
          "array-parameter"
        ].map((name) => ({
          method: "GET",
          path: `/examples/${name}`,
          normalizedKey: `GET /examples/${name}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const [name, path] of [
        ["nestedDeclarationExample", "nested-declaration"],
        ["defaultDeclarationExample", "default-declaration"],
        ["restDeclarationExample", "rest-declaration"],
        ["nestedAssignmentExample", "nested-assignment"],
        ["defaultAssignmentExample", "default-assignment"],
        ["restAssignmentExample", "rest-assignment"],
        ["objectParameterExample", "object-parameter"],
        ["arrayParameterExample", "array-parameter"]
      ]) {
        assert.equal(
          wrappers.get(name).requests[0].normalizedKey,
          `GET /examples/${path}`,
          name
        );
      }
      assert.equal(
        wrappers.get("dynamicShapeExample").kind,
        "transport"
      );
      assert.equal(
        wrappers.get("dynamicShapeExample").requests[0]
          .unresolvedReason,
        "unknown_transport_delegate"
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("tracks fetch call and apply adapters and rejects dynamic argument shapes", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        export function callAdapterExample() {
          return globalThis.fetch.call(
            globalThis,
            "/api/examples/call-adapter",
            { method: "POST", body: "{}" }
          );
        }

        export function applyAdapterExample() {
          const send = window.fetch;
          return send.apply(window, [
            "/api/examples/apply-adapter",
            { method: "POST", body: "{}" }
          ]);
        }

        export function reflectApplyAdapterExample() {
          return Reflect.apply(fetch, globalThis, [
            "/api/examples/reflect-apply-adapter",
            { method: "POST", body: "{}" }
          ]);
        }

        export function dynamicApplyAdapterExample(
          args: unknown[]
        ) {
          return globalThis.fetch.apply(globalThis, args);
        }

        export function localCallAdapterExample() {
          const fetch = (_path: string) => ({ local: true });
          return fetch.call(null, "/local");
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          callAdapterExample,
          applyAdapterExample,
          reflectApplyAdapterExample,
          dynamicApplyAdapterExample,
          localCallAdapterExample
        } from "../api/example.api";
        void callAdapterExample();
        void applyAdapterExample();
        void reflectApplyAdapterExample();
        void dynamicApplyAdapterExample([]);
        void localCallAdapterExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json": JSON.stringify({
        schemaVersion: 1,
        routes: [
          "/examples/call-adapter",
          "/examples/apply-adapter",
          "/examples/reflect-apply-adapter"
        ].map((path) => ({
          method: "POST",
          path,
          normalizedKey: `POST ${path}`
        }))
      })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      assert.equal(
        wrappers.get("callAdapterExample").requests[0].normalizedKey,
        "POST /examples/call-adapter"
      );
      assert.equal(
        wrappers.get("applyAdapterExample").requests[0].normalizedKey,
        "POST /examples/apply-adapter"
      );
      assert.equal(
        wrappers.get("reflectApplyAdapterExample").requests[0]
          .normalizedKey,
        "POST /examples/reflect-apply-adapter"
      );
      assert.equal(
        wrappers.get("dynamicApplyAdapterExample").kind,
        "transport"
      );
      assert.equal(
        wrappers.get("dynamicApplyAdapterExample").requests[0]
          .unresolvedReason,
        "unknown_transport_adapter"
      );
      assert.equal(
        wrappers.get("localCallAdapterExample").kind,
        "pure"
      );
      assert.deepEqual(
        wrappers.get("localCallAdapterExample").requests,
        []
      );
      assert.equal(manifest.status, "blocked");
    }
  );
});

test("fails closed for aliased browser network primitives and sendBeacon", async () => {
  await withFixture(
    {
      "apps/web-admin/src/api/example.api.ts": `
        export function xhrAliasExample() {
          const Xhr = XMLHttpRequest;
          const request = new Xhr();
          request.open("POST", "/api/examples/xhr");
          request.send("{}");
          return request;
        }

        export function globalSocketAliasExample() {
          const Socket = globalThis.WebSocket;
          return new Socket("wss://example.test/socket");
        }

        export function eventSourceContainerExample() {
          const network = { Source: window.EventSource };
          return new network.Source("/api/examples/events");
        }

        export function xhrDestructuredExample() {
          const { XMLHttpRequest: Xhr } = self;
          return new Xhr();
        }

        export function reboundSocketExample() {
          let Socket = class LocalSocket {};
          Socket = window.WebSocket;
          return new Socket("wss://example.test/rebound");
        }

        export function directBeaconExample() {
          return navigator.sendBeacon(
            "/api/examples/beacon",
            "{}"
          );
        }

        export function globalBeaconAliasExample() {
          const send = globalThis.navigator.sendBeacon;
          return send("/api/examples/global-beacon", "{}");
        }

        export function beaconContainerExample() {
          const network = {
            send: window.navigator.sendBeacon
          };
          return network.send(
            "/api/examples/container-beacon",
            "{}"
          );
        }

        export function beaconDestructuredExample() {
          const { sendBeacon: send } = self.navigator;
          return send(
            "/api/examples/destructured-beacon",
            "{}"
          );
        }

        export function overwrittenLocalNetworkExample() {
          let Xhr = globalThis.XMLHttpRequest;
          Xhr = class LocalRequest {};
          return new Xhr();
        }

        export function shadowedNetworkExample() {
          const XMLHttpRequest = class LocalRequest {};
          const navigator = {
            sendBeacon: () => true
          };
          const request = new XMLHttpRequest();
          navigator.sendBeacon("/local", "{}");
          return request;
        }
      `,
      "apps/web-admin/src/pages/FixturePage.vue": `
        <script setup lang="ts">
        import {
          xhrAliasExample,
          globalSocketAliasExample,
          eventSourceContainerExample,
          xhrDestructuredExample,
          reboundSocketExample,
          directBeaconExample,
          globalBeaconAliasExample,
          beaconContainerExample,
          beaconDestructuredExample,
          overwrittenLocalNetworkExample,
          shadowedNetworkExample
        } from "../api/example.api";
        void xhrAliasExample();
        void globalSocketAliasExample();
        void eventSourceContainerExample();
        void xhrDestructuredExample();
        void reboundSocketExample();
        void directBeaconExample();
        void globalBeaconAliasExample();
        void beaconContainerExample();
        void beaconDestructuredExample();
        void overwrittenLocalNetworkExample();
        void shadowedNetworkExample();
        </script>
        <template><main>fixture</main></template>
      `,
      "docs/product/manifests/nest-business-routes.json":
        JSON.stringify({ schemaVersion: 1, routes: [] })
    },
    async (root) => {
      const manifest = await inspectWholeSiteWebApiManifest({ root });
      const wrappers = new Map(
        manifest.wrappers.map((wrapper) => [
          wrapper.name,
          wrapper
        ])
      );
      for (const name of [
        "xhrAliasExample",
        "globalSocketAliasExample",
        "eventSourceContainerExample",
        "xhrDestructuredExample",
        "reboundSocketExample",
        "directBeaconExample",
        "globalBeaconAliasExample",
        "beaconContainerExample",
        "beaconDestructuredExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "transport", name);
        assert.equal(wrappers.get(name).requests.length, 1, name);
        assert.equal(
          wrappers.get(name).requests[0].unresolvedReason,
          "unknown_network_primitive",
          name
        );
      }
      for (const name of [
        "overwrittenLocalNetworkExample",
        "shadowedNetworkExample"
      ]) {
        assert.equal(wrappers.get(name).kind, "pure", name);
        assert.deepEqual(wrappers.get(name).requests, [], name);
      }
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
