#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  evaluateFindings,
  scanSourceTree
} = require("./check-business-errors.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "business-error-check-"));

try {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "business.ts"),
    [
      'throw new BadRequestException("English HTTP");',
      'throw new UnauthorizedException("English unauthorized");',
      'throw new InternalServerErrorException("English internal");',
      'throw new Error("English direct");',
      'throw new BadRequestException({ message: "English object", errors: ["English errors", { message: "English nested errors" }] });',
      'throw new ForbiddenException(`English static template`);',
      'throw new NotFoundException(`English ${secret} template`);',
      'throw new BadRequestException("中文通过");',
      'throw new Error(`中文 ${secret}`);'
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "src", "ignored.spec.ts"),
    'throw new BadRequestException("Spec must be excluded");\n'
  );
  fs.writeFileSync(
    path.join(root, "src", "ignored.test.ts"),
    'throw new Error("Test must be excluded");\n'
  );
  fs.writeFileSync(
    path.join(root, "src", "ignored.d.ts"),
    'throw new Error("Declaration must be excluded");\n'
  );

  const { findings } = scanSourceTree(path.join(root, "src"), root);
  assert.deepEqual(
    findings.map(({ kind, message }) => [kind, message]),
    [
      ["BadRequestException", "English HTTP"],
      ["UnauthorizedException", "English unauthorized"],
      ["InternalServerErrorException", "English internal"],
      ["Error", "English direct"],
      ["BadRequestException", "English object"],
      ["BadRequestException", "English errors"],
      ["BadRequestException", "English nested errors"],
      ["ForbiddenException", "English static template"],
      ["NotFoundException", 'template:["English "," template"]']
    ]
  );
  assert.equal(evaluateFindings(findings, []).filter((error) => error.type === "unallowed").length, 9);

  const exactAllowlist = findings.map((finding) => ({
    file: finding.file,
    kind: finding.kind,
    message: finding.message,
    expectedOccurrences: 1,
    reason: "self-test"
  }));
  assert.deepEqual(evaluateFindings(findings, exactAllowlist), []);

  const missingAllowlist = exactAllowlist.slice(1);
  assert.equal(
    evaluateFindings(findings, missingAllowlist).some((error) => error.type === "unallowed"),
    true
  );

  const staleAllowlist = [
    ...exactAllowlist,
    {
      file: "src/stale.ts",
      kind: "Error",
      message: "stale",
      expectedOccurrences: 1,
      reason: "self-test"
    }
  ];
  assert.equal(
    evaluateFindings(findings, staleAllowlist).some(
      (error) => error.type === "stale_allow_entry"
    ),
    true
  );

  const countDriftAllowlist = exactAllowlist.map((entry, index) =>
    index === 0 ? { ...entry, expectedOccurrences: 2 } : entry
  );
  assert.equal(
    evaluateFindings(findings, countDriftAllowlist).some(
      (error) => error.type === "count_mismatch"
    ),
    true
  );

  assert.equal(
    evaluateFindings(findings, [...exactAllowlist, exactAllowlist[0]]).some(
      (error) => error.type === "duplicate_allow_entry"
    ),
    true
  );

  const invalidAllowlist = [
    ...exactAllowlist,
    {
      file: "src/**/*.ts",
      kind: "Error",
      message: "invalid glob entry",
      expectedOccurrences: 1,
      reason: "self-test"
    }
  ];
  assert.equal(
    evaluateFindings(findings, invalidAllowlist).some(
      (error) => error.type === "invalid_allow_entry"
    ),
    true
  );

  console.log("英文业务错误检查器自测通过。");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
