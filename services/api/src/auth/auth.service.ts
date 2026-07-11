import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException
} from "@nestjs/common";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import * as bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type { AuthenticatedUser, AuthTokens } from "./auth.types";
import type { ChangePasswordDto } from "./dto/change-password.dto";
import type { LoginDto } from "./dto/login.dto";
import type { LogoutDto } from "./dto/logout.dto";
import type { RefreshTokenDto } from "./dto/refresh-token.dto";
import type { WxLoginDto } from "./dto/wx-login.dto";
import { JwtTokenService } from "./jwt-token.service";

const ROLE_KEY_SET = new Set<string>(ROLE_KEYS);

function isRoleKey(value: string): value is RoleKey {
  return ROLE_KEY_SET.has(value);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: JwtTokenService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  async login(input: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone }
    });

    if (!user?.isActive || !user.passwordHash) {
      throw new UnauthorizedException("手机号或密码不正确");
    }

    const passwordMatched = await bcrypt.compare(input.password, user.passwordHash);

    if (!passwordMatched) {
      throw new UnauthorizedException("手机号或密码不正确");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    await this.audit.record(this.prisma, {
      actorUserId: user.id,
      action: "auth.login",
      businessType: "user",
      businessId: user.id,
      metadata: { phone: user.phone }
    });

    const roleScopes = await this.loadUserRoleScopes(user.id);
    const tokens = await this.issueTokens({
      id: user.id,
      name: user.name,
      phone: user.phone
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        mustChangePassword: user.mustChangePassword,
        roleKeys: roleScopes.roleKeys,
        globalRoleKeys: roleScopes.globalRoleKeys
      },
      tokens
    };
  }

  private async loadUserRoleScopes(userId: string) {
    const [userPositions, projectMembers] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId } }),
      this.prisma.projectMember.findMany({ where: { userId } })
    ]);
    const positionIds = Array.from(new Set(userPositions.map((position) => position.positionId)));
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];

    const roleKeys = Array.from(
      new Set([
        ...positions.map((position) => position.key as RoleKey),
        ...projectMembers.map((member) => member.positionKey as RoleKey)
      ])
    );
    const globalPositionIds = new Set(
      userPositions
        .filter((assignment) => assignment.projectId === null)
        .map((assignment) => assignment.positionId)
    );
    const globalRoleKeys = Array.from(
      new Set(
        positions
          .filter((position) => globalPositionIds.has(position.id))
          .map((position) => position.key)
          .filter(isRoleKey)
      )
    );

    return { roleKeys, globalRoleKeys };
  }

  private userSummary(user: {
    id: string;
    name: string;
    phone: string | null;
    mustChangePassword: boolean;
  }, roleScopes: { roleKeys: RoleKey[]; globalRoleKeys: RoleKey[] }) {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      mustChangePassword: user.mustChangePassword,
      roleKeys: roleScopes.roleKeys,
      globalRoleKeys: roleScopes.globalRoleKeys
    };
  }

  async refresh(input: RefreshTokenDto) {
    const payload = this.tokens.verifyRefreshToken(input.refreshToken);
    const tokenHash = this.tokens.hashToken(input.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash }
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("刷新登录凭证无效，请重新登录");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user?.isActive) {
      throw new UnauthorizedException("刷新登录凭证无效，请重新登录");
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() }
    });

    const tokens = await this.issueTokens({
      id: user.id,
      name: user.name,
      phone: user.phone
    });

    return { tokens };
  }

  async logout(input: LogoutDto) {
    const tokenHash = this.tokens.hashToken(input.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash }
    });

    if (stored && !stored.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() }
      });
      await this.audit.record(this.prisma, {
        actorUserId: stored.userId,
        action: "auth.logout",
        businessType: "user",
        businessId: stored.userId
      });
    }

    return { ok: true };
  }

  async changePassword(user: AuthenticatedUser, input: ChangePasswordDto) {
    if (input.newPassword.length < 8) {
      throw new BadRequestException("新密码至少需要 8 个字符");
    }
    if (!/\S/u.test(input.newPassword)) {
      throw new BadRequestException("新密码不能全为空白字符");
    }

    const storedUser = await this.prisma.user.findUnique({
      where: { id: user.id }
    });

    if (!storedUser?.passwordHash) {
      throw new UnauthorizedException("当前账号无效，请重新登录");
    }

    const oldPasswordMatched = await bcrypt.compare(input.oldPassword, storedUser.passwordHash);

    if (!oldPasswordMatched) {
      throw new UnauthorizedException("当前密码不正确，请重新输入");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(input.newPassword, 10),
        mustChangePassword: false
      }
    });
    await this.audit.record(this.prisma, {
      actorUserId: user.id,
      action: "auth.password.change",
      businessType: "user",
      businessId: user.id
    });

    return { ok: true };
  }

  async confirmPassword(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user?.isActive || !user.passwordHash) {
      throw new UnauthorizedException("当前密码不正确，请重新输入");
    }

    const passwordMatched = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatched) {
      throw new UnauthorizedException("当前密码不正确，请重新输入");
    }

    return { ok: true };
  }

  async wxLogin(input: WxLoginDto) {
    const session = await this.fetchWxSession(input.code);
    const user = await this.prisma.user.findUnique({
      where: { wxOpenid: session.openid }
    });

    if (!user?.isActive) {
      return {
        bindingRequired: true
      };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    await this.audit.record(this.prisma, {
      actorUserId: user.id,
      action: "auth.wx_login",
      businessType: "user",
      businessId: user.id
    });

    const roleScopes = await this.loadUserRoleScopes(user.id);
    const tokens = await this.issueTokens({
      id: user.id,
      name: user.name,
      phone: user.phone
    });

    return {
      user: this.userSummary(user, roleScopes),
      tokens
    };
  }

  async issueTokens(user: AuthenticatedUser): Promise<AuthTokens> {
    const accessToken = this.tokens.signAccessToken(user);
    const refreshToken = this.tokens.signRefreshToken(user);
    const expiresAt = new Date(Date.now() + this.tokens.refreshTokenTtlSeconds() * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hashToken(refreshToken),
        expiresAt
      }
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTokenTtlSeconds()
    };
  }

  private async fetchWxSession(code: string) {
    const appId = process.env.WX_APP_ID ?? process.env.WECHAT_APP_ID;
    const secret = process.env.WX_APP_SECRET ?? process.env.WECHAT_APP_SECRET;

    if (!appId || !secret) {
      throw new BadRequestException("微信登录尚未配置，请联系管理员");
    }

    const params = new URLSearchParams({
      appid: appId,
      secret,
      js_code: code,
      grant_type: "authorization_code"
    });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`);
    const body = (await response.json()) as { openid?: string; errcode?: number; errmsg?: string };

    if (!response.ok || !body.openid) {
      this.logger.warn("微信登录会话接口返回失败", {
        status: response.status,
        errcode: typeof body.errcode === "number" ? body.errcode : null
      });
      throw new UnauthorizedException("微信登录失败，请重试");
    }

    return { openid: body.openid };
  }
}
