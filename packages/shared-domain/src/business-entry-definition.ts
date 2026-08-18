import type { RoleKey } from "./roles";

export const BUSINESS_ENTRY_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "money",
  "date",
  "company",
  "counterparty",
  "contract",
  "settlement",
  "single_select",
  "multi_select",
  "boolean"
] as const;

export type BusinessEntryFieldType = (typeof BUSINESS_ENTRY_FIELD_TYPES)[number];

export const BUSINESS_ENTRY_OPERATIONS = ["view", "edit", "import", "export"] as const;
export type BusinessEntryOperation = (typeof BUSINESS_ENTRY_OPERATIONS)[number];
export const BUSINESS_ENTRY_AUTHENTICATED_SELF = "authenticated_self" as const;
export type BusinessEntryPermissionKey = RoleKey | typeof BUSINESS_ENTRY_AUTHENTICATED_SELF;

export interface BusinessEntryOption {
  value: string;
  label: string;
}

export interface BusinessEntryPermissionPolicy {
  view: readonly RoleKey[];
  edit: readonly RoleKey[];
  import?: readonly RoleKey[];
  export?: readonly RoleKey[];
  sensitive?: readonly RoleKey[];
}

export interface BusinessEntryFormatRule {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface BusinessEntryBulkRule {
  enabled: boolean;
  maxRows?: number;
  strategy: "replace" | "append";
}

export interface BusinessEntryExcelRule {
  column: string;
  paste: "single" | "multi";
  errorLocation: "cell" | "row" | "summary";
}

export interface BusinessEntryVisibilityCondition {
  fieldKey: string;
  operator: "eq" | "neq" | "in" | "not_in";
  value: unknown;
}

export interface BusinessEntryFieldDefinition {
  key: string;
  label: string;
  description: string;
  example: string;
  type: BusinessEntryFieldType;
  scope: "header" | "line";
  unit: string;
  precision: number;
  required: boolean;
  readOnly?: boolean;
  defaultValue?: unknown;
  options?: readonly BusinessEntryOption[];
  permissions: BusinessEntryPermissionPolicy;
  visibleWhen?: BusinessEntryVisibilityCondition;
  format?: BusinessEntryFormatRule;
  bulk: BusinessEntryBulkRule;
  excel: BusinessEntryExcelRule;
  group?: string;
  order?: number;
  renamedFrom?: readonly { key: string; label: string }[];
  display: {
    formHint: string;
    gridColumn: string;
    mobilePriority: number;
    readonlyText: string;
  };
}

export type BusinessEntryRule =
  | {
      key: string;
      kind: "required_if";
      when: BusinessEntryVisibilityCondition;
      fieldKey: string;
      message: string;
    }
  | {
      key: string;
      kind: "forbidden_if";
      when: BusinessEntryVisibilityCondition;
      fieldKey: string;
      message: string;
    }
  | {
      key: string;
      kind: "equals" | "not_equals" | "less_than_or_equal" | "greater_than_or_equal";
      leftFieldKey: string;
      rightFieldKey: string;
      message: string;
    };

export interface BusinessEntrySceneDefinition {
  key: string;
  entityType: string;
  name: string;
  description: string;
  version: number;
  fields: readonly BusinessEntryFieldDefinition[];
  rules: readonly BusinessEntryRule[];
  permissions?: BusinessEntryPermissionPolicy;
}

export interface BusinessEntryDraftPayload {
  sceneKey: string;
  definitionVersion?: number;
  expectedRevision?: number;
  target?: BusinessEntrySubmissionTarget;
  values: Record<string, unknown>;
}

export type BusinessEntrySubmissionTarget =
  | {
      entityType: string;
      entityId: string;
    }
  | {
      entityType: string;
      createTarget: string;
    };

export function isBusinessEntryExistingTarget(
  target: BusinessEntrySubmissionTarget | undefined
): target is Extract<BusinessEntrySubmissionTarget, { entityId: string }> {
  return Boolean(
    target &&
    "entityId" in target &&
    typeof target.entityId === "string" &&
    !Object.prototype.hasOwnProperty.call(target, "createTarget")
  );
}

export function isBusinessEntryCreateTarget(
  target: BusinessEntrySubmissionTarget | undefined
): target is Extract<BusinessEntrySubmissionTarget, { createTarget: string }> {
  return Boolean(
    target &&
    "createTarget" in target &&
    typeof target.createTarget === "string" &&
    !Object.prototype.hasOwnProperty.call(target, "entityId")
  );
}

export type BusinessEntryValidationErrorCode =
  | "unknown_scene"
  | "unknown_field"
  | "definition_version_required"
  | "stale_definition_version"
  | "permission_denied"
  | "invalid_target"
  | "read_only_field"
  | "hidden_field"
  | "required_field"
  | "invalid_type"
  | "invalid_option"
  | "invalid_format"
  | "invalid_rule";

export interface BusinessEntryValidationError {
  code: BusinessEntryValidationErrorCode;
  message: string;
  fieldKey?: string;
  ruleKey?: string;
}

export interface BusinessEntryValidationResult {
  valid: boolean;
  sceneKey: string;
  definitionVersion: number | null;
  values: Record<string, unknown>;
  errors: BusinessEntryValidationError[];
}

export interface BusinessEntryFrozenSnapshot {
  sceneKey: string;
  target: BusinessEntrySubmissionTarget;
  revision: number;
  definitionVersion: number;
  definition: BusinessEntrySceneDefinition;
  values: Record<string, unknown>;
  frozenAt: string;
}

export type BusinessEntryDefinitionErrorCode =
  | "unknown_scene"
  | "invalid_definition"
  | "permission_denied";

export class BusinessEntryDefinitionError extends Error {
  constructor(
    public readonly code: BusinessEntryDefinitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BusinessEntryDefinitionError";
  }
}

export class BusinessEntryDraftValidationError extends Error {
  constructor(public readonly result: BusinessEntryValidationResult) {
    super("草稿未通过业务字段校验");
    this.name = "BusinessEntryDraftValidationError";
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    if (value instanceof Date) return new Date(value.getTime()) as T;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    ) as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function isPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function hasAnyRole(
  required: readonly RoleKey[] | undefined,
  effectiveRoleKeys: readonly RoleKey[]
) {
  return required === undefined
    ? true
    : required.length > 0 && effectiveRoleKeys.some((role) => required.includes(role));
}

function permissionRoles(
  field: BusinessEntryFieldDefinition,
  operation: BusinessEntryOperation
): readonly RoleKey[] {
  if (operation === "import") return field.permissions.import ?? field.permissions.edit;
  if (operation === "export") return field.permissions.export ?? field.permissions.view;
  return field.permissions[operation];
}

function hasSensitiveAccess(
  field: BusinessEntryFieldDefinition,
  effectiveRoleKeys: readonly RoleKey[]
) {
  return hasAnyRole(field.permissions.sensitive, effectiveRoleKeys);
}

function conditionMatches(condition: BusinessEntryVisibilityCondition, values: Record<string, unknown>) {
  const actual = values[condition.fieldKey];
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "neq") return actual !== condition.value;
  const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
  const included = expected.some((item) => item === actual);
  return condition.operator === "in" ? included : !included;
}

function comparable(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function matchesPrecision(value: number, precision: number): boolean {
  const scale = 10 ** precision;
  const scaled = value * scale;
  return Number.isSafeInteger(Math.round(scaled)) && Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function matchesNumericStringPrecision(value: string, precision: number): boolean {
  const match = /^\d+(?:\.(\d+))?$/.exec(value.trim());
  return match !== null && (match[1]?.length ?? 0) <= precision;
}

function validateFieldValue(field: BusinessEntryFieldDefinition, value: unknown): BusinessEntryValidationError | null {
  const invalid = (
    code: "invalid_type" | "invalid_option" | "invalid_format",
    message: string
  ) => ({
    code,
    message,
    fieldKey: field.key
  });

  if (field.type === "text" || field.type === "long_text") {
    if (typeof value !== "string") return invalid("invalid_type", `${field.label}必须填写文本`);
    if (field.format?.minLength !== undefined && value.length < field.format.minLength) {
      return invalid("invalid_format", `${field.label}长度不能少于${field.format.minLength}个字符`);
    }
    if (field.format?.maxLength !== undefined && value.length > field.format.maxLength) {
      return invalid("invalid_format", `${field.label}长度不能超过${field.format.maxLength}个字符`);
    }
    if (field.format?.pattern && !new RegExp(field.format.pattern).test(value)) {
      return invalid("invalid_format", `${field.label}格式不符合受控规则`);
    }
    return null;
  }
  if (field.type === "number" || field.type === "money") {
    if (field.type === "money" && typeof value === "string") {
      const trimmed = value.trim();
      const numeric = /^\d+(?:\.\d+)?$/.test(trimmed);
      if (matchesNumericStringPrecision(trimmed, field.precision)) return null;
      return invalid(
        numeric ? "invalid_format" : "invalid_type",
        numeric ? `${field.label}最多保留${field.precision}位小数` : `${field.label}必须填写有效数字`
      );
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return invalid("invalid_type", `${field.label}必须填写有效数字`);
    }
    return matchesPrecision(value, field.precision)
      ? null
      : invalid("invalid_format", `${field.label}最多保留${field.precision}位小数`);
  }
  if (field.type === "date") {
    return typeof value === "string" && isValidDateOnly(value)
      ? null
      : invalid("invalid_type", `${field.label}必须使用 YYYY-MM-DD 日期格式`);
  }
  if (field.type === "boolean") {
    return typeof value === "boolean" ? null : invalid("invalid_type", `${field.label}必须是是或否`);
  }
  if (field.type === "multi_select") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return invalid("invalid_type", `${field.label}必须选择一个或多个业务选项`);
    }
    const options = new Set((field.options ?? []).map((option) => option.value));
    return new Set(value).size !== value.length || value.some((item) => !options.has(item))
      ? invalid("invalid_option", `${field.label}包含不受支持的业务选项`)
      : null;
  }
  if (field.type === "single_select") {
    if (typeof value !== "string") return invalid("invalid_type", `${field.label}必须选择业务选项`);
    return (field.options ?? []).some((option) => option.value === value)
      ? null
      : invalid("invalid_option", `${field.label}包含不受支持的业务选项`);
  }
  return typeof value === "string" && value.trim()
    ? null
    : invalid("invalid_type", `${field.label}必须选择业务对象`);
}

function validateDefinition(definition: BusinessEntrySceneDefinition): BusinessEntrySceneDefinition {
  if (
    !definition.key.trim() ||
    !definition.entityType.trim() ||
    !definition.name.trim() ||
    !definition.description.trim()
  ) {
    throw new BusinessEntryDefinitionError("invalid_definition", "业务场景定义必须包含名称和说明");
  }
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
    throw new BusinessEntryDefinitionError("invalid_definition", "业务场景定义版本必须是正整数");
  }

  const fieldKeys = new Set<string>();
  for (const field of definition.fields) {
    if (!field.key.trim() || fieldKeys.has(field.key)) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段编码重复：${field.key}`);
    }
    fieldKeys.add(field.key);
    if (!field.label.trim() || !field.description.trim() || !field.example.trim()) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段说明不完整：${field.key}`);
    }
    if (!BUSINESS_ENTRY_FIELD_TYPES.includes(field.type)) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段类型不受支持：${field.key}`);
    }
    if (field.scope !== "header" && field.scope !== "line") {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段层级不合法：${field.key}`);
    }
    if (field.renamedFrom?.some((entry) => !entry.key.trim() || !entry.label.trim())) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段改名追溯不完整：${field.key}`);
    }
    if (!Number.isSafeInteger(field.precision) || field.precision < 0) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段精度不合法：${field.key}`);
    }
    if (
      !field.display ||
      !field.display.formHint.trim() ||
      !field.display.gridColumn.trim() ||
      !field.display.readonlyText.trim() ||
      !Number.isSafeInteger(field.display.mobilePriority) ||
      field.display.mobilePriority < 0
    ) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段展示规则不完整：${field.key}`);
    }
    if (!field.excel || !field.excel.column.trim()) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段 Excel 列规则不完整：${field.key}`);
    }
    if (
      !field.bulk ||
      (field.bulk.maxRows !== undefined &&
        (!Number.isSafeInteger(field.bulk.maxRows) || field.bulk.maxRows < 1))
    ) {
      throw new BusinessEntryDefinitionError("invalid_definition", `业务字段批量填充规则不合法：${field.key}`);
    }
    if (field.format) {
      if (
        field.format.minLength !== undefined &&
        (!Number.isSafeInteger(field.format.minLength) || field.format.minLength < 0)
      ) {
        throw new BusinessEntryDefinitionError("invalid_definition", `业务字段最小长度规则不合法：${field.key}`);
      }
      if (
        field.format.maxLength !== undefined &&
        (!Number.isSafeInteger(field.format.maxLength) || field.format.maxLength < 0)
      ) {
        throw new BusinessEntryDefinitionError("invalid_definition", `业务字段最大长度规则不合法：${field.key}`);
      }
      if (
        field.format.minLength !== undefined &&
        field.format.maxLength !== undefined &&
        field.format.minLength > field.format.maxLength
      ) {
        throw new BusinessEntryDefinitionError("invalid_definition", `业务字段长度范围不合法：${field.key}`);
      }
      if (field.format.pattern) {
        try {
          new RegExp(field.format.pattern);
        } catch {
          throw new BusinessEntryDefinitionError("invalid_definition", `业务字段格式规则不合法：${field.key}`);
        }
      }
    }
    if (field.type !== "single_select" && field.type !== "multi_select" && field.options?.length) {
      throw new BusinessEntryDefinitionError("invalid_definition", `非选项字段不能配置业务选项：${field.key}`);
    }
    const optionKeys = new Set<string>();
    for (const option of field.options ?? []) {
      if (!option.value.trim() || !option.label.trim() || optionKeys.has(option.value)) {
        throw new BusinessEntryDefinitionError("invalid_definition", `业务选项编码重复：${field.key}`);
      }
      optionKeys.add(option.value);
    }
  }

  for (const field of definition.fields) {
    if (field.visibleWhen && !fieldKeys.has(field.visibleWhen.fieldKey)) {
      throw new BusinessEntryDefinitionError("invalid_definition", `显示条件引用未知字段：${field.key}`);
    }
  }

  const ruleKeys = new Set<string>();
  for (const rule of definition.rules) {
    if (!rule.key.trim() || ruleKeys.has(rule.key) || !rule.message.trim()) {
      throw new BusinessEntryDefinitionError("invalid_definition", "跨字段规则必须包含编码和中文说明");
    }
    ruleKeys.add(rule.key);
    const referencedKeys =
      "when" in rule ? [rule.when.fieldKey, rule.fieldKey] : [rule.leftFieldKey, rule.rightFieldKey];
    if (referencedKeys.some((key) => !fieldKeys.has(key))) {
      throw new BusinessEntryDefinitionError("invalid_definition", `跨字段规则引用未知字段：${rule.key}`);
    }
  }

  return deepFreeze(cloneValue(definition));
}

export class BusinessEntryDefinitionRegistry {
  private readonly definitions: ReadonlyMap<string, BusinessEntrySceneDefinition>;

  constructor(definitions: readonly BusinessEntrySceneDefinition[]) {
    const byKey = new Map<string, BusinessEntrySceneDefinition>();
    for (const definition of definitions) {
      if (byKey.has(definition.key)) {
        throw new BusinessEntryDefinitionError("invalid_definition", `业务场景编码重复：${definition.key}`);
      }
      byKey.set(definition.key, validateDefinition(definition));
    }
    this.definitions = byKey;
  }

  getSceneDefinition(sceneKey: string): BusinessEntrySceneDefinition {
    const definition = this.definitions.get(sceneKey);
    if (!definition) {
      throw new BusinessEntryDefinitionError("unknown_scene", "业务场景不存在或未注册");
    }
    return definition;
  }

  getSceneDefinitionForRoles(
    sceneKey: string,
    effectiveRoleKeys: readonly RoleKey[],
    operation: BusinessEntryOperation = "view"
  ): BusinessEntrySceneDefinition {
    const definition = this.getSceneDefinition(sceneKey);
    if (!hasAnyRole(definition.permissions?.[operation], effectiveRoleKeys)) {
      throw new BusinessEntryDefinitionError("permission_denied", "当前岗位无权查看该业务场景");
    }
    const fields = definition.fields.filter((field) =>
      hasAnyRole(permissionRoles(field, operation), effectiveRoleKeys) &&
      hasSensitiveAccess(field, effectiveRoleKeys)
    );
    if (definition.fields.length > 0 && fields.length === 0) {
      throw new BusinessEntryDefinitionError("permission_denied", "当前岗位无权查看该业务场景");
    }
    return deepFreeze({
      ...cloneValue(definition),
      fields
    });
  }

  validateDraft(
    payload: BusinessEntryDraftPayload,
    effectiveRoleKeys: readonly RoleKey[],
    operation: BusinessEntryOperation = "edit"
  ): BusinessEntryValidationResult {
    const definition = this.definitions.get(payload.sceneKey);
    if (!definition) {
      return {
        valid: false,
        sceneKey: payload.sceneKey,
        definitionVersion: null,
        values: cloneValue(payload.values),
        errors: [{ code: "unknown_scene", message: "业务场景不存在或未注册" }]
      };
    }

    const values = cloneValue(payload.values);
    const errors: BusinessEntryValidationError[] = [];
    if (!hasAnyRole(definition.permissions?.[operation], effectiveRoleKeys)) {
      errors.push({ code: "permission_denied", message: "当前岗位无权使用该业务场景" });
    }
    if (operation !== "view" && payload.definitionVersion === undefined) {
      errors.push({
        code: "definition_version_required",
        message: "请携带当前字段定义版本，禁止旧草稿静默升级"
      });
    }
    if (
      payload.definitionVersion !== undefined &&
      payload.definitionVersion !== definition.version
    ) {
      errors.push({
        code: "stale_definition_version",
        message: "字段定义已经更新，请刷新后重新填写",
      });
    }
    if (operation !== "view") {
      if (
        !payload.target?.entityType.trim() ||
        (!isBusinessEntryExistingTarget(payload.target) &&
          !isBusinessEntryCreateTarget(payload.target))
      ) {
        errors.push({ code: "invalid_target", message: "录入和导入必须绑定正式业务对象" });
      } else if (payload.target.entityType !== definition.entityType) {
        errors.push({ code: "invalid_target", message: "提交业务对象类型与场景不匹配" });
      }
    }

    const fields = new Map(definition.fields.map((field) => [field.key, field]));
    if (
      definition.fields.length > 0 &&
      !definition.fields.some(
        (field) =>
          hasAnyRole(permissionRoles(field, operation), effectiveRoleKeys) &&
          hasSensitiveAccess(field, effectiveRoleKeys)
      )
    ) {
      errors.push({ code: "permission_denied", message: "当前岗位无权使用该业务场景" });
    }
    for (const key of Object.keys(values)) {
      if (!fields.has(key)) {
        errors.push({ code: "unknown_field", fieldKey: key, message: `未知业务字段：${key}` });
      }
    }

    for (const field of definition.fields) {
      if (!(field.key in values) && field.defaultValue !== undefined) {
        values[field.key] = cloneValue(field.defaultValue);
      }
      const value = values[field.key];
      const visible = !field.visibleWhen || conditionMatches(field.visibleWhen, values);
      if (!visible) {
        if (isPresent(value)) {
          errors.push({
            code: "hidden_field",
            fieldKey: field.key,
            message: `${field.label}当前条件下不可填写`
          });
        }
        continue;
      }
      if (!hasAnyRole(permissionRoles(field, operation), effectiveRoleKeys)) {
        if (isPresent(value)) {
          errors.push({
            code: "permission_denied",
            fieldKey: field.key,
            message: `当前岗位无权${operation === "view" ? "查看" : "填写"}${field.label}`
          });
        }
        continue;
      }
      if (!hasSensitiveAccess(field, effectiveRoleKeys)) {
        if (isPresent(value)) {
          errors.push({
            code: "permission_denied",
            fieldKey: field.key,
            message: `当前岗位无权访问敏感字段${field.label}`
          });
        }
        continue;
      }
      if ((operation === "edit" || operation === "import") && field.readOnly && isPresent(value)) {
        errors.push({
          code: "read_only_field",
          fieldKey: field.key,
          message: `${field.label}为只读业务字段，不能由录入人修改`
        });
        continue;
      }
      if (field.required && !isPresent(value)) {
        errors.push({
          code: "required_field",
          fieldKey: field.key,
          message: `请填写${field.label}`
        });
        continue;
      }
      if (isPresent(value)) {
        const error = validateFieldValue(field, value);
        if (error) errors.push(error);
      }
    }

    for (const rule of definition.rules) {
      if ("when" in rule) {
        if (!conditionMatches(rule.when, values)) continue;
        const present = isPresent(values[rule.fieldKey]);
        if ((rule.kind === "required_if" && !present) || (rule.kind === "forbidden_if" && present)) {
          errors.push({
            code: "invalid_rule",
            fieldKey: rule.fieldKey,
            ruleKey: rule.key,
            message: rule.message
          });
        }
        continue;
      }
      const left = values[rule.leftFieldKey];
      const right = values[rule.rightFieldKey];
      if (!isPresent(left) || !isPresent(right)) continue;
      const valid =
        rule.kind === "equals"
            ? left === right
            : rule.kind === "not_equals"
              ? left !== right
              : rule.kind === "less_than_or_equal"
                ? comparable(left) && comparable(right) && typeof left === typeof right && left <= right
                : comparable(left) && comparable(right) && typeof left === typeof right && left >= right;
      if (!valid) {
        errors.push({ code: "invalid_rule", ruleKey: rule.key, message: rule.message });
      }
    }

    return {
      valid: errors.length === 0,
      sceneKey: definition.key,
      definitionVersion: definition.version,
      values,
      errors
    };
  }

  freezeSubmissionSnapshot(
    payload: BusinessEntryDraftPayload,
    effectiveRoleKeys: readonly RoleKey[],
    options: { frozenAt?: string; operation?: "edit" | "import" } = {}
  ): BusinessEntryFrozenSnapshot {
    const result = this.validateDraft(payload, effectiveRoleKeys, options.operation ?? "edit");
    if (
      !payload.target ||
      !payload.target.entityType.trim() ||
      (!isBusinessEntryExistingTarget(payload.target) &&
        !isBusinessEntryCreateTarget(payload.target))
    ) {
      result.errors.push({ code: "invalid_target", message: "提交必须绑定正式业务对象" });
    } else if (payload.target.entityType !== this.getSceneDefinition(payload.sceneKey).entityType) {
      result.errors.push({ code: "invalid_target", message: "提交业务对象类型与场景不匹配" });
    }
    result.valid = result.errors.length === 0;
    if (!result.valid) throw new BusinessEntryDraftValidationError(result);
    const definition = this.getSceneDefinition(payload.sceneKey);
    return deepFreeze({
      sceneKey: definition.key,
      target: cloneValue(payload.target) as BusinessEntrySubmissionTarget,
      revision: 1,
      definitionVersion: definition.version,
      definition: cloneValue(definition),
      values: cloneValue(result.values),
      frozenAt: options.frozenAt ?? new Date().toISOString()
    });
  }
}

export function createBusinessEntryDefinitionRegistry(
  definitions: readonly BusinessEntrySceneDefinition[]
): BusinessEntryDefinitionRegistry {
  return new BusinessEntryDefinitionRegistry(definitions);
}
