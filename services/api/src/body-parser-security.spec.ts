import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// Resolve the same parser used by the production Nest Express adapter.
const platformRequire = createRequire(require.resolve("@nestjs/platform-express"));
const parserPath = platformRequire.resolve("body-parser");

// Run the HTTP server in a child so a vulnerable decoder can terminate normally
// with an uncaught stream error without taking down the Jest worker itself.
const childProgram = String.raw`
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const bodyParser = require(process.env.BODY_PARSER_MODULE);
const scenario = process.env.BODY_PARSER_SCENARIO;
const trailing = Buffer.alloc(1024, 0x58);
let delayedRequest;
const parser = bodyParser.json({ limit: 64 });
const server = http.createServer((request, response) => {
  parser(request, response, (error) => {
    if (error) {
      response.statusCode = error.status || 500;
      response.end(error.type);
      return;
    }
    const respond = () => response.end(JSON.stringify(request.body));
    if (scenario === 'deflate-trailing' && request.url === '/probe') {
      request.once('end', respond);
      delayedRequest.end(trailing);
    } else {
      respond();
    }
  });
});

function send(port, path, body, encoding, deferEnd = false) {
  return new Promise((resolve, reject) => {
    const headers = {
      'content-type': 'application/json',
      'content-length': body.length + (deferEnd ? trailing.length : 0)
    };
    if (encoding) headers['content-encoding'] = encoding;
    const request = http.request({ hostname: '127.0.0.1', port, path,
      method: 'POST', agent: false, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(1500, () => request.destroy(new Error('Local parser request timed out')));
    if (deferEnd) {
      delayedRequest = request;
      request.write(body);
    } else {
      request.end(body);
    }
  });
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let payload = Buffer.from('{"accepted":true}');
  let encoding;
  if (scenario === 'gzip' || scenario === 'gzip-trailing') {
    payload = zlib.gzipSync(payload);
    encoding = 'gzip';
    if (scenario === 'gzip-trailing') {
      payload = Buffer.concat([payload, Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
    }
  } else if (scenario === 'deflate-trailing') {
    payload = Buffer.concat([zlib.deflateSync(payload), Buffer.from([0])]);
    encoding = 'deflate';
  } else if (scenario === 'invalid') {
    payload = Buffer.from('{broken');
  } else if (scenario === 'oversized') {
    payload = Buffer.from(JSON.stringify({ value: 'x'.repeat(100) }));
  }
  try {
    const response = await send(port, '/probe', payload, encoding, scenario === 'deflate-trailing');
    // Late decoder errors happen after the first response has already completed.
    await new Promise(resolve => setTimeout(resolve, 200));
    const followup = await send(port, '/followup', Buffer.from('{"stillAlive":true}'));
    assert.equal(followup.status, 200);
    assert.equal(followup.body, '{"stillAlive":true}');
    process.stdout.write(JSON.stringify({ response, followup }));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
`;

function runParserScenario(scenario: string) {
  const result = spawnSync(process.execPath, ["-e", childProgram], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 16 * 1024,
    env: {
      NODE_ENV: "test",
      BODY_PARSER_MODULE: parserPath,
      BODY_PARSER_SCENARIO: scenario
    }
  });
  expect({ exitCode: result.status, signal: result.signal, error: result.error?.message,
    stderr: result.stderr }).toEqual({ exitCode: 0, signal: null, error: undefined, stderr: "" });
  return JSON.parse(result.stdout) as {
    response: { status: number; body: string };
    followup: { status: number; body: string };
  };
}

describe("production body-parser compressed request security", () => {
  // GHSA-27r3-jxmh-p828: complete compressed frames may finish before the HTTP
  // request; remaining bytes must not reach an unobserved, finished decoder.
  it.each(["gzip-trailing", "deflate-trailing"])(
    "keeps the server alive after %s and serves a subsequent request",
    (scenario) => {
      expect(runParserScenario(scenario).response).toEqual({
        status: 200, body: '{"accepted":true}'
      });
    }
  );

  it.each(["json", "gzip"])("still parses valid %s requests", (scenario) => {
    expect(runParserScenario(scenario).response).toEqual({ status: 200, body: '{"accepted":true}' });
  });

  it.each([
    ["invalid", 400, "entity.parse.failed"],
    ["oversized", 413, "entity.too.large"]
  ] as const)("still rejects %s request bodies", (scenario, status, body) => {
    expect(runParserScenario(scenario).response).toEqual({ status, body });
  });
});
