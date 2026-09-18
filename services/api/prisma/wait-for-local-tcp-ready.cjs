#!/usr/bin/env node
"use strict";

const net = require("node:net");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function probeLocalTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForLocalTcpReady({
  host,
  port,
  attempts = 150,
  probe = probeLocalTcp,
  sleep = () => delay(200)
}) {
  if (host !== "127.0.0.1") throw new Error("TCP 就绪探针仅允许 127.0.0.1");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("TCP 就绪探针端口无效");
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("TCP 就绪探针次数无效");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await probe(host, port)) return;
    if (attempt < attempts) await sleep();
  }
  throw new Error(`本机端口未就绪：${host}:${port}`);
}

if (require.main === module) {
  const port = Number(process.argv[2]);
  waitForLocalTcpReady({ host: "127.0.0.1", port }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { probeLocalTcp, waitForLocalTcpReady };
