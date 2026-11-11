"use strict";
// Prepared task01 test setup. No command runs on import. Live validation requires
// a separately approved, source-sealed driver; this module is not a CLI/runner.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash, X509Certificate } = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");
const { types } = require("node:util");
const TECHNICAL_LIFETIME = Symbol("current259 technical lifetime");
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
function hbaRules(database, roles) {
  return [
    ["local", "all", OWNER, null, "peer", ["map=jg_task01_init"]],
    ["local", "all", "all", null, "reject", []],
    ...["0.0.0.0", "::"].map(ip => ["hostnossl", "all", "all", ip, "reject", []]),
    ...roles.flatMap(role => ["0.0.0.0", "::"].map(ip => ["hostssl", database, role, ip, "scram-sha-256", []])),
    ...["0.0.0.0", "::"].map(ip => ["hostssl", "all", "all", ip, "reject", []])
  ];
}
function renderHba(rules) {
  return rules.map(([type, database, role, ip, auth, options]) =>
    [type, database, role, ...(ip === null ? [] : [ip + "/0"]), auth, ...options].join(" ") + "\n").join("");
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
const PGDATA = "/var/lib/postgresql/data";
const TMPFS = {
  [PGDATA]: "rw,nosuid,nodev,noexec,size=536870912,mode=0700",
  "/var/run/postgresql": "rw,nosuid,nodev,noexec,size=16777216,mode=0775",
  "/tmp": "rw,nosuid,nodev,noexec,size=67108864,mode=1777"
};
const sha = value => createHash("sha256").update(value).digest("hex");
const fault = code => Object.assign(new Error(code), { code });
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
  const technical = lifetime === TECHNICAL_LIFETIME;
  const { runId, sourceSha, artifactsDir, endpoint, daemonId, imageId, tools, deadlineMs = 900000, signal } = options;
  let ownerPassword = options.ownerPassword;
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
  const databaseName = `jg_task01_${runId.replaceAll("-", "")}`;
  const name = `jg-task01-${runId}`;
  const receipt = {
    runId, sourceSha, endpoint, daemonId, imageId, databaseName,
    ...(technical ? { purpose: TECHNICAL_PURPOSE } : {}),
    phase: "preparing", status: "preparing", containerName: name, containerId: null, networkId: null, port: null, attempts: { network: false, container: false },
    volumes: [], limits: { cpu: 2, memoryBytes: 1073741824, pids: 256, pgdataBytes: 536870912, totalDeadlineMs: deadlineMs },
    tls: null, requestedCertificateMode: "correct", reloadState: "not-requested", presentedCertificate: null,
    hostOwnerCredentialFilesErased: false, hostPrivateKeyFilesErased: false, hostPrivateMaterialsErased: false,
    topology: "UNVERIFIED_HOST_PUBLISHED_TLS", cleanup: { status: "pending" }
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
      let bytes = 0, stopped = null, killTimer;
      const stop = code => {
        if (stopped) return;
        stopped = code;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      };
      const timer = setTimeout(() => stop("TASK01_RESOURCE_COMMAND_TIMEOUT"), Math.min(timeoutMs, remaining));
      const onAbort = () => stop("TASK01_RESOURCE_ABORTED");
      if (!cleanup) { signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) onAbort(); }
      for (const [stream, output] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) stop("TASK01_RESOURCE_OUTPUT_LIMIT");
        else if (!stopped) output.push(chunk);
      });
      child.once("error", () => { stopped = "TASK01_RESOURCE_COMMAND_FAILED"; });
      child.once("close", code => {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener("abort", onAbort);
        children.delete(child);
        if (stopped || code !== 0 && !allowFailure) reject(fault(stopped || "TASK01_RESOURCE_COMMAND_FAILED"));
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
    requireThat(Object.keys(host.PortBindings || {}).join(",") === "5432/tcp" && host.PortBindings["5432/tcp"].length === 1 && host.PortBindings["5432/tcp"][0].HostIp === "127.0.0.1", "TASK01_RESOURCE_PORT_CHANGED");
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
    if (receipt.port !== null && value.State?.Running) {
      const ports = value.NetworkSettings?.Ports;
      requireThat(Object.keys(ports || {}).join(",") === "5432/tcp" && ports["5432/tcp"]?.length === 1 && ports["5432/tcp"][0].HostIp === "127.0.0.1" && ports["5432/tcp"][0].HostPort === String(receipt.port), "TASK01_RESOURCE_PORT_CHANGED");
    }
    await inspectNetwork(cleanup);
    return value;
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
      try { persist(); } catch { journalFailure = true; }

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
      } catch (error) {
        cleanupFailure = typeof error.code === "string" && error.code.startsWith("TASK01_RESOURCE_") ? error.code : "TASK01_RESOURCE_CLEANUP_FAILED";
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
      receipt.cleanup = cleanupFailure ? { status: "failed", code: cleanupFailure } : { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true };
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
      catch (error) { throw fault(typeof error.code === "string" && error.code.startsWith("TASK01_RESOURCE_") ? error.code : "TASK01_RESOURCE_OPERATION_FAILED"); }
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
    const config = `data_directory='${PGDATA}'\nhba_file='/jg-task01/pg_hba.conf'\nident_file='/jg-task01/pg_ident.conf'\nlisten_addresses='*'\nport=5432\nmax_connections=16\nshared_buffers='64MB'\nmax_wal_size='64MB'\nmin_wal_size='32MB'\nunix_socket_directories='/var/run/postgresql'\nssl=on\nssl_min_protocol_version='TLSv1.2'\nssl_cert_file='/jg-task01/server.crt'\nssl_key_file='/jg-task01/server.key'\npassword_encryption='scram-sha-256'\nlogging_collector=off\nlog_destination='stderr'\nlog_line_prefix='%m [%p] user=%u db=%d '\nlog_connections=on\nlog_disconnections=on\nlog_error_verbosity=terse\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length_on_error=0\nlog_min_duration_statement=-1\nlog_duration=off\nlc_messages='C'\nstatement_timeout='60s'\n`;
    const hba = renderHba(hbaRules(databaseName, ROLES));
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
  function observeLeafOnce() {
    const remaining = Math.min(2000, endAt - Date.now());
    requireThat(remaining > 0 && !signal?.aborted && !closePromise, "TASK01_RESOURCE_ABORTED_OR_TIMEOUT");
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
        secure = tls.connect({ socket, rejectUnauthorized: false, minVersion: "TLSv1.2" }, () => {
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
      try { observed = await observeLeafOnce(); }
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
  let contractHbaAttempted = false;
  async function applyCurrent259ContractHbaV1() {
    requireThat(technical && arguments.length === 0 && !contractHbaAttempted && !closePromise, "TASK01_RESOURCE_CONTRACT_HBA_UNAVAILABLE");
    contractHbaAttempted = true;
    const read = await execOwnerSql(hbaLoginSql, "contract-hba-roles");
    const logins = JSON.parse(read.stdout);
    requireThat(Array.isArray(logins) && logins.length === 5 && /^jg_fixture_app_[a-f0-9]{24}$/u.test(logins[0])
      && CONTRACT_LOGINS.every((name, index) => logins[index + 1] === name), "TASK01_RESOURCE_CONTRACT_HBA_ROLES");
    const rules = hbaRules(databaseName, [...ROLES, ...logins]);
    const contents = renderHba(rules);
    const beforeSha256 = sha(renderHba(hbaRules(databaseName, ROLES)));
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
      [index + 1, index + 1, HBA_PATH, type, [database], [role], address, address, auth, options, null]);
    requireThat(JSON.stringify(parsed) === JSON.stringify(expected), "TASK01_RESOURCE_CONTRACT_HBA_RULES");
    const file = await mutate(["exec", "--user", "postgres", containerId, "sha256sum", HBA_PATH], { timeoutMs: 10000 });
    requireThat(file.stdout.toString("utf8") === `${afterSha256}  ${HBA_PATH}\n`, "TASK01_RESOURCE_CONTRACT_HBA_FILE");
    const transition = { beforeSha256, afterSha256, rules: rules.length };
    receipt.contractHba = transition;
    persist();
    return Object.freeze({ ...transition });
  }
  async function inspectConnectionEndpoint() {
    requireThat(arguments.length === 0 && !closePromise, "TASK01_RESOURCE_CLOSED");
    await verifyDaemon();
    const state = await inspectOwned();
    return projectCurrent259PhysicalEndpoint(state, { containerId, networkId, databaseName, publishedPort: receipt.port });
  }
  async function captureLogCursor() {
    requireThat(!closePromise, "TASK01_RESOURCE_CLOSED");
    await verifyDaemon(); await inspectOwned();
    const result = await docker(["logs", "--timestamps", containerId], { timeoutMs: 10000 });
    return Object.freeze({ runId, containerId, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length, stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr) });
  }
  async function readPlaintextRejectionEvidence(cursor, target) {
    requireThat(!closePromise && cursor?.runId === runId && cursor?.containerId === containerId && ROLES.includes(target?.role) && target?.databaseName === databaseName && [cursor.stdoutBytes, cursor.stderrBytes].every(n => Number.isSafeInteger(n) && n >= 0), "TASK01_RESOURCE_LOG_WINDOW_INVALID");
    await verifyDaemon(); await inspectOwned();
    const result = await docker(["logs", "--timestamps", containerId], { timeoutMs: 10000 });
    requireThat(result.stdout.length >= cursor.stdoutBytes && result.stderr.length >= cursor.stderrBytes && sha(result.stdout.subarray(0, cursor.stdoutBytes)) === cursor.stdoutSha256 && sha(result.stderr.subarray(0, cursor.stderrBytes)) === cursor.stderrSha256, "TASK01_RESOURCE_LOG_WINDOW_CHANGED");
    const lines = Buffer.concat([result.stdout.subarray(cursor.stdoutBytes), result.stderr.subarray(cursor.stderrBytes)]).toString("utf8").split("\n");
    const matching = lines.some(line => line.includes("FATAL:") && line.includes("pg_hba.conf") && line.includes("no encryption") && line.includes(`user "${target.role}"`) && line.includes(`database "${databaseName}"`));
    return Object.freeze({ hbaNoEncryptionRejected: matching, roleMatched: matching, databaseMatched: matching });
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
  try {
    writePrivate(path.join(dockerConfig, "config.json"), '{"auths":{}}\n');
    persist();
    await verifyDaemon();
    const image = await inspect("image", imageId);
    requireThat(image.Id === imageId && image.Config?.Env?.includes("PG_MAJOR=16") && image.Config?.Env?.includes(`PGDATA=${PGDATA}`), "TASK01_RESOURCE_IMAGE_CHANGED");
    await certificates();
    receipt.phase = "creating-network"; networkAttempted = true; receipt.attempts.network = true; persist();
    networkId = (await mutate(["network", "create", "--internal", "--driver", "bridge", "--label", `${RUN_LABEL}=${runId}`, "--label", `${TASK_LABEL}=enterprise-task01`, "--label", `${SOURCE_LABEL}=${sourceSha}`, name])).stdout.toString().trim();
    requireThat(/^[0-9a-f]{64}$/u.test(networkId), "TASK01_RESOURCE_NETWORK_ID_UNKNOWN");
    receipt.networkId = networkId; persist(); await inspectNetwork();
    receipt.phase = "creating-container"; containerAttempted = true; receipt.attempts.container = true; persist();
    containerId = (await mutate(["container", "create", "--pull=never", "--name", name, "--label", `${RUN_LABEL}=${runId}`, "--label", `${TASK_LABEL}=enterprise-task01`, "--label", `${SOURCE_LABEL}=${sourceSha}`, "--network", networkId, "--publish", "127.0.0.1::5432", "--cpus", "2", "--memory", "1g", "--memory-swap", "1g", "--pids-limit", "256", "--security-opt", "no-new-privileges:true", ...Object.entries(TMPFS).flatMap(([target, settings]) => ["--tmpfs", `${target}:${settings}`]), "--entrypoint", "/bin/sh", "--env", `POSTGRES_USER=${OWNER}`, "--env", `POSTGRES_DB=${databaseName}`, "--env", "POSTGRES_PASSWORD_FILE=/jg-task01/owner-password", "--env", "POSTGRES_INITDB_ARGS=--auth-local=peer --auth-host=scram-sha-256", imageId, "/jg-task01/bootstrap.sh"])).stdout.toString().trim();
    requireThat(/^[0-9a-f]{64}$/u.test(containerId), "TASK01_RESOURCE_CONTAINER_ID_UNKNOWN");
    receipt.containerId = containerId; persist(); await inspectOwned();
    await mutate(["cp", bundle, `${containerId}:/jg-task01`]);
    await inspectOwned();
    eraseHostPrivateMaterials();
    receipt.phase = "starting"; persist();
    await mutate(["container", "start", containerId]);
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
    const published = (await docker(["port", containerId, "5432/tcp"], { timeoutMs: 10000 })).stdout.toString().trim();
    requireThat(/^127\.0\.0\.1:[0-9]{1,5}$/u.test(published), "TASK01_RESOURCE_PORT_CHANGED");
    const port = Number(published.split(":")[1]); requireThat(port > 0 && port <= 65535, "TASK01_RESOURCE_PORT_CHANGED");
    const state = await inspectOwned();
    const ports = state.NetworkSettings?.Ports;
    requireThat(Object.keys(ports || {}).join(",") === "5432/tcp" && ports["5432/tcp"]?.length === 1 && ports["5432/tcp"][0].HostIp === "127.0.0.1" && ports["5432/tcp"][0].HostPort === String(port), "TASK01_RESOURCE_PORT_CHANGED");
    receipt.port = port;
    await observePresentedCertificate("correct");
    receipt.phase = "ready-for-driver"; receipt.status = "started-awaiting-driver-verification"; persist();
    return { containerId, networkId, port, databaseName, caPath: material("ca.crt"), wrongCaPath: material("wrong-ca.crt"), serverCertHashes: { caSha256: receipt.tls.caSha256, wrongCaSha256: receipt.tls.wrongCaSha256, correctCertificateSha256: receipt.tls.correctCertificateSha256, wrongSanCertificateSha256: receipt.tls.wrongSanCertificateSha256, correctCertificateDerSha256: receipt.tls.correctCertificateDerSha256, wrongSanCertificateDerSha256: receipt.tls.wrongSanCertificateDerSha256 }, observePresentedCertificate: safeOperation(observePresentedCertificate), ...(technical ? { applyCurrent259ContractHbaV1: safeOperation(applyCurrent259ContractHbaV1) } : {}), execOwnerSql: safeOperation(execOwnerSql), inspectConnectionEndpoint: safeOperation(inspectConnectionEndpoint), setServerCertificate: safeOperation(setServerCertificate), captureLogCursor: safeOperation(captureLogCursor), readPlaintextRejectionEvidence: safeOperation(readPlaintextRejectionEvidence), getReceipt, close: safeOperation(close) };
  } catch (error) {
    receipt.phase = "failed"; receipt.status = "failed";
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
async function startCurrent259TechnicalPostgres(options) {
  // This second named route never accepts a caller-selected deadline or cap.
  requireThat(arguments.length===1 && options && !types.isProxy(options) && Object.getPrototypeOf(options)===Object.prototype,"TASK01_RESOURCE_INPUT_INVALID");
  const descriptors=Object.getOwnPropertyDescriptors(options);
  const keys=["runId","sourceSha","artifactsDir","endpoint","daemonId","imageId","tools","ownerPassword","signal"];
  requireThat(Reflect.ownKeys(descriptors).every(key=>typeof key==="string"&&keys.includes(key)&&Object.hasOwn(descriptors[key],"value")),"TASK01_RESOURCE_INPUT_INVALID");
  const supplied=Object.fromEntries(Object.entries(descriptors).map(([key,value])=>[key,value.value]));
  try { return await prepareTask01Postgres({...supplied,deadlineMs:3600000},TECHNICAL_LIFETIME); }
  catch(error) {
    if(typeof error.code==="string"&&error.code.startsWith("TASK01_RESOURCE_"))throw error;
    throw fault("TASK01_RESOURCE_INPUT_OR_PREPARATION_FAILED");
  }
}
module.exports = { startTask01Postgres, startCurrent259TechnicalPostgres, projectCurrent259PhysicalEndpoint };
