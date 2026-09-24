"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
// External HTTPS protocol fixture, reachable only through the test container's
// network=none loopback. It never imports or replaces application adapters.
const fs = require("node:fs");
const https = require("node:https");
const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const directory = process.argv[2];
const host = `${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com`;
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const deletedVersions = new Set();

function validSignature(request, url) {
  const fields = new URLSearchParams(request.headers.authorization || "");
  const keyTime = fields.get("q-key-time") || "";
  const [start, end] = keyTime.split(";").map(Number);
  const now = Math.floor(Date.now() / 1000);
  if (fields.get("q-sign-algorithm") !== "sha1" || fields.get("q-ak") !== process.env.COS_SECRET_ID ||
      fields.get("q-header-list") !== "host" || fields.get("q-sign-time") !== keyTime ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > now || end <= now || end - start > 600) return false;
  const entries = [...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a.localeCompare(b));
  if (fields.get("q-url-param-list") !== entries.map(([key]) => encodeURIComponent(key)).join(";")) return false;
  const parameters = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const canonical = `${request.method.toLowerCase()}\n${url.pathname}\n${parameters}\nhost=${encodeURIComponent(host)}\n`;
  const signKey = createHmac("sha1", process.env.COS_SECRET_KEY).update(keyTime).digest("hex");
  const digest = createHash("sha1").update(canonical).digest("hex");
  const expected = createHmac("sha1", signKey).update(`sha1\n${keyTime}\n${digest}\n`).digest();
  const supplied = Buffer.from(fields.get("q-signature") || "", "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const server = https.createServer({ key: fs.readFileSync(`${directory}/tls-key.pem`),
  cert: fs.readFileSync(`${directory}/tls-cert.pem`) }, (request, response) => {
  const url = new URL(request.url, `https://${host}`);
  const signed = request.headers.host === host && validSignature(request, url);
  const manifest = JSON.parse(fs.readFileSync(`${directory}/cos-response.json`, "utf8"));
  const deleting = request.method === "DELETE";
  const object = manifest.objects.find(item => deleting
    ? `/${item.objectKey.split("/").map(encodeURIComponent).join("/")}` === url.pathname
    : item.objectKey === url.searchParams.get("prefix"));
  const versionId = url.searchParams.get("versionId");
  const allowed = signed && object && (deleting
    ? manifest.deleteEnabled === true && [...url.searchParams].length === 1 &&
      object.versions.some(version => version.versionId === versionId)
    : request.method === "GET" && url.pathname === "/" &&
      url.searchParams.has("versions") && url.searchParams.get("max-keys") === "1000");
  fs.appendFileSync("/tmp/cos-audit.jsonl", `${JSON.stringify({ method: request.method, signed,
    exactTarget: Boolean(object), allowed: Boolean(allowed) })}\n`, { mode: 0o600 });
  if (!allowed) { response.writeHead(403); response.end("<Error><Code>AccessDenied</Code></Error>"); return; }
  if (deleting) {
    deletedVersions.add(JSON.stringify([object.objectKey, versionId]));
    response.writeHead(204); response.end(); return;
  }
  if (manifest.statusCode === 503) {
    response.writeHead(503); response.end("<Error><Code>ServiceUnavailable</Code></Error>"); return;
  }
  if (manifest.pagination === "redirect") {
    response.writeHead(302, { location: `https://${host}/redirected` }); response.end(); return;
  }
  if (manifest.pagination === "oversize") {
    response.writeHead(200); response.end("x".repeat(2 * 1024 * 1024 + 1)); return;
  }
  if (manifest.pagination === "stall") { response.writeHead(200); response.write("<ListVersionsResult>"); return; }
  const secondPage = url.searchParams.has("version-id-marker");
  const remainingVersions = object.versions.filter(version => !deletedVersions.has(JSON.stringify([object.objectKey, version.versionId])));
  const pageVersions = manifest.pagination === "two-pages"
    ? (secondPage ? remainingVersions.slice(1) : remainingVersions.slice(0, 1)) : remainingVersions;
  const versions = pageVersions.map(version => {
    const tag = version.isDeleteMarker ? "DeleteMarker" : "Version";
    return `<${tag}><Key>${xml(object.objectKey)}</Key><VersionId>${xml(version.versionId)}</VersionId>` +
      `<IsLatest>${version.isLatest}</IsLatest><LastModified>${xml(version.lastModified)}</LastModified>` +
      (version.isDeleteMarker ? "" : `<Size>${version.sizeBytes}</Size>`) + `</${tag}>`;
  }).join("");
  response.writeHead(200, { "content-type": "application/xml" });
  let truncation = "<IsTruncated>false</IsTruncated>";
  if (manifest.pagination === "missing") truncation = "";
  if (manifest.pagination === "duplicate") truncation += truncation;
  if (manifest.pagination === "missing-cursor") truncation = "<IsTruncated>true</IsTruncated>";
  if (manifest.pagination === "repeat" || (manifest.pagination === "two-pages" && !secondPage)) {
    truncation = `<IsTruncated>true</IsTruncated><NextKeyMarker>${xml(object.objectKey)}</NextKeyMarker><NextVersionIdMarker>cursor</NextVersionIdMarker>`;
  }
  const body = `<ListVersionsResult>${truncation}${versions}</ListVersionsResult>`;
  if (typeof manifest.responseGate === "string" && /^[a-z0-9-]{1,40}$/u.test(manifest.responseGate) &&
      object === manifest.objects.at(-1)) {
    // External transport coordination only: the test controller changes the
    // real fixed trust file while the actual CLI is waiting for this response.
    // The server never reads or writes application authority materials.
    const gate = `/tmp/cos-gate-${manifest.responseGate}`;
    fs.writeFileSync(`${gate}.ready`, "ready", { mode: 0o600 });
    const deadline = Date.now() + 5000;
    const finish = () => {
      if (response.destroyed) return;
      if (fs.existsSync(`${gate}.release`)) { response.end(body); return; }
      if (Date.now() >= deadline) { response.destroy(); return; }
      setTimeout(finish, 20);
    };
    finish();
  } else response.end(body);
});
server.listen(443, "127.0.0.1", () => fs.writeFileSync("/tmp/cos-ready", "ready", { mode: 0o600 }));
