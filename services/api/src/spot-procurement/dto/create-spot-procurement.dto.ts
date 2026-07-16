import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  registerDecorator,
  ValidateIf,
  ValidateNested,
  type ValidationArguments
} from "class-validator";
import {
  INVOICE_MODES,
  VAT_INVOICE_TYPES,
  type InvoiceMode,
  type VatInvoiceType
} from "@jiangkong/shared-domain";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";
import {
  isSpotProcurementQuantity,
  isSpotProcurementUnitPrice
} from "../spot-procurement-money";

const ATTACHMENT_CATEGORIES = [
  "merchant_quote",
  "material_list",
  "reference_photo",
  "other"
] as const;

export type SpotProcurementAttachmentCategory =
  (typeof ATTACHMENT_CATEGORIES)[number];

function IsSpotProcurementQuantity(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "spotProcurementQuantity",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message:
          "采购数量必须是大于 0、最多 6 位小数且可保存的普通十进制字符串"
      },
      validator: { validate: isSpotProcurementQuantity }
    });
  };
}

function IsSpotProcurementUnitPrice(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "spotProcurementUnitPrice",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message:
          "采购单价必须是大于等于 0、最多 6 位小数且可保存的普通十进制字符串"
      },
      validator: { validate: isSpotProcurementUnitPrice }
    });
  };
}

function IsOptionalNullableNonBlankText(messages: {
  typeMessage: string;
  blankMessage: string;
}): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "spotProcurementOptionalNullableTextType",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: messages.typeMessage },
      validator: {
        validate: (value: unknown) =>
          value === undefined || value === null || typeof value === "string"
      }
    });
    registerDecorator({
      name: "spotProcurementOptionalNullableTextBlank",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: messages.blankMessage },
      validator: {
        validate: (value: unknown) =>
          value === undefined ||
          value === null ||
          typeof value !== "string" ||
          value.trim().length > 0
      }
    });
  };
}

function IsValidInvoiceFieldCombination(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "spotProcurementInvoiceFieldsRequired",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: "有票明细必须填写发票类型、税率选项和含税单价"
      },
      validator: {
        validate: (_value: unknown, arguments_: ValidationArguments) => {
          const line = arguments_.object as SpotProcurementLineDto;
          return (
            line.invoiceMode !== "invoice" ||
            (VAT_INVOICE_TYPES.includes(line.invoiceType as VatInvoiceType) &&
              typeof line.vatRateOptionId === "string" &&
              line.vatRateOptionId.trim().length > 0 &&
              isSpotProcurementUnitPrice(line.unitPrice))
          );
        }
      }
    });
    registerDecorator({
      name: "spotProcurementNoInvoiceFieldsAbsent",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: "无票明细不能填写发票类型或税率选项" },
      validator: {
        validate: (_value: unknown, arguments_: ValidationArguments) => {
          const line = arguments_.object as SpotProcurementLineDto;
          return (
            line.invoiceMode !== "no_invoice" ||
            (line.invoiceType === undefined &&
              line.vatRateOptionId === undefined)
          );
        }
      }
    });
  };
}

export class SpotProcurementLineDto {
  @IsRequiredText({
    requiredMessage: "请填写材料名称",
    typeMessage: "材料名称必须是文字",
    blankMessage: "材料名称不能为空白"
  })
  materialName!: string;

  @IsOptionalNonBlankText({
    typeMessage: "规格型号必须是文字",
    blankMessage: "规格型号不能为空白"
  })
  specification?: string;

  @IsRequiredText({
    requiredMessage: "请填写材料单位",
    typeMessage: "材料单位必须是文字",
    blankMessage: "材料单位不能为空白"
  })
  unit!: string;

  @IsSpotProcurementQuantity()
  quantity!: string;

  @IsIn(INVOICE_MODES, { message: "采购明细票据方式不正确" })
  @IsValidInvoiceFieldCombination()
  invoiceMode!: InvoiceMode;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(VAT_INVOICE_TYPES, { message: "采购明细发票类型不正确" })
  invoiceType?: VatInvoiceType;

  @IsOptionalNonBlankText({
    typeMessage: "税率选项编号必须是文字",
    blankMessage: "税率选项编号不能为空白"
  })
  vatRateOptionId?: string;

  @IsSpotProcurementUnitPrice()
  unitPrice!: string;

  @IsOptionalNonBlankText({
    typeMessage: "使用部位或用途必须是文字",
    blankMessage: "使用部位或用途不能为空白"
  })
  usageLocation?: string;

  @IsOptionalNonBlankText({
    typeMessage: "采购明细备注必须是文字",
    blankMessage: "采购明细备注不能为空白"
  })
  note?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "采购明细展示金额格式不正确",
    formatMessage: "采购明细展示金额必须按分填写为 0 或更大的整数",
    rangeMessage: "采购明细展示金额超出系统可保存范围"
  })
  amountCents?: string;
}

export class SpotProcurementAttachmentDto {
  @IsRequiredText({
    requiredMessage: "请选择采购附件",
    typeMessage: "采购附件编号必须是文字",
    blankMessage: "采购附件编号不能为空白"
  })
  fileId!: string;

  @IsIn(ATTACHMENT_CATEGORIES, { message: "采购附件类别不正确" })
  category!: SpotProcurementAttachmentCategory;
}

export class SpotProcurementDraftDto {
  @IsOptionalNullableNonBlankText({
    typeMessage: "合作单位编号必须是文字",
    blankMessage: "合作单位编号不能为空白"
  })
  supplierPartyId?: string | null;

  @IsRequiredText({
    requiredMessage: "请填写供应商名称",
    typeMessage: "供应商名称必须是文字",
    blankMessage: "供应商名称不能为空白"
  })
  supplierName!: string;

  @IsOptionalNonBlankText({
    typeMessage: "采购经办人编号必须是文字",
    blankMessage: "采购经办人编号不能为空白"
  })
  handlerUserId?: string;

  @IsRequiredText({
    requiredMessage: "请填写采购原因",
    typeMessage: "采购原因必须是文字",
    blankMessage: "采购原因不能为空白"
  })
  reason!: string;

  @IsOptionalNullableNonBlankText({
    typeMessage: "采购备注必须是文字",
    blankMessage: "采购备注不能为空白"
  })
  note?: string | null;

  @IsArray({ message: "采购明细必须是数组" })
  @ArrayMinSize(1, { message: "请至少填写一条采购明细" })
  @ValidateNested({ each: true, message: "每条采购明细必须是对象" })
  @Type(() => SpotProcurementLineDto)
  lines!: SpotProcurementLineDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "采购附件必须是数组" })
  @ValidateNested({ each: true, message: "每条采购附件必须是对象" })
  @Type(() => SpotProcurementAttachmentDto)
  attachments?: SpotProcurementAttachmentDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "采购展示合计格式不正确",
    formatMessage: "采购展示合计必须按分填写为 0 或更大的整数",
    rangeMessage: "采购展示合计超出系统可保存范围"
  })
  totalAmountCents?: string;
}

export class CreateSpotProcurementDto extends SpotProcurementDraftDto {
  @IsRequiredText({
    requiredMessage: "请选择采购项目",
    typeMessage: "采购项目编号必须是文字",
    blankMessage: "请选择采购项目"
  })
  projectId!: string;

  @IsRequiredText({
    requiredMessage: "请填写采购编号",
    typeMessage: "采购编号必须是文字",
    blankMessage: "采购编号不能为空白"
  })
  code!: string;
}
