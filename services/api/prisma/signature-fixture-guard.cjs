const { execFileSync } = require("node:child_process");

// Run before constructing Prisma or writing files. A loopback URL alone may
// point at a restored business database or an SSH forward.
function assertSyntheticSignatureDatabase(config, run = execFileSync) {
  const deny = () => { throw new Error("仅允许本轮专用合成签名数据库"); };
  let url;
  try { url = new URL(config.url); } catch { return deny(); }
  if (!/^[a-f0-9]{12}$/.test(config.runId || "")
    || config.container !== `jgzg-signature-acceptance-${config.runId}`
    || !["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1" || url.pathname !== "/postgres" || !url.port
    || url.search || url.hash) deny();
  // Reject endpoint overrides before even inspecting Docker.
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) deny();
  const options = { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] };
  let context, container;
  try {
    context = JSON.parse(run("docker", ["context", "inspect"], options));
    container = JSON.parse(run("docker", ["inspect", "--type=container", config.container], options));
  } catch { return deny(); }
  if (!context[0]?.Endpoints?.docker?.Host?.startsWith("unix://")) deny();
  const actual = container[0];
  const ports = actual?.NetworkSettings?.Ports?.["5432/tcp"];
  if (actual?.Name !== `/${config.container}` || !actual?.State?.Running
    || actual?.Config?.Image !== "postgres:16"
    || actual?.Config?.Labels?.["io.jiangkong.synthetic-signature"] !== config.runId
    || ports?.length !== 1 || ports[0].HostIp !== "127.0.0.1" || ports[0].HostPort !== url.port) deny();
}

module.exports = { assertSyntheticSignatureDatabase };
