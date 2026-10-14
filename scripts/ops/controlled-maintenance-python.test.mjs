import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const file of ['controlled-maintenance-window.test.py','controlled-database-hold.test.py','controlled-launch-preflight.test.py','controlled-task-wiring.test.py','controlled-cos-preflight.test.py']) test(file,()=>{
  const r=spawnSync('python3',['-B',fileURLToPath(new URL(file,import.meta.url))],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000});
  assert.equal(r.status,0,r.stderr);
});
