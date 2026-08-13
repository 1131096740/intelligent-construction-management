<template>
  <t-space
    direction="vertical"
    size="large"
    class="profile-panel"
  >
    <t-alert
      theme="info"
      title="双日期独立维护"
      message="经营账生效日表示正式业务优先进入系统的起点；接管完成日表示历史数据接管完成，两者不会互相推导。"
    />
    <t-card
      title="项目经营档案"
      :loading="loading"
    >
      <t-form
        v-if="profile"
        label-align="top"
        @submit="saveProfile"
      >
        <t-row :gutter="16">
          <t-col :span="4">
            <t-form-item label="经营账生效日">
              <t-date-picker
                v-model="form.operatingLedgerEffectiveDate"
                clearable
              />
            </t-form-item>
          </t-col>
          <t-col :span="4">
            <t-form-item label="经营接管完成日">
              <t-date-picker
                v-model="form.takeoverCompletedDate"
                clearable
              />
            </t-form-item>
          </t-col>
          <t-col :span="4">
            <t-form-item label="接管状态">
              <t-select
                v-model="form.takeoverStatus"
                :options="statusOptions"
              />
            </t-form-item>
          </t-col>
        </t-row>
        <t-button
          v-if="profile.canManage"
          type="submit"
          :loading="saving"
        >
          保存经营档案
        </t-button>
      </t-form>
    </t-card>
    <t-card title="唯一施工企业">
      <template v-if="profile?.constructionEnterprise">
        <t-descriptions
          :column="2"
          bordered
        >
          <t-descriptions-item label="施工企业">
            {{ profile.constructionEnterprise.name }}
          </t-descriptions-item>
          <t-descriptions-item label="统一社会信用代码">
            {{ profile.constructionEnterprise.creditCode || "未登记" }}
          </t-descriptions-item>
          <t-descriptions-item label="生效日">
            {{ profile.constructionEnterprise.effectiveFrom }}
          </t-descriptions-item>
          <t-descriptions-item label="锁定状态">
            {{ profile.constructionEnterprise.isLocked ? "首笔正式事实已锁定" : "尚未锁定" }}
          </t-descriptions-item>
        </t-descriptions>
      </template>
      <t-form
        v-if="profile?.canManage && !profile.constructionEnterprise?.isLocked"
        label-align="top"
        class="inline-form"
        @submit="saveConstructionEnterprise"
      >
        <t-form-item label="施工企业">
          <t-select
            v-model="constructionForm.businessPartyVersionId"
            filterable
            :options="constructionOptions"
          />
        </t-form-item>
        <t-form-item label="生效时间">
          <t-date-picker v-model="constructionForm.effectiveFromDate" />
        </t-form-item>
        <t-form-item label="设置/变更原因">
          <t-input v-model="constructionForm.changeReason" />
        </t-form-item>
        <t-button
          type="submit"
          :loading="savingConstruction"
        >
          {{ profile.constructionEnterprise ? "变更施工企业" : "设置施工企业" }}
        </t-button>
      </t-form>
    </t-card>
    <t-card title="我方参与公司">
      <t-table
        row-key="id"
        :data="profile?.participatingCompanies ?? []"
        :columns="columns"
        size="small"
      >
        <template #status="{ row }">
          <t-tag :theme="row.status === 'active' ? 'success' : 'default'">
            {{ row.status === "scheduled_active" ? "待生效" : row.status === "active" ? "参与中" : row.status === "scheduled_inactive" ? "已安排停止" : "已停止新增业务" }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-space v-if="profile?.canManage && (row.status === 'scheduled_active' || row.status === 'active')">
            <t-link
              v-if="row.status === 'active'"
              theme="warning"
              @click="deactivate(row.id)"
            >
              停止新增
            </t-link>
            <t-popconfirm
              content="仅无正式事实时可以删除，确认删除？"
              @confirm="remove(row.id)"
            >
              <t-link theme="danger">
                删除
              </t-link>
            </t-popconfirm>
          </t-space>
        </template>
      </t-table>
      <t-form
        v-if="profile?.canManage"
        label-align="top"
        class="inline-form"
        @submit="addParticipant"
      >
        <t-form-item label="参与公司">
          <t-select
            v-model="participantForm.companyEntityId"
            :options="companyOptions"
          />
        </t-form-item>
        <t-form-item label="生效日">
          <t-date-picker v-model="participantForm.effectiveFrom" />
        </t-form-item>
        <t-form-item label="加入原因">
          <t-input v-model="participantForm.changeReason" />
        </t-form-item>
        <t-button
          type="submit"
          :loading="adding"
        >
          新增参与公司
        </t-button>
      </t-form>
    </t-card>
    <t-alert
      v-if="message"
      :theme="tone"
      :message="message"
    />
    <t-dialog
      v-model:visible="deactivationVisible"
      header="停止参与公司新增业务"
      :confirm-btn="{ content: '确认停止', loading: deactivationSaving }"
      @confirm="confirmDeactivate"
    >
      <t-form label-align="top">
        <t-form-item label="停止日期">
          <t-date-picker v-model="deactivationForm.endedOn" />
        </t-form-item>
        <t-form-item label="原因">
          <t-input v-model="deactivationForm.changeReason" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </t-space>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { PROJECT_OPERATING_TAKEOVER_STATUS_LABELS, PROJECT_OPERATING_TAKEOVER_STATUSES, type ProjectOperatingTakeoverStatus } from "@jiangkong/shared-domain";
import { addProjectParticipatingCompany, assignProjectConstructionEnterprise, deactivateProjectParticipatingCompany, fetchProjectConstructionEnterpriseOptions, fetchProjectOperatingProfile, fetchProjectParticipatingCompanyOptions, removeProjectParticipatingCompany, updateProjectOperatingProfile, type ProjectOperatingProfileReadModel } from "../../../api/project-operating-profile.api";

const props = defineProps<{ projectId: string }>();
const profile = ref<ProjectOperatingProfileReadModel | null>(null);
const loading = ref(false); const saving = ref(false); const adding = ref(false); const savingConstruction = ref(false);
const message = ref(""); const tone = ref<"success" | "error">("success");
const deactivationVisible = ref(false); const deactivationSaving = ref(false); const deactivationParticipantId = ref("");
const deactivationForm = reactive({ endedOn: "", changeReason: "" });
const form = reactive<{ operatingLedgerEffectiveDate: string; takeoverCompletedDate: string; takeoverStatus: ProjectOperatingTakeoverStatus }>({ operatingLedgerEffectiveDate: "", takeoverCompletedDate: "", takeoverStatus: "preparing" });
let loadRequestId = 0;
let projectGeneration = 0;
const participantForm = reactive({ companyEntityId: "", effectiveFrom: "", changeReason: "" });
const constructionForm = reactive({ businessPartyVersionId: "", effectiveFromDate: "", changeReason: "" });
const companyOptions = ref<Array<{ label: string; value: string }>>([]);
const constructionOptions = ref<Array<{ label: string; value: string }>>([]);
const statusOptions = PROJECT_OPERATING_TAKEOVER_STATUSES.map(value => ({ value, label: PROJECT_OPERATING_TAKEOVER_STATUS_LABELS[value] }));
const columns = [{ colKey: "companyName", title: "公司" }, { colKey: "effectiveFrom", title: "生效日" }, { colKey: "endedAt", title: "停止日" }, { colKey: "status", title: "状态" }, { colKey: "operation", title: "操作" }];

function sync(value: ProjectOperatingProfileReadModel) { profile.value = value; form.operatingLedgerEffectiveDate = value.operatingLedgerEffectiveDate ?? ""; form.takeoverCompletedDate = value.takeoverCompletedDate ?? ""; form.takeoverStatus = value.takeoverStatus; }
function ownsLoad(requestId: number, expectedProjectId: string) { return requestId === loadRequestId && props.projectId === expectedProjectId; }
function ownsProject(expectedProjectId: string, expectedGeneration: number) { return props.projectId === expectedProjectId && projectGeneration === expectedGeneration; }
function resetProjectForms() { profile.value = null; companyOptions.value = []; constructionOptions.value = []; message.value = ""; Object.assign(participantForm, { companyEntityId: "", effectiveFrom: "", changeReason: "" }); Object.assign(constructionForm, { businessPartyVersionId: "", effectiveFromDate: "", changeReason: "" }); Object.assign(deactivationForm, { endedOn: "", changeReason: "" }); deactivationParticipantId.value = ""; deactivationVisible.value = false; saving.value = false; adding.value = false; savingConstruction.value = false; deactivationSaving.value = false; }
async function load() { const expectedProjectId = props.projectId; const requestId = ++loadRequestId; loading.value = true; try { const value = await fetchProjectOperatingProfile(expectedProjectId); if (!ownsLoad(requestId, expectedProjectId)) return; sync(value); if (value.canManage) { try { const [companies, enterprises] = await Promise.all([fetchProjectParticipatingCompanyOptions(expectedProjectId), fetchProjectConstructionEnterpriseOptions(expectedProjectId)]); if (!ownsLoad(requestId, expectedProjectId)) return; companyOptions.value = companies.map(company => ({ label: company.name, value: company.id })); constructionOptions.value = enterprises.map(enterprise => ({ label: `${enterprise.name}${enterprise.creditCode ? ` · ${enterprise.creditCode}` : ""} · 第 ${enterprise.versionNo} 版`, value: enterprise.id })); } catch (error) { if (ownsLoad(requestId, expectedProjectId)) fail(error); } } else { companyOptions.value = []; constructionOptions.value = []; } } catch (error) { if (ownsLoad(requestId, expectedProjectId)) fail(error); } finally { if (ownsLoad(requestId, expectedProjectId)) loading.value = false; } }
function fail(error: unknown) { tone.value = "error"; message.value = error instanceof Error ? error.message : "项目经营档案操作失败"; }
function ok(text: string) { tone.value = "success"; message.value = text; }
async function saveProfile() { const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; const payload = { operatingLedgerEffectiveDate: form.operatingLedgerEffectiveDate || null, takeoverCompletedDate: form.takeoverCompletedDate || null, takeoverStatus: form.takeoverStatus }; saving.value = true; try { await updateProjectOperatingProfile(expectedProjectId, payload); if (!ownsProject(expectedProjectId, expectedGeneration)) return; await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("项目经营档案已保存"); } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); } finally { if (ownsProject(expectedProjectId, expectedGeneration)) saving.value = false; } }
async function addParticipant() { const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; const payload = { ...participantForm }; adding.value = true; try { await addProjectParticipatingCompany(expectedProjectId, payload); if (!ownsProject(expectedProjectId, expectedGeneration)) return; await load(); if (!ownsProject(expectedProjectId, expectedGeneration)) return; Object.assign(participantForm, { companyEntityId: "", effectiveFrom: "", changeReason: "" }); ok("参与公司已加入"); } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); } finally { if (ownsProject(expectedProjectId, expectedGeneration)) adding.value = false; } }
function deactivate(id: string) { deactivationParticipantId.value = id; Object.assign(deactivationForm, { endedOn: "", changeReason: "" }); deactivationVisible.value = true; }
async function confirmDeactivate() { if (!deactivationForm.endedOn || !deactivationForm.changeReason.trim()) { fail(new Error("请填写停止日期和原因")); return; } const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; const participantId = deactivationParticipantId.value; const payload = { ...deactivationForm }; deactivationSaving.value = true; try { await deactivateProjectParticipatingCompany(expectedProjectId, participantId, payload); if (!ownsProject(expectedProjectId, expectedGeneration)) return; deactivationVisible.value = false; await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("已停止该公司新增业务"); } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); } finally { if (ownsProject(expectedProjectId, expectedGeneration)) deactivationSaving.value = false; } }
async function remove(id: string) { const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; try { await removeProjectParticipatingCompany(expectedProjectId, id); if (!ownsProject(expectedProjectId, expectedGeneration)) return; await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("参与公司已删除"); } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); } }
async function saveConstructionEnterprise() { const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; const payload = { businessPartyVersionId: constructionForm.businessPartyVersionId, effectiveFrom: `${constructionForm.effectiveFromDate}T00:00:00.000Z`, changeReason: constructionForm.changeReason }; savingConstruction.value = true; try { await assignProjectConstructionEnterprise(expectedProjectId, payload); if (!ownsProject(expectedProjectId, expectedGeneration)) return; await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("施工企业已保存"); } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); } finally { if (ownsProject(expectedProjectId, expectedGeneration)) savingConstruction.value = false; } }
watch(() => props.projectId, () => { projectGeneration += 1; resetProjectForms(); load(); }); onMounted(load);
</script>

<style scoped>.profile-panel{display:flex;width:100%;padding-top:var(--jg-space-md)}.inline-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end;gap:var(--jg-space-sm);margin-top:var(--jg-space-md)}@container jg-page (max-width:840px){.inline-form{grid-template-columns:1fr}}</style>
