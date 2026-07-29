import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectCapabilityProject } from "./inspect-contract-workbench-capabilities.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "contract-capability-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, source, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("matches dynamic routes and reports a wrapper without backend", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Get(":contractId")
          read() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export function fetchWorkbench(id) {
          return readJson(\`/contract-workbench/\${encodeURIComponent(id)}\`);
        }
        export function submitMissing(id) {
          return postJson(\`/contract-missing/\${id}/submission\`, {});
        }
      `,
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup lang="ts">
        import { fetchWorkbench, submitMissing } from "../../api/contract-workbench.api";
        const load = () => fetchWorkbench("c-1");
        const submit = () => submitMissing("c-1");
        </script>
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root, legacyRoutes: [] });
      assert.equal(
        report.capabilities.find((item) => item.wrapper === "fetchWorkbench")?.classification,
        "matched"
      );
      assert.equal(
        report.capabilities.find((item) => item.wrapper === "submitMissing")?.classification,
        "frontend_without_backend"
      );
    }
  );
});

test("finds a page import that points to no API wrapper", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contracts")
        export class ExampleController {
          @Post(":contractId/void")
          voidDraft() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export function voidDraft(id) {
          return postJson(\`/contracts/\${id}/void\`, {});
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/pages/contracts/Page.vue": `
        <script setup>
        import { voidDraft, purgeDraft } from "../../api/contract-workbench.api";
        const actions = [voidDraft, purgeDraft];
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root });
      assert.deepEqual(report.missingWrappers, [
        {
          consumer: "apps/web-admin/src/pages/contracts/Page.vue",
          wrapper: "purgeDraft"
        }
      ]);
    }
  );
});

test("keeps composable, callback and dynamic import consumers", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-drafts")
        export class ExampleController {
          @Put(":contractVersionId")
          save() {}
          @Post(":contractVersionId/submission")
          submit() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": `
        export const saveAggregate = (id, body) =>
          putJson(\`/contract-drafts/\${id}\`, body);
        export function submitAggregate(id) {
          return postJson(\`/contract-drafts/\${id}/submission\`, {});
        }
      `,
      "apps/web-admin/src/api/core-flow-read.api.ts": "",
      "apps/web-admin/src/composables/useDraft.ts": `
        import { saveAggregate } from "../api/contract-workbench.api";
        export const useDraft = () => ({ onSave: saveAggregate });
      `,
      "apps/web-admin/src/pages/contracts/Dynamic.vue": `
        <script setup>
        const loadAction = async () => {
          const api = await import("../../api/contract-workbench.api");
          registerCallback(api.submitAggregate);
        };
        </script>
      `
    },
    async (root) => {
      const report = await inspectCapabilityProject({ root });
      for (const wrapper of ["saveAggregate", "submitAggregate"]) {
        const capability = report.capabilities.find((item) => item.wrapper === wrapper);
        assert.equal(capability?.classification, "matched");
        assert.equal(capability?.consumers.length, 1);
      }
    }
  );
});

test("classifies controller routes with no consumer and registered internal routes", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Post("orphan")
          orphan() {}
          @Post("maintenance")
          maintenance() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const report = await inspectCapabilityProject({
        root,
        internalRoutes: ["POST /contract-workbench/maintenance"]
      });
      assert.equal(
        report.capabilities.find((item) => item.route === "/contract-workbench/orphan")
          ?.classification,
        "backend_without_frontend"
      );
      assert.equal(
        report.capabilities.find((item) => item.route === "/contract-workbench/maintenance")
          ?.classification,
        "backend_internal_only"
      );
    }
  );
});

test("requires runtime manifest and legacy hit evidence before a delete decision", async () => {
  await withFixture(
    {
      "services/api/src/example.controller.ts": `
        @Controller("contract-workbench")
        export class ExampleController {
          @Patch(":contractVersionId")
          legacySave() {}
        }
      `,
      "apps/web-admin/src/api/contract-workbench.api.ts": "",
      "apps/web-admin/src/api/core-flow-read.api.ts": ""
    },
    async (root) => {
      const withoutEvidence = await inspectCapabilityProject({
        root,
        legacyRoutes: ["PATCH /contract-workbench/:param"]
      });
      const blocked = withoutEvidence.capabilities.find(
        (item) => item.route === "/contract-workbench/:param"
      );
      assert.equal(blocked?.classification, "legacy_candidate");
      assert.equal(blocked?.decision, "保留");
      assert.deepEqual(blocked?.missingEvidence, [
        "runtime_route_manifest",
        "production_legacy_route_hits"
      ]);

      const withEvidence = await inspectCapabilityProject({
        root,
        legacyRoutes: ["PATCH /contract-workbench/:param"],
        runtimeRoutes: ["PATCH /contract-workbench/:contractVersionId"],
        legacyHits: {
          observationWindow: "2026-07-01T00:00:00Z/2026-07-29T00:00:00Z",
          counts: { "PATCH /contract-workbench/:param": 0 }
        }
      });
      const candidate = withEvidence.capabilities.find(
        (item) => item.route === "/contract-workbench/:param"
      );
      assert.equal(candidate?.decision, "删除");
      assert.deepEqual(candidate?.missingEvidence, []);
    }
  );
});
