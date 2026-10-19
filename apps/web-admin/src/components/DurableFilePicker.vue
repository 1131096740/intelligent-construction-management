<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { UploadFile } from "tdesign-vue-next";
import { pendingAttachmentStore, type PendingAttachment } from "../lib/pending-attachment-store";
import { formatFileSize } from "./file-upload-summary.config";
import { formatUnknownApiError } from "../api/error-message";

const props = defineProps<{ modelValue: UploadFile[]; owner: string; scope: string; accept: string; limitBytes: number; disabled?: boolean; runMutation: (task: () => Promise<void>) => Promise<void> }>();
const emit = defineEmits<{ "update:modelValue": [files: UploadFile[]]; busy: [busy: boolean] }>();
const store = pendingAttachmentStore();
const input = ref<HTMLInputElement>();
const files = ref<PendingAttachment[]>([]);
const busy = ref(false);
const hydrating = ref(false);
const restoreFailed = ref(false);
const error = ref("");
const message = ref("");
const preview = ref<{ url: string; name: string; type: string }>();
const pending = computed(() => files.value.some((file) => !file.bytes));
const unavailable = computed(() => props.disabled || busy.value || hydrating.value || restoreFailed.value || !props.owner || !props.scope);
let generation = 0;
let disposed = false;

function publish() {
  emit("update:modelValue", files.value.filter((file) => file.bytes).map((file) => ({
    name: file.name, size: file.size, type: file.type, status: "waiting",
    raw: Object.assign(new File([file.bytes!], file.name, { type: file.type, lastModified: file.modified }), { uploadRequestKey: file.id })
  })));
  emit("busy", busy.value || hydrating.value || restoreFailed.value || pending.value);
}
async function refresh(owner: string, scope: string, request: number) {
  const next = await store.list(owner, scope);
  if (disposed || request !== generation) return;
  files.value = next;
  publish();
}
async function restoreFiles() {
  const request = ++generation;
  hydrating.value = Boolean(props.owner && props.scope);
  restoreFailed.value = false;
  files.value = []; error.value = ""; message.value = ""; closePreview(); publish();
  if (!props.owner || !props.scope) return;
  try { await refresh(props.owner, props.scope, request); }
  catch (cause) { if (request === generation) { error.value = formatUnknownApiError(cause, "本机附件读取失败，请保留原文件并重新读取。"); restoreFailed.value = true; } }
  finally { if (request === generation) { hydrating.value = false; publish(); } }
}
watch(() => [props.owner, props.scope], restoreFiles, { immediate: true });

async function selectFiles(event: Event) {
  const element = event.target as HTMLInputElement;
  const selected = Array.from(element.files ?? []);
  element.value = "";
  if (!selected.length || unavailable.value) return;
  const extensions = props.accept.split(",").map((part) => part.trim().toLowerCase());
  const invalid = selected.find((file) => file.size > props.limitBytes || !extensions.some((extension) => file.name.toLowerCase().endsWith(extension)));
  if (invalid) { error.value = `${invalid.name}：请使用支持的格式，单份不超过 ${formatFileSize(props.limitBytes)}。本批未添加。`; return; }
  const owner = props.owner, scope = props.scope, request = generation;
  busy.value = true; error.value = ""; message.value = "正在保留原文件，请稍候再关闭页面。"; publish();
  try {
    await props.runMutation(() => store.stage(owner, scope, selected));
    await refresh(owner, scope, request);
    if (request === generation) message.value = "原文件已保留，正在检查重复附件。";
  } catch (cause) {
    if (request === generation) { error.value = formatUnknownApiError(cause, "原文件读取或保留失败，请检查文件仍可访问后重新选择。"); message.value = "本批附件尚未添加，请保留原文件并重试。"; }
    return;
  }
  finally { busy.value = false; publish(); }
  if (request === generation) await processFiles();
}
async function processFiles() {
  if (unavailable.value) return;
  const owner = props.owner, scope = props.scope, request = generation;
  busy.value = true; error.value = ""; publish();
  let duplicates = 0;
  try {
    await props.runMutation(async () => {
      for (const file of files.value.filter((file) => !file.bytes)) {
        if (document.hidden || disposed || generation !== request) break;
        if (await store.finish(file)) duplicates++;
        await refresh(owner, scope, request);
      }
    });
    if (request === generation) message.value = pending.value ? "原文件已保留，返回后点“继续添加”。" : `已在本机保留 ${files.value.length} 份附件，保存草稿时上传。${duplicates ? `已跳过 ${duplicates} 份重复文件。` : ""}`;
  } catch (cause) { if (request === generation) error.value = formatUnknownApiError(cause, "附件检查未完成，原文件已保留，请稍后继续添加。"); }
  finally { busy.value = false; publish(); }
}
async function remove(file: PendingAttachment) {
  if (unavailable.value) return;
  const owner = props.owner, scope = props.scope, request = generation;
  busy.value = true; publish();
  try { await props.runMutation(() => store.remove(owner, scope, file.id)); await refresh(owner, scope, request); }
  catch (cause) { if (request === generation) error.value = formatUnknownApiError(cause, "附件尚未移除，请核对原页面后重试。"); }
  finally { busy.value = false; publish(); }
}
function closePreview() { if (preview.value) URL.revokeObjectURL(preview.value.url); preview.value = undefined; }
function showPreview(file: PendingAttachment) {
  closePreview();
  if (file.bytes) preview.value = { url: URL.createObjectURL(new Blob([file.bytes], { type: file.type })), name: file.name, type: file.type };
}
async function removeConfirmed(ids: readonly string[]) {
  const owner = props.owner, scope = props.scope, request = generation;
  await store.removeConfirmed(owner, scope, ids);
  await refresh(owner, scope, request);
}
defineExpose({ removeConfirmed });
onBeforeUnmount(() => { disposed = true; closePreview(); });
</script>

<template>
  <section class="durable-file-picker">
    <!-- ui-rules-ignore: native-file-input; iPhone camera and multi-select picker. -->
    <input
      ref="input"
      class="durable-file-picker__input"
      type="file"
      hidden
      :accept="accept"
      multiple
      :disabled="unavailable"
      aria-label="选择照片或文件"
      @change="selectFiles"
    >
    <div class="durable-file-picker__actions">
      <t-button
        variant="outline"
        :disabled="unavailable"
        @click="input?.click()"
      >
        选择照片或文件
      </t-button>
      <t-button
        v-if="pending"
        variant="outline"
        :loading="busy"
        :disabled="unavailable"
        @click="processFiles"
      >
        继续添加
      </t-button>
    </div>
    <t-button
      v-if="restoreFailed"
      variant="outline"
      :disabled="disabled || hydrating"
      @click="restoreFiles"
    >
      重新读取本机附件
    </t-button>
    <p role="status">
      {{ message || (files.length ? `已恢复 ${files.length} 份本机附件，保存前请核对。` : '支持批量选择；请等原文件保留完成后再退出。') }}
    </p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <ul>
      <li
        v-for="file in files"
        :key="file.id"
      >
        <div><strong>{{ file.name }}</strong><small>{{ formatFileSize(file.size) }} · {{ file.bytes ? '待上传' : '原文件已保留，待处理' }}</small></div>
        <t-button
          variant="text"
          :disabled="!file.bytes"
          @click="showPreview(file)"
        >
          预览
        </t-button>
        <t-button
          variant="text"
          :disabled="disabled || busy"
          @click="remove(file)"
        >
          移除
        </t-button>
      </li>
    </ul>
    <t-dialog
      :visible="Boolean(preview)"
      :header="preview?.name"
      :footer="false"
      @close="closePreview"
    >
      <img
        v-if="preview?.type.startsWith('image/')"
        :src="preview.url"
        :alt="preview.name"
        class="durable-file-picker__preview"
      >
      <iframe
        v-else-if="preview?.type === 'application/pdf'"
        :src="preview.url"
        :title="preview.name"
        class="durable-file-picker__preview"
      />
      <p v-else>
        此格式不能在页面内预览，原文件仍保留，可保存草稿后下载核对。
      </p>
    </t-dialog>
  </section>
</template>

<style scoped>
.durable-file-picker { display: grid; gap: var(--jg-space-sm); min-width: 0; }
.durable-file-picker__input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
.durable-file-picker__actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
p, ul { margin: 0; padding: 0; }
p, small { font-size: var(--jg-font-size-meta); color: var(--jg-color-text-tertiary); }
li { display: flex; align-items: center; gap: var(--jg-space-sm); padding: var(--jg-space-md) 0; border-bottom: var(--jg-border-width-base) solid var(--jg-color-border); }
li > div { flex: 1; min-width: 0; }
strong, small { display: block; overflow-wrap: anywhere; }
.durable-file-picker__preview { display: block; width: 100%; height: min(60vh, 600px); object-fit: contain; border: 0; }
</style>
