import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../auth/auth.types";
import {
  CONTRACT_CUTOVER_LEGACY_WRITE_KEY,
  CONTRACT_CUTOVER_SURFACE_KEY,
  CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY
} from "./contract-cutover.decorators";

type ContractCutoverMode =
  | "release-a"
  | "maintenance"
  | "release-b-maintenance"
  | "release-b";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MODES = new Set<ContractCutoverMode>([
  "release-a",
  "maintenance",
  "release-b-maintenance",
  "release-b"
]);

@Injectable()
export class ContractCutoverGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isCutoverSurface = this.reflector.getAllAndOverride<boolean>(
      CONTRACT_CUTOVER_SURFACE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!isCutoverSurface) return true;

    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & { method?: string }
    >();
    if (!request.user) return true;
    if (SAFE_METHODS.has((request.method ?? "GET").toUpperCase())) return true;

    const mode = this.mode();
    if (!mode) {
      throw new HttpException(
        {
          statusCode: 503,
          code: "CONTRACT_CUTOVER_CONFIGURATION_INVALID",
          message: "合同工作台切换配置无效，请联系管理员"
        },
        503
      );
    }

    const isLegacyWrite = this.reflector.getAllAndOverride<boolean>(
      CONTRACT_CUTOVER_LEGACY_WRITE_KEY,
      [context.getHandler(), context.getClass()]
    );
    const isTombstoneWrite = this.reflector.getAllAndOverride<boolean>(
      CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (isTombstoneWrite) {
      throw this.clientUpgradeException();
    }
    if (
      isLegacyWrite &&
      (mode === "release-b-maintenance" || mode === "release-b")
    ) {
      throw this.clientUpgradeException();
    }

    if (mode === "maintenance") {
      throw this.maintenanceException();
    }
    if (
      mode === "release-b-maintenance" &&
      !this.canaryUserIds().has(request.user.id)
    ) {
      throw this.maintenanceException();
    }

    return true;
  }

  private mode(): ContractCutoverMode | null {
    const configured =
      process.env.CONTRACT_CUTOVER_MODE?.trim() || "release-a";
    return MODES.has(configured as ContractCutoverMode)
      ? (configured as ContractCutoverMode)
      : null;
  }

  private canaryUserIds(): Set<string> {
    return new Set(
      (process.env.CONTRACT_CUTOVER_CANARY_USER_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
  }

  private maintenanceException(): HttpException {
    return new HttpException(
      {
        statusCode: 503,
        code: "CONTRACT_CUTOVER_MAINTENANCE",
        message: "合同工作台正在升级维护，请稍后刷新重试"
      },
      503
    );
  }

  private clientUpgradeException(): HttpException {
    return new HttpException(
      {
        statusCode: 410,
        code: "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED",
        message: "合同工作台已升级，请刷新页面后继续办理"
      },
      410
    );
  }
}
