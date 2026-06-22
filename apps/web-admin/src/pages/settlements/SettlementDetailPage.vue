<template>
  <section class="settlement-detail-page">
    <div class="page-head">
      <div>
        <h1>结算详情</h1>
        <p>{{ settlementDetailTitleView }}</p>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          @click="reloadSettlementDetail"
        >
          刷新
        </t-button>
        <t-button @click="openChainLink('/audit')">
          查看审批记录
        </t-button>
      </div>
    </div>

    <div class="meta-panel">
      <div
        v-for="item in settlementDetailMetaView"
        :key="item.label"
        class="meta-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="item.tone ? `tone-${item.tone}` : undefined">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="chain-strip">
      <span>业务链路</span>
      <t-link
        v-for="link in settlementDetailChainLinksView"
        :key="link.to"
        theme="primary"
        @click="openChainLink(link.to)"
      >
        {{ link.label }}
      </t-link>
    </div>

    <t-card
      class="section-card action-card"
      title="归档操作"
      :bordered="true"
    >
      <div class="action-grid">
        <div class="action-group">
          <div class="action-title">
            <strong>上传签章结算单</strong>
            <span>合同部成员</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="settlementArchiveForm.fileId"
              placeholder="签章结算单文件ID"
            />
            <t-input
              v-model="settlementArchiveForm.uploadedByUserId"
              placeholder="上传人ID"
            />
          </div>
          <t-button
            theme="primary"
            :loading="archiveActionBusy === 'upload'"
            :disabled="!canUploadSettlementArchive"
            @click="submitSettlementArchiveUpload"
          >
            提交归档件
          </t-button>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>主管确认归档</strong>
            <span>确认后结算生效</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="settlementArchiveForm.archiveFileId"
              placeholder="归档记录ID"
            />
            <t-input
              v-model="settlementArchiveForm.confirmedByUserId"
              placeholder="确认人ID"
            />
          </div>
          <t-button
            theme="primary"
            :loading="archiveActionBusy === 'confirm'"
            :disabled="!canConfirmSettlementArchive"
            @click="submitSettlementArchiveConfirmation"
          >
            确认生效
          </t-button>
        </div>
      </div>

      <div
        v-if="archiveActionMessage"
        :class="['action-message', archiveActionMessageTone]"
      >
        {{ archiveActionMessage }}
      </div>
    </t-card>

    <div class="detail-grid">
      <t-card
        title="基础信息"
        :bordered="true"
      >
        <dl class="info-list">
          <template
            v-for="item in settlementBaseInfoView"
            :key="item.label"
          >
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </t-card>

      <t-card
        title="生效流程与阻断点"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in settlementEffectivenessStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
            <t-tag
              size="small"
              :theme="tagTheme(step.tone)"
              variant="light"
            >
              {{ step.status }}
            </t-tag>
          </div>
        </div>
      </t-card>
    </div>

    <div class="responsibility-strip">
      <span
        v-for="item in settlementArchiveResponsibilitiesView"
        :key="item"
      >
        {{ item }}
      </span>
    </div>

    <t-card
      class="section-card"
      title="付款执行规则"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="settlementPaymentRuleColumns"
        :data="settlementPaymentRulesView"
      />
    </t-card>

    <t-card
      class="section-card"
      title="付款申请"
      :bordered="true"
    >
      <div class="block-message">
        {{ settlementPaymentBlockMessageView }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, SettlementDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  confirmSettlementArchive,
  fetchSettlementDetail,
  uploadSettlementArchiveFile
} from "../../api/core-flow-read.api";
import { settlementDetailChainLinks } from "../business-chain-links.config";
import type { SettlementDetailTone } from "./settlement-detail.config";
import {
  settlementArchiveResponsibilities,
  settlementBaseInfo,
  settlementDetailMeta,
  settlementDetailTitle,
  settlementEffectivenessSteps,
  settlementPaymentBlockMessage,
  settlementPaymentRuleColumns,
  settlementPaymentRules
} from "./settlement-detail.config";

const route = useRoute();
const router = useRouter();
const settlementDetail = ref<SettlementDetailReadModel | null>(null);
const archiveActionBusy = ref("");
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const settlementArchiveForm = reactive({
  fileId: "",
  uploadedByUserId: "",
  archiveFileId: "",
  confirmedByUserId: ""
});

const settlementDetailTitleView = computed(() => settlementDetail.value?.title ?? settlementDetailTitle);
const settlementDetailMetaView = computed(() => settlementDetail.value?.meta ?? settlementDetailMeta);
const settlementBaseInfoView = computed(() => settlementDetail.value?.baseInfo ?? settlementBaseInfo);
const settlementEffectivenessStepsView = computed(
  () => settlementDetail.value?.effectivenessSteps ?? settlementEffectivenessSteps
);
const settlementArchiveResponsibilitiesView = computed(
  () => settlementDetail.value?.archiveResponsibilities ?? settlementArchiveResponsibilities
);
const settlementPaymentRulesView = computed(
  () => settlementDetail.value?.paymentRules ?? settlementPaymentRules
);
const settlementPaymentBlockMessageView = computed(
  () => settlementDetail.value?.paymentBlockMessage ?? settlementPaymentBlockMessage
);
const settlementDetailChainLinksView = computed(
  () => settlementDetail.value?.chainLinks ?? settlementDetailChainLinks
);
const settlementNextActionValue = computed(
  () => settlementDetailMetaView.value.find((item) => item.label === "下一步动作")?.value ?? ""
);
const canUploadSettlementArchive = computed(
  () => !!settlementDetail.value?.settlementId && settlementNextActionValue.value.includes("上传签章归档件")
);
const canConfirmSettlementArchive = computed(
  () => !!settlementDetail.value?.settlementId && settlementNextActionValue.value.includes("主管确认归档")
);

function openChainLink(to: string) {
  void router.push(to);
}

async function reloadSettlementDetail() {
  const settlementId = String(route.params.settlementId ?? "JS-2026-018");

  try {
    settlementDetail.value = await fetchSettlementDetail(settlementId);
  } catch {
    settlementDetail.value = null;
  }
}

onMounted(async () => {
  await reloadSettlementDetail();
});

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label}不能为空`);
  }

  return value;
}

function returnedId(result: unknown) {
  if (result && typeof result === "object" && "id" in result) {
    return String((result as { id: unknown }).id);
  }

  return "";
}

async function runArchiveAction(key: string, action: () => Promise<unknown>) {
  archiveActionBusy.value = key;
  archiveActionMessage.value = "";

  try {
    await action();
    await reloadSettlementDetail();
    archiveActionMessageTone.value = "success";
    archiveActionMessage.value = "操作已提交，详情已刷新。";
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    archiveActionBusy.value = "";
  }
}

async function submitSettlementArchiveUpload() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算ID");

  await runArchiveAction("upload", async () => {
    const result = await uploadSettlementArchiveFile(settlementId, {
      fileId: requiredText(settlementArchiveForm.fileId, "签章结算单文件ID"),
      uploadedByUserId: requiredText(settlementArchiveForm.uploadedByUserId, "上传人ID")
    });
    settlementArchiveForm.archiveFileId = returnedId(result);
  });
}

async function submitSettlementArchiveConfirmation() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算ID");

  await runArchiveAction("confirm", () =>
    confirmSettlementArchive(settlementId, {
      archiveFileId: requiredText(settlementArchiveForm.archiveFileId, "归档记录ID"),
      confirmedByUserId: requiredText(settlementArchiveForm.confirmedByUserId, "确认人ID")
    })
  );
}

function tagTheme(tone: SettlementDetailTone | CoreFlowTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.settlement-detail-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}

.meta-panel {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  padding: 18px 20px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.meta-item {
  display: grid;
  gap: 10px;
}

.meta-item span,
.info-list dt {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.meta-item strong {
  font-size: 13px;
}

.chain-strip {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 16px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.chain-strip span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.tone-primary {
  color: #0052cc;
}

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.info-list {
  display: grid;
  grid-template-columns: 104px 1fr;
  row-gap: 16px;
  margin: 0;
}

.info-list dd {
  margin: 0;
}

.flow-list {
  display: grid;
  gap: 12px;
}

.flow-row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}

.flow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #767f8d;
}

.dot-primary {
  background: #0052cc;
}

.dot-danger {
  background: #b51d2a;
}

.dot-success {
  background: #1b6b3a;
}

.responsibility-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.responsibility-strip span {
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-right: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
}

.responsibility-strip span:last-child {
  border-right: 0;
}

.section-card {
  margin-top: 20px;
  border-radius: 3px;
}

.action-card {
  margin-bottom: 20px;
}

:deep(.section-card .t-card__body) {
  padding: 0;
  overflow-x: auto;
}

.action-card :deep(.t-card__body) {
  padding: 16px;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.action-group {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.action-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.action-title strong {
  font-size: 13px;
}

.action-title span {
  color: #767f8d;
  font-size: 12px;
}

.action-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.action-message {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}

.action-message.success {
  color: #1b6b3a;
  background: #f3faf5;
}

.action-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.block-message {
  padding: 18px 20px;
  color: #b51d2a;
  font-weight: 600;
}

@media (max-width: 980px) {
  .meta-panel,
  .detail-grid,
  .responsibility-strip,
  .action-grid,
  .action-fields {
    grid-template-columns: 1fr;
  }

  .chain-strip {
    flex-wrap: wrap;
    padding: 10px 16px;
  }
}
</style>
