import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  canPerform,
  COMPANY_ENTITY_MAINTAINER_ROLES,
  COMPANY_ENTITY_READER_ROLES,
  type RoleKey
} from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export {
  COMPANY_ENTITY_MAINTAINER_ROLES,
  COMPANY_ENTITY_READER_ROLES
} from "@jiangkong/shared-domain";

type CompanyEntityAccessClient = Pick<
  Prisma.TransactionClient,
  "userPosition" | "position" | "projectMember"
>;

@Injectable()
export class CompanyEntityAccess {
  constructor(private readonly prisma: PrismaService) {}

  assertCanMaintain(
    userId: string,
    client: CompanyEntityAccessClient = this.prisma
  ) {
    return this.assertAllowed(
      userId,
      COMPANY_ENTITY_MAINTAINER_ROLES,
      "当前账号没有公司级全局岗位，不能维护我方公司主体",
      client
    );
  }

  assertCanRead(
    userId: string,
    client: CompanyEntityAccessClient = this.prisma
  ) {
    return this.assertAllowed(
      userId,
      COMPANY_ENTITY_READER_ROLES,
      "当前账号没有公司级全局岗位，不能查看我方公司主体管理信息",
      client
    );
  }

  async assertCanSelect(
    userId: string,
    client: CompanyEntityAccessClient = this.prisma
  ): Promise<RoleKey> {
    const companyRoleKey = await this.findAllowedCompanyRole(
      userId,
      COMPANY_ENTITY_READER_ROLES,
      client
    );
    if (companyRoleKey) return companyRoleKey;

    const projectRoles = await client.projectMember.findMany({
      where: { userId },
      select: { positionKey: true }
    });
    const projectRoleKey = projectRoles
      .map((row) => row.positionKey as RoleKey)
      .find((roleKey) => canPerform("contract.create", [roleKey]));
    if (!projectRoleKey) {
      throw new ForbiddenException(
        "当前账号没有选择我方公司主体所需的岗位权限"
      );
    }
    return projectRoleKey;
  }

  private async assertAllowed<const T extends readonly RoleKey[]>(
    userId: string,
    allowed: T,
    message: string,
    client: CompanyEntityAccessClient
  ): Promise<T[number]> {
    const roleKey = await this.findAllowedCompanyRole(userId, allowed, client);
    if (!roleKey) throw new ForbiddenException(message);
    return roleKey;
  }

  private async findAllowedCompanyRole<const T extends readonly RoleKey[]>(
    userId: string,
    allowed: T,
    client: CompanyEntityAccessClient
  ): Promise<T[number] | undefined> {
    const positions = await client.userPosition.findMany({
      where: { userId, projectId: null },
      select: { positionId: true }
    });
    const roles = await client.position.findMany({
      where: { id: { in: positions.map((row) => row.positionId) } },
      select: { key: true }
    });
    const roleKey = allowed.find((key) =>
      roles.some((role) => role.key === key)
    );
    return roleKey;
  }
}
