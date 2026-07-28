import {
  CONTRACT_INVOICE_TYPES,
  CONTRACT_TAX_MODES,
  type ContractClauseDefinition,
  ContractInvoiceType,
  ContractSettlementMode,
  ContractTaxMode
} from "@jiangkong/shared-domain";
import { Type } from "class-transformer";
import {
  Allow,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  ValidateIf,
  ValidateNested
} from "class-validator";
import { SaveContractDraftPartyDto } from "../../business-party/dto/business-party.dto";
import { SaveContractBillRowDto } from "../../contract-bill/dto/contract-bill.dto";
import { CreatePaymentTermsStageDto } from "../../contract/dto/create-contract.dto";
import {
  IsCanonicalMoneyText,
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";
import { API_VALIDATION_ERROR_CODE } from "../../validation/api-validation";

export class SaveContractTaxFactsDto {
  @ValidateIf((_object, value) => value !== null)
  @IsIn(CONTRACT_INVOICE_TYPES, { message: "发票类型不正确" })
  invoiceType!: ContractInvoiceType | null;

  @IsIn(CONTRACT_TAX_MODES, { message: "合同税率模式不正确" })
  taxMode!: ContractTaxMode;

  @ValidateIf((_object, value) => value !== null)
  @IsRequiredText({
    requiredMessage: "默认税率不能为空",
    typeMessage: "默认税率必须是十进制文字",
    blankMessage: "默认税率不能为空白"
  })
  defaultTaxRatePercent!: string | null;

  @IsIn(["contract_document"], { message: "合同税务事实来源不正确" })
  source!: "contract_document";
}

export interface SaveContractDraftDto {
  expectedRevision: number;
  companyEntityId?: string;
  draftData: Record<string, unknown>;
  clauses: ContractClauseDefinition[];
  pricingNature: "fixed_total" | "provisional_total" | "unit_price" | "framework";
  amountSource: "bill_sum" | "manual";
  manualAmountCents?: string;
  amountAdjustmentReason?: string;
  layoutTemplateVersionId?: string;
  paymentTermsOriginalText?: string;
  paymentStages?: Array<{
    name: string;
    basis: "current_settlement" | "contract_amount";
    ratioBps: number;
    triggerEvent: string;
    dueDays: number;
    requiresInvoice: boolean;
    allowsInstallments: boolean;
    originalText: string;
  }>;
  taxFacts: SaveContractTaxFactsDto;
}

export interface CreateDraftCheckpointDto {
  name?: string;
}

export interface ConfirmContractSettlementModeDto {
  expectedRevision: number;
  settlementMode: ContractSettlementMode;
}

export interface VoidDraftDto {
  reason: string;
}

export interface PreviewContractTypeChangeDto {
  targetBusinessTemplateVersionId: string;
  expectedRevision: number;
}

export interface ApplyContractTypeChangeDto extends PreviewContractTypeChangeDto {
  confirmed: true;
}

export interface TransferContractDraftDto {
  toUserId: string;
}

export interface ContractDraftLeaseReadModel {
  state: "available" | "held_by_me" | "held_by_other" | "expired";
  holderDisplayName: string | null;
  expiresAt: string | null;
  canTakeOver: boolean;
}

const CONTRACT_DRAFT_CHANGED_SECTIONS = [
  "draft",
  "parties",
  "bills",
  "payment_terms",
  "attachments",
  "negotiation_documents"
] as const;

type ContractDraftChangedSection =
  (typeof CONTRACT_DRAFT_CHANGED_SECTIONS)[number];

function partyPosition(party: SaveContractDraftPartyDto) {
  return party.roleKey;
}

function billKey(bill: SaveContractDraftBillDto) {
  return bill.billKey;
}

function billRowKey(row: SaveContractBillRowDto) {
  return row.rowKey ?? row.clientRowKey;
}

function attachmentPosition(attachment: SaveContractDraftAttachmentDto) {
  return `${attachment.slotKey}:${attachment.displayOrder}`;
}

export class SaveContractClauseDto implements ContractClauseDefinition {
  @IsRequiredText({
    requiredMessage: "合同条款键不能为空",
    typeMessage: "合同条款键必须是文字",
    blankMessage: "合同条款键不能为空白"
  })
  key!: string;

  @IsRequiredText({
    requiredMessage: "合同条款标题不能为空",
    typeMessage: "合同条款标题必须是文字",
    blankMessage: "合同条款标题不能为空白"
  })
  title!: string;

  @IsIn(["automatic", "fixed"], { message: "合同条款编号方式不正确" })
  numberingMode!: "automatic" | "fixed";

  @IsOptional()
  @IsBoolean({ message: "合同条款必填标记必须是布尔值" })
  required?: boolean;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "标准条款版本编号不能为空",
    typeMessage: "标准条款版本编号必须是文字",
    blankMessage: "标准条款版本编号不能为空白"
  })
  standardClauseVersionId?: string;

  @Allow()
  content!: unknown;
}

export class SaveContractDraftFieldsDto {
  @IsOptional()
  @IsRequiredText({
    requiredMessage: "公司主体编号不能为空",
    typeMessage: "公司主体编号必须是文字",
    blankMessage: "公司主体编号不能为空白"
  })
  companyEntityId?: string;

  @IsObject({ message: "合同草稿字段必须是对象" })
  draftData!: Record<string, unknown>;

  @IsArray({ message: "合同条款必须是数组" })
  @ValidateNested({ each: true, message: "每条合同条款必须是对象" })
  @Type(() => SaveContractClauseDto)
  clauses!: SaveContractClauseDto[];

  @IsIn(["fixed_total", "provisional_total", "unit_price", "framework"], {
    message: "合同计价性质不正确"
  })
  pricingNature!:
    | "fixed_total"
    | "provisional_total"
    | "unit_price"
    | "framework";

  @IsIn(["bill_sum", "manual"], { message: "合同金额来源不正确" })
  amountSource!: "bill_sum" | "manual";

  @IsOptional()
  @IsCanonicalMoneyText({
    typeMessage: "手工合同金额必须是整数字符串",
    formatMessage: "手工合同金额必须按分填写为 0 或更大的整数"
  })
  manualAmountCents?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "合同金额调整原因不能为空",
    typeMessage: "合同金额调整原因必须是文字",
    blankMessage: "合同金额调整原因不能为空白"
  })
  amountAdjustmentReason?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "版式模板版本编号不能为空",
    typeMessage: "版式模板版本编号必须是文字",
    blankMessage: "版式模板版本编号不能为空白"
  })
  layoutTemplateVersionId?: string;

  @IsObject({ message: "合同税务事实必须是对象" })
  @ValidateNested({ message: "合同税务事实必须是对象" })
  @Type(() => SaveContractTaxFactsDto)
  taxFacts!: SaveContractTaxFactsDto;
}

export class SaveContractDraftBillDto {
  @IsRequiredText({
    requiredMessage: "合同清单键不能为空",
    typeMessage: "合同清单键必须是文字",
    blankMessage: "合同清单键不能为空白"
  })
  billKey!: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "合同清单修订必须是整数",
    rangeMessage: "合同清单修订必须大于等于 0"
  })
  expectedRevision!: number;

  @IsArray({ message: "合同清单行必须是数组" })
  @ArrayUnique(billRowKey, { message: "同一合同清单内的行键不能重复" })
  @ValidateNested({ each: true, message: "每条合同清单行必须是对象" })
  @Type(() => SaveContractBillRowDto)
  rows!: SaveContractBillRowDto[];
}

export class SaveContractDraftPaymentTermsDto {
  @IsRequiredText({
    requiredMessage: "付款条款原文不能为空",
    typeMessage: "付款条款原文必须是文字",
    blankMessage: "付款条款原文不能为空白"
  })
  originalText!: string;

  @IsArray({ message: "付款阶段必须是数组" })
  @ValidateNested({ each: true, message: "每条付款阶段必须是对象" })
  @Type(() => CreatePaymentTermsStageDto)
  stages!: CreatePaymentTermsStageDto[];
}

export class SaveContractDraftAttachmentDto {
  @IsRequiredText({
    requiredMessage: "附件位置不能为空",
    typeMessage: "附件位置必须是文字",
    blankMessage: "附件位置不能为空白"
  })
  slotKey!: string;

  @IsRequiredText({
    requiredMessage: "附件文件编号不能为空",
    typeMessage: "附件文件编号必须是文字",
    blankMessage: "附件文件编号不能为空白"
  })
  fileId!: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "附件顺序必须是整数",
    rangeMessage: "附件顺序必须大于等于 0"
  })
  displayOrder!: number;
}

export class SaveContractDraftNegotiationDocumentsDto {
  @IsOptional()
  @IsRequiredText({
    requiredMessage: "磋商轮次编号不能为空",
    typeMessage: "磋商轮次编号必须是文字",
    blankMessage: "磋商轮次编号不能为空白"
  })
  selectedNegotiationRoundId?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "线下磋商修订编号不能为空",
    typeMessage: "线下磋商修订编号必须是文字",
    blankMessage: "线下磋商修订编号不能为空白"
  })
  selectedOfflineRevisionId?: string;

  @IsArray({ message: "引用生成文档编号必须是数组" })
  @ArrayUnique({ message: "引用生成文档编号不能重复" })
  @IsString({
    each: true,
    message: "引用生成文档编号必须是文字"
  })
  @Matches(/\S/u, {
    each: true,
    message: "引用生成文档编号不能为空白"
  })
  referencedGeneratedDocumentIds!: string[];
}

export class SaveContractDraftAggregateDto {
  static readonly [API_VALIDATION_ERROR_CODE] = "DRAFT_VALIDATION_FAILED";

  @IsUUID("4", { message: "保存幂等键必须是 UUID" })
  idempotencyKey!: string;

  @IsIn(["auto", "manual"], { message: "草稿保存类型不正确" })
  saveKind!: "auto" | "manual";

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "合同草稿修订必须是整数",
    rangeMessage: "合同草稿修订必须大于等于 0"
  })
  expectedRevision!: number;

  @IsArray({ message: "变化分区必须是数组" })
  @ArrayNotEmpty({ message: "变化分区不能为空" })
  @ArrayUnique({ message: "变化分区不能重复" })
  @IsIn(CONTRACT_DRAFT_CHANGED_SECTIONS, {
    each: true,
    message: "变化分区不正确"
  })
  changedSections!: ContractDraftChangedSection[];

  @IsObject({ message: "合同草稿快照必须是对象" })
  @ValidateNested({ message: "合同草稿快照必须是对象" })
  @Type(() => SaveContractDraftFieldsDto)
  draft!: SaveContractDraftFieldsDto;

  @IsArray({ message: "合同主体必须是数组" })
  @ArrayUnique(partyPosition, { message: "合同主体位置不能重复" })
  @ValidateNested({ each: true, message: "每个合同主体必须是对象" })
  @Type(() => SaveContractDraftPartyDto)
  parties!: SaveContractDraftPartyDto[];

  @IsArray({ message: "合同清单必须是数组" })
  @ArrayUnique(billKey, { message: "合同清单键不能重复" })
  @ValidateNested({ each: true, message: "每份合同清单必须是对象" })
  @Type(() => SaveContractDraftBillDto)
  bills!: SaveContractDraftBillDto[];

  @ValidateIf((_object, value) => value !== null)
  @IsObject({ message: "付款条款必须是对象或 null" })
  @ValidateNested({ message: "付款条款必须是对象或 null" })
  @Type(() => SaveContractDraftPaymentTermsDto)
  paymentTerms!: SaveContractDraftPaymentTermsDto | null;

  @IsArray({ message: "合同草稿附件必须是数组" })
  @ArrayUnique(attachmentPosition, { message: "合同草稿附件位置不能重复" })
  @ValidateNested({ each: true, message: "每个合同草稿附件必须是对象" })
  @Type(() => SaveContractDraftAttachmentDto)
  attachments!: SaveContractDraftAttachmentDto[];

  @IsObject({ message: "磋商文档选择必须是对象" })
  @ValidateNested({ message: "磋商文档选择必须是对象" })
  @Type(() => SaveContractDraftNegotiationDocumentsDto)
  negotiationDocuments!: SaveContractDraftNegotiationDocumentsDto;
}

export class DeleteContractDraftDto {
  static readonly [API_VALIDATION_ERROR_CODE] = "DRAFT_VALIDATION_FAILED";

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "合同草稿修订必须是整数",
    rangeMessage: "合同草稿修订必须大于 0"
  })
  expectedRevision!: number;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "主管代清理原因不能为空",
    typeMessage: "主管代清理原因必须是文字",
    blankMessage: "主管代清理原因不能为空白"
  })
  @MaxLength(200, { message: "主管代清理原因不能超过 200 个字" })
  reason?: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "当前密码不能为空",
    typeMessage: "当前密码必须是文字",
    blankMessage: "当前密码不能为空白"
  })
  @MaxLength(256, { message: "当前密码长度不正确" })
  currentPassword?: string;
}

export class SubmitContractDraftDto {
  static readonly [API_VALIDATION_ERROR_CODE] = "DRAFT_VALIDATION_FAILED";

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "合同草稿修订必须是整数",
    rangeMessage: "合同草稿修订必须大于 0"
  })
  expectedRevision!: number;

  @IsUUID("4", { message: "提交幂等键必须是 UUID" })
  idempotencyKey!: string;
}
