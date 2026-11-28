'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runLedgerLossFlow}=require('./task16-ledger-loss-flow.cjs');
function fixture(failure){const calls=[];const step=name=>async()=>{calls.push(name);if(name===failure)throw Error(name);};return {calls,input:{lose:async()=>{calls.push('lose');return {faultState:'dropped',upstreamStatusCode:201};},observeCommitted:step('observe'),readOriginal:step('result'),authorizeReplay:step('authorize'),replay:step('replay'),observeReplay:step('verify')}};}
test('only authorizes replay after committed graph and original result pass',async()=>{const f=fixture();await runLedgerLossFlow(f.input);assert.deepEqual(f.calls,['lose','observe','result','authorize','replay','verify']);});
for(const failure of ['observe','result','authorize'])test(`never replays when ${failure} fails`,async()=>{const f=fixture(failure);await assert.rejects(runLedgerLossFlow(f.input));assert.ok(!f.calls.includes('replay'));});
test('unknown upstream never opens replay',async()=>{const f=fixture();f.input.lose=async()=>({faultState:'dropped',upstreamStatusCode:500});await assert.rejects(runLedgerLossFlow(f.input));assert.deepEqual(f.calls,[]);});
