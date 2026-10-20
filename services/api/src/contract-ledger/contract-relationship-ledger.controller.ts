import { ContractClassificationPreflightService } from "./contract-classification-preflight.service";
import { buildLedgerWorkbook, XLSX_MIME } from "../core-flow/ledger-excel";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";
import { Controller, Get, Query, Res, StreamableFile } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractRelationshipLedgerService, type RelationshipLedgerQuery } from "./contract-relationship-ledger.service";
@Controller("contract-relationship-ledger")
@RequirePositions(...LEDGER_READ_POSITION_KEYS)
export class ContractRelationshipLedgerController {
  constructor(private readonly ledger: ContractRelationshipLedgerService, private readonly audit: AuditService, private readonly prisma: PrismaService,private readonly preflight:ContractClassificationPreflightService) {}
  @Get("preflight") inspect(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.preflight.inspect(user.id,projectId);}
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: RelationshipLedgerQuery) {
    return this.ledger.list(user.id, query);
  }
  @Get("export")
  async export(@CurrentUser() user: AuthenticatedUser, @Query() query: RelationshipLedgerQuery,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }) {
    const result = await this.ledger.list(user.id, query);
    const buffer = await buildLedgerWorkbook({ sheetName: "签约关系分类台账", columns: [
      { header: "项目", key: "projectName" }, { header: "合同分类", key: "relationshipLabel" },
      { header: "业务编号/期间", key: "reference" }, { header: "签约/原债务主体", key: "signingParty" },
      { header: "相对方", key: "counterparty" }, { header: "金额性质", key: "amountLabel" },
      { header: "计入汇总金额（元）", key: "amount" }, { header: "原文书金额（元）", key: "documentAmount" }, { header: "统计基准日", key: "asOf" }, { header: "实际付款方", key: "payer" },
      { header: "经营影响", key: "accountingEffect" }, { header: "事实日期", key: "occurredAt" },
      { header: "读取时间", key: "readAt" }, { header: "范围说明", key: "notice" }
    ], rows: result.rows.map((row) => ({ ...row, amount: row.amountCents === null ? "未定/待确认金额" : formatMoneyCentsAsYuan(BigInt(row.amountCents)),
      asOf: result.asOf, documentAmount: row.documentAmountCents ? formatMoneyCentsAsYuan(BigInt(row.documentAmountCents)) : "", payer: row.actualPayer ?? "不适用", readAt: result.readAt, notice: result.notice })) });
    await this.audit.record(this.prisma, { actorUserId: user.id, action: "contract.relationship_ledger.export", businessType: "contract_ledger",
      metadata: { section: query.section ?? "contracts", projectId: query.projectId ?? null, relationship: query.relationship ?? null,
        companyEntityId: query.companyEntityId ?? null, rows: result.rows.length, readAt: result.readAt } });
    response.set({ "Content-Type": XLSX_MIME, "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="contract-relationship-ledger.xlsx"; filename*=UTF-8''${encodeURIComponent("签约关系分类台账.xlsx")}` });
    return new StreamableFile(buffer);
  }

}
