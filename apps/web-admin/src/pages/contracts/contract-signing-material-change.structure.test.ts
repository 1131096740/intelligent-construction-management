import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(
  new URL("./ContractDetailPage.vue", import.meta.url),
  "utf8"
);

describe("contract signing material-change action", () => {
  it("renders only the backend capability inside the signing action group", () => {
    expect(detail).toContain('v-if="signingMaterialChangeActionEnabled()"');
    expect(detail).toContain("申报签署内容实质变化（退回重审）");
    expect(detail).toContain('@click="requestSigningMaterialChange"');
    expect(detail).toContain('theme="danger"');
    expect(detail).toContain('variant="outline"');
  });

  it("requires a reason and executes the fresh-read owner-safe API action", () => {
    expect(detail).toContain('v-if="signingMaterialChangeActionEnabled()"');
    expect(detail).toContain('@confirm="confirmSigningMaterialChange"');
    expect(detail).toContain("require-reason");
    expect(detail).toContain("contractSigningCapability.value");
    expect(detail).toContain("executeContractSigningMaterialChange({");
    expect(detail).toContain("signingMaterialChangeSubmissionToken");
    expect(detail).toContain("routeContractId() === context.routeContractId");
    expect(detail).toContain("ContractSigningMaterialChangeResultUnknownError");
    expect(detail).toContain("不要直接重复提交");
    const confirmStart = detail.indexOf("function confirmSigningMaterialChange");
    const nextFunction = detail.indexOf("\nasync function ", confirmStart + 1);
    expect(confirmStart).toBeGreaterThan(-1);
    expect(detail.slice(confirmStart, nextFunction)).toContain(
      "return executeContractSigningMaterialChange({"
    );
  });

  it("invalidates the component owner when the detail page unmounts", () => {
    expect(detail).toContain("onBeforeUnmount(() => {");
    expect(detail).toContain("detailRequestId += 1;");
    expect(detail).toContain("clearContractActionTransientState();");
  });

  it("does not call fetch directly", () => {
    expect(detail).not.toMatch(/\bfetch\s*\(/u);
  });
});
