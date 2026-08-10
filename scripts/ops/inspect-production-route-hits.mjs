#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);

const ISO_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const NGINX_TIMESTAMP =
  /^(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;
const NGINX_COMBINED_LINE =
  /^\S+ \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^\s"]+) HTTP\/(?:1\.0|1\.1|2(?:\.0)?|3)" [1-5]\d{2} (?:\d+|-) "(?:[^"\\]|\\.)*" "(?:[^"\\]|\\.)*"\s*$/;
const ROUTE_OBSERVATION_INPUT_FORMAT = "route-observation-v1";
const ROUTE_OBSERVATION_FIELDS = new Set([
  "schemaVersion",
  "timestamp",
  "method",
  "uri",
  "status",
  "upstreamStatus"
]);
const ROUTE_OBSERVATION_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
]);
const MONTHS = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, index + 1]
  )
);

class InspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InspectionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new InspectionError(code, message);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDateParts({ year, month, day, hour, minute, second }) {
  return (
    year >= 1970 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function validOffset(hours, minutes) {
  return (
    hours >= 0 &&
    hours <= 14 &&
    minutes >= 0 &&
    minutes <= 59 &&
    (hours !== 14 || minutes === 0)
  );
}

function parseExplicitIso(
  value,
  code = "invalid_observation_window",
  subject = "Observation window"
) {
  const match = String(value ?? "").match(ISO_WITH_TIMEZONE);
  if (!match) {
    fail(
      code,
      `${subject} must use explicit ISO timestamps with timezones`
    );
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText = "0", offsetMinuteText = "0"] =
    match;
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText)
  };
  const offsetHours = Number(offsetHourText);
  const offsetMinutes = Number(offsetMinuteText);
  if (!validDateParts(parts) || !validOffset(offsetHours, offsetMinutes)) {
    fail(code, `${subject} timestamp is invalid`);
  }
  const milliseconds = Number(fraction.padEnd(3, "0"));
  const signedOffsetMinutes =
    zone === "Z"
      ? 0
      : (sign === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutes);
  const epoch =
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      milliseconds
    ) -
    signedOffsetMinutes * 60_000;
  return { epoch, iso: new Date(epoch).toISOString() };
}

function parseNginxTimestamp(value, lineNumber) {
  const match = value.match(NGINX_TIMESTAMP);
  if (!match) {
    fail(
      "unparseable_log_line",
      `Access log line ${lineNumber} has an invalid timestamp`
    );
  }
  const [, dayText, monthName, yearText, hourText, minuteText, secondText, sign, offsetHourText, offsetMinuteText] =
    match;
  const month = MONTHS.get(monthName);
  const parts = {
    year: Number(yearText),
    month: month ?? 0,
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText)
  };
  const offsetHours = Number(offsetHourText);
  const offsetMinutes = Number(offsetMinuteText);
  if (!validDateParts(parts) || !validOffset(offsetHours, offsetMinutes)) {
    fail(
      "unparseable_log_line",
      `Access log line ${lineNumber} has an invalid timestamp`
    );
  }
  const signedOffsetMinutes =
    (sign === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutes);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    ) -
    signedOffsetMinutes * 60_000
  );
}

function normalizePercentEncoding(path, code, message) {
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) fail(code, message);
  return path.replace(/%([0-9A-Fa-f]{2})/g, (encoded, hex) => {
    const value = Number.parseInt(hex, 16);
    const character = String.fromCharCode(value);
    if (["/", "\\", "?", "#", "%"].includes(character)) fail(code, message);
    if (/[A-Za-z0-9._~-]/.test(character)) return character;
    return `%${hex.toUpperCase()}`;
  });
}

function normalizeApiPrefix(value) {
  let prefix = String(value ?? "");
  if (
    !prefix.startsWith("/") ||
    prefix === "/" ||
    prefix.includes("?") ||
    prefix.includes("#") ||
    prefix.includes("\\") ||
    prefix.includes("%") ||
    prefix.includes("//")
  ) {
    fail("invalid_api_prefix", "API prefix is invalid");
  }
  if (prefix.endsWith("/")) prefix = prefix.slice(0, -1);
  if (
    prefix
      .split("/")
      .some((segment) => segment === "." || segment === ".." || segment.includes(":"))
  ) {
    fail("invalid_api_prefix", "API prefix is invalid");
  }
  return prefix;
}

function normalizeRequestPath(target, lineNumber, apiPrefix) {
  if (!target.startsWith("/") || target.includes("#") || target.includes("\\")) {
    fail(
      "ambiguous_request_target",
      `Access log line ${lineNumber} has an ambiguous request target`
    );
  }
  const queryIndex = target.indexOf("?");
  let path = queryIndex === -1 ? target : target.slice(0, queryIndex);
  path = normalizePercentEncoding(
    path,
    "ambiguous_request_target",
    `Access log line ${lineNumber} has an ambiguous request target`
  );
  if (path.includes("//")) {
    fail(
      "ambiguous_request_target",
      `Access log line ${lineNumber} has an ambiguous request target`
    );
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail(
      "ambiguous_request_target",
      `Access log line ${lineNumber} has an ambiguous request target`
    );
  }
  if (path === apiPrefix) path = "/";
  else if (path.startsWith(`${apiPrefix}/`)) path = path.slice(apiPrefix.length);
  else return null;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

function routeObservationInputError(lineNumber) {
  fail(
    "invalid_route_observation_line",
    `Route observation line ${lineNumber} is invalid`
  );
}

function parseRouteObservationLine(line, lineNumber, apiPrefix) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    fail(
      "unparseable_route_observation_line",
      `Route observation line ${lineNumber} is not valid JSON`
    );
  }
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).length !== ROUTE_OBSERVATION_FIELDS.size ||
    Object.keys(record).some((key) => !ROUTE_OBSERVATION_FIELDS.has(key)) ||
    record.schemaVersion !== 1 ||
    typeof record.timestamp !== "string" ||
    !ROUTE_OBSERVATION_METHODS.has(record.method) ||
    typeof record.uri !== "string" ||
    !Number.isSafeInteger(record.status) ||
    record.status < 100 ||
    record.status > 599 ||
    typeof record.upstreamStatus !== "string" ||
    !/^(?:-|[1-5]\d{2}(?:,\s*[1-5]\d{2})*)$/.test(record.upstreamStatus)
  ) {
    routeObservationInputError(lineNumber);
  }
  if (record.uri.includes("?") || /[\u0000-\u0020\u007F]/.test(record.uri)) {
    fail(
      "ambiguous_request_target",
      `Route observation line ${lineNumber} has an ambiguous request target`
    );
  }
  return {
    epoch: parseExplicitIso(
      record.timestamp,
      "invalid_route_observation_line",
      `Route observation line ${lineNumber} timestamp`
    ).epoch,
    method: record.method,
    path: normalizeRequestPath(record.uri, lineNumber, apiPrefix)
  };
}

function normalizeCandidateRoute(value, index, apiPrefix) {
  const match = String(value ?? "").trim().match(/^([A-Za-z]+)\s+(\S+)$/);
  if (!match) {
    fail(
      "invalid_route_manifest",
      `Candidate route ${index + 1} is invalid`
    );
  }
  const method = match[1].toUpperCase();
  let path = match[2];
  if (
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    path.includes("%") ||
    path.includes("//")
  ) {
    fail(
      "invalid_route_manifest",
      `Candidate route ${index + 1} is invalid`
    );
  }
  if (path === apiPrefix) path = "/";
  else if (path.startsWith(`${apiPrefix}/`)) path = path.slice(apiPrefix.length);
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const sourceSegments = path.split("/").slice(1);
  if (
    sourceSegments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        (segment.includes(":") && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment))
    )
  ) {
    fail(
      "invalid_route_manifest",
      `Candidate route ${index + 1} is invalid`
    );
  }
  const segments = sourceSegments.map((segment) =>
    segment.startsWith(":") ? ":param" : segment
  );
  const normalizedPath = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  return {
    method,
    path: normalizedPath,
    key: `${method} ${normalizedPath}`,
    segments
  };
}

function routesOverlap(left, right) {
  return (
    left.method === right.method &&
    left.segments.length === right.segments.length &&
    left.segments.every(
      (segment, index) =>
        segment === right.segments[index] ||
        segment === ":param" ||
        right.segments[index] === ":param"
    )
  );
}

function prepareRoutes(routeManifest, apiPrefix) {
  let values = null;
  if (Array.isArray(routeManifest)) {
    values = routeManifest;
  } else if (routeManifest && typeof routeManifest === "object") {
    if (routeManifest.schemaVersion !== 1) {
      fail(
        "invalid_route_manifest_schema_version",
        "Route manifest schema version is unsupported"
      );
    }
    if (Object.hasOwn(routeManifest, "apiPrefix")) {
      const manifestApiPrefix = normalizeApiPrefix(routeManifest.apiPrefix);
      if (manifestApiPrefix !== apiPrefix) {
        fail(
          "route_manifest_api_prefix_mismatch",
          "Route manifest API prefix does not match the observation prefix"
        );
      }
    }
    if (Array.isArray(routeManifest.routes)) values = routeManifest.routes;
  }
  if (!values || values.length === 0) {
    fail(
      "invalid_route_manifest",
      "Route manifest must contain at least one candidate route"
    );
  }
  const routes = values.map((value, index) =>
    normalizeCandidateRoute(value, index, apiPrefix)
  );
  const seen = new Set();
  for (const route of routes) {
    if (seen.has(route.key)) {
      fail(
        "duplicate_candidate_route",
        "Route manifest contains a duplicate candidate route"
      );
    }
    seen.add(route.key);
  }
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < routes.length;
      rightIndex += 1
    ) {
      if (routesOverlap(routes[leftIndex], routes[rightIndex])) {
        fail(
          "conflicting_candidate_routes",
          "Route manifest contains conflicting candidate routes"
        );
      }
    }
  }
  return routes;
}

function routePathMatches(route, path) {
  if (path === null) return false;
  const segments = path.split("/").slice(1);
  return (
    segments.length === route.segments.length &&
    route.segments.every(
      (segment, index) => segment === ":param" || segment === segments[index]
    )
  );
}

function routeMatches(route, method, path) {
  return (
    (route.method === method || (method === "HEAD" && route.method === "GET")) &&
    routePathMatches(route, path)
  );
}

function parseCombinedLine(line, lineNumber, apiPrefix) {
  const match = line.match(NGINX_COMBINED_LINE);
  if (!match) {
    fail(
      "unparseable_log_line",
      `Access log line ${lineNumber} is not nginx combined format`
    );
  }
  return {
    epoch: parseNginxTimestamp(match[1], lineNumber),
    method: match[2],
    path: normalizeRequestPath(match[3], lineNumber, apiPrefix)
  };
}

function normalizeInputFormat(inputFormat) {
  if (inputFormat === undefined) return null;
  if (inputFormat === ROUTE_OBSERVATION_INPUT_FORMAT) return inputFormat;
  fail("invalid_input_format", "Route observation input format is unsupported");
}

function parseObservationLine(line, lineNumber, apiPrefix, inputFormat) {
  if (inputFormat === ROUTE_OBSERVATION_INPUT_FORMAT) {
    return parseRouteObservationLine(line, lineNumber, apiPrefix);
  }
  return parseCombinedLine(line, lineNumber, apiPrefix);
}

export function inspectProductionRouteHits({
  logText,
  from,
  to,
  coverageFrom,
  coverageTo,
  apiPrefix: rawApiPrefix,
  inputSourceCount = 1,
  now = Date.now(),
  inputFormat,
  routes: routeManifest
}) {
  const windowFrom = parseExplicitIso(from);
  const windowTo = parseExplicitIso(to);
  if (windowFrom.epoch >= windowTo.epoch) {
    fail(
      "invalid_observation_window",
      "Observation window start must precede its end"
    );
  }
  if (!Number.isFinite(now) || windowTo.epoch > now) {
    fail(
      "future_observation_window",
      "Observation window cannot end in the future"
    );
  }
  const coverageStart = parseExplicitIso(
    coverageFrom,
    "invalid_coverage_window",
    "Coverage window"
  );
  const coverageEnd = parseExplicitIso(
    coverageTo,
    "invalid_coverage_window",
    "Coverage window"
  );
  if (
    coverageStart.epoch >= coverageEnd.epoch ||
    !Number.isSafeInteger(inputSourceCount) ||
    inputSourceCount < 1
  ) {
    fail("invalid_coverage_window", "Coverage window metadata is invalid");
  }
  if (coverageEnd.epoch > now) {
    fail("future_coverage_window", "Coverage window cannot end in the future");
  }
  if (
    coverageStart.epoch > windowFrom.epoch ||
    coverageEnd.epoch < windowTo.epoch
  ) {
    fail(
      "incomplete_log_coverage",
      "Access log coverage does not contain the complete observation window"
    );
  }
  const apiPrefix = normalizeApiPrefix(rawApiPrefix);
  const normalizedInputFormat = normalizeInputFormat(inputFormat);
  const routes = prepareRoutes(routeManifest, apiPrefix);
  const counts = Object.fromEntries(routes.map((route) => [route.key, 0]));
  const evidence = {
    complete: true,
    coverageWindow: `${coverageStart.iso}/${coverageEnd.iso}`,
    coverageBasis: "operator_attested",
    apiPrefix,
    ...(normalizedInputFormat
      ? { inputFormat: normalizedInputFormat }
      : {}),
    inWindowApiPrefixedRequests: 0,
    inputSourceCount,
    nonEmptyLines: 0,
    parsedLines: 0,
    beforeWindowLines: 0,
    inWindowLines: 0,
    atOrAfterWindowLines: 0,
    matchedRequests: 0,
    unmatchedRequests: 0,
    parseFailures: 0
  };
  let previousEpoch = Number.NEGATIVE_INFINITY;

  for (const [index, rawLine] of String(logText ?? "").split(/\r?\n/).entries()) {
    if (rawLine.trim() === "") continue;
    evidence.nonEmptyLines += 1;
    const line = parseObservationLine(
      rawLine,
      index + 1,
      apiPrefix,
      normalizedInputFormat
    );
    evidence.parsedLines += 1;
    if (line.epoch < previousEpoch) {
      fail(
        "non_monotonic_log_time",
        `Access log line ${index + 1} is outside chronological order`
      );
    }
    previousEpoch = line.epoch;

    if (line.epoch < windowFrom.epoch) {
      evidence.beforeWindowLines += 1;
      continue;
    }
    if (line.epoch >= windowTo.epoch) {
      evidence.atOrAfterWindowLines += 1;
      continue;
    }
    evidence.inWindowLines += 1;
    if (line.path !== null) evidence.inWindowApiPrefixedRequests += 1;
    if (
      line.method === "OPTIONS" &&
      routes.some((route) => routePathMatches(route, line.path))
    ) {
      fail(
        "ambiguous_preflight_request",
        `Access log line ${index + 1} is an ambiguous preflight request`
      );
    }
    const matchedRoute = routes.find((route) =>
      routeMatches(route, line.method, line.path)
    );
    if (matchedRoute) {
      counts[matchedRoute.key] += 1;
      evidence.matchedRequests += 1;
    } else {
      evidence.unmatchedRequests += 1;
    }
  }

  if (evidence.nonEmptyLines === 0) {
    fail(
      "incomplete_log_coverage",
      "Access log evidence is empty"
    );
  }
  if (evidence.inWindowLines === 0) {
    fail(
      "incomplete_log_coverage",
      "Access log has no request inside the observation window"
    );
  }
  if (evidence.inWindowApiPrefixedRequests === 0) {
    fail(
      "unproven_api_prefix",
      "Access log contains no request with the declared API prefix"
    );
  }

  return {
    schemaVersion: normalizedInputFormat ? 2 : 1,
    status: "ready",
    ...(normalizedInputFormat
      ? { inputFormat: normalizedInputFormat }
      : {}),
    observationWindow: `${windowFrom.iso}/${windowTo.iso}`,
    counts,
    evidence
  };
}

function parseArgs(argv) {
  const args = { logs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      ![
        "--from",
        "--to",
        "--coverage-from",
        "--coverage-to",
        "--api-prefix",
        "--input-format",
        "--routes",
        "--log"
      ].includes(flag)
    ) {
      fail("invalid_arguments", "Unknown or invalid command argument");
    }
    if (
      (flag !== "--log" && args[flag] !== undefined) ||
      argv[index + 1] === undefined
    ) {
      fail("invalid_arguments", "Command arguments must be provided exactly once");
    }
    if (flag === "--log") args.logs.push(argv[index + 1]);
    else args[flag] = argv[index + 1];
    index += 1;
  }
  if (
    !args["--from"] ||
    !args["--to"] ||
    !args["--coverage-from"] ||
    !args["--coverage-to"] ||
    !args["--api-prefix"] ||
    !args["--routes"]
  ) {
    fail(
      "invalid_arguments",
      "Observation, coverage and route manifest arguments are required"
    );
  }
  if (args.logs.includes("-") && args.logs.length > 1) {
    fail(
      "invalid_arguments",
      "Standard input cannot be combined with access log files"
    );
  }
  return args;
}

async function readRouteManifest(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    fail("route_manifest_unreadable", "Route manifest could not be read");
  }
  try {
    return JSON.parse(source);
  } catch {
    fail("invalid_route_manifest", "Route manifest is not valid JSON");
  }
}

async function readAccessLogSource(path) {
  try {
    let source;
    if (path === undefined || path === "-") {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      source = Buffer.concat(chunks);
    } else {
      source = await readFile(path);
    }
    const content =
      path !== undefined && path !== "-" && path.endsWith(".gz")
        ? await gunzipAsync(source)
        : source;
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    fail("access_log_unreadable", "Access log could not be read");
  }
}

async function readAccessLogs(paths) {
  const sources = paths.length === 0 ? [undefined] : paths;
  const contents = [];
  for (const path of sources) {
    contents.push(await readAccessLogSource(path));
  }
  return {
    logText: contents.join("\n"),
    inputSourceCount: sources.length
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [routeManifest, accessLogs] = await Promise.all([
    readRouteManifest(args["--routes"]),
    readAccessLogs(args.logs)
  ]);
  const report = inspectProductionRouteHits({
    logText: accessLogs.logText,
    from: args["--from"],
    to: args["--to"],
    coverageFrom: args["--coverage-from"],
    coverageTo: args["--coverage-to"],
    apiPrefix: args["--api-prefix"],
    inputFormat: args["--input-format"],
    inputSourceCount: accessLogs.inputSourceCount,
    routes: routeManifest
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const known = error instanceof InspectionError;
    process.stderr.write(
      `${JSON.stringify({
        code: known ? error.code : "inspection_failed"
      })}\n`
    );
    process.exitCode = 1;
  });
}
