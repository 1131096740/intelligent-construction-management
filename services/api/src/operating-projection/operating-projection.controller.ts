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
    const input = { projectId, ...filtersAndAsOf(query) };
    return query.numericProtocolVersion === "2"
      ? this.projections.getProjectView(user.id, { ...input, numericProtocolVersion: 2 })
      : this.projections.getProjectView(user.id, input);
  }

  @Get("project/:projectId/details")
  @RequirePositions("finance_staff", "finance_director")
  projectDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: OperatingProjectionProjectDetailQueryDto
  ) {
    const { numericProtocolVersion, ...detailQuery } = query;
    return this.projections.getProjectDetailPage(user.id, { projectId, ...detailQuery, ...(numericProtocolVersion === "2" ? { numericProtocolVersion: 2 } : {}) });
  }

  @Get("company/:companyEntityId")
  company(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyEntityId") companyEntityId: string,
    @Query() query: OperatingProjectionCompanyQueryDto
  ) {
    const input = { ...filtersAndAsOf(query), companyEntityId };
    return query.numericProtocolVersion === "2"
      ? this.projections.getCompanyView(user.id, { ...input, numericProtocolVersion: 2 })
      : this.projections.getCompanyView(user.id, input);
  }

  @Get("company/:companyEntityId/details")
  @RequirePositions("finance_staff", "finance_director")
  companyDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param("companyEntityId") companyEntityId: string,
    @Query() query: OperatingProjectionCompanyDetailQueryDto
  ) {
    const { numericProtocolVersion, ...detailQuery } = query;
    return this.projections.getCompanyDetailPage(user.id, { ...detailQuery, companyEntityId, ...(numericProtocolVersion === "2" ? { numericProtocolVersion: 2 } : {}) });
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
    const { numericProtocolVersion, ...detailQuery } = query;
    return this.projections.getAsOfDetailPage(user.id, { ...detailQuery, ...(numericProtocolVersion === "2" ? { numericProtocolVersion: 2 } : {}) });
  }

  @Post("export")
  @RequirePositions("finance_staff", "finance_director")
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: OperatingProjectionExportDto
  ) {
    const exported = await this.projections.exportView(
      user.id,
      { ...asOfQuery({ ...body }), occurredFrom: body.occurredFrom,
        occurredTo: body.occurredTo, rowStatus: body.rowStatus },
      body.confirmationPassword,
      body.exportKind
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
    contractRelationship: query.contractRelationship,
    sourceType: query.sourceType
  };
}

export function asOfQuery(query: {
  numericProtocolVersion?: "1" | "2";
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
    ...(query.numericProtocolVersion === "2" ? { numericProtocolVersion: 2 as const } : {}),
    scopeKind,
    projectId: query.projectId,
    companyEntityId: query.companyEntityId,
    projectIds: query.projectIds
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}
