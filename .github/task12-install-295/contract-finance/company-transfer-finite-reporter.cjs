"use strict";

const { createHash } = require("node:crypto");
const { appendFileSync } = require("node:fs");

const allowedStatuses = new Set(["passed", "failed", "timedOut", "skipped", "interrupted"]);

function describeError(error) {
  const message = error?.message ?? "";
  const location = error?.location?.file?.endsWith("/company-transfer-real.e2e.ts")
    ? [error.location.line, error.location.column]
    : /company-transfer-real\.e2e\.ts:(\d+):(\d+)/u.exec(error?.stack ?? "")?.slice(1).map(Number);
  const kind = /timeout|timed out/iu.test(message) ? "TIMEOUT"
    : /Target.*closed|browser.*closed/iu.test(message) ? "BROWSER_CLOSED"
      : /expect\(|AssertionError/u.test(message) ? "ASSERTION"
        : /ERR_CONNECTION|ECONNREFUSED/u.test(message) ? "CONNECTION" : "OTHER";
  return { kind, ...(location?.every(Number.isSafeInteger) ? { sourceLine: location[0], sourceColumn: location[1] } : {}) };
}

module.exports = class FiniteCompanyTransferReporter {
  constructor() {
    this.path = process.env.COMPANY_TRANSFER_BROWSER_OBSERVATION;
    if (!/^\/tmp\/jg394-[A-Za-z0-9]+\/company-transfer-browser-observation\.jsonl$/u.test(this.path ?? "")) {
      throw new Error("COMPANY_TRANSFER_BROWSER_REPORTER_PATH");
    }
    this.tests = 0;
    this.errors = 0;
  }

  write(event) {
    appendFileSync(this.path, JSON.stringify(event) + "\n", { mode: 0o600 });
  }

  onTestEnd(test, result) {
    if (++this.tests > 4) return;
    const project = test.parent.project()?.name;
    this.write({
      event: "test", ordinal: this.tests - 1,
      project: project === "desktop" || project === "mobile" ? project : "unknown",
      titleSha256: createHash("sha256").update(JSON.stringify(test.titlePath())).digest("hex"),
      status: allowedStatuses.has(result.status) ? result.status : "unknown",
      ...(result.error ? describeError(result.error) : {}),
    });
  }

  onError(error) {
    if (++this.errors === 1) this.write({ event: "runner-error", ...describeError(error) });
  }
};
