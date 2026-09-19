const REQUIRED_RELEASE_CHECKS = Object.freeze([
  "release-manifests",
  "exact-sha-postgresql-16",
  "pol22-readonly-preflight",
  "playwright-p0",
  "playwright-rc06-mock"
]);

const REQUIRED_PROHIBITED_ACTIONS = Object.freeze([
  "test_business_zeroing_apply",
  "production_deployment",
  "production_migration",
  "formal_opening"
]);

const REQUIRED_PROHIBITED_TARGETS = Object.freeze([
  "production_database",
  "natural_production_database",
  "backup_restore_database",
  "remote_docker_endpoint"
]);

const REQUIRED_RUNBOOK_TEXT = Object.freeze([
  "## 向前迁移与空库验证",
  "## 现有快照恢复与迁移验证",
  "## 回退兼容与受影响功能暂停",
  "## 分离的生产动作",
  "不执行数据归零、生产部署、生产迁移或正式开放。"
]);

function hasExactMembers(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((entry) => value.includes(entry))
  );
}

export function inspectPol23ReleaseCandidate({
  manifest,
  releaseChecks,
  userFillInventory,
  pol21Report,
  dynamicGateManifest,
  localReleaseSource,
  runbookSource
}) {
  const blockers = [];
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.issue !== 121 ||
    !hasExactMembers(manifest?.prerequisites, [119, 120])
  ) {
    blockers.push("POL23_MANIFEST_IDENTITY_INVALID");
  }

  const declaredChecks = new Set(manifest?.requiredReleaseChecks ?? []);
  const actualChecks = new Set(releaseChecks ?? []);
  for (const check of REQUIRED_RELEASE_CHECKS) {
    if (!declaredChecks.has(check) || !actualChecks.has(check)) {
      blockers.push(`POL23_RELEASE_CHECK_MISSING:${check}`);
    }
  }

  const fillSummary = userFillInventory?.summary;
  if (
    userFillInventory?.status !== "ready" ||
    !Number.isInteger(fillSummary?.retiredWriteEntryCount) ||
    fillSummary.retiredWriteEntryCount < 1 ||
    fillSummary.uncoveredRetiredWriteCount !== 0 ||
    fillSummary.staleRetiredWriteCount !== 0 ||
    fillSummary.blockerCount !== 0
  ) {
    blockers.push("POL23_LEGACY_WRITE_CLOSURE_INCOMPLETE");
  }

  if (
    pol21Report?.status !== "ready" ||
    pol21Report?.mainlineCount !== 15 ||
    !Array.isArray(pol21Report?.blockers) ||
    pol21Report.blockers.length !== 0
  ) {
    blockers.push("POL23_CROSS_DOMAIN_ACCEPTANCE_INCOMPLETE");
  }

  const executionPolicy = dynamicGateManifest?.executionPolicy;
  if (
    executionPolicy?.mode !== "local_disposable_only" ||
    executionPolicy?.requireExactCandidateSha !== true ||
    executionPolicy?.requireCleanWorktree !== true ||
    executionPolicy?.rejectInheritedDatabaseTargets !== true ||
    !hasExactMembers(
      executionPolicy?.prohibitedTargets,
      REQUIRED_PROHIBITED_TARGETS
    )
  ) {
    blockers.push("POL23_DATABASE_GATE_NOT_EXACT_SHA");
  }
  if (
    dynamicGateManifest?.migrationBaseline?.postgresMajorVersion !== 16 ||
    !Number.isInteger(
      dynamicGateManifest?.migrationBaseline?.expectedDirectoryCount
    ) ||
    dynamicGateManifest.migrationBaseline.expectedDirectoryCount < 1
  ) {
    blockers.push("POL23_MIGRATION_BASELINE_INVALID");
  }
  if (
    dynamicGateManifest?.inventory?.remainingFiles !== 0 ||
    dynamicGateManifest?.inventory?.remainingTests !== 0
  ) {
    blockers.push("POL23_DATABASE_DYNAMIC_INVENTORY_INCOMPLETE");
  }

  if (
    typeof localReleaseSource !== "string" ||
    !localReleaseSource.includes("run_check pol22-readonly-preflight") ||
    !localReleaseSource.includes(
      "services/api/scripts/run-business-zeroing-cli.sh preflight-dynamic"
    )
  ) {
    blockers.push("POL23_READONLY_ZEROING_PREFLIGHT_NOT_WIRED");
  }

  if (
    typeof runbookSource !== "string" ||
    REQUIRED_RUNBOOK_TEXT.some((text) => !runbookSource.includes(text))
  ) {
    blockers.push("POL23_MIGRATION_ROLLBACK_RUNBOOK_INCOMPLETE");
  }
  if (
    !hasExactMembers(
      manifest?.prohibitedActions,
      REQUIRED_PROHIBITED_ACTIONS
    )
  ) {
    blockers.push("POL23_PRODUCTION_ACTION_SEPARATION_INCOMPLETE");
  }

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers
  };
}
