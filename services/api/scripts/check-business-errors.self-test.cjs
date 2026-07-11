#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  evaluateFindings,
  formatErrors,
  scanSourceTree
} = require("./check-business-errors.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "business-error-check-"));

try {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "business.ts"),
    [
      'import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException, UnauthorizedException, BadRequestException as BRE } from "@nestjs/common";',
      'import * as common from "@nestjs/common";',
      'throw new BadRequestException("English HTTP");',
      'throw new UnauthorizedException("English unauthorized");',
      'throw new InternalServerErrorException("English internal");',
      'throw new Error("English direct");',
      'throw new BadRequestException({ message: "English object", errors: ["English errors", { message: "English nested errors" }] });',
      'throw new ForbiddenException(`English static template`);',
      'throw new NotFoundException(`English ${secret} template`);',
      'throw new BadRequestException(("English parenthesized"));',
      'throw new BadRequestException("English as expression" as string);',
      'throw new BadRequestException(("English non-null")!);',
      'throw new BadRequestException(("TOP-SECRET satisfies string /tmp/input" satisfies string));',
      'throw new BadRequestException(({ message: "TOP-SECRET satisfies object" } satisfies { message: string }));',
      'throw new BadRequestException({ ["message"]: "TOP-SECRET computed message", [`errors`]: ["TOP-SECRET computed errors"] });',
      'throw new BRE("TOP-SECRET named alias /tmp/alias");',
      'throw new common.BadRequestException("TOP-SECRET namespace import");',
      'throw new BadRequestException(["TOP-SECRET direct array"]);',
      'throw new BadRequestException({ ...{ message: "TOP-SECRET object spread" } });',
      'throw new BadRequestException({ errors: [...["TOP-SECRET array spread"]] });',
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
      ["NotFoundException", 'template:["English "," template"]'],
      ["BadRequestException", "English parenthesized"],
      ["BadRequestException", "English as expression"],
      ["BadRequestException", "English non-null"],
      ["BadRequestException", "TOP-SECRET satisfies string /tmp/input"],
      ["BadRequestException", "TOP-SECRET satisfies object"],
      ["BadRequestException", "TOP-SECRET computed message"],
      ["BadRequestException", "TOP-SECRET computed errors"],
      ["BadRequestException", "TOP-SECRET named alias /tmp/alias"],
      ["BadRequestException", "TOP-SECRET namespace import"],
      ["BadRequestException", "TOP-SECRET direct array"],
      ["BadRequestException", "TOP-SECRET object spread"],
      ["BadRequestException", "TOP-SECRET array spread"]
    ]
  );
  const unallowedErrors = evaluateFindings(findings, []);
  assert.equal(unallowedErrors.filter((error) => error.type === "unallowed").length, 21);
  const formattedErrors = formatErrors(unallowedErrors).join("\n");
  assert.doesNotMatch(formattedErrors, /TOP-SECRET|\/tmp\//);
  assert.match(formattedErrors, /sha256:[a-f0-9]{12}/);
  assert.match(formattedErrors, /length=\d+/);

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
      message: "TOP-SECRET stale /tmp/stale",
      expectedOccurrences: 1,
      reason: "self-test"
    }
  ];
  const staleErrors = evaluateFindings(findings, staleAllowlist);
  assert.equal(staleErrors.some((error) => error.type === "stale_allow_entry"), true);
  assert.doesNotMatch(formatErrors(staleErrors).join("\n"), /TOP-SECRET|\/tmp\//);

  const countDriftAllowlist = exactAllowlist.map((entry, index) =>
    index === 0 ? { ...entry, expectedOccurrences: 2 } : entry
  );
  assert.equal(
    evaluateFindings(findings, countDriftAllowlist).some(
      (error) => error.type === "count_mismatch"
    ),
    true
  );

  const duplicateErrors = evaluateFindings(findings, [
    ...exactAllowlist,
    exactAllowlist[0]
  ]);
  assert.equal(
    duplicateErrors.some((error) => error.type === "duplicate_allow_entry"),
    true
  );
  assert.doesNotMatch(formatErrors(duplicateErrors).join("\n"), /English HTTP/);

  const invalidAllowlist = [
    ...exactAllowlist,
    {
      file: "/tmp/TOP-SECRET/**/*.ts",
      kind: "Error",
      message: "TOP-SECRET invalid /tmp/invalid",
      expectedOccurrences: 1,
      reason: "self-test"
    }
  ];
  const invalidErrors = evaluateFindings(findings, invalidAllowlist);
  assert.equal(invalidErrors.some((error) => error.type === "invalid_allow_entry"), true);
  assert.doesNotMatch(formatErrors(invalidErrors).join("\n"), /TOP-SECRET|\/tmp\//);

  console.log("英文业务错误检查器自测通过。");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
