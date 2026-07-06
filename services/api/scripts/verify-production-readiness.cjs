const assert = require("assert");
const { execFileSync } = require("child_process");

const SEED_PASSWORD = "Jgzg@2026";
const REQUIRED_SECRETS = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "FILE_DOWNLOAD_SECRET"
];
const COS_ENV = ["COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION"];
const REQUIRED_FONTS = ["方正小标宋简体", "仿宋_GB2312", "楷体_GB2312"];
const DEFAULT_MARKERS = new Set([
  "local-access-secret",
  "local-refresh-secret",
  "local-file-secret",
  "replace-with-long-random-secret",
  "replace-with-long-random-file-download-secret",
  "replace-with-tencent-cos-secret-id",
  "replace-with-tencent-cos-secret-key",
  "replace-with-private-bucket",
  SEED_PASSWORD
]);

function isSet(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function looksDefault(value) {
  if (!isSet(value)) return true;
  const normalized = value.trim();
  return DEFAULT_MARKERS.has(normalized) || /^replace-with-/i.test(normalized);
}

function add(results, status, item, message) {
  results.push({ status, item, message });
}

function privateHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function checkDatabaseUrl(env, results) {
  const value = env.DATABASE_URL;
  if (!isSet(value)) {
    add(results, "FAIL", "DATABASE_URL", "missing");
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    add(results, "FAIL", "DATABASE_URL", "invalid PostgreSQL URL");
    return;
  }

  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    add(results, "FAIL", "DATABASE_URL", "must use PostgreSQL");
    return;
  }
  if (url.username === "jiangkong" && url.password === "jiangkong") {
    add(results, "FAIL", "DATABASE_URL", "uses default demo database credentials");
    return;
  }
  if (!privateHost(url.hostname)) {
    add(results, "WARN", "DATABASE_URL", "host does not look private; confirm firewall/VPC manually");
    return;
  }
  add(results, "PASS", "DATABASE_URL", "set");
}

function checkWebOrigin(env, results) {
  const value = env.WEB_ORIGIN;
  if (!isSet(value)) {
    add(results, "FAIL", "WEB_ORIGIN", "missing");
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    add(results, "FAIL", "WEB_ORIGIN", "invalid URL");
    return;
  }

  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    add(results, "FAIL", "WEB_ORIGIN", "production origin must use HTTPS");
    return;
  }
  add(results, "PASS", "WEB_ORIGIN", "set");
}

function checkSecrets(env, results) {
  for (const key of REQUIRED_SECRETS) {
    const value = env[key];
    if (!isSet(value)) {
      add(results, "FAIL", key, "missing");
      continue;
    }
    if (looksDefault(value)) {
      add(results, "FAIL", key, "missing or default placeholder");
      continue;
    }
    if (value.trim().length < 32) {
      add(results, "WARN", key, "set but shorter than 32 chars");
      continue;
    }
    add(results, "PASS", key, "set");
  }
}

function checkSeedPassword(env, results) {
  const keys = Object.entries(env)
    .filter(([, value]) => typeof value === "string" && value.includes(SEED_PASSWORD))
    .map(([key]) => key);
  if (keys.length) {
    add(results, "FAIL", "seed password", `seed password appears in env keys: ${keys.join(", ")}`);
  } else {
    add(results, "PASS", "seed password", "not present in environment");
  }
}

function runPsqlScalar(databaseUrl, sql) {
  return execFileSync("psql", [databaseUrl, "--tuples-only", "--no-align", "--command", sql], {
    encoding: "utf8",
    timeout: 10000
  }).trim();
}

function checkDatabaseState(env, results) {
  if (env.CHECK_DATABASE_STATE !== "true") {
    add(results, "WARN", "database state", "skipped; set CHECK_DATABASE_STATE=true to verify seed users");
    return;
  }

  try {
    const activeSeedUsers = Number(
      runPsqlScalar(
        env.DATABASE_URL,
        "select count(*) from \"User\" where \"id\" like 'seed-user-%' and \"isActive\" = true;"
      )
    );
    const activeSeedRefreshTokens = Number(
      runPsqlScalar(
        env.DATABASE_URL,
        "select count(*) from \"RefreshToken\" where \"userId\" like 'seed-user-%' and \"revokedAt\" is null;"
      )
    );

    if (activeSeedUsers > 0) {
      add(results, "FAIL", "seed users", `${activeSeedUsers} seed users are still active`);
    } else {
      add(results, "PASS", "seed users", "inactive");
    }

    if (activeSeedRefreshTokens > 0) {
      add(results, "FAIL", "seed refresh tokens", `${activeSeedRefreshTokens} seed refresh tokens are active`);
    } else {
      add(results, "PASS", "seed refresh tokens", "revoked");
    }
  } catch (error) {
    add(results, "FAIL", "database state", error.message);
  }
}

function checkStorage(env, results) {
  if (env.FILE_STORAGE_DRIVER !== "cos") {
    add(results, "FAIL", "FILE_STORAGE_DRIVER", "production must use cos private storage");
    return;
  }
  add(results, "PASS", "FILE_STORAGE_DRIVER", "cos");

  for (const key of COS_ENV) {
    if (!isSet(env[key]) || looksDefault(env[key])) {
      add(results, "FAIL", key, "missing or default placeholder");
    } else {
      add(results, "PASS", key, "set");
    }
  }
}

function checkUploadLimit(env, results) {
  const value = Number(env.FILE_UPLOAD_MAX_BYTES ?? 0);
  if (!Number.isSafeInteger(value) || value <= 0) {
    add(results, "WARN", "FILE_UPLOAD_MAX_BYTES", "missing or invalid; API default may apply");
  } else {
    add(results, "PASS", "FILE_UPLOAD_MAX_BYTES", "set");
  }
}

function checkConverter(env, results, options) {
  const command = env.DOC_CONVERTER_COMMAND;
  if (!isSet(command)) {
    add(results, "FAIL", "DOC_CONVERTER_COMMAND", "missing");
    return;
  }

  if (options.checkCommands) {
    try {
      execFileSync(command, ["--version"], { stdio: "ignore", timeout: 5000 });
      add(results, "PASS", "DOC_CONVERTER_COMMAND", "executable");
    } catch {
      add(results, "FAIL", "DOC_CONVERTER_COMMAND", "unavailable or not executable");
    }
  } else {
    add(results, "PASS", "DOC_CONVERTER_COMMAND", "set");
  }

  const allowedFonts = env.DOC_ALLOWED_FONTS ?? "";
  const missingFonts = REQUIRED_FONTS.filter((font) => !allowedFonts.includes(font));
  if (missingFonts.length) {
    add(results, "WARN", "DOC_ALLOWED_FONTS", `missing required contract fonts: ${missingFonts.join(", ")}`);
  } else {
    add(results, "PASS", "DOC_ALLOWED_FONTS", "contains required contract fonts");
  }
}

function checkEnv(env, options = { checkCommands: true }) {
  const results = [];
  if (env.NODE_ENV !== "production") {
    add(results, "WARN", "NODE_ENV", "not set to production");
  } else {
    add(results, "PASS", "NODE_ENV", "production");
  }
  checkWebOrigin(env, results);
  checkDatabaseUrl(env, results);
  checkSecrets(env, results);
  checkSeedPassword(env, results);
  checkDatabaseState(env, results);
  checkStorage(env, results);
  checkUploadLimit(env, results);
  checkConverter(env, results, options);
  return results;
}

function printResults(results) {
  for (const result of results) {
    console.log(`[${result.status}] ${result.item} - ${result.message}`);
  }
  console.log("");
  console.log("Manual checks still required: COS bucket private policy, PostgreSQL firewall/VPC,");
  console.log("backup restore rehearsal, file backup restore, HTTPS renewal, time sync,");
  console.log("log/error alerts, contract master page review, and permission matrix testing.");
}

function selfTest() {
  const goodEnv = {
    NODE_ENV: "production",
    WEB_ORIGIN: "https://admin.example.com",
    DATABASE_URL: "postgresql://prod_user:prod_password@10.0.0.8:5432/jiangkong",
    JWT_ACCESS_SECRET: "a".repeat(40),
    JWT_REFRESH_SECRET: "b".repeat(40),
    FILE_DOWNLOAD_SECRET: "c".repeat(40),
    FILE_STORAGE_DRIVER: "cos",
    COS_SECRET_ID: "AKID".padEnd(40, "x"),
    COS_SECRET_KEY: "SECRET".padEnd(40, "x"),
    COS_BUCKET: "jiangkong-private",
    COS_REGION: "ap-guangzhou",
    FILE_UPLOAD_MAX_BYTES: "104857600",
    DOC_CONVERTER_COMMAND: "soffice",
    DOC_ALLOWED_FONTS: REQUIRED_FONTS.join(",")
  };
  const good = checkEnv(goodEnv, { checkCommands: false });
  assert.equal(good.some((result) => result.status === "FAIL"), false);

  const bad = checkEnv(
    {
      ...goodEnv,
      JWT_ACCESS_SECRET: "local-access-secret",
      FILE_STORAGE_DRIVER: "local",
      SEED_PASSWORD
    },
    { checkCommands: false }
  );
  assert(bad.some((result) => result.item === "JWT_ACCESS_SECRET" && result.status === "FAIL"));
  assert(bad.some((result) => result.item === "FILE_STORAGE_DRIVER" && result.status === "FAIL"));
  assert(bad.some((result) => result.item === "seed password" && result.status === "FAIL"));
  console.log("self-test ok");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const results = checkEnv(process.env);
  printResults(results);
  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
}
