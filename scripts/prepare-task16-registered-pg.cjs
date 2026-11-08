#!/usr/bin/env node
"use strict";

// Source metadata only. No SQL/database/resource/installer execution mode exists.
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, realpathSync, lstatSync, readdirSync, mkdirSync, existsSync } = require("node:fs");
const path = require("node:path");

const SQL_ROOT = "services/api/prisma/prepared/task16";
const FRAGMENTS = ["registered-funding.sql", "registered-history-revision.sql", "registered-write-authority.sql", "registered-canonical-proof.sql", "registered-intercompany.sql", "registered-canonical-adapter.sql", "registered-voucher.sql"].map(name => `${SQL_ROOT}/${name}`);
const SCHEMA = "services/api/prisma/schema.prisma";
const MIGRATIONS = "services/api/prisma/migrations";
const CASE_SOURCE = "services/api/src/database/registered-payment-postgres.cases.ts";
const FIXTURE = "services/api/src/database/registered-payment-postgres.fixture.ts";
const CASE_ID = "registered.null-cross-company.commit";
const HANDLER = "runRegisteredNullCrossCompanyCommit";
const STATUS = "SOURCE_ONLY_NOT_EXECUTED";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fail(code) { throw Object.assign(new Error(code), { packetCode: code }); }
function need(condition, code) { if (!condition) fail(code); }
function canonical(file, directory = false) {
  need(typeof file === "string" && path.isAbsolute(file) && path.normalize(file) === file, "PATH_NOT_CANONICAL");
  let at = path.parse(file).root;
  for (const segment of file.slice(at.length).split(path.sep).filter(Boolean)) {
    at = path.join(at, segment); need(!lstatSync(at).isSymbolicLink(), "PATH_SYMLINK");
  }
  const stat = lstatSync(file);
  need(realpathSync(file) === file && (directory ? stat.isDirectory() : stat.isFile()), "PATH_TYPE_INVALID");
  return file;
}
function git(root, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.GIT_CONFIG_NOSYSTEM = "1"; env.GIT_CONFIG_GLOBAL = "/dev/null";
  return execFileSync("git", ["--no-replace-objects", "--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 15_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
  });
}
function members(root, relative, predicate) {
  canonical(path.join(root, relative), true);
  const result = []; let visited = 0;
  function walk(dir, depth = 0) {
    need(depth <= 64, "SOURCE_DIRECTORY_DEPTH");
    for (const item of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      need(++visited <= 20_000, "SOURCE_DIRECTORY_SIZE");
      const name = `${dir}/${item.name}`;
      need(!item.isSymbolicLink(), "SOURCE_SYMLINK");
      if (item.isDirectory()) walk(name, depth + 1);
      else { need(item.isFile(), "SOURCE_FILE_INVALID"); if (predicate(name)) result.push(name); }
    }
  }
  walk(relative); return result.sort();
}
function sourceSnapshot(repo, candidateSha) {
  const root = canonical(repo, true);
  need(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(candidateSha), "CANDIDATE_SHA_INVALID");
  need(realpathSync(git(root, "rev-parse", "--show-toplevel").trim()) === root, "SOURCE_ROOT_MISMATCH");
  need(git(root, "rev-parse", "HEAD").trim() === candidateSha, "CANDIDATE_SHA_MISMATCH");
  const objectFormat = git(root, "rev-parse", "--show-object-format").trim();
  need(["sha1", "sha256"].includes(objectFormat), "OBJECT_FORMAT_INVALID");
  const tree = git(root, "ls-tree", "-r", "-z", candidateSha).split("\0").filter(Boolean).map(row => {
    const split = row.indexOf("\t"); need(split > 0, "SOURCE_TREE_INVALID");
    const [mode, type, oid] = row.slice(0, split).split(" "); const name = row.slice(split + 1);
    need(name && !path.posix.isAbsolute(name) && !name.split("/").some(x => !x || x === "." || x === "..") && !name.includes("\\"), "SOURCE_PATH_INVALID");
    need(type === "blob" && ["100644", "100755"].includes(mode), "SOURCE_FILE_INVALID");
    return { path: name, mode, oid };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  need(tree.length > 0 && tree.length <= 20_000, "SOURCE_TREE_SIZE");
  const indexed = git(root, "ls-files", "--stage", "-z").split("\0").filter(Boolean).map(row => {
    const split = row.indexOf("\t"); const [mode, oid, stage] = row.slice(0, split).split(" ");
    need(stage === "0", "SOURCE_INDEX_NOT_CLEAN"); return { path: row.slice(split + 1), mode, oid };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  need(JSON.stringify(indexed) === JSON.stringify(tree), "SOURCE_INDEX_NOT_CLEAN");
  need(git(root, "ls-files", "--others", "--exclude-standard", "-z") === "", "SOURCE_NOT_CLEAN");
  let bytesTotal = 0;
  const contents = new Map();
  const files = tree.map(row => {
    const file = canonical(path.join(root, row.path)); const stat = lstatSync(file);
    need(stat.size <= 64 * 1024 * 1024 && (bytesTotal += stat.size) <= 512 * 1024 * 1024, "SOURCE_BYTE_BUDGET");
    need(Boolean(stat.mode & 0o100) === (row.mode === "100755"), "SOURCE_MODE_MISMATCH");
    const bytes = readFileSync(file);
    need(createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === row.oid, "SOURCE_CONTENT_MISMATCH");
    if (FRAGMENTS.includes(row.path) || [CASE_SOURCE, FIXTURE, SCHEMA].includes(row.path)) contents.set(row.path, bytes);
    return { path: row.path, sha256: hash(bytes), bytes: bytes.length };
  });
  for (const required of [...FRAGMENTS, CASE_SOURCE, FIXTURE, SCHEMA, `${MIGRATIONS}/migration_lock.toml`]) need(files.some(row => row.path === required), "REQUIRED_INPUT_MISSING");
  const migrations = files.filter(row => row.path.startsWith(`${MIGRATIONS}/`) && row.path.endsWith("/migration.sql"));
  need(migrations.length === 202, "MIGRATION_COUNT_MISMATCH");
  need(JSON.stringify(members(root, MIGRATIONS, name => name.endsWith("/migration.sql"))) === JSON.stringify(migrations.map(row => row.path)), "MIGRATION_MEMBERSHIP_MISMATCH");
  need(JSON.stringify(members(root, SQL_ROOT, name => name.endsWith(".sql"))) === JSON.stringify([...FRAGMENTS].sort()), "FRAGMENT_MEMBERSHIP_MISMATCH");
  need(git(root, "rev-parse", "HEAD").trim() === candidateSha, "SOURCE_CHANGED_DURING_CAPTURE");
  return { root, files, migrations, contents };
}

// Use only this tool workspace's pinned compiler; never resolve input-repo modules.
const TYPESCRIPT_SHA256 = "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";
function caseInventory(bytes) {
  const source = bytes.toString("utf8"); need(Buffer.from(source).equals(bytes) && bytes.length <= 1_000_000, "CASE_DECLARATION_INVALID");
  const compilerPath = realpathSync(require.resolve("typescript", { paths: [path.resolve(__dirname, "../services/api")] }));
  canonical(compilerPath); need(hash(readFileSync(compilerPath)) === TYPESCRIPT_SHA256, "COMPILER_IDENTITY_MISMATCH");
  const ts = require(compilerPath);
  need(ts.version === "5.9.3" && hash(readFileSync(compilerPath)) === TYPESCRIPT_SHA256, "COMPILER_IDENTITY_MISMATCH");
  const file = ts.createSourceFile(CASE_SOURCE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  need(file.parseDiagnostics.length === 0, "CASE_SYNTAX_INVALID");
  const exported = file.statements.filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  need(exported.length === 2 && exported.every(node => ts.isFunctionDeclaration(node) && node.name && node.body && !node.asteriskToken &&
    node.modifiers.every(modifier => [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.AsyncKeyword].includes(modifier.kind))), "CASE_EXPORTS_MISMATCH");
  need(exported.every(node => node.name.getText(file) === node.name.text), "CASE_EXPORT_INVALID");
  const declaration = exported.find(node => node.name.text === "registeredPaymentPostgresCases");
  const handler = exported.find(node => node.name.text === HANDLER);
  const isAsync = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;
  need(declaration && !isAsync(declaration) && declaration.parameters.length === 0 && handler && isAsync(handler), "CASE_HANDLER_MISMATCH");
  function literal(node, depth = 0) {
    need(node && depth <= 64, "CASE_LITERAL_INVALID");
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) { const value = Number(node.text); need(/^(?:0|[1-9][0-9]*)$/u.test(node.getText(file)) && Number.isSafeInteger(value), "CASE_LITERAL_INVALID"); return value; }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value => literal(value, depth + 1));
    if (ts.isObjectLiteralExpression(node)) {
      const result = Object.create(null);
      for (const property of node.properties) {
        need(ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)), "CASE_LITERAL_INVALID");
        const name = property.name.text;
        need(!Object.hasOwn(result, name) && !["__proto__", "prototype", "constructor"].includes(name), "CASE_LITERAL_INVALID");
        result[name] = literal(property.initializer, depth + 1);
      }
      return result;
    }
    fail("CASE_LITERAL_INVALID");
  }
  const statements = declaration.body.statements;
  need(statements.length === 1 && ts.isReturnStatement(statements[0]), "CASE_LITERAL_INVALID");
  const cases = literal(statements[0].expression);
  need(Array.isArray(cases) && cases.length === 1, "CASE_INVENTORY_MISMATCH");
  const row = cases[0];
  const keys = ["id", "handlerExport", "fixture", "publicEntry", "amountCents", "executed", "sqlExecuted", "independentExpectation", "limits"];
  need(row && Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)) && row.id === CASE_ID && row.handlerExport === HANDLER && row.executed === false && row.sqlExecuted === false, "CASE_INVENTORY_MISMATCH");
  need(row.fixture === "approved-settlement-project-unenabled-company-b-pays-a" && row.publicEntry === "POST /payment-executions/:paymentId/registrations" && row.amountCents === "4000", "CASE_INVENTORY_MISMATCH");
  const expected = { execution: 1, funding: 1, allocation: 1, event: 1, audit: 1, debtor: "A", creditor: "B", rootAmountCents: "4000", roots: 1, operatingFacts: 0, operatingImpacts: 0, balanceA: "100.0000", balanceB: "60.0000", paidCents: "4000", remainingCents: "6000" };
  const limits = ["Pre-approved state fixture; no approval-path acceptance", "Requires future explicitly authorized connected executor", "No failure/concurrency cases or live resource acceptance"];
  need(JSON.stringify(row.independentExpectation) === JSON.stringify(expected) && JSON.stringify(row.limits) === JSON.stringify(limits), "CASE_EXPECTATION_MISMATCH");
  return [{ ...row, handlerBinding: { sourcePath: CASE_SOURCE, sourceSha256: hash(bytes), declarationSha256: hash(handler.getText(file)) } }];
}
function payload(repo, candidateSha) {
  const source = sourceSnapshot(repo, candidateSha);
  const byPath = new Map(source.files.map(row => [row.path, row]));
  const composed = createHash("sha256");
  const fragments = FRAGMENTS.map(file => { const bytes = source.contents.get(file); composed.update(Buffer.from(`${file}\0${bytes.length}\0`)).update(bytes); return byPath.get(file); });
  const result = {
    schemaVersion: 1, purpose: "task16-registered-pg-source-only-packet", status: STATUS,
    executionAllowed: false, resourceExecutorImplemented: false, candidateSha,
    preparer: { sourceSha256: hash(readFileSync(__filename)), candidateMembership: "not-asserted", typescriptVersion: "5.9.3", typescriptSha256: TYPESCRIPT_SHA256 },
    source: { repo: source.root, files: source.files, ignoredArtifacts: "not-sealed", installedDependencies: "not-verified" },
    schema: byPath.get(SCHEMA), migrations: source.migrations,
    installation: { status: STATUS, fragments, framing: "ordered UTF-8 path + NUL + decimal byte length + NUL + source bytes", framedContentSha256: composed.digest("hex"), sqlGrammar: "NOT_VERIFIED", transactionalInstallation: "NOT_EXECUTED",
      prerequisites: { fragmentsAreNotMigrations: true, requiredRoleSetting: "jg.task16_runtime_role", roleValue: null, blanketGrantAfterHistoryFragment: "PROHIBITED", installedFunctionBodies: "NOT_VERIFIED" } },
    fixture: byPath.get(FIXTURE), cases: caseInventory(source.contents.get(CASE_SOURCE)),
    unresolved: { runtimeRole: null, ownerRole: null, observerRole: null, transport: "NOT_VERIFIED", acl: "NOT_VERIFIED", installation: "NOT_EXECUTED", resourceIdentity: "NOT_VERIFIED", cleanup: "NOT_EXECUTED", normalCommit: "NOT_EXECUTED", commitFailure: "NOT_EXECUTED", disconnect: "NOT_EXECUTED", responseLoss: "NOT_EXECUTED", concurrency: "NOT_EXECUTED" }
  };
  const after = sourceSnapshot(repo, candidateSha);
  need(JSON.stringify(source.files) === JSON.stringify(after.files), "SOURCE_CHANGED_DURING_CAPTURE");
  return result;
}
function parse(args) {
  const prepare = args.length === 7 && args[0] === "--prepare" && args[1] === "--repo" && args[3] === "--candidate-sha" && args[5] === "--output";
  const verify = args.length === 5 && args[0] === "--verify" && args[1] === "--packet" && args[3] === "--expected-sha256";
  need(prepare || verify, "INVALID_ARGUMENTS"); need(args.slice(1).filter((_, index) => index % 2 === 1).every(value => value && !value.startsWith("--")), "INVALID_ARGUMENTS");
  return prepare ? { mode: "prepare", repo: args[2], candidateSha: args[4], output: args[6] } : { mode: "verify", packet: args[2], expectedSha256: args[4] };
}
function main() {
  const args = parse(process.argv.slice(2));
  if (args.mode === "prepare") {
    const parent = canonical(path.dirname(args.output), true); need(path.isAbsolute(args.output) && path.normalize(args.output) === args.output && path.basename(args.output) !== ".", "PATH_NOT_CANONICAL");
    const destination = path.join(parent, path.basename(args.output));
    need(!existsSync(destination), "OUTPUT_EXISTS");
    const root = canonical(args.repo, true); const rel = path.relative(root, destination);
    need(rel && (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)), "OUTPUT_IN_SOURCE");
    const data = payload(root, args.candidateSha); const sealSha256 = hash(JSON.stringify(data));
    const packetBytes = Buffer.from(`${JSON.stringify({ ...data, sealSha256 }, null, 2)}\n`);
    mkdirSync(destination, { mode: 0o700 });
    writeFileSync(path.join(destination, "packet.json"), packetBytes, { flag: "wx", mode: 0o600 });
    return { status: STATUS, executionAllowed: false, resourceExecutorImplemented: false, candidateSha: data.candidateSha, migrationCount: data.migrations.length, fragmentCount: data.installation.fragments.length, caseCount: data.cases.length, sealSha256, packetSha256: hash(packetBytes) };
  }
  need(/^[a-f0-9]{64}$/u.test(args.expectedSha256), "EXPECTED_DIGEST_INVALID");
  const file = canonical(args.packet); need(lstatSync(file).size <= 16 * 1024 * 1024, "PACKET_BYTE_BUDGET");
  const bytes = readFileSync(file); need(hash(bytes) === args.expectedSha256, "PACKET_DIGEST_MISMATCH");
  const packet = JSON.parse(bytes.toString("utf8"));
  need(packet && typeof packet === "object" && !Array.isArray(packet), "PACKET_INVALID");
  const data = payload(packet.source?.repo, packet.candidateSha); const expected = { ...data, sealSha256: hash(JSON.stringify(data)) };
  need(JSON.stringify(packet) === JSON.stringify(expected), "PACKET_MISMATCH");
  return { status: "SOURCE_ONLY_VERIFIED_NOT_EXECUTED", executionAllowed: false, resourceExecutorImplemented: false, candidateSha: data.candidateSha, sealSha256: expected.sealSha256, packetSha256: args.expectedSha256 };
}
try { process.stdout.write(`${JSON.stringify(main())}\n`); }
catch (error) { process.stdout.write(`${JSON.stringify({ status: "REJECTED", code: error.packetCode || "SOURCE_OR_PACKET_UNAVAILABLE", executionAllowed: false, resourceExecutorImplemented: false })}\n`); process.exitCode = 1; }
