import { createRequire } from "node:module";

const requireFromApiWorkspace = createRequire(
  new URL("../../services/api/package.json", import.meta.url)
);
const ts = requireFromApiWorkspace("typescript");

const EXPECTED_MAINLINE_COUNT = 15;
const REQUIRED_ASPECTS = Object.freeze([
  "amount_integrity",
  "subject_isolation",
  "source_traceability",
  "authorization",
  "external_reconciliation"
]);
const REQUIRED_RELEASE_CHECKS = Object.freeze([
  "workspace-test",
  "business-errors-and-operations-safety",
  "release-manifests",
  "exact-sha-postgresql-16",
  "playwright-p0",
  "playwright-rc06-mock"
]);
const BROWSER_MAINLINE_IDS = new Set([
  "POL21-MAINLINE-04",
  "POL21-MAINLINE-06",
  "POL21-MAINLINE-08",
  "POL21-MAINLINE-10",
  "POL21-MAINLINE-13",
  "POL21-MAINLINE-14",
  "POL21-MAINLINE-15"
]);

function normalizedStatement(value) {
  return typeof value === "string"
    ? value.trim().replace(/[；。]$/u, "")
    : "";
}

function isTestRegistrar(node, aliases = new Set()) {
  if (ts.isParenthesizedExpression(node)) {
    return isTestRegistrar(node.expression, aliases);
  }
  if (ts.isIdentifier(node)) {
    return node.text === "it" || node.text === "test" || aliases.has(node.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return (
      ["skip", "only", "todo", "concurrent", "each"].includes(
        node.name.text
      ) && isTestRegistrar(node.expression, aliases)
    );
  }
  if (ts.isCallExpression(node)) {
    return isTestRegistrar(node.expression, aliases);
  }
  if (ts.isConditionalExpression(node)) {
    return (
      isTestRegistrar(node.whenTrue, aliases) &&
      isTestRegistrar(node.whenFalse, aliases)
    );
  }
  return false;
}

export function extractRegisteredTestNames(source) {
  if (typeof source !== "string") return new Set();
  const sourceFile = ts.createSourceFile(
    "pol21-evidence.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const names = new Set();
  const declarations = [];
  function collectDeclarations(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, collectDeclarations);
  }
  collectDeclarations(sourceFile);
  const aliases = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (
        !aliases.has(declaration.name.text) &&
        isTestRegistrar(declaration.initializer, aliases)
      ) {
        aliases.add(declaration.name.text);
        changed = true;
      }
    }
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      isTestRegistrar(node.expression, aliases)
    ) {
      const name = node.arguments[0];
      if (
        name &&
        (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
      ) {
        names.add(name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

export function extractSection28Mainlines(specificationSource) {
  if (typeof specificationSource !== "string") return [];
  const section = specificationSource.match(
    /## 28\. 业务验收主线([\s\S]*?)(?=\n## 29\.)/u
  )?.[1];
  if (!section) return [];
  return [...section.matchAll(/^\s*(\d{1,2})\.\s+(.+?)\s*$/gmu)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => normalizedStatement(match[2]));
}

export function inspectPol21CrossDomainAcceptance({
  manifest,
  dynamicGateManifest,
  releaseChecks,
  specificationSource,
  evidenceSources = {}
}) {
  const blockers = [];
  const mainlines = Array.isArray(manifest?.mainlines)
    ? manifest.mainlines
    : [];
  const specificationMainlines = extractSection28Mainlines(specificationSource);
  const knownGroups = new Map(
    (dynamicGateManifest?.coveredGroups ?? []).map((group) => [group.id, group])
  );
  const knownReleaseChecks = new Set(releaseChecks ?? []);
  const registeredTestNames = new Map();

  if (manifest?.schemaVersion !== 1 || manifest?.specSection !== 28) {
    blockers.push("POL21_MANIFEST_IDENTITY_INVALID");
  }
  if (
    mainlines.length !== EXPECTED_MAINLINE_COUNT ||
    specificationMainlines.length !== EXPECTED_MAINLINE_COUNT
  ) {
    blockers.push("POL21_MAINLINE_COUNT_INVALID");
  }
  if (
    dynamicGateManifest?.inventory?.remainingFiles !== 0 ||
    dynamicGateManifest?.inventory?.remainingTests !== 0
  ) {
    blockers.push("POL21_DYNAMIC_INVENTORY_INCOMPLETE");
  }
  const declaredRequiredChecks = new Set(
    manifest?.requiredReleaseChecks ?? []
  );
  for (const check of REQUIRED_RELEASE_CHECKS) {
    if (!declaredRequiredChecks.has(check) || !knownReleaseChecks.has(check)) {
      blockers.push(`POL21_REQUIRED_RELEASE_CHECK_MISSING:${check}`);
    }
  }

  for (let index = 0; index < EXPECTED_MAINLINE_COUNT; index += 1) {
    const mainline = mainlines[index];
    if (!mainline) continue;
    const expectedId = `POL21-MAINLINE-${String(index + 1).padStart(2, "0")}`;
    if (mainline.id !== expectedId) {
      blockers.push(`POL21_MAINLINE_ID_INVALID:${expectedId}`);
    }
    if (
      normalizedStatement(mainline.statement) !== specificationMainlines[index]
    ) {
      blockers.push(`POL21_MAINLINE_STATEMENT_DRIFT:${expectedId}`);
    }
    const aspectEvidence = manifest?.aspectEvidenceByMainline?.[expectedId];
    const evidenceCatalog = manifest?.evidenceCatalog ?? {};
    if (
      aspectEvidence === null ||
      typeof aspectEvidence !== "object" ||
      Array.isArray(aspectEvidence) ||
      Object.keys(aspectEvidence).length !== REQUIRED_ASPECTS.length ||
      REQUIRED_ASPECTS.some(
        (aspect) =>
          !Array.isArray(aspectEvidence[aspect]) ||
          aspectEvidence[aspect].length === 0
      )
    ) {
      blockers.push(`POL21_MAINLINE_ASPECTS_INCOMPLETE:${expectedId}`);
    } else {
      for (const aspect of REQUIRED_ASPECTS) {
        for (const evidenceId of aspectEvidence[aspect]) {
          const evidence = evidenceCatalog[evidenceId];
          const group = knownGroups.get(evidence?.groupId);
          const testFiles = new Set(
            (group?.testFiles ?? []).map((testFile) => testFile.path)
          );
          if (
            !Array.isArray(mainline.dynamicGroups) ||
            !mainline.dynamicGroups.includes(evidence?.groupId) ||
            !testFiles.has(evidence?.testFile)
          ) {
            blockers.push(
              `POL21_ASPECT_TEST_NOT_IN_GROUP:${expectedId}:${aspect}:${evidence?.testFile ?? evidenceId}`
            );
            continue;
          }
          const evidenceSource = evidenceSources[evidence.testFile];
          if (
            typeof evidenceSource === "string" &&
            !registeredTestNames.has(evidence.testFile)
          ) {
            registeredTestNames.set(
              evidence.testFile,
              extractRegisteredTestNames(evidenceSource)
            );
          }
          if (
            typeof evidence.testName !== "string" ||
            evidence.testName.length === 0 ||
            typeof evidenceSource !== "string" ||
            !registeredTestNames.get(evidence.testFile)?.has(evidence.testName)
          ) {
            blockers.push(
              `POL21_ASPECT_TEST_NAME_MISSING:${expectedId}:${aspect}:${evidence?.testName ?? "missing"}`
            );
          }
        }
      }
    }
    if (!Array.isArray(mainline.dynamicGroups) || mainline.dynamicGroups.length === 0) {
      blockers.push(`POL21_MAINLINE_DYNAMIC_EVIDENCE_MISSING:${expectedId}`);
      continue;
    }
    for (const groupId of mainline.dynamicGroups) {
      const group = knownGroups.get(groupId);
      if (
        group?.state !== "executable_local_runner" ||
        !Number.isInteger(group.pendingTests) ||
        group.pendingTests < 1 ||
        !Array.isArray(group.testFiles) ||
        group.testFiles.length < 1
      ) {
        blockers.push(`POL21_DYNAMIC_GROUP_INVALID:${expectedId}:${groupId}`);
      }
    }
    const mainlineReleaseChecks = mainline.releaseChecks ?? [];
    if (!mainlineReleaseChecks.includes("exact-sha-postgresql-16")) {
      blockers.push(`POL21_MAINLINE_EXACT_SHA_EVIDENCE_MISSING:${expectedId}`);
    }
    if (
      BROWSER_MAINLINE_IDS.has(expectedId) &&
      !mainlineReleaseChecks.some((check) =>
        ["playwright-p0", "playwright-rc06-mock"].includes(check)
      )
    ) {
      blockers.push(`POL21_MAINLINE_BROWSER_EVIDENCE_MISSING:${expectedId}`);
    }
    for (const check of mainlineReleaseChecks) {
      if (!knownReleaseChecks.has(check)) {
        blockers.push(`POL21_RELEASE_CHECK_UNKNOWN:${expectedId}:${check}`);
      }
    }
  }

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    mainlineCount: mainlines.length,
    blockers
  };
}
