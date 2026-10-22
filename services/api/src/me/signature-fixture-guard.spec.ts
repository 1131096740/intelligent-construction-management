// This guard has no database connection; every rejection precedes Prisma setup.
const { assertSyntheticSignatureDatabase } = require("../../prisma/signature-fixture-guard.cjs");

describe("signature fixture database isolation", () => {
  const config = { runId: "123456abcdef", container: "jgzg-signature-acceptance-123456abcdef", url: "postgresql://synthetic:secret@127.0.0.1:49321/postgres" };
  const context = [{ Endpoints: { docker: { Host: "unix:///synthetic.sock" } } }];
  const actual = { Name: "/" + config.container, State: { Running: true },
    Config: { Image: "postgres:16", Labels: { "io.jiangkong.synthetic-signature": config.runId } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "49321" }] } } };
  function runner(value: unknown = actual, endpoint: unknown = context) {
    return jest.fn((_cmd: string, args: string[]) => JSON.stringify(args[0] === "context" ? endpoint : [value]));
  }
  it("accepts the actual labelled running local container with exact port mapping", () => {
    expect(() => assertSyntheticSignatureDatabase(config, runner())).not.toThrow();
  });
  it.each([
    ["remote database", { ...config, url: config.url.replace("127.0.0.1", "example.com") }],
    ["connection host override", { ...config, url: config.url + "?host=example.com" }],
    ["existing restored database", { ...config, container: "jgzg-ready-restore31" }],
    ["missing run identity", { ...config, runId: undefined }],
    ["forwarded loopback port", { ...config, url: config.url.replace("49321", "49322") }]
  ])("rejects %s before caller can write", (_name, candidate) => {
    const writes = jest.fn();
    expect(() => { assertSyntheticSignatureDatabase(candidate, runner()); writes(); }).toThrow("仅允许本轮专用合成签名数据库");
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([
    { ...actual, State: { Running: false } },
    { ...actual, Config: { ...actual.Config, Labels: {} } },
    { ...actual, Config: { ...actual.Config, Image: "other-image" } },
    { ...actual, NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "49321" }] } } }
  ])("rejects unverified container state", value => {
    expect(() => assertSyntheticSignatureDatabase(config, runner(value))).toThrow();
  });
  it("rejects remote Docker and failed inspection without exposing credentials", () => {
    expect(() => assertSyntheticSignatureDatabase(config, runner(actual, [{ Endpoints: { docker: { Host: "tcp://example.com" } } }]))).toThrow();
    expect(() => assertSyntheticSignatureDatabase(config, () => { throw new Error(config.url); })).toThrow("仅允许本轮专用合成签名数据库");
  });
});
