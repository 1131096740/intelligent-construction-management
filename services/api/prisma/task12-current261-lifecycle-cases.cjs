'use strict';
const {isProxy}=require('node:util').types;
// Closed source descriptions. A case selector grants no runtime or SQL authority.
const types=Object.freeze(['material_purchase','equipment_rental','labor_subcontract','professional_subcontract','other']);
const relationships=Object.freeze(['inside','outside','upward']);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const duty=(source,...roleKeys)=>({source,roleKeys});
const cases=freeze(relationships.flatMap(relationship=>types.map(contractTypeKey=>({
 key:relationship+':'+contractTypeKey,relationship,contractTypeKey,
 parallelRouteKey:contractTypeKey==='other'?'generic_contract':contractTypeKey,
 billAlias:({material_purchase:'materials',equipment_rental:'equipmentRentals',labor_subcontract:'laborItems',professional_subcontract:'subcontractItems',other:null})[contractTypeKey],
 approvalDuties:[contractTypeKey==='labor_subcontract'||contractTypeKey==='professional_subcontract'?duty('unique_project','engineering_director'):duty('global',contractTypeKey==='other'?'comprehensive_director':'material_director'),
  duty('global','contract_director'),duty('project','project_manager'),duty('global','finance_director'),duty('global','chairman','general_manager')],
 operating:false,storage:'LOCAL_ONLY',executionAllowed:false,nativeAdmission:false,full394Accepted:false
}))));
function current261LifecycleCase(key){
 if(arguments.length!==1||typeof key!=='string')throw Error('CURRENT261_LIFECYCLE_CASE_UNKNOWN');
 const selected=cases.find(row=>row.key===key);if(!selected)throw Error('CURRENT261_LIFECYCLE_CASE_UNKNOWN');return selected;
}
function current261LifecycleCases(){if(arguments.length!==0)throw Error('CURRENT261_LIFECYCLE_CASE_ARGUMENTS');return cases;}
// Closed descriptor reads only. A description is never an admission token.
function current261LifecycleCaseFromFixture(fixture){
 const reject=()=>{throw Error('CURRENT261_LIFECYCLE_CASE_DESCRIPTION');};
 const data=(value,key)=>{
  if(!value||typeof value!=='object'||isProxy(value))return reject();
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))return reject();
  return descriptor.value;
 };
 const keys=(value,names)=>{
  if(!value||typeof value!=='object'||isProxy(value))return reject();
  const actual=Reflect.ownKeys(value);
  if(actual.length!==names.length||!names.every(key=>actual.includes(key)))return reject();
 };
 const array=(value,length)=>{
  if(!value||isProxy(value)||!Array.isArray(value))return reject();
  const names=['length',...Array.from({length},(_,i)=>String(i))];keys(value,names);
  if(data(value,'length')!==length)return reject();
 };
 if(arguments.length!==1||!fixture||typeof fixture!=='object'||isProxy(fixture))return reject();
 const descriptor=Object.getOwnPropertyDescriptor(fixture,'case');
 if(!descriptor)return current261LifecycleCase('inside:material_purchase');
 if(!Object.hasOwn(descriptor,'value'))return reject();
 const value=descriptor.value,key=data(value,'key'),selected=current261LifecycleCase(key);
 const primitive=['key','relationship','contractTypeKey','parallelRouteKey','billAlias','operating','storage','executionAllowed','nativeAdmission','full394Accepted'];
 keys(value,[...primitive,'approvalDuties']);
 for(const name of primitive)if(data(value,name)!==selected[name])return reject();
 const duties=data(value,'approvalDuties');array(duties,selected.approvalDuties.length);
 for(let i=0;i<selected.approvalDuties.length;i++){
  const actual=data(duties,String(i)),expected=selected.approvalDuties[i];keys(actual,['source','roleKeys']);
  if(data(actual,'source')!==expected.source)return reject();
  const roles=data(actual,'roleKeys');array(roles,expected.roleKeys.length);
  for(let j=0;j<expected.roleKeys.length;j++)if(data(roles,String(j))!==expected.roleKeys[j])return reject();
 }
 return selected;
}
module.exports=Object.freeze({current261LifecycleCase,current261LifecycleCases,current261LifecycleCaseFromFixture});
