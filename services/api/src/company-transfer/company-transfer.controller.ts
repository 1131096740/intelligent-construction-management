import * as ExcelJS from "exceljs";
import { buildLedgerWorkbook, XLSX_MIME } from "../core-flow/ledger-excel";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CompanyTransferService, type CreateCompanyTransfer } from "./company-transfer.service";
import { CompanyTransferReadService } from "./company-transfer-read.service";
@Controller("company-transfers")
export class CompanyTransferController {
  constructor(private readonly service: CompanyTransferService, private readonly reader: CompanyTransferReadService, private readonly audit: AuditService, private readonly prisma: PrismaService) { }
  @Get() list(@CurrentUser() u: AuthenticatedUser, @Query() q: { projectId?: string; companyId?: string; asOf?: string; projectsOnly?: string; page?: string }) { return this.reader.list(u.id, q); }
  @Get("export") async export(@CurrentUser() u: AuthenticatedUser, @Query() q: { projectId?: string; companyId?: string; asOf?: string; projectsOnly?: string }, @Res({ passthrough: true }) response: { set: (v: Record<string, string>) => void }) {
    const result = await this.reader.list(u.id, q, true), amount = (s: string) => formatMoneyCentsAsYuan(BigInt(s));
    const buffer = await buildLedgerWorkbook({ sheetName: "公司互转台账", columns: [{ header: "申请编号", key: "code" }, { header: "类别", key: "kindLabel" }, { header: "转出公司", key: "sourceCompany" }, { header: "转出归属", key: "sourceScope" }, { header: "转入公司", key: "destinationCompany" }, { header: "转入归属", key: "destinationScope" }, { header: "申请金额（元）", key: "amount" }, { header: "已出款（元）", key: "sent" }, { header: "已到账（元）", key: "received" }, { header: "已退回（元）", key: "returned" }, { header: "在途（元）", key: "transit" }, { header: "状态", key: "statusLabel" }, { header: "用途", key: "reason" }, { header: "基准日", key: "asOf" }], rows: result.rows.map(r => ({ ...r, amount: amount(r.amountCents), sent: amount(r.sentCents), received: amount(r.receivedCents), returned: amount(r.returnedCents), transit: amount(r.inTransitCents), asOf: result.asOf })) });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const balances = workbook.addWorksheet("资金往来余额"); balances.addRow(["公司", "资金归属", "互转资金净变化（元）", "在途（元）", "借款应收（元）", "借款应还（元）", "旧代付应收（元）", "旧代付应还（元）", "基准日"]);
    for (const b of result.balances) balances.addRow([b.companyName, b.projectId ? result.projects.find(p => p.id === b.projectId)?.name ?? "项目资金" : "公司自有资金", amount(b.cashChangeCents), amount(b.inTransitCents), amount(b.receivableCents), amount(b.payableCents), amount(b.legacyReceivableCents ?? "0"), amount(b.legacyPayableCents ?? "0"), result.asOf]);
    const originals = workbook.addWorksheet("已有往来归还余额"); originals.addRow(["原往来", "归还方公司", "收款方公司", "基准日未清（元）", "当前可申请（元）", "基准日"]); for (const r of result.legacyOptions) originals.addRow([r.reference, result.companies.find(c => c.id === r.sourceCompanyId)?.name ?? "原公司", result.companies.find(c => c.id === r.destinationCompanyId)?.name ?? "原公司", amount(r.remainingCents), amount(r.availableCents), result.asOf]);
    const output = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.audit.record(this.prisma, { actorUserId: u.id, action: "company_transfer.export", businessType: "company_transfer", metadata: { projectId: q.projectId, companyId: q.companyId, asOf: result.asOf, rows: result.rows.length } });
    response.set({ "Content-Type": XLSX_MIME, "Content-Length": String(output.length), "Content-Disposition": "attachment; filename=company-transfers.xlsx" }); return new StreamableFile(output);
  }
  @Get(":id/banks") banks(@CurrentUser() u: AuthenticatedUser, @Param("id") id: string, @Query("kind") kind: string) { return this.reader.banks(u.id, id, kind); }
  @Post() create(@CurrentUser() u: AuthenticatedUser, @Body() b: CreateCompanyTransfer) { return this.service.create(u.id, b); }
  @Post(":id/decision") decide(@CurrentUser() u: AuthenticatedUser, @Param("id") id: string, @Body() b: Parameters<CompanyTransferService["decide"]>[2]) { return this.service.decide(u.id, id, b); }
  @Post(":id/events") execute(@CurrentUser() u: AuthenticatedUser, @Param("id") id: string, @Body() b: Parameters<CompanyTransferService["execute"]>[2]) { return this.service.execute(u.id, id, b); }
}
