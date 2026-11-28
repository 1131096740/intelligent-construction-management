"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
const { HttpException } = require("@nestjs/common");
const { isOperationalWriteFrozen } = require("./operational-write-freeze-policy.cjs");

// Standalone maintenance writers use the original operations classification.
// Shared source policy works before API build and in the installed runtime.
function assertOperationalMaintenanceWriteAllowed() {
  let frozen;
  try {
    frozen = isOperationalWriteFrozen(process.env, "operations");
  } catch {
    throw new HttpException({
      statusCode: 503,
      code: "OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID",
      message: "系统运行控制配置无效，请联系管理员"
    }, 503);
  }
  if (frozen) throw new HttpException({
    statusCode: 503,
    code: "OPERATIONAL_WRITE_FREEZE_ACTIVE",
    message: "系统当前仅开放安全查询，请稍后刷新重试"
  }, 503);
}

module.exports = { assertOperationalMaintenanceWriteAllowed };
