import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable
} from "@nestjs/common";
import {
  OPERATIONAL_WRITE_ALLOWED_ACTIONS,
  OPERATIONAL_WRITE_MODULES,
  operationalWriteActionKey,
  operationalWriteModuleFor,
  type OperationalWriteModule
} from "./operational-write-freeze.registry";

type OperationalWriteFreezeMode = "off" | "all" | "modules";

interface OperationalWriteFreezeConfig {
  mode: OperationalWriteFreezeMode;
  modules: ReadonlySet<OperationalWriteModule>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MODES = new Set<OperationalWriteFreezeMode>(["off", "all", "modules"]);
const MODULES = new Set<OperationalWriteModule>(OPERATIONAL_WRITE_MODULES);

@Injectable()
export class OperationalWriteFreezeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string }>();
    if (SAFE_METHODS.has((request.method ?? "GET").toUpperCase())) return true;

    const actionKey = operationalWriteActionKey(
      context.getClass(),
      context.getHandler()
    );
    if (OPERATIONAL_WRITE_ALLOWED_ACTIONS.has(actionKey)) return true;

    const module = operationalWriteModuleFor(context.getClass());
    if (!module) {
      throw this.exception(
        "OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED",
        "该写操作尚未完成运行边界登记，请联系管理员"
      );
    }

    const config = this.configuration();
    if (!config) {
      throw this.exception(
        "OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID",
        "系统运行控制配置无效，请联系管理员"
      );
    }

    if (
      config.mode === "all" ||
      (config.mode === "modules" && config.modules.has(module))
    ) {
      throw this.exception(
        "OPERATIONAL_WRITE_FREEZE_ACTIVE",
        "系统当前仅开放安全查询，请稍后刷新重试"
      );
    }

    return true;
  }

  private configuration(): OperationalWriteFreezeConfig | null {
    const rawMode =
      process.env.OPERATIONAL_WRITE_FREEZE_MODE?.trim() || "off";
    if (!MODES.has(rawMode as OperationalWriteFreezeMode)) return null;

    const rawModules =
      process.env.OPERATIONAL_WRITE_FREEZE_MODULES?.trim() ?? "";
    const values = rawModules === "" ? [] : rawModules.split(",");
    if (values.some((value) => value.trim() !== value || value === "")) {
      return null;
    }
    if (new Set(values).size !== values.length) return null;
    if (
      values.some(
        (value) => !MODULES.has(value as OperationalWriteModule)
      )
    ) {
      return null;
    }

    const mode = rawMode as OperationalWriteFreezeMode;
    if (mode === "modules" ? values.length === 0 : values.length > 0) {
      return null;
    }

    return {
      mode,
      modules: new Set(values as OperationalWriteModule[])
    };
  }

  private exception(code: string, message: string) {
    return new HttpException({ statusCode: 503, code, message }, 503);
  }
}
