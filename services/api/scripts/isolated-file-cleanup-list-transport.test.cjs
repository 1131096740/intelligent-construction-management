"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { boundedCosFetch } = require("./isolated-file-cleanup.cjs");

test("版本枚举传输只允许已批准对象键的签名精确前缀请求", async () => {
  const previousBucket = process.env.COS_BUCKET;
  const previousRegion = process.env.COS_REGION;
  process.env.COS_BUCKET = "private-local";
  process.env.COS_REGION = "ap-test";
  const requests = [];
  const host = "private-local.cos.ap-test.myqcloud.com";
  const request = async url => {
    requests.push(url.href);
    return new Response("<ListVersionsResult><IsTruncated>false</IsTruncated></ListVersionsResult>", { status: 200 });
  };
  const makeUrl = search => `https://${host}/?${search}`;
  const init = { method: "GET", headers: { Authorization: "q-sign-algorithm=sha1", Host: host } };
  try {
    const fetchExact = boundedCosFetch("archive/one.pdf", request);
    for (const search of ["versions&prefix=archive%2Fother.pdf&max-keys=1000",
      "versions&prefix=archive%2Fone.pdf&prefix=archive%2Fother.pdf&max-keys=1000",
      "versions&prefix=archive%2Fone.pdf&max-keys=1000&delimiter=%2F",
      "versions&prefix=archive%2Fone.pdf&max-keys=1001",
      "versions&prefix=archive%2Fone.pdf&max-keys=1000&key-marker=archive%2Fone.pdf",
      "versions&prefix=archive%2Fone.pdf&max-keys=1000&key-marker=archive%2Fother.pdf&version-id-marker=old-v1"]) {
      await assert.rejects(fetchExact(makeUrl(search), init), /COS_REQUEST_BOUNDARY/u);
    }
    await assert.rejects(fetchExact(makeUrl("versions&prefix=archive%2Fone.pdf&max-keys=1000"),
      { ...init, headers: { Host: host } }), /COS_REQUEST_BOUNDARY/u);
    assert.equal(requests.length, 0);
    const result = await fetchExact(makeUrl("versions&prefix=archive%2Fone.pdf&max-keys=1000"), init);
    assert.equal(result.status, 200);
    const paged = await fetchExact(makeUrl("versions&prefix=archive%2Fone.pdf&max-keys=1000&key-marker=archive%2Fone.pdf&version-id-marker=old-v1"), init);
    assert.equal(paged.status, 200);
    assert.equal(requests.length, 2);
  } finally {
    if (previousBucket === undefined) delete process.env.COS_BUCKET;
    else process.env.COS_BUCKET = previousBucket;
    if (previousRegion === undefined) delete process.env.COS_REGION;
    else process.env.COS_REGION = previousRegion;
  }
});
