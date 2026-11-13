'use strict';
// Closed installed-tool identities. Callers select a reviewed profile, never hashes.
const PROFILE='TASK12_OFFICIAL_TEMURIN17_0_17_10_V1';
const profiles=Object.freeze({
 [PROFILE]:Object.freeze({profile:PROFILE,lockName:'runtime-lock-material-body25-v4-temurin17-official-v1.json',lockSha256:'cfdb0f202e91294db06aa8643be7955be6760a37b97d90c6baf9c261c76f0c45',nativeSha256:'0602181a6c26c8e46aa166db18412cef1b31b6d95eb9d7033ffc4cc0ce2e66f2',fontToolsFiles:676,fontToolsSha256:'263ec27ba75f927b8e65c12f6697a7edb5ae930a34244ddda367119a5c0d7b1f'}),
 TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2:Object.freeze({profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2',lockName:'runtime-lock-material-body25-v4-temurin17-official-v2.json',lockSha256:'0a2dc0cd644f3a2cbc090daa3377005cf542bdf58c368f97e50417d70930c58f',nativeSha256:'1c1576937c83095ab0475f8e448fec3a4e26b636baaa2466d04b2fe8c6d6cf93',fontToolsFiles:345,fontToolsSha256:'976f4bacadeab9c40dcefd8ff6fba618be405b19f41c03cf0e080a8a15d591a5'})
});
const officialDocumentProfile=profile=>typeof profile==='string'&&Object.hasOwn(profiles,profile)?profiles[profile]:undefined;
module.exports=Object.freeze({PROFILE,officialDocumentProfile});
