<script setup lang="ts">
import type { BusinessSummaryTone } from "../../components/business-status-summary.config";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createSpotProcurementVersion,
  fetchSpotProcurementDetail,
  reviewSpotProcurement,
  submitSpotProcurement,
  updateSpotProcurementDraft,
  voidSpotProcurement,
  withdrawSpotProcurement,
  type SpotProcurementDetailReadModel
} from "../../api/spot-procurement.api";
import { downloadApprovalForm, uploadPrivateFile } from "../../api/core-flow-read.api";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import {
  SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY,
  SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY,
  spotProcurementQuotationFileError,
  spotProcurementReferencePhotoFileError
} from "../../components/file-upload-policy.config";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import ProcurementLineEditor, { type ProcurementLineDraft } from "./components/ProcurementLineEditor.vue";
import {
  activeSpotProcurementAttachmentIds,
  retainedSpotProcurementAttachments
} from "./spot-procurement-attachments";

type ActionKind =
  | "review_approve"
  | "review_reject"
  | "review_return"
  | "withdraw"
  | "void"
  | "download";

const route = useRoute();
const router = useRouter();
const detail = ref<SpotProcurementDetailReadModel | null>(null);
const loading = ref(false);
const actionBusy = ref(false);
const loadError = ref("");
const actionMessage = ref("");
const actionState = ref<"success" | "error">("success");
const activeTab = ref("overview");
const editVisible = ref(false);
const editMode = ref<"draft" | "version">("draft");
const editError = ref("");
const editQuotationFiles = ref<UploadFile[]>([]);
const editReferencePhotoFiles = ref<UploadFile[]>([]);
const retainedAttachmentFileIds = ref<string[]>([]);
const editForm = reactive({
  applicationDepartment: "",
  applicationName: "",
  requestedArrivalAt: "",
  reason: "",
  note: "",
  changeReason: "",
  lines: [] as ProcurementLineDraft[]
});
const confirmation = reactive({
  visible: false,
  kind: "withdraw" as ActionKind,
  title: "",
  description: "",
  confirmText: "确认",
  confirmTheme: "primary" as "primary" | "danger",
  requireReason: false,
  requirePassword: false,
  reasonLabel: "操作原因"
});

const quotationSizeLimit = {
  size: SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};

const procurementId = computed(() =>
  typeof route.params.procurementId === "string" ? route.params.procurementId : ""
);
const primaryAction = computed(() =>
  detail.value?.availableActions.find((action) => action.key === detail.value?.primaryAction)
);
const linkedPayment = computed(() => {
  const paymentId = detail.value?.procurement.payment?.paymentId;
  if (!paymentId) return null;
  return detail.value?.payments.find((payment) => payment.id === paymentId) ?? null;
});
const linkedPaymentActionLabel = computed(() => {
  const payment = linkedPayment.value;
  if (!payment) return "";
  if (payment.status === "draft") return "填写付款申请";
  if (payment.currentTask.enabled && payment.currentTask.scope !== "none") {
    return "处理付款";
  }
  return "查看付款申请";
});
const materialColumns = [
  { colKey: "sortOrder", title: "序号", width: 70 },
  { colKey: "materialName", title: "名称", width: 180 },
  { colKey: "specification", title: "型号", width: 160 },
  { colKey: "unit", title: "单位", width: 90 },
  { colKey: "quantity", title: "数量", width: 120 },
  { colKey: "note", title: "备注", width: 180 }
];

function statusTone(status: string): BusinessSummaryTone {
  if (status === "closed") return "success";
  if (status === "voided") return "danger";
  if (status === "approval_pending") return "warning";
  if (status === "approved_in_progress") return "primary";
  return "default";
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function toDateInput(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function paymentSummaryLabel(current: SpotProcurementDetailReadModel) {
  const payment = current.procurement.payment;
  if (!payment || payment.approvalAmountCents === null) return "付款金额待确定";
  return payment.statusLabel;
}

function receiptSummaryLabel(current: SpotProcurementDetailReadModel) {
  return "label" in current.receipt
    ? current.receipt.label
    : current.receipt.statusLabel;
}

function actionEnabled(key: string) {
  return Boolean(detail.value?.availableActions.find((action) => action.key === key && action.enabled));
}

function actionLabel(key: string) {
  return detail.value?.availableActions.find((action) => action.key === key)?.label ?? "";
}

function paymentDetailUrl(paymentId: string) {
  return `/零星材料付款/${encodeURIComponent(paymentId)}?tab=current`;
}

function openLinkedPayment() {
  if (!linkedPayment.value) return;
  void router.push(paymentDetailUrl(linkedPayment.value.id));
}

async function loadDetail() {
  if (!procurementId.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    detail.value = await fetchSpotProcurementDetail(procurementId.value);
  } catch (error) {
    detail.value = null;
    loadError.value = error instanceof Error ? error.message : "零星采购详情读取失败";
  } finally {
    loading.value = false;
  }
}

function openEdit(mode: "draft" | "version" = "draft") {
  const current = detail.value;
  const actionKey = mode === "version" ? "create_version" : "edit_draft";
  if (!current || !actionEnabled(actionKey)) return;
  editMode.value = mode;
  editForm.applicationDepartment = current.currentVersion.applicationDepartment ?? "";
  editForm.applicationName = current.currentVersion.applicationName ?? "";
  editForm.requestedArrivalAt = toDateInput(current.currentVersion.requestedArrivalAt);
  editForm.reason = current.currentVersion.reason;
  editForm.note = current.currentVersion.note ?? "";
  editForm.changeReason = "";
  editForm.lines = current.lines.map((line) => ({
    materialName: line.materialName,
    specification: line.specification ?? "",
    unit: line.unit,
    quantity: line.quantity,
    note: line.note ?? ""
  }));
  editQuotationFiles.value = [];
  editReferencePhotoFiles.value = [];
  retainedAttachmentFileIds.value = activeSpotProcurementAttachmentIds(current.attachments);
  editError.value = "";
  editVisible.value = true;
}

async function saveDraft() {
  const current = detail.value;
  if (!current) return;
  editError.value = "";
  actionBusy.value = true;
  try {
    const applicationDepartment = requiredText(editForm.applicationDepartment, "申请部门");
    const applicationName = requiredText(editForm.applicationName, "申请人");
    if (!editForm.requestedArrivalAt) throw new Error("请选择要求采购到位日期");
    const reason = requiredText(editForm.reason, "物资用途及采购原因");
    if (!editForm.lines.length) throw new Error("请至少填写一条材料明细");
    const attachments = retainedSpotProcurementAttachments(current.attachments, retainedAttachmentFileIds.value);
    for (const file of selectedUploadFiles(editQuotationFiles.value)) {
      const validationError = spotProcurementQuotationFileError(file);
      if (validationError) throw new Error(validationError);
      const uploaded = await uploadPrivateFile(file, file.name);
      attachments.push({ fileId: uploaded.id, category: "merchant_quote" });
    }
    for (const file of selectedUploadFiles(editReferencePhotoFiles.value)) {
      const validationError = spotProcurementReferencePhotoFileError(file);
      if (validationError) throw new Error(validationError);
      const uploaded = await uploadPrivateFile(file, file.name);
      attachments.push({ fileId: uploaded.id, category: "reference_photo" });
    }
    const draft = {
      applicationDepartment,
      applicationName,
      requestedArrivalAt: editForm.requestedArrivalAt,
      reason,
      note: optionalText(editForm.note),
      lines: editForm.lines.map((line) => ({
        materialName: requiredText(line.materialName, "材料名称"),
        specification: optionalText(line.specification) ?? undefined,
        unit: requiredText(line.unit, "材料单位"),
        quantity: requiredQuantity(line.quantity),
        note: optionalText(line.note) ?? undefined
      })),
      attachments
    };
    if (editMode.value === "version") {
      await createSpotProcurementVersion(current.procurement.id, {
        ...draft,
        changeReason: requiredText(editForm.changeReason, "版本变更原因")
      });
    } else {
      await updateSpotProcurementDraft(current.procurement.id, draft);
    }
    editVisible.value = false;
    showSuccess(editMode.value === "version" ? "采购修订版本已创建。" : "采购草稿已保存。");
    await loadDetail();
  } catch (error) {
    editError.value = error instanceof Error ? error.message : "采购草稿保存失败";
  } finally {
    actionBusy.value = false;
  }
}

async function runSubmit() {
  const current = detail.value;
  if (!current) return;
  actionBusy.value = true;
  try {
    await submitSpotProcurement(current.procurement.id);
    showSuccess("零星材料采购申请已提交审批。");
    await loadDetail();
  } catch (error) {
    showError(error, "提交失败");
  } finally {
    actionBusy.value = false;
  }
}

function openConfirmation(kind: ActionKind) {
  const configurations: Record<ActionKind, Omit<typeof confirmation, "visible" | "kind">> = {
    review_approve: {
      title: "确认通过采购审批",
      description: "通过后审批流进入下一节点或完成，并冻结本次采购审批单。",
      confirmText: "确认通过",
      confirmTheme: "primary",
      requireReason: false,
      requirePassword: false,
      reasonLabel: "审批意见"
    },
    review_reject: {
      title: "驳回采购申请",
      description: "驳回将中止当前审批，请写明可执行的退回原因。",
      confirmText: "确认驳回",
      confirmTheme: "danger",
      requireReason: true,
      requirePassword: false,
      reasonLabel: "驳回原因"
    },
    review_return: {
      title: "退回采购申请人",
      description: "退回后保留本次审批事实，并生成新的可修改采购草稿。",
      confirmText: "确认退回",
      confirmTheme: "danger",
      requireReason: true,
      requirePassword: false,
      reasonLabel: "退回原因"
    },
    withdraw: {
      title: "撤回采购审批",
      description: "仅申请人可撤回审批中的采购申请，撤回后回到可修改状态。",
      confirmText: "确认撤回",
      confirmTheme: "danger",
      requireReason: false,
      requirePassword: false,
      reasonLabel: "撤回说明"
    },
    void: {
      title: "撤销零星采购",
      description: "采购正式办结前可以撤销；撤销会保留完整审计历史。",
      confirmText: "确认撤销",
      confirmTheme: "danger",
      requireReason: true,
      requirePassword: false,
      reasonLabel: "撤销原因"
    },
    download: {
      title: "下载采购审批单",
      description: "审批单属于敏感业务文件，下载将记录账号、原因和审计轨迹。",
      confirmText: "确认下载",
      confirmTheme: "primary",
      requireReason: true,
      requirePassword: true,
      reasonLabel: "下载原因"
    }
  };
  Object.assign(confirmation, configurations[kind], { visible: true, kind });
}

async function confirmAction(values: { reason: string; password: string }) {
  const current = detail.value;
  if (!current) return;
  actionBusy.value = true;
  try {
    if (confirmation.kind === "review_approve") {
      await reviewSpotProcurement(current.procurement.id, { decision: "approve" });
      showSuccess("采购审批已通过。");
    } else if (confirmation.kind === "review_reject") {
      await reviewSpotProcurement(current.procurement.id, { decision: "reject", comment: values.reason });
      showSuccess("采购申请已驳回。");
    } else if (confirmation.kind === "review_return") {
      await reviewSpotProcurement(current.procurement.id, { decision: "return_to_applicant", comment: values.reason });
      showSuccess("采购申请已退回，并已生成新的修改草稿。");
    } else if (confirmation.kind === "withdraw") {
      await withdrawSpotProcurement(current.procurement.id);
      showSuccess("采购审批已撤回。");
    } else if (confirmation.kind === "void") {
      await voidSpotProcurement(current.procurement.id, { reason: values.reason });
      showSuccess("零星采购已撤销。");
    } else {
      await downloadApprovalForm(current.applicationPdf.businessType, current.applicationPdf.businessId, {
        confirmationPassword: values.password,
        downloadReason: values.reason
      });
      showSuccess("采购审批单已开始下载。");
    }
    confirmation.visible = false;
    await loadDetail();
  } catch (error) {
    showError(error, "操作失败");
  } finally {
    actionBusy.value = false;
  }
}

function runPrimaryAction() {
  const key = primaryAction.value?.key;
  if (key === "submit_approval") void runSubmit();
  else if (key === "review_approval") openConfirmation("review_approve");
  else if (key === "create_version") openEdit("version");
}

function showSuccess(message: string) {
  actionState.value = "success";
  actionMessage.value = message;
}

function showError(error: unknown, fallback: string) {
  actionState.value = "error";
  actionMessage.value = error instanceof Error ? error.message : fallback;
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function requiredQuantity(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error("采购数量必须大于 0，最多 2 位小数");
  }
  return normalized;
}

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function selectedUploadFiles(files: UploadFile[]) {
  return files.flatMap((file) => (file.raw instanceof File ? [file.raw] : []));
}

watch(procurementId, () => void loadDetail());
onMounted(() => void loadDetail());
</script>

<template>
  <section class="spot-procurement-detail">
    <BusinessFeedback
      v-if="loading && !detail"
      state="loading"
      title="正在读取零星采购详情"
      description="正在核对采购申请、审批、付款、收货与附件事实。"
    />
    <BusinessFeedback
      v-else-if="loadError"
      state="permission"
      title="零星采购详情暂不可用"
      :description="loadError"
      action-label="重新加载"
      @action="loadDetail"
    />

    <template v-if="detail">
      <BusinessDetailHeader
        :business-code="detail.procurement.code"
        :title="detail.procurement.project.name"
        :status="detail.procurement.statusLabel"
        :status-tone="statusTone(detail.procurement.status)"
        :owner="detail.currentVersion.purchaserName ?? detail.procurement.handler.name"
        :current-node="detail.approval.currentNodeName"
        :next-step="primaryAction?.label ?? '等待既定条件满足'"
        :requested-amount="paymentSummaryLabel(detail)"
        amount-label="关联付款"
        :primary-action-label="primaryAction?.label ?? ''"
        :primary-action-disabled="actionBusy"
        @primary-action="runPrimaryAction"
      >
        <template #actions>
          <t-button
            variant="outline"
            :loading="loading"
            @click="loadDetail"
          >
            刷新
          </t-button>
        </template>
      </BusinessDetailHeader>

      <BusinessFeedback
        v-if="actionMessage"
        :state="actionState"
        :title="actionState === 'success' ? '操作已完成' : '操作未完成'"
        :description="actionMessage"
      />

      <t-tabs v-model="activeTab">
        <t-tab-panel
          value="overview"
          label="采购申请"
        />
        <t-tab-panel
          value="materials"
          label="材料与附件"
        />
        <t-tab-panel
          value="process"
          label="审批与动作"
        />
        <t-tab-panel
          value="payments"
          label="关联付款"
        />
        <t-tab-panel
          value="receipt"
          label="收货与发票"
        />
      </t-tabs>

      <section
        v-if="activeTab === 'overview'"
        class="detail-panel"
      >
        <header><h2>零星/小额材料采购申请表</h2><p>该表沿用公司现有 A4 竖向申请表：采购阶段不记录价格、商户、税率或发票。</p></header>
        <dl class="detail-grid">
          <div><dt>项目名称</dt><dd>{{ detail.procurement.project.code }} · {{ detail.procurement.project.name }}</dd></div>
          <div><dt>系统申请单编号</dt><dd>{{ detail.procurement.code }}</dd></div>
          <div><dt>申请部门</dt><dd>{{ detail.currentVersion.applicationDepartment ?? "—" }}</dd></div>
          <div><dt>申请人</dt><dd>{{ detail.currentVersion.applicationName ?? detail.procurement.applicant.name }}</dd></div>
          <div><dt>采购人</dt><dd>{{ detail.currentVersion.purchaserName ?? detail.procurement.handler.name }}</dd></div>
          <div><dt>采购部门</dt><dd>{{ detail.currentVersion.purchaserDepartment ?? "—" }}</dd></div>
          <div><dt>要求采购到位日期</dt><dd>{{ dateOnly(detail.currentVersion.requestedArrivalAt) }}</dd></div>
          <div><dt>更新时间</dt><dd>{{ dateTime(detail.procurement.updatedAt) }}</dd></div>
          <div class="detail-grid__wide">
            <dt>物资用途及采购原因</dt><dd>{{ detail.currentVersion.reason }}</dd>
          </div>
          <div
            v-if="detail.currentVersion.note"
            class="detail-grid__wide"
          >
            <dt>备注</dt><dd>{{ detail.currentVersion.note }}</dd>
          </div>
        </dl>
        <t-alert
          theme="info"
          title="价格在付款申请中确定"
          message="采购审批只确认材料范围、数量、统一到位日期和采购原因。最终商户、我方付款主体、收款对象、含税单价、税率、付款方式和发票资料在项目零星付款申请单中补充。"
        />
        <section class="version-list">
          <h3>版本记录</h3>
          <t-table
            row-key="id"
            size="small"
            :columns="[
              { colKey: 'versionNo', title: '版本' },
              { colKey: 'statusLabel', title: '状态' },
              { colKey: 'applicationName', title: '申请人' },
              { colKey: 'requestedArrivalAt', title: '要求到位日期' },
              { colKey: 'reason', title: '采购原因' },
              { colKey: 'updatedAt', title: '更新时间' }
            ]"
            :data="detail.versions.map((version) => ({
              ...version,
              versionNo: `V${version.versionNo}`,
              applicationName: version.applicationName ?? detail!.procurement.applicant.name,
              requestedArrivalAt: dateOnly(version.requestedArrivalAt),
              updatedAt: dateTime(version.updatedAt)
            }))"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'materials'"
        class="detail-panel"
      >
        <header><h2>材料明细</h2><p>采购申请只保存材料名称、型号、单位、数量和备注；不显示价格、税率或发票条件。</p></header>
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="materialColumns"
          :data="detail.lines"
          :scroll="{ x: 800 }"
        >
          <template #specification="{ row }">
            {{ row.specification ?? "—" }}
          </template>
          <template #note="{ row }">
            {{ row.note ?? "—" }}
          </template>
        </t-table>
        <section><h3>申请附件</h3><EvidenceFileCards :files="detail.attachments" /></section>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="detail-panel"
      >
        <header><h2>审批与动作</h2><p>所有可办理性均按冻结审批流程和真实参与关系确定。</p></header>
        <BusinessActionPanel :actions="detail.availableActions" />
        <div class="action-buttons">
          <t-button
            v-if="actionEnabled('edit_draft')"
            variant="outline"
            @click="openEdit()"
          >
            {{ actionLabel("edit_draft") }}
          </t-button>
          <t-button
            v-if="actionEnabled('submit_approval')"
            theme="primary"
            :loading="actionBusy"
            @click="runSubmit"
          >
            {{ actionLabel("submit_approval") }}
          </t-button>
          <template v-if="actionEnabled('review_approval')">
            <t-button
              theme="primary"
              @click="openConfirmation('review_approve')"
            >
              审批通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              @click="openConfirmation('review_reject')"
            >
              驳回
            </t-button>
            <t-button
              variant="outline"
              @click="openConfirmation('review_return')"
            >
              退回申请人
            </t-button>
          </template>
          <t-button
            v-if="actionEnabled('withdraw_approval')"
            variant="outline"
            @click="openConfirmation('withdraw')"
          >
            {{ actionLabel("withdraw_approval") }}
          </t-button>
          <t-button
            v-if="actionEnabled('create_version')"
            variant="outline"
            @click="openEdit('version')"
          >
            {{ actionLabel("create_version") }}
          </t-button>
          <t-button
            v-if="actionEnabled('download_application_pdf')"
            variant="outline"
            @click="openConfirmation('download')"
          >
            {{ actionLabel("download_application_pdf") }}
          </t-button>
          <t-button
            v-if="actionEnabled('void_procurement')"
            theme="danger"
            variant="outline"
            @click="openConfirmation('void')"
          >
            {{ actionLabel("void_procurement") }}
          </t-button>
        </div>
        <section><h3>采购审批历程</h3><ApprovalTimeline :items="detail.approvalTimeline" /></section>
      </section>

      <section
        v-else-if="activeTab === 'payments'"
        class="detail-panel"
      >
        <header><h2>关联付款</h2><p>采购审批完成后系统生成一个付款草稿；实际商户、付款主体、收款对象、价格和税票条件在付款申请中登记。</p></header>
        <t-alert
          theme="info"
          title="付款事实"
          :message="paymentSummaryLabel(detail)"
        />
        <t-button
          v-if="linkedPayment"
          theme="primary"
          @click="openLinkedPayment"
        >
          {{ linkedPaymentActionLabel }}
        </t-button>
        <t-empty
          v-if="!linkedPayment"
          description="采购审批完成后将自动生成付款草稿"
        />
        <t-table
          v-if="detail.payments.length"
          row-key="id"
          size="small"
          :columns="[
            { colKey: 'code', title: '付款申请编号' },
            { colKey: 'statusLabel', title: '状态' },
            { colKey: 'handler', title: '经办人' },
            { colKey: 'updatedAt', title: '更新时间' },
            { colKey: 'operation', title: '操作', fixed: 'right', width: 90 }
          ]"
          :data="detail.payments.map((payment) => ({ ...payment, handler: payment.handler.name, updatedAt: dateTime(payment.updatedAt) }))"
        >
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="router.push(paymentDetailUrl(row.id))"
            >
              查看
            </t-link>
          </template>
        </t-table>
      </section>

      <section
        v-else
        class="detail-panel"
      >
        <header><h2>收货、少货与发票</h2><p>存在实际付款后开放收货；收货照片为必传，送货单可选。少货且已付款仅允许补货或由财务登记退款。</p></header>
        <t-alert
          theme="info"
          title="当前收货状态"
          :message="receiptSummaryLabel(detail)"
        />
        <t-button
          theme="primary"
          @click="router.push(`/零星采购收货/${detail.procurement.id}`)"
        >
          进入收货确认
        </t-button>
        <t-alert
          theme="info"
          title="发票资料"
          :message="detail.invoice?.statusLabel ?? '发票可在付款后追加，关联整张付款申请；暂不做结构化发票系统。'"
        />
        <t-alert
          v-if="detail.procurement.status === 'closed'"
          theme="success"
          title="采购已办结"
          message="采购正式办结后不允许常规更正；发票资料可按规则继续追加归档。"
        />
      </section>
    </template>

    <t-dialog
      v-model:visible="editVisible"
      :header="editMode === 'version' ? '创建采购修订版本' : '编辑零星材料采购草稿'"
      width="min(1180px, 94vw)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: editMode === 'version' ? '创建修订版本' : '保存草稿', loading: actionBusy }"
      @confirm="saveDraft"
    >
      <div class="edit-form">
        <t-alert
          theme="info"
          title="只编辑采购申请事实"
          message="本表不维护供应商、价格、税率、付款方式或发票。采购人由当前登录物资员在系统中冻结。"
        />
        <label v-if="editMode === 'version'"><span>版本变更原因</span><t-textarea
          v-model="editForm.changeReason"
          :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="说明为什么需要修订本次采购"
        /></label>
        <div class="edit-form__grid">
          <label><span>申请部门</span><t-input v-model="editForm.applicationDepartment" /></label>
          <label><span>申请人</span><t-input v-model="editForm.applicationName" /></label>
          <label><span>要求采购到位日期</span><t-date-picker
            v-model="editForm.requestedArrivalAt"
            value-type="YYYY-MM-DD"
          /></label>
        </div>
        <label><span>物资用途及采购原因</span><t-textarea
          v-model="editForm.reason"
          :autosize="{ minRows: 2, maxRows: 5 }"
        /></label>
        <label><span>备注（可选）</span><t-textarea
          v-model="editForm.note"
          :autosize="{ minRows: 2, maxRows: 4 }"
        /></label>
        <label>
          <span>已有附件</span>
          <small>取消勾选会从本次保存结果中移除该附件；已失效附件不会带入草稿或修订版本。</small>
          <t-checkbox-group
            v-if="detail?.attachments.length"
            v-model="retainedAttachmentFileIds"
            class="existing-attachment-options"
          >
            <t-checkbox
              v-for="file in detail.attachments"
              :key="file.fileId"
              :value="file.fileId"
              :disabled="file.status !== 'active'"
            >{{ file.fileName }} · {{ file.statusLabel }}</t-checkbox>
          </t-checkbox-group>
          <small v-else>暂无已有附件</small>
        </label>
        <label>
          <span>补充报价单、材料清单或说明附件（可选）</span>
          <small>可补充 {{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText }}，{{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText }}。</small>
          <t-upload
            v-model="editQuotationFiles"
            theme="file-flow"
            multiple
            :auto-upload="false"
            :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
            :size-limit="quotationSizeLimit"
            :disabled="actionBusy"
          />
        </label>
        <label>
          <span>补充现场参考照片（可选）</span>
          <small>{{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.acceptText }}，{{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.limitText }}；仅作申请参考，不替代后续收货照片。</small>
          <t-upload
            v-model="editReferencePhotoFiles"
            theme="image-flow"
            multiple
            :auto-upload="false"
            :accept="SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.acceptAttribute"
            :size-limit="quotationSizeLimit"
            :disabled="actionBusy"
          />
        </label>
        <ProcurementLineEditor v-model="editForm.lines" />
        <t-alert
          v-if="editError"
          theme="error"
          title="暂时无法保存"
          :message="editError"
        />
      </div>
    </t-dialog>

    <SensitiveActionDialog
      v-model="confirmation.visible"
      :title="confirmation.title"
      :description="confirmation.description"
      :confirm-text="confirmation.confirmText"
      :confirm-theme="confirmation.confirmTheme"
      :require-reason="confirmation.requireReason"
      :require-password="confirmation.requirePassword"
      :reason-label="confirmation.reasonLabel"
      :loading="actionBusy"
      @confirm="confirmAction"
    />
  </section>
</template>

<style scoped>
.spot-procurement-detail,
.detail-panel,
.edit-form,
.detail-panel > section {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.detail-panel { padding-top: var(--jg-space-md); }

.detail-panel > header h2,
.detail-panel > header p,
.detail-panel h3 { margin: 0; }

.detail-panel > header h2,
.detail-panel h3 { color: var(--jg-color-text-primary); font-size: var(--jg-font-size-section-title); }

.detail-panel > header p,
.edit-form label > span,
.edit-form label > small,
.detail-grid dt { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }

.detail-panel > header p { margin-top: var(--jg-space-xs); }

.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--jg-space-md); margin: 0; }
.detail-grid > div { display: grid; gap: var(--jg-space-xs); padding: var(--jg-space-md); border: var(--jg-border-width-base) solid var(--jg-color-border); border-radius: var(--jg-radius-panel); background: var(--jg-color-bg-surface); }
.detail-grid__wide { grid-column: 1 / -1; }
.detail-grid dd { margin: 0; color: var(--jg-color-text-primary); white-space: pre-wrap; }

.action-buttons { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
.edit-form label { display: grid; gap: var(--jg-space-xs); }
.edit-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-md); }
.edit-form__grid label:last-child { grid-column: 1 / -1; }
.existing-attachment-options { display: grid; gap: var(--jg-space-xs); }

@media (max-width: 720px) {
  .edit-form__grid { grid-template-columns: 1fr; }
  .edit-form__grid label:last-child { grid-column: auto; }
}
</style>
