#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { Prisma, PrismaClient } = require("@prisma/client");

const CONFIRMATION_VALUE = "RESET_PENDING_INITIAL_PASSWORDS";
const INITIAL_USER_TEMPORARY_PASSWORD_ENV = "INITIAL_USER_TEMPORARY_PASSWORD";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return values;
      const separator = trimmed.indexOf("=");
      if (separator < 1) return values;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      values[key] = value;
      return values;
    }, {});
}

function parseArgs(argv) {
  const options = { execute: false, confirmed: false };
  for (const value of argv) {
    if (value === "--execute") {
      options.execute = true;
    } else if (value === `--confirm=${CONFIRMATION_VALUE}`) {
      options.confirmed = true;
    } else {
      throw new Error("仅支持 --execute 与受控确认参数");
    }
  }
  if (options.execute && !options.confirmed) {
    throw new Error("执行重置必须提供受控确认参数");
  }
  if (!options.execute && options.confirmed) {
    throw new Error("受控确认参数只能与 --execute 一起使用");
  }
  return options;
}

function initialTemporaryPassword(environment) {
  const password = environment[INITIAL_USER_TEMPORARY_PASSWORD_ENV]?.trim();
  if (!password) {
    throw new Error(`${INITIAL_USER_TEMPORARY_PASSWORD_ENV} is required for execution`);
  }
  if (password.length < 8 || !/\S/u.test(password)) {
    throw new Error(`${INITIAL_USER_TEMPORARY_PASSWORD_ENV} does not meet minimum password policy`);
  }
  return password;
}

function configuredEnvironment(processEnvironment = process.env) {
  const configuredFile = processEnvironment.API_ENV_FILE;
  const envFile = configuredFile
    ? path.resolve(configuredFile)
    : path.resolve(__dirname, "..", ".env");
  if (configuredFile && !path.isAbsolute(configuredFile)) {
    throw new Error("API_ENV_FILE must be an absolute path");
  }
  return { ...readEnvFile(envFile), ...processEnvironment };
}

async function resetPendingInitialPasswords({ prisma, execute, environment, hashPassword = bcrypt.hash }) {
  const candidates = await prisma.user.findMany({
    where: { mustChangePassword: true },
    select: { id: true }
  });
  if (!execute) {
    return {
      mode: "dry-run",
      matchedAccounts: candidates.length,
      resetAccounts: 0,
      revokedRefreshTokens: 0,
      auditRecords: 0
    };
  }

  const password = initialTemporaryPassword(environment);
  return prisma.$transaction(
    async (tx) => {
      const targets = await tx.user.findMany({
        where: { mustChangePassword: true },
        select: { id: true }
      });
      let revokedRefreshTokens = 0;
      for (const target of targets) {
        const passwordHash = await hashPassword(password, 10);
        await tx.user.update({
          where: { id: target.id },
          data: { passwordHash, mustChangePassword: true }
        });
        const revoked = await tx.refreshToken.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        revokedRefreshTokens += revoked.count;
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: "auth.password.initial_reset",
            businessType: "user",
            businessId: target.id,
            metadata: {
              source: "authorized_initial_password_maintenance",
              mustChangePassword: true,
              refreshTokensRevoked: revoked.count
            }
          }
        });
      }
      return {
        mode: "execute",
        matchedAccounts: candidates.length,
        resetAccounts: targets.length,
        revokedRefreshTokens,
        auditRecords: targets.length
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

function printResult(result) {
  if (result.mode === "dry-run") {
    console.log(`只读核对完成：待首次改密账号 ${result.matchedAccounts} 个；未执行任何修改。`);
    return;
  }
  console.log(
    `受控重置完成：账号 ${result.resetAccounts} 个，撤销有效登录会话 ${result.revokedRefreshTokens} 个，写入审计 ${result.auditRecords} 条。`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const environment = configuredEnvironment();
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } });
  try {
    const result = await resetPendingInitialPasswords({
      prisma,
      execute: options.execute,
      environment
    });
    printResult(result);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "初始密码重置失败");
    process.exit(1);
  });
}

module.exports = {
  CONFIRMATION_VALUE,
  configuredEnvironment,
  initialTemporaryPassword,
  parseArgs,
  printResult,
  resetPendingInitialPasswords
};
