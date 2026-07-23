<script setup lang="ts">
import EvidenceFileCards from "./EvidenceFileCards.vue";

interface JgAttachmentPanelFile {
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
  files: JgAttachmentPanelFile[];
}>();
</script>

<template>
  <section
    class="jg-attachment-panel"
    aria-label="业务附件"
  >
    <EvidenceFileCards :files="files" />
  </section>
</template>
