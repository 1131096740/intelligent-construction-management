import {
  Injectable,
  UnauthorizedException,
  BadRequestException
} from "@nestjs/common";
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

@Injectable()
export class AuthService {
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
      throw new UnauthorizedException("Invalid phone or password");
    }

    const passwordMatched = await bcrypt.compare(input.password, user.passwordHash);

    if (!passwordMatched) {
      throw new UnauthorizedException("Invalid phone or password");
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

    return this.issueTokens({
      id: user.id,
      name: user.name,
      phone: user.phone
    }).then((tokens) => ({
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        mustChangePassword: user.mustChangePassword
      },
      tokens
    }));
  }

  async refresh(input: RefreshTokenDto) {
    const payload = this.tokens.verifyRefreshToken(input.refreshToken);
    const tokenHash = this.tokens.hashToken(input.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash }
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user?.isActive) {
      throw new UnauthorizedException("Invalid refresh token");
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
      throw new BadRequestException("New password must be at least 8 characters");
    }

    const storedUser = await this.prisma.user.findUnique({
      where: { id: user.id }
    });

    if (!storedUser?.passwordHash) {
      throw new UnauthorizedException("Invalid user");
    }

    const oldPasswordMatched = await bcrypt.compare(input.oldPassword, storedUser.passwordHash);

    if (!oldPasswordMatched) {
      throw new UnauthorizedException("Invalid old password");
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

    return {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        mustChangePassword: user.mustChangePassword
      },
      tokens: await this.issueTokens({
        id: user.id,
        name: user.name,
        phone: user.phone
      })
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
      throw new BadRequestException("WeChat login is not configured");
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
      throw new UnauthorizedException(body.errmsg ?? "WeChat login failed");
    }

    return { openid: body.openid };
  }
}
