"use strict";

const OPERATIONAL_WRITE_MODULES = Object.freeze([
  "account", "approval", "contract", "expense", "files", "finance",
  "master_data", "operations", "organization", "payment", "procurement",
  "project", "settlement"
]);

function isOperationalWriteFrozen(environment, module) {
  const mode = environment.OPERATIONAL_WRITE_FREEZE_MODE?.trim() || "off";
  const modules = environment.OPERATIONAL_WRITE_FREEZE_MODULES?.trim() ?? "";
  const values = modules === "" ? [] : modules.split(",");
  if (
    !["off", "all", "modules"].includes(mode) ||
    values.some(value => value.trim() !== value || value === "") ||
    new Set(values).size !== values.length ||
    values.some(value => !OPERATIONAL_WRITE_MODULES.includes(value)) ||
    (mode === "modules" ? values.length === 0 : values.length > 0)
  ) {
    throw new Error("OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID");
  }
  return mode === "all" || (mode === "modules" && values.includes(module));
}

module.exports = { OPERATIONAL_WRITE_MODULES, isOperationalWriteFrozen };
