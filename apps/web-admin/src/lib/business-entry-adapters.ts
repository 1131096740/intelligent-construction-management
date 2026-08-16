import type {
  BusinessEntryDraftPayload,
  BusinessEntryFieldDefinition,
  BusinessEntryOption,
  BusinessEntrySceneDefinition,
  BusinessEntrySubmissionTarget,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";

export type BusinessEntryImportMode = "new" | "append";

export interface BusinessEntryCellError {
  rowIndex: number;
  fieldKey: string;
  column: string;
  message: string;
}

export interface BusinessEntryImportPlan {
  blocked: boolean;
  duplicateIncomingRows: number[];
  drafts: BusinessEntryDraftPayload[];
}

export function assertBusinessEntryBulkRowCount(
  definition: BusinessEntrySceneDefinition,
  rowCount: number,
  fields: readonly BusinessEntryFieldDefinition[] = definition.fields.filter(
    (field) => !field.readOnly
  )
) {
  if (rowCount <= 1) return;
  if (fields.some((field) => !field.bulk.enabled)) {
    throw new Error("当前业务字段只能逐条录入");
  }
  const maximumRows = Math.min(...fields.map(
    (field) => field.bulk.maxRows ?? Number.POSITIVE_INFINITY
  ));
  if (Number.isFinite(maximumRows) && rowCount > maximumRows) {
    throw new Error(`批量录入最多允许 ${maximumRows} 条业务数据`);
  }
}

type BusinessEntryOptionsByField = Readonly<Record<string, readonly BusinessEntryOption[]>>;

function fieldOptions(
  field: BusinessEntryFieldDefinition,
  options?: readonly BusinessEntryOption[]
) {
  return options ?? field.options ?? [];
}

function optionValue(
  field: BusinessEntryFieldDefinition,
  value: unknown,
  options?: readonly BusinessEntryOption[]
) {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  const option = fieldOptions(field, options).find(
    (candidate) => candidate.value === normalized || candidate.label === normalized
  );
  return option?.value ?? normalized;
}

function normalizeFieldValue(
  field: BusinessEntryFieldDefinition,
  value: unknown,
  options?: readonly BusinessEntryOption[]
): unknown {
  if (value === undefined || value === null) return value;
  if (field.type === "boolean") {
    if (value === true || value === false) return value;
    const normalized = String(value).trim();
    if (normalized === "是" || normalized === "true") return true;
    if (normalized === "否" || normalized === "false") return false;
    return normalized;
  }
  if (["company", "counterparty", "contract", "settlement", "single_select"]
    .includes(field.type)) return optionValue(field, value, options);
  if (field.type === "multi_select") {
    const values = Array.isArray(value)
      ? value
      : String(value).split(/[、，,;；]/u);
    return values
      .map((item) => optionValue(field, item, options))
      .filter((item) => item !== "");
  }
  if (field.type === "date" && value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (field.type === "number") {
    const normalized = typeof value === "string" ? value.trim() : String(value);
    const parsed = Number(normalized);
    return normalized && Number.isFinite(parsed) ? parsed : normalized;
  }
  if (field.type === "money" || field.type === "date") {
    return typeof value === "string" ? value.trim() : String(value);
  }
  return value;
}

export function normalizeBusinessEntryValues(
  definition: BusinessEntrySceneDefinition,
  rawValues: Readonly<Record<string, unknown>>,
  optionsByField: BusinessEntryOptionsByField = {}
): Record<string, unknown> {
  const fields = new Map(definition.fields.map((field) => [field.key, field]));
  return Object.fromEntries(Object.entries(rawValues).map(([key, value]) => {
    const field = fields.get(key);
    return [key, field
      ? normalizeFieldValue(field, value, optionsByField[key])
      : value];
  }));
}

function visibilityConditionMatches(
  field: BusinessEntryFieldDefinition,
  values: Readonly<Record<string, unknown>>
) {
  const condition = field.visibleWhen;
  if (!condition) return true;
  const actual = values[condition.fieldKey];
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "neq") return actual !== condition.value;
  const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
  const included = expected.some((item) => item === actual);
  return condition.operator === "in" ? included : !included;
}

export function visibleBusinessEntryFields(
  definition: BusinessEntrySceneDefinition,
  values: Readonly<Record<string, unknown>>
) {
  return definition.fields.filter((field) => visibilityConditionMatches(field, values));
}

export function visibleBusinessEntryValues(
  definition: BusinessEntrySceneDefinition,
  values: Readonly<Record<string, unknown>>
) {
  const knownFieldKeys = new Set(definition.fields.map((field) => field.key));
  let filteredValues = { ...values };
  for (let iteration = 0; iteration <= definition.fields.length; iteration += 1) {
    const visibleFieldKeys = new Set(
      visibleBusinessEntryFields(definition, filteredValues).map((field) => field.key)
    );
    const nextValues = Object.fromEntries(Object.entries(filteredValues).filter(
      ([key]) => !knownFieldKeys.has(key) || visibleFieldKeys.has(key)
    ));
    if (Object.keys(nextValues).length === Object.keys(filteredValues).length) {
      return nextValues;
    }
    filteredValues = nextValues;
  }
  return filteredValues;
}

export function businessEntryDraftFromForm(
  definition: BusinessEntrySceneDefinition,
  target: BusinessEntrySubmissionTarget,
  values: Readonly<Record<string, unknown>>,
  expectedRevision?: number,
  optionsByField: BusinessEntryOptionsByField = {}
): BusinessEntryDraftPayload {
  return {
    sceneKey: definition.key,
    definitionVersion: definition.version,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    target: { ...target },
    values: normalizeBusinessEntryValues(definition, values, optionsByField)
  };
}

export function businessEntryDraftsFromGrid(
  definition: BusinessEntrySceneDefinition,
  target: BusinessEntrySubmissionTarget,
  rows: readonly Readonly<Record<string, unknown>>[],
  optionsByField: BusinessEntryOptionsByField = {}
): BusinessEntryDraftPayload[] {
  assertBusinessEntryBulkRowCount(definition, rows.length);
  return rows.map((row) => businessEntryDraftFromForm(
    definition,
    target,
    row,
    undefined,
    optionsByField
  ));
}

export function businessEntryDraftsFromPaste(
  definition: BusinessEntrySceneDefinition,
  target: BusinessEntrySubmissionTarget,
  clipboardText: string
): BusinessEntryDraftPayload[] {
  const fields = definition.fields.filter(
    (field) => !field.readOnly && field.excel.paste === "multi"
  );
  const lines = clipboardText
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .filter((line, index, all) => line.length > 0 || index < all.length - 1);

  const populatedLines = lines.filter((line) => line.trim());
  assertBusinessEntryBulkRowCount(definition, populatedLines.length, fields);
  return populatedLines.map((line) => {
    const cells = line.split("\t");
    if (cells.length > fields.length) {
      throw new Error(`粘贴内容有 ${cells.length} 列，当前场景最多允许 ${fields.length} 列`);
    }
    const values = Object.fromEntries(
      cells.map((value, index) => [fields[index]!.key, value])
    );
    return businessEntryDraftFromForm(definition, target, values);
  });
}

export function locateBusinessEntryErrors(
  definition: BusinessEntrySceneDefinition,
  result: BusinessEntryValidationResult,
  rowIndex: number
): BusinessEntryCellError[] {
  const fields = new Map(definition.fields.map((field) => [field.key, field]));
  const rules = new Map(definition.rules.map((rule) => [rule.key, rule]));
  return result.errors.flatMap((error) => {
    let fieldKey = error.fieldKey;
    if (!fieldKey && error.ruleKey) {
      const rule = rules.get(error.ruleKey);
      fieldKey = rule
        ? "fieldKey" in rule
          ? rule.fieldKey
          : rule.leftFieldKey
        : undefined;
    }
    const field = fieldKey ? fields.get(fieldKey) : undefined;
    if (!fieldKey || !field || field.excel.errorLocation === "summary") return [];
    return [{
      rowIndex,
      fieldKey,
      column: field.excel.column,
      message: error.message
    }];
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

function draftFingerprint(draft: BusinessEntryDraftPayload) {
  return JSON.stringify(stableValue({
    sceneKey: draft.sceneKey,
    target: draft.target,
    values: draft.values
  }));
}

export function planBusinessEntryDraftImport(
  currentDrafts: readonly BusinessEntryDraftPayload[],
  incomingDrafts: readonly BusinessEntryDraftPayload[],
  mode: BusinessEntryImportMode | undefined
): BusinessEntryImportPlan {
  if (!mode) throw new Error("请选择新建草稿或追加到当前草稿");
  const seen = new Set(
    mode === "append" ? currentDrafts.map(draftFingerprint) : []
  );
  const duplicateIncomingRows: number[] = [];
  for (const [index, draft] of incomingDrafts.entries()) {
    const fingerprint = draftFingerprint(draft);
    if (seen.has(fingerprint)) duplicateIncomingRows.push(index);
    seen.add(fingerprint);
  }
  if (duplicateIncomingRows.length) {
    return {
      blocked: true,
      duplicateIncomingRows,
      drafts: [...currentDrafts]
    };
  }
  return {
    blocked: false,
    duplicateIncomingRows,
    drafts: mode === "new"
      ? incomingDrafts.map((draft) => ({ ...draft, values: { ...draft.values } }))
      : [...currentDrafts, ...incomingDrafts]
  };
}

export function formatBusinessEntryReadonlyValue(
  field: BusinessEntryFieldDefinition,
  value: unknown
): string {
  if (value === undefined || value === null || value === "") return "未填写";
  if (field.type === "boolean") return value === true || value === "true" ? "是" : "否";
  if (field.type === "single_select") {
    return field.options?.find((option) => option.value === value)?.label ?? "未识别的业务选项";
  }
  if (field.type === "multi_select") {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) =>
      field.options?.find((option) => option.value === item)?.label ?? "未识别的业务选项"
    ).join("、");
  }
  if (field.type === "money") return `${String(value)} 元`;
  return String(value);
}

export function formatBusinessEntryEditableValue(
  field: BusinessEntryFieldDefinition,
  value: unknown,
  options?: readonly BusinessEntryOption[]
): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "boolean") return value === true || value === "true" ? "是" : "否";
  if (["company", "counterparty", "contract", "settlement", "single_select"]
    .includes(field.type)) {
    return fieldOptions(field, options).find((option) => option.value === value)?.label ?? (
      field.type === "single_select" ? "未识别的业务选项" : "未识别的业务对象"
    );
  }
  if (field.type === "multi_select") {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) =>
      fieldOptions(field, options).find((option) => option.value === item)?.label ??
        "未识别的业务选项"
    ).join("、");
  }
  return String(value);
}
