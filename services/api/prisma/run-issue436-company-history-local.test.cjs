const assert = require("node:assert/strict");
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { delimiter, join } = require("node:path");
const { test } = require("node:test");
const { parseReadback } = require("./local-staged-migration-controls.cjs");
const { frameStage205 } = require("./testdata/local-stage205-readback-model.cjs");
const { runStagedDockerCommand } = require("./run-issue436-company-history-local.cjs");

test("完整迁移的标准输出保留第 205 段最后一字节并与 stderr 分离", () => {
  const directory = mkdtempSync(join(tmpdir(), "issue436-stage205-wire-"));
  const payload = { stage: 205, witness: "合成归档资格".repeat(8_000) };
  const framed = frameStage205(payload);
  const command = join(directory, "docker");
  try {
    writeFileSync(command, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(framed)});\nprocess.stderr.write("diagnostic only\\n");\n`);
    chmodSync(command, 0o700);
    const result = runStagedDockerCommand("unix:///synthetic.sock", ["exec", "synthetic", "psql"], {
      env: { ...process.env, PATH: directory + delimiter + process.env.PATH },
      timeoutMs: 5_000,
      maxOutputBytes: 1024 * 1024
    });
    assert.equal(result.stdout, framed);
    assert.deepEqual(parseReadback(result.stdout), payload);
    assert.throws(() => parseReadback(result.stdout.trim()), /LOCAL_MIGRATION_STAGE205_FRAMING/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
