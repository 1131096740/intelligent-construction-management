<template>
  <section class="project-operating-page jg-responsive-detail">
    <div class="page-head">
      <div>
        <span class="page-eyebrow">项目</span>
        <h1>项目经营</h1>
        <p>先看项目资金与业务全貌，再按权限进入具体办理事项</p>
      </div>
      <div class="project-tools">
        <div class="project-picker">
          <span>当前项目</span>
          <t-select
            v-model="selectedProjectId"
            :disabled="loadingProjects || projectSwitching || projects.length === 0"
            :options="projectSelectOptions"
            @change="handleProjectChange"
          />
        </div>
        <t-collapse
          v-if="canManageProjects"
          class="project-maintenance"
        >
          <t-collapse-panel
            value="project-maintenance"
            header="项目维护"
          >
            <div class="project-maintenance-forms">
              <form
                class="project-create-form"
                @submit.prevent="submitProject"
              >
                <label>
                  <span>项目编号</span>
                  <input
                    v-model.trim="projectForm.code"
                    required
                  >
                </label>
                <label>
                  <span>项目名称</span>
                  <input
                    v-model.trim="projectForm.name"
                    required
                  >
                </label>
                <button
                  type="submit"
                  :disabled="projectSubmitting"
                >
                  {{ projectSubmitting ? "新增中" : "新增项目" }}
                </button>
              </form>
              <form
                v-if="selectedProjectId"
                class="project-name-form"
                @submit.prevent="submitProjectName"
              >
                <label>
                  <span>当前项目名称</span>
                  <input
                    v-model.trim="selectedProjectName"
                    required
                  >
                </label>
                <button
                  type="submit"
                  :disabled="projectUpdating"
                >
                  {{ projectUpdating ? "保存中" : "保存名称" }}
                </button>
              </form>
            </div>
          </t-collapse-panel>
        </t-collapse>
      </div>
    </div>

    <div
      v-if="projectMessage"
      class="receipt-message"
      :class="projectMessageTone"
    >
      {{ projectMessage }}
    </div>

    <div
      v-if="message"
      class="message"
    >
      {{ message }}
    </div>
    <div
      v-else-if="loadingOverview"
      class="message"
    >
      正在加载项目经营数据
    </div>

    <t-tabs
      v-if="overview || canViewExecutiveOverview || financingQuotaWorkbench || financingQuotaError || ((canReadProjectExpenseLedger || canCreateProjectExpense) && selectedProjectId)"
      v-model="activeTab"
      class="project-operating-tabs"
      @change="handleOperatingTabChange"
    >
      <t-tab-panel
        value="overview"
        label="项目概览"
      >
        <section
          v-if="canViewExecutiveOverview"
          class="panel executive-panel"
        >
          <div class="panel-head">
            <div>
              <h2>跨项目经营总览</h2>
              <p>按当前可见项目汇总合同、结算、付款、实收和数据缺口</p>
            </div>
            <span
              v-if="loadingExecutiveOverview"
              class="executive-loading"
            >
              正在汇总
            </span>
          </div>
          <div
            v-if="executiveMessage"
            class="receipt-message danger"
          >
            {{ executiveMessage }}
          </div>
          <template v-else-if="executiveOverview">
            <div class="executive-summary-grid">
              <div
                v-for="item in executiveSummaryItems"
                :key="item.label"
                class="summary-item"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
            <div class="expense-table-wrap jg-workspace-scroll">
              <table class="executive-table">
                <thead>
                  <tr>
                    <th>项目</th>
                    <th>生效合同额</th>
                    <th>生效结算额</th>
                    <th>结算可付额</th>
                    <th>实际收款</th>
                    <th>供应商退款</th>
                    <th>已实付</th>
                    <th>已批待付</th>
                    <th>可用资金</th>
                    <th>数据缺口</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in executiveOverview.rows"
                    :key="row.id"
                  >
                    <td>{{ row.code }} · {{ row.name }}</td>
                    <td>{{ formatCents(row.contractAmountCents) }}</td>
                    <td>{{ formatCents(row.settlementAmountCents) }}</td>
                    <td>{{ formatCents(row.payableAmountCents) }}</td>
                    <td>{{ formatCents(row.actualReceiptsCents) }}</td>
                    <td>{{ formatCents(row.supplierRefundsCents) }}</td>
                    <td>{{ formatCents(row.actualPaidCents) }}</td>
                    <td>{{ formatCents(row.approvedPendingPaymentCents) }}</td>
                    <td>{{ formatCents(row.availableFundsCents) }}</td>
                    <td>{{ row.dataGapCount ? `${row.dataGapCount} 项` : "无" }}</td>
                    <td>
                      <button
                        type="button"
                        class="table-action"
                        :disabled="projectSwitching"
                        @click="selectExecutiveProject(row.id)"
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>

        <template v-if="overview">
          <div class="summary-strip">
            <div
              v-for="item in summaryItems"
              :key="item.label"
              class="summary-item"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>

          <section class="panel project-entry-panel">
            <div class="panel-head">
              <h2>项目业务入口</h2>
              <p>从当前项目进入合同、结算、付款、资料、审批和审计</p>
            </div>
            <div class="project-entry-grid">
              <button
                v-for="entry in projectBusinessEntries"
                :key="entry.label"
                type="button"
                class="project-entry"
                @click="go(entry.path)"
              >
                <span>
                  {{ entry.label }}
                  <strong v-if="entry.count !== undefined">{{ entry.count }}</strong>
                </span>
                <small>{{ entry.description }}</small>
              </button>
            </div>
          </section>

          <div class="overview-grid">
            <section class="panel">
              <h2>现金口径</h2>
              <dl>
                <div
                  v-for="item in cashItems"
                  :key="item.label"
                >
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>
            </section>

            <section class="panel">
              <h2>经营口径</h2>
              <dl>
                <div
                  v-for="item in businessItems"
                  :key="item.label"
                >
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section class="gap-panel overview-gap-panel">
            <h2>数据缺口</h2>
            <p v-if="overview.dataGaps.length === 0">
              当前项目暂未发现待补齐的数据。
            </p>
            <ul v-else>
              <li
                v-for="gap in overview.dataGaps"
                :key="gap"
              >
                {{ gap }}
              </li>
            </ul>
          </section>
        </template>
      </t-tab-panel>

      <t-tab-panel
        v-if="financingQuotaWorkbench || financingQuotaError || ((canReadProjectExpenseLedger || canCreateProjectExpense) && (overview || selectedProjectId))"
        value="operations"
        label="资金办理"
      >
        <template v-if="overview || selectedProjectId">
          <ProjectFinancingQuotaPanel
            v-if="financingQuotaWorkbench"
            :project-id="selectedProjectId"
            :workbench="financingQuotaWorkbench"
            @updated="handleFinancingQuotaUpdated"
          />
          <t-alert
            v-else-if="financingQuotaError"
            theme="error"
            title="项目垫资额度读取失败"
            class="financing-quota-error"
          >
            {{ financingQuotaError }}
          </t-alert>

          <section
            v-if="canRecordUpstreamFunds"
            class="panel receipt-panel"
          >
            <div class="panel-head">
              <div>
                <h2>上游资金事实</h2>
                <p>业主付款不进入我方现金；只有已确认的挂靠拨款增加可用资金。</p>
              </div>
              <button
                type="button"
                :disabled="receiptSubmitting"
                @click="submitReceipt"
              >
                {{ receiptSubmitting ? "提交中" : "保存待确认" }}
              </button>
            </div>
            <form
              class="receipt-form"
              @submit.prevent="submitReceipt"
            >
              <label>
                <span>事实类型</span>
                <select v-model="receiptForm.factType">
                  <option value="owner_payment_to_affiliate">业主向挂靠企业付款</option>
                  <option value="affiliate_remittance_to_company">挂靠企业向我方拨款</option>
                  <option value="affiliate_deduction">挂靠企业扣款</option>
                  <option value="unreconciled_receipt_difference">待核对到账差额</option>
                </select>
              </label>
              <label>
                <span>依据类型</span>
                <select v-model="receiptForm.basisType">
                  <option value="written">书面依据</option>
                  <option value="oral">口头通知</option>
                </select>
              </label>
              <label>
                <span>发生日期</span>
                <input
                  v-model="receiptForm.occurredAt"
                  type="date"
                  required
                >
              </label>
              <label>
                <span>金额(元)</span>
                <input
                  v-model.trim="receiptForm.amountYuan"
                  inputmode="decimal"
                  placeholder="0.00"
                  required
                >
              </label>
              <label>
                <span>交易对方</span>
                <input
                  v-model.trim="receiptForm.counterpartyName"
                  required
                >
              </label>
              <label v-if="receiptForm.factType === 'affiliate_deduction'">
                <span>扣款类型</span>
                <select v-model="receiptForm.deductionCategory">
                  <option value="management_fee">管理费</option>
                  <option value="tax">税费</option>
                  <option value="deposit">保证金</option>
                  <option value="insurance">保险费</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label>
                <span>{{ receiptForm.basisType === "written" ? "书面依据" : "补充文件（选填）" }}</span>
                <input
                  ref="receiptVoucherInput"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                  :required="receiptForm.basisType === 'written'"
                  @change="selectReceiptVoucher"
                >
              </label>
              <label class="receipt-description">
                <span>事实说明</span>
                <input v-model.trim="receiptForm.description">
              </label>
            </form>
            <div
              v-if="receiptMessage"
              class="receipt-message"
              :class="receiptMessageTone"
            >
              {{ receiptMessage }}
            </div>
            <div class="expense-table-wrap jg-workspace-scroll">
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>依据</th>
                    <th>日期</th>
                    <th>金额</th>
                    <th>我方现金影响</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="fact in upstreamFundRows"
                    :key="fact.id"
                  >
                    <td>{{ fact.factTypeLabel }}</td>
                    <td>{{ fact.basisType === "written" ? "书面依据" : "口头通知" }}</td>
                    <td>{{ formatDate(fact.occurredAt) }}</td>
                    <td>{{ formatCents(fact.signedAmountCents) }}</td>
                    <td>{{ formatCents(fact.cashEffectCents) }}</td>
                    <td>{{ upstreamFundStatusLabel(fact.status) }}</td>
                    <td>
                      <button
                        v-if="canConfirmUpstreamFundFact(fact)"
                        type="button"
                        class="table-action"
                        :disabled="upstreamFundConfirmationBusy"
                        @click="openUpstreamFundConfirmation(fact)"
                      >
                        {{ fact.basisType === "oral" ? "主管确认口头通知" : "确认书面事实" }}
                      </button>
                      <span v-else>—</span>
                    </td>
                  </tr>
                  <tr v-if="upstreamFundRows.length === 0">
                    <td colspan="7">
                      暂无上游资金事实
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel receipt-panel">
            <div class="panel-head">
              <h2>支出明细</h2>
              <div
                v-if="canCreateProjectExpense"
                class="panel-actions"
              >
                <t-button
                  v-if="expenseFormDirty"
                  variant="outline"
                  theme="danger"
                  :disabled="expenseSubmitting"
                  @click="discardExpenseFilling"
                >
                  放弃填写
                </t-button>
                <button
                  type="button"
                  :disabled="expenseSubmitting"
                  @click="submitProjectExpense"
                >
                  {{ expenseSubmitting ? "提交中" : "发起支出" }}
                </button>
              </div>
            </div>
            <div
              v-if="canReadProjectExpenseLedger"
              class="expense-ledger-switcher"
            >
              <t-radio-group
                v-model="expenseLedgerView"
                variant="default-filled"
                :disabled="expenseLedgerLoading"
                @change="changeExpenseLedgerView"
              >
                <t-radio-button value="formal_ledger">
                  正式台账（{{ projectExpenseViewCount("formal_ledger") }}）
                </t-radio-button>
                <t-radio-button value="ended">
                  已结束（{{ projectExpenseViewCount("ended") }}）
                </t-radio-button>
              </t-radio-group>
              <span>项目支出提交即进入审批，不会产生可删除的后端草稿。</span>
            </div>
            <div
              v-if="canReadProjectExpenseLedger"
              class="expense-summary"
            >
              <span
                v-for="item in projectExpenseSummaryItems"
                :key="item.label"
              >
                {{ item.label }}：<strong>{{ item.value }}</strong>
              </span>
            </div>
            <form
              v-if="canCreateProjectExpense"
              class="receipt-form"
              @submit.prevent="submitProjectExpense"
            >
              <label>
                <span>支出单号</span>
                <input
                  v-model.trim="expenseForm.code"
                  required
                >
              </label>
              <label>
                <span>一级类型</span>
                <select
                  v-model="expenseForm.expenseType"
                  @change="syncExpenseSubtype"
                >
                  <option
                    v-for="option in visibleExpenseTypeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>明细类型</span>
                <select v-model="expenseForm.expenseSubtype">
                  <option
                    v-for="option in currentExpenseSubtypeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>{{ expenseForm.expenseType === "spot_purchase" ? "采购事项" : "付款主体" }}</span>
                <input
                  v-model.trim="expenseForm.paymentSubject"
                  required
                >
              </label>
              <label>
                <span>{{ expenseForm.expenseType === "spot_purchase" ? "预算金额(元)" : "申请金额(元)" }}</span>
                <input
                  v-model.trim="expenseForm.amountYuan"
                  inputmode="decimal"
                  placeholder="0.00"
                  required
                >
              </label>
              <label>
                <span>付款方式</span>
                <select v-model="expenseForm.paymentMethod">
                  <option
                    v-for="option in expensePaymentMethodOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>{{ expenseForm.expenseType === "spot_purchase" ? "供应商" : "对方名称" }}</span>
                <input v-model.trim="expenseForm.counterpartyName">
              </label>
              <label>
                <span>对方户名</span>
                <input v-model.trim="expenseForm.counterpartyAccountName">
              </label>
              <label>
                <span>开户银行</span>
                <input v-model.trim="expenseForm.counterpartyBankName">
              </label>
              <label>
                <span>银行账号</span>
                <input v-model.trim="expenseForm.counterpartyBankAccount">
              </label>
              <label>
                <span>附件/发票</span>
                <input
                  ref="expenseAttachmentInput"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                  @change="selectExpenseAttachment"
                >
              </label>
              <label class="receipt-description">
                <span>{{ expenseForm.expenseType === "spot_purchase" ? "采购用途" : "付款事由" }}</span>
                <input
                  v-model.trim="expenseForm.reason"
                  required
                >
              </label>
            </form>
            <div
              v-if="expenseMessage"
              class="receipt-message"
              :class="expenseMessageTone"
            >
              {{ expenseMessage }}
            </div>
            <div
              v-if="canReadProjectExpenseLedger"
              class="expense-table-wrap jg-workspace-scroll"
            >
              <table>
                <thead>
                  <tr>
                    <th>支出单号</th>
                    <th>类型</th>
                    <th>付款主体</th>
                    <th>申请金额</th>
                    <th>已批金额</th>
                    <th>已实付</th>
                    <th>付款方式</th>
                    <th>状态</th>
                    <th>附件</th>
                    <th>审批单</th>
                    <th>采购执行</th>
                    <th>收货确认</th>
                    <th>提交时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody v-if="projectExpenseRows.length">
                  <tr
                    v-for="row in projectExpenseRows"
                    :key="row.id"
                  >
                    <td>{{ row.code }}</td>
                    <td>{{ expenseTypeLabel(row.expenseType) }} · {{ expenseSubtypeLabel(row.expenseSubtype) }}</td>
                    <td>{{ row.paymentSubject }}</td>
                    <td>{{ formatCents(row.requestedAmountCents) }}</td>
                    <td>{{ formatCents(row.approvedAmountCents) }}</td>
                    <td>{{ formatCents(row.paidAmountCents) }}</td>
                    <td>{{ expensePaymentMethodLabel(row.paymentMethod) }}</td>
                    <td>{{ expenseStatusLabel(row.status) }}</td>
                    <td>{{ row.hasAttachment ? "已上传" : "未上传" }}</td>
                    <td>{{ row.hasApprovalPdf ? "已生成" : "未生成" }}</td>
                    <td>{{ row.expenseType === "spot_purchase" ? (row.isPurchaseExecuted ? "已执行" : "待执行") : "-" }}</td>
                    <td>{{ row.expenseType === "spot_purchase" ? (row.isReceiptConfirmed ? "已确认" : "待确认") : "-" }}</td>
                    <td>{{ formatDateTime(row.createdAt) }}</td>
                    <td>
                      <button
                        type="button"
                        class="table-action"
                        @click="selectExpenseRow(row)"
                      >
                        处理
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tbody v-else>
                  <tr>
                    <td
                      class="empty-cell"
                      colspan="14"
                    >
                      暂无支出明细
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <t-pagination
              v-if="canReadProjectExpenseLedger && projectExpensePagination.total > projectExpensePagination.pageSize"
              :current="projectExpensePagination.page"
              :page-size="projectExpensePagination.pageSize"
              :total="projectExpensePagination.total"
              @current-change="changeExpenseLedgerPage"
            />

            <section
              v-if="canReadProjectExpenseLedger && selectedExpenseRow"
              class="expense-action-panel"
            >
              <div class="expense-action-head">
                <div>
                  <h3>处理支出单：{{ selectedExpenseRow.code }}</h3>
                  <p>
                    {{ expenseTypeLabel(selectedExpenseRow.expenseType) }} ·
                    {{ expenseSubtypeLabel(selectedExpenseRow.expenseSubtype) }} ·
                    {{ expenseStatusLabel(selectedExpenseRow.status) }}
                  </p>
                </div>
                <button
                  type="button"
                  class="secondary-button"
                  @click="clearSelectedExpenseRow"
                >
                  取消选择
                </button>
              </div>
              <div class="receipt-form">
                <label>
                  <span>附件下载密码</span>
                  <input
                    v-model="expenseActionForm.downloadPassword"
                    type="password"
                    autocomplete="current-password"
                  >
                </label>
                <label>
                  <span>采购执行日期</span>
                  <input
                    v-model="expenseActionForm.purchaseExecutedAt"
                    type="date"
                  >
                </label>
                <label>
                  <span>采购执行备注</span>
                  <input v-model.trim="expenseActionForm.purchaseExecutionNote">
                </label>
                <label>
                  <span>采购执行确认密码</span>
                  <input
                    v-model="expenseActionForm.purchaseExecutionPassword"
                    type="password"
                    autocomplete="current-password"
                  >
                </label>
              </div>
              <div class="expense-action-buttons">
                <button
                  v-if="['approval_pending', 'approved_pending_payment', 'partially_paid', 'paid', 'payment_blocked'].includes(selectedExpenseRow.status)"
                  type="button"
                  class="secondary-button"
                  @click="openExpenseApprovalDetail(selectedExpenseRow)"
                >
                  打开审批详情
                </button>
                <button
                  v-if="canRecordPurchaseExecution(selectedExpenseRow)"
                  type="button"
                  :disabled="expenseActionBusy !== ''"
                  @click="submitExpensePurchaseExecution"
                >
                  登记采购执行
                </button>
                <button
                  v-if="selectedExpenseRow.hasAttachment"
                  type="button"
                  class="secondary-button"
                  :disabled="expenseActionBusy !== ''"
                  @click="downloadExpenseAttachment"
                >
                  下载申请附件
                </button>
                <button
                  v-if="selectedExpenseRow.hasApprovalPdf"
                  type="button"
                  class="secondary-button"
                  :disabled="expenseActionBusy !== ''"
                  @click="downloadExpenseApprovalPdf"
                >
                  下载审批单
                </button>
              </div>
              <div
                v-if="expenseActionMessage"
                class="receipt-message"
                :class="expenseActionMessageTone"
              >
                {{ expenseActionMessage }}
              </div>
            </section>
          </section>
        </template>
      </t-tab-panel>

      <t-tab-panel
        v-if="selectedProjectId"
        value="affiliate-business"
        label="挂靠业务接管"
      >
        <AffiliateCompanyContractPanel :project-id="selectedProjectId" />
        <AffiliateBusinessLedgerPanel :project-id="selectedProjectId" />
      </t-tab-panel>
      <t-tab-panel
        v-if="selectedProjectId"
        value="settings"
        label="项目设置"
      >
        <ProjectOperatingProfilePanel :project-id="selectedProjectId" />
      </t-tab-panel>
    </t-tabs>

    <SensitiveActionDialog
      v-model="upstreamFundConfirmationVisible"
      title="确认上游资金事实"
      :description="upstreamFundConfirmationDescription"
      confirm-text="确认并冻结签名"
      :require-password="true"
      :loading="upstreamFundConfirmationBusy"
      :error="upstreamFundConfirmationError"
      @confirm="submitUpstreamFundConfirmation"
      @cancel="closeUpstreamFundConfirmation"
    />

    <SensitiveActionDialog
      v-model="expenseLeaveDialogVisible"
      title="放弃未提交的项目支出填写？"
      description="当前内容仅保存在本页。继续后会清空未提交的表单，不会创建、删除或修改任何后端业务记录。"
      confirm-text="确认放弃填写"
      confirm-theme="danger"
      @confirm="resolveExpenseLeave(true)"
      @cancel="resolveExpenseLeave(false)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  confirmProjectUpstreamFundFact,
  createProject,
  createProjectExpenseRequest,
  downloadProjectExpenseApprovalPdf,
  downloadProjectExpenseAttachment,
  fetchProjectCreateCapability,
  fetchProjectExpenseActionCapability,
  fetchProjectExpenseCreateCapability,
  fetchProjectExpenseRequests,
  fetchProjectOperatingOverview,
  fetchProjectUpstreamFundConfirmationCapability,
  fetchProjectUpstreamFundRecordCapability,
  fetchProjectUpdateCapability,
  fetchProjects,
  recordProjectExpensePurchaseExecution,
  recordProjectUpstreamFundFact,
  uploadProjectExpensePrivateFile,
  uploadProjectUpstreamFundPrivateFile,
  updateProject,
  type ProjectExpensePaymentMethod,
  type ProjectExpenseRequestListReadModel,
  type ProjectExpenseSubtype,
  type ProjectExpenseType,
  type ProjectOperatingOverviewReadModel,
  type ProjectUpstreamFundBasisType,
  type ProjectUpstreamFundFactReadModel,
  type ProjectUpstreamFundFactType,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import type { DraftLedgerView, RoleKey } from "@jiangkong/shared-domain";
import { fetchSpotProcurementCapabilities } from "../../api/spot-procurement.api";
import {
  createProjectOverviewRequestOwner,
  fetchProjectFinancingQuotaWorkbench,
  ProjectFinancingQuotaApiError,
  type ProjectFinancingQuotaWorkbenchReadModel
} from "../../api/project-financing-quota.api";
import { useAuthStore } from "../../auth/auth.store";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import AffiliateBusinessLedgerPanel from "./components/AffiliateBusinessLedgerPanel.vue";
import AffiliateCompanyContractPanel from "./components/AffiliateCompanyContractPanel.vue";
import ProjectFinancingQuotaPanel from "./components/ProjectFinancingQuotaPanel.vue";
import ProjectOperatingProfilePanel from "./components/ProjectOperatingProfilePanel.vue";
import {
  expensePaymentMethodLabel,
  expensePaymentMethodOptions,
  expenseSubtypeLabel,
  expenseTypeLabel,
  expenseTypeOptions,
  projectExpenseApprovalDetailPath,
  subtypeOptionsFor
} from "./project-expense.config";
import {
  buildExecutiveProjectOverview,
  buildProjectBusinessEntries,
  type ExecutiveProjectOverview
} from "./project-operating.config";
import { promptSensitiveActionReason } from "../confirm-sensitive-action";

type ProjectExpenseRow = ProjectExpenseRequestListReadModel["rows"][number];

const GLOBAL_PROJECT_OVERVIEW_ROLE_KEYS = new Set<RoleKey>([
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_staff",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director",
  "super_admin"
]);

interface ReceiptFormState {
  factType: ProjectUpstreamFundFactType;
  basisType: ProjectUpstreamFundBasisType;
  occurredAt: string;
  amountYuan: string;
  counterpartyName: string;
  deductionCategory: "management_fee" | "tax" | "deposit" | "insurance" | "other";
  description: string;
  voucherFile: File | null;
}

interface ProjectExpenseFormState {
  code: string;
  expenseType: ProjectExpenseType;
  expenseSubtype: ProjectExpenseSubtype;
  paymentSubject: string;
  reason: string;
  amountYuan: string;
  paymentMethod: ProjectExpensePaymentMethod;
  counterpartyName: string;
  counterpartyAccountName: string;
  counterpartyBankName: string;
  counterpartyBankAccount: string;
  attachmentFile: File | null;
}

interface ProjectExpenseActionFormState {
  purchaseExecutedAt: string;
  purchaseExecutionNote: string;
  purchaseExecutionPassword: string;
  downloadPassword: string;
}

interface ProjectFormState {
  code: string;
  name: string;
}

const auth = useAuthStore();
const router = useRouter();
const projects = ref<ProjectOptionReadModel[]>([]);
const overview = ref<ProjectOperatingOverviewReadModel | null>(null);
const executiveOverview = ref<ExecutiveProjectOverview | null>(null);
const projectExpenses = ref<ProjectExpenseRequestListReadModel | null>(null);
const financingQuotaWorkbench = ref<ProjectFinancingQuotaWorkbenchReadModel | null>(null);
const financingQuotaError = ref("");
const overviewRequestOwner = createProjectOverviewRequestOwner();
const selectedProjectId = ref("");
const loadedProjectId = ref("");
const projectSwitching = ref(false);
const activeTab = ref("overview");
const loadingProjects = ref(false);
const loadingOverview = ref(false);
const loadingExecutiveOverview = ref(false);
const message = ref("");
const executiveMessage = ref("");
const projectSubmitting = ref(false);
const projectUpdating = ref(false);
const projectMessage = ref("");
const projectMessageTone = ref<"success" | "danger">("success");
const projectForm = ref<ProjectFormState>({ code: "", name: "" });
const selectedProjectName = ref("");
const receiptSubmitting = ref(false);
const receiptMessage = ref("");
const receiptMessageTone = ref<"success" | "danger">("success");
const receiptForm = ref<ReceiptFormState>(createReceiptForm());
const receiptVoucherInput = ref<HTMLInputElement | null>(null);
const selectedUpstreamFundFact = ref<ProjectUpstreamFundFactReadModel | null>(null);
const upstreamFundConfirmationVisible = ref(false);
const upstreamFundConfirmationBusy = ref(false);
const upstreamFundConfirmationError = ref("");
const expenseSubmitting = ref(false);
const expenseMessage = ref("");
const expenseMessageTone = ref<"success" | "danger">("success");
const expenseAttachmentInput = ref<HTMLInputElement | null>(null);
const expenseForm = ref<ProjectExpenseFormState>(createProjectExpenseForm());
const selectedExpenseRow = ref<ProjectExpenseRow | null>(null);
const expenseActionForm = ref<ProjectExpenseActionFormState>(createProjectExpenseActionForm());
const expenseActionBusy = ref("");
const expenseActionMessage = ref("");
const expenseActionMessageTone = ref<"success" | "danger">("success");
const expenseLedgerView = ref<DraftLedgerView>("formal_ledger");
const expenseLedgerLoading = ref(false);
const expenseLedgerPage = ref(1);
const expenseLedgerPageSize = 20;
const expenseFormBaseline = ref(projectExpenseFormSnapshot(expenseForm.value));
const expenseLeaveDialogVisible = ref(false);
let resolvePendingExpenseLeave: ((decision: boolean) => void) | null = null;

const expenseFormDirty = computed(
  () => projectExpenseFormSnapshot(expenseForm.value) !== expenseFormBaseline.value
);
const expenseLeaveGuard = useUnsavedChangesGuard({
  isDirty: expenseFormDirty,
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingExpenseLeave?.(false);
    resolvePendingExpenseLeave = resolve;
    expenseLeaveDialogVisible.value = true;
  })
});

const summaryItems = computed(() => {
  const counts = overview.value?.counts ?? { contracts: 0, settlements: 0, payments: 0 };
  return [
    { label: "合同", value: String(counts.contracts) },
    { label: "结算", value: String(counts.settlements) },
    { label: "付款", value: String(counts.payments) },
    { label: "可用资金", value: formatCents(overview.value?.cash.availableFundsCents ?? null) }
  ];
});

const projectSelectOptions = computed(() =>
  projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
);

const projectBusinessEntries = computed(() =>
  buildProjectBusinessEntries(overview.value?.project.name ?? selectedProjectName.value, {
    contracts: overview.value?.counts.contracts ?? 0,
    settlements: overview.value?.counts.settlements ?? 0,
    payments: overview.value?.counts.payments ?? 0
  })
);

const projectExpenseRows = computed<ProjectExpenseRow[]>(() => projectExpenses.value?.rows ?? []);
const upstreamFundRows = computed<ProjectUpstreamFundFactReadModel[]>(
  () => overview.value?.upstreamFunds.rows ?? []
);
const upstreamFundConfirmationDescription = computed(() => {
  const fact = selectedUpstreamFundFact.value;
  if (!fact) return "";
  return fact.basisType === "oral"
    ? `该记录只有口头通知。财务主管确认后将冻结本人当前手写签名；${fact.factTypeLabel} ${formatCents(fact.amountCents)}。`
    : `确认后将冻结本人当前手写签名，且该事实只能通过追加更正或反向处理；${fact.factTypeLabel} ${formatCents(fact.amountCents)}。`;
});

function projectExpenseViewCount(view: "formal_ledger" | "ended") {
  return projectExpenses.value?.viewCounts?.[view] ?? 0;
}

const projectExpensePagination = computed(() =>
  projectExpenses.value?.pagination ?? {
    page: expenseLedgerPage.value,
    pageSize: expenseLedgerPageSize,
    total: 0,
    totalPages: 0
  }
);

const projectExpenseSummaryItems = computed(() => {
  const statistics = projectExpenses.value?.statistics;
  return [
    { label: "正式支出单", value: String(statistics?.formalTotal ?? 0) },
    { label: "审批中", value: String(statistics?.pendingApproval ?? 0) },
    { label: "已批待付", value: String(statistics?.pendingPayment ?? 0) },
    { label: "已实付", value: formatCents(statistics?.formalPaidAmountCents ?? "0") }
  ];
});

const currentExpenseSubtypeOptions = computed(() => subtypeOptionsFor(expenseForm.value.expenseType));
const spotProcurementEnabled = ref(false);
const visibleExpenseTypeOptions = computed(() =>
  spotProcurementEnabled.value
    ? expenseTypeOptions.filter((option) => option.value !== "spot_purchase")
    : expenseTypeOptions
);

const canManageProjects = computed(
  () => auth.user?.roleKeys.some((role) => role === "chairman" || role === "general_manager") ?? false
);

const canViewExecutiveOverview = computed(
  () =>
    auth.user?.globalRoleKeys.some((role) => GLOBAL_PROJECT_OVERVIEW_ROLE_KEYS.has(role)) ?? false
);

const canRecordUpstreamFunds = computed(
  () =>
    auth.user?.roleKeys.some((role) =>
      ["finance_director", "finance_staff"].includes(role)
    ) ?? false
);
const canReadProjectOverview = computed(
  () =>
    auth.user?.roleKeys.some((role) =>
      [
        "chairman",
        "general_manager",
        "engineering_department_director",
        "finance_staff",
        "finance_director",
        "contract_director",
        "budget_director",
        "material_director",
        "comprehensive_director",
        "super_admin",
        "project_manager"
      ].includes(role)
    ) ?? false
);

const canReadProjectExpenseLedger = computed(
  () =>
    auth.user?.roleKeys.some((role) =>
      [
        "chairman",
        "general_manager",
        "project_manager",
        "finance_director",
        "finance_staff",
        "material_director",
        "material_staff"
      ].includes(role)
    ) ?? false
);

const canCreateProjectExpense = computed(
  () =>
    auth.user?.roleKeys.some((role) =>
      ["employee", "project_manager", "material_staff"].includes(role)
    ) ?? false
);

const cashItems = computed(() => {
  const cash = overview.value?.cash;
  return [
    { label: "我方实际到账", value: formatCents(cash?.actualReceiptsCents ?? null) },
    { label: "已确认挂靠拨款", value: formatCents(cash?.affiliateRemittanceCents ?? "0") },
    { label: "历史收款口径", value: formatCents(cash?.legacyReceiptsCents ?? "0") },
    { label: "供应商退款", value: formatCents(cash?.supplierRefundsCents ?? null) },
    { label: "可用资金", value: formatCents(cash?.availableFundsCents ?? null) },
    { label: "已实付", value: formatCents(cash?.actualPaidCents ?? "0") },
    { label: "审批中预占", value: formatCents(cash?.approvalPendingOccupancyCents ?? "0") },
    { label: "已批待付款", value: formatCents(cash?.approvedPendingPaymentCents ?? "0") },
    { label: "财务已记出账", value: formatCents(cash?.financeRecordedOutflowCents ?? "0") }
  ];
});

const businessItems = computed(() => {
  const business = overview.value?.business;
  const upstream = overview.value?.upstreamFunds;
  return [
    { label: "生效合同额", value: formatCents(business?.effectiveContractAmountCents ?? "0") },
    { label: "生效结算额", value: formatCents(business?.effectiveSettlementAmountCents ?? "0") },
    { label: "结算可付额", value: formatCents(business?.payableSettlementAmountCents ?? "0") },
    { label: "业主向挂靠企业付款", value: formatCents(upstream?.ownerPaymentCents ?? "0") },
    { label: "挂靠扣款", value: formatCents(upstream?.affiliateDeductionCents ?? "0") },
    { label: "待核对到账差额", value: formatCents(upstream?.unreconciledReceiptDifferenceCents ?? "0") },
    { label: "经营收入", value: formatCents(business?.operatingIncomeCents ?? null) },
    {
      label: "挂靠企业对下付款",
      value: formatCents(business?.affiliateDownstreamPaymentCents ?? "0")
    },
    { label: "经营成本", value: formatCents(business?.operatingCostCents ?? null) },
    { label: "毛利", value: formatCents(business?.grossProfitCents ?? null) }
  ];
});

const executiveSummaryItems = computed(() => {
  const summary = executiveOverview.value?.summary;
  return [
    { label: "项目数", value: String(summary?.projectCount ?? 0) },
    { label: "生效合同额", value: formatCents(summary?.contractAmountCents ?? "0") },
    { label: "生效结算额", value: formatCents(summary?.settlementAmountCents ?? "0") },
    { label: "结算可付额", value: formatCents(summary?.payableAmountCents ?? "0") },
    { label: "实际收款", value: formatCents(summary?.actualReceiptsCents ?? null) },
    { label: "供应商退款", value: formatCents(summary?.supplierRefundsCents ?? null) },
    { label: "已实付", value: formatCents(summary?.actualPaidCents ?? "0") },
    { label: "已批待付", value: formatCents(summary?.approvedPendingPaymentCents ?? "0") },
    { label: "可用资金", value: formatCents(summary?.availableFundsCents ?? null) },
    { label: "数据缺口", value: `${summary?.dataGapCount ?? 0} 项` }
  ];
});

onMounted(loadProjects);
onBeforeUnmount(() => overviewRequestOwner.invalidate());

async function loadProjects() {
  loadingProjects.value = true;
  message.value = "";
  try {
    projects.value = await fetchProjects();
    selectedProjectId.value = projects.value[0]?.id ?? "";
    loadedProjectId.value = selectedProjectId.value;
    if (!canReadProjectOverview.value && canCreateProjectExpense.value) {
      activeTab.value = "operations";
    }
    syncSelectedProjectName();
    await loadExecutiveOverview();
    if (selectedProjectId.value) {
      await loadOverview();
    } else {
      message.value = "暂无可用项目";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载项目失败";
  } finally {
    loadingProjects.value = false;
  }
}

async function submitProject() {
  if (!canManageProjects.value) {
    return;
  }

  if (expenseFormDirty.value) {
    const confirmed = await expenseLeaveGuard.requestClose();
    if (!confirmed) return;
    resetExpenseForm();
    expenseMessage.value = "";
  }

  projectSubmitting.value = true;
  projectMessage.value = "";
  try {
    const created = await createProjectWithCapability({
      code: requiredText(projectForm.value.code, "项目编号"),
      name: requiredText(projectForm.value.name, "项目名称")
    });
    const nextProjects = await fetchProjects();
    projects.value = nextProjects.some((project) => project.id === created.id)
      ? nextProjects
      : [...nextProjects, created];
    selectedProjectId.value = projects.value.find((project) => project.id === created.id)?.id ?? created.id;
    loadedProjectId.value = selectedProjectId.value;
    projectForm.value = { code: "", name: "" };
    syncSelectedProjectName();
    projectMessageTone.value = "success";
    projectMessage.value = "项目已新增";
    await loadExecutiveOverview();
    await loadOverview();
  } catch (error) {
    projectMessageTone.value = "danger";
    projectMessage.value = error instanceof Error ? error.message : "新增项目失败";
  } finally {
    projectSubmitting.value = false;
  }
}

async function submitProjectName() {
  if (!canManageProjects.value || !selectedProjectId.value) {
    return;
  }

  projectUpdating.value = true;
  projectMessage.value = "";
  try {
    const updated = await updateProjectWithCapability(selectedProjectId.value, {
      name: requiredText(selectedProjectName.value, "项目名称")
    });
    projects.value = projects.value.map((project) => (project.id === updated.id ? updated : project));
    selectedProjectName.value = updated.name;
    projectMessageTone.value = "success";
    projectMessage.value = "项目名称已保存";
    await loadExecutiveOverview();
    await loadOverview();
  } catch (error) {
    projectMessageTone.value = "danger";
    projectMessage.value = error instanceof Error ? error.message : "保存项目名称失败";
  } finally {
    projectUpdating.value = false;
  }
}

async function createProjectWithCapability(
  body: Parameters<typeof createProject>[0]
) {
  const capability = await fetchProjectCreateCapability();
  const operationAllowed = capability.availableActions.includes("create_project");
  if (!operationAllowed) throw new Error("当前用户不能新增项目");
  return createProject(body);
}

async function updateProjectWithCapability(
  projectId: string,
  body: Parameters<typeof updateProject>[1]
) {
  const capability = await fetchProjectUpdateCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("update_project");
  if (!operationAllowed) throw new Error("当前用户不能维护该项目");
  return updateProject(projectId, body);
}

async function handleProjectChange(value: string | number) {
  await requestProjectChange(String(value));
}

async function selectExecutiveProject(projectId: string) {
  await requestProjectChange(projectId);
}

async function requestProjectChange(projectId: string) {
  const previousProjectId = loadedProjectId.value;
  if (projectSwitching.value) {
    selectedProjectId.value = previousProjectId;
    return;
  }
  if (!projectId || projectId === previousProjectId) {
    selectedProjectId.value = previousProjectId || projectId;
    syncSelectedProjectName();
    return;
  }

  // t-select updates v-model before emitting change. Restore the loaded project
  // while the user decides so no request can run against the new project early.
  selectedProjectId.value = previousProjectId;
  syncSelectedProjectName();
  projectSwitching.value = true;
  try {
    const confirmed = await expenseLeaveGuard.requestClose();
    if (!confirmed) return;

    if (expenseFormDirty.value) {
      resetExpenseForm();
      expenseMessage.value = "";
    }
    selectedProjectId.value = projectId;
    loadedProjectId.value = projectId;
    expenseLedgerPage.value = 1;
    syncSelectedProjectName();
    await loadOverview();
  } finally {
    projectSwitching.value = false;
  }
}

async function handleOperatingTabChange(value: string | number) {
  const nextTab = String(value);
  if (nextTab === "operations" || !expenseFormDirty.value) return;

  activeTab.value = "operations";
  const confirmed = await expenseLeaveGuard.requestClose();
  if (!confirmed) return;
  resetExpenseForm();
  expenseMessage.value = "";
  activeTab.value = nextTab;
}

function go(path: string) {
  void router.push(path);
}

function syncSelectedProjectName() {
  selectedProjectName.value = projects.value.find((project) => project.id === selectedProjectId.value)?.name ?? "";
}

async function loadExecutiveOverview() {
  if (!canViewExecutiveOverview.value || !projects.value.length) {
    executiveOverview.value = null;
    executiveMessage.value = "";
    return;
  }

  loadingExecutiveOverview.value = true;
  executiveMessage.value = "";
  try {
    const overviews = await Promise.all(
      projects.value.map((project) => fetchProjectOperatingOverview(project.id))
    );
    executiveOverview.value = buildExecutiveProjectOverview(overviews);
  } catch (error) {
    executiveOverview.value = null;
    executiveMessage.value = error instanceof Error ? error.message : "加载跨项目经营总览失败";
  } finally {
    loadingExecutiveOverview.value = false;
  }
}

async function loadOverview() {
  const requestOwner = overviewRequestOwner.begin();
  const projectId = selectedProjectId.value;
  const selectedExpenseId = selectedExpenseRow.value?.id ?? "";
  overview.value = null;
  projectExpenses.value = null;
  financingQuotaWorkbench.value = null;
  financingQuotaError.value = "";
  spotProcurementEnabled.value = false;
  receiptMessage.value = "";
  expenseMessage.value = "";
  expenseActionMessage.value = "";
  if (!projectId) {
    overview.value = null;
    selectedExpenseRow.value = null;
    loadingOverview.value = false;
    return;
  }

  loadingOverview.value = true;
  message.value = "";
  try {
    const [nextOverview, nextExpenses, spotCapability, nextFinancingQuota] = await Promise.all([
      canReadProjectOverview.value
        ? fetchProjectOperatingOverview(projectId)
        : Promise.resolve(null),
      canReadProjectExpenseLedger.value
        ? fetchProjectExpenseRequests(projectId, {
            view: expenseLedgerView.value,
            page: expenseLedgerPage.value,
            pageSize: expenseLedgerPageSize
          })
        : Promise.resolve(null),
      canCreateProjectExpense.value
        ? fetchSpotProcurementCapabilities(projectId).catch(() => ({ enabled: false }))
        : Promise.resolve({ enabled: false }),
      fetchProjectFinancingQuotaWorkbench(projectId)
        .then((workbench) => ({ workbench, error: "" }))
        .catch((error: unknown) => ({
          workbench: null,
          error:
            error instanceof ProjectFinancingQuotaApiError && error.status === 403
              ? ""
              : error instanceof Error
                ? error.message
                : "读取项目垫资额度失败"
        }))
    ]);
    if (
      overviewRequestOwner.isCurrent(requestOwner) &&
      selectedProjectId.value === projectId
    ) {
      overview.value = nextOverview;
      projectExpenses.value = nextExpenses;
      financingQuotaWorkbench.value = nextFinancingQuota.workbench;
      financingQuotaError.value = nextFinancingQuota.error;
      spotProcurementEnabled.value = spotCapability.enabled;
      if (!nextOverview && nextFinancingQuota.workbench) {
        activeTab.value = "operations";
      }
      if (
        spotCapability.enabled &&
        expenseForm.value.expenseType === "spot_purchase" &&
        !expenseFormDirty.value
      ) {
        expenseForm.value = createProjectExpenseForm("sporadic_payment");
        syncExpenseFormBaseline();
      }
      selectedExpenseRow.value = selectedExpenseId
        ? nextExpenses?.rows.find((row) => row.id === selectedExpenseId) ?? null
        : null;
    }
  } catch (error) {
    if (
      overviewRequestOwner.isCurrent(requestOwner) &&
      selectedProjectId.value === projectId
    ) {
      overview.value = null;
      financingQuotaWorkbench.value = null;
      financingQuotaError.value = "";
      selectedExpenseRow.value = null;
      message.value = error instanceof Error ? error.message : "加载项目经营数据失败";
    }
  } finally {
    if (
      overviewRequestOwner.isCurrent(requestOwner) &&
      selectedProjectId.value === projectId
    ) {
      loadingOverview.value = false;
    }
  }
}

function handleFinancingQuotaUpdated(
  nextWorkbench: ProjectFinancingQuotaWorkbenchReadModel
) {
  if (nextWorkbench.project.id !== selectedProjectId.value) return;
  financingQuotaWorkbench.value = nextWorkbench;
  financingQuotaError.value = "";
}

async function submitProjectExpense() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setExpenseError("请先选择项目");
    return;
  }

  expenseSubmitting.value = true;
  expenseMessage.value = "";
  try {
    const form = expenseForm.value;
    const code = requiredText(form.code, "支出单号");
    const isSpotPurchase = form.expenseType === "spot_purchase";
    const paymentSubject = requiredText(form.paymentSubject, isSpotPurchase ? "采购事项" : "付款主体");
    const reason = requiredText(form.reason, isSpotPurchase ? "采购用途" : "付款事由");
    const requestedAmountCents = parseYuanToCents(form.amountYuan, isSpotPurchase ? "预算金额" : "申请金额");
    if (isSpotPurchase) {
      requiredText(form.counterpartyName, "供应商");
      if (!form.attachmentFile) {
        throw new Error("请上传零星采购附件");
      }
    }
    const attachmentFileId = form.attachmentFile
      ? (
          await uploadProjectExpenseAttachmentWithCapability(
            projectId,
            form.attachmentFile
          )
        ).id
      : undefined;
    await createProjectExpenseRequestWithCapability(projectId, {
      code,
      expenseType: form.expenseType,
      expenseSubtype: form.expenseSubtype,
      paymentSubject,
      reason,
      requestedAmountCents,
      paymentMethod: form.paymentMethod,
      counterpartyName: form.counterpartyName.trim() || undefined,
      counterpartyAccountName: form.counterpartyAccountName.trim() || undefined,
      counterpartyBankName: form.counterpartyBankName.trim() || undefined,
      counterpartyBankAccount: form.counterpartyBankAccount.trim() || undefined,
      attachmentFileId
    });
    expenseForm.value = createProjectExpenseForm(form.expenseType);
    syncExpenseFormBaseline();
    expenseLedgerView.value = "formal_ledger";
    expenseLedgerPage.value = 1;
    if (expenseAttachmentInput.value) {
      expenseAttachmentInput.value.value = "";
    }
    await loadOverview();
    expenseMessageTone.value = "success";
    expenseMessage.value = "项目支出已提交审批，资金占用已刷新。";
  } catch (error) {
    setExpenseError(error instanceof Error ? error.message : "提交项目支出失败");
  } finally {
    expenseSubmitting.value = false;
  }
}

async function createProjectExpenseRequestWithCapability(
  projectId: string,
  body: Parameters<typeof createProjectExpenseRequest>[1]
) {
  const capability = await fetchProjectExpenseCreateCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "create_project_expense_request"
  );
  if (!operationAllowed) throw new Error("当前用户不能提交该项目支出申请");
  return createProjectExpenseRequest(projectId, body);
}

async function uploadProjectExpenseAttachmentWithCapability(
  projectId: string,
  file: File
) {
  const capability = await fetchProjectExpenseCreateCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "create_project_expense_request"
  );
  if (!operationAllowed) throw new Error("当前用户不能上传该项目支出附件");
  return uploadProjectExpensePrivateFile(projectId, file, file.name);
}

async function loadProjectExpenses() {
  const projectId = selectedProjectId.value;
  if (!projectId || !canReadProjectExpenseLedger.value) return;
  expenseLedgerLoading.value = true;
  expenseMessage.value = "";
  try {
    projectExpenses.value = await fetchProjectExpenseRequests(projectId, {
      view: expenseLedgerView.value,
      page: expenseLedgerPage.value,
      pageSize: expenseLedgerPageSize
    });
    selectedExpenseRow.value = null;
  } catch (error) {
    projectExpenses.value = null;
    setExpenseError(error instanceof Error ? error.message : "读取项目支出台账失败，请重试。");
  } finally {
    expenseLedgerLoading.value = false;
  }
}

function changeExpenseLedgerView() {
  expenseLedgerPage.value = 1;
  void loadProjectExpenses();
}

function changeExpenseLedgerPage(page: number) {
  expenseLedgerPage.value = page;
  void loadProjectExpenses();
}

async function discardExpenseFilling() {
  const confirmed = await expenseLeaveGuard.requestClose();
  if (!confirmed) return;
  resetExpenseForm();
  expenseMessage.value = "";
}

function resolveExpenseLeave(decision: boolean) {
  expenseLeaveDialogVisible.value = false;
  const resolve = resolvePendingExpenseLeave;
  resolvePendingExpenseLeave = null;
  resolve?.(decision);
}

function resetExpenseForm() {
  expenseForm.value = createProjectExpenseForm();
  syncExpenseFormBaseline();
  if (expenseAttachmentInput.value) {
    expenseAttachmentInput.value.value = "";
  }
}

function syncExpenseFormBaseline() {
  expenseFormBaseline.value = projectExpenseFormSnapshot(expenseForm.value);
}

async function submitReceipt() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setReceiptError("请先选择项目");
    return;
  }

  receiptSubmitting.value = true;
  receiptMessage.value = "";
  try {
    const form = receiptForm.value;
    if (form.basisType === "written" && !form.voucherFile) {
      throw new Error("书面依据的上游资金事实必须上传依据文件");
    }
    const occurredAt = requiredText(form.occurredAt, "发生日期");
    const amountCents = parseYuanToCents(form.amountYuan, "上游资金金额");
    const counterpartyName = requiredText(form.counterpartyName, "交易对方");
    const evidenceFileId = form.voucherFile
      ? (
          await uploadProjectUpstreamFundEvidenceWithCapability(
            projectId,
            form.voucherFile
          )
        ).id
      : undefined;
    await recordProjectUpstreamFundFactWithCapability(projectId, {
      factType: form.factType,
      basisType: form.basisType,
      occurredAt,
      amountCents,
      counterpartyName,
      ...(form.factType === "affiliate_deduction"
        ? { deductionCategory: form.deductionCategory }
        : {}),
      description: form.description.trim() || undefined,
      evidenceFileId,
      idempotencyKey: crypto.randomUUID()
    });
    receiptForm.value = createReceiptForm(form.factType);
    if (receiptVoucherInput.value) {
      receiptVoucherInput.value.value = "";
    }
    await loadOverview();
    receiptMessageTone.value = "success";
    receiptMessage.value =
      form.factType === "unreconciled_receipt_difference"
        ? "到账差额已进入待核对，不会自动生成扣款或成本。"
        : "上游资金事实已保存待独立确认。";
  } catch (error) {
    setReceiptError(error instanceof Error ? error.message : "登记上游资金事实失败");
  } finally {
    receiptSubmitting.value = false;
  }
}

async function recordProjectUpstreamFundFactWithCapability(
  projectId: string,
  body: Parameters<typeof recordProjectUpstreamFundFact>[1]
) {
  const capability = await fetchProjectUpstreamFundRecordCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_upstream_fund_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能登记该项目上游资金事实");
  return recordProjectUpstreamFundFact(projectId, body);
}

async function uploadProjectUpstreamFundEvidenceWithCapability(
  projectId: string,
  file: File
) {
  const capability = await fetchProjectUpstreamFundRecordCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_upstream_fund_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能上传该上游资金依据");
  return uploadProjectUpstreamFundPrivateFile(projectId, file, file.name);
}

function canConfirmUpstreamFundFact(fact: ProjectUpstreamFundFactReadModel) {
  if (fact.status !== "pending_confirm") return false;
  const roles = auth.user?.roleKeys ?? [];
  return fact.basisType === "oral"
    ? roles.includes("finance_director")
    : roles.some((role) => role === "finance_staff" || role === "finance_director");
}

function openUpstreamFundConfirmation(fact: ProjectUpstreamFundFactReadModel) {
  selectedUpstreamFundFact.value = fact;
  upstreamFundConfirmationError.value = "";
  upstreamFundConfirmationVisible.value = true;
}

function closeUpstreamFundConfirmation() {
  if (upstreamFundConfirmationBusy.value) return;
  upstreamFundConfirmationVisible.value = false;
  selectedUpstreamFundFact.value = null;
  upstreamFundConfirmationError.value = "";
}

async function submitUpstreamFundConfirmation(values: { reason: string; password: string }) {
  const projectId = selectedProjectId.value;
  const fact = selectedUpstreamFundFact.value;
  if (!projectId || !fact) return;
  upstreamFundConfirmationBusy.value = true;
  upstreamFundConfirmationError.value = "";
  try {
    await confirmProjectUpstreamFundFactWithCapability(projectId, fact.id, {
      confirmationPassword: values.password,
      confirmationActionId: crypto.randomUUID()
    });
    upstreamFundConfirmationVisible.value = false;
    selectedUpstreamFundFact.value = null;
    await loadOverview();
    receiptMessageTone.value = "success";
    receiptMessage.value = "上游资金事实已确认，并冻结确认人的手写签名版本。";
  } catch (error) {
    upstreamFundConfirmationError.value =
      error instanceof Error ? error.message : "确认上游资金事实失败";
  } finally {
    upstreamFundConfirmationBusy.value = false;
  }
}

async function confirmProjectUpstreamFundFactWithCapability(
  projectId: string,
  fundFactId: string,
  body: Parameters<typeof confirmProjectUpstreamFundFact>[2]
) {
  const capability = await fetchProjectUpstreamFundConfirmationCapability(
    projectId,
    fundFactId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("上游资金事实已变化，请刷新后重试");
  }
  const matchesRequestedFact = capability.fundFactId === fundFactId;
  if (!matchesRequestedFact) {
    throw new Error("上游资金事实已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "confirm_upstream_fund_fact"
  );
  if (!operationAllowed) throw new Error("当前用户不能确认该上游资金事实");
  return confirmProjectUpstreamFundFact(projectId, fundFactId, body);
}

function createReceiptForm(
  factType: ProjectUpstreamFundFactType = "affiliate_remittance_to_company"
): ReceiptFormState {
  return {
    factType,
    basisType: "written",
    occurredAt: todayText(),
    amountYuan: "",
    counterpartyName: "",
    deductionCategory: "management_fee",
    description: "",
    voucherFile: null
  };
}

function createProjectExpenseForm(
  expenseType: ProjectExpenseType = "sporadic_payment"
): ProjectExpenseFormState {
  return {
    code: "",
    expenseType,
    expenseSubtype: subtypeOptionsFor(expenseType)[0].value,
    paymentSubject: "",
    reason: "",
    amountYuan: "",
    paymentMethod: "bank_transfer",
    counterpartyName: "",
    counterpartyAccountName: "",
    counterpartyBankName: "",
    counterpartyBankAccount: "",
    attachmentFile: null
  };
}

function projectExpenseFormSnapshot(form: ProjectExpenseFormState) {
  return JSON.stringify({
    code: form.code,
    expenseType: form.expenseType,
    expenseSubtype: form.expenseSubtype,
    paymentSubject: form.paymentSubject,
    reason: form.reason,
    amountYuan: form.amountYuan,
    paymentMethod: form.paymentMethod,
    counterpartyName: form.counterpartyName,
    counterpartyAccountName: form.counterpartyAccountName,
    counterpartyBankName: form.counterpartyBankName,
    counterpartyBankAccount: form.counterpartyBankAccount,
    attachment: form.attachmentFile
      ? {
          name: form.attachmentFile.name,
          size: form.attachmentFile.size,
          type: form.attachmentFile.type,
          lastModified: form.attachmentFile.lastModified
        }
      : null
  });
}

function createProjectExpenseActionForm(): ProjectExpenseActionFormState {
  return {
    purchaseExecutedAt: todayText(),
    purchaseExecutionNote: "",
    purchaseExecutionPassword: "",
    downloadPassword: ""
  };
}

function selectReceiptVoucher(event: Event) {
  const input = event.target as HTMLInputElement;
  receiptForm.value.voucherFile = input.files?.[0] ?? null;
}

function selectExpenseAttachment(event: Event) {
  const input = event.target as HTMLInputElement;
  expenseForm.value.attachmentFile = input.files?.[0] ?? null;
}

function selectExpenseRow(row: ProjectExpenseRow) {
  selectedExpenseRow.value = row;
  expenseActionForm.value = createProjectExpenseActionForm();
  expenseActionMessage.value = "";
}

function clearSelectedExpenseRow() {
  selectedExpenseRow.value = null;
  expenseActionForm.value = createProjectExpenseActionForm();
  expenseActionMessage.value = "";
}

function syncExpenseSubtype() {
  const options = subtypeOptionsFor(expenseForm.value.expenseType);
  if (!options.some((option) => option.value === expenseForm.value.expenseSubtype)) {
    expenseForm.value.expenseSubtype = options[0].value;
  }
}

function expenseStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approval_pending: "审批中",
    withdrawn: "已撤回",
    rejected: "已驳回",
    approved_pending_payment: "已批待付款",
    partially_paid: "部分付款",
    paid: "已付款",
    voided: "已作废",
    payment_blocked: "付款阻断"
  };
  return labels[status] ?? "状态待确认";
}

function canRecordPurchaseExecution(row: ProjectExpenseRow) {
  return row.expenseType === "spot_purchase" && row.status === "approved_pending_payment" && !row.isPurchaseExecuted;
}

function todayText(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`请填写${label}`);
  }
  return trimmed;
}

function parseYuanToCents(value: string, label: string): string {
  const trimmed = value.trim();
  let amountCents: string;
  try {
    amountCents = yuanTextToCentsText(trimmed);
  } catch {
    throw new Error(`${label}必须是大于 0 的数字，最多保留两位小数`);
  }
  if (amountCents === "0") {
    throw new Error(`${label}必须大于 0`);
  }
  return amountCents;
}

function setReceiptError(messageText: string) {
  receiptMessageTone.value = "danger";
  receiptMessage.value = messageText;
}

function setExpenseError(messageText: string) {
  expenseMessageTone.value = "danger";
  expenseMessage.value = messageText;
}

async function runExpenseAction(actionKey: string, action: (row: ProjectExpenseRow) => Promise<void>) {
  const row = selectedExpenseRow.value;
  if (!row) {
    setExpenseActionError("请先选择支出单");
    return;
  }
  expenseActionBusy.value = actionKey;
  expenseActionMessage.value = "";
  try {
    await action(row);
    await loadOverview();
    if (selectedExpenseRow.value) {
      expenseActionForm.value = createProjectExpenseActionForm();
    }
    expenseActionMessageTone.value = "success";
    expenseActionMessage.value = "支出单处理完成，项目经营数据已刷新。";
  } catch (error) {
    setExpenseActionError(error instanceof Error ? error.message : "支出单处理失败");
  } finally {
    expenseActionBusy.value = "";
  }
}

function openExpenseApprovalDetail(row: ProjectExpenseRow) {
  void router.push(projectExpenseApprovalDetailPath(selectedProjectId.value, row.id));
}

async function submitExpensePurchaseExecution() {
  await runExpenseAction("purchase-execution", async (row) => {
    const form = expenseActionForm.value;
    await recordProjectExpensePurchaseExecutionWithCapability(selectedProjectId.value, row.id, {
      executedAt: requiredText(form.purchaseExecutedAt, "采购执行日期"),
      note: form.purchaseExecutionNote.trim() || undefined,
      confirmationPassword: requiredText(form.purchaseExecutionPassword, "采购执行确认密码")
    });
  });
}

async function recordProjectExpensePurchaseExecutionWithCapability(
  projectId: string,
  expenseRequestId: string,
  body: Parameters<typeof recordProjectExpensePurchaseExecution>[2]
) {
  const capability = await fetchProjectExpenseActionCapability(
    projectId,
    expenseRequestId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目支出已变化，请刷新后重试");
  }
  const matchesRequestedExpense = capability.expenseRequestId === expenseRequestId;
  if (!matchesRequestedExpense) {
    throw new Error("项目支出已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "record_purchase_execution"
  );
  if (!operationAllowed) throw new Error("当前用户不能登记该项目支出的采购执行");
  return recordProjectExpensePurchaseExecution(projectId, expenseRequestId, body);
}

async function downloadExpenseAttachment() {
  await runExpenseAction("download", async (row) => {
    if (!row.hasAttachment) {
      throw new Error("该支出单未上传申请附件");
    }
    const downloadReason = promptSensitiveActionReason("请输入本次下载原因");
    if (!downloadReason) {
      throw new Error("请填写下载原因");
    }
    const ticket = await downloadProjectExpenseAttachmentWithCapability(selectedProjectId.value, row.id, {
      confirmationPassword: requiredText(expenseActionForm.value.downloadPassword, "附件下载密码"),
      downloadReason
    });
    triggerFileDownload(apiDownloadUrl(ticket.downloadUrl), ticket.fileName);
  });
}

async function downloadProjectExpenseAttachmentWithCapability(
  projectId: string,
  expenseRequestId: string,
  body: Parameters<typeof downloadProjectExpenseAttachment>[2]
) {
  const capability = await fetchProjectExpenseActionCapability(
    projectId,
    expenseRequestId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目支出已变化，请刷新后重试");
  }
  const matchesRequestedExpense = capability.expenseRequestId === expenseRequestId;
  if (!matchesRequestedExpense) {
    throw new Error("项目支出已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes("download_attachment");
  if (!operationAllowed) throw new Error("当前用户不能下载该项目支出附件");
  return downloadProjectExpenseAttachment(projectId, expenseRequestId, body);
}

async function downloadExpenseApprovalPdf() {
  await runExpenseAction("approval-pdf", async (row) => {
    if (!row.hasApprovalPdf) {
      throw new Error("该支出单审批单文件尚未生成");
    }
    const downloadReason = promptSensitiveActionReason("请输入本次下载原因");
    if (!downloadReason) {
      throw new Error("请填写下载原因");
    }
    const ticket = await downloadProjectExpenseApprovalPdfWithCapability(selectedProjectId.value, row.id, {
      confirmationPassword: requiredText(expenseActionForm.value.downloadPassword, "审批单下载密码"),
      downloadReason
    });
    triggerFileDownload(apiDownloadUrl(ticket.downloadUrl), ticket.fileName);
  });
}

async function downloadProjectExpenseApprovalPdfWithCapability(
  projectId: string,
  expenseRequestId: string,
  body: Parameters<typeof downloadProjectExpenseApprovalPdf>[2]
) {
  const capability = await fetchProjectExpenseActionCapability(
    projectId,
    expenseRequestId
  );
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) {
    throw new Error("项目支出已变化，请刷新后重试");
  }
  const matchesRequestedExpense = capability.expenseRequestId === expenseRequestId;
  if (!matchesRequestedExpense) {
    throw new Error("项目支出已变化，请刷新后重试");
  }
  const operationAllowed = capability.availableActions.includes(
    "download_approval_pdf"
  );
  if (!operationAllowed) throw new Error("当前用户不能下载该项目支出审批单");
  return downloadProjectExpenseApprovalPdf(projectId, expenseRequestId, body);
}

function setExpenseActionError(messageText: string) {
  expenseActionMessageTone.value = "danger";
  expenseActionMessage.value = messageText;
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

function triggerFileDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatCents(value: string | null): string {
  if (value === null) {
    return "暂无数据";
  }
  return `¥${centsTextToYuanText(value)}`;
}

function upstreamFundStatusLabel(status: ProjectUpstreamFundFactReadModel["status"]) {
  if (status === "confirmed") return "已确认";
  if (status === "pending_reconciliation") return "待核对";
  return "待确认";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
</script>

<style scoped>
.project-operating-page {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: var(--jg-space-lg);
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-section);
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: var(--jg-font-page-title);
  line-height: var(--jg-line-height-title);
}

h2 {
  font-size: var(--jg-font-section-title);
}

.page-eyebrow {
  display: inline-flex;
  margin-bottom: var(--jg-space-xs);
  color: var(--jg-brand);
  font-size: var(--jg-font-meta);
  font-weight: 700;
  letter-spacing: 0.08em;
}

p,
dt,
.project-picker span,
.project-create-form span,
.project-name-form span,
.message,
.gap-panel li {
  color: #5f6673;
}

.project-tools {
  display: grid;
  gap: var(--jg-space-sm-plus);
  width: min(480px, 100%);
  min-width: min(360px, 100%);
}

.project-picker {
  display: grid;
  gap: var(--jg-space-xs);
}

.project-picker :deep(.t-select) {
  width: 100%;
}

.project-maintenance {
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-md);
  background: var(--jg-bg-muted);
}

.project-maintenance-forms {
  display: grid;
  gap: var(--jg-space-sm-plus);
}

.project-operating-tabs {
  min-width: 0;
}

.project-create-form {
  display: grid;
  grid-template-columns: 120px minmax(220px, 1fr) auto;
  align-items: end;
  gap: 8px;
}

.project-name-form {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: end;
  gap: 8px;
}

.project-create-form label,
.project-name-form label {
  display: grid;
  gap: 6px;
}

select {
  height: 32px;
  border: 1px solid #cfd7e3;
  border-radius: 4px;
  padding: 0 10px;
  background: #fff;
}

input {
  height: 32px;
  min-width: 0;
  border: 1px solid #cfd7e3;
  border-radius: 4px;
  padding: 0 10px;
  background: #fff;
}

button {
  height: 32px;
  border: 0;
  border-radius: 4px;
  padding: 0 14px;
  color: #fff;
  background: #165dff;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  background: #a8b1c2;
}

.summary-strip,
.executive-summary-grid,
.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.executive-summary-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.overview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-item,
.panel,
.gap-panel {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  padding: 16px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-actions,
.expense-ledger-switcher {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
}

.expense-ledger-switcher {
  justify-content: space-between;
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.receipt-panel {
  display: grid;
  gap: 12px;
}

.executive-panel {
  display: grid;
  gap: 12px;
}

.executive-loading {
  color: #5f6673;
  font-size: 13px;
}

.executive-table {
  min-width: var(--jg-layout-ledger-table-wide-min-width);
}

.project-entry-panel {
  display: grid;
  gap: 12px;
}

.project-entry-panel .panel-head {
  align-items: flex-start;
}

.project-entry-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.project-entry {
  height: auto;
  min-height: 86px;
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 12px;
  border: 1px solid #dce1e8;
  border-radius: 6px;
  background: #f8fbff;
  color: #1f2733;
  text-align: left;
}

.project-entry:hover,
.project-entry:focus-visible {
  border-color: #165dff;
  outline: 2px solid rgb(22 93 255 / 20%);
  outline-offset: 1px;
}

.project-entry span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 700;
}

.project-entry strong {
  min-width: 28px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #165dff;
  color: #fff;
  font-size: 12px;
}

.project-entry small {
  color: #5f6673;
  line-height: 1.5;
}

.receipt-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.receipt-form label {
  display: grid;
  gap: 6px;
}

.receipt-form span {
  color: #5f6673;
}

.receipt-description {
  grid-column: 1 / -1;
}

.receipt-message {
  padding: 10px 12px;
  border-radius: 6px;
}

.receipt-message.success {
  color: #0f7a3b;
  background: #edf8f0;
}

.receipt-message.danger {
  color: #b42318;
  background: #fff1f0;
}

.expense-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  color: #5f6673;
}

.expense-summary strong {
  color: #1f2733;
}

.expense-table-wrap {
  border: 1px solid #edf0f5;
  border-radius: 6px;
}

table {
  width: 100%;
  min-width: var(--jg-layout-ledger-table-min-width);
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #edf0f5;
}

th {
  color: #5f6673;
  font-weight: 600;
  background: #f7f9fc;
}

td {
  color: #1f2733;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.table-action {
  height: 28px;
  padding: 0 10px;
}

.empty-cell {
  color: #5f6673;
  text-align: center;
}

.secondary-button {
  color: #1f2733;
  background: #eef2f8;
}

.danger-button {
  background: #d54941;
}

.expense-action-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  background: #f8fbff;
}

.expense-action-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.expense-action-head h3 {
  margin: 0;
  font-size: 14px;
}

.expense-action-head p {
  margin-top: 4px;
}

.expense-action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.summary-item {
  display: grid;
  gap: 8px;
}

.summary-item strong {
  font-size: 20px;
}

dl {
  display: grid;
  gap: 10px;
  margin: 14px 0 0;
}

dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #edf0f5;
}

dd {
  margin: 0;
  font-weight: 600;
}

.gap-panel ul {
  margin: 12px 0 0;
  padding-left: 18px;
}

.overview-gap-panel {
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-lg);
  padding: var(--jg-space-md-plus);
  background: var(--jg-bg-muted);
}

.overview-gap-panel p {
  margin-top: var(--jg-space-sm);
}

.message {
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
}

@container jg-page (max-width: 1100px) {
  .summary-strip,
  .executive-summary-grid,
  .project-entry-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container jg-page (max-width: 840px) {
  .page-head,
  .panel-head {
    display: grid;
  }

  .project-picker {
    min-width: 0;
  }

  .project-tools,
  .project-create-form,
  .project-name-form {
    min-width: 0;
  }

  .project-tools {
    width: 100%;
  }

  .receipt-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@container jg-page (max-width: 620px) {
  .panel-actions,
  .expense-ledger-switcher {
    align-items: stretch;
    flex-direction: column;
  }

  .project-create-form,
  .project-name-form,
  .summary-strip,
  .executive-summary-grid,
  .project-entry-grid,
  .receipt-form {
    grid-template-columns: 1fr;
  }

  .expense-action-head,
  dl div {
    display: grid;
  }

  .receipt-description {
    grid-column: auto;
  }
}
</style>
