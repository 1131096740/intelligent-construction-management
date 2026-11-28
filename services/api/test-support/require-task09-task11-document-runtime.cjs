const { existsSync } = require("node:fs");

const required = [
  "CONTRACT_DOCX4J_RUNTIME_MANIFEST",
  "TASK09_PDF_FONT_DIR",
  "TEMPLATE_PDF_INSPECTOR_PYTHON",
  "TEMPLATE_PDF_RUNTIME_MANIFEST"
];
const unavailable = required.filter(key => !process.env[key] || !existsSync(process.env[key]));
if (!process.env.TEMPLATE_PDF_RUNTIME_MODE) unavailable.push("TEMPLATE_PDF_RUNTIME_MODE");
if (unavailable.length) {
  throw new Error(`Task09/11 actual document acceptance requires qualified runtime settings: ${unavailable.join(", ")}`);
}
