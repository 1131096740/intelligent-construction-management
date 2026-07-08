<template>
  <div class="evidence-list">
    <div
      v-if="!files.length"
      class="evidence-empty"
    >
      暂无业务文件
    </div>
    <template v-else>
      <article
        v-for="file in files"
        :key="file.recordId"
        class="evidence-card"
      >
        <div class="evidence-main">
          <strong>{{ file.fileName }}</strong>
          <span>{{ file.purpose }} · {{ formatFileSize(file.sizeBytes) }}</span>
        </div>
        <div class="evidence-meta">
          <span v-if="file.businessRef">业务归属：{{ file.businessRef }}</span>
          <span class="evidence-tag-item">
            状态：
            <t-tag
              size="small"
              :theme="toEvidenceFileCardView(file).statusTheme"
            >
              {{ file.statusLabel }}
            </t-tag>
          </span>
          <span>上传：{{ file.uploadedByName }} · {{ formatTime(file.uploadedAt) }}</span>
          <span v-if="file.confirmedAt">
            确认：{{ file.confirmedByName ?? "-" }} · {{ formatTime(file.confirmedAt) }}
          </span>
          <span class="evidence-tag-item">
            下载：
            <t-tag
              size="small"
              :theme="toEvidenceFileCardView(file).downloadTheme"
            >
              {{ toEvidenceFileCardView(file).downloadText }}
            </t-tag>
          </span>
          <span>{{ toEvidenceFileCardView(file).auditHint }}</span>
          <span
            v-if="toEvidenceFileCardView(file).disabledReason"
            class="evidence-blocked-reason"
          >
            {{ toEvidenceFileCardView(file).disabledReason }}
          </span>
        </div>
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { toEvidenceFileCardView } from "./evidence-file-cards.config";

interface EvidenceFileCardItem {
  recordId: string;
  fileName: string;
  businessRef?: string;
  purpose: string;
  sizeBytes: number;
  statusLabel: string;
  uploadedByName: string;
  uploadedAt: string;
  confirmedByName?: string | null;
  confirmedAt?: string | null;
  canDownload: boolean;
  disabledReason?: string | null;
  auditHint?: string;
}

defineProps<{
  files: EvidenceFileCardItem[];
}>();

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.evidence-list {
  display: grid;
  gap: 10px;
  padding: var(--jg-space-lg);
}

.evidence-empty {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-body);
}

.evidence-card {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-md);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-panel);
}

.evidence-main {
  display: grid;
  gap: var(--jg-space-xs);
}

.evidence-main strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-body);
}

.evidence-main span,
.evidence-meta {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.evidence-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.evidence-tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.evidence-blocked-reason {
  color: var(--td-warning-color, #e37318);
}
</style>
