"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SUITES = Object.freeze({
  "employee-onboarding-http-postgres.spec.ts": "onboarding",
  "project-roster-http-postgres.spec.ts": "roster"
});

function capture(source, round, suite, assertions) {
  const from = path.join(source, "apps/web-admin/test-results"), output = path.join(round, "suite-browser-artifacts");
  let status = "captured", fileCount = 0, stagedTraces = 0;
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  try {
    const copy = (input, target) => {
      const stat = fs.lstatSync(input);
      if (stat.isDirectory()) { fs.mkdirSync(target, { mode: 0o700 }); for (const name of fs.readdirSync(input).sort()) copy(path.join(input, name), path.join(target, name)); }
      else if (stat.isFile()) { fs.copyFileSync(input, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600); fileCount++; }
      else throw new Error("private artifact type rejected");
    };
    if (fs.existsSync(from)) copy(from, path.join(output, suite)); else status = "source-absent";
    if (suite === "roster" && status === "captured") {
      const staging = path.join(round, "collector-root/apps/web-admin/test-results/project-roster-real");
      fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
      const snapshot = path.join(output, suite);
      for (const name of fs.readdirSync(snapshot).sort()) {
        if (!/^project-roster-real\.e2e\.ts-.+-(desktop|mobile)$/.test(name)) continue;
        const directory = path.join(snapshot, name), trace = path.join(directory, "trace.zip");
        if (!fs.lstatSync(directory).isDirectory() || !fs.existsSync(trace) || !fs.lstatSync(trace).isFile()) continue;
        fs.mkdirSync(path.join(staging, name), { mode: 0o700 });
        fs.copyFileSync(trace, path.join(staging, name, "trace.zip"), fs.constants.COPYFILE_EXCL);
        fs.chmodSync(path.join(staging, name, "trace.zip"), 0o600); stagedTraces++;
      }
    }
  } catch { status = "copy-or-staging-failed"; }
  const receipt = { suite, status, fileCount, stagedTraces, registered: assertions.length,
    passed: assertions.filter(row => row.status === "passed").length,
    failed: assertions.filter(row => row.status === "failed").length,
    skipped: assertions.filter(row => row.status === "pending" || row.status === "todo").length,
    sourceMayPreexistWhenBrowserNotReached: true, copyAt: "suite-end-before-next-suite" };
  fs.writeFileSync(path.join(output, suite + ".safe.json"), JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
  return receipt;
}

class PrivateSuiteArtifacts {
  constructor() {
    this.source = fs.realpathSync(process.env.PR348_NATIVE_SOURCE);
    this.round = fs.realpathSync(process.env.PR348_NATIVE_ROUND);
    if (this.source !== path.resolve(process.env.PR348_NATIVE_SOURCE) || this.round !== path.resolve(process.env.PR348_NATIVE_ROUND)) throw new Error("private path rejected");
  }
  onTestResult(test, result) {
    const file = path.basename(test.path), suite = SUITES[file];
    if (!suite || test.path !== path.join(this.source, "services/api/src/database", file)) return;
    const receipt = capture(this.source, this.round, suite, Array.isArray(result.testResults) ? result.testResults : []);
    process.stdout.write(JSON.stringify({ status: receipt.status, fileCount: receipt.fileCount }) + "\n");
  }
}

module.exports = PrivateSuiteArtifacts;
module.exports.capture = capture;
