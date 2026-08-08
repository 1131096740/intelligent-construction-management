import assert from "node:assert/strict";
import test from "node:test";
import {
  RELEASE_MANIFEST_COMMANDS,
  runReleaseManifestChecks
} from "./inspect-release-manifests.mjs";

test("release manifest orchestration builds once then runs each required check once", () => {
  const calls = [];
  const status = runReleaseManifestChecks({
    runCommand(command, args) {
      calls.push({ command, args });
      return 0;
    }
  });

  assert.equal(status, 0);
  assert.deepEqual(calls, RELEASE_MANIFEST_COMMANDS);
  assert.equal(
    calls.filter(
      ({ args }) =>
        args.includes("--filter") &&
        args.includes("@jiangkong/api") &&
        args.includes("build")
    ).length,
    1
  );
  assert.deepEqual(
    calls.slice(1).map(({ args }) => args),
    [
      [
        "scripts/inspect-contract-workbench-capabilities.mjs",
        "--check",
        "docs/product/contract-workbench-capability-matrix.md"
      ],
      ["scripts/inspect-whole-site-capabilities.mjs", "--check"],
      [
        "scripts/inspect-whole-site-web-api-manifest.mjs",
        "--check",
        "--require-ready"
      ],
      [
        "scripts/inspect-whole-site-page-action-manifest.mjs",
        "--check",
        "--require-ready"
      ],
      [
        "scripts/inspect-whole-site-route-usage-manifest.mjs",
        "--check",
        "--require-ready"
      ],
      [
        "scripts/inspect-whole-site-capability-matrix.mjs",
        "--check",
        "--require-ready"
      ]
    ]
  );
});

test("release manifest orchestration stops and returns the first failed command", () => {
  const calls = [];
  const status = runReleaseManifestChecks({
    runCommand(command, args) {
      calls.push({ command, args });
      return calls.length === 3 ? 17 : 0;
    }
  });

  assert.equal(status, 17);
  assert.equal(calls.length, 3);
});
