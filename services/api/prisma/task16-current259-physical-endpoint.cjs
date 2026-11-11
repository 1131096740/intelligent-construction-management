"use strict";
// Pure projection only. Authority comes from the original producer's fresh
// inspectOwned call; caller supplied metadata cannot claim an owned handle.
const {isIP}=require('node:net');
const {types}=require('node:util');
const invalid=()=>{throw Object.assign(new Error('CURRENT259_PHYSICAL_ENDPOINT_INVALID'),{code:'CURRENT259_PHYSICAL_ENDPOINT_INVALID'});};
const need=ok=>{if(!ok)invalid();};
function own(value,key){
 need(value&&typeof value==='object'&&!types.isProxy(value));
 const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'));return d.value;
}
function projectCurrent259PhysicalEndpoint(state,expected){
 need(arguments.length===2);
 const containerId=own(expected,'containerId'),networkId=own(expected,'networkId'),databaseName=own(expected,'databaseName'),publishedPort=own(expected,'publishedPort');
 need(/^[a-f0-9]{64}$/u.test(containerId)&&/^[a-f0-9]{64}$/u.test(networkId)&&/^jg_task01_[a-f0-9]{32}$/u.test(databaseName)&&Number.isInteger(publishedPort)&&publishedPort>1024&&publishedPort<=65535);
 need(own(state,'Id')===containerId&&own(own(state,'State'),'Running')===true);
 const settings=own(state,'NetworkSettings'),ports=own(settings,'Ports'),networks=own(settings,'Networks');
 need(!types.isProxy(ports)&&!types.isProxy(networks)&&Reflect.ownKeys(ports).length===1&&Reflect.ownKeys(networks).length===1);
 const published=own(ports,'5432/tcp');need(Array.isArray(published)&&!types.isProxy(published)&&published.length===1);
 const binding=own(published,'0');need(own(binding,'HostIp')==='127.0.0.1'&&own(binding,'HostPort')===String(publishedPort));
 const network=own(networks,Reflect.ownKeys(networks)[0]),serverAddress=own(network,'IPAddress');
 need(own(network,'NetworkID')===networkId&&own(network,'GlobalIPv6Address')==='');
 need(typeof serverAddress==='string'&&isIP(serverAddress)===4);
 const [a,b]=serverAddress.split('.').map(Number);need(a===10||a===172&&b>=16&&b<=31||a===192&&b===168);
 return Object.freeze({containerId,networkId,databaseName,publishedHost:'127.0.0.1',publishedPort,serverAddress,serverPort:5432});
}
module.exports=Object.freeze({projectCurrent259PhysicalEndpoint});
