"use strict";

const fs = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const { Script } = require("node:vm");

const fixture = process.argv[2];
const model = path.join(fixture, "model");
const command = new Script(fs.readFileSync(path.join(model, "command.cjs"), "utf8"));
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = Buffer.concat(chunks);
    let cursor = 0;
    function field() {
      const end = input.indexOf(0, cursor);
      if (end < 0) throw new Error("incomplete synthetic command");
      const value = input.toString("utf8", cursor, end);
      cursor = end + 1;
      return value;
    }
    const tool = field(), url = field(), pid = field(), count = Number(field());
    if (!["docker", "pnpm"].includes(tool) || !/^\d+$/u.test(pid) || !Number.isInteger(count) || count < 0 || count > 128) {
      throw new Error("invalid synthetic command header");
    }
    const args = Array.from({ length: count }, field);
    const stdout = [], stderr = [];
    const port = {
      argv: [process.execPath, path.join(model, tool), ...args],
      env: { DATABASE_URL: url },
      stdout: { write: value => stdout.push(value) },
      stderr: { write: value => stderr.push(value) },
      exitCode: 0
    };
    command.runInNewContext({
      __dirname: model, Buffer, URL, process: port,
      require: name => name === "node:fs" ? {
        ...fs, readFileSync: (file, ...options) => file === 0
          ? input.toString("utf8", cursor) : fs.readFileSync(file, ...options)
      } : require(name)
    });
    const receipt = path.join(fixture, `reply-${pid}`);
    if (stderr.length) fs.writeFileSync(receipt + ".stderr", stderr.join(""));
    fs.writeFileSync(receipt + ".status", `${port.exitCode}\n${stderr.length}\n`);
    response.end(stdout.join(""));
  } catch (error) {
    response.statusCode = 500;
    response.end();
    process.stderr.write(`${error.message}\n`);
  }
});
server.listen(path.join(model, "port.sock"), () => process.send("ready"));
process.on("disconnect", () => {
  server.close();
  server.closeAllConnections();
});
