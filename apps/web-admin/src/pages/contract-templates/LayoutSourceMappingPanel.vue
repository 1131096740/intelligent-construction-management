<template>
  <t-card title="原文自动填写位置" class="panel">
    <p>逐项选择原文段落，输入其中需自动填写的准确文字。系统不自动猜测；重复文字请先拆分原文。</p>
    <t-alert v-if="message" theme="error" :message="message" />
    <t-loading :loading="loading">
      <section v-if="source" aria-label="Word实际原文" class="source-text">
        <p v-for="position in source.positions" :key="position.positionId">{{ position.text }}</p>
      </section>
      <section v-for="row in rows" :key="row.rowId" :aria-label="`${row.label}填写位置`" class="mapping-row">
        <h3>{{ row.label }}{{ row.required ? '（必选）' : '（可选）' }}</h3>
        <t-select v-model="row.positionId" :options="positionOptions" :disabled="!editable || busy" placeholder="选择原文段落" clearable />
        <t-input v-model="row.selectedText" :disabled="!editable || busy" placeholder="输入需自动填写的原文" />
        <t-input v-model="sampleValues[row.key]" :disabled="!editable || busy" placeholder="填写预览样例值" />
        <t-button v-if="!row.required" variant="text" :disabled="!editable || busy" @click="rows = rows.filter(value => value.rowId !== row.rowId)">移除此位置</t-button>
      </section>
    </t-loading>
    <t-space v-if="editable" class="mapping-actions">
      <t-select v-model="additionalField" :options="fieldOptions" placeholder="选择其他字段或增加重复位置" />
      <t-button :disabled="!additionalField || busy" @click="addPosition">增加填写位置</t-button>
    </t-space>
    <t-space class="mapping-actions">
      <t-button :disabled="!editable || !source || busy" :loading="busy" @click="save">保存填写位置</t-button>
      <t-button theme="primary" :disabled="!editable || dirty || !source?.mappingFingerprint || !inspectionCurrent || !previewSucceeded || busy" @click="confirm">确认当前原文、位置和真实预览</t-button>
      <span>{{ confirmed ? '当前修订填写位置已由主管确认' : '尚未确认当前修订，不可提交发布' }}</span>
    </t-space>
  </t-card>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getLayoutSourcePositions, saveLayoutSourceMapping, confirmLayoutSourceMapping, type LayoutSourcePositions } from "../../api/contract-template-mapping.api";
import { formatUnknownApiError } from "../../api/error-message";
const props = defineProps<{ versionId: string; revision: number; editable: boolean; inspectionCurrent: boolean; previewSucceeded: boolean; previewJobId?: string }>();
const emit = defineEmits<{ (event: "changed"): void; (event: "dirty-change", value: boolean): void; (event: "confirmation-state", value: boolean): void }>();
type MappingRow = { rowId: number; key: string; label: string; required: boolean; positionId: string; selectedText: string };
const source = ref<LayoutSourcePositions | null>(null);
const rows = ref<MappingRow[]>([]);
const sampleValues = ref<Record<string, string>>({});
const baseline = ref("");
const message = ref("");
const loading = ref(false);
const busy = ref(false);
const confirmed = ref(false);
let generation = 0;
let nextRowId = 1;
const additionalField = ref("");
const fieldOptions = computed(() => source.value?.fields.map(field => ({ label: field.label, value: field.key })) ?? []);
const serialized = computed(() => JSON.stringify(rows.value.map(row => [row.key, row.positionId, row.selectedText])));
const dirty = computed(() => Boolean(baseline.value) && serialized.value !== baseline.value);
const positionOptions = computed(() => source.value?.positions.map(position => ({ label: `${position.part.includes("header") ? "页眉" : position.part.includes("footer") ? "页脚" : "正文"}第${position.paragraphIndex + 1}段：${position.text}`, value: position.positionId })) ?? []);
watch(dirty, value => { emit("dirty-change", value); emit("confirmation-state", !value && confirmed.value); });
watch(confirmed, value => emit("confirmation-state", value && !dirty.value));
watch(() => [props.versionId, props.revision, props.previewJobId], () => { void load(); }, { immediate: true });
async function load() {
  const request = ++generation;
  loading.value = true;
  message.value = "";
  try {
    const result = await getLayoutSourcePositions(props.versionId);
    if (generation !== request) return;
    if (source.value?.versionId !== result.versionId) sampleValues.value = {};
    source.value = result;
    rows.value = result.fields.flatMap(field => {
      const bindings = result.bindings.filter(value => value.fieldKey === field.key);
      if (!bindings.length && !field.required) return [];
      return (bindings.length ? bindings : [undefined]).map((binding, index) => {
        const position = result.positions.find(value => value.positionId === binding?.positionId);
        return { ...field, rowId: nextRowId++, required: field.required && index === 0, positionId: position?.positionId ?? "", selectedText: position && binding ? position.text.slice(binding.start, binding.end) : "" };
      });
    });
    baseline.value = serialized.value;
    confirmed.value = result.confirmed;
    emit("dirty-change", false);
    emit("confirmation-state", result.confirmed);
  } catch (error) {
    if (generation === request) { source.value = null; confirmed.value = false; message.value = formatUnknownApiError(error, "Word 原文读取失败，请检查后重试"); }
  } finally { if (generation === request) loading.value = false; }
}
function addPosition() {
  const field = source.value?.fields.find(value => value.key === additionalField.value);
  if (!field) return;
  rows.value.push({ ...field, rowId: nextRowId++, required: false, positionId: "", selectedText: "" });
  additionalField.value = "";
}
async function save() {
  const current = source.value;
  if (!current) return;
  busy.value = true;
  message.value = "";
  try {
    const bindings = rows.value.map(row => {
      const position = current.positions.find(value => value.positionId === row.positionId);
      const start = position?.text.indexOf(row.selectedText) ?? -1;
      if (!position || !row.selectedText || start < 0 || position.text.indexOf(row.selectedText, start + 1) >= 0) throw new Error(`请为${row.label}选择一处准确且唯一的原文`);
      return { fieldKey: row.key, positionId: position.positionId, start, end: start + row.selectedText.length };
    });
    await saveLayoutSourceMapping(props.versionId, { expectedRevision: current.draftRevision, sourceFileId: current.sourceFileId, sourceSha256: current.sourceSha256, bindings });
    baseline.value = serialized.value;
    confirmed.value = false;
    emit("dirty-change", false);
    emit("changed");
  } catch (error) { message.value = formatUnknownApiError(error, "填写位置保存失败，所选原文已保留"); }
  finally { busy.value = false; }
}
async function confirm() {
  const current = source.value;
  if (!current?.mappingFingerprint) return;
  busy.value = true;
  message.value = "";
  try {
    await confirmLayoutSourceMapping(props.versionId, { expectedRevision: current.draftRevision, sourceFileId: current.sourceFileId, sourceSha256: current.sourceSha256, mappingFingerprint: current.mappingFingerprint });
    await load();
    emit("changed");
  } catch (error) { message.value = formatUnknownApiError(error, "确认失败，请重新检查并预览"); }
  finally { busy.value = false; }
}
function previewSampleData() {
  const result: Record<string, unknown> = {};
  for (const row of rows.value) {
    const value = sampleValues.value[row.key] ?? "";
    if (row.required && !value.trim()) throw new Error(`请填写${row.label}的预览样例值`);
    if (!value) continue;
    const parts = row.key.split(".");
    let target = result;
    for (const part of parts.slice(0, -1)) { target[part] ??= {}; target = target[part] as Record<string, unknown>; }
    target[parts[parts.length - 1]] = value;
  }
  return result;
}
defineExpose({ previewSampleData });
</script>
<style scoped>
.panel { margin-top: var(--jg-space-lg); }
.source-text { max-height: min(50vh, 24rem); overflow: auto; border: 1px solid var(--jg-color-border); padding: var(--jg-space-md); white-space: pre-wrap; overflow-wrap: anywhere; }
.mapping-row { display: grid; gap: var(--jg-space-sm); margin-block: var(--jg-space-lg); grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); }
.mapping-row h3 { grid-column: 1 / -1; margin: 0; font-size: var(--jg-font-size-body); }
.mapping-actions { margin-top: var(--jg-space-lg); flex-wrap: wrap; }
</style>
