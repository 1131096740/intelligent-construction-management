import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsString,
  registerDecorator,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";
import {
  IsJsonSafeValue,
  JsonSafeTemplateBodyDto
} from "./template-json-validation";

function IsStringArrayItems(message: string): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "staticTemplateStringArrayItems",
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message },
      validator: {
        validate: (value) => !Array.isArray(value) || value.every((item) => typeof item === "string")
      }
    });
  };
}

export class ContractTemplateFieldOptionDto {
  @IsRequiredText({
    requiredMessage: "请填写字段选项名称",
    typeMessage: "字段选项名称必须是文字",
    blankMessage: "请填写字段选项名称"
  })
  label!: string;

  @IsRequiredText({
    requiredMessage: "请填写字段选项值",
    typeMessage: "字段选项值必须是文字",
    blankMessage: "请填写字段选项值"
  })
  value!: string;
}

export class ContractTemplateVisibleWhenDto {
  @IsRequiredText({
    requiredMessage: "请填写可见条件字段",
    typeMessage: "可见条件字段必须是文字",
    blankMessage: "请填写可见条件字段"
  })
  fieldKey!: string;

  @IsIn(["eq", "neq"], { message: "可见条件操作符不正确" })
  operator!: "eq" | "neq";

  @IsJsonSafeValue({ message: "可见条件值必须是可保存的 JSON 数据" })
  value!: unknown;
}

export class ContractTemplateFieldDto {
  @IsRequiredText({ requiredMessage: "请填写字段标识", typeMessage: "字段标识必须是文字", blankMessage: "请填写字段标识" })
  key!: string;

  @IsRequiredText({ requiredMessage: "请填写字段名称", typeMessage: "字段名称必须是文字", blankMessage: "请填写字段名称" })
  label!: string;

  @IsIn(["text", "long_text", "number", "money", "date", "single_select", "multi_select", "boolean"], {
    message: "字段类型不正确"
  })
  type!: "text" | "long_text" | "number" | "money" | "date" | "single_select" | "multi_select" | "boolean";

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "字段必填标记必须是布尔值" })
  required?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsJsonSafeValue({ message: "字段默认值必须是可保存的 JSON 数据" })
  defaultValue?: unknown;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: "字段选项必须是数组" })
  @ValidateNested({ each: true, message: "每个字段选项必须是对象" })
  @Type(() => ContractTemplateFieldOptionDto)
  options?: ContractTemplateFieldOptionDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "字段分组必须是文字" })
  group?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: -2_147_483_648,
    max: 2_147_483_647,
    typeMessage: "字段排序必须是整数",
    rangeMessage: "字段排序超出系统可保存范围"
  })
  order?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @ValidateNested({ message: "字段可见条件必须是对象" })
  @Type(() => ContractTemplateVisibleWhenDto)
  visibleWhen?: ContractTemplateVisibleWhenDto;
}

export class ContractTemplateBillColumnDto {
  @IsRequiredText({ requiredMessage: "请填写清单列标识", typeMessage: "清单列标识必须是文字", blankMessage: "请填写清单列标识" })
  key!: string;

  @IsRequiredText({ requiredMessage: "请填写清单列名称", typeMessage: "清单列名称必须是文字", blankMessage: "请填写清单列名称" })
  label!: string;

  @IsIn(["text", "number", "boolean"], { message: "清单列类型不正确" })
  type!: "text" | "number" | "boolean";

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "清单列必填标记必须是布尔值" })
  required?: boolean;
}

export class ContractTemplateBillDto {
  @IsRequiredText({ requiredMessage: "请填写清单标识", typeMessage: "清单标识必须是文字", blankMessage: "请填写清单标识" })
  key!: string;

  @IsRequiredText({ requiredMessage: "请填写清单名称", typeMessage: "清单名称必须是文字", blankMessage: "请填写清单名称" })
  name!: string;

  @IsIn(["included", "reference", "non_priced", "provisional"], { message: "清单金额角色不正确" })
  amountRole!: "included" | "reference" | "non_priced" | "provisional";

  @IsIn(["tax_inclusive", "tax_exclusive"], { message: "清单计价方式不正确" })
  pricingMode!: "tax_inclusive" | "tax_exclusive";

  @IsIntegerInRange({ min: 0, max: 6, typeMessage: "工程量小数位必须是整数", rangeMessage: "工程量小数位必须在 0 到 6 之间" })
  quantityScale!: number;

  @IsIntegerInRange({ min: 2, max: 2, typeMessage: "单价小数位必须是整数", rangeMessage: "单价小数位必须为 2" })
  unitPriceScale!: number;

  @IsArray({ message: "清单 columns 必须是数组" })
  @ValidateNested({ each: true, message: "每个清单列必须是对象" })
  @Type(() => ContractTemplateBillColumnDto)
  columns!: ContractTemplateBillColumnDto[];
}

export class ContractTemplateClauseDto {
  @IsRequiredText({ requiredMessage: "请填写条款标识", typeMessage: "条款标识必须是文字", blankMessage: "请填写条款标识" })
  key!: string;

  @IsRequiredText({ requiredMessage: "请填写条款标题", typeMessage: "条款标题必须是文字", blankMessage: "请填写条款标题" })
  title!: string;

  @IsIn(["automatic", "fixed"], { message: "条款编号方式不正确" })
  numberingMode!: "automatic" | "fixed";

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "条款必填标记必须是布尔值" })
  required?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "标准条款版本编号必须是文字" })
  standardClauseVersionId?: string;

  @IsJsonSafeValue({ message: "条款内容必须是可保存的 JSON 数据" })
  content!: unknown;
}

export class ContractTemplateAttachmentDto {
  @IsRequiredText({ requiredMessage: "请填写附件标识", typeMessage: "附件标识必须是文字", blankMessage: "请填写附件标识" })
  key!: string;

  @IsRequiredText({ requiredMessage: "请填写附件名称", typeMessage: "附件名称必须是文字", blankMessage: "请填写附件名称" })
  name!: string;

  @IsBoolean({ message: "附件必填标记必须是布尔值" })
  required!: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "附件有效性标记必须是布尔值" })
  mustBeValid?: boolean;
}

export class ContractTemplateValidationDto {
  @IsRequiredText({ requiredMessage: "请填写校验标识", typeMessage: "校验标识必须是文字", blankMessage: "请填写校验标识" })
  key!: string;

  @IsIn(["block", "warning"], { message: "校验级别不正确" })
  level!: "block" | "warning";

  @IsRequiredText({ requiredMessage: "请填写目标条款标识", typeMessage: "目标条款标识必须是文字", blankMessage: "请填写目标条款标识" })
  targetClauseKey!: string;

  @IsArray({ message: "校验必要短语必须是数组" })
  @IsStringArrayItems("校验必要短语必须全部是文字")
  requiredPhrases!: string[];

  @IsRequiredText({ requiredMessage: "请填写校验提示", typeMessage: "校验提示必须是文字", blankMessage: "请填写校验提示" })
  message!: string;
}

export class SupplementChangePolicyDto {
  @IsIn([1], { message: "合同变更白名单版本不受支持" })
  version!: 1;

  @IsArray({ message: "合同变更可编辑字段必须是数组" })
  @IsStringArrayItems("合同变更可编辑字段必须全部是文字")
  editableFieldKeys!: string[];

  @IsArray({ message: "合同变更可编辑条款必须是数组" })
  @IsStringArrayItems("合同变更可编辑条款必须全部是文字")
  editableClauseKeys!: string[];

  @IsArray({ message: "合同核心条款必须是数组" })
  @IsStringArrayItems("合同核心条款必须全部是文字")
  coreClauseKeys!: string[];
}

export class ContractTemplateSchemaDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: "合同变更白名单必须是对象" })
  @ValidateNested({ message: "合同变更白名单必须是对象" })
  @Type(() => SupplementChangePolicyDto)
  supplementChangePolicy?: SupplementChangePolicyDto;

  @IsArray({ message: "模板 fields 必须是数组" })
  @ValidateNested({ each: true, message: "每个模板字段必须是对象" })
  @Type(() => ContractTemplateFieldDto)
  fields!: ContractTemplateFieldDto[];

  @IsArray({ message: "模板 bills 必须是数组" })
  @ValidateNested({ each: true, message: "每个模板清单必须是对象" })
  @Type(() => ContractTemplateBillDto)
  bills!: ContractTemplateBillDto[];

  @IsArray({ message: "模板 clauses 必须是数组" })
  @ValidateNested({ each: true, message: "每个模板条款必须是对象" })
  @Type(() => ContractTemplateClauseDto)
  clauses!: ContractTemplateClauseDto[];

  @IsArray({ message: "模板 attachments 必须是数组" })
  @ValidateNested({ each: true, message: "每个模板附件必须是对象" })
  @Type(() => ContractTemplateAttachmentDto)
  attachments!: ContractTemplateAttachmentDto[];

  @IsArray({ message: "模板 validations 必须是数组" })
  @ValidateNested({ each: true, message: "每个模板校验规则必须是对象" })
  @Type(() => ContractTemplateValidationDto)
  validations!: ContractTemplateValidationDto[];
}

export class CreateBusinessTemplateDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({ requiredMessage: "请填写业务模板编号", typeMessage: "业务模板编号必须是文字", blankMessage: "请填写业务模板编号" })
  code!: string;

  @IsRequiredText({ requiredMessage: "请填写业务模板名称", typeMessage: "业务模板名称必须是文字", blankMessage: "请填写业务模板名称" })
  name!: string;

  @IsRequiredText({ requiredMessage: "请选择合同类型", typeMessage: "合同类型必须是文字", blankMessage: "请选择合同类型" })
  contractTypeKey!: string;

  @IsObject({ message: "业务模板结构必须是对象" })
  @ValidateNested({ message: "业务模板结构必须是对象" })
  @Type(() => ContractTemplateSchemaDto)
  schema!: ContractTemplateSchemaDto;
}

export class UpdateBusinessTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsObject({ message: "业务模板结构必须是对象" })
  @ValidateNested({ message: "业务模板结构必须是对象" })
  @Type(() => ContractTemplateSchemaDto)
  schema!: ContractTemplateSchemaDto;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "模板变更说明必须是文字" })
  changeSummary?: string;
}

export class PublishTemplateVersionDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({ requiredMessage: "请填写模板发布说明", typeMessage: "模板发布说明必须是文字", blankMessage: "请填写模板发布说明" })
  changeSummary!: string;
}

export class CreateStandardClauseDto extends JsonSafeTemplateBodyDto {
  @IsRequiredText({ requiredMessage: "请填写标准条款编号", typeMessage: "标准条款编号必须是文字", blankMessage: "请填写标准条款编号" })
  code!: string;

  @IsRequiredText({ requiredMessage: "请填写标准条款分类", typeMessage: "标准条款分类必须是文字", blankMessage: "请填写标准条款分类" })
  category!: string;

  @IsRequiredText({ requiredMessage: "请填写标准条款名称", typeMessage: "标准条款名称必须是文字", blankMessage: "请填写标准条款名称" })
  name!: string;

  @IsRequiredText({ requiredMessage: "请填写标准条款标题", typeMessage: "标准条款标题必须是文字", blankMessage: "请填写标准条款标题" })
  title!: string;

  @IsJsonSafeValue({ message: "标准条款内容必须是可保存的 JSON 数据" })
  content!: unknown;
}
