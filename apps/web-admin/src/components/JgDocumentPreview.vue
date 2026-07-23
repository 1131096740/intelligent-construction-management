<script setup lang="ts">
import { computed } from "vue";

export interface JgDocumentPreviewItem {
  id: string;
  label: string;
  description: string;
  fileName: string;
  statusLabel: string;
  pageCount?: number | null;
  available: boolean;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  documents: readonly JgDocumentPreviewItem[];
  previewUrl?: string;
  previewing?: boolean;
}>(), {
  previewUrl: "",
  previewing: false
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  preview: [document: JgDocumentPreviewItem];
}>();

const selected = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value)
});
const selectedDocument = computed(() =>
  props.documents.find((document) => document.id === selected.value) ?? null
);

function requestPreview() {
  if (selectedDocument.value?.available) emit("preview", selectedDocument.value);
}
</script>

<template>
  <section
    class="jg-document-preview"
    aria-label="正式文件预览"
  >
    <header class="jg-document-preview__heading">
      <div>
        <h3>正式 PDF 预览</h3>
        <p>选择已留存版本后需再次确认当前密码；预览链接五分钟失效并单独留痕。</p>
      </div>
      <div class="jg-document-preview__actions">
        <t-button
          theme="primary"
          :loading="previewing"
          :disabled="!selectedDocument?.available"
          @click="requestPreview"
        >
          预览当前版本
        </t-button>
        <slot
          name="actions"
          :document="selectedDocument"
        />
      </div>
    </header>

    <t-radio-group
      v-model="selected"
      class="jg-document-preview__versions"
      aria-label="正式文件版本"
      variant="primary-filled"
    >
      <t-radio-button
        v-for="document in documents"
        :key="document.id"
        :value="document.id"
        :disabled="!document.available"
      >
        {{ document.label }}
      </t-radio-button>
    </t-radio-group>

    <div
      v-if="selectedDocument"
      class="jg-document-preview__meta"
    >
      <strong>{{ selectedDocument.fileName || selectedDocument.label }}</strong>
      <span>{{ selectedDocument.statusLabel }}</span>
      <span v-if="selectedDocument.pageCount">{{ selectedDocument.pageCount }} 页</span>
      <small>{{ selectedDocument.description }}</small>
    </div>

    <iframe
      v-if="previewUrl"
      class="jg-document-preview__frame"
      :src="previewUrl"
      :title="`${selectedDocument?.label ?? '正式文件'}预览`"
      referrerpolicy="no-referrer"
    />
    <t-alert
      v-else
      theme="info"
      class="jg-document-preview__placeholder"
    >
      当前未加载预览内容；预览和下载均会重新校验权限、当前密码及操作原因。
    </t-alert>
  </section>
</template>

<style scoped>
.jg-document-preview { display: grid; gap: var(--jg-space-md); }
.jg-document-preview__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--jg-space-md); }
.jg-document-preview__heading h3, .jg-document-preview__heading p { margin: 0; }
.jg-document-preview__heading p, .jg-document-preview__meta small { color: var(--jg-color-text-secondary); }
.jg-document-preview__actions, .jg-document-preview__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--jg-space-sm); }
.jg-document-preview__versions { overflow-x: auto; white-space: nowrap; }
.jg-document-preview__meta { padding: var(--jg-space-sm) var(--jg-space-md); border-radius: var(--jg-radius-md); background: var(--jg-color-bg-secondary); }
.jg-document-preview__meta small { flex-basis: 100%; }
.jg-document-preview__frame { width: 100%; min-height: 640px; border: 1px solid var(--jg-color-border); border-radius: var(--jg-radius-md); background: var(--jg-color-bg-page); }
@media (max-width: 720px) { .jg-document-preview__heading { flex-direction: column; } .jg-document-preview__actions { width: 100%; } .jg-document-preview__actions :deep(.t-button) { flex: 1 1 auto; } .jg-document-preview__frame { min-height: 440px; } }
</style>
