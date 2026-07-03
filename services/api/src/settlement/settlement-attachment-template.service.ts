import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

export const SETTLEMENT_ATTACHMENT_TEMPLATE_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface SettlementAttachmentTemplate {
  key: string;
  label: string;
  fileName: string;
  columns: string[];
}

const TEMPLATES: SettlementAttachmentTemplate[] = [
  {
    key: "receipt-form",
    label: "收方单",
    fileName: "收方单模板.xlsx",
    columns: ["日期", "项目名称", "合同名称", "收方部位", "工作内容", "单位", "数量", "现场确认人", "备注"]
  },
  {
    key: "labor-signoff",
    label: "签工单",
    fileName: "签工单模板.xlsx",
    columns: ["日期", "项目名称", "班组/人员", "工作内容", "工种", "人数", "工日", "现场负责人", "备注"]
  },
  {
    key: "sporadic-machinery-confirmation",
    label: "零星机械签认单",
    fileName: "零星机械签认单模板.xlsx",
    columns: ["日期", "项目名称", "机械名称", "规格型号", "作业内容", "单位", "数量", "驾驶员/机主", "现场确认人", "备注"]
  },
  {
    key: "shift-record",
    label: "台班记录表",
    fileName: "台班记录表模板.xlsx",
    columns: ["日期", "项目名称", "机械名称", "作业地点", "开始时间", "结束时间", "台班数量", "记录人", "确认人", "备注"]
  }
];

@Injectable()
export class SettlementAttachmentTemplateService {
  constructor(
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService()
  ) {}

  async exportTemplate(settlementId: string, templateKey: string, actorUserId: string) {
    const template = TEMPLATES.find((item) => item.key === templateKey);
    if (!template) {
      throw new BadRequestException("Unknown settlement attachment template");
    }
    const settlement = this.prisma
      ? await this.prisma.settlement.findFirst({
          where: { OR: [{ id: settlementId }, { code: settlementId }] },
          select: { id: true }
        })
      : { id: settlementId };
    if (!settlement) {
      throw new NotFoundException("Settlement not found");
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "建工智管";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(template.label);
    worksheet.addRow([`${template.label}（线下填写、签字盖章后上传为结算附件）`]);
    worksheet.mergeCells(1, 1, 1, template.columns.length);
    worksheet.getRow(1).font = { bold: true, size: 14 };
    worksheet.addRow(template.columns);
    worksheet.getRow(2).font = { bold: true };
    worksheet.addRow(template.columns.map(() => ""));
    worksheet.columns = template.columns.map((header) => ({
      key: header,
      width: Math.max(12, Math.min(24, header.length * 3))
    }));
    worksheet.views = [{ state: "frozen", ySplit: 2 }];

    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    if (this.prisma) {
      await this.audit.record(this.prisma, {
        actorUserId,
        action: "settlement.attachment_template.download",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: { templateKey, fileName: template.fileName }
      });
    }

    return {
      buffer,
      fileName: template.fileName,
      mimeType: SETTLEMENT_ATTACHMENT_TEMPLATE_MIME
    };
  }
}
