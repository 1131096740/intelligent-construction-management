"use strict";
const http = require("node:http");

// Task-owned synthetic HTTP fault boundary; it makes no database/commit claim.
async function startResponseLossProxy(options = {}) {
  const configurationError = () => Object.assign(new Error("PROXY_CONFIGURATION_INVALID"), { code: "PROXY_CONFIGURATION_INVALID" });
  if (!options || typeof options !== "object" || Array.isArray(options)) throw configurationError();
  let { upstreamUrl, drop, host = "127.0.0.1", maxRequestBytes = 1024 * 1024, maxResponseBytes = 1024 * 1024, deadlineMs = 2000 } = options;
  if (typeof upstreamUrl !== "string" || !/^http:\/\/(127\.0\.0\.1|\[::1\]):[0-9]{1,5}\/?$/u.test(upstreamUrl) || !["127.0.0.1", "::1"].includes(host)) throw configurationError();
  let upstream;
  try { upstream = new URL(upstreamUrl); } catch { throw configurationError(); }
  if (Number(upstream.port || 80) < 1) throw configurationError();
  if (![maxRequestBytes, maxResponseBytes].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16 * 1024 * 1024) || !Number.isSafeInteger(deadlineMs) || deadlineMs < 10 || deadlineMs > 30000) throw configurationError();
  if (drop !== undefined) {
    if (!drop || typeof drop !== "object" || !/^[A-Z]{1,16}$/u.test(drop.method) || ["CONNECT", "TRACE"].includes(drop.method) || typeof drop.path !== "string" || !drop.path.startsWith("/") || drop.path.startsWith("//") || /[\\\x00-\x20\x7f#]/u.test(drop.path) || drop.path.length > 2048 || typeof drop.requestId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(drop.requestId)) throw configurationError();
    drop = Object.freeze({ method: drop.method, path: drop.path, requestId: drop.requestId });
  }
  const sockets = new Set();
  const active = new Set();
  let closePromise;
  let dropState = drop ? "armed" : "disabled";
  let faultError = null;
  let upstreamStatusCode = null;
  const server = http.createServer((req, res) => {
    const requestChunks = [];
    let size = 0;
    let done = false;
    let outgoing;
    let loseResponse = false;
    const abort = () => { done = true; clearTimeout(timer); active.delete(abort); if (loseResponse) { dropState = "failed"; faultError = "PROXY_CLOSED"; } outgoing?.destroy(); res.destroy(); };
    active.add(abort);
    const timer = setTimeout(() => fail(504, "PROXY_DEADLINE_EXCEEDED"), deadlineMs);
    function fail(status, code) {
      if (done) return;
      done = true;
      active.delete(abort);
      clearTimeout(timer);
      requestChunks.length = 0;
      if (loseResponse) { dropState = "failed"; faultError = code; }
      outgoing?.destroy();
      if (!res.destroyed) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: code })); }
    }
    if (!req.url.startsWith("/") || req.url.startsWith("//") || /[\\\x00-\x20\x7f]/u.test(req.url)) { fail(400, "PROXY_REQUEST_TARGET_INVALID"); req.resume(); return; }
    req.on("error", () => fail(400, "PROXY_REQUEST_FAILED"));
    req.on("data", chunk => {
      if (done) return;
      size += chunk.length;
      if (size > maxRequestBytes) fail(413, "PROXY_REQUEST_TOO_LARGE");
      else requestChunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      loseResponse = dropState === "armed" && req.method === drop.method && req.url === drop.path && req.headers["x-jg-task01-synthetic-request-id"] === drop.requestId;
      if (loseResponse) dropState = "pending";
      outgoing = http.request({ hostname: upstream.hostname.replace(/^\[|\]$/gu, ""), port: upstream.port || 80, path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host }, agent: false }, incoming => {
        const chunks = [];
        let responseSize = 0;
        incoming.on("data", chunk => {
          if (done) return;
          responseSize += chunk.length;
          if (responseSize > maxResponseBytes) { chunks.length = 0; fail(502, "PROXY_RESPONSE_TOO_LARGE"); }
          else chunks.push(chunk);
        });
        incoming.once("error", () => fail(502, "PROXY_UPSTREAM_FAILED"));
        incoming.once("end", () => {
          if (done) return;
          done = true;
          active.delete(abort);
          clearTimeout(timer);
          if (loseResponse) { dropState = "dropped"; upstreamStatusCode = incoming.statusCode; res.destroy(); return; }
          if (!res.destroyed) { res.writeHead(incoming.statusCode, incoming.headers); res.end(Buffer.concat(chunks)); }
        });
      });
      outgoing.once("error", () => fail(502, "PROXY_UPSTREAM_FAILED"));
      outgoing.end(Buffer.concat(requestChunks));
      requestChunks.length = 0;
    });
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.maxConnections = 16;
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(Object.assign(new Error("PROXY_LISTEN_FAILED"), { code: "PROXY_LISTEN_FAILED" })));
    server.listen(0, host, resolve);
  });
  return {
    url: `http://${host === "::1" ? "[::1]" : host}:${server.address().port}`,
    getStatus() { return Object.freeze({ faultState: dropState, faultError, upstreamStatusCode, closed: Boolean(closePromise) }); },
    close() {
      if (!closePromise) {
        closePromise = new Promise(resolve => server.close(resolve));
        for (const abort of active) abort();
        for (const socket of sockets) socket.destroy();
      }
      return closePromise;
    }
  };
}
module.exports = { startResponseLossProxy };
