"use strict";
// Static source/data inspector only. Never import or evaluate a Prisma SDK.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const fault=()=>{throw Object.assign(new Error('TASK16_RUNTIME_SDK_SCHEMA'),{code:'TASK16_RUNTIME_SDK_SCHEMA'});};
const need=value=>{if(!value)fault();};
const GENERATED=['default.d.ts','default.js','edge.d.ts','edge.js','index-browser.js','index.d.ts','index.js','package.json','schema.prisma','wasm.d.ts','wasm.js'];
const TOOL_SHA='3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675';
function tokens(text){
 const out=[];let i=0;
 while(i<text.length){const c=text[i];if(/\s/u.test(c)){i++;continue;}const start=i;let kind;
  if(text.startsWith('//',i)){const end=text.indexOf('\n',i);i=end<0?text.length:end;kind='comment';}
  else if(text.startsWith('/*',i)){const end=text.indexOf('*/',i+2);need(end>=0);i=end+2;kind='comment';}
  else if(c==='"'){i++;let closed=false;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"'){closed=true;break;}}need(closed);kind='string';}
  else if(/[A-Za-z0-9_]/u.test(c)){i++;while(i<text.length&&/[A-Za-z0-9_]/u.test(text[i]))i++;kind='word';}
  else{i++;kind='punctuation';}out.push([kind,text.slice(start,i)]);
 }return out;
}
function schemaBridge(source,generated,expected){
 if(hash(source)===hash(generated)){need(expected.rawSchemaEqual===true);return 'EXACT_RAW_SCHEMA';}
 const b=expected.acceptedFormattingBridge;
 need(expected.rawSchemaEqual===false&&b?.kind==='exact-four-model-bound-relocations'&&hash(source)===b.sourceSchemaSha256&&hash(generated)===b.generatedSchemaSha256);
 // One reviewed complete Schema204 pair; no generic formatting exceptions.
 need(b.sourceSchemaSha256==='3f41995f48430e7adfeefb8ec605203d8ce501bb7214c66619a9142bfcf7a3f1'&&b.generatedSchemaSha256==='b1680aab44e174477ae5394e0dd7d629f8f4331dd4fd2533575e8f36cfc73552');
 const fixed=[
  ['ExpenseClaim','@@index([generalProcurementId])',25340,25491],
  ['ContractArchiveFile','// V2-only uniqueness and Version/R/T composite FKs live in migration 204.',16502,16492],
  ['ContractArchiveEvidenceFile','// Composite parent/version and private-file FKs live in migration 204.',16560,16542],
  ['ContractSealTask','@@unique([id,contractVersionId,approvalInstanceId])',16874,16854]
 ];
 let x=tokens(source),y=tokens(generated);
 need(x.length===35529&&y.length===35529&&b.sourceTokens===35529&&b.generatedTokens===35529&&hash(JSON.stringify(x))===b.sourceTokensSha256&&hash(JSON.stringify(y))===b.generatedTokensSha256&&Array.isArray(b.relocations)&&b.relocations.length===fixed.length);
 const trim=(items,model,needle,at)=>{
  const hits=[];for(let i=0;i<=items.length-needle.length;i++)if(JSON.stringify(items.slice(i,i+needle.length))===JSON.stringify(needle))hits.push(i);
  need(hits.length===1&&hits[0]===at);let owner;for(let i=0;i<at;i++)if(items[i][0]==='word'&&items[i][1]==='model')owner=items[i+1]?.[1];
  need(owner===model);return items.slice(0,at).concat(items.slice(at+needle.length));
 };
 for(let i=0;i<fixed.length;i++){
  const [model,text,sourceAt,generatedAt]=fixed[i],needle=tokens(text),proof=b.relocations[i];
  need(proof.model===model&&JSON.stringify(proof.exactTokenSequence)===JSON.stringify(needle)&&proof.sourceIndexAfterPriorRemovals===sourceAt&&proof.generatedIndexAfterPriorRemovals===generatedAt&&proof.uniqueInBoth===true);
  x=trim(x,model,needle,sourceAt);y=trim(y,model,needle,generatedAt);
 }
 need(x.length===35507&&y.length===35507&&b.remainingTokenCount===35507&&b.remainingTokensSha256==='918a2e3c6653a8879f729f3009531fbfa09ab9bfc15688d173336965977d6ed9'&&JSON.stringify(x)===JSON.stringify(y)&&hash(JSON.stringify(x))===b.remainingTokensSha256);
 return 'EXACT_REVIEWED_FOUR_MODEL_RELOCATIONS';
}
function inspectTask16SdkSource(root,entry){
 try{
  need(typeof root==='string'&&fs.realpathSync(root)===root&&typeof entry==='string'&&entry.startsWith(root+path.sep)&&/\/node_modules\/@prisma\/client\/(?:index|default)\.js$/u.test(entry));
  const captures=[];
  const capture=(file,collect=true)=>{need(file.startsWith(root+path.sep));const row=read(file,{maxBytes:64*1024*1024,collect,code:'TASK16_RUNTIME_SDK_SCHEMA'});captures.push({path:file,sha256:row.sha256,identity:row.identity});return row;};
  const expected=JSON.parse(capture(path.join(root,'services/api/prisma/task16-sdk-schema-proof.json')).bytes.toString('utf8'));
  need(expected.schemaVersion===1&&expected.purpose==='task16-reviewed-schema-content-binding-types-and-source-only-not-native-approval'&&expected.copyEngine===false&&expected.nativeRuntimeQualification===false);
  const generatedRoot=path.resolve(path.dirname(entry),'../../.prisma/client');
  const pkg=capture(entry),source=capture(path.join(root,'services/api/prisma/schema.prisma')),schema=capture(path.join(generatedRoot,'schema.prisma')),index=capture(path.join(generatedRoot,'index.js'));
  need(source.sha256===expected.sourceSchemaSha256&&schema.sha256===expected.generatedSchemaSha256);
  const bridge=schemaBridge(source.bytes.toString('utf8'),schema.bytes.toString('utf8'),expected);
  // The compiler is the pinned existing AST tool, not the input SDK or its code.
  const compiler=fs.realpathSync(path.join(__dirname,'../node_modules/typescript/lib/typescript.js'));
  const before=read(compiler,{maxBytes:64*1024*1024,code:'TASK16_RUNTIME_SDK_SCHEMA'});need(before.sha256===TOOL_SHA);
  const ts=require(compiler);need(ts.version==='5.9.3');
  const ast=ts.createSourceFile('qualified-sdk-index.js',index.bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);need(ast.parseDiagnostics.length===0);
  // The reviewed generated entry is admitted only by its complete source SHA.
  // All other supported entries are inert, finite data fixtures: no arbitrary
  // reads, aliases, nested writes, callbacks or reflective effects are allowed.
  const reviewedIndex=expected.generatedMembers.find(row=>row.file==='index.js');
  need(reviewedIndex&&typeof reviewedIndex.sha256==='string');
  const reviewedIndexSource=index.sha256===reviewedIndex.sha256;
  if(!reviewedIndexSource){
   const statements=ast.statements;need(statements.length===2||statements.length===3);
   const declaration=statements[0];need(ts.isVariableStatement(declaration)&&(declaration.declarationList.flags&ts.NodeFlags.Const)!==0&&declaration.declarationList.declarations.length===1);
   const variable=declaration.declarationList.declarations[0];need(ts.isIdentifier(variable.name)&&variable.name.text==='config');
   const assignment=statements[1];need(ts.isExpressionStatement(assignment)&&ts.isBinaryExpression(assignment.expression)&&assignment.expression.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(assignment.expression.left)&&ts.isIdentifier(assignment.expression.left.expression)&&assignment.expression.left.expression.text==='config'&&assignment.expression.left.name.text==='runtimeDataModel');
   if(statements.length===3){const terminal=statements[2];need(ts.isThrowStatement(terminal));const error=terminal.expression;need((ts.isNewExpression(error)||ts.isCallExpression(error))&&ts.isIdentifier(error.expression)&&error.expression.text==='Error'&&error.arguments?.length===1&&ts.isStringLiteral(error.arguments[0]));}
  }
  let configNode,modelText;
  const literal=n=>{need(n);if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;if(ts.isNumericLiteral(n))return Number(n.text);if(n.kind===ts.SyntaxKind.TrueKeyword)return true;if(n.kind===ts.SyntaxKind.FalseKeyword)return false;if(n.kind===ts.SyntaxKind.NullKeyword)return null;if(ts.isArrayLiteralExpression(n))return n.elements.map(literal);if(ts.isObjectLiteralExpression(n)){const out=Object.create(null);for(const p of n.properties){need(ts.isPropertyAssignment(p)&&(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name))&&!Object.hasOwn(out,p.name.text)&&!['__proto__','constructor','prototype'].includes(p.name.text));out[p.name.text]=literal(p.initializer);}return out;}fault();};
  const critical=new Set(['inlineSchema','runtimeDataModel','clientVersion','engineVersion','copyEngine']);
  const visit=n=>{
   if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text==='config'){need(configNode===undefined);configNode=n.initializer;}
   if(ts.isBinaryExpression(n)&&n.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&n.operatorToken.kind<=ts.SyntaxKind.LastAssignment){
    need(n.operatorToken.kind===ts.SyntaxKind.EqualsToken);
    if(ts.isIdentifier(n.left)&&n.left.text==='config')fault();
    if((ts.isPropertyAccessExpression(n.left)||ts.isElementAccessExpression(n.left))&&n.left.expression.getText(ast)==='config'){
     const key=ts.isPropertyAccessExpression(n.left)?n.left.name.text:ts.isStringLiteral(n.left.argumentExpression)?n.left.argumentExpression.text:undefined;need(key!==undefined);
     if(key==='runtimeDataModel'){need(modelText===undefined&&ts.isCallExpression(n.right)&&n.right.expression.getText(ast)==='JSON.parse'&&n.right.arguments.length===1&&ts.isStringLiteral(n.right.arguments[0]));modelText=n.right.arguments[0].text;}
     else need(!critical.has(key));
    }
   }
   if((ts.isPrefixUnaryExpression(n)||ts.isPostfixUnaryExpression(n))&&n.operand.getText(ast).startsWith('config'))fault();
   if(ts.isDeleteExpression(n)&&n.expression.getText(ast).startsWith('config'))fault();
   if(ts.isCallExpression(n)&&n.arguments.some(arg=>ts.isIdentifier(arg)&&arg.text==='config'))need(n.expression.getText(ast)==='getPrismaClient');
   ts.forEachChild(n,visit);
  };visit(ast);
  const config=literal(configNode);need(typeof config.inlineSchema==='string'&&typeof modelText==='string');const model=JSON.parse(modelText);need(model&&typeof model==='object'&&!Array.isArray(model));
  need(config.clientVersion===expected.clientVersion&&config.engineVersion===expected.engineVersion&&config.copyEngine===false&&hash(config.inlineSchema)===schema.sha256&&hash(config.inlineSchema)===expected.inlineSchemaSha256&&hash(modelText)===expected.runtimeDataModelTextSha256);
  need(JSON.stringify(expected.generatedMembers.map(row=>row.file))===JSON.stringify(GENERATED));let reviewedBundle=pkg.sha256===expected.packageEntrySha256;
  for(const member of expected.generatedMembers){const file=path.join(generatedRoot,member.file);if(!fs.existsSync(file)){reviewedBundle=false;continue;}const row=capture(file,false);if(row.sha256!==member.sha256||'0o'+(row.identity.mode&0o777).toString(8)!==member.mode)reviewedBundle=false;}
  need(read(compiler,{maxBytes:64*1024*1024,expectedIdentity:before.identity,code:'TASK16_RUNTIME_SDK_SCHEMA'}).sha256===before.sha256);
  for(const row of captures)need(read(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_RUNTIME_SDK_SCHEMA'}).sha256===row.sha256);
  return {version:{client:config.clientVersion,engine:config.engineVersion},sourceSchemaSha256:source.sha256,generatedSchemaSha256:schema.sha256,inlineSchemaSha256:hash(config.inlineSchema),runtimeDataModelTextSha256:hash(modelText),contentBound:true,formatBridge:bridge,rawSchemaEqual:source.sha256===schema.sha256,reviewedGeneratedBundleMatched:reviewedBundle,copyEngine:false,nativeRuntimeQualification:false,captures};
 }catch{fault();}
}
module.exports={inspectTask16SdkSource};
