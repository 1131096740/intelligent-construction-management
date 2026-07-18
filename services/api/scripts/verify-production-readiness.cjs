const assert = require("assert");
const { execFileSync } = require("child_process");

const SEED_PASSWORD = "Jgzg@2026";
const REQUIRED_SECRETS = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "FILE_DOWNLOAD_SECRET"
];
const COS_SECRET_ENV = ["COS_SECRET_ID", "COS_SECRET_KEY"];
const MAX_FILE_UPLOAD_BYTES = 100 * 1024 * 1024;
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
      add(
        results,
        key === "FILE_DOWNLOAD_SECRET" ? "FAIL" : "WARN",
        key,
        "set but shorter than 32 chars"
      );
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

function checkInitialTemporaryPassword(env, results) {
  const password = env.INITIAL_USER_TEMPORARY_PASSWORD;
  if (!isSet(password)) {
    add(results, "FAIL", "INITIAL_USER_TEMPORARY_PASSWORD", "missing");
    return;
  }
  if (password.trim().length < 8 || !/\S/u.test(password)) {
    add(results, "FAIL", "INITIAL_USER_TEMPORARY_PASSWORD", "does not meet minimum password policy");
    return;
  }
  add(results, "PASS", "INITIAL_USER_TEMPORARY_PASSWORD", "set");
}

function runPsqlScalar(databaseUrl, sql) {
  return execFileSync("psql", [databaseUrl, "--tuples-only", "--no-align", "--command", sql], {
    encoding: "utf8",
    timeout: 10000
  }).trim();
}

function parseDatabaseCount(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("invalid database count");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error("invalid database count");
  }
  return count;
}

function checkDatabaseState(env, results, options) {
  if (env.CHECK_DATABASE_STATE !== "true") {
    add(results, "WARN", "database state", "skipped; set CHECK_DATABASE_STATE=true to verify seed users");
    return;
  }

  try {
    const queryScalar = options.runPsqlScalar ?? runPsqlScalar;
    const activeSeedUsers = parseDatabaseCount(
      queryScalar(
        env.DATABASE_URL,
        "select count(*) from \"User\" where \"id\" like 'seed-user-%' and \"isActive\" = true;"
      )
    );
    const activeSeedRefreshTokens = parseDatabaseCount(
      queryScalar(
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
  } catch {
    add(
      results,
      "FAIL",
      "database state",
      "read-only verification failed; inspect database connectivity and permissions"
    );
  }
}

function checkStorage(env, results) {
  const driver = env.FILE_STORAGE_DRIVER;
  if (!isSet(driver)) {
    add(results, "FAIL", "FILE_STORAGE_DRIVER", "missing; allowed values are local or cos");
  } else if (!new Set(["local", "cos"]).has(driver)) {
    add(results, "FAIL", "FILE_STORAGE_DRIVER", "invalid; allowed values are local or cos");
  } else if (driver === "local") {
    add(results, "FAIL", "FILE_STORAGE_DRIVER", "production must use cos private storage");
  } else {
    add(results, "PASS", "FILE_STORAGE_DRIVER", "cos");
  }

  for (const key of COS_SECRET_ENV) {
    if (!isSet(env[key]) || looksDefault(env[key])) {
      add(results, "FAIL", key, "missing or default placeholder");
    } else {
      add(results, "PASS", key, "set");
    }
  }

  const bucket = env.COS_BUCKET;
  const bucketMatch =
    typeof bucket === "string"
      ? bucket.match(/^([a-z0-9]|[a-z0-9][a-z0-9-]{0,48}[a-z0-9])-([1-9]\d*)$/)
      : null;
  if (!isSet(bucket) || looksDefault(bucket)) {
    add(results, "FAIL", "COS_BUCKET", "missing or default placeholder");
  } else if (!bucketMatch) {
    add(results, "FAIL", "COS_BUCKET", "invalid Tencent COS bucket format");
  } else {
    add(results, "PASS", "COS_BUCKET", "valid Tencent COS bucket format");
  }

  const region = env.COS_REGION;
  if (!isSet(region) || looksDefault(region)) {
    add(results, "FAIL", "COS_REGION", "missing or default placeholder");
  } else if (!/^(?:ap|na|sa|eu|af|me)(?:-[a-z0-9]+)+$/.test(region)) {
    add(results, "FAIL", "COS_REGION", "invalid Tencent COS region format");
  } else {
    add(results, "PASS", "COS_REGION", "valid Tencent COS region format");
  }
}

function checkUploadLimit(env, results) {
  const rawValue = env.FILE_UPLOAD_MAX_BYTES;
  if (typeof rawValue !== "string" || !/^[1-9]\d*$/.test(rawValue)) {
    add(results, "FAIL", "FILE_UPLOAD_MAX_BYTES", "must be a positive decimal integer");
    return;
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value > MAX_FILE_UPLOAD_BYTES) {
    add(results, "FAIL", "FILE_UPLOAD_MAX_BYTES", "must be between 1 and 104857600 bytes");
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

function checkEnv(env, options = {}) {
  const runtimeOptions = {
    checkCommands: options.checkCommands !== false,
    runPsqlScalar: options.runPsqlScalar ?? runPsqlScalar
  };
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
  checkInitialTemporaryPassword(env, results);
  checkDatabaseState(env, results, runtimeOptions);
  checkStorage(env, results);
  checkUploadLimit(env, results);
  checkConverter(env, results, runtimeOptions);
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
    INITIAL_USER_TEMPORARY_PASSWORD: "configured-password",
    FILE_STORAGE_DRIVER: "cos",
    COS_SECRET_ID: "AKID".padEnd(40, "x"),
    COS_SECRET_KEY: "SECRET".padEnd(40, "x"),
    COS_BUCKET: "example-private-1250000000",
    COS_REGION: "ap-chengdu",
    FILE_UPLOAD_MAX_BYTES: "104857600",
    DOC_CONVERTER_COMMAND: "soffice",
    DOC_ALLOWED_FONTS: REQUIRED_FONTS.join(",")
  };
  const good = checkEnv(goodEnv, { checkCommands: false });
  assert.equal(good.some((result) => result.status === "FAIL"), false);

  const assertFail = (overrides, item) => {
    const results = checkEnv({ ...goodEnv, ...overrides }, { checkCommands: false });
    assert(
      results.some((result) => result.item === item && result.status === "FAIL"),
      `expected ${item} to fail for ${JSON.stringify(Object.keys(overrides))}`
    );
    return results;
  };

  for (const driver of ["local", "s3", ""]) {
    assertFail({ FILE_STORAGE_DRIVER: driver }, "FILE_STORAGE_DRIVER");
  }
  for (const driver of ["local", "s3"]) {
    const storageFailures = checkEnv(
      {
        ...goodEnv,
        FILE_STORAGE_DRIVER: driver,
        COS_SECRET_ID: "",
        COS_SECRET_KEY: "",
        COS_BUCKET: "",
        COS_REGION: ""
      },
      { checkCommands: false }
    );
    for (const item of [
      "FILE_STORAGE_DRIVER",
      "COS_SECRET_ID",
      "COS_SECRET_KEY",
      "COS_BUCKET",
      "COS_REGION"
    ]) {
      assert(
        storageFailures.some(
          (result) => result.item === item && result.status === "FAIL"
        ),
        `expected ${item} to fail together with ${driver}`
      );
    }
  }
  for (const bucket of [
    "Example-private-1250000000",
    " example-private-1250000000",
    "example/private-1250000000",
    "example-private",
    "example-private-0",
    "example-private-012500000000"
  ]) {
    assertFail({ COS_BUCKET: bucket }, "COS_BUCKET");
  }
  for (const region of ["AP-Chengdu", "ap_chengdu", "ap chengdu", "chengdu", "foo-bar"]) {
    assertFail({ COS_REGION: region }, "COS_REGION");
  }
  for (const uploadLimit of [
    undefined,
    "0",
    "-1",
    "1.5",
    "1e6",
    "0x100",
    "104857601",
    "1073741824",
    "9007199254740991",
    "9007199254740992"
  ]) {
    assertFail({ FILE_UPLOAD_MAX_BYTES: uploadLimit }, "FILE_UPLOAD_MAX_BYTES");
  }
  assertFail({ FILE_DOWNLOAD_SECRET: "f".repeat(31) }, "FILE_DOWNLOAD_SECRET");
  assertFail({ INITIAL_USER_TEMPORARY_PASSWORD: "1234567" }, "INITIAL_USER_TEMPORARY_PASSWORD");
  assertFail(
    { FILE_DOWNLOAD_SECRET: "replace-with-long-random-file-download-secret" },
    "FILE_DOWNLOAD_SECRET"
  );
  const shortJwt = checkEnv(
    { ...goodEnv, JWT_ACCESS_SECRET: "j".repeat(31) },
    { checkCommands: false }
  );
  assert(
    shortJwt.some(
      (result) => result.item === "JWT_ACCESS_SECRET" && result.status === "WARN"
    )
  );

  const syntheticCosSecret = "SYNTHETIC_COS_SECRET_DO_NOT_PRINT";
  const syntheticDatabasePassword = "SYNTHETIC_DATABASE_PASSWORD_DO_NOT_PRINT";
  const databaseFailure = checkEnv(
    {
      ...goodEnv,
      COS_SECRET_KEY: syntheticCosSecret,
      DATABASE_URL: `postgresql://prod_user:${syntheticDatabasePassword}@10.0.0.8:5432/jiangkong`,
      CHECK_DATABASE_STATE: "true"
    },
    {
      checkCommands: false,
      runPsqlScalar: () => {
        throw new Error(
          `connection failed for ${syntheticDatabasePassword} using ${syntheticCosSecret}`
        );
      }
    }
  );
  const serializedFailure = JSON.stringify(databaseFailure);
  assert(
    databaseFailure.some(
      (result) => result.item === "database state" && result.status === "FAIL"
    )
  );
  assert(!serializedFailure.includes(syntheticCosSecret));
  assert(!serializedFailure.includes(syntheticDatabasePassword));
  assert(!serializedFailure.includes("postgresql://"));
  assert(!JSON.stringify(good).includes(goodEnv.COS_SECRET_ID));
  assert(!JSON.stringify(good).includes(goodEnv.COS_SECRET_KEY));

  const validDatabaseState = checkEnv(
    { ...goodEnv, CHECK_DATABASE_STATE: "true" },
    { checkCommands: false, runPsqlScalar: () => "0" }
  );
  assert(
    validDatabaseState.some(
      (result) => result.item === "seed users" && result.status === "PASS"
    )
  );
  assert(
    validDatabaseState.some(
      (result) => result.item === "seed refresh tokens" && result.status === "PASS"
    )
  );
  for (const invalidCount of [
    "",
    " ",
    "invalid",
    "NaN",
    "-1",
    "1.5",
    "1e3",
    "0x10",
    "9007199254740992"
  ]) {
    const invalidDatabaseState = checkEnv(
      { ...goodEnv, CHECK_DATABASE_STATE: "true" },
      { checkCommands: false, runPsqlScalar: () => invalidCount }
    );
    assert(
      invalidDatabaseState.some(
        (result) => result.item === "database state" && result.status === "FAIL"
      ),
      `expected invalid database count ${JSON.stringify(invalidCount)} to fail`
    );
    assert(
      !invalidDatabaseState.some(
        (result) =>
          ["seed users", "seed refresh tokens"].includes(result.item) &&
          result.status === "PASS"
      )
    );
  }

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
