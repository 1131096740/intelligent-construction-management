import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException
} from "@nestjs/common";
import type { AuthenticatedRequest, AuthenticatedUser } from "../auth.types";

/**
 * 从已通过 JwtAuthGuard 的请求中取出登录用户。
 *
 * 操作人身份**只**来自登录态（access token），不再信任请求体里的 `*ByUserId`。
 * 工厂函数单独导出，便于单测。
 */
export function currentUserFactory(
  _data: unknown,
  context: ExecutionContext
): AuthenticatedUser {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

  if (!request.user) {
    throw new UnauthorizedException("Authenticated user is required");
  }

  return request.user;
}

export const CurrentUser = createParamDecorator(currentUserFactory);
