import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  registerDecorator,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";
import { isSpotProcurementQuantity } from "../spot-procurement-money";

const ATTACHMENT_CATEGORIES = [
  "merchant_quote",
  "material_list",
  "reference_photo",
  "other"
] as const;

export type SpotProcurementAttachmentCategory =
  (typeof ATTACHMENT_CATEGORIES)[number];

export function IsSpotProcurementQuantity(): PropertyDecorator {
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

  @IsOptionalNonBlankText({
    typeMessage: "采购明细备注必须是文字",
    blankMessage: "采购明细备注不能为空白"
  })
  note?: string;
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
  @IsRequiredText({
    requiredMessage: "请填写申请部门",
    typeMessage: "申请部门必须是文字",
    blankMessage: "申请部门不能为空白"
  })
  applicationDepartment!: string;

  @IsRequiredText({
    requiredMessage: "请填写申请人",
    typeMessage: "申请人必须是文字",
    blankMessage: "申请人不能为空白"
  })
  applicationName!: string;

  @IsDateString({}, { message: "要求采购到位日期格式不正确" })
  requestedArrivalAt!: string;

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
}

export class CreateSpotProcurementDto extends SpotProcurementDraftDto {
  @IsRequiredText({
    requiredMessage: "请选择采购项目",
    typeMessage: "采购项目编号必须是文字",
    blankMessage: "请选择采购项目"
  })
  projectId!: string;
}
