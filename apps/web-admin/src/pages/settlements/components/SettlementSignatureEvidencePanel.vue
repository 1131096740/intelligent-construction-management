<template>
  <section
    class="signature-evidence-panel"
    aria-label="结算签章证据"
  >
    <header class="signature-evidence-panel__header">
      <div>
        <h2>签章与审批证据</h2>
        <p>乙方原件与我方审批签名合成件分别冻结，全程保留审批时间线。</p>
      </div>
      <t-tag
        size="small"
        :theme="generationView.theme"
        variant="light"
      >
        {{ generationView.label }}
      </t-tag>
    </header>

    <t-alert
      v-if="generationState === 'failed'"
      theme="error"
      title="最终签名合成件生成失败"
      message="已通过的审批结果不受影响；请合同部主管使用重试入口，生成完成后再确认归档。"
    />

    <div class="signature-evidence-panel__files">
      <section
        v-for="slot in slots"
        :key="slot.kind"
        class="signature-evidence-slot"
      >
        <header>
          <strong>{{ slot.title }}</strong>
          <span>{{ slot.description }}</span>
        </header>
        <EvidenceFileCards :files="slot.files" />
        <div
          v-if="slot.files.some((file) => file.canDownload)"
          class="signature-evidence-slot__actions"
        >
          <t-button
            v-for="file in slot.files.filter((item) => item.canDownload)"
            :key="file.fileId"
            size="small"
            variant="outline"
            :disabled="disabled"
            @click="$emit('download', file.fileId)"
          >
            下载{{ slot.title }}
          </t-button>
        </div>
        <p
          v-if="!slot.files.length"
          class="signature-evidence-slot__empty"
        >
          {{ slot.kind === 'final_internal_signed_copy' && generationState === 'generating'
            ? '系统正在合成签名文件，完成后自动开放下载。'
            : slot.emptyText }}
        </p>
      </section>
    </div>

    <div
      v-if="canRetry || canRegenerate || canConfirm"
      class="signature-evidence-panel__actions"
    >
      <t-button
        v-if="canRetry"
        theme="primary"
        :loading="busyAction === 'generationRetry'"
        :disabled="disabled"
        @click="$emit('retry')"
      >
        重试生成签名合成件
      </t-button>
      <t-button
        v-if="canRegenerate"
        variant="outline"
        :loading="busyAction === 'regeneration'"
        :disabled="disabled"
        @click="$emit('regenerate')"
      >
        仅修复渲染问题并重新生成
      </t-button>
      <t-button
        v-if="canConfirm"
        theme="primary"
        :loading="busyAction === 'confirm'"
        :disabled="disabled"
        @click="$emit('confirm')"
      >
        确认最终签名合成件归档
      </t-button>
    </div>

    <section class="signature-evidence-panel__timeline">
      <header>
        <strong>审批时间线</strong>
        <span>展示冻结岗位、处理人、签名和审批时间。</span>
      </header>
      <ApprovalTimeline :items="approvalTimeline" />
    </section>
  </section>
</template>

<script setup lang="ts">
import type {
  ApprovalTimelineItemReadModel,
  EvidenceFileReadModel
} from "@jiangkong/shared-domain";
import { computed } from "vue";
import ApprovalTimeline from "../../../components/ApprovalTimeline.vue";
import EvidenceFileCards from "../../../components/EvidenceFileCards.vue";
import {
  buildSettlementSignatureEvidenceSlots,
  type SettlementSignatureGenerationState
} from "../settlement-detail.config";

const props = defineProps<{
  files: EvidenceFileReadModel[];
  approvalTimeline: ApprovalTimelineItemReadModel[];
  generationState: SettlementSignatureGenerationState;
  canRetry: boolean;
  canRegenerate: boolean;
  canConfirm: boolean;
  disabled?: boolean;
  busyAction?: string;
}>();

defineEmits<{
  download: [fileId: string];
  retry: [];
  regenerate: [];
  confirm: [];
}>();

const slots = computed(() => buildSettlementSignatureEvidenceSlots(props.files));
const generationView = computed(() => ({
  waiting: { label: "待审批完成", theme: "default" as const },
  generating: { label: "系统生成中", theme: "primary" as const },
  failed: { label: "生成失败", theme: "danger" as const },
  completed: { label: "最终件已冻结", theme: "success" as const }
}[props.generationState]));
</script>

<style scoped>
.signature-evidence-panel {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
}

.signature-evidence-panel__header,
.signature-evidence-slot > header,
.signature-evidence-panel__timeline > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-lg);
}

.signature-evidence-panel__header h2,
.signature-evidence-panel__header p,
.signature-evidence-slot__empty {
  margin: 0;
}

.signature-evidence-panel__header h2 {
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.signature-evidence-panel__header p,
.signature-evidence-slot header span,
.signature-evidence-panel__timeline header span,
.signature-evidence-slot__empty {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.signature-evidence-panel__header p {
  margin-top: var(--jg-space-xs);
}

.signature-evidence-panel__files {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.signature-evidence-slot {
  min-width: 0;
  padding: var(--jg-space-lg);
}

.signature-evidence-slot + .signature-evidence-slot {
  border-left: var(--jg-border-width-base) solid var(--jg-color-border);
}

.signature-evidence-slot > header,
.signature-evidence-panel__timeline > header {
  flex-direction: column;
  gap: var(--jg-space-xs);
}

.signature-evidence-slot :deep(.evidence-list) {
  padding: var(--jg-space-md) 0 0;
}

.signature-evidence-slot :deep(.evidence-empty) {
  display: none;
}

.signature-evidence-slot__empty {
  padding-top: var(--jg-space-md);
}

.signature-evidence-slot__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--jg-space-md);
}

.signature-evidence-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
}

.signature-evidence-panel__timeline {
  display: grid;
  gap: var(--jg-space-lg);
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

@media (max-width: 900px) {
  .signature-evidence-panel__files {
    grid-template-columns: 1fr;
  }

  .signature-evidence-slot + .signature-evidence-slot {
    border-top: var(--jg-border-width-base) solid var(--jg-color-border);
    border-left: 0;
  }
}
</style>
