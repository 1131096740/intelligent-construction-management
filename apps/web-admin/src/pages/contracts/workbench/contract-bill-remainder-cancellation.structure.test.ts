import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8"
  );
}

describe("contract bill remainder cancellation page action", () => {
  it("provides an aggregate flush to the canonical fresh-preflight executor and reloads unknown results", () => {
    const page = read("../ContractWorkbenchPage.vue");
    const handlerStart = page.indexOf(
      "function executeFocusedBillRemainderCancellation"
    );
    const handlerEnd = page.indexOf(
      "\nfunction contractBillRemainderErrorCode",
      handlerStart
    );
    const handler = page.slice(handlerStart, handlerEnd);

    expect(page).toContain(
      ':action-handler="executeFocusedBillRemainderCancellation"'
    );
    expect(page).toContain(
      ":action-disabled=\"!contractDraftActionEnabled('contract-bill.remainder-cancellation')\""
    );
    const executorIndex = handler.indexOf(
      "return executeContractBillRemainderCancellation"
    );
    const flushIndex = handler.indexOf("flush: async () =>", executorIndex);
    const saveIndex = handler.indexOf("await saveNow()", flushIndex);
    expect(handler).toContain("await saveNow()");
    expect(handler).toContain("executeContractBillRemainderCancellation");
    expect(executorIndex).toBeGreaterThanOrEqual(0);
    expect(flushIndex).toBeGreaterThan(executorIndex);
    expect(saveIndex).toBeGreaterThan(flushIndex);
    expect(handler).toContain("result.resultUnknown");
    expect(handler).toContain(
      "contractBillRemainderRouteCurrent(operationContext)"
    );
    expect(handler).toContain("await loadExpectedWorkbench");
    expect(handler).toContain('status: "submitted_refresh_failed"');
    expect(handler).toContain("操作已提交");
    expect(handler).toContain("不要重复提交");
  });

  it("registers the server-gated parent callback and canonical executor", () => {
    const registry = JSON.parse(
      read("../../../../../../docs/product/manifests/web-page-actions.registry.json")
    ) as {
      actions: Array<Record<string, unknown>>;
    };

    expect(registry.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "contract-bill.remainder-cancellation",
        sourceFile:
          "apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue",
        trigger: {
          element: "contract-bill-focus-editor",
          event: "action-handler",
          handler: "executeFocusedBillRemainderCancellation"
        },
        capability: {
          kind: "detail_action",
          source: "contractDraftAvailableActions",
          key: "contract-bill.remainder-cancellation"
        },
        wrappers: [{
          apiFile: "apps/web-admin/src/api/contract-workbench.api.ts",
          name: "executeContractBillRemainderCancellation"
        }]
      })
    ]));
  });
});
