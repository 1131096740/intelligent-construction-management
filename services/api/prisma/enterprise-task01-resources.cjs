"use strict";
// Prepared task01 test setup. No command runs on import. Live validation requires
// a separately approved, source-sealed driver; this module is not a CLI/runner.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash, randomUUID, X509Certificate } = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");
const { types } = require("node:util");
const TECHNICAL_LIFETIME = Symbol("current259 technical lifetime");
const FIRST_ROLLBACK_LIFETIME = Symbol("current259 first-rollback lifetime");
const FIRST_Q2_LIFETIME = Symbol("current259 first-Q2 lifetime");
const FIRST_Q2_TOPOLOGY = "UNVERIFIED_FIRST_Q2_LOOPBACK_TLS";
const NORMAL_LIFETIME = Symbol("current259 normal payment lifetime");
const RESPONSE_LOSS_LIFETIME = Symbol("current259 response loss lifetime");
const COMPETITION_LIFETIME = Symbol("current259 payment competition lifetime");
const VOUCHER_LIFETIME = Symbol("current259 payment competition voucher lifetime");
const DISCONNECT_RECOVERY_LIFETIME = Symbol("current259 disconnect recovery lifetime");
const ATTRIBUTION_GAP_LIFETIME = Symbol("current259 payment attribution gap lifetime");
const loopbackScenarios = new Map([
  [FIRST_ROLLBACK_LIFETIME, "cancel-commit"], [NORMAL_LIFETIME, "normal"], [RESPONSE_LOSS_LIFETIME, "response-loss"],
  [COMPETITION_LIFETIME, "competition"], [VOUCHER_LIFETIME, "competition-voucher"], [DISCONNECT_RECOVERY_LIFETIME, "disconnect-commit-recovery"], [ATTRIBUTION_GAP_LIFETIME, "attribution-gap"]
]);
const TECHNICAL_PURPOSE = "CURRENT259_TECHNICAL_MIGRATIONS_V1";

const ENDPOINT = "unix:///Users/leoyang/.docker/run/docker.sock";
const IMAGE = "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d";
const RUN_LABEL = "io.jiangkong.task01.run";
const TASK_LABEL = "io.jiangkong.task01.task";
const SOURCE_LABEL = "io.jiangkong.task01.source";
const OWNER = "jg_task01_owner";
const ROLES = [OWNER, "jg_task01_runtime", "jg_task01_observer"];
const CONTRACT_LOGINS = [
  "jg_c259_outside_issuer_login", "jg_c259_outside_executor_login",
  "jg_c259_upward_issuer_login", "jg_c259_upward_runtime_login"
];
const HBA_PATH = "/jg-task01/pg_hba.conf";
function hbaRules(database, roles, loopback = false) {
  return [
    ["local", "all", OWNER, null, "peer", ["map=jg_task01_init"]],
    ["local", "all", "all", null, "reject", []],
    ...["0.0.0.0", "::"].map(ip => ["hostnossl", "all", "all", ip, "reject", []]),
    ...roles.flatMap(role => (loopback ? ["127.0.0.1"] : ["0.0.0.0", "::"]).map(ip => ["hostssl", database, role, ip, "scram-sha-256", []])),
    ...["0.0.0.0", "::"].map(ip => ["hostssl", "all", "all", ip, "reject", []])
  ];
}
function renderHba(rules) {
  return rules.map(([type, database, role, ip, auth, options]) =>
    [type, database, role, ...(ip === null ? [] : [ip + (ip === "127.0.0.1" ? "/32" : "/0")]), auth, ...options].join(" ") + "\n").join("");
}
const hbaLoginSql = `WITH b AS (
  SELECT ARRAY[o."ordinaryApplicationRoleOid",o."issuerSessionOid",o."runtimeSessionOid",i."issuerSessionOid",e."runtimeSessionOid"] AS ids
  FROM public.jg_contract_direct_archive_intent_binding_v1 o
  JOIN public.jg_contract_direct_upward_issuer_binding_v2 i ON i."databaseOid"=o."databaseOid"
  JOIN public.jg_contract_direct_upward_execution_binding_v2 e ON e."databaseOid"=o."databaseOid" AND e."applicationRoleOid"=o."ordinaryApplicationRoleOid"
  WHERE o."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
)
SELECT pg_catalog.jsonb_agg(r.rolname ORDER BY x.pos)
FROM b CROSS JOIN LATERAL pg_catalog.unnest(b.ids) WITH ORDINALITY x(oid,pos)
JOIN pg_catalog.pg_authid r ON r.oid=x.oid
WHERE r.rolcanlogin AND r.rolconnlimit=CASE WHEN x.pos=1 THEN 4 ELSE 1 END AND r.rolvaliduntil IS NULL
  AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
  AND r.rolpassword LIKE 'SCRAM-SHA-256$%';`;
const hbaProjectionSql = `SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(rule_number,line_number,
 file_name,type,database,user_name,address,netmask,auth_method,COALESCE(options,ARRAY[]::text[]),error) ORDER BY line_number)
FROM pg_catalog.pg_hba_file_rules;`;
const hbaWrite = `file=/jg-task01/pg_hba.conf
check() {
  test -f "$file"
  test ! -L "$file"
  test "$(stat -c '%u:%g:%a' "$file")" = "$(id -u):$(id -g):600"
  test "$(sha256sum "$file" | cut -d ' ' -f1)" = "$1"
}
check "$1"
before=$(stat -c '%d:%i' "$file")
tmp=$(mktemp /jg-task01/.contract-hba.XXXXXXXX)
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
cat > "$tmp"
test "$(sha256sum "$tmp" | cut -d ' ' -f1)" = "$2"
sync -f "$tmp"
check "$1"
test "$(stat -c '%d:%i' "$file")" = "$before"
mv -T "$tmp" "$file"
sync -f /jg-task01
check "$2"
test "$(stat -c '%d:%i' "$file")" != "$before"
printf '%s\n' "$2"`;
// Only a fresh server primary record for the explicit hostnossl reject
// counts. The role and database are selected by this owned resource.
function contractPlaintextReject(lines, role, database, loopback = false) {
  const logPrefix = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [A-Z0-9+-]+ \[([1-9][0-9]{0,9})\] /u;
  const start = `user=${role} db=${database} FATAL:  pg_hba.conf rejects connection for host "`;
  const end = `", user "${role}", database "${database}", no encryption`;
  return lines.split("\n").slice(0, -1).some(line => {
    const prefix = logPrefix.exec(line);
    if (!prefix || Number(prefix[1]) > 2147483647) return false;
    const record = line.slice(prefix[0].length);
    const peer = record.slice(start.length, -end.length);
    return record.startsWith(start) && record.endsWith(end) && (loopback ? peer === "127.0.0.1" : net.isIP(peer) !== 0);
  });
}
function contractPlaintextReadback(result, cursor, role, database, loopback = false) {
  requireThat(result.stdout.length >= cursor.stdoutBytes && result.stderr.length >= cursor.stderrBytes &&
    sha(result.stdout.subarray(0, cursor.stdoutBytes)) === cursor.stdoutSha256 &&
    sha(result.stderr.subarray(0, cursor.stderrBytes)) === cursor.stderrSha256,
    "TASK01_RESOURCE_CONTRACT_PLAINTEXT_WINDOW");
  return [[result.stdout, cursor.stdoutBytes], [result.stderr, cursor.stderrBytes]].some(([stream, offset]) =>
    (offset === 0 || stream[offset - 1] === 10) &&
    contractPlaintextReject(stream.subarray(offset).toString("utf8"), role, database, loopback));
}
const PGDATA = "/var/lib/postgresql/data";
const TMPFS = {
  [PGDATA]: "rw,nosuid,nodev,noexec,size=536870912,mode=0700",
  "/var/run/postgresql": "rw,nosuid,nodev,noexec,size=16777216,mode=0775",
  "/tmp": "rw,nosuid,nodev,noexec,size=67108864,mode=1777"
};
const sha = value => createHash("sha256").update(value).digest("hex");
const fault = code => Object.assign(new Error(code), { code });
const COMMAND_KINDS = new Set(["timeout", "aborted", "output-limit", "spawn-error", "signal-exit", "nonzero-exit"]);
const CURSOR_STAGES = new Set(["CURSOR_DAEMON", "CURSOR_OWNERSHIP", "CURSOR_LOG_READ"]);
const RELAY_CODE = /^CURRENT259_LOOPBACK_FORWARD_(?:ABORTED|CONFIG|LIMIT|CHILD|STREAM|FRAME|HALF_CLOSE_TIMEOUT|DEPLOY_DRAIN_TIMEOUT|DEPLOY_DRAIN_ACTIVE|LISTEN|CLOSED|CLEANUP)$/u;
const RELAY_CLOSE_FIELDS = ["hostFin", "stdinEnded", "pgFin", "stdoutEnded", "cliClosed",
  "stdoutRawEnd", "receiveSettled", "cliExited", "peerSocketDestroyed", "peerEndReturned"];
function ownErrorField(error, key) {
  if (!error || typeof error !== "object" || types.isProxy(error)) return undefined;
  return Object.getOwnPropertyDescriptor(error, key)?.value;
}
function copyRelayCloseState(target, error) {
  const source = ownErrorField(error, "relayCloseState");
  const state = Object.fromEntries(RELAY_CLOSE_FIELDS.map(key => [key, ownErrorField(source, key)]));
  if (Object.values(state).every(value => typeof value === "boolean"))
    Object.defineProperty(target, "relayCloseState", { value: Object.freeze(state) });
}
const requireThat = (condition, code) => { if (!condition) throw fault(code); };
const json = buffer => { try { return JSON.parse(buffer.toString("utf8")); } catch { throw fault("TASK01_RESOURCE_METADATA_INVALID"); } };

// Pure endpoint projection. The owned producer calls this lexical function
// after a fresh inspect; changing an exported function cannot replace it.
const endpointInvalid=()=>{throw Object.assign(new Error('CURRENT259_PHYSICAL_ENDPOINT_INVALID'),{code:'CURRENT259_PHYSICAL_ENDPOINT_INVALID'});};
const endpointNeed=ok=>{if(!ok)endpointInvalid();};
function endpointOwn(value,key){
 endpointNeed(value&&typeof value==='object'&&!types.isProxy(value));
 const d=Object.getOwnPropertyDescriptor(value,key);endpointNeed(d&&Object.hasOwn(d,'value'));return d.value;
}
function projectCurrent259PhysicalEndpoint(state,expected){
 endpointNeed(arguments.length===2);
 const containerId=endpointOwn(expected,'containerId'),networkId=endpointOwn(expected,'networkId'),databaseName=endpointOwn(expected,'databaseName'),publishedPort=endpointOwn(expected,'publishedPort');
 endpointNeed(/^[a-f0-9]{64}$/u.test(containerId)&&/^[a-f0-9]{64}$/u.test(networkId)&&/^jg_task01_[a-f0-9]{32}$/u.test(databaseName)&&Number.isInteger(publishedPort)&&publishedPort>1024&&publishedPort<=65535);
 endpointNeed(endpointOwn(state,'Id')===containerId&&endpointOwn(endpointOwn(state,'State'),'Running')===true);
 const settings=endpointOwn(state,'NetworkSettings'),ports=endpointOwn(settings,'Ports'),networks=endpointOwn(settings,'Networks');
 endpointNeed(!types.isProxy(ports)&&!types.isProxy(networks)&&Reflect.ownKeys(ports).length===1&&Reflect.ownKeys(networks).length===1);
 const published=endpointOwn(ports,'5432/tcp');endpointNeed(Array.isArray(published)&&!types.isProxy(published)&&published.length===1);
 const binding=endpointOwn(published,'0');endpointNeed(endpointOwn(binding,'HostIp')==='127.0.0.1'&&endpointOwn(binding,'HostPort')===String(publishedPort));
 const network=endpointOwn(networks,Reflect.ownKeys(networks)[0]),serverAddress=endpointOwn(network,'IPAddress');
 endpointNeed(endpointOwn(network,'NetworkID')===networkId&&endpointOwn(network,'GlobalIPv6Address')==='');
 endpointNeed(typeof serverAddress==='string'&&net.isIP(serverAddress)===4);
 const [a,b]=serverAddress.split('.').map(Number);endpointNeed(a===10||a===172&&b>=16&&b<=31||a===192&&b===168);
 return Object.freeze({containerId,networkId,databaseName,publishedHost:'127.0.0.1',publishedPort,serverAddress,serverPort:5432});
}

function literalDirectory(target, allowMissing = false) {
  requireThat(typeof target === "string" && path.isAbsolute(target) && path.normalize(target) === target, "TASK01_RESOURCE_PATH_INVALID");
  let current = path.parse(target).root;
  const parts = target.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    if (allowMissing && index === parts.length - 1 && !fs.existsSync(current)) return;
    const stat = fs.lstatSync(current);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), "TASK01_RESOURCE_PATH_INVALID");
  }
}

async function prepareTask01Postgres(options = {}, lifetime) {
  const scenario = loopbackScenarios.get(lifetime);
  const paymentLoopback = scenario !== undefined;
  const paymentTransport = paymentLoopback ? require("./task16-current259-payment-loopback.cjs").paymentLoopbackForScenario(scenario) : undefined;
  requireThat(!paymentLoopback || paymentTransport, "TASK01_RESOURCE_INPUT_INVALID");
  const firstQ2 = lifetime === FIRST_Q2_LIFETIME;
  const loopback = paymentLoopback || firstQ2;
  const topology = paymentTransport?.topology ?? (firstQ2 ? FIRST_Q2_TOPOLOGY : "UNVERIFIED_HOST_PUBLISHED_TLS");
  const technical = loopback || lifetime === TECHNICAL_LIFETIME;
  const { runId, sourceSha, artifactsDir, endpoint, daemonId, imageId, tools, deadlineMs = 900000, signal } = options;
  let ownerPassword = options.ownerPassword;
  requireThat(!loopback || signal && !types.isProxy(signal) && Object.getPrototypeOf(signal) === AbortSignal.prototype &&
    ["aborted", "addEventListener", "removeEventListener"].every(key => !Object.hasOwn(signal, key)) &&
    tools && !types.isProxy(tools) && Object.getOwnPropertyDescriptor(tools, "docker")?.value === "/Applications/Docker.app/Contents/Resources/bin/docker",
    "TASK01_RESOURCE_INPUT_INVALID");
  requireThat(typeof runId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(runId), "TASK01_RESOURCE_INPUT_INVALID");
  requireThat(typeof sourceSha === "string" && /^[0-9a-f]{40}$/u.test(sourceSha), "TASK01_RESOURCE_INPUT_INVALID");
  requireThat(endpoint === ENDPOINT && imageId === IMAGE && typeof daemonId === "string" && /^[A-Za-z0-9:-]{16,128}$/u.test(daemonId), "TASK01_RESOURCE_INPUT_INVALID");
  requireThat(typeof ownerPassword === "string" && /^[0-9a-f]{96}$/u.test(ownerPassword), "TASK01_RESOURCE_INPUT_INVALID");
  requireThat(Number.isSafeInteger(deadlineMs) && deadlineMs >= 1000 && (technical ? deadlineMs === 3600000 : deadlineMs <= 900000), "TASK01_RESOURCE_INPUT_INVALID");
  requireThat(tools && Object.keys(tools).sort().join(",") === "docker,openssl", "TASK01_RESOURCE_TOOL_INVALID");
  for (const name of ["docker", "openssl"]) {
    const executable = tools[name];
    requireThat(typeof executable === "string" && path.isAbsolute(executable) && fs.realpathSync(executable) === executable && path.basename(executable) === name && fs.statSync(executable).isFile(), "TASK01_RESOURCE_TOOL_INVALID");
    fs.accessSync(executable, fs.constants.X_OK);
  }
  requireThat(typeof artifactsDir === "string" && artifactsDir.startsWith("/private/tmp/") && artifactsDir !== "/private/tmp/", "TASK01_RESOURCE_PATH_INVALID");
  literalDirectory(artifactsDir, true);
  requireThat(!fs.existsSync(artifactsDir), "TASK01_RESOURCE_OUTPUT_EXISTS");
  const parent = fs.lstatSync(path.dirname(artifactsDir));
  requireThat(parent.uid === process.getuid() && (parent.mode & 0o077) === 0, "TASK01_RESOURCE_PARENT_NOT_PRIVATE");
  requireThat(!signal?.aborted, "TASK01_RESOURCE_ABORTED");
  fs.mkdirSync(artifactsDir, { mode: 0o700 });
  const privateDir = path.join(artifactsDir, "tls-private");
  fs.mkdirSync(privateDir, { mode: 0o700 });
  const dockerConfig = path.join(privateDir, "docker-config");
  fs.mkdirSync(dockerConfig, { mode: 0o700 });
  const bundle = path.join(privateDir, "bundle");
  fs.mkdirSync(bundle, { mode: 0o700 });
  const files = new Set();
  const children = new Set();
  const metadataSockets = new Set();
  const endAt = Date.now() + deadlineMs;
  let cleanupEndAt;
  let closePromise;
  let networkAttempted = false;
  let containerAttempted = false;
  let networkId = null;
  let containerId = null;
  let relay;
  let relayStartAttempted = false;
  const databaseName = `jg_task01_${runId.replaceAll("-", "")}`;
  const name = `jg-task01-${runId}`;
  const receipt = {
    runId, sourceSha, endpoint, daemonId, imageId, databaseName,
    ...(technical ? { purpose: TECHNICAL_PURPOSE } : {}),
    phase: "preparing", status: "preparing", containerName: name, containerId: null, networkId: null, port: null, attempts: { network: false, container: false },
    volumes: [], limits: { cpu: 2, memoryBytes: 1073741824, pids: 256, pgdataBytes: 536870912, totalDeadlineMs: deadlineMs },
    tls: null, requestedCertificateMode: "correct", reloadState: "not-requested", presentedCertificate: null,
    hostOwnerCredentialFilesErased: false, hostPrivateKeyFilesErased: false, hostPrivateMaterialsErased: false,
    topology,
    ...(loopback ? { relay: null } : {}), cleanup: { status: "pending" }
  };
  function getReceipt() { return JSON.parse(JSON.stringify(receipt)); }
  function persist() {
    const temporary = path.join(artifactsDir, "resource-manifest.pending");
    const target = path.join(artifactsDir, "resource-manifest.json");
    for (const file of [temporary, target]) requireThat(!fs.existsSync(file) || fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "TASK01_RESOURCE_RECEIPT_PATH_CHANGED");
    fs.writeFileSync(temporary, JSON.stringify(getReceipt(), null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temporary, target);
  }
  function writePrivate(file, contents) {
    fs.writeFileSync(file, contents, { flag: "wx", mode: 0o600 });
    files.add(file);
  }
  const clientEnvironment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", DOCKER_CONFIG: dockerConfig };

  function run(executable, args, { input, timeoutMs = 60000, cleanup = false, allowFailure = false } = {}) {
    const remaining = (cleanup ? cleanupEndAt : endAt) - Date.now();
    if (remaining <= 0 || !cleanup && signal?.aborted) return Promise.reject(fault(cleanup ? "TASK01_RESOURCE_CLEANUP_TIMEOUT" : "TASK01_RESOURCE_ABORTED_OR_TIMEOUT"));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { env: clientEnvironment, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
      children.add(child);
      const stdout = [], stderr = [];
      let bytes = 0, stopped = null, commandKind = null, killTimer;
      const stop = (code, kind) => {
        if (stopped) return;
        stopped = code;
        commandKind = kind;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      };
      const timer = setTimeout(() => stop("TASK01_RESOURCE_COMMAND_TIMEOUT", "timeout"), Math.min(timeoutMs, remaining));
      const onAbort = () => stop("TASK01_RESOURCE_ABORTED", "aborted");
      if (!cleanup) { signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) onAbort(); }
      for (const [stream, output] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) stop("TASK01_RESOURCE_OUTPUT_LIMIT", "output-limit");
        else if (!stopped) output.push(chunk);
      });
      child.once("error", () => {
        if (!stopped) { stopped = "TASK01_RESOURCE_COMMAND_FAILED"; commandKind = "spawn-error"; }
      });
      child.once("close", code => {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener("abort", onAbort);
        children.delete(child);
        if (stopped || code !== 0 && !allowFailure) {
          const error = fault(stopped || "TASK01_RESOURCE_COMMAND_FAILED");
          error.commandKind = commandKind || (code === null ? "signal-exit" : "nonzero-exit");
          reject(error);
        }
        else resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      });
      if (input !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(input); }
    });
  }
  const docker = (args, control) => run(tools.docker, ["--host", endpoint, ...args], control);
  async function verifyDaemon(cleanup = false) {
    const value = await docker(["info", "--format", "{{.ID}}"], { cleanup, timeoutMs: 10000 });
    requireThat(value.stdout.toString().trim() === daemonId, "TASK01_RESOURCE_DAEMON_CHANGED");
  }
  async function mutate(args, control = {}) { await verifyDaemon(Boolean(control.cleanup)); return docker(args, control); }
  const inspect = async (kind, id, cleanup = false) => json((await docker([kind, "inspect", "--format", "{{json .}}", id], { cleanup, timeoutMs: 10000 })).stdout);
  async function inspectNetwork(cleanup = false) {
    const value = await inspect("network", networkId, cleanup);
    requireThat(value.Id === networkId && value.Name === name && value.Internal === true && value.Driver === "bridge" && value.Labels?.[RUN_LABEL] === runId && value.Labels?.[TASK_LABEL] === "enterprise-task01" && value.Labels?.[SOURCE_LABEL] === sourceSha, "TASK01_RESOURCE_NETWORK_CHANGED");
    requireThat(Object.keys(value.Containers || {}).every(id => id === containerId), "TASK01_RESOURCE_NETWORK_OTHER_OWNER");
    return value;
  }
  async function inspectOwned(cleanup = false) {
    const value = await inspect("container", containerId, cleanup);
    requireThat(value.Id === containerId && value.Image === imageId && value.Name === `/${name}` && value.Config?.Labels?.[RUN_LABEL] === runId && value.Config?.Labels?.[TASK_LABEL] === "enterprise-task01" && value.Config?.Labels?.[SOURCE_LABEL] === sourceSha, "TASK01_RESOURCE_CONTAINER_CHANGED");
    const host = value.HostConfig;
    requireThat(host && host.NetworkMode === networkId && !host.Binds?.length && host.Memory === 1073741824 && host.MemorySwap === 1073741824 && host.NanoCpus === 2000000000 && host.PidsLimit === 256, "TASK01_RESOURCE_LIMITS_CHANGED");
    requireThat(JSON.stringify(Object.keys(host.Tmpfs || {}).sort()) === JSON.stringify(Object.keys(TMPFS).sort()) && Object.entries(TMPFS).every(([key, val]) => host.Tmpfs[key] === val), "TASK01_RESOURCE_MOUNTS_CHANGED");
    if (loopback) {
      const ports = value.NetworkSettings?.Ports;
      requireThat(host.PublishAllPorts === false && Object.keys(host.PortBindings || {}).length === 0 &&
        Object.keys(ports || {}).every(key => key === "5432/tcp" && ports[key] === null), "TASK01_RESOURCE_PORT_CHANGED");
    } else {
      requireThat(Object.keys(host.PortBindings || {}).join(",") === "5432/tcp" && host.PortBindings["5432/tcp"].length === 1 && host.PortBindings["5432/tcp"][0].HostIp === "127.0.0.1", "TASK01_RESOURCE_PORT_CHANGED");
    }
    for (const mount of value.Mounts || []) {
      requireThat(mount.Type === "tmpfs" && Object.hasOwn(TMPFS, mount.Destination) || mount.Type === "volume" && mount.Destination === PGDATA && /^[0-9a-f]{64}$/u.test(mount.Name), "TASK01_RESOURCE_MOUNTS_CHANGED");
      if (mount.Type === "volume" && !receipt.volumes.some(row => row.name === mount.Name)) {
        const metadata = await inspect("volume", mount.Name, cleanup);
        receipt.volumes.push({ name: metadata.Name, createdAt: metadata.CreatedAt, driver: metadata.Driver });
        persist();
        throw fault("TASK01_RESOURCE_UNEXPECTED_IMAGE_VOLUME");
      }
    }
    const networks = Object.values(value.NetworkSettings?.Networks || {});
    requireThat(networks.length === 1 && networks.every(network => network.NetworkID === networkId || !value.State?.Running && !network.NetworkID), "TASK01_RESOURCE_NETWORK_CHANGED");
    if (!loopback && receipt.port !== null && value.State?.Running) {
      const ports = value.NetworkSettings?.Ports;
      requireThat(Object.keys(ports || {}).join(",") === "5432/tcp" && ports["5432/tcp"]?.length === 1 && ports["5432/tcp"][0].HostIp === "127.0.0.1" && ports["5432/tcp"][0].HostPort === String(receipt.port), "TASK01_RESOURCE_PORT_CHANGED");
    }
    await inspectNetwork(cleanup);
    return value;
  }
  function relayFailure(error) {
    const failure = fault("TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED"), code = ownErrorField(error, "code");
    if (typeof code === "string" && RELAY_CODE.test(code)) Object.defineProperty(failure, "relayCode", { value: code });
    if (code === "CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT" || code === "CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT")
      copyRelayCloseState(failure, error);
    return failure;
  }
  function checkRelay() {
    if (!loopback || !relay) return;
    try { relay.check(); }
    catch (error) { throw relayFailure(error); }
  }
  function beginPrismaRelayDrain() {
    requireThat(arguments.length === 0 && loopback && relay && !closePromise, "TASK01_RESOURCE_CLOSED");
    let wait;
    try { wait = relay.beginPrismaDrain(); }
    catch (error) { throw relayFailure(error); }
    return async () => {
      try { await wait(); }
      catch (error) { throw relayFailure(error); }
    };
  }
  async function ownContainerExists(cleanup) {
    const result = await docker(["container", "ls", "--all", "--no-trunc", "--filter", `id=${containerId}`, "--format", "{{.ID}}"], { cleanup, timeoutMs: 10000 });
    const ids = result.stdout.toString().trim().split("\n").filter(Boolean);
    requireThat(ids.every(id => id === containerId), "TASK01_RESOURCE_CONTAINER_CHANGED");
    return ids.length === 1;
  }
  async function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      cleanupEndAt = Date.now() + 60000;
      receipt.cleanup = { status: "running" };
      let cleanupFailure = null;
      let journalFailure = false;
      let ownedResourcesAbsent = false;
      try { persist(); } catch { journalFailure = true; }
      let relayClosed = !relayStartAttempted;
      if (relay) {
        try { await relay.close(); relayClosed = true; }
        catch { cleanupFailure = "TASK01_RESOURCE_LOOPBACK_CLEANUP_UNKNOWN"; }
      } else if (!relayClosed) cleanupFailure = "TASK01_RESOURCE_LOOPBACK_CLEANUP_UNKNOWN";

      try {
        // This independent cleanup budget ignores the aborted execution signal.
        for (const socket of metadataSockets) socket.destroy();
        const pending = [...children];
        const killTimers = [];
        let waitTimer;
        try {
          await Promise.race([
            Promise.all(pending.map(child => new Promise(resolve => {
              child.once("close", resolve);
              child.kill("SIGTERM");
              killTimers.push(setTimeout(() => child.kill("SIGKILL"), 1000));
            }))),
            new Promise((_, reject) => { waitTimer = setTimeout(() => reject(fault("TASK01_RESOURCE_CHILD_REMAINS")), 3000); })
          ]);
        } finally { clearTimeout(waitTimer); for (const timer of killTimers) clearTimeout(timer); }
        await verifyDaemon(true);
        requireThat(!containerAttempted || containerId, "TASK01_RESOURCE_CONTAINER_ID_UNKNOWN");
        requireThat(!networkAttempted || networkId, "TASK01_RESOURCE_NETWORK_ID_UNKNOWN");
        if (containerId && await ownContainerExists(true)) {
          await inspectOwned(true);
          await mutate(["container", "rm", "--force", "--volumes", containerId], { cleanup: true, timeoutMs: 15000 });
        }
        if (containerId) requireThat(!await ownContainerExists(true), "TASK01_RESOURCE_CONTAINER_REMAINS");
        for (const volume of receipt.volumes) {
          const listed = (await docker(["volume", "ls", "--filter", `name=${volume.name}`, "--format", "{{.Name}}"], { cleanup: true, timeoutMs: 10000 })).stdout.toString().trim();
          if (!listed) continue;
          requireThat(listed === volume.name, "TASK01_RESOURCE_VOLUME_CHANGED");
          const value = await inspect("volume", volume.name, true);
          requireThat(value.Name === volume.name && value.CreatedAt === volume.createdAt && value.Driver === volume.driver, "TASK01_RESOURCE_VOLUME_CHANGED");
          const references = (await docker(["container", "ls", "--all", "--filter", `volume=${volume.name}`, "--format", "{{.ID}}"], { cleanup: true, timeoutMs: 10000 })).stdout.toString().trim();
          requireThat(!references, "TASK01_RESOURCE_VOLUME_REFERENCED");
          await mutate(["volume", "rm", volume.name], { cleanup: true, timeoutMs: 10000 });
          requireThat(!(await docker(["volume", "ls", "--filter", `name=${volume.name}`, "--format", "{{.Name}}"], { cleanup: true, timeoutMs: 10000 })).stdout.toString().trim(), "TASK01_RESOURCE_VOLUME_REMAINS");
        }
        if (networkId) {
          const listed = (await docker(["network", "ls", "--no-trunc", "--filter", `id=${networkId}`, "--format", "{{.ID}}"], { cleanup: true, timeoutMs: 10000 })).stdout.toString().trim();
          if (listed) {
            requireThat(listed === networkId, "TASK01_RESOURCE_NETWORK_CHANGED");
            const network = await inspectNetwork(true);
            requireThat(!Object.keys(network.Containers || {}).length, "TASK01_RESOURCE_NETWORK_REFERENCED");
            await mutate(["network", "rm", networkId], { cleanup: true, timeoutMs: 10000 });
          }
          requireThat(!(await docker(["network", "ls", "--no-trunc", "--filter", `id=${networkId}`, "--format", "{{.ID}}"], { cleanup: true, timeoutMs: 10000 })).stdout.toString().trim(), "TASK01_RESOURCE_NETWORK_REMAINS");
        }
        ownedResourcesAbsent = true;
      } catch (error) {
        cleanupFailure ||= typeof error.code === "string" && error.code.startsWith("TASK01_RESOURCE_") ? error.code : "TASK01_RESOURCE_CLEANUP_FAILED";
      }
      // Local secrets are discarded even when daemon/resource ownership fails.
      // Remove exact created files and empty directories only, never an unknown root.
      try {
        for (const file of [...files].reverse()) {
          if (fs.existsSync(file)) { requireThat(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "TASK01_RESOURCE_PRIVATE_PATH_CHANGED"); fs.unlinkSync(file); }
        }
        for (const directory of [bundle, dockerConfig, privateDir]) fs.rmdirSync(directory);
      } catch { cleanupFailure ||= "TASK01_RESOURCE_PRIVATE_CLEANUP_FAILED"; }
      if (journalFailure) cleanupFailure ||= "TASK01_RESOURCE_RECEIPT_WRITE_FAILED";
      const relayCleanup = loopback ? {
        relayClosed, relayId: receipt.relay?.id ?? null, containerAbsent: ownedResourcesAbsent,
        volumesAbsent: ownedResourcesAbsent, networkAbsent: ownedResourcesAbsent
      } : {};
      receipt.cleanup = cleanupFailure ? { status: "failed", code: cleanupFailure, ...relayCleanup }
        : { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true, ...relayCleanup };
      receipt.status = cleanupFailure ? "cleanup_failed" : "closed";
      try { persist(); } catch {
        receipt.cleanup = { status: "failed", code: "TASK01_RESOURCE_RECEIPT_WRITE_FAILED" };
        receipt.status = "cleanup_failed";
        throw fault("TASK01_RESOURCE_RECEIPT_WRITE_FAILED");
      }
      if (cleanupFailure) throw fault("TASK01_RESOURCE_CLEANUP_FAILED");
    })();
    return closePromise;
  }
  function safeOperation(operation) {
    return async (...args) => {
      try { return await operation(...args); }
      catch (error) {
        const code = ownErrorField(error, "code");
        const failure = fault(typeof code === "string" && code.startsWith("TASK01_RESOURCE_") ? code : "TASK01_RESOURCE_OPERATION_FAILED");
        if (paymentLoopback) {
          const commandKind = ownErrorField(error, "commandKind"), cursorStage = ownErrorField(error, "cursorStage"), relayCode = ownErrorField(error, "relayCode");
          if (COMMAND_KINDS.has(commandKind)) Object.defineProperty(failure, "commandKind", { value: commandKind });
          if (CURSOR_STAGES.has(cursorStage)) Object.defineProperty(failure, "cursorStage", { value: cursorStage });
          if (typeof relayCode === "string" && RELAY_CODE.test(relayCode)) Object.defineProperty(failure, "relayCode", { value: relayCode });
          if (relayCode === "CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT" || relayCode === "CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT")
            copyRelayCloseState(failure, error);
        }
        throw failure;
      }
    };
  }
  async function openssl(args, control) { return run(tools.openssl, args, control); }
  const material = file => path.join(privateDir, file);
  async function certificates() {
    writePrivate(material("openssl.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
    for (const prefix of ["ca", "wrong-ca", "server"]) {
      files.add(material(`${prefix}.key`));
      await openssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", material(`${prefix}.key`)]);
      fs.chmodSync(material(`${prefix}.key`), 0o600);
    }
    for (const prefix of ["ca", "wrong-ca"]) {
      files.add(material(`${prefix}.crt`));
      await openssl(["req", "-new", "-x509", "-sha256", "-days", "2", "-key", material(`${prefix}.key`), "-out", material(`${prefix}.crt`), "-subj", `/CN=jg-task01-${prefix}-${runId}`, "-config", material("openssl.cnf"), "-extensions", "v3_ca"]);
    }
    files.add(material("server.csr"));
    await openssl(["req", "-new", "-key", material("server.key"), "-out", material("server.csr"), "-subj", "/CN=jg-task01", "-config", material("openssl.cnf")]);
    for (const [prefix, ip, serial] of [["correct", "127.0.0.1", "1"], ["wrong-san", "127.0.0.2", "2"]]) {
      writePrivate(material(`${prefix}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${ip}\n`);
      files.add(material(`${prefix}.crt`));
      await openssl(["x509", "-req", "-in", material("server.csr"), "-CA", material("ca.crt"), "-CAkey", material("ca.key"), "-set_serial", serial, "-days", "2", "-sha256", "-extfile", material(`${prefix}.ext`), "-out", material(`${prefix}.crt`)]);
    }
    await openssl(["verify", "-CAfile", material("ca.crt"), "-verify_ip", "127.0.0.1", material("correct.crt")]);
    await openssl(["verify", "-CAfile", material("ca.crt"), "-verify_ip", "127.0.0.2", material("wrong-san.crt")]);
    const wrongSan = await openssl(["verify", "-CAfile", material("ca.crt"), "-verify_ip", "127.0.0.1", material("wrong-san.crt")], { allowFailure: true });
    const wrongCa = await openssl(["verify", "-CAfile", material("wrong-ca.crt"), material("correct.crt")], { allowFailure: true });
    requireThat(wrongSan.code !== 0 && wrongCa.code !== 0, "TASK01_RESOURCE_CERTIFICATE_NEGATIVE_FAILED");
    receipt.tls = {
      caSha256: sha(fs.readFileSync(material("ca.crt"))), wrongCaSha256: sha(fs.readFileSync(material("wrong-ca.crt"))),
      correctCertificateSha256: sha(fs.readFileSync(material("correct.crt"))), wrongSanCertificateSha256: sha(fs.readFileSync(material("wrong-san.crt"))),
      correctCertificateDerSha256: sha(new X509Certificate(fs.readFileSync(material("correct.crt"))).raw), wrongSanCertificateDerSha256: sha(new X509Certificate(fs.readFileSync(material("wrong-san.crt"))).raw),
      correctChainVerified: true, correctSanVerified: true, wrongCaChainRejected: true,
      wrongSanChainVerified: true, wrongSanMismatchVerified: true
    };
    const config = `data_directory='${PGDATA}'\nhba_file='/jg-task01/pg_hba.conf'\nident_file='/jg-task01/pg_ident.conf'\nlisten_addresses='${loopback ? '127.0.0.1' : '*'}'\nport=5432\nmax_connections=16\nshared_buffers='64MB'\nmax_wal_size='64MB'\nmin_wal_size='32MB'\nunix_socket_directories='/var/run/postgresql'\nssl=on\nssl_min_protocol_version='TLSv1.2'\nssl_cert_file='/jg-task01/server.crt'\nssl_key_file='/jg-task01/server.key'\npassword_encryption='scram-sha-256'\nlogging_collector=off\nlog_destination='stderr'\nlog_line_prefix='%m [%p] user=%u db=%d '\nlog_connections=on\nlog_disconnections=on\nlog_error_verbosity=terse\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length_on_error=0\nlog_min_duration_statement=-1\nlog_duration=off\nlc_messages='C'\nstatement_timeout='60s'\n`;
    const hba = renderHba(hbaRules(databaseName, ROLES, loopback));
    writePrivate(path.join(bundle, "postgresql.conf"), config);
    writePrivate(path.join(bundle, "pg_hba.conf"), hba);
    writePrivate(path.join(bundle, "pg_ident.conf"), `jg_task01_init postgres ${OWNER}\n`);
    writePrivate(path.join(bundle, "owner-password"), ownerPassword + "\n");
    writePrivate(path.join(bundle, "owner.pgpass"), `127.0.0.1:5432:${databaseName}:${OWNER}:${ownerPassword}\n`);
    writePrivate(path.join(bundle, "bootstrap.sh"), "#!/bin/sh\nset -eu\nchown -R postgres:postgres /jg-task01\nchmod 700 /jg-task01\nchmod 600 /jg-task01/server.key /jg-task01/owner-password /jg-task01/owner.pgpass\nexec /usr/local/bin/docker-entrypoint.sh postgres -c config_file=/jg-task01/postgresql.conf\n");
    for (const [source, destination] of [["ca.crt", "ca.crt"], ["correct.crt", "server.crt"], ["server.key", "server.key"]]) writePrivate(path.join(bundle, destination), fs.readFileSync(material(source)));
    receipt.configuration = { postgresSha256: sha(config), hbaSha256: sha(hba), localIdentityMapSha256: sha(`jg_task01_init postgres ${OWNER}\n`) };
    ownerPassword = null;
    persist();
  }
  function eraseHostPrivateMaterials() {
    const credentials = [path.join(bundle, "owner-password"), path.join(bundle, "owner.pgpass")];
    const keys = [material("ca.key"), material("wrong-ca.key"), material("server.key"), path.join(bundle, "server.key")];
    for (const file of [...credentials, ...keys]) {
      const stat = fs.lstatSync(file);
      requireThat(files.has(file) && stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "TASK01_RESOURCE_PRIVATE_PATH_CHANGED");
      fs.unlinkSync(file);
      files.delete(file);
      requireThat(!fs.existsSync(file), "TASK01_RESOURCE_PRIVATE_ERASURE_FAILED");
    }
    receipt.hostOwnerCredentialFilesErased = true;
    receipt.hostPrivateKeyFilesErased = true;
    receipt.hostPrivateMaterialsErased = true;
    persist();
  }
  function observeLeafOnce(mode) {
    const remaining = Math.min(2000, endAt - Date.now());
    requireThat(remaining > 0 && !signal?.aborted && !closePromise, "TASK01_RESOURCE_ABORTED_OR_TIMEOUT");
    checkRelay();
    // Public certificate metadata channel only. Deliberately no startup/auth/SQL
    // bytes are ever sent; business/role probes must independently verify TLS.
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: receipt.port });
      metadataSockets.add(socket);
      let secure, completed = false;
      const finish = (error, hash) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        secure?.destroy(); socket.destroy();
        if (error) reject(fault(error)); else resolve(hash);
      };
      const onAbort = () => finish("TASK01_RESOURCE_ABORTED");
      const timer = setTimeout(() => finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_TIMEOUT"), remaining);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      socket.once("close", () => { metadataSockets.delete(socket); if (!completed) finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED"); });
      socket.on("error", () => finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED"));
      socket.once("connect", () => {
        const request = Buffer.alloc(8); request.writeInt32BE(8, 0); request.writeInt32BE(80877103, 4);
        socket.write(request);
      });
      socket.once("data", data => {
        if (completed) return;
        if (data.length !== 1 || data[0] !== 83) { finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED"); return; }
        const tlsOptions = loopback ? {
          rejectUnauthorized: true, ca: fs.readFileSync(material("ca.crt")),
          checkServerIdentity: (_, cert) => tls.checkServerIdentity(mode === "correct" ? "127.0.0.1" : "127.0.0.2", cert)
        } : { rejectUnauthorized: false };
        secure = tls.connect({ socket, ...tlsOptions, minVersion: "TLSv1.2" }, () => {
          if (completed) return;
          try {
            const leaf = secure.getPeerCertificate(true)?.raw;
            if (!Buffer.isBuffer(leaf) || leaf.length === 0) finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED");
            else finish(null, sha(leaf));
          } catch { finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED"); }
        });
        metadataSockets.add(secure);
        secure.once("close", () => metadataSockets.delete(secure));
        secure.on("error", () => finish("TASK01_RESOURCE_CERTIFICATE_OBSERVATION_FAILED"));
      });
    });
  }
  async function observePresentedCertificate(mode = receipt.requestedCertificateMode) {
    requireThat(!closePromise && receipt.port !== null && ["correct", "wrong-san"].includes(mode) && mode === receipt.requestedCertificateMode, "TASK01_RESOURCE_CERTIFICATE_MODE_INVALID");
    const expected = mode === "correct" ? receipt.tls.correctCertificateDerSha256 : receipt.tls.wrongSanCertificateDerSha256;
    receipt.presentedCertificate = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await verifyDaemon(); await inspectOwned();
      let observed;
      try { observed = await observeLeafOnce(mode); }
      catch (error) { if (signal?.aborted || closePromise || Date.now() >= endAt) throw error; }
      if (observed === expected) {
        receipt.presentedCertificate = { mode, derSha256: observed, attempts: attempt };
        receipt.reloadState = "OBSERVED_PEER_CERTIFICATE_MATCHED"; persist();
        return { ...receipt.presentedCertificate };
      }
      if (attempt !== 5) await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw fault("TASK01_RESOURCE_CERTIFICATE_NOT_OBSERVED");
  }
  async function execOwnerSql(sql, phase) {
    requireThat(!closePromise && typeof sql === "string" && Buffer.byteLength(sql) <= 16 * 1024 * 1024 && typeof phase === "string" && /^[A-Za-z0-9._-]{1,128}$/u.test(phase), "TASK01_RESOURCE_SQL_INPUT_INVALID");
    await inspectOwned();
    const result = await mutate(["exec", "--interactive", "--user", "postgres", "--env", "PGPASSFILE=/jg-task01/owner.pgpass", "--env", "PGSSLMODE=verify-full", "--env", "PGSSLROOTCERT=/jg-task01/ca.crt", containerId, "psql", "--no-psqlrc", "--no-password", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align", "--host", "127.0.0.1", "--port", "5432", "--username", OWNER, "--dbname", databaseName, "--file", "-"], { input: sql, timeoutMs: 120000 });
    return { stdout: result.stdout.toString("utf8") };
  }
  let contractHbaAttempted = false, contractOrdinary, contractPlaintextStarted = false, contractPlaintextCursor;
  async function applyCurrent259ContractHbaV1() {
    requireThat(technical && !paymentLoopback && arguments.length === 0 && !contractHbaAttempted && !closePromise, "TASK01_RESOURCE_CONTRACT_HBA_UNAVAILABLE");
    contractHbaAttempted = true;
    const read = await execOwnerSql(hbaLoginSql, "contract-hba-roles");
    const logins = JSON.parse(read.stdout);
    requireThat(Array.isArray(logins) && logins.length === 5 && /^jg_fixture_app_[a-f0-9]{24}$/u.test(logins[0])
      && CONTRACT_LOGINS.every((name, index) => logins[index + 1] === name), "TASK01_RESOURCE_CONTRACT_HBA_ROLES");
    const rules = hbaRules(databaseName, [...ROLES, ...logins], firstQ2);
    const contents = renderHba(rules);
    const beforeSha256 = sha(renderHba(hbaRules(databaseName, ROLES, firstQ2)));
    const afterSha256 = sha(contents);
    requireThat(receipt.configuration.hbaSha256 === beforeSha256, "TASK01_RESOURCE_CONTRACT_HBA_PREIMAGE");
    await inspectOwned();
    const written = await mutate(["exec", "--interactive", "--user", "postgres", containerId, "sh", "-ceu", hbaWrite,
      "contract-hba", beforeSha256, afterSha256], { input: contents, timeoutMs: 10000 });
    requireThat(written.stdout.toString("utf8") === afterSha256 + "\n", "TASK01_RESOURCE_CONTRACT_HBA_FILE");
    const reload = await execOwnerSql("SELECT pg_catalog.pg_reload_conf();", "contract-hba-reload");
    requireThat(reload.stdout.trim() === "t", "TASK01_RESOURCE_CONTRACT_HBA_RELOAD");
    const parsed = JSON.parse((await execOwnerSql(hbaProjectionSql, "contract-hba-readback")).stdout);
    const expected = rules.map(([type, database, role, address, auth, options], index) =>
      [index + 1, index + 1, HBA_PATH, type, [database], [role], address, address === "127.0.0.1" ? "255.255.255.255" : address, auth, options, null]);
    requireThat(JSON.stringify(parsed) === JSON.stringify(expected), "TASK01_RESOURCE_CONTRACT_HBA_RULES");
    const file = await mutate(["exec", "--user", "postgres", containerId, "sha256sum", HBA_PATH], { timeoutMs: 10000 });
    requireThat(file.stdout.toString("utf8") === `${afterSha256}  ${HBA_PATH}\n`, "TASK01_RESOURCE_CONTRACT_HBA_FILE");
    const transition = { beforeSha256, afterSha256, rules: rules.length };
    receipt.contractHba = transition;
    persist();
    contractOrdinary = logins[0];
    return Object.freeze({ ...transition });
  }
  async function inspectConnectionEndpoint() {
    requireThat(arguments.length === 0 && !closePromise, "TASK01_RESOURCE_CLOSED");
    await verifyDaemon();
    const state = await inspectOwned();
    if (!loopback) return projectCurrent259PhysicalEndpoint(state, { containerId, networkId, databaseName, publishedPort: receipt.port });
    requireThat(state.State?.Running === true && relay && receipt.relay.port === relay.port, "TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED");
    checkRelay();
    return Object.freeze({ containerId, networkId, databaseName, transport: topology,
      relayId: receipt.relay.id, host: "127.0.0.1", port: relay.port, serverAddress: "127.0.0.1", serverPort: 5432 });
  }
  async function captureLogCursor() {
    requireThat(!closePromise, "TASK01_RESOURCE_CLOSED");
    let cursorStage = "CURSOR_DAEMON";
    try {
      await verifyDaemon();
      cursorStage = "CURSOR_OWNERSHIP"; await inspectOwned();
      cursorStage = "CURSOR_LOG_READ";
      const result = await docker(["logs", "--timestamps", containerId], { timeoutMs: 10000 });
      return Object.freeze({ runId, containerId, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length, stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr) });
    } catch (error) {
      if (paymentLoopback && error instanceof Error && !types.isProxy(error) && Object.isExtensible(error))
        Object.defineProperty(error, "cursorStage", { value: cursorStage });
      throw error;
    }
  }
  async function readPlaintextRejectionEvidence(cursor, target) {
    requireThat(!closePromise && cursor?.runId === runId && cursor?.containerId === containerId && ROLES.includes(target?.role) && target?.databaseName === databaseName && [cursor.stdoutBytes, cursor.stderrBytes].every(n => Number.isSafeInteger(n) && n >= 0), "TASK01_RESOURCE_LOG_WINDOW_INVALID");
    await verifyDaemon(); await inspectOwned();
    const result = await docker(["logs", "--timestamps", containerId], { timeoutMs: 10000 });
    requireThat(result.stdout.length >= cursor.stdoutBytes && result.stderr.length >= cursor.stderrBytes && sha(result.stdout.subarray(0, cursor.stdoutBytes)) === cursor.stdoutSha256 && sha(result.stderr.subarray(0, cursor.stderrBytes)) === cursor.stderrSha256, "TASK01_RESOURCE_LOG_WINDOW_CHANGED");
    const lines = Buffer.concat([result.stdout.subarray(cursor.stdoutBytes), result.stderr.subarray(cursor.stderrBytes)]).toString("utf8").split("\n");
    const matching = lines.some(line => (!loopback || line.includes('host "127.0.0.1"')) && line.includes("FATAL:") && line.includes("pg_hba.conf") && line.includes("no encryption") && line.includes(`user "${target.role}"`) && line.includes(`database "${databaseName}"`));
    return Object.freeze({ hbaNoEncryptionRejected: matching, roleMatched: matching, databaseMatched: matching });
  }
  async function verifyPaymentLoopbackPlaintextHba() {
    const cursor = await captureLogCursor();
    checkRelay();
    const remaining = Math.min(2000, endAt - Date.now());
    requireThat(remaining > 0 && !signal.aborted && !closePromise, "TASK01_RESOURCE_ABORTED_OR_TIMEOUT");
    const payload = Buffer.from(`user\0${OWNER}\0database\0${databaseName}\0\0`);
    const request = Buffer.alloc(8 + payload.length);
    request.writeUInt32BE(request.length); request.writeUInt32BE(196608, 4); payload.copy(request, 8);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: relay.port });
      metadataSockets.add(socket);
      let settled = false, response = Buffer.alloc(0);
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal.removeEventListener("abort", onAbort);
        if (ok) { socket.end(); resolve(); }
        else { socket.destroy(); reject(fault("TASK01_RESOURCE_LOOPBACK_PLAINTEXT_HBA")); }
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(onAbort, remaining);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      socket.once("error", onAbort);
      socket.once("close", () => { metadataSockets.delete(socket); onAbort(); });
      socket.once("connect", () => socket.write(request));
      socket.on("data", chunk => {
        if (settled) return;
        if (response.length + chunk.length > 4096) { finish(false); return; }
        response = Buffer.concat([response, chunk]);
        if (response[0] !== 69) { finish(false); return; }
        if (response.length >= 5) {
          const expected = response.readUInt32BE(1) + 1;
          if (expected < 6 || expected > 4096 || response.length > expected) finish(false);
          else if (response.length === expected) finish(true);
        }
      });
    });
    const evidence = await readPlaintextRejectionEvidence(cursor, { role: OWNER, databaseName });
    checkRelay();
    requireThat(evidence.hbaNoEncryptionRejected && evidence.roleMatched && evidence.databaseMatched,
      "TASK01_RESOURCE_LOOPBACK_PLAINTEXT_HBA");
    receipt.loopbackPlaintextHba = { sourceAddress: "127.0.0.1", role: OWNER, databaseName, noEncryptionRejected: true };
    persist();
  }
  async function beginCurrent259ContractPlaintextProbe() {
    requireThat(technical && arguments.length === 0 && contractOrdinary && !contractPlaintextStarted && !closePromise,
      "TASK01_RESOURCE_CONTRACT_PLAINTEXT_WINDOW");
    contractPlaintextStarted = true;
    contractPlaintextCursor = await captureLogCursor();
  }
  async function verifyCurrent259ContractPlaintextRejection() {
    const cursor = contractPlaintextCursor;
    requireThat(technical && arguments.length === 0 && contractOrdinary && cursor?.runId === runId &&
      cursor.containerId === containerId && !closePromise, "TASK01_RESOURCE_CONTRACT_PLAINTEXT_WINDOW");
    contractPlaintextCursor = undefined;
    await verifyDaemon(); await inspectOwned();
    const result = await docker(["logs", "--timestamps", containerId], { timeoutMs: 10000 });
    return contractPlaintextReadback(result, cursor, contractOrdinary, databaseName, firstQ2);
  }
  async function setServerCertificate(mode) {
    requireThat(!closePromise && ["correct", "wrong-san"].includes(mode), "TASK01_RESOURCE_CERTIFICATE_MODE_INVALID");
    await inspectOwned();
    const pid1 = (await docker(["exec", containerId, "cat", "/proc/1/comm"], { timeoutMs: 10000 })).stdout.toString().trim();
    requireThat(pid1 === "postgres", "TASK01_RESOURCE_PID1_INVALID");
    await mutate(["cp", material(`${mode}.crt`), `${containerId}:/jg-task01/server.crt`], { timeoutMs: 10000 });
    await mutate(["exec", "--user", "root", containerId, "chown", "postgres:postgres", "/jg-task01/server.crt"], { timeoutMs: 10000 });
    await mutate(["exec", "--user", "root", containerId, "chmod", "600", "/jg-task01/server.crt"], { timeoutMs: 10000 });
    await inspectOwned();
    requireThat((await docker(["exec", containerId, "cat", "/proc/1/comm"], { timeoutMs: 10000 })).stdout.toString().trim() === "postgres", "TASK01_RESOURCE_PID1_INVALID");
    receipt.requestedCertificateMode = mode; receipt.presentedCertificate = null;
    receipt.reloadState = "REQUESTED_NOT_YET_PROVEN_LOADED"; persist();
    await mutate(["kill", "--signal", "HUP", containerId], { timeoutMs: 10000 });
    return observePresentedCertificate(mode);
  }
  let startupStage = "private-configuration";
  try {
    writePrivate(path.join(dockerConfig, "config.json"), '{"auths":{}}\n');
    persist();
    startupStage = "daemon-and-image";
    await verifyDaemon();
    const image = await inspect("image", imageId);
    requireThat(image.Id === imageId && image.Config?.Env?.includes("PG_MAJOR=16") && image.Config?.Env?.includes(`PGDATA=${PGDATA}`), "TASK01_RESOURCE_IMAGE_CHANGED");
    startupStage = "certificates";
    await certificates();
    startupStage = "network-creation";
    receipt.phase = "creating-network"; networkAttempted = true; receipt.attempts.network = true; persist();
    networkId = (await mutate(["network", "create", "--internal", "--driver", "bridge", "--label", `${RUN_LABEL}=${runId}`, "--label", `${TASK_LABEL}=enterprise-task01`, "--label", `${SOURCE_LABEL}=${sourceSha}`, name])).stdout.toString().trim();
    requireThat(/^[0-9a-f]{64}$/u.test(networkId), "TASK01_RESOURCE_NETWORK_ID_UNKNOWN");
    receipt.networkId = networkId; persist(); await inspectNetwork();
    startupStage = "container-creation";
    receipt.phase = "creating-container"; containerAttempted = true; receipt.attempts.container = true; persist();
    containerId = (await mutate(["container", "create", "--pull=never", "--name", name, "--label", `${RUN_LABEL}=${runId}`, "--label", `${TASK_LABEL}=enterprise-task01`, "--label", `${SOURCE_LABEL}=${sourceSha}`, "--network", networkId, ...(loopback ? [] : ["--publish", "127.0.0.1::5432"]), "--cpus", "2", "--memory", "1g", "--memory-swap", "1g", "--pids-limit", "256", "--security-opt", "no-new-privileges:true", ...Object.entries(TMPFS).flatMap(([target, settings]) => ["--tmpfs", `${target}:${settings}`]), "--entrypoint", "/bin/sh", "--env", `POSTGRES_USER=${OWNER}`, "--env", `POSTGRES_DB=${databaseName}`, "--env", "POSTGRES_PASSWORD_FILE=/jg-task01/owner-password", "--env", "POSTGRES_INITDB_ARGS=--auth-local=peer --auth-host=scram-sha-256", imageId, "/jg-task01/bootstrap.sh"])).stdout.toString().trim();
    requireThat(/^[0-9a-f]{64}$/u.test(containerId), "TASK01_RESOURCE_CONTAINER_ID_UNKNOWN");
    receipt.containerId = containerId; persist(); await inspectOwned();
    startupStage = "bundle-install";
    await mutate(["cp", bundle, `${containerId}:/jg-task01`]);
    await inspectOwned();
    eraseHostPrivateMaterials();
    startupStage = "container-start";
    receipt.phase = "starting"; persist();
    await mutate(["container", "start", containerId]);
    startupStage = "postgres-readiness";
    const readyUntil = Math.min(endAt, Date.now() + 60000);
    let ready = false;
    while (Date.now() < readyUntil) {
      requireThat(!signal?.aborted, "TASK01_RESOURCE_ABORTED");
      const state = await inspectOwned();
      requireThat(state.State?.Running === true, "TASK01_RESOURCE_POSTGRES_STOPPED");
      const pid1 = (await docker(["exec", containerId, "cat", "/proc/1/comm"], { timeoutMs: 5000 })).stdout.toString().trim();
      if (pid1 === "postgres") {
        const probe = await docker(["exec", "--user", "postgres", containerId, "pg_isready", "--host", "127.0.0.1", "--username", OWNER, "--dbname", databaseName], { timeoutMs: 5000, allowFailure: true });
        if (probe.code === 0) { ready = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    requireThat(ready, "TASK01_RESOURCE_POSTGRES_NOT_READY");
    let port;
    if (loopback) {
      startupStage = "loopback-forward-start";
      await verifyDaemon(); await inspectOwned();
      relayStartAttempted = true;
      try {
        const { startCurrent259LoopbackForward } = require("./task16-current259-loopback-forward.cjs");
        relay = await startCurrent259LoopbackForward({ containerId, dockerConfig, signal });
      }
      catch { throw fault("TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED"); }
      port = relay.port;
      receipt.relay = { id: randomUUID(), containerId, host: "127.0.0.1", port };
      receipt.port = port;
      checkRelay(); persist();
    } else {
      startupStage = "published-port-probe";
      const published = (await docker(["port", containerId, "5432/tcp"], { timeoutMs: 10000 })).stdout.toString().trim();
      requireThat(/^127\.0\.0\.1:[0-9]{1,5}$/u.test(published), "TASK01_RESOURCE_PORT_CHANGED");
      port = Number(published.split(":")[1]); requireThat(port > 0 && port <= 65535, "TASK01_RESOURCE_PORT_CHANGED");
      startupStage = "published-port-inspect";
      const state = await inspectOwned();
      const ports = state.NetworkSettings?.Ports;
      requireThat(Object.keys(ports || {}).join(",") === "5432/tcp" && ports["5432/tcp"]?.length === 1 && ports["5432/tcp"][0].HostIp === "127.0.0.1" && ports["5432/tcp"][0].HostPort === String(port), "TASK01_RESOURCE_PORT_CHANGED");
      receipt.port = port;
    }
    startupStage = "presented-certificate";
    await observePresentedCertificate("correct");
    if (paymentLoopback) {
      startupStage = "loopback-plaintext-hba";
      await verifyPaymentLoopbackPlaintextHba();
    }
    receipt.phase = "ready-for-driver"; receipt.status = "started-awaiting-driver-verification"; persist();
    return { containerId, networkId, port, databaseName,
      ...(loopback ? { relayId: receipt.relay.id, checkRelay, beginPrismaRelayDrain } : {}), caPath: material("ca.crt"), wrongCaPath: material("wrong-ca.crt"), serverCertHashes: { caSha256: receipt.tls.caSha256, wrongCaSha256: receipt.tls.wrongCaSha256, correctCertificateSha256: receipt.tls.correctCertificateSha256, wrongSanCertificateSha256: receipt.tls.wrongSanCertificateSha256, correctCertificateDerSha256: receipt.tls.correctCertificateDerSha256, wrongSanCertificateDerSha256: receipt.tls.wrongSanCertificateDerSha256 }, observePresentedCertificate: safeOperation(observePresentedCertificate), ...(technical && !paymentLoopback ? { applyCurrent259ContractHbaV1: safeOperation(applyCurrent259ContractHbaV1),
      beginCurrent259ContractPlaintextProbe: safeOperation(beginCurrent259ContractPlaintextProbe),
      verifyCurrent259ContractPlaintextRejection: safeOperation(verifyCurrent259ContractPlaintextRejection) } : {}), execOwnerSql: safeOperation(execOwnerSql), inspectConnectionEndpoint: safeOperation(inspectConnectionEndpoint), setServerCertificate: safeOperation(setServerCertificate), captureLogCursor: safeOperation(captureLogCursor), readPlaintextRejectionEvidence: safeOperation(readPlaintextRejectionEvidence), getReceipt, close: safeOperation(close) };
  } catch (error) {
    receipt.phase = "failed"; receipt.status = "failed";
    const commandKind = ownErrorField(error, "commandKind");
    receipt.startupFailure = { stage: startupStage, commandKind: COMMAND_KINDS.has(commandKind) ? commandKind : null };
    receipt.failureCode = typeof error.code === "string" && error.code.startsWith("TASK01_RESOURCE_") ? error.code : "TASK01_RESOURCE_START_FAILED";
    try { await close(); } catch { receipt.status = "cleanup_failed"; }
    const failure = fault("TASK01_RESOURCE_START_FAILED"); failure.resourceReceipt = getReceipt(); throw failure;
  }
}

async function startTask01Postgres(options) {
  try { return await prepareTask01Postgres(options); }
  catch (error) {
    if (typeof error.code === "string" && error.code.startsWith("TASK01_RESOURCE_")) throw error;
    throw fault("TASK01_RESOURCE_INPUT_OR_PREPARATION_FAILED");
  }
}
async function startCurrent259FixedPostgres(options, lifetime) {
  // This second named route never accepts a caller-selected deadline or cap.
  requireThat(options && !types.isProxy(options) && Object.getPrototypeOf(options)===Object.prototype,"TASK01_RESOURCE_INPUT_INVALID");
  const descriptors=Object.getOwnPropertyDescriptors(options);
  const keys=["runId","sourceSha","artifactsDir","endpoint","daemonId","imageId","tools","ownerPassword","signal"];
  requireThat(Reflect.ownKeys(descriptors).every(key=>typeof key==="string"&&keys.includes(key)&&Object.hasOwn(descriptors[key],"value")),"TASK01_RESOURCE_INPUT_INVALID");
  const supplied=Object.fromEntries(Object.entries(descriptors).map(([key,value])=>[key,value.value]));
  try { return await prepareTask01Postgres({...supplied,deadlineMs:3600000},lifetime); }
  catch(error) {
    if(typeof error.code==="string"&&error.code.startsWith("TASK01_RESOURCE_"))throw error;
    throw fault("TASK01_RESOURCE_INPUT_OR_PREPARATION_FAILED");
  }
}
async function startCurrent259TechnicalPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, TECHNICAL_LIFETIME);
}
async function startCurrent259FirstRollbackPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, FIRST_ROLLBACK_LIFETIME);
}
async function startCurrent259FirstQ2LoopbackPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, FIRST_Q2_LIFETIME);
}
async function startCurrent259NormalPaymentPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, NORMAL_LIFETIME);
}
async function startCurrent259ResponseLossPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, RESPONSE_LOSS_LIFETIME);
}
async function startCurrent259CompetitionPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, COMPETITION_LIFETIME);
}
async function startCurrent259VoucherPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, VOUCHER_LIFETIME);
}
async function startCurrent259DisconnectRecoveryPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, DISCONNECT_RECOVERY_LIFETIME);
}
async function startCurrent259AttributionGapPostgres(options) {
  requireThat(arguments.length === 1, "TASK01_RESOURCE_INPUT_INVALID");
  return startCurrent259FixedPostgres(options, ATTRIBUTION_GAP_LIFETIME);
}
module.exports = { startTask01Postgres, startCurrent259TechnicalPostgres, startCurrent259FirstRollbackPostgres,
  startCurrent259FirstQ2LoopbackPostgres, startCurrent259NormalPaymentPostgres, startCurrent259ResponseLossPostgres, startCurrent259CompetitionPostgres, startCurrent259VoucherPostgres, startCurrent259DisconnectRecoveryPostgres, startCurrent259AttributionGapPostgres, projectCurrent259PhysicalEndpoint };
