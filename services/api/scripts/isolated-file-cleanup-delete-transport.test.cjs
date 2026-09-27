"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createOneShotVersionDeleteFetch } = require("./isolated-file-cleanup-delete-transport.cjs");

const target = { bucket: "private-prod-123", region: "ap-guangzhou",
  objectKey: "archives/one.pdf", versionId: "version-1" };
const requestUrl = `https://${target.bucket}.cos.${target.region}.myqcloud.com/archives/one.pdf?versionid=version-1`;
const requestOptions = { method: "DELETE", headers: {
  Authorization: "COS signed fixture", Host: `${target.bucket}.cos.${target.region}.myqcloud.com`
} };

test("精确单版本 DELETE 只发一次并保留 COS 签名对应的小写 query", async () => {
  const seen = [];
  const fetchImpl = createOneShotVersionDeleteFetch(target, async (input, init) => {
    seen.push({ input: String(input), init });
    return new Response(null, { status: 204 });
  });
  const response = await fetchImpl(requestUrl, requestOptions);
  assert.equal(response.status, 204);
  assert.equal(seen.length, 1);
  assert.equal(new URL(seen[0].input).searchParams.get("versionId"), target.versionId);
  assert.equal(seen[0].init.method, "DELETE");
  assert.equal(seen[0].init.redirect, "error");
  assert.ok(seen[0].init.signal instanceof AbortSignal);
  await assert.rejects(fetchImpl(requestUrl, requestOptions), /DELETE_TRANSPORT_BOUNDARY/u);
  assert.equal(seen.length, 1);
});

test("host、key、版本、方法、签名头或额外查询漂移均零请求", async () => {
  for (const [url, init] of [
    [requestUrl.replace(target.bucket, "private-other"), requestOptions],
    [requestUrl.replace("one.pdf", "two.pdf"), requestOptions],
    [requestUrl.replace("version-1", "version-2"), requestOptions],
    [`${requestUrl}&prefix=archives`, requestOptions],
    [requestUrl, { ...requestOptions, method: "GET" }],
    [requestUrl, { ...requestOptions, headers: { Host: requestOptions.headers.Host } }],
    [requestUrl, { ...requestOptions, headers: { ...requestOptions.headers, Host: "private-other.cos.ap-guangzhou.myqcloud.com" } }]
  ]) {
    let calls = 0;
    const fetchImpl = createOneShotVersionDeleteFetch(target, async () => { calls += 1; return new Response(null, { status: 204 }); });
    await assert.rejects(fetchImpl(url, init), /DELETE_TRANSPORT_BOUNDARY/u);
    assert.equal(calls, 0);
  }
});

test("DELETE 响应不确定或非 204 不重试", async () => {
  for (const response of [new Response(null, { status: 404 }), new Response(null, { status: 302 }), new Error("network")]) {
    let calls = 0;
    const fetchImpl = createOneShotVersionDeleteFetch(target, async () => {
      calls += 1;
      if (response instanceof Error) throw response;
      return response;
    });
    await assert.rejects(fetchImpl(requestUrl, requestOptions));
    await assert.rejects(fetchImpl(requestUrl, requestOptions), /DELETE_TRANSPORT_BOUNDARY/u);
    assert.equal(calls, 1);
  }
});
