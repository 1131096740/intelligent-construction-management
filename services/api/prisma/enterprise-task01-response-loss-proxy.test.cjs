"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { startResponseLossProxy } = require("./enterprise-task01-response-loss-proxy.cjs");

async function serverFixture(t, handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { const closed = new Promise(resolve => server.close(resolve)); for (const socket of sockets) socket.destroy(); await closed; });
  return `http://127.0.0.1:${server.address().port}`;
}
function request(url, { method = "GET", body = "", headers = {}, onHeaders = () => {}, path } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, agent: false, ...(path === undefined ? {} : { path }) }, res => {
      onHeaders(res);
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.once("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.once("error", reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error("TEST_REQUEST_TIMEOUT")));
    req.once("error", reject);
    req.end(body);
  });
}

test("normal loopback requests relay method, body, status and response without retry", async t => {
  let calls = 0;
  const upstream = await serverFixture(t, (req, res) => {
    calls++;
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => { res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ method: req.method, body })); });
  });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream });
  t.after(() => proxy.close());
  const result = await request(`${proxy.url}/synthetic`, { method: "POST", body: "synthetic-only" });
  assert.equal(result.status, 201);
  assert.deepEqual(JSON.parse(result.body), { method: "POST", body: "synthetic-only" });
  assert.equal(calls, 1);
});

test("one exact synthetic response is lost only after upstream completes; caller replay relays normally", async t => {
  const seen = [];
  let completed = 0;
  const upstream = await serverFixture(t, (req, res) => {
    if (req.url === "/observations") { res.end(JSON.stringify({ seen, completed })); return; }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      seen.push({ method: req.method, path: req.url, body });
      res.writeHead(201, { "content-type": "application/json" });
      res.write('{"synthetic":');
      setTimeout(() => { res.end('true}'); }, 20);
      res.once("finish", () => { completed++; });
    });
  });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, drop: { method: "POST", path: "/synthetic", requestId: "case-a" } });
  t.after(() => proxy.close());
  let headersReceived = false;
  const call = { method: "POST", body: '{"idempotencyKey":"same-synthetic-key"}', headers: { "x-jg-task01-synthetic-request-id": "case-a" }, onHeaders: () => { headersReceived = true; } };
  await assert.rejects(request(`${proxy.url}/synthetic`, call), { code: "ECONNRESET" });
  assert.equal(headersReceived, false);
  const beforeReplay = JSON.parse((await request(`${proxy.url}/observations`)).body);
  assert.equal(beforeReplay.completed, 1);
  assert.deepEqual(beforeReplay.seen, [{ method: "POST", path: "/synthetic", body: '{"idempotencyKey":"same-synthetic-key"}' }]);
  const replay = await request(`${proxy.url}/synthetic`, call);
  assert.equal(replay.status, 201);
  assert.deepEqual(JSON.parse(replay.body), { synthetic: true });
  const afterReplay = JSON.parse((await request(`${proxy.url}/observations`)).body);
  assert.equal(afterReplay.completed, 2);
  assert.equal(afterReplay.seen.length, 2);
});

test("configuration refuses nonliteral loopback targets, credentials and nonloopback listeners", async () => {
  for (const options of [
    { upstreamUrl: "http://example.invalid:80" },
    { upstreamUrl: "http://127.0.0.1.evil.invalid:80" },
    { upstreamUrl: "http://localhost:80" },
    { upstreamUrl: "https://127.0.0.1:443" },
    { upstreamUrl: "http://name:secret@127.0.0.1:80" },
    { upstreamUrl: "http://127.0.0.1:80/path" },
    { upstreamUrl: "http://127.0.0.1:80", host: "0.0.0.0" }
  ]) {
    const outcome = await startResponseLossProxy(options).then(async proxy => { await proxy.close(); return "STARTED"; }, error => error.code);
    assert.equal(outcome, "PROXY_CONFIGURATION_INVALID");
  }
});

test("oversized requests fail before forwarding any business request", async t => {
  let calls = 0;
  const upstream = await serverFixture(t, (_req, res) => { calls++; res.end("accepted"); });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, maxRequestBytes: 4 });
  t.after(() => proxy.close());
  const response = await request(`${proxy.url}/synthetic`, { method: "POST", body: "private-body-too-long" });
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(response.body), { error: "PROXY_REQUEST_TOO_LARGE" });
  assert.equal(calls, 0);
});

test("oversized upstream responses return a stable error and never rearm a consumed fault", async t => {
  let calls = 0;
  const upstream = await serverFixture(t, (_req, res) => { calls++; res.end(calls === 1 ? "private-upstream-response" : "ok"); });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, maxResponseBytes: 4, drop: { method: "POST", path: "/synthetic", requestId: "case-limit" } });
  t.after(() => proxy.close());
  const call = { method: "POST", headers: { "x-jg-task01-synthetic-request-id": "case-limit" } };
  const failed = await request(`${proxy.url}/synthetic`, call);
  assert.equal(failed.status, 502);
  assert.deepEqual(JSON.parse(failed.body), { error: "PROXY_RESPONSE_TOO_LARGE" });
  assert.equal((await request(`${proxy.url}/synthetic`, call)).body, "ok");
  assert.equal(calls, 2);
});

test("a stalled upstream fails on the deadline without retry or a later dropped replay", async t => {
  let calls = 0;
  const upstream = await serverFixture(t, (_req, res) => {
    calls++;
    if (calls === 1) { const timer = setTimeout(() => res.end("too late"), 100); res.once("close", () => clearTimeout(timer)); }
    else res.end("caller replay");
  });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, deadlineMs: 25, drop: { method: "POST", path: "/synthetic", requestId: "timeout" } });
  t.after(() => proxy.close());
  const call = { method: "POST", headers: { "x-jg-task01-synthetic-request-id": "timeout" } };
  const failed = await request(`${proxy.url}/synthetic`, call);
  assert.equal(failed.status, 504);
  assert.deepEqual(JSON.parse(failed.body), { error: "PROXY_DEADLINE_EXCEEDED" });
  assert.equal((await request(`${proxy.url}/synthetic`, call)).body, "caller replay");
  assert.equal(calls, 2);
});

test("explicit close stops the owned listener and active upstream sockets and is repeatable", async t => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let upstreamClosed;
  const ended = new Promise(resolve => { upstreamClosed = resolve; });
  const upstream = await serverFixture(t, (_req, res) => { res.once("close", upstreamClosed); started(); });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, deadlineMs: 200 });
  t.after(() => proxy.close());
  const pending = assert.rejects(request(`${proxy.url}/synthetic`), { code: "ECONNRESET" });
  await entered;
  await proxy.close();
  await pending;
  const closedPromptly = await Promise.race([ended.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50))]);
  assert.equal(closedPromptly, true);
  await proxy.close();
  await assert.rejects(request(`${proxy.url}/synthetic`), { code: "ECONNREFUSED" });
});

test("absolute request targets cannot change or escape the configured upstream boundary", async t => {
  let calls = 0;
  const upstream = await serverFixture(t, (_req, res) => { calls++; res.end("forwarded"); });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream });
  t.after(() => proxy.close());
  const response = await request(proxy.url, { path: "http://127.0.0.1:9/private?token=secret" });
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "PROXY_REQUEST_TARGET_INVALID" });
  assert.equal(calls, 0);
});

test("invalid limits or unscoped fault configuration fail closed before listening", async () => {
  for (const extra of [
    { maxRequestBytes: 0 }, { maxResponseBytes: Infinity }, { deadlineMs: 0 },
    { deadlineMs: 30001 }, { maxRequestBytes: 16 * 1024 * 1024 + 1 },
    { drop: { method: "POST", path: "/synthetic" } },
    { drop: { method: "POST", path: "//other", requestId: "case" } },
    { drop: { method: "post", path: "/synthetic", requestId: "case" } }
  ]) {
    const outcome = await startResponseLossProxy({ upstreamUrl: "http://127.0.0.1:80", ...extra }).then(async proxy => { await proxy.close(); return "STARTED"; }, error => error.code);
    assert.equal(outcome, "PROXY_CONFIGURATION_INVALID");
  }
});

test("fault scope requires exact method, path including query and synthetic marker", async t => {
  const upstream = await serverFixture(t, (_req, res) => res.end("normal"));
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, drop: { method: "POST", path: "/synthetic", requestId: "scope" } });
  t.after(() => proxy.close());
  const headers = { "x-jg-task01-synthetic-request-id": "scope" };
  assert.equal((await request(`${proxy.url}/synthetic`, { headers })).body, "normal");
  assert.equal((await request(`${proxy.url}/synthetic?other=1`, { method: "POST", headers })).body, "normal");
  assert.equal((await request(`${proxy.url}/synthetic`, { method: "POST", headers: { "x-jg-task01-synthetic-request-id": "other" } })).body, "normal");
  await assert.rejects(request(`${proxy.url}/synthetic`, { method: "POST", headers }), { code: "ECONNRESET" });
  assert.equal((await request(`${proxy.url}/synthetic`, { method: "POST", headers })).body, "normal");
});

test("concurrent matching callers cannot reserve more than one dropped response", async t => {
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  let finishFirst;
  let calls = 0;
  const upstream = await serverFixture(t, (_req, res) => {
    calls++;
    if (calls === 1) { finishFirst = () => res.end("first complete"); enter(); }
    else res.end("second complete");
  });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, drop: { method: "POST", path: "/synthetic", requestId: "concurrent" } });
  t.after(() => proxy.close());
  const call = { method: "POST", headers: { "x-jg-task01-synthetic-request-id": "concurrent" } };
  const first = assert.rejects(request(`${proxy.url}/synthetic`, call), { code: "ECONNRESET" });
  await entered;
  assert.equal((await request(`${proxy.url}/synthetic`, call)).body, "second complete");
  finishFirst();
  await first;
  assert.equal(calls, 2);
});

test("truncated upstream responses are reported as unknown failure without raw details or rearming", async t => {
  let calls = 0;
  const upstream = await serverFixture(t, (_req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(200, { "content-length": "100" }); res.write("private-token"); setImmediate(() => res.socket.destroy()); }
    else res.end("ok");
  });
  const proxy = await startResponseLossProxy({ upstreamUrl: upstream, drop: { method: "POST", path: "/synthetic", requestId: "broken" } });
  t.after(() => proxy.close());
  const call = { method: "POST", headers: { "x-jg-task01-synthetic-request-id": "broken" } };
  const failure = await request(`${proxy.url}/synthetic`, call);
  assert.equal(failure.status, 502);
  assert.deepEqual(JSON.parse(failure.body), { error: "PROXY_UPSTREAM_FAILED" });
  assert.equal((await request(`${proxy.url}/synthetic`, call)).body, "ok");
  assert.equal(calls, 2);
});
