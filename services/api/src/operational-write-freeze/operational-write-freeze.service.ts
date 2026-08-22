import { HttpException, Injectable } from "@nestjs/common";
import {
  OPERATIONAL_WRITE_MODULES,
  type OperationalWriteModule
} from "./operational-write-freeze.registry";

type FreezeMode = "off" | "all" | "modules";

@Injectable()
export class OperationalWriteFreezeService {
  isFrozen(module: OperationalWriteModule): boolean {
    const mode = process.env.OPERATIONAL_WRITE_FREEZE_MODE?.trim() || "off";
    const modules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES?.trim() ?? "";
    if (!(["off", "all", "modules"] as FreezeMode[]).includes(mode as FreezeMode)) {
      throw this.invalidConfiguration();
    }
    const values = modules === "" ? [] : modules.split(",");
    if (
      values.some((value) => value.trim() !== value || value === "") ||
      new Set(values).size !== values.length ||
      values.some((value) => !(OPERATIONAL_WRITE_MODULES as readonly string[]).includes(value)) ||
      (mode === "modules" ? values.length === 0 : values.length > 0)
    ) {
      throw this.invalidConfiguration();
    }
    return mode === "all" || (mode === "modules" && values.includes(module));
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
