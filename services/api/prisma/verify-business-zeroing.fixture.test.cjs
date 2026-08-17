#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { insertFixture } = require("./verify-business-zeroing.cjs");

test("disposable fixture creates its effective construction enterprise assignment", async () => {
  const queries = [];
  const prisma = {
    async $executeRawUnsafe(sql, ...parameters) {
      queries.push({ sql, parameters });
    }
  };
  const storageRoot = await mkdtemp(path.join(tmpdir(), "pol22-fixture-"));

  try {
    await insertFixture(prisma, storageRoot);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }

  const partyIndex = queries.findIndex(({ sql }) =>
    sql.includes('INSERT INTO "BusinessParty"')
  );
  const versionIndex = queries.findIndex(({ sql }) =>
    sql.includes('INSERT INTO "BusinessPartyVersion"')
  );
  const assignmentIndex = queries.findIndex(({ sql }) =>
    sql.includes('INSERT INTO "ProjectAffiliateAssignment"')
  );

  assert.ok(
    partyIndex >= 0 && partyIndex < versionIndex && versionIndex < assignmentIndex,
    "fixture must create the construction enterprise, its version, then the assignment"
  );
  assert.deepEqual(queries[assignmentIndex].parameters, [
    "isolated-assignment",
    "00000000-0000-4000-8000-000000000002",
    "isolated-party",
    "isolated-party-version",
    "隔离施工企业",
    "2026-01-01T00:00:00.000Z",
    "00000000-0000-4000-8000-000000000001"
  ]);
});
