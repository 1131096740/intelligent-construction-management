"use strict";

const { createHash } = require("node:crypto");

// Fixed synthetic adapter for the real staged readback seam. Models psql -At
// one ASCII line per row, including its terminal LF.
function frameStage205(row) {
  const bytes = Buffer.from(JSON.stringify(row));
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    lines.push((lines.length + 1) + "|" + bytes.subarray(offset, offset + 24576).toString("base64"));
  }
  return ["JG-PFQ205/1|" + lines.length + "|" + bytes.length + "|" + createHash("sha256").update(bytes).digest("hex"),
    ...lines, ""].join("\n");
}
module.exports = { frameStage205 };
