<template>
  <t-card
    class="ended-retention-panel"
    title="结束申请保留预览"
  >
    <template #actions>
      <t-button
        :loading="loading"
        variant="outline"
        @click="loadPreview"
      >
        刷新预览
      </t-button>
    </template>

    <t-alert
      theme="warning"
      :message="notice"
    />

    <BusinessFeedback
      v-if="message"
      :state="messageState"
      title="结束申请保留预览暂不可用"
      :description="message"
    />

    <div
      v-if="preview"
      class="retention-content"
    >
      <p class="retention-rule">
        保留期按结束日后的 {{ preview.retention.calendarMonths }} 个自然月计算；
        到期前 {{ preview.retention.previewWindowDays }} 天仅供预览，不执行物理删除。
      </p>

      <section>
        <h4>30 天内到期候选</h4>
        <t-table
          row-key="contractVersionId"
          :data="preview.candidates"
          :columns="candidateColumns"
          :loading="loading"
          size="small"
        >
          <template #terminalStatus="{ row }">
            {{ terminalStatusLabel(row.terminalStatus) }}
          </template>
          <template #remainingDays="{ row }">
            {{ row.remainingDays <= 0 ? "已到期" : `${row.remainingDays} 天` }}
          </template>
          <template #operation="{ row }">
            <t-button
              v-if="preview?.canManageRetention"
              theme="warning"
              variant="text"
              @click="openHoldDialog(row)"
            >
              设置保留
            </t-button>
          </template>
        </t-table>
      </section>

      <section>
        <h4>已保留的结束申请</h4>
        <t-table
          row-key="contractVersionId"
          :data="preview.heldRecords"
          :columns="heldColumns"
          :loading="loading"
          size="small"
        >
          <template #activeHold="{ row }">
            {{ row.activeHold?.reason ?? "—" }}
          </template>
          <template #operation="{ row }">
            <t-button
              v-if="preview?.canManageRetention"
              theme="primary"
              variant="text"
              @click="openReleaseDialog(row)"
            >
              解除保留
            </t-button>
          </template>
        </t-table>
      </section>

      <t-pagination
        v-if="preview.total > preview.limit"
        :current="preview.page"
        :page-size="preview.limit"
        :total="preview.total"
        show-page-size="false"
        @current-change="changePreviewPage"
      />
    </div>
  </t-card>

  <t-dialog
    v-if="preview?.canManageRetention && dialogMode === 'create'"
    v-model:visible="dialogVisible"
    header="设置结束申请保留"
    :confirm-btn="{ content: '确认设置', loading: saving, disabled: !reason.trim() }"
    cancel-btn="取消"
    :close-on-overlay-click="false"
    @confirm="submitCreateHold"
  >
    <div class="retention-dialog">
      <p>{{ selectedRecord?.contractCode }} · {{ selectedRecord?.contractName }}</p>
      <label>
        <span>原因</span>
        <t-textarea
          v-model="reason"
          placeholder="说明为何需要继续保留"
          :autosize="{ minRows: 3, maxRows: 6 }"
        />
      </label>
    </div>
  </t-dialog>

  <t-dialog
    v-if="preview?.canManageRetention && dialogMode === 'release'"
    v-model:visible="dialogVisible"
    header="解除结束申请保留"
    :confirm-btn="{ content: '确认解除', loading: saving, disabled: !reason.trim() }"
    cancel-btn="取消"
    :close-on-overlay-click="false"
    @confirm="submitReleaseHold"
  >
    <div class="retention-dialog">
      <p>{{ selectedRecord?.contractCode }} · {{ selectedRecord?.contractName }}</p>
      <label>
        <span>原因</span>
        <t-textarea
          v-model="reason"
          placeholder="说明保留解除依据"
          :autosize="{ minRows: 3, maxRows: 6 }"
        />
      </label>
    </div>
  </t-dialog>
</template>

<script setup lang="ts">
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, ref } from "vue";
import {
  createContractEndedApplicationRetentionHold,
  fetchContractEndedApplicationRetentionPreview,
  releaseContractEndedApplicationRetentionHold,
  type ContractEndedApplicationRetentionPreview,
  type ContractEndedApplicationRetentionRecord
} from "../../../api/contract-ended-retention.api";
import BusinessFeedback from "../../../components/BusinessFeedback.vue";

const preview = ref<ContractEndedApplicationRetentionPreview | null>(null);
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const messageState = ref<"error" | "info">("info");
const dialogVisible = ref(false);
const dialogMode = ref<"create" | "release">("create");
const selectedRecord = ref<ContractEndedApplicationRetentionRecord | null>(null);
const reason = ref("");
const previewPage = ref(1);
const previewLimit = 50;

const notice = computed(() =>
  preview.value?.notice ?? "仅合同部主管可预览并设置或解除结束申请保留；本功能不执行任何删除。"
);

const candidateColumns = [
  { colKey: "contractCode", title: "合同编号", width: 150 },
  { colKey: "contractName", title: "合同名称", minWidth: 180 },
  { colKey: "terminalStatus", title: "结束结果", width: 110 },
  { colKey: "purgeEligibleAt", title: "最早处理日", width: 180 },
  { colKey: "remainingDays", title: "剩余", width: 90 },
  { colKey: "operation", title: "操作", width: 110, fixed: "right" }
];
const heldColumns = [
  { colKey: "contractCode", title: "合同编号", width: 150 },
  { colKey: "contractName", title: "合同名称", minWidth: 180 },
  { colKey: "activeHold", title: "保留原因", minWidth: 200 },
  { colKey: "purgeEligibleAt", title: "最早处理日", width: 180 },
  { colKey: "operation", title: "操作", width: 110, fixed: "right" }
];

function terminalStatusLabel(status: ContractEndedApplicationRetentionRecord["terminalStatus"]) {
  return status === "abandoned" ? "已放弃" : "最终驳回";
}

async function loadPreview() {
  loading.value = true;
  message.value = "";
  try {
    const nextPreview = await fetchContractEndedApplicationRetentionPreview(
      previewPage.value,
      previewLimit
    );
    if (nextPreview.executionAllowed) {
      throw new Error("结束申请保留接口返回了非预览状态，已按安全策略停止展示。");
    }
    preview.value = nextPreview;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    messageState.value = "error";
    message.value = `结束申请保留预览读取失败：${detail}`;
  } finally {
    loading.value = false;
  }
}

function changePreviewPage(page: number) {
  previewPage.value = page;
  void loadPreview();
}

function openHoldDialog(record: ContractEndedApplicationRetentionRecord) {
  selectedRecord.value = record;
  dialogMode.value = "create";
  reason.value = "";
  dialogVisible.value = true;
}

function openReleaseDialog(record: ContractEndedApplicationRetentionRecord) {
  selectedRecord.value = record;
  dialogMode.value = "release";
  reason.value = "";
  dialogVisible.value = true;
}

async function submitCreateHold() {
  const record = selectedRecord.value!;
  saving.value = true;
  const request = createContractEndedApplicationRetentionHold(record.contractVersionId, {
    reason: reason.value.trim()
  });
  await request.then(
    async () => {
      await MessagePlugin.success("已设置结束申请保留，且已记录审计日志。");
      dialogVisible.value = false;
      void Promise.resolve().then(() => loadPreview());
    },
    async (error) => {
      const detail = error instanceof Error ? error.message : "未知错误";
      await MessagePlugin.error(`设置结束申请保留失败：${detail}`);
    }
  );
  saving.value = false;
}

async function submitReleaseHold() {
  const record = selectedRecord.value!;
  saving.value = true;
  const request = releaseContractEndedApplicationRetentionHold(record.contractVersionId, {
    reason: reason.value.trim()
  });
  await request.then(
    async () => {
      await MessagePlugin.success("已解除结束申请保留；如已超过保留期，系统会保留 30 天缓冲窗口。");
      dialogVisible.value = false;
      void Promise.resolve().then(() => loadPreview());
    },
    async (error) => {
      const detail = error instanceof Error ? error.message : "未知错误";
      await MessagePlugin.error(`解除结束申请保留失败：${detail}`);
    }
  );
  saving.value = false;
}

onMounted(() => {
  void loadPreview();
});
</script>

<style scoped>
.ended-retention-panel,
.retention-content,
.retention-content section,
.retention-dialog,
.retention-dialog label {
  display: grid;
  gap: var(--jg-space-md);
}

.ended-retention-panel {
  margin-bottom: var(--jg-space-lg);
}

.retention-content h4,
.retention-rule,
.retention-dialog p {
  margin: 0;
}

.retention-rule {
  color: var(--jg-color-text-secondary);
}
</style>
