<template>
  <section class="signed-settlements">
    <BusinessPageHeader title="已签结算登记" />
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-alert
      v-if="notice"
      theme="info"
      :message="notice"
    />
    <t-card>
      <t-form label-align="top">
        <t-form-item label="项目">
          <t-select
            v-model="projectId"
            :options="projectOptions"
            :disabled="busy"
            @change="changeProject"
          />
        </t-form-item>
        <t-form-item label="合同">
          <t-select
            v-model="contractKey"
            :options="contractOptions"
            :disabled="!projectId || busy || !!selected"
            @change="loadOverview"
          />
        </t-form-item>
        <template v-if="overview">
          <p>签约双方：{{ overview.party }}、{{ overview.counterparty }}</p>
          <p>已确认累计：{{ overview.confirmedYuan }} 元<span v-if="expectedYuan"> · 预计累计：{{ expectedYuan }} 元</span></p>
        </template>
        <t-form-item label="手填结算编号">
          <t-input
            v-model="number"
            :disabled="busy || readOnly"
          />
        </t-form-item>
        <t-form-item label="本期金额（元）">
          <t-input
            v-model="amount"
            placeholder="最多四位小数，可填负数"
            :disabled="busy || readOnly"
          />
        </t-form-item>
        <t-form-item label="双方已签附件">
          <div class="signed-settlements__files">
            <!-- ui-rules-ignore: native-file-input - 本地 PDF 与照片的多选上传。 -->
            <input
              v-if="overview?.canRegister"
              aria-label="选择已签 PDF 或照片"
              type="file"
              multiple
              accept="application/pdf,image/*"
              :disabled="!projectId || busy || readOnly"
              @change="addFiles"
            >
            <ul v-if="attachments.length">
              <li
                v-for="file in attachments"
                :key="file.fileId"
              >
                <span>{{ file.originalName }}</span>
                <t-button
                  v-if="isSavedAttachment(file.fileId) && selected?.canReadAttachments"
                  variant="text"
                  size="small"
                  :disabled="busy"
                  @click="openAttachment(file, 'preview')"
                >
                  预览
                </t-button>
                <t-button
                  v-if="isSavedAttachment(file.fileId) && selected?.canReadAttachments"
                  variant="text"
                  size="small"
                  :disabled="busy"
                  @click="openAttachment(file, 'download')"
                >
                  下载
                </t-button>
                <t-button
                  v-if="!readOnly"
                  variant="text"
                  size="small"
                  :disabled="busy"
                  @click="removeFile(file.fileId)"
                >
                  移除
                </t-button>
              </li>
            </ul>
          </div>
        </t-form-item>
        <t-form-item v-if="overview?.canRegister">
          <t-space>
            <t-button
              :disabled="!contractKey"
              :loading="busy"
              @click="save(false)"
            >
              存草稿
            </t-button>
            <t-button
              theme="primary"
              :disabled="!contractKey"
              :loading="busy"
              @click="save(true)"
            >
              提交主管复核
            </t-button>
          </t-space>
        </t-form-item>
        <template v-if="selected?.canReview">
          <t-form-item :label="selected.selfReview ? '自审原因' : '驳回原因'">
            <t-textarea
              v-model="reason"
              :disabled="busy"
            />
          </t-form-item>
          <t-form-item
            v-if="selected.selfReview"
            label="当前登录密码"
          >
            <t-input
              v-model="password"
              type="password"
              :disabled="busy"
            />
          </t-form-item>
          <t-form-item>
            <t-space>
              <t-button
                theme="primary"
                :loading="busy"
                @click="review('confirm')"
              >
                通过并入账
              </t-button>
              <t-button
                variant="outline"
                :loading="busy"
                @click="review('return')"
              >
                驳回
              </t-button>
            </t-space>
          </t-form-item>
        </template>
      </t-form>
    </t-card>
    <t-card title="已签结算单">
      <template #actions>
        <t-button
          variant="text"
          :disabled="!projectId || busy"
          @click="clearForm"
        >
          新建
        </t-button>
      </template>
      <ul
        v-if="rows.length"
        class="signed-settlements__records"
      >
        <li
          v-for="row in rows"
          :key="row.id"
        >
          <span>{{ row.number || "未填写编号" }} · {{ row.amountYuan ?? "金额待填" }} · {{ statusLabel[row.state] }}</span>
          <t-button
            variant="text"
            :disabled="busy"
            @click="open(row)"
          >
            {{ row.canReview ? "复核" : row.canUpdate ? "继续填写" : "查看" }}
          </t-button>
        </li>
      </ul>
      <p v-else>
        暂无结算单
      </p>
    </t-card>
    <SensitiveActionDialog
      v-model="fileAccessOpen"
      :title="fileAccessMode === 'preview' ? '预览已签结算附件' : '下载已签结算附件'"
      description="请确认操作原因和当前登录密码。系统会记录附件访问。"
      require-password
      require-reason
      :loading="busy"
      :error="error"
      @confirm="confirmAttachmentAccess"
    />
    <t-dialog
      v-model:visible="attachmentPreviewOpen"
      header="已签结算附件"
      width="90vw"
      :footer="false"
      @close="releaseAttachmentPreview"
    >
      <LayoutPdfPreview
        v-if="attachmentPreviewUrl && attachmentPreviewMime === 'application/pdf'"
        :url="attachmentPreviewUrl"
      />
      <img
        v-else-if="attachmentPreviewUrl"
        :src="attachmentPreviewUrl"
        alt="已签结算原件"
        class="signed-settlements__preview"
      >
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { fetchProjects, saveBlob } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchSignedSettlementContracts, fetchSignedSettlementOverview, fetchSignedSettlements,
  readSignedSettlementAttachment, reviewSignedSettlement, saveSignedSettlement, submitSignedSettlement, uploadSignedSettlementFile,
  type SignedContractOption, type SignedSettlementFile, type SignedSettlementRow
} from "../../api/signed-contract-settlement.api";

const LayoutPdfPreview = defineAsyncComponent(() => import("../../components/files/LayoutPdfPreview.vue"));
const fileAccessOpen = ref(false);
const fileAccessMode = ref<"preview" | "download">("preview");
const fileAccessTarget = ref<SignedSettlementFile>();
const attachmentPreviewOpen = ref(false);
const attachmentPreviewUrl = ref("");
const attachmentPreviewMime = ref("");

const route = useRoute();
const projectId = ref("");
const projectOptions = ref<Array<{ label: string; value: string }>>([]);
const contracts = ref<SignedContractOption[]>([]);
const rows = ref<SignedSettlementRow[]>([]);
const contractKey = ref("");
const number = ref("");
const amount = ref("");
const attachments = ref<SignedSettlementFile[]>([]);
const selected = ref<SignedSettlementRow>();
const overview = ref<Awaited<ReturnType<typeof fetchSignedSettlementOverview>>>();
const reason = ref("");
const password = ref("");
const error = ref("");
const notice = ref("");
const busy = ref(false);
const statusLabel = { draft: "草稿", pending_review: "待复核", returned: "已驳回", confirmed: "已确认" };
const relationshipLabel = { inside: "表内", outside: "表外", upward: "对上" };
const key = (option: SignedContractOption) => `${option.kind}:${option.id}`;
const contractOptions = computed(() => contracts.value.map(option => ({
  label: `${relationshipLabel[option.relationship]} · ${option.label}`, value: key(option)
})));
const readOnly = computed(() => !!selected.value && !selected.value.canUpdate);

function scaledAmount(value: string) {
  const normalized = normalizeBusinessAmount(value, { allowNegative: true });
  return normalized === null ? 0n : BigInt(normalized.replace(".", ""));
}

const expectedYuan = computed(() => {
  if (!overview.value || !amount.value.trim() || selected.value?.state === "confirmed") return "";
  try {
    const projected = scaledAmount(overview.value.confirmedYuan) + scaledAmount(amount.value);
    const absolute = projected < 0n ? -projected : projected;
    return `${projected < 0n ? "-" : ""}${absolute / 10000n}.${String(absolute % 10000n).padStart(4, "0")}`;
  } catch { return ""; }
});

onMounted(() => run(async () => {
  projectOptions.value = (await fetchProjects()).map(project => ({ label: project.name, value: project.id }));
  if (typeof route.query.projectId !== "string" || !projectOptions.value.some(p => p.value === route.query.projectId)) return;
  projectId.value = route.query.projectId;
  await readProject();
  const row = rows.value.find(item => item.id === route.query.settlementId);
  if (row) {
    show(row);
    await readOverview();
  }
}));

async function run(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { await operation(); }
  catch (failure) { error.value = formatUnknownApiError(failure, "办理结算失败"); }
  finally { busy.value = false; }
}

function clearForm() {
  selected.value = undefined;
  overview.value = undefined;
  contractKey.value = "";
  number.value = "";
  amount.value = "";
  reason.value = "";
  password.value = "";
  notice.value = "";
  attachments.value = [];
}

function changeProject() {
  clearForm();
  contracts.value = [];
  rows.value = [];
  if (!projectId.value) return;
  return run(readProject);
}

async function readProject() {
  [contracts.value, rows.value] = await Promise.all([
    fetchSignedSettlementContracts(projectId.value), fetchSignedSettlements(projectId.value)
  ]);
}

async function readOverview() {
  const option = contracts.value.find(item => key(item) === contractKey.value);
  overview.value = option ? await fetchSignedSettlementOverview(projectId.value, option) : undefined;
}

const loadOverview = () => run(readOverview);

function show(row: SignedSettlementRow) {
  selected.value = row;
  contractKey.value = `${row.contractKind}:${row.contractId}`;
  number.value = row.number ?? "";
  amount.value = row.amountYuan ?? "";
  attachments.value = [...row.attachments];
  reason.value = "";
  password.value = "";
  notice.value = row.reviewReason ?? "";
}

function open(row: SignedSettlementRow) {
  show(row);
  return loadOverview();
}

function addFiles(event: Event) {
  if (!overview.value?.canRegister) return;
  const picker = event.target as HTMLInputElement;
  const files = Array.from(picker.files ?? []);
  return run(async () => {
    try {
      for (const file of files) {
        const uploaded = await uploadSignedSettlementFile(projectId.value, file);
        attachments.value.push({ fileId: uploaded.id, originalName: uploaded.originalName, mimeType: uploaded.mimeType });
      }
    } finally { picker.value = ""; }
  });
}

function isSavedAttachment(fileId: string) {
  return selected.value?.attachments.some(file => file.fileId === fileId) === true;
}

function openAttachment(file: SignedSettlementFile, mode: "preview" | "download") {
  releaseAttachmentPreview();
  error.value = "";
  fileAccessTarget.value = file;
  fileAccessMode.value = mode;
  fileAccessOpen.value = true;
}

function releaseAttachmentPreview() {
  attachmentPreviewOpen.value = false;
  if (attachmentPreviewUrl.value) URL.revokeObjectURL(attachmentPreviewUrl.value);
  attachmentPreviewUrl.value = "";
}

onUnmounted(releaseAttachmentPreview);

function confirmAttachmentAccess(values: { password: string; reason: string }) {
  return run(async () => {
    const file = fileAccessTarget.value;
    const settlement = selected.value;
    if (!settlement || !settlement.canReadAttachments || !file || !isSavedAttachment(file.fileId)) return;
    const { blob, fileName, mimeType } = await readSignedSettlementAttachment(projectId.value, settlement.id, file.fileId, {
      confirmationPassword: values.password, downloadReason: values.reason, accessMode: fileAccessMode.value
    });
    fileAccessOpen.value = false;
    if (fileAccessMode.value === "preview") {
      attachmentPreviewUrl.value = URL.createObjectURL(blob);
      attachmentPreviewMime.value = mimeType;
      attachmentPreviewOpen.value = true;
      return;
    }
    saveBlob(blob, fileName);
  });
}

function removeFile(id: string) {
  attachments.value = attachments.value.filter(file => file.fileId !== id);
}

function save(submit: boolean) {
  return run(async () => {
    if (!overview.value?.canRegister) return;
    const option = contracts.value.find(item => key(item) === contractKey.value);
    if (!option) return;
    const saved = await saveSignedSettlement(projectId.value, {
      contractKind: option.kind, contractId: option.id,
      number: number.value, amountYuan: amount.value, fileIds: attachments.value.map(file => file.fileId)
    }, selected.value);
    selected.value = saved;
    if (submit) selected.value = await submitSignedSettlement(projectId.value, saved);
    notice.value = [submit ? "已提交主管复核" : "草稿已保存", saved.duplicateNumber ? "该合同已有同号结算，请核对原单" : ""].filter(Boolean).join("。");
    rows.value = await fetchSignedSettlements(projectId.value);
  });
}

function review(decision: "confirm" | "return") {
  return run(async () => {
    if (!selected.value?.canReview) return;
    selected.value = await reviewSignedSettlement(projectId.value, selected.value, decision, reason.value, password.value);
    password.value = "";
    notice.value = decision === "confirm" ? "已确认入账" : "已驳回给原制单人";
    rows.value = await fetchSignedSettlements(projectId.value);
    await readOverview();
  });
}
</script>

<style scoped>
.signed-settlements, .signed-settlements__files { display: grid; gap: var(--jg-space-md); }
.signed-settlements__records { display: grid; gap: var(--jg-space-sm); padding-inline-start: var(--jg-space-lg); }
.signed-settlements__records li { overflow-wrap: anywhere; }
.signed-settlements__preview { display: block; max-width: 100%; max-height: 70vh; margin-inline: auto; }
</style>
