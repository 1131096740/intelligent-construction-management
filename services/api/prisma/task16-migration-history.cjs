"use strict";

const {createHash}=require("node:crypto");

// Ordered [path, SHA256, Git mode] rows from the 204 migrations and lock in
// ef8a55454ebb115fe0eac9979acbfd56facb77fe. Candidate metadata is not authority.
const TRUSTED_HISTORY_SHA256="db017c06bff3d0e7ca7aa88022f83cb53f726eaf49f445966cc0cd68ecae88bd";

function matchesTrustedTask16History(rows){
 return rows.length===205
  &&createHash("sha256").update(JSON.stringify(rows)).digest("hex")===TRUSTED_HISTORY_SHA256;
}

module.exports={matchesTrustedTask16History};
