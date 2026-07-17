<script setup lang="ts">
import type { BusinessSummaryTone } from "../../components/business-status-summary.config";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createSpotProcurementPaymentDraft,
  createSpotProcurementVersion,
  fetchSpotProcurementDetail,
  fetchVatRateOptions,
  reviewSpotProcurement,
  submitSpotProcurement,
  updateSpotProcurementDraft,
  voidSpotProcurement,
  withdrawSpotProcurement,
  type SpotProcurementDetailReadModel,
  type VatRateOptionReadModel
} from "../../api/spot-procurement.api";
import {
  downloadApprovalForm,
  uploadPrivateFile
} from "../../api/core-flow-read.api";
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
import {
  calculateSpotProcurementLineAmountCents,
  centsTextToYuanText
} from "../../lib/money";
import ProcurementLineEditor, {
  type ProcurementLineDraft
} from "./components/ProcurementLineEditor.vue";
import PaymentCompositionCard from "./components/PaymentCompositionCard.vue";
import InvoiceCoveragePanel from "./components/InvoiceCoveragePanel.vue";
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
const vatRateOptions = ref<VatRateOptionReadModel[]>([]);
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
  supplierName: "",
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
  typeof route.params.procurementId === "string"
    ? route.params.procurementId
    : ""
);
const primaryAction = computed(() =>
  detail.value?.availableActions.find(
    (action) => action.key === detail.value?.primaryAction
  )
);
const materialColumns = [
  { colKey: "materialName", title: "材料名称", width: 130 },
  { colKey: "specification", title: "规格型号", width: 120 },
  { colKey: "unit", title: "单位", width: 70 },
  { colKey: "quantity", title: "数量", width: 100 },
  { colKey: "invoiceMode", title: "票据方式", width: 90 },
  { colKey: "invoiceType", title: "发票类型", width: 120 },
  { colKey: "vatRateLabel", title: "税率", width: 80 },
  { colKey: "unitPrice", title: "含税/无票单价", width: 120 },
  { colKey: "amountCents", title: "明细金额", width: 120 },
  { colKey: "usageLocation", title: "使用部位", width: 120 },
  { colKey: "note", title: "备注", width: 120 }
];

const editTotalAmountCents = computed(() => {
  try {
    return editForm.lines
      .reduce(
        (total, line) =>
          total +
          BigInt(
            calculateSpotProcurementLineAmountCents(
              line.quantity,
              line.unitPrice
            )
          ),
        0n
      )
      .toString();
  } catch {
    return null;
  }
});

function statusTone(status: string): BusinessSummaryTone {
  if (status === "closed") return "success";
  if (status === "voided") return "danger";
  if (status === "approval_pending") return "warning";
  if (status === "approved_in_progress") return "primary";
  return "default";
}

function money(cents: string | null | undefined) {
  return cents === null || cents === undefined
    ? "—"
    : `¥${centsTextToYuanText(cents)}`;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function invoiceModeLabel(value: string) {
  return value === "invoice" ? "有发票" : "无发票";
}

function invoiceTypeLabel(value: string | null) {
  if (value === "vat_general") return "增值税普通发票";
  if (value === "vat_special") return "增值税专用发票";
  return "—";
}

function actionEnabled(key: string) {
  return Boolean(
    detail.value?.availableActions.find(
      (action) => action.key === key && action.enabled
    )
  );
}

function actionLabel(key: string) {
  return (
    detail.value?.availableActions.find((action) => action.key === key)
      ?.label ?? ""
  );
}

async function loadDetail() {
  if (!procurementId.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    detail.value = await fetchSpotProcurementDetail(procurementId.value);
  } catch (error) {
    detail.value = null;
    loadError.value =
      error instanceof Error ? error.message : "零星采购详情读取失败";
  } finally {
    loading.value = false;
  }
}

async function loadVatRates() {
  try {
    vatRateOptions.value = await fetchVatRateOptions();
  } catch {
    vatRateOptions.value = [];
  }
}

function openEdit(mode: "draft" | "version" = "draft") {
  const current = detail.value;
  const actionKey =
    mode === "version" ? "create_version" : "edit_draft";
  if (!current || !actionEnabled(actionKey)) return;
  editMode.value = mode;
  editForm.supplierName = current.currentVersion.supplierName;
  editForm.reason = current.currentVersion.reason;
  editForm.note = current.currentVersion.note ?? "";
  editForm.changeReason = "";
  editForm.lines = current.lines.map((line) => ({
    materialName: line.materialName,
    specification: line.specification ?? "",
    unit: line.unit,
    quantity: line.quantity,
    invoiceMode: line.invoiceMode,
    invoiceType: line.invoiceType,
    vatRateOptionId: line.vatRateOptionId,
    unitPrice: line.unitPrice,
    usageLocation: line.usageLocation ?? "",
    note: line.note ?? ""
  }));
  editQuotationFiles.value = [];
  editReferencePhotoFiles.value = [];
  retainedAttachmentFileIds.value =
    activeSpotProcurementAttachmentIds(current.attachments);
  editError.value = "";
  editVisible.value = true;
}

async function saveDraft() {
  const current = detail.value;
  if (!current) return;
  editError.value = "";
  actionBusy.value = true;
  try {
    const supplierName = requiredText(editForm.supplierName, "供应商");
    const reason = requiredText(editForm.reason, "采购原因");
    if (!editForm.lines.length) throw new Error("请至少填写一条材料明细");
    const totalAmountCents = editTotalAmountCents.value;
    if (totalAmountCents === null) {
      throw new Error("请检查材料数量和单价，最多保留 6 位小数");
    }
    const attachments = retainedSpotProcurementAttachments(
      current.attachments,
      retainedAttachmentFileIds.value
    );
    for (const file of selectedUploadFiles(editQuotationFiles.value)) {
      const validationError =
        spotProcurementQuotationFileError(file);
      if (validationError) throw new Error(validationError);
      const uploaded = await uploadPrivateFile(file, file.name);
      attachments.push({
        fileId: uploaded.id,
        category: "merchant_quote"
      });
    }
    for (const file of selectedUploadFiles(editReferencePhotoFiles.value)) {
      const validationError =
        spotProcurementReferencePhotoFileError(file);
      if (validationError) throw new Error(validationError);
      const uploaded = await uploadPrivateFile(file, file.name);
      attachments.push({
        fileId: uploaded.id,
        category: "reference_photo"
      });
    }
    const draft = {
      supplierPartyId:
        supplierName === current.currentVersion.supplierName
          ? current.currentVersion.supplierPartyId
          : null,
      supplierName,
      handlerUserId: current.currentVersion.handlerUserId,
      reason,
      note: optionalText(editForm.note),
      lines: editForm.lines.map((line) => ({
        materialName: requiredText(line.materialName, "材料名称"),
        specification: optionalText(line.specification) ?? undefined,
        unit: requiredText(line.unit, "材料单位"),
        quantity: requiredText(line.quantity, "采购数量"),
        invoiceMode: line.invoiceMode,
        ...(line.invoiceMode === "invoice"
          ? {
              invoiceType: line.invoiceType ?? undefined,
              vatRateOptionId: line.vatRateOptionId ?? undefined
            }
          : {}),
        unitPrice: requiredText(line.unitPrice, "材料单价"),
        usageLocation: optionalText(line.usageLocation) ?? undefined,
        note: optionalText(line.note) ?? undefined,
        amountCents: calculateSpotProcurementLineAmountCents(
          line.quantity,
          line.unitPrice
        )
      })),
      attachments,
      totalAmountCents
    };
    if (editMode.value === "version") {
      await createSpotProcurementVersion(current.procurement.id, {
        ...draft,
        changeReason: requiredText(
          editForm.changeReason,
          "版本变更原因"
        )
      });
    } else {
      await updateSpotProcurementDraft(current.procurement.id, draft);
    }
    editVisible.value = false;
    showSuccess(
      editMode.value === "version"
        ? "采购修订版本已创建，金额已按系统重算结果刷新。"
        : "采购草稿已保存，金额已按系统重算结果刷新。"
    );
    await loadDetail();
  } catch (error) {
    editError.value =
      error instanceof Error ? error.message : "采购草稿保存失败";
  } finally {
    actionBusy.value = false;
  }
}

async function runSimpleAction(action: "submit" | "create_payment") {
  const current = detail.value;
  if (!current) return;
  actionBusy.value = true;
  try {
    if (action === "submit") {
      await submitSpotProcurement(current.procurement.id);
      showSuccess("采购申请已提交审批。");
    } else {
      const payment = await createSpotProcurementPaymentDraft(
        current.procurement.id
      );
      showSuccess("零星材料付款草稿已创建。");
      await router.push(`/零星材料付款/${payment.id}`);
      return;
    }
    await loadDetail();
  } catch (error) {
    showError(error, "操作失败");
  } finally {
    actionBusy.value = false;
  }
}

function openConfirmation(kind: ActionKind) {
  const configurations: Record<
    ActionKind,
    Omit<typeof confirmation, "visible" | "kind">
  > = {
    review_approve: {
      title: "确认通过采购审批",
      description: "通过后审批流进入下一节点或完成，并据实生成审批单。",
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
      description:
        "退回后保留本次审批事实，并从冻结版本复制一份新的可修改草稿。",
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
      description: "正式办结后不能更正；当前撤销将保留完整审计历史。",
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
  Object.assign(confirmation, configurations[kind], {
    visible: true,
    kind
  });
}

async function confirmAction(values: { reason: string; password: string }) {
  const current = detail.value;
  if (!current) return;
  actionBusy.value = true;
  try {
    if (confirmation.kind === "review_approve") {
      await reviewSpotProcurement(current.procurement.id, {
        decision: "approve"
      });
      showSuccess("采购审批已通过。");
    } else if (confirmation.kind === "review_reject") {
      await reviewSpotProcurement(current.procurement.id, {
        decision: "reject",
        comment: values.reason
      });
      showSuccess("采购申请已驳回。");
    } else if (confirmation.kind === "review_return") {
      await reviewSpotProcurement(current.procurement.id, {
        decision: "return_to_applicant",
        comment: values.reason
      });
      showSuccess("采购申请已退回，并已生成新的修改草稿。");
    } else if (confirmation.kind === "withdraw") {
      await withdrawSpotProcurement(current.procurement.id);
      showSuccess("采购审批已撤回。");
    } else if (confirmation.kind === "void") {
      await voidSpotProcurement(current.procurement.id, {
        reason: values.reason
      });
      showSuccess("零星采购已撤销。");
    } else {
      await downloadApprovalForm(
        current.applicationPdf.businessType,
        current.applicationPdf.businessId,
        {
          confirmationPassword: values.password,
          downloadReason: values.reason
        }
      );
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
  if (key === "submit_approval") void runSimpleAction("submit");
  else if (key === "review_approval") openConfirmation("review_approve");
  else if (key === "create_payment") void runSimpleAction("create_payment");
  else if (key === "create_version") openEdit("version");
}

function showSuccess(message: string) {
  actionState.value = "success";
  actionMessage.value = message;
}

function showError(error: unknown, fallback: string) {
  actionState.value = "error";
  actionMessage.value =
    error instanceof Error ? error.message : fallback;
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function selectedUploadFiles(files: UploadFile[]) {
  return files.flatMap((file) =>
    file.raw instanceof File ? [file.raw] : []
  );
}

watch(procurementId, () => void loadDetail());
onMounted(() => {
  void Promise.all([loadDetail(), loadVatRates()]);
});
</script>

<template>
  <section class="spot-procurement-detail">
    <BusinessFeedback
      v-if="loading && !detail"
      state="loading"
      title="正在读取零星采购详情"
      description="正在核对当前版本、审批、付款和附件事实。"
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
        :title="`${detail.procurement.project.name} · ${detail.procurement.supplierName}`"
        :status="detail.procurement.statusLabel"
        :status-tone="statusTone(detail.procurement.status)"
        :owner="detail.procurement.handler.name"
        :current-node="detail.approval.currentNodeName"
        :next-step="primaryAction?.label ?? '等待既定条件满足'"
        :requested-amount="money(detail.currentVersion.totalAmountCents)"
        amount-label="采购金额合计"
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
          label="采购摘要"
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
          label="收货与票据"
        />
      </t-tabs>

      <section
        v-if="activeTab === 'overview'"
        class="detail-panel"
      >
        <header>
          <h2>采购摘要</h2>
          <p>采购金额为当前有效版本的系统重算结果。</p>
        </header>
        <dl class="detail-grid">
          <div><dt>项目</dt><dd>{{ detail.procurement.project.code }} · {{ detail.procurement.project.name }}</dd></div>
          <div><dt>供应商</dt><dd>{{ detail.procurement.supplierName }}</dd></div>
          <div><dt>采购原因</dt><dd>{{ detail.currentVersion.reason }}</dd></div>
          <div><dt>采购申请人</dt><dd>{{ detail.procurement.applicant.name }}</dd></div>
          <div><dt>采购经办人</dt><dd>{{ detail.procurement.handler.name }}</dd></div>
          <div><dt>采购金额合计</dt><dd>{{ money(detail.currentVersion.totalAmountCents) }}</dd></div>
          <div><dt>票据构成</dt><dd>{{ detail.invoiceComposition === "mixed" ? "有票与无票混合" : detail.invoiceComposition === "invoice" ? "有发票" : detail.invoiceComposition === "no_invoice" ? "无发票" : "—" }}</dd></div>
          <div><dt>更新时间</dt><dd>{{ dateTime(detail.procurement.updatedAt) }}</dd></div>
        </dl>
        <t-alert
          theme="info"
          title="实际成本尚不可用"
          :message="detail.procurement.actualCost.label"
        />
        <section class="version-list">
          <h3>版本记录</h3>
          <t-table
            row-key="id"
            size="small"
            :columns="[
              { colKey: 'versionNo', title: '版本' },
              { colKey: 'statusLabel', title: '状态' },
              { colKey: 'reason', title: '采购原因' },
              { colKey: 'totalAmountCents', title: '金额' },
              { colKey: 'updatedAt', title: '更新时间' }
            ]"
            :data="detail.versions.map((version) => ({
              ...version,
              versionNo: `V${version.versionNo}`,
              totalAmountCents: money(version.totalAmountCents),
              updatedAt: dateTime(version.updatedAt)
            }))"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'materials'"
        class="detail-panel"
      >
        <header>
          <h2>材料明细</h2>
          <p>直接展示票据方式、发票类型、税率和系统重算的明细金额。</p>
        </header>
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="materialColumns"
          :data="detail.lines"
          :scroll="{ x: 1260 }"
        >
          <template #invoiceMode="{ row }">
            {{ invoiceModeLabel(row.invoiceMode) }}
          </template>
          <template #invoiceType="{ row }">
            {{ invoiceTypeLabel(row.invoiceType) }}
          </template>
          <template #vatRateLabel="{ row }">
            {{ row.vatRateLabel ?? "—" }}
          </template>
          <template #unitPrice="{ row }">
            ¥{{ row.unitPrice }}
          </template>
          <template #amountCents="{ row }">
            {{ money(row.amountCents) }}
          </template>
          <template #usageLocation="{ row }">
            {{ row.usageLocation ?? "—" }}
          </template>
          <template #note="{ row }">
            {{ row.note ?? "—" }}
          </template>
        </t-table>
        <section>
          <h3>申请附件</h3>
          <EvidenceFileCards :files="detail.attachments" />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="detail-panel"
      >
        <header>
          <h2>审批与动作</h2>
          <p>所有可办理性均按冻结审批流程和真实参与关系确定。</p>
        </header>
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
            @click="runSimpleAction('submit')"
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
            v-if="actionEnabled('create_payment')"
            theme="primary"
            @click="runSimpleAction('create_payment')"
          >
            {{ actionLabel("create_payment") }}
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
        <section>
          <h3>采购审批历程</h3>
          <ApprovalTimeline :items="detail.approvalTimeline" />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'payments'"
        class="detail-panel"
      >
        <header>
          <h2>关联付款</h2>
          <p>供应商余额抵扣和公司实际付款始终分开呈现。</p>
        </header>
        <PaymentCompositionCard
          :settlement-amount-cents="detail.paymentSummary.activeSettlementAmountCents"
          :supplier-balance-amount-cents="detail.paymentSummary.supplierBalanceAmountCents"
          :company-payment-amount-cents="detail.paymentSummary.companyPaymentAmountCents"
          :paid-amount-cents="detail.paymentSummary.paidAmountCents"
          :company-payment-status-label="detail.paymentSummary.statusLabel"
        />
        <t-table
          v-if="detail.payments.length"
          row-key="id"
          size="small"
          :columns="[
            { colKey: 'code', title: '付款申请编号' },
            { colKey: 'settlementAmountCents', title: '结算申请金额' },
            { colKey: 'supplierBalanceAmountCents', title: '余额抵扣' },
            { colKey: 'paidAmountCents', title: '公司实际付款' },
            { colKey: 'statusLabel', title: '状态' },
            { colKey: 'operation', title: '操作', fixed: 'right', width: 90 }
          ]"
          :data="detail.payments.map((payment) => ({
            ...payment,
            settlementAmountCents: money(payment.settlementAmountCents),
            supplierBalanceAmountCents: money(payment.supplierBalanceAmountCents),
            paidAmountCents: money(payment.paidAmountCents)
          }))"
        >
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="router.push(`/零星材料付款/${row.id}`)"
            >
              查看
            </t-link>
          </template>
        </t-table>
        <t-empty
          v-else
          description="尚无当前账号可查看的关联付款申请"
        />
      </section>

      <section
        v-else
        class="detail-panel"
      >
        <header>
          <h2>收货、差异与票据</h2>
          <p>最终收货、差异结算和票据覆盖分别保存，不把余额抵扣合并成公司实付。</p>
        </header>
        <t-button
          theme="primary"
          @click="router.push(`/零星采购收货/${detail.procurement.id}`)"
        >
          进入收货详情
        </t-button>
        <InvoiceCoveragePanel
          :coverage="detail.invoiceCoverage"
          :ledger="detail.invoiceLedger"
        />
        <t-alert
          v-if="detail.procurement.status === 'closed'"
          theme="success"
          title="采购已办结"
          message="全部条件已满足，采购、收货、差异、余额和票据结果均不可更正。"
        />
      </section>
    </template>

    <t-dialog
      v-model:visible="editVisible"
      :header="editMode === 'version' ? '创建采购修订版本' : '编辑零星采购草稿'"
      width="min(1180px, 94vw)"
      :close-on-overlay-click="false"
      :confirm-btn="{
        content: editMode === 'version' ? '创建修订版本' : '保存草稿',
        loading: actionBusy
      }"
      @confirm="saveDraft"
    >
      <div class="edit-form">
        <label v-if="editMode === 'version'">
          <span>版本变更原因</span>
          <t-textarea
            v-model="editForm.changeReason"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="说明为什么需要修订本次采购"
          />
        </label>
        <label>
          <span>供应商</span>
          <t-input v-model="editForm.supplierName" />
          <small>修改供应商名称后，系统会解除原合作单位档案关联，避免余额和收款对象错配。</small>
        </label>
        <label>
          <span>采购原因</span>
          <t-textarea
            v-model="editForm.reason"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </label>
        <label>
          <span>采购备注</span>
          <t-textarea
            v-model="editForm.note"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </label>
        <label>
          <span>已有附件</span>
          <small>
            取消勾选会从本次保存结果中移除该附件；已失效附件不会带入草稿或修订版本。
          </small>
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
            >
              {{ file.fileName }} · {{ file.statusLabel }}
            </t-checkbox>
          </t-checkbox-group>
          <small v-else>暂无已有附件</small>
        </label>
        <label>
          <span>补充商家报价附件（可选）</span>
          <small>
            可补充
            {{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText }}，
            {{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText }}。
          </small>
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
          <small>
            {{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.acceptText }}，
            {{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.limitText }}；仅作申请参考，不替代后续收货照片。
          </small>
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
        <ProcurementLineEditor
          v-model="editForm.lines"
          :vat-rate-options="vatRateOptions"
        />
        <t-alert
          theme="info"
          title="预览合计"
          :message="editTotalAmountCents === null ? '请补全有效数量和单价' : money(editTotalAmountCents)"
        />
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
.edit-form {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.detail-panel {
  padding-top: var(--jg-space-md);
}

.detail-panel > header h2,
.detail-panel > header p,
.detail-panel h3 {
  margin: 0;
}

.detail-panel > header h2,
.detail-panel h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.detail-panel > header p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--jg-space-md);
  margin: 0;
}

.detail-grid > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.detail-grid dt,
.edit-form label > span,
.edit-form label > small {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.detail-grid dd {
  margin: 0;
  color: var(--jg-color-text-primary);
}

.version-list,
.detail-panel > section {
  display: grid;
  gap: var(--jg-space-md);
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.edit-form label {
  display: grid;
  gap: var(--jg-space-xs);
}

.existing-attachment-options {
  display: grid;
  gap: var(--jg-space-xs);
}
</style>
