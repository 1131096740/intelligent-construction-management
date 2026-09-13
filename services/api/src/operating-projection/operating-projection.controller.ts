import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile
} from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { OperatingProjectionExportDto } from "./dto/operating-projection-export.dto";
import {
  OperatingProjectionAsOfDetailQueryDto,
  OperatingProjectionAsOfQueryDto,
  OperatingProjectionCompanyDetailQueryDto,
  OperatingProjectionCompanyQueryDto,
  OperatingProjectionProjectDetailQueryDto,
  OperatingProjectionProjectQueryDto,
  type OperatingProjectionScopedQueryDto
} from "./dto/operating-projection-query.dto";
import { OperatingProjectionService } from "./operating-projection.service";

@Controller("operating-projections")
@RequirePositions(...PROJECT_OVERVIEW_READ_POSITION_KEYS)
export class OperatingProjectionController {
  constructor(private readonly projections: OperatingProjectionService) {}

  @Get("project/:projectId")
  project(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: OperatingProjectionProjectQueryDto
  ) {
    return this.projections.getProjectView(user.id, {
      projectId,
      ...filtersAndAsOf(query)
    });
  }

  @Get("project/:projectId/details")
  @RequirePositions("finance_staff", "finance_director")
  projectDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: OperatingProjectionProjectDetailQueryDto
  ) {
    return this.projections.getProjectDetailPage(user.id, {
      projectId,
      ...query
    });
  }

  @Get("company/:companyEntityId")
  company(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyEntityId") companyEntityId: string,
    @Query() query: OperatingProjectionCompanyQueryDto
  ) {
    return this.projections.getCompanyView(user.id, {
      ...filtersAndAsOf(query),
      companyEntityId
    });
  }

  @Get("company/:companyEntityId/details")
  @RequirePositions("finance_staff", "finance_director")
  companyDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyEntityId") companyEntityId: string,
    @Query() query: OperatingProjectionCompanyDetailQueryDto
  ) {
    return this.projections.getCompanyDetailPage(user.id, {
      ...query,
      companyEntityId
    });
  }

  @Get("as-of")
  asOf(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OperatingProjectionAsOfQueryDto
  ) {
    return this.projections.getAsOfView(user.id, asOfQuery(query));
  }

  @Get("as-of/details")
  @RequirePositions("finance_staff", "finance_director")
  asOfDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OperatingProjectionAsOfDetailQueryDto
  ) {
    return this.projections.getAsOfDetailPage(user.id, query);
  }

  @Post("export")
  @RequirePositions("finance_staff", "finance_director")
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: OperatingProjectionExportDto
  ) {
    const exported = await this.projections.exportView(
      user.id,
      asOfQuery({ ...body }),
      body.confirmationPassword
    );
    return new StreamableFile(exported.stream, {
      type: exported.contentType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`
    });
  }
}

function filtersAndAsOf(query: OperatingProjectionScopedQueryDto) {
  return {
    asOf: query.asOf,
    constructionEnterpriseId: query.constructionEnterpriseId,
    companyEntityId: query.companyEntityId,
    counterpartyId: query.counterpartyId,
    costCategoryCode: query.costCategoryCode,
    sourceType: query.sourceType
  };
}

export function asOfQuery(query: {
  scopeKind?: string;
  projectId?: string;
  projectIds?: string;
  companyEntityId?: string;
} & OperatingProjectionScopedQueryDto) {
  if (!query.scopeKind || !["project", "company", "projects"].includes(query.scopeKind)) {
    throw new BadRequestException("经营投影范围必须是单项目、公司或多项目");
  }
  const scopeKind = query.scopeKind as "project" | "company" | "projects";
  return {
    ...filtersAndAsOf(query),
    scopeKind,
    projectId: query.projectId,
    companyEntityId: query.companyEntityId,
    projectIds: query.projectIds
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}
