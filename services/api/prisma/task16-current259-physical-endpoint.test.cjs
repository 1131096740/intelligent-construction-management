"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectCurrent259PhysicalEndpoint}=require('./task16-current259-physical-endpoint.cjs');
const expected=Object.freeze({containerId:'a'.repeat(64),networkId:'b'.repeat(64),databaseName:'jg_task01_12345678123442348234123456789012',publishedPort:32456});
function observed(){return {Id:expected.containerId,State:{Running:true},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'32456'}]},Networks:{isolated:{NetworkID:expected.networkId,IPAddress:'172.29.0.2',GlobalIPv6Address:''}}}};}
test('an inspected single owned bridge yields its private server address and exact loopback publication',()=>{
 const result=projectCurrent259PhysicalEndpoint(observed(),expected);
 assert.deepEqual(result,{containerId:expected.containerId,networkId:expected.networkId,databaseName:expected.databaseName,publishedHost:'127.0.0.1',publishedPort:32456,serverAddress:'172.29.0.2',serverPort:5432});
 assert.equal(Object.isFrozen(result),true);
});

for(const [name,mutate] of [
 ['foreign container',s=>s.Id='c'.repeat(64)],
 ['stopped container',s=>s.State.Running=false],
 ['foreign network',s=>s.NetworkSettings.Networks.isolated.NetworkID='c'.repeat(64)],
 ['extra network',s=>s.NetworkSettings.Networks.other={...s.NetworkSettings.Networks.isolated}],
 ['wildcard publish',s=>s.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0'],
 ['different host port',s=>s.NetworkSettings.Ports['5432/tcp'][0].HostPort='32457'],
 ['extra publish',s=>s.NetworkSettings.Ports['5433/tcp']=[]],
 ['public server',s=>s.NetworkSettings.Networks.isolated.IPAddress='8.8.8.8'],
 ['loopback server',s=>s.NetworkSettings.Networks.isolated.IPAddress='127.0.0.1'],
 ['CIDR server',s=>s.NetworkSettings.Networks.isolated.IPAddress='172.29.0.2/32'],
 ['IPv6 server',s=>s.NetworkSettings.Networks.isolated.IPAddress='::1'],
 ['extra IPv6',s=>s.NetworkSettings.Networks.isolated.GlobalIPv6Address='fd00::2'],
])test(`physical endpoint rejects ${name}`,()=>{const state=observed();mutate(state);assert.throws(()=>projectCurrent259PhysicalEndpoint(state,expected),/CURRENT259_PHYSICAL_ENDPOINT_INVALID/u);});
test('physical projection refuses an accessor before evaluating untrusted endpoint metadata',()=>{
 const state=observed();let reads=0;
 Object.defineProperty(state.NetworkSettings.Networks.isolated,'IPAddress',{get(){reads++;return '172.29.0.2';}});
 assert.throws(()=>projectCurrent259PhysicalEndpoint(state,expected),/CURRENT259_PHYSICAL_ENDPOINT_INVALID/u);
 assert.equal(reads,0);
});
