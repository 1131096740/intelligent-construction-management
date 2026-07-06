import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../database/prisma.service";
import type { AuthenticatedRequest } from "../auth.types";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { JwtTokenService } from "../jwt-token.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: JwtTokenService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    const payload = this.tokens.verifyAccessToken(token);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user?.isActive) {
      throw new UnauthorizedException("Invalid access token");
    }

    if (user.mustChangePassword && !this.isPasswordChangeRequest(request)) {
      throw new ForbiddenException("Password change required");
    }

    request.user = {
      id: user.id,
      name: user.name,
      phone: user.phone
    };

    return true;
  }

  private extractToken(request: AuthenticatedRequest) {
    const header = request.headers?.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;

    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing access token");
    }

    return authorization.slice("Bearer ".length);
  }

  private isPasswordChangeRequest(request: AuthenticatedRequest) {
    const httpRequest = request as AuthenticatedRequest & {
      path?: string;
      route?: { path?: string };
      url?: string;
    };
    const path = httpRequest.route?.path ?? httpRequest.path ?? httpRequest.url ?? "";
    return path.includes("/auth/change-password") || path.includes("auth/change-password");
  }
}
