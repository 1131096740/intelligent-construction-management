"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const HISTORY = Object.freeze({
  "6ec31b9fabe9cfc4a91215c1476b773bb7d32224": { files: 2692, migrations: 178 },
  "d6719ba2ad89f716f5d67dc0795cdccf98d9820f": { files: 2811, migrations: 192 }
});
const IMAGE = "postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d";
const RUNNER = "services/api/prisma/run-employee-onboarding-local.cjs";
const RUNNER_SHA256 = "4636c4e93d1714a875dc9eb70106b0d96b2fac66dca2425fbd1c64d56b140921";
const OLD_COMMAND = 'command("pnpm", ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/employee-onboarding-http-postgres.spec.ts", "src/database/project-roster-http-postgres.spec.ts"], env);';
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const reject = () => { throw new Error("historical preparation rejected"); };
const write = (file, value) => fs.writeFileSync(file, value, { flag: "wx", mode: 0o600 });

function adaptText(original, reporter) {
  const command = OLD_COMMAND.replace('"src/database/project-roster-http-postgres.spec.ts"], env);',
    '"src/database/project-roster-http-postgres.spec.ts", "--reporters", "default", "--reporters", ' + JSON.stringify(reporter) + '], env);');
  const replacements = [['"postgres:16"', JSON.stringify(IMAGE)], [OLD_COMMAND, command]];
  let adapted = original;
  for (const [before, after] of replacements) {
    if (adapted.split(before).length !== 2) reject();
    adapted = adapted.replace(before, after);
  }
  let inverse = adapted;
  for (const [before, after] of [...replacements].reverse()) {
    if (inverse.split(after).length !== 2) reject();
    inverse = inverse.replace(after, before);
  }
  if (inverse !== original) reject();
  return adapted;
}

function prepare(sourceArg, roundArg) {
  const source = fs.realpathSync(sourceArg), round = fs.realpathSync(roundArg);
  if (source !== path.resolve(sourceArg) || round !== path.resolve(roundArg) || fs.lstatSync(sourceArg).isSymbolicLink() ||
      fs.lstatSync(roundArg).isSymbolicLink() || !fs.statSync(round).isDirectory() || fs.readdirSync(round).length) reject();
  const git = args => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const sha = git(["rev-parse", "HEAD"]), expected = HISTORY[sha];
  if (!expected || git(["status", "--porcelain=v1", "--untracked-files=no"]) ||
      git(["ls-files", "-z"]).split("\0").filter(Boolean).length !== expected.files) reject();
  const migrations = fs.readdirSync(path.join(source, "services/api/prisma/migrations"), { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (migrations.length !== expected.migrations) reject();
  const filename = path.join(source, RUNNER), original = fs.readFileSync(filename, "utf8");
  if (digest(original) !== RUNNER_SHA256) reject();
  const reporter = path.join(round, "suite-reporter.cjs"), adaptedFile = path.join(round, "runner.adapted.cjs");
  const adapted = adaptText(original, reporter);
  fs.chmodSync(round, 0o700);
  write(reporter, fs.readFileSync(path.join(__dirname, "pr348-historical-suite-reporter.cjs")));
  write(adaptedFile, adapted);
  // The unchanged original filename supplies its __dirname and module lookup paths.
  const launcher = '"use strict";\nconst fs=require("node:fs"),Module=require("node:module"),path=require("node:path");\n' +
    'const filename=' + JSON.stringify(filename) + ';const selected=new Module(filename,module);selected.filename=filename;selected.paths=Module._nodeModulePaths(path.dirname(filename));\n' +
    'selected._compile(fs.readFileSync(' + JSON.stringify(adaptedFile) + ',"utf8"),filename);\n';
  write(path.join(round, "launch.cjs"), launcher);
  const receipt = { status: "prepared", sourceSha: sha, sourceFiles: expected.files, migrations: expected.migrations,
    originalRunnerSha256: digest(original), adaptedRunnerSha256: digest(adapted), inverseRestoresExactOriginal: true,
    changes: ["immutable PG image", "default plus synchronous suite reporter"],
    originalSuiteCount: 2, originalTestCount: 22, originalTimeoutsMs: [30000, 120000, 180000], retries: 0,
    originalFilenamePreserved: true, applicationSourceModified: false };
  write(path.join(round, "adaptation.safe.json"), JSON.stringify(receipt) + "\n");
  return receipt;
}

module.exports = { HISTORY, IMAGE, OLD_COMMAND, RUNNER_SHA256, adaptText, prepare };
if (require.main === module) {
  try {
    if (process.argv.length !== 4) reject();
    const result = prepare(process.argv[2], process.argv[3]);
    process.stdout.write(JSON.stringify({ status: result.status, sourceSha: result.sourceSha }) + "\n");
  } catch {
    process.stderr.write('{"status":"historical-preparation-rejected"}\n');
    process.exitCode = 1;
  }
}
