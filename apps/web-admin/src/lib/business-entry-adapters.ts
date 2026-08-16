import type {
  BusinessEntryDraftPayload,
  BusinessEntryFieldDefinition,
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

function optionValue(field: BusinessEntryFieldDefinition, value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  const option = field.options?.find(
    (candidate) => candidate.value === normalized || candidate.label === normalized
  );
  return option?.value ?? normalized;
}

function normalizeFieldValue(field: BusinessEntryFieldDefinition, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (field.type === "boolean") {
    if (value === true || value === false) return value;
    const normalized = String(value).trim();
    if (normalized === "是" || normalized === "true") return true;
    if (normalized === "否" || normalized === "false") return false;
    return normalized;
  }
  if (field.type === "single_select") return optionValue(field, value);
  if (field.type === "multi_select") {
    const values = Array.isArray(value)
      ? value
      : String(value).split(/[、，,;；]/u);
    return values
      .map((item) => optionValue(field, item))
      .filter((item) => item !== "");
  }
  if (field.type === "date" && value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (field.type === "money" || field.type === "number" || field.type === "date") {
    return typeof value === "string" ? value.trim() : String(value);
  }
  return value;
}

export function normalizeBusinessEntryValues(
  definition: BusinessEntrySceneDefinition,
  rawValues: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const fields = new Map(definition.fields.map((field) => [field.key, field]));
  return Object.fromEntries(Object.entries(rawValues).map(([key, value]) => {
    const field = fields.get(key);
    return [key, field ? normalizeFieldValue(field, value) : value];
  }));
}

export function businessEntryDraftFromForm(
  definition: BusinessEntrySceneDefinition,
  target: BusinessEntrySubmissionTarget,
  values: Readonly<Record<string, unknown>>,
  expectedRevision?: number
): BusinessEntryDraftPayload {
  return {
    sceneKey: definition.key,
    definitionVersion: definition.version,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    target: { ...target },
    values: normalizeBusinessEntryValues(definition, values)
  };
}

export function businessEntryDraftsFromGrid(
  definition: BusinessEntrySceneDefinition,
  target: BusinessEntrySubmissionTarget,
  rows: readonly Readonly<Record<string, unknown>>[]
): BusinessEntryDraftPayload[] {
  return rows.map((row) => businessEntryDraftFromForm(definition, target, row));
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

  return lines.filter((line) => line.trim()).map((line) => {
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
