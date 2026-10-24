"use strict";
const crypto = require("node:crypto");
const emit = (phase, route = "unknown") => `(globalThis as any).__jgPr348Emit?.(${JSON.stringify(phase)}, ${JSON.stringify(route)});`;
const scoped = phase => `(globalThis as any).__jgPr348Emit?.(${JSON.stringify(phase)}, ["/organization/project-roster/options", "/organization/project-roster/preview", "/organization/project-roster/apply"].includes(path) ? path.split("/").pop() : "unknown");`;
const PINS = Object.freeze({
  "src/pages/projects/components/ProjectRosterChangeDrawer.vue": "2555eac16e57bf5277c8f988b5d1858898fe8168",
  "src/pages/projects/ProjectRosterPage.vue": "80a415e9d5538cc7266c488e86cde3d2a3214109",
  "src/api/organization.api.ts": "5f3fc6e74334f624b97801321edcf622dc52259a",
  "src/api/http.ts": "eb499784a66b9dcc9265ad717e335d1a7b270f28"
});
function blob(text) { const bytes = Buffer.from(text); return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"); }
function transformOriginal(relative, original) {
  if (!Object.hasOwn(PINS, relative) || blob(original) !== PINS[relative]) throw new Error("fixed historical Git blob mismatch");
  let code = original;
  const edits = [];
  const replace = (before, after) => {
    if (code.split(before).length !== 2) throw new Error("fixed observer seam is not unique");
    code = code.replace(before, after); edits.push({ before, after });
  };
  if (relative.endsWith("ProjectRosterChangeDrawer.vue")) {
    replace("async function submitChange() {\n", "async function submitChange() {\n  " + emit("submit-enter") + "\n");
    replace("  const { operation, projectId, userId, reason, snapshotHash } = preview.value;", "  " + emit("submit-guard-passed") + "\n  const { operation, projectId, userId, reason, snapshotHash } = preview.value;");
    const awaitApply = "    await applyWithCapability({ operation, projectId, userId, reason, snapshotHash, confirmationPassword: password.value });";
    replace(awaitApply, "    " + emit("submit-await-apply-before", "apply") + "\n" + awaitApply + "\n    " + emit("submit-await-apply-resolved", "apply"));
    replace('    emit("saved");', '    ' + emit("saved-emit-before") + '\n    emit("saved");\n    ' + emit("saved-emit-returned"));
    replace('  } catch (error) {\n    message.value = formatUnknownApiError(error, "保存人员调整失败");', '  } catch (error) {\n    ' + emit("submit-catch") + '\n    message.value = formatUnknownApiError(error, "保存人员调整失败");');
    replace('  } finally { password.value = ""; busy.value = false; }', '  } finally { ' + emit("submit-finally") + ' password.value = ""; busy.value = false; }');
    const capability = 'async function applyWithCapability(input: Parameters<typeof applyProjectRosterChange>[0]) {\n  const capability = await fetchProjectRosterManagementOptions();\n  const operationAllowed = capability.canManageRoster;\n  if (!operationAllowed) throw new Error("当前账号不能调整项目人员");\n  return applyProjectRosterChange(input);\n}';
    replace(capability, capability.replace("  const capability =", "  " + emit("apply-options-before", "options") + "\n  const capability =").replace("  const operationAllowed =", "  " + emit("apply-options-resolved", "options") + "\n  const operationAllowed =").replace("  return applyProjectRosterChange(input);", "  " + emit("apply-post-call", "apply") + "\n  return applyProjectRosterChange(input);"));
  } else if (relative.endsWith("ProjectRosterPage.vue")) {
    const before = "async function onSaved() { drawerVisible.value = false; await loadRoster(); }";
    replace(before, "async function onSaved() { " + emit("parent-saved-enter") + " drawerVisible.value = false; " + emit("parent-visible-false") + " await loadRoster(); " + emit("parent-reload-resolved") + " }");
  } else if (relative.endsWith("organization.api.ts")) {
    const read = '  const response = await apiFetch(path, { method: "GET" });\n  await ensureOk(response, fallback);\n  return response.json() as Promise<T>;';
    replace(read, "  " + scoped("read-fetch-before") + "\n" + read.replace("  await ensureOk", "  " + scoped("read-fetch-headers") + "\n  await ensureOk").replace("  return response.json()", "  " + scoped("read-ensure-ok") + "\n  " + scoped("read-json-call") + "\n  return response.json()"));
    const send = '  const response = await apiFetch(path, {\n    method,\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(body)\n  });\n  await ensureOk(response, fallback);\n  return response.json() as Promise<T>;';
    replace(send, "  " + scoped("send-fetch-before") + "\n" + send.replace("  await ensureOk", "  " + scoped("send-fetch-headers") + "\n  await ensureOk").replace("  return response.json()", "  " + scoped("send-ensure-ok") + "\n  " + scoped("send-json-call") + "\n  return response.json()"));
  } else {
    const send = '        return await (fetchImpl ?? fetch)(`/api${path}`, withAuth(requestInit, token));';
    replace(send, "        " + scoped("fetch-before") + '\n        const observerResponse = await (fetchImpl ?? fetch)(`/api${path}`, withAuth(requestInit, token));\n        ' + scoped("fetch-headers") + '\n        return observerResponse;');
    replace("          return await parseJson();", "          " + scoped("json-before") + "\n          const observerParsed = await parseJson();\n          " + scoped("json-resolved") + "\n          return observerParsed;");
    replace("          bridge.onRequestFailure?.(path, error);", "          " + scoped("json-rejected") + "\n          bridge.onRequestFailure?.(path, error);");
    replace('      } catch (error) {\n        const failure = new Error(formatUnknownApiError(error, "网络请求失败"));', '      } catch (error) {\n        ' + scoped("fetch-rejected") + '\n        const failure = new Error(formatUnknownApiError(error, "网络请求失败"));');
  }
  let inverse = code;
  for (const { before, after } of edits.slice().reverse()) {
    if (inverse.split(after).length !== 2) throw new Error("observer inverse is not unique");
    inverse = inverse.replace(after, before);
  }
  if (inverse !== original) throw new Error("observer inverse changed historical bytes");
  return { code, edits: edits.length, originalBlob: blob(original), restoredBlob: blob(inverse) };
}
module.exports = { transformOriginal, PINS, blob };
