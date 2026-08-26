import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./BusinessPartyCreatePage.vue", import.meta.url), "utf8");
const editor = readFileSync(new URL("./BusinessPartyEditorPage.vue", import.meta.url), "utf8");
const list = readFileSync(new URL("./BusinessPartyListPage.vue", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");
const contractWorkbenchApi = readFileSync(new URL("../../api/contract-workbench.api.ts", import.meta.url), "utf8");
const pageActionRegistry = JSON.parse(
  readFileSync(
    new URL("../../../../../docs/product/manifests/web-page-actions.registry.json", import.meta.url),
    "utf8"
  )
) as {
  actions: Array<{
    id: string;
    trigger: { element: string; event: string; handler: string };
    capability: {
      kind: string;
      source: string;
      key?: string;
      freshRead?: { mode: string; submissionTarget: string };
    };
    wrappers: Array<{ name: string }>;
  }>;
};

describe("business-party creation entry", () => {
  it("exposes one server-capability-gated formal route and the system configuration menu item", () => {
    expect(routes).toContain('path: "business-parties/new"');
    expect(routes).toContain("businessPartyCreateRoleKeys");
    expect(routes).toContain('requiredServerAction: "business_party.create"');
    expect(routes).toContain('label: "合作单位档案"');
    expect(routes).toContain('path: "/business-parties"');
    expect(routes).not.toContain('path: "合作单位档案/新建"');
    expect(routes.indexOf('label: "我方公司主体"'))
      .toBeLessThan(routes.indexOf('label: "合作单位档案"'));
  });

  it("uses the fixed server-owned two-field form and the complete fail-closed chain", () => {
    for (const marker of [
      "issueBusinessPartyDefinitionProbe",
      "fetchBusinessEntryDefinition",
      "issueBusinessPartySubmissionTarget",
      "getBusinessPartyCreationResult",
      "validateBusinessPartyDraft",
      "freezeBusinessEntrySnapshot",
      "submitBusinessPartyCreation",
      "function assertRunCreateFreshDefinition(",
      "function prepareCreate(",
      "function confirmCreate(",
      "useUnsavedChangesGuard",
      "createSingleFlight",
      "readBusinessPartyRecoveryEnvelope",
      "router.replace"
    ]) {
      expect(page).toContain(marker);
    }
    expect(page).toContain("统一社会信用代码");
    expect(page).toContain("确认创建");
    expect(page).toContain("创建后 v1 不可修改或删除");
    expect(page).toContain("sessionStorage");
    expect(page).not.toContain("localStorage");
    expect(page).toContain('@submit="prepareCreate"');
    expect(page).toContain('@confirm="confirmCreate"');
    expect(page).toContain('@cancel="cancelCreate"');
    expect(page).toMatch(/function prepareCreate\(\)[\s\S]*?normalizeBusinessPartyCreateValues\([\s\S]*?issueBusinessPartyDefinitionProbe\([\s\S]*?currentDefinition = await fetchBusinessEntryDefinition\([\s\S]*?finalProbe = await issueBusinessPartyDefinitionProbe\([\s\S]*?acceptedDefinition = await fetchBusinessEntryDefinition\([\s\S]*?issueBusinessPartySubmissionTarget\([\s\S]*?validateBusinessPartyDraft\([\s\S]*?const normalizedSnapshot = Object\.freeze\(\{ \.\.\.normalizedValues \}\);[\s\S]*?preparedCreate\.value = Object\.freeze\(\{[\s\S]*?confirmVisible\.value = true;/u);
    expect(page).toMatch(/function confirmCreate\(\)[\s\S]*?const prepared = preparedCreate\.value;[\s\S]*?definition = await fetchBusinessEntryDefinition\([\s\S]*?assertRunCreateFreshDefinition\([\s\S]*?freezeBusinessEntrySnapshot\([\s\S]*?submitBusinessPartyCreation\(/u);
    expect(page).toContain("const normalizedSnapshot = Object.freeze({ ...normalizedValues });");
    expect(page).toContain("values: normalizedSnapshot");
    expect(page).toContain("normalizedPreview.value = normalizedSnapshot");
    const prepareCreate = page.slice(
      page.indexOf("function prepareCreate("),
      page.indexOf("function confirmCreate(")
    );
    const confirmCreate = page.slice(
      page.indexOf("function confirmCreate("),
      page.indexOf("\nonMounted(")
    );
    expect(prepareCreate).not.toContain('return "";');
    expect(prepareCreate).toContain("normalizeBusinessPartyCreateValues(");
    const recoveryCheck = page.slice(
      page.indexOf("function runRecoveryCheck("),
      page.indexOf("function recoverCreate(")
    );
    expect(recoveryCheck).toContain("getBusinessPartyCreationResult(");
    expect(recoveryCheck.indexOf("getBusinessPartyCreationResult("))
      .toBeLessThan(recoveryCheck.indexOf("await prepareCreate()"));
    expect(prepareCreate).toContain("resolveBusinessPartyRecoveryKey(");
    expect(prepareCreate).toContain("assertBusinessPartyCreateValidation(errors)");
    expect(prepareCreate).toContain("assertBusinessPartyFreshDefinition(");
    expect(prepareCreate).toContain("assertBusinessPartyEntryValidation(candidate)");
    expect(prepareCreate).toContain("assertBusinessPartyFingerprintMatches(candidate, fingerprint)");
    expect(prepareCreate.match(/issueBusinessPartyDefinitionProbe\(/gu)).toHaveLength(2);
    expect(prepareCreate.match(/issueBusinessPartySubmissionTarget\(/gu)).toHaveLength(1);
    expect(prepareCreate.match(/validateBusinessPartyDraft\(/gu)).toHaveLength(1);
    expect(prepareCreate).toContain('handleCreateFailure("probe", error)');
    expect(prepareCreate).toContain('handleCreateFailure("submission", error)');
    expect(prepareCreate).toContain('handleCreateFailure("validation", error)');
    expect(prepareCreate).toContain("preparedCreate.value = Object.freeze({");
    expect(prepareCreate).toContain("probeTarget: Object.freeze({");
    expect(prepareCreate).toContain("target: Object.freeze({ ...target })");
    expect(confirmCreate).not.toContain("normalizeBusinessPartyCreateValues(form)");
    expect(confirmCreate).not.toContain("formSnapshot()");
    expect(confirmCreate).not.toContain("issueBusinessPartyDefinitionProbe(");
    expect(confirmCreate).not.toContain("issueBusinessPartySubmissionTarget(");
    expect(confirmCreate).not.toContain("validateBusinessPartyDraft(");
    expect(confirmCreate).toContain("assertRunCreateFreshDefinition(");
    expect(confirmCreate).toContain(
      "const preparedDefinitionRevision = prepared.definitionRevision;"
    );
    expect(confirmCreate).toContain("target: { ...prepared.target }");
    expect(confirmCreate).not.toContain("definitionProbeTarget.value");
    expect(confirmCreate.indexOf("const values = { ...prepared.values };"))
      .toBeLessThan(confirmCreate.indexOf("fetchBusinessEntryDefinition("));
    expect(page).not.toMatch(/主体类型|organization.*t-(?:input|select)/u);
    expect(confirmCreate).not.toContain("formSnapshot()");
    expect(confirmCreate).not.toContain("issueFreshBusinessPartyDefinitionProbe(");
    expect(confirmCreate.indexOf("saveBusinessPartyRecoveryEnvelope(")).toBeLessThan(
      confirmCreate.indexOf("assertBusinessPartyFingerprintMatches(")
    );
    expect(confirmCreate.indexOf("saveBusinessPartyRecoveryEnvelope(")).toBeLessThan(
      confirmCreate.indexOf("freezeBusinessEntrySnapshot(")
    );
    expect(confirmCreate.indexOf("saveBusinessPartyRecoveryEnvelope(")).toBeLessThan(
      confirmCreate.indexOf("submitBusinessPartyCreation(")
    );
    expect(page).toContain("let prepareInFlight: Promise<void> | null = null;");
    expect(page).toContain("let confirmInFlight: Promise<void> | null = null;");
    expect(prepareCreate).toContain("if (prepareInFlight) return prepareInFlight;");
    expect(confirmCreate).toContain("if (confirmInFlight) return confirmInFlight;");
    expect(confirmCreate).toContain("confirmInFlight = nextConfirmInFlight;");
    expect(confirmCreate.indexOf("confirmInFlight = nextConfirmInFlight;")).toBeLessThan(
      confirmCreate.indexOf("fetchBusinessEntryDefinition(")
    );
    expect(confirmCreate).toContain("return confirmInFlight;");
    expect(confirmCreate).toContain('handleCreateFailure("definition", error)');
    expect(page).toContain("handleConfirmDefinitionFailure");
    expect(page).toContain("resolveBusinessPartyIntentKey({");
    expect(page).not.toContain("let createInFlight = false;");
    expect(page).toContain("businessPartyIdFromConflictError(error)");
    expect(page).toContain("查看既有合作单位档案");
    expect(page).toContain('@click="recoverCreate"');
    expect(page).not.toContain("Object.assign(form, recovered.values)");
    expect(page).toContain("const canCreate = await loadCreateCapability();");
    expect(page).toContain('query: { notice: "create-forbidden" }');
    expect(page.indexOf("await loadCreateCapability()"))
      .toBeLessThan(page.indexOf("initialProbeSingleFlight(loadDefinitionProbe)"));
  });

  it("registers preparation and confirmation as one unique create chain", () => {
    const actions = pageActionRegistry.actions.filter((action) =>
      action.id.startsWith("business-party.create")
    );
    expect(actions).toHaveLength(2);
    const prepare = actions.find((action) => action.id === "business-party.create.prepare");
    const confirm = actions.find((action) => action.id === "business-party.create");
    expect(prepare?.trigger).toEqual({
      element: "t-form",
      event: "submit",
      handler: "prepareCreate"
    });
    expect(confirm?.trigger).toEqual({
      element: "t-dialog",
      event: "confirm",
      handler: "confirmCreate"
    });
    expect(prepare?.wrappers.map((wrapper) => wrapper.name)).toEqual([
      "issueBusinessPartyDefinitionProbe",
      "issueBusinessPartySubmissionTarget",
      "validateBusinessPartyDraft"
    ]);
    expect(confirm?.wrappers.map((wrapper) => wrapper.name)).toEqual([
      "freezeBusinessEntrySnapshot",
      "submitBusinessPartyCreation"
    ]);
    const wrapperNames = actions.flatMap((action) =>
      action.wrappers.map((wrapper) => wrapper.name)
    );
    expect(new Set(wrapperNames).size).toBe(wrapperNames.length);
    expect(prepare?.capability).toEqual({
      kind: "available_action_string",
      source: "createActions",
      key: "business_party.create"
    });
    expect(confirm?.capability).toMatchObject({
      kind: "server_definition",
      source: "definition.key",
      freshRead: { mode: "read_only_probe", submissionTarget: "independent" }
    });
  });

  it("uses a server capability for the button and a controlled creator projection", () => {
    expect(list).toContain('v-if="canCreate"');
    expect(list).toContain("getBusinessPartyCreateCapability");
    expect(list).not.toContain("businessPartyCreateRoleKeys");
    expect(list).toContain('route.query.notice === "create-forbidden"');
    expect(editor).toContain("createdByName");
    expect(editor).not.toContain("createdByUserId");
    expect(editor).not.toContain("creatorLabel");
    expect(contractWorkbenchApi).not.toMatch(/(?:export const|export function)\s+createBusinessParty\s*[=(]/u);
  });
});
