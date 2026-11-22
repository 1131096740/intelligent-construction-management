'use strict';
const old=require('./technical-relations.json');
const forward=require('./forward-320-inventory.json');

function profile(count,businessCount,added,extra){
  const emptyBindings=Object.freeze([...old.emptyBindings,...extra]);
  const technical=Object.freeze([old.key,old.operatingVerifier,old.operatingContext,...emptyBindings]);
  return Object.freeze({count,businessCount,emptyBindings,technical,
    addedBusiness:Object.freeze(added),sqlnames:technical.map(name=>"'"+name+"'").join(',')});
}
const legacy=profile(295,356,[],[]);
const successor=profile(320,forward.businessTables,forward.businessAdditions.map(([,name])=>name),
  forward.ownerSchemaOnlyEmptyAdditions.map(([,name])=>name));

module.exports={legacy,successor};
