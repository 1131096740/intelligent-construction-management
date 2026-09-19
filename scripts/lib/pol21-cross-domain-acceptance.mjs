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
  specificationSource
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
    if (
      !Array.isArray(mainline.requiredAspects) ||
      mainline.requiredAspects.length !== REQUIRED_ASPECTS.length ||
      REQUIRED_ASPECTS.some(
        (aspect) => !mainline.requiredAspects.includes(aspect)
      )
    ) {
      blockers.push(`POL21_MAINLINE_ASPECTS_INCOMPLETE:${expectedId}`);
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
