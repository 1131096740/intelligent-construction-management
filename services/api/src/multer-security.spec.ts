import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const platformRequire = createRequire(require.resolve("@nestjs/platform-express"));
const multerPath = platformRequire.resolve("multer");

// Exercise the real production parser in a child process: an unhandled stream
// error must fail the assertion below, rather than terminate the Jest worker.
const childProgram = String.raw`
const http = require("node:http");
const { getDefaultHighWaterMark } = require("node:stream");
const multer = require(process.argv[2]);
const scenario = process.argv[1];
let resumePendingFilter;
let nextCalls = 0;
const watchdog = setTimeout(() => {
  process.stderr.write("multipart scenario did not finish\n");
  process.exit(2);
}, 6000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: scenario === "limit" ? 4 : 256 * 1024 },
  fileFilter(request, file, callback) {
    if (scenario !== "late-filter") return callback(null, true);
    if (file.fieldname === "pending") {
      resumePendingFilter = callback;
      return;
    }
    const reject = () => setImmediate(() => callback(new Error("rejected upload")));
    if (request.readableEnded) reject();
    else request.once("end", reject);
  }
}).any();

function respond(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = http.createServer({ highWaterMark: 1024 * 1024 }, (request, response) => {
  if (request.url === "/health") return respond(response, 200, { alive: true });
  upload(request, response, error => {
    nextCalls++;
    if (scenario === "late-filter") {
      if (!error || error.message !== "rejected upload" || !resumePendingFilter) {
        throw new Error("the asynchronous rejection was not exercised");
      }
      respond(response, 400, { rejected: true });
      // Multer queued teardown before next(); resume after its listener removal.
      setImmediate(() => resumePendingFilter(null, true));
      return;
    }
    if (error) return respond(response, 400, { code: error.code });
    respond(response, 200, {
      note: request.body.note,
      files: request.files.map(file => ({
        name: file.originalname,
        content: file.buffer.toString("utf8"),
        size: file.size
      }))
    });
  });
});

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const call = http.request({ hostname: "127.0.0.1", port: address.port, method, path,
      headers, agent: false }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    call.on("error", reject);
    call.end(body);
  });
}

async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const boundary = "MulterSecurityBoundary";
  const parts = scenario === "late-filter"
    ? [
      "--" + boundary,
      'Content-Disposition: form-data; name="pending"; filename="pending.txt"',
      "Content-Type: text/plain", "", "a".repeat(getDefaultHighWaterMark(false) + 4096),
      "--" + boundary,
      'Content-Disposition: form-data; name="rejected"; filename="rejected.txt"',
      "Content-Type: text/plain", "", "b"
    ]
    : [
      "--" + boundary,
      'Content-Disposition: form-data; name="note"', "", "本地回归",
      "--" + boundary,
      'Content-Disposition: form-data; name="file"; filename="sample.txt"',
      "Content-Type: text/plain", "", scenario === "limit" ? "12345" : "hello",
      "--" + boundary + "--", ""
    ];
  // The failing request deliberately ends without the final multipart boundary.
  // A pending first filter and asynchronous rejection of the second reproduce
  // GHSA-q7qp-rjg7-q26m using HTTP, without replacing multer or busboy internals.
  const body = Buffer.from(parts.join("\r\n"));
  try {
    const result = await request("POST", "/upload", body, {
      "content-type": "multipart/form-data; boundary=" + boundary,
      "content-length": body.length
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    const health = await request("GET", "/health");
    process.stdout.write(JSON.stringify({ result, health, nextCalls }) + "\n");
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
  clearTimeout(watchdog);
  server.closeAllConnections();
  server.close();
});
`;

function runScenario(scenario: "late-filter" | "normal" | "limit") {
  const result = spawnSync(process.execPath, ["-e", childProgram, scenario, multerPath], {
    encoding: "utf8",
    env: { NODE_ENV: "test" },
    timeout: 8000,
    maxBuffer: 1024 * 1024
  });
  expect({
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stderr: result.stderr
  }).toEqual({ status: 0, signal: null, error: undefined, stderr: "" });
  return JSON.parse(result.stdout) as {
    result: { status: number; body: unknown };
    health: { status: number; body: { alive: boolean } };
    nextCalls: number;
  };
}

describe("production multer security and multipart compatibility", () => {
  it("survives a pending asynchronous file filter resuming after a rejected upload is torn down", () => {
    expect(runScenario("late-filter")).toEqual({
      result: { status: 400, body: { rejected: true } },
      health: { status: 200, body: { alive: true } },
      nextCalls: 1
    });
  });

  it("keeps multipart text fields and in-memory file bytes intact", () => {
    expect(runScenario("normal")).toEqual({
      result: { status: 200, body: { note: "本地回归", files: [{ name: "sample.txt", content: "hello", size: 5 }] } },
      health: { status: 200, body: { alive: true } },
      nextCalls: 1
    });
  });

  it("rejects an oversized file without losing service availability", () => {
    expect(runScenario("limit")).toEqual({
      result: { status: 400, body: { code: "LIMIT_FILE_SIZE" } },
      health: { status: 200, body: { alive: true } },
      nextCalls: 1
    });
  });
});
