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
        v-if="profile?.canManage"
        label-align="top"
        @submit="saveProfile"
      >
        <BusinessEntryForm
          v-if="profileDefinition?.key === 'project_operating_profile'"
          v-model="profileDraft"
          :definition="profileDefinition"
          :errors="profileErrors"
          :readonly="saving"
        />
        <t-button
          v-if="profile.canManage"
          type="submit"
          :loading="saving"
          :disabled="profileDefinition?.key !== 'project_operating_profile'"
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
        class="construction-form"
        @submit="saveConstructionEnterprise"
      >
        <BusinessEntryForm
          v-if="constructionDefinition?.key === 'project_construction_enterprise'"
          v-model="constructionDraft"
          :definition="constructionDefinition"
          :errors="constructionErrors"
          :readonly="savingConstruction"
          :options-by-field="{ businessPartyVersionId: constructionOptions }"
        />
        <t-button
          type="submit"
          :loading="savingConstruction"
          :disabled="constructionDefinition?.key !== 'project_construction_enterprise'"
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
      v-if="profile?.canManage"
      v-model:visible="deactivationVisible"
      header="停止参与公司新增业务"
      :confirm-btn="{ content: '确认停止', loading: deactivationSaving, disabled: !deactivationForm.endedOn || !deactivationForm.changeReason.trim() }"
      @confirm="confirmDeactivate(deactivationForm.endedOn, deactivationForm.changeReason.trim())"
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
import { onMounted, reactive, ref, shallowRef, watch } from "vue";
import { PROJECT_OPERATING_TAKEOVER_STATUSES, type BusinessEntryDraftPayload, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { fetchBusinessEntryDefinition, validateBusinessEntryDraft } from "../../../api/business-entry.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { addProjectParticipatingCompany, assignProjectConstructionEnterprise, deactivateProjectParticipatingCompany, fetchProjectConstructionEnterpriseOptions, fetchProjectOperatingProfile, fetchProjectParticipatingCompanyOptions, removeProjectParticipatingCompany, updateProjectOperatingProfile, type ProjectOperatingProfileReadModel } from "../../../api/project-operating-profile.api";

const props = defineProps<{ projectId: string }>();
const profile = ref<ProjectOperatingProfileReadModel | null>(null);
const loading = ref(false); const saving = ref(false); const adding = ref(false); const savingConstruction = ref(false);
const message = ref(""); const tone = ref<"success" | "error">("success");
const deactivationVisible = ref(false); const deactivationSaving = ref(false); const deactivationParticipantId = ref("");
const deactivationForm = reactive({ endedOn: "", changeReason: "" });
const profileDefinition = shallowRef<BusinessEntrySceneDefinition | null>(null);
const profileErrors = ref<Array<{ fieldKey?: string; message: string }>>([]);
const profileDraft = ref<BusinessEntryDraftPayload>({ sceneKey: "project_operating_profile", values: {} });
const constructionDefinition = shallowRef<BusinessEntrySceneDefinition | null>(null);
const constructionErrors = ref<Array<{ fieldKey?: string; message: string }>>([]);
const constructionDraft = ref<BusinessEntryDraftPayload>({ sceneKey: "project_construction_enterprise", values: {} });
let loadRequestId = 0;
let projectGeneration = 0;
const participantForm = reactive({ companyEntityId: "", effectiveFrom: "", changeReason: "" });
const companyOptions = ref<Array<{ label: string; value: string }>>([]);
const constructionOptions = ref<Array<{ label: string; value: string }>>([]);
const columns = [{ colKey: "companyName", title: "公司" }, { colKey: "effectiveFrom", title: "生效日" }, { colKey: "endedAt", title: "停止日" }, { colKey: "status", title: "状态" }, { colKey: "operation", title: "操作" }];

function ownsLoad(requestId: number, expectedProjectId: string) { return requestId === loadRequestId && props.projectId === expectedProjectId; }
function ownsProject(expectedProjectId: string, expectedGeneration: number) { return props.projectId === expectedProjectId && projectGeneration === expectedGeneration; }
function resetProjectForms() { profile.value = null; profileDefinition.value = null; profileErrors.value = []; profileDraft.value = { sceneKey: "project_operating_profile", values: {} }; constructionDefinition.value = null; constructionErrors.value = []; constructionDraft.value = { sceneKey: "project_construction_enterprise", values: {} }; companyOptions.value = []; constructionOptions.value = []; message.value = ""; Object.assign(participantForm, { companyEntityId: "", effectiveFrom: "", changeReason: "" }); Object.assign(deactivationForm, { endedOn: "", changeReason: "" }); deactivationParticipantId.value = ""; deactivationVisible.value = false; saving.value = false; adding.value = false; savingConstruction.value = false; deactivationSaving.value = false; }
async function loadProfileDefinition(projectId: string) {
  const definition = await fetchBusinessEntryDefinition("project_operating_profile", { scope: "project", projectId }, { entityType: "project", entityId: projectId }, "edit");
  if (definition.key !== "project_operating_profile") throw new Error("项目经营档案字段暂不可用，请刷新后重试");
  return definition;
}
async function loadConstructionDefinition(projectId: string) {
  const definition = await fetchBusinessEntryDefinition("project_construction_enterprise", { scope: "project", projectId }, { entityType: "project", entityId: projectId }, "edit");
  if (definition.key !== "project_construction_enterprise") throw new Error("施工企业填写规则暂不可用，请刷新后重试");
  return definition;
}
async function load() {
  const expectedProjectId = props.projectId;
  const requestId = ++loadRequestId;
  loading.value = true;
  try {
    const value = await fetchProjectOperatingProfile(expectedProjectId);
    if (!ownsLoad(requestId, expectedProjectId)) return;
    profile.value = value;
    profileDefinition.value = null;
    profileErrors.value = [];
    profileDraft.value = { sceneKey: "project_operating_profile", target: { entityType: "project", entityId: expectedProjectId }, values: { operatingLedgerEffectiveDate: value.operatingLedgerEffectiveDate, takeoverCompletedDate: value.takeoverCompletedDate, takeoverStatus: value.takeoverStatus } };
    if (value.canManage) {
      const [definition, companies, enterprises, enterpriseDefinition] = await Promise.all([loadProfileDefinition(expectedProjectId), fetchProjectParticipatingCompanyOptions(expectedProjectId), fetchProjectConstructionEnterpriseOptions(expectedProjectId), loadConstructionDefinition(expectedProjectId)]);
      if (!ownsLoad(requestId, expectedProjectId)) return;
      profileDefinition.value = definition;
      profileDraft.value.definitionVersion = definition.version;
      constructionDefinition.value = enterpriseDefinition;
      companyOptions.value = companies.map(company => ({ label: company.name, value: company.id }));
      constructionOptions.value = enterprises.map(enterprise => ({ label: `${enterprise.name}${enterprise.creditCode ? ` · ${enterprise.creditCode}` : ""} · 第 ${enterprise.versionNo} 版`, value: enterprise.id }));
    } else { companyOptions.value = []; constructionOptions.value = []; }
  } catch (error) { if (ownsLoad(requestId, expectedProjectId)) fail(error); }
  finally { if (ownsLoad(requestId, expectedProjectId)) loading.value = false; }
}
function fail(error: unknown) { tone.value = "error"; message.value = formatUnknownApiError(error, "项目经营档案操作失败，请稍后重试"); }
function ok(text: string) { tone.value = "success"; message.value = text; }
async function saveProfile() {
  if (saving.value || !profile.value?.canManage || profileDefinition.value?.key !== "project_operating_profile") return;
  const expectedProjectId = props.projectId;
  const expectedGeneration = projectGeneration;
  const values = { ...profileDraft.value.values };
  saving.value = true;
  profileErrors.value = [];
  message.value = "";
  try {
    const definition = await loadProfileDefinition(expectedProjectId);
    if (!ownsProject(expectedProjectId, expectedGeneration)) return;
    profileDefinition.value = definition;
    const validation = await validateBusinessEntryDraft({ scope: "project", projectId: expectedProjectId }, {
      sceneKey: definition.key, definitionVersion: definition.version,
      target: { entityType: "project", entityId: expectedProjectId }, values
    }, "edit");
    if (!ownsProject(expectedProjectId, expectedGeneration)) return;
    profileErrors.value = validation.errors;
    if (!validation.valid) return;
    const takeoverStatus = PROJECT_OPERATING_TAKEOVER_STATUSES.find(value => value === validation.values.takeoverStatus);
    if (!takeoverStatus) throw new Error("经营接管状态不受支持，请重新选择");
    const dateValue = (value: unknown) => typeof value === "string" && value !== "" ? value : null;
    const payload = { operatingLedgerEffectiveDate: dateValue(validation.values.operatingLedgerEffectiveDate), takeoverCompletedDate: dateValue(validation.values.takeoverCompletedDate), takeoverStatus };
    await updateProjectOperatingProfile(expectedProjectId, payload);
    if (!ownsProject(expectedProjectId, expectedGeneration)) return;
    await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("项目经营档案已保存");
  } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); }
  finally { if (ownsProject(expectedProjectId, expectedGeneration)) saving.value = false; }
}
async function addParticipant() { const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; const payload = { ...participantForm }; adding.value = true; await addProjectParticipatingCompany(expectedProjectId, payload).then(async () => { if (!ownsProject(expectedProjectId, expectedGeneration)) return; await load(); if (!ownsProject(expectedProjectId, expectedGeneration)) return; Object.assign(participantForm, { companyEntityId: "", effectiveFrom: "", changeReason: "" }); ok("参与公司已加入"); adding.value = false; }).catch(error => { if (ownsProject(expectedProjectId, expectedGeneration)) { fail(error); adding.value = false; } }); }
function deactivate(id: string) { deactivationParticipantId.value = id; Object.assign(deactivationForm, { endedOn: "", changeReason: "" }); deactivationVisible.value = true; }
async function confirmDeactivate(endedOn: string, changeReason: string) { if (!endedOn || !changeReason) { tone.value = "error"; message.value = "请填写停止日期和原因"; return; } const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; const participantId = deactivationParticipantId.value; const payload = { endedOn, changeReason }; deactivationSaving.value = true; await deactivateProjectParticipatingCompany(expectedProjectId, participantId, payload).then(async () => { if (!ownsProject(expectedProjectId, expectedGeneration)) return; deactivationVisible.value = false; await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("已停止该公司新增业务"); if (ownsProject(expectedProjectId, expectedGeneration)) deactivationSaving.value = false; }).catch(error => { if (ownsProject(expectedProjectId, expectedGeneration)) { fail(error); deactivationSaving.value = false; } }); }
async function remove(id: string) { const expectedProjectId = props.projectId; const expectedGeneration = projectGeneration; await removeProjectParticipatingCompany(expectedProjectId, id).then(async () => { if (!ownsProject(expectedProjectId, expectedGeneration)) return; await load(); if (ownsProject(expectedProjectId, expectedGeneration)) ok("参与公司已删除"); }).catch(error => { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); }); }
async function saveConstructionEnterprise() {
  if (savingConstruction.value || !profile.value?.canManage || profile.value.constructionEnterprise?.isLocked || !constructionDefinition.value) return;
  const expectedProjectId = props.projectId;
  const expectedGeneration = projectGeneration;
  const values = { ...constructionDraft.value.values };
  savingConstruction.value = true;
  constructionErrors.value = [];
  message.value = "";
  try {
    const definition = await loadConstructionDefinition(expectedProjectId);
    if (!ownsProject(expectedProjectId, expectedGeneration)) return;
    constructionDefinition.value = definition;
    const validation = await validateBusinessEntryDraft({ scope: "project", projectId: expectedProjectId }, {
      sceneKey: definition.key, definitionVersion: definition.version,
      target: { entityType: "project", entityId: expectedProjectId }, values
    }, "edit");
    if (!ownsProject(expectedProjectId, expectedGeneration)) return;
    constructionErrors.value = validation.errors;
    if (!validation.valid) return;
    const { businessPartyVersionId, effectiveFrom, changeReason } = validation.values;
    if (typeof businessPartyVersionId !== "string" || typeof effectiveFrom !== "string" || typeof changeReason !== "string") throw new Error("请检查施工企业填写内容");
    await assignProjectConstructionEnterprise(expectedProjectId, { businessPartyVersionId, effectiveFrom: `${effectiveFrom}T00:00:00.000Z`, changeReason });
    if (!ownsProject(expectedProjectId, expectedGeneration)) return;
    await load();
    if (ownsProject(expectedProjectId, expectedGeneration)) ok("施工企业已保存");
  } catch (error) { if (ownsProject(expectedProjectId, expectedGeneration)) fail(error); }
  finally { if (ownsProject(expectedProjectId, expectedGeneration)) savingConstruction.value = false; }
}
watch(() => props.projectId, () => { projectGeneration += 1; resetProjectForms(); load(); }); onMounted(load);
</script>

<style scoped>.profile-panel{display:flex;width:100%;padding-top:var(--jg-space-md)}.construction-form{display:grid;gap:var(--jg-space-sm);margin-top:var(--jg-space-md)}.inline-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end;gap:var(--jg-space-sm);margin-top:var(--jg-space-md)}@container jg-page (max-width:840px){.inline-form{grid-template-columns:1fr}}</style>
