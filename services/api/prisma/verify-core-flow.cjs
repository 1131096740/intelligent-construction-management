const { coreFlowApiVerificationTargets } = require("../dist/database/core-flow-api-verification");

const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";

async function verifyTarget(target) {
  const url = `${baseUrl}${target.path}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${target.path} returned HTTP ${response.status}`);
  }

  const body = await response.text();
  const missing = target.requiredText.filter((text) => !body.includes(text));

  if (missing.length > 0) {
    throw new Error(`${target.path} missing required text: ${missing.join(", ")}`);
  }

  console.log(`ok ${target.path}`);
}

async function main() {
  for (const target of coreFlowApiVerificationTargets) {
    await verifyTarget(target);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
