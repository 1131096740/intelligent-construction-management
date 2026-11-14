'use strict';
/** Composition of fixed tool adapters only. No resource/runtime authority is
 * created here, and an early failure never enters any following stage. */
async function runOfficialQualificationActions(ports) {
 const names=['negative','java','inspectJava','office','inspectOffice','normalize','inspectNormalized'];
 if(!ports||Object.keys(ports).sort().join(',')!==names.slice().sort().join(',')||names.some(name=>typeof ports[name]!=='function'))throw new Error('TASK12_OFFICIAL_QUALIFICATION_ACTIONS');
 const negative=await ports.negative();
 const java=await ports.java();
 const javaPhysical=await ports.inspectJava(java);
 const office=await ports.office();
 const officePhysical=await ports.inspectOffice(office);
 const normalized=await ports.normalize(java,office);
 const normalizedPhysical=await ports.inspectNormalized(normalized,javaPhysical,officePhysical);
 return {status:'MACHINE_QUALIFICATION_PASSED_PHYSICAL_REVIEW_PENDING',runtimeAuthority:false,
  negative,java,javaPhysical,office,officePhysical,normalized,normalizedPhysical};
}
module.exports=Object.freeze({runOfficialQualificationActions});
