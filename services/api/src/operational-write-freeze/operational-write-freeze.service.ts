import { HttpException, Injectable } from "@nestjs/common";
import {
  type OperationalWriteModule
} from "./operational-write-freeze.registry";

import { isOperationalWriteFrozen } from "../../scripts/operational-write-freeze-policy.cjs";

@Injectable()
export class OperationalWriteFreezeService {
  isFrozen(module: OperationalWriteModule): boolean {
    try {
      return isOperationalWriteFrozen(process.env, module);
    } catch {
      throw this.invalidConfiguration();
    }
  }

  assertCanWrite(module: OperationalWriteModule) {
    if (this.isFrozen(module)) {
      throw new HttpException({
        statusCode: 503,
        code: "OPERATIONAL_WRITE_FREEZE_ACTIVE",
        message: "系统当前仅开放安全查询，请稍后刷新重试"
      }, 503);
    }
  }

  private invalidConfiguration() {
    return new HttpException({
      statusCode: 503,
      code: "OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID",
      message: "系统运行控制配置无效，请联系管理员"
    }, 503);
  }
}
