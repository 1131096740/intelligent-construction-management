import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable
} from "@nestjs/common";
import {
  OPERATIONAL_WRITE_ALLOWED_ACTIONS,
  operationalWriteActionKey,
  operationalWriteModuleFor
} from "./operational-write-freeze.registry";
import { OperationalWriteFreezeService } from "./operational-write-freeze.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class OperationalWriteFreezeGuard implements CanActivate {
  constructor(private readonly writeFreeze: OperationalWriteFreezeService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; params?: Record<string, string | undefined>; body?: { confirmedReceipt?: unknown } }>();
    if (SAFE_METHODS.has((request.method ?? "GET").toUpperCase())) return true;

    const actionKey = operationalWriteActionKey(
      context.getClass(),
      context.getHandler()
    );
    if (OPERATIONAL_WRITE_ALLOWED_ACTIONS.has(actionKey)) return true;

    const module = operationalWriteModuleFor(context.getClass(), request);
    if (!module) {
      throw this.exception(
        "OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED",
        "该写操作尚未完成运行边界登记，请联系管理员"
      );
    }

    const newProjectFinancialWrite =
      actionKey === "ProjectController.recordOwnerSettlement" ||
      actionKey === "ProjectController.uploadOwnerSettlementFile" ||
      (actionKey === "ProjectController.recordUpstreamFundFact" && request.body?.confirmedReceipt === true);
    if (this.writeFreeze.isFrozen(module) || (newProjectFinancialWrite && this.writeFreeze.isFrozen("finance"))) {
      throw this.exception(
        "OPERATIONAL_WRITE_FREEZE_ACTIVE",
        "系统当前仅开放安全查询，请稍后刷新重试"
      );
    }

    return true;
  }
  private exception(code: string, message: string) {
    return new HttpException({ statusCode: 503, code, message }, 503);
  }
}
