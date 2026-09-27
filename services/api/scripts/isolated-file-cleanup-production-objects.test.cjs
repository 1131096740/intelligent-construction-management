"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createProductionObjectOperations } = require("./isolated-file-cleanup-production-objects.cjs");

test("正式对象适配层只访问计划内的精确两键与版本，失败后不重发", async t => {
  const runtime = { platform: "linux", inContainer: false, environment: {
    FILE_STORAGE_DRIVER: "cos", COS_BUCKET: "private-prod-123", COS_REGION: "ap-guangzhou",
    DATABASE_URL: "postgresql://jiangkong_runtime:fixture@127.0.0.1:5432/jiangkong"
  } };
  const objects = ["one", "two"].map(name => ({ kind: "cos_versions", bucket: runtime.environment.COS_BUCKET,
    objectKey: `archive/${name}.pdf`, versions: [{ versionId: `${name}-current` }, { versionId: `${name}-old` }] }));
  const plan = { mode: "isolated_file_cleanup_dry_run", operations: objects.map((object, index) => ({
    database: { table: "FileObject", primaryKey: { id: `id-${index}` } }, object
  })) };
  const calls = [];
  let authorityValid = true;
  const adapter = createProductionObjectOperations({ source: { environment: "production" }, plan, runtime,
    verifyAuthority: async () => { if (!authorityValid) throw new Error("FENCE_EXPIRED"); },
    listObjectVersions: async object => { calls.push(["GET", object.objectKey]); return object.versions; },
    deleteObjectVersion: async (object, versionId) => { calls.push(["DELETE", object.objectKey, versionId]); } });
  assert.deepEqual(await adapter.listVersions(objects[0]), objects[0].versions);
  await adapter.deleteVersion(objects[0], "one-current");
  assert.deepEqual(calls, [["GET", "archive/one.pdf"], ["DELETE", "archive/one.pdf", "one-current"]]);

  await t.test("扩大对象、跨 bucket 和额外版本均零远端请求", async () => {
    const before = calls.length;
    for (const object of [{ ...objects[0], objectKey: "archive/other.pdf" },
      { ...objects[0], bucket: "private-other" },
      { ...objects[0], versions: [...objects[0].versions, { versionId: "unapproved" }] }]) {
      await assert.rejects(adapter.listVersions(object), /PRODUCTION_OBJECT_SCOPE_INVALID/u);
      await assert.rejects(adapter.deleteVersion(object, "one-old"), /PRODUCTION_OBJECT_SCOPE_INVALID/u);
    }
    await assert.rejects(adapter.deleteVersion(objects[0], "unapproved"), /PRODUCTION_OBJECT_SCOPE_INVALID/u);
    assert.equal(calls.length, before);
  });
  await t.test("同版本的第二次调用被拒绝，冻结失效时零远端请求", async () => {
    const before = calls.length;
    await assert.rejects(adapter.deleteVersion(objects[0], "one-current"), /PRODUCTION_VERSION_ATTEMPTED/u);
    authorityValid = false;
    await assert.rejects(adapter.listVersions(objects[1]), /FENCE_EXPIRED/u);
    await assert.rejects(adapter.deleteVersion(objects[1], "two-current"), /FENCE_EXPIRED/u);
    assert.equal(calls.length, before);
  });
  await t.test("请求结果未知也不得重试", async () => {
    const failing = createProductionObjectOperations({ source: { environment: "production" }, plan, runtime,
      verifyAuthority: async () => undefined, listObjectVersions: async () => [],
      deleteObjectVersion: async () => { throw new Error("NETWORK_UNKNOWN"); } });
    await assert.rejects(failing.deleteVersion(objects[1], "two-old"), /NETWORK_UNKNOWN/u);
    await assert.rejects(failing.deleteVersion(objects[1], "two-old"), /PRODUCTION_VERSION_ATTEMPTED/u);
  });
  await t.test("容器或本机上下文不能构造正式对象适配层", () => {
    assert.throws(() => createProductionObjectOperations({ source: { environment: "production" }, plan,
      runtime: { ...runtime, inContainer: true }, verifyAuthority: async () => undefined,
      listObjectVersions: async () => [], deleteObjectVersion: async () => undefined }),
    /PRODUCTION_RUNTIME_INVALID/u);
  });
  await t.test("计划自身重复对象键、跨 bucket 或重复版本不能构造适配层", () => {
    const base = { source: { environment: "production" }, runtime,
      verifyAuthority: async () => undefined, listObjectVersions: async () => [],
      deleteObjectVersion: async () => undefined };
    for (const changed of [
      [plan.operations[0], { ...plan.operations[1], object: objects[0] }],
      [plan.operations[0], { ...plan.operations[1], object: { ...objects[1], bucket: "private-other" } }],
      [plan.operations[0], { ...plan.operations[1], object: { ...objects[1], versions: [objects[1].versions[0], objects[1].versions[0]] } }]
    ]) assert.throws(() => createProductionObjectOperations({ ...base,
      plan: { ...plan, operations: changed } }), /PRODUCTION_OBJECT_SCOPE_INVALID/u);
  });
  await t.test("计划中的非精确对象键在远端请求前拒绝", () => {
    const base = { source: { environment: "production" }, runtime,
      verifyAuthority: async () => undefined, listObjectVersions: async () => [],
      deleteObjectVersion: async () => undefined };
    for (const objectKey of ["/archive/one.pdf", "archive/../one.pdf", "archive/./one.pdf",
      "archive//one.pdf", "archive\\one.pdf", "archive/one.pdf\0extra", "archive/"]) {
      assert.throws(() => createProductionObjectOperations({ ...base,
        plan: { ...plan, operations: [
          { ...plan.operations[0], object: { ...objects[0], objectKey } }, plan.operations[1]
        ] } }), /PRODUCTION_OBJECT_SCOPE_INVALID/u);
    }
    assert.equal(calls.length, 2);
  });
});
