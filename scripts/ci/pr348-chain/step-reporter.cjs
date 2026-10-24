"use strict";
const fs=require("node:fs"),path=require("node:path");
const context=require("./context.json");
const ROSTER=Object.freeze({6:"page.goto",7:"locator.fill",8:"locator.fill",9:"locator.click",10:"expect.not.toHaveURL",11:"page.goto",12:"locator.click",13:"locator.click",14:"expect.toBeVisible",15:"locator.click",17:"locator.click",18:"locator.click",19:"locator.fill",20:"locator.click",21:"locator.fill",23:"locator.click",24:"expect.toHaveCount",26:"expect.toHaveCount",27:"locator.click",28:"locator.fill",29:"locator.click",30:"locator.fill",31:"locator.click",32:"expect.toHaveCount",33:"expect.toHaveCount"});
const CATEGORIES=new Set(["pw:api","expect","hook","fixture","test.step","test.attach"]);
const time=value=>{const number=new Date(value).getTime();return Number.isFinite(number)?number:null;};
function project(test){try{const name=test.parent.project().name;return["desktop","mobile"].includes(name)?name:"unknown";}catch{return"unknown";}}
function source(step){const location=step.location,line=Number.isSafeInteger(location?.line)?location.line:null;
 if(location?.file===path.join(context.source,"apps/web-admin/e2e/project-roster-real.e2e.ts"))return{source:"roster",sourceLine:line,apiName:ROSTER[line]||"other"};
 if(location?.file===path.join(context.source,"apps/web-admin/e2e/helpers/responsive-assertions.ts"))return{source:"responsive-helper",sourceLine:line,apiName:"other"};
 return{source:null,sourceLine:null,apiName:"other"};}
function emit(state,event){try{if(state.attempted>=2000){state.dropped++;return;}state.attempted++;fs.appendFileSync(path.join(context.events,state.project+"-steps.jsonl"),JSON.stringify({schemaVersion:1,project:state.project,...event})+"\n",{mode:0o600});state.rows++;}catch{state.writeFailures++;}}
module.exports=class NativeRosterSteps {
 constructor(){this.tests=new WeakMap();this.steps=new WeakMap();}
 onTestBegin(test,result){const state={project:project(test),start:time(result.startTime),attempted:0,rows:0,dropped:0,writeFailures:0};this.tests.set(test,state);emit(state,{event:"testBegin",testStartEpochMs:state.start});}
 onStepBegin(test,_result,step){const state=this.tests.get(test);if(!state)return;const start=time(step.startTime),observed={...source(step),category:CATEGORIES.has(step.category)?step.category:"other",stepStartWallRelativeMs:start!==null&&state.start!==null?start-state.start:null};this.steps.set(step,observed);emit(state,{event:"stepBegin",...observed,error:false});}
 onStepEnd(test,_result,step){const state=this.tests.get(test),observed=this.steps.get(step);if(!state||!observed)return;emit(state,{event:"stepEnd",...observed,stepDurationWallMs:Number.isFinite(step.duration)?step.duration:null,error:Boolean(step.error)});}
 onTestEnd(test,result){const state=this.tests.get(test);if(!state)return;emit(state,{event:"testEnd",testStatus:["passed","failed","timedOut","skipped","interrupted"].includes(result.status)?result.status:"unknown",reportedTestDurationMs:Number.isFinite(result.duration)?result.duration:null,error:result.status!=="passed"});try{fs.appendFileSync(path.join(context.events,state.project+"-steps.jsonl"),JSON.stringify({schemaVersion:1,project:state.project,event:"observerSummary",rowLimit:2000,rowsAttempted:state.attempted,rowsWritten:state.rows,rowsDropped:state.dropped,writeFailures:state.writeFailures,overflow:state.dropped>0})+"\n",{mode:0o600});}catch{}}
};
