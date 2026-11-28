<template>
  <section class="contract-v2-signing" aria-label="盖章与签章归档">
    <h2>盖章与签章归档</h2>
    <p v-if="detail.v2Lifecycle?.status === 'unavailable'">{{ detail.v2Lifecycle.reason }}</p>
    <p v-else-if="context && context.state !== 'archived' && !context.webWriteReleased">新版合同办理入口尚未开放，当前资料仅供核对。</p>
    <p v-else-if="context?.state === 'pending_archive' && !context.archiveAction.enabled">{{ context.archiveAction.reason }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <t-button v-if="canSeal" :loading="busy" @click="sealDialog = true">确认已盖章</t-button>
    <t-button v-if="sealIntent" :loading="busy" variant="outline" @click="querySeal">查询本次盖章结果</t-button>
    <t-button v-if="canContinueSeal" :loading="busy" variant="outline" @click="sealContinueDialog = true">按原盖章信息继续</t-button>
    <template v-if="context?.state === 'pending_archive' || archiveIntent">
      <p>上传双方签章原件，由合同员人工核对后直接归档；支持1至20份PDF，并保留文件顺序。</p>
      <label v-if="canSelectFiles" class="signed-file-picker">
        选择双方签章PDF
        <!-- ui-rules-ignore: native-file-input; private PDF selection only, upload follows explicit archival confirmation. -->
        <input aria-label="选择双方签章PDF" type="file" accept="application/pdf" multiple @change="onFilesSelected">
      </label>
      <ol class="signed-file-list">
        <li v-for="(file, index) in files" :key="file.localId">
          <div class="signed-file-description"><strong>{{ file.name }}</strong><span>{{ file.fileId ? '已上传，待核对归档' : '待上传' }}</span><span v-if="file.error">{{ file.error }}</span></div>
          <div class="signed-file-actions">
            <t-button size="small" variant="text" :disabled="!canSelectFiles || index === 0" :aria-label="`上移：${file.name}`" @click="moveFile(index, -1)">上移</t-button>
            <t-button size="small" variant="text" :disabled="!canSelectFiles || index === files.length - 1" :aria-label="`下移：${file.name}`" @click="moveFile(index, 1)">下移</t-button>
            <t-button size="small" variant="text" :disabled="!canSelectFiles" :aria-label="`移除：${file.name}`" @click="removeFile(index)">移除</t-button>
          </div>
        </li>
      </ol>
      <div class="signed-main-actions">
        <t-button v-if="canArchive" :loading="busy" @click="openArchiveDialog">归档双方签章原件</t-button>
        <t-button v-if="archiveIntent" :loading="busy" variant="outline" @click="queryArchive">查询本次归档结果</t-button>
        <t-button v-if="canContinueArchive" :loading="busy" variant="outline" @click="continueDialog = true">按原请求继续</t-button>
      </div>
    </template>
    <t-dialog v-model:visible="sealDialog" header="确认线下盖章" confirm-btn="确认办理" cancel-btn="取消"
      :confirm-loading="busy" :close-on-overlay-click="false" @confirm="submitSeal">
      <p>请确认我方线下盖章已经完成</p>
    </t-dialog>
    <t-dialog v-model:visible="sealContinueDialog" header="继续核对原盖章信息" confirm-btn="确认按原盖章信息继续" cancel-btn="取消"
      :confirm-loading="busy" :close-on-overlay-click="false" @confirm="submitSealContinue">
      <p>将先读取原盖章任务；若仍未确认完成，仅按相同合同、轮次和盖章任务继续确认。</p>
    </t-dialog>
    <t-dialog v-model:visible="archiveDialog" header="核对双方签章原件" :confirm-btn="{ content: '确认归档', disabled: !matching }" cancel-btn="取消"
      :confirm-loading="busy" :close-on-overlay-click="false" @confirm="submitArchive">
      <p>归档后原件不能替换，请核对文件顺序及本轮签章内容。</p>
      <t-checkbox v-model="matching">我已人工核对原件与本轮合同内容一致</t-checkbox>
    </t-dialog>
    <t-dialog v-model:visible="continueDialog" header="继续核对原归档请求" confirm-btn="确认按原请求继续" cancel-btn="取消"
      :confirm-loading="busy" :close-on-overlay-click="false" @confirm="submitContinue">
      <p>将先查询原结果，再核对当前轮次和权限。若仍待核对，仅继续完全相同的原请求，不重新上传或更换文件。</p>
    </t-dialog>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { ContractDetailReadModel } from "@jiangkong/shared-domain";
import { useContractSignedArchive, type ContractSigningCompletion } from "./use-contract-signed-archive";
const props = defineProps<{ detail: ContractDetailReadModel; actorUserId?: string; routeContractId: string; externalBusy: boolean }>();
const emit = defineEmits<{ completed: [completion: ContractSigningCompletion]; lock: [value: boolean] }>();
const sealDialog = ref(false), sealContinueDialog = ref(false), archiveDialog = ref(false), continueDialog = ref(false), matching = ref(false);
const { context, busy, message, sealIntent, archiveIntent, files, canSeal, canSelectFiles, canArchive, canContinueSeal, canContinueArchive, locked,
  confirmSeal, querySeal, continueSeal, selectFiles, removeFile, moveFile, confirmArchive, queryArchive, continueArchive } = useContractSignedArchive({
  detail: computed(() => props.detail), actor: computed(() => props.actorUserId), routeContractId: computed(() => props.routeContractId),
  externalBusy: computed(() => props.externalBusy), refresh: completion => emit("completed", completion)
});
watch(locked, value => emit("lock", value), { immediate: true });
onBeforeUnmount(() => emit("lock", false));
async function submitSeal() { sealDialog.value = false; await confirmSeal(); }
async function submitSealContinue() { sealContinueDialog.value = false; await continueSeal(); }
function openArchiveDialog() { matching.value = false; archiveDialog.value = true; }
async function submitArchive() { if (!matching.value) return; archiveDialog.value = false; await confirmArchive(); }
async function submitContinue() { continueDialog.value = false; await continueArchive(); }
async function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []); input.value = ""; await selectFiles(selected);
}
</script>
<style scoped>
.contract-v2-signing { padding: var(--jg-space-md); margin-block: var(--jg-space-lg); border: 1px solid var(--jg-border); border-radius: var(--jg-radius-md); background: var(--jg-bg-panel); }
.contract-v2-signing h2 { font-size: var(--jg-font-section-title); margin-top: 0; }
.signed-file-picker { display: grid; gap: var(--jg-space-sm); }
.signed-file-picker input { max-width: 100%; }
.signed-file-list { padding-left: var(--jg-space-lg); }
.signed-file-list li { padding-block: var(--jg-space-sm); border-bottom: 1px solid var(--jg-border); }
.signed-file-description { display: grid; gap: var(--jg-space-xs); overflow-wrap: anywhere; }
.signed-file-description span { color: var(--jg-text-muted); }
.signed-file-actions, .signed-main-actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
</style>
