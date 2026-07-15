#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const RECEIPT_PATTERN = /^jiangkong-\d{8}-\d{6}\.dump\.offsite\.json$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function failure(code, happened, impact, nextStep) {
  return {
    ok: false,
    code,
    message: `${happened}；${impact}；${nextStep}`,
  };
}

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function artifactMetadata(filePath, stat) {
  return {
    filePath,
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function validationSignature(receipt, receiptStat, dump, dumpStat, checksum, checksumStat) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        receipt: artifactMetadata(receipt, receiptStat),
        dump: artifactMetadata(dump, dumpStat),
        checksum: artifactMetadata(checksum, checksumStat),
      }),
    )
    .digest("hex");
}

async function readValidationCache(filePath) {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return typeof parsed.validationSignature === "string" ? parsed.validationSignature : null;
  } catch {
    return null;
  }
}

async function defaultPgRestore(dumpPath, env) {
  const pgRestore = env.DB_BACKUP_MONITOR_PG_RESTORE_BIN || "pg_restore";
  const result = spawnSync(pgRestore, ["--list", dumpPath], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: positiveInteger(env.DB_BACKUP_MONITOR_PG_RESTORE_TIMEOUT_MS, 120_000, "pg restore timeout"),
  });
  return result.status === 0 && !result.error;
}

async function evaluateBackupInternal({ env, now, runPgRestore }) {
  const backupDir = env.BACKUP_DIR || "/srv/jiangkong-backups/db";
  const expectedUid = nonNegativeInteger(env.DB_BACKUP_MONITOR_EXPECTED_UID, 0, "expected uid");
  const timeZone = env.DB_BACKUP_MONITOR_TIME_ZONE || "Asia/Shanghai";
  const dailyHour = nonNegativeInteger(env.DB_BACKUP_MONITOR_DAILY_HOUR, 3, "daily hour");
  const graceMinutes = nonNegativeInteger(env.DB_BACKUP_MONITOR_GRACE_MINUTES, 15, "grace minutes");
  const earlyWindowMinutes = nonNegativeInteger(
    env.DB_BACKUP_MONITOR_EARLY_WINDOW_MINUTES,
    10,
    "early window minutes",
  );
  const maxAgeHours = positiveInteger(env.DB_BACKUP_MONITOR_MAX_AGE_HOURS, 26, "max age hours");
  const expectedPrefix = env.DB_BACKUP_MONITOR_EXPECTED_PREFIX || "database-backups/daily/";
  const monthlyPrefix = env.DB_BACKUP_MONITOR_MONTHLY_PREFIX || "database-backups/monthly/";
  const expectedBucket =
    env.DB_BACKUP_MONITOR_EXPECTED_BUCKET || "jiangkong-prod-db-backups-1438687719";
  const expectedRegion = env.DB_BACKUP_MONITOR_EXPECTED_REGION || "ap-chengdu";

  if (!isAbsolute(backupDir)) {
    return failure(
      "INVALID_CONFIGURATION",
      "数据库备份监控目录不是绝对路径",
      "监控结果不可信，当前无法判断异机备份状态",
      "请由管理员修正 systemd 服务中的 BACKUP_DIR 后重新执行检查",
    );
  }
  if (dailyHour > 23 || graceMinutes > 59 || earlyWindowMinutes > 59) {
    return failure(
      "INVALID_CONFIGURATION",
      "数据库备份监控时间参数超出有效范围",
      "监控可能在错误时间判断备份失败",
      "请由管理员核对每日备份小时、宽限时间和提前窗口配置",
    );
  }

  try {
    localDateParts(now, timeZone);
  } catch {
    return failure(
      "INVALID_CONFIGURATION",
      "数据库备份监控时区配置无效",
      "监控无法按生产当地日期判断 03:00 备份",
      "请将 DB_BACKUP_MONITOR_TIME_ZONE 修正为有效 IANA 时区",
    );
  }

  let backupDirStat;
  let entries;
  try {
    backupDirStat = await lstat(backupDir);
    entries = await readdir(backupDir);
  } catch {
    return failure(
      "BACKUP_DIR_UNAVAILABLE",
      "生产数据库备份目录无法读取",
      "当前无法确认本地备份及异机收据是否存在",
      "请检查备份磁盘挂载、目录权限和服务器空间后重试",
    );
  }
  if (
    !backupDirStat.isDirectory() ||
    backupDirStat.isSymbolicLink() ||
    (backupDirStat.mode & 0o022) !== 0
  ) {
    return failure(
      "UNSAFE_BACKUP_DIR",
      "生产数据库备份目录不是受控实体目录",
      "监控可能读取到非预期位置，备份证据不可信",
      "请恢复受控备份目录并移除符号链接后重试",
    );
  }

  const receiptCandidates = [];
  for (const entry of entries) {
    if (!RECEIPT_PATTERN.test(entry)) continue;
    const filePath = join(backupDir, entry);
    try {
      const stat = await lstat(filePath);
      receiptCandidates.push({ filePath, stat });
    } catch {
      // A concurrently rotated entry will be evaluated on the next timer run.
    }
  }

  receiptCandidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  let latest;
  let receiptData;
  for (const candidate of receiptCandidates) {
    const candidateMode = candidate.stat.mode & 0o777;
    if (
      !candidate.stat.isFile() ||
      candidate.stat.isSymbolicLink() ||
      candidate.stat.uid !== expectedUid ||
      candidateMode !== 0o600
    ) {
      return failure(
        "UNSAFE_ARTIFACT",
        `备份收据 ${basename(candidate.filePath)} 不是预期用户所有的 600 普通文件`,
        "备份证据可能被非授权读取或替换，当前不能把它视为可信恢复点",
        "请停止清理现场，修正文件所有者和权限后重新生成并验证备份",
      );
    }

    let candidateData;
    try {
      candidateData = JSON.parse(await readFile(candidate.filePath, "utf8"));
    } catch {
      return failure(
        "INVALID_RECEIPT",
        `异机备份收据 ${basename(candidate.filePath)} 无法解析`,
        "当前无法确认远端对象、哈希和上传时间，不能把该备份视为可恢复",
        "请保留现场并检查备份日志，重新执行受控备份生成完整收据",
      );
    }

    const objectKey = candidateData?.backupObjectKey;
    if (typeof objectKey !== "string" || objectKey.length === 0) {
      return failure(
        "INVALID_RECEIPT",
        `异机备份收据 ${basename(candidate.filePath)} 缺少备份对象键`,
        "当前无法区分日备与月备，也无法确认远端备份位置",
        "请检查备份任务版本和日志，重新执行受控备份",
      );
    }
    if (objectKey.startsWith(monthlyPrefix)) continue;
    if (!objectKey.startsWith(expectedPrefix)) {
      return failure(
        "UNEXPECTED_OBJECT_KEY",
        "异机备份收据指向了非预期 COS 前缀",
        "当前无法确认备份写入了受控生产数据库备份位置",
        "请核对专用备份配置和 CAM 前缀，修复后重新执行受控备份",
      );
    }

    latest = candidate;
    receiptData = candidateData;
    break;
  }

  if (!latest) {
    return failure(
      "NO_RECEIPT",
      "没有找到生产数据库异机日备收据",
      "这不代表数据库中没有业务数据，但当前无法证明存在可恢复的日备恢复点",
      "请检查 03:00 cron 与异机备份日志，修复后手工执行受控日备并复核收据",
    );
  }

  const requiredStrings = [
    "bucket",
    "region",
    "backupObjectKey",
    "checksumObjectKey",
    "backupSha256",
    "checksumSha256",
    "uploadedAt",
  ];
  if (
    !receiptData ||
    typeof receiptData !== "object" ||
    requiredStrings.some((key) => typeof receiptData[key] !== "string" || receiptData[key].length === 0) ||
    !Number.isSafeInteger(receiptData.backupSize) ||
    receiptData.backupSize <= 0 ||
    !SHA256_PATTERN.test(receiptData.backupSha256) ||
    !SHA256_PATTERN.test(receiptData.checksumSha256)
  ) {
    return failure(
      "INVALID_RECEIPT",
      `最新异机备份收据 ${basename(latest.filePath)} 缺少必要字段或字段格式错误`,
      "当前无法证明远端备份与本地文件一致",
      "请检查备份任务版本和日志，重新执行受控备份并复核新收据",
    );
  }
  if (receiptData.bucket !== expectedBucket || receiptData.region !== expectedRegion) {
    return failure(
      "UNEXPECTED_BACKUP_TARGET",
      "异机备份收据中的 COS 桶或地域不是获批生产备份目标",
      "当前无法确认备份落在受控的成都私有数据库备份桶",
      "请核对专用备份配置和 CAM 账号，修复后重新执行受控备份",
    );
  }

  const uploadedAt = new Date(receiptData.uploadedAt);
  if (Number.isNaN(uploadedAt.getTime())) {
    return failure(
      "INVALID_RECEIPT",
      `最新异机备份收据 ${basename(latest.filePath)} 的上传时间无效`,
      "当前无法判断备份是否按时完成或已经陈旧",
      "请检查服务器时间同步和备份脚本，重新执行受控备份",
    );
  }

  const ageMs = now.getTime() - uploadedAt.getTime();
  if (ageMs < -5 * 60 * 1000) {
    return failure(
      "FUTURE_RECEIPT",
      "最新异机备份收据的上传时间晚于当前时间",
      "服务器时间或收据时间不可信，当前无法判断备份新鲜度",
      "请检查服务器时间同步后重新执行备份检查",
    );
  }
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    return failure(
      "STALE_RECEIPT",
      `最新异机备份收据已超过 ${maxAgeHours} 小时`,
      "数据库异机恢复点已经陈旧，发生故障时可能丢失超出目标范围的数据",
      "请检查 03:00 cron、备份日志与 COS 连通性，修复后立即补做受控备份",
    );
  }

  const nowLocal = localDateParts(now, timeZone);
  const uploadedLocal = localDateParts(uploadedAt, timeZone);
  const scheduledMinute = dailyHour * 60;
  const graceDeadline = scheduledMinute + graceMinutes;
  const earliestAcceptedMinute = Math.max(0, scheduledMinute - earlyWindowMinutes);
  if (
    nowLocal.minuteOfDay >= graceDeadline &&
    (uploadedLocal.date !== nowLocal.date || uploadedLocal.minuteOfDay < earliestAcceptedMinute)
  ) {
    return failure(
      "MISSING_TODAY_RECEIPT",
      "03:00 异机数据库备份未在宽限时间内生成当天有效收据",
      "这不代表数据库中没有业务数据，但当前无法确认今天的数据库异机恢复点已经建立",
      "请检查 03:00 cron 与异机备份日志，修复后手工执行受控备份并复核收据",
    );
  }

  const dump = latest.filePath.slice(0, -".offsite.json".length);
  const checksum = `${dump}.sha256`;
  let dumpStat;
  let checksumStat;
  try {
    dumpStat = await lstat(dump);
    checksumStat = await lstat(checksum);
  } catch {
    return failure(
      "MISSING_ARTIFACT",
      `最新异机备份收据 ${basename(latest.filePath)} 缺少配套 dump 或 checksum`,
      "收据无法对应完整的本地恢复证据，当前备份不能视为可恢复",
      "请检查备份清理和磁盘状态，重新执行受控备份",
    );
  }

  const artifacts = [
    [latest.filePath, latest.stat],
    [dump, dumpStat],
    [checksum, checksumStat],
  ];
  for (const [filePath, stat] of artifacts) {
    const mode = stat.mode & 0o777;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== expectedUid || mode !== 0o600) {
      return failure(
        "UNSAFE_ARTIFACT",
        `备份证据 ${basename(filePath)} 不是预期用户所有的 600 普通文件`,
        "备份证据可能被非授权读取或替换，当前不能把它视为可信恢复点",
        "请停止清理现场，修正文件所有者和权限后重新生成并验证备份",
      );
    }
  }

  if (dumpStat.size !== receiptData.backupSize) {
    return failure(
      "BACKUP_SIZE_MISMATCH",
      "本地数据库 dump 大小与异机收据不一致",
      "本地证据与已上传对象可能不是同一份备份",
      "请保留现场，检查备份日志并重新执行受控备份",
    );
  }

  const dumpName = basename(dump);
  const checksumName = basename(checksum);
  if (
    !receiptData.backupObjectKey.startsWith(expectedPrefix) ||
    !receiptData.checksumObjectKey.startsWith(expectedPrefix) ||
    !receiptData.backupObjectKey.endsWith(`/${dumpName}`) ||
    !receiptData.checksumObjectKey.endsWith(`/${checksumName}`)
  ) {
    return failure(
      "UNEXPECTED_OBJECT_KEY",
      "异机备份收据指向了非预期 COS 前缀或文件名",
      "当前无法确认备份写入了受控生产数据库备份位置",
      "请核对专用备份配置和 CAM 前缀，修复后重新执行受控备份",
    );
  }

  const signature = validationSignature(
    latest.filePath,
    latest.stat,
    dump,
    dumpStat,
    checksum,
    checksumStat,
  );
  const cachedSignature = await readValidationCache(env.DB_BACKUP_MONITOR_VALIDATION_CACHE_FILE);
  if (cachedSignature === signature) {
    return {
      ok: true,
      code: "OK",
      cached: true,
      validationSignature: signature,
      message: `03:00 异机数据库备份有效：${dumpName}，上传时间 ${receiptData.uploadedAt}`,
    };
  }

  const [dumpSha256, checksumSha256, checksumContent] = await Promise.all([
    sha256File(dump),
    sha256File(checksum),
    readFile(checksum, "utf8"),
  ]);
  if (dumpSha256 !== receiptData.backupSha256) {
    return failure(
      "BACKUP_HASH_MISMATCH",
      "本地数据库 dump 的 SHA-256 与异机收据不一致",
      "备份内容可能损坏或被替换，当前不能用于可信恢复",
      "请保留现场，检查磁盘和备份日志后重新执行受控备份",
    );
  }
  if (checksumSha256 !== receiptData.checksumSha256) {
    return failure(
      "CHECKSUM_HASH_MISMATCH",
      "本地 checksum 文件的 SHA-256 与异机收据不一致",
      "完整性证据已经失配，当前不能证明远端备份可恢复",
      "请保留现场并重新执行受控备份生成新的 checksum 与收据",
    );
  }

  const checksumMatch = checksumContent.match(/^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/);
  if (!checksumMatch || checksumMatch[1] !== dumpSha256 || checksumMatch[2] !== dumpName) {
    return failure(
      "INVALID_CHECKSUM",
      "本地 checksum 内容与数据库 dump 不匹配",
      "当前不能证明备份文件在保存过程中保持完整",
      "请保留现场并重新执行受控备份",
    );
  }

  if (!(await runPgRestore(dump, env))) {
    return failure(
      "INVALID_DUMP_STRUCTURE",
      "最新数据库 dump 无法通过 pg_restore 结构检查",
      "该文件可能损坏，不能作为可信恢复点",
      "请检查 PostgreSQL 工具与备份日志，立即重新执行受控备份并复核",
    );
  }

  return {
    ok: true,
    code: "OK",
    cached: false,
    validationSignature: signature,
    message: `03:00 异机数据库备份有效：${dumpName}，上传时间 ${receiptData.uploadedAt}`,
  };
}

export async function evaluateBackup({
  env = process.env,
  now = env.DB_BACKUP_MONITOR_NOW ? new Date(env.DB_BACKUP_MONITOR_NOW) : new Date(),
  runPgRestore = defaultPgRestore,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return failure(
      "INVALID_CONFIGURATION",
      "数据库备份监控当前时间无效",
      "监控无法判断备份是否按时或陈旧",
      "请检查服务器时间同步与监控配置",
    );
  }
  try {
    return await evaluateBackupInternal({ env, now, runPgRestore });
  } catch {
    return failure(
      "MONITOR_INTERNAL_ERROR",
      "数据库备份监控执行异常",
      "当前无法确认异机备份是否有效",
      "请查看 jiangkong-db-backup-monitor.service 日志并修复后重试",
    );
  }
}

async function main() {
  const result = await evaluateBackup();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
