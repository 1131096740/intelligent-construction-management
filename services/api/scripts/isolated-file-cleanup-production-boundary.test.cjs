"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { assertProductionInspectionBoundary } = require("./isolated-file-cleanup-production-boundary.cjs");

test("生产只读入口拒绝本机合成环境、容器与非 COS 配置", () => {
  const source = { environment: "production" };
  const runtime = { platform: "linux", inContainer: false, environment: {
    FILE_STORAGE_DRIVER: "cos", COS_BUCKET: "private-prod-123", COS_REGION: "ap-guangzhou",
    DATABASE_URL: "postgresql://jiangkong_runtime:fixture@127.0.0.1:5432/jiangkong"
  } };
  assert.doesNotThrow(() => assertProductionInspectionBoundary(source, runtime));
  for (const changed of [
    { platform: "darwin" }, { inContainer: true },
    { environment: { ...runtime.environment, FILE_STORAGE_DRIVER: "local" } },
    { environment: { ...runtime.environment, COS_BUCKET: "private-local" } },
    { environment: { ...runtime.environment, COS_REGION: "ap-test" } },
    { environment: { ...runtime.environment, DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:5432/jiangkong" } },
    { environment: { ...runtime.environment, DATABASE_URL: "postgresql://jiangkong:fixture@127.0.0.1:5432/jiangkong" } },
    { environment: { ...runtime.environment, DATABASE_URL: "postgresql://other_runtime:fixture@127.0.0.1:5432/jiangkong" } },
    { environment: { ...runtime.environment, DATABASE_URL: "postgresql://jiangkong_runtime:fixture@127.0.0.1:5432/jiangkong?options=-c%20role%3Dpostgres" } }
  ]) {
    assert.throws(() => assertProductionInspectionBoundary(source, { ...runtime, ...changed }),
      /PRODUCTION_RUNTIME_INVALID/u);
  }
  assert.throws(() => assertProductionInspectionBoundary({ environment: "isolated-test" }, runtime),
    /PRODUCTION_RUNTIME_INVALID/u);
  assert.throws(() => assertProductionInspectionBoundary({ environment: "staging" }, runtime),
    /PRODUCTION_RUNTIME_INVALID/u);
  assert.throws(() => assertProductionInspectionBoundary(source, { ...runtime,
    environment: { ...runtime.environment, DATABASE_URL: "invalid" } }),
  /PRODUCTION_RUNTIME_INVALID/u);
});
