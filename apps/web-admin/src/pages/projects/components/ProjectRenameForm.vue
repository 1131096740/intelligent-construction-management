<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { fetchBusinessEntryDefinition, validateBusinessEntryDraft } from "../../../api/business-entry.api";
import { formatUnknownApiError } from "../../../api/error-message";

const props = defineProps<{ projectId: string; name: string; saving: boolean }>();
const emit = defineEmits<{ save: [name: string] }>();
const definition = shallowRef<BusinessEntrySceneDefinition | null>(null);
const draft = ref<BusinessEntryDraftPayload>({ sceneKey: "project_rename", values: { name: props.name } });
const errors = ref<Array<{ fieldKey?: string; message: string }>>([]);
const message = ref("");
const busy = ref(false);
let active = true;
const target = { entityType: "project", entityId: props.projectId };
const scope = { scope: "project" as const, projectId: props.projectId };
onBeforeUnmount(() => { active = false; });

async function loadDefinition() {
  const current = await fetchBusinessEntryDefinition("project_rename", scope, target, "edit");
  if (active) definition.value = current;
  return current;
}
onMounted(async () => {
  try { await loadDefinition(); }
  catch (error) { if (active) message.value = formatUnknownApiError(error, "加载项目名称填写规则失败"); }
});

async function submit() {
  if (busy.value || props.saving || !definition.value) return;
  const projectId = props.projectId;
  busy.value = true;
  message.value = "";
  errors.value = [];
  const values = { ...draft.value.values };
  try {
    const current = await fetchBusinessEntryDefinition(
      "project_rename",
      { scope: "project", projectId },
      { entityType: "project", entityId: projectId },
      "edit"
    );
    if (!active) return;
    if (current.key !== "project_rename") throw new Error("项目名称填写规则已变化，请刷新后重试");
    definition.value = current;
    const validation = await validateBusinessEntryDraft({ scope: "project", projectId }, {
      sceneKey: current.key,
      definitionVersion: current.version,
      target: { entityType: "project", entityId: projectId },
      values
    }, "edit");
    if (!active) return;
    errors.value = validation.errors;
    if (validation.valid && typeof validation.values.name === "string") emit("save", validation.values.name);
  } catch (error) {
    if (active) message.value = formatUnknownApiError(error, "项目名称预检失败，请稍后重试");
  } finally { if (active) busy.value = false; }
}
</script>

<template>
  <div class="project-name-form">
    <BusinessEntryForm
      v-if="definition"
      v-model="draft"
      :definition="definition"
      :errors="errors"
      :readonly="busy || saving"
    />
    <p
      v-if="message"
      role="alert"
    >
      {{ message }}
    </p>
    <t-button
      :disabled="!definition || busy || saving"
      @click="submit"
    >
      {{ busy || saving ? "保存中" : "保存名称" }}
    </t-button>
  </div>
</template>
