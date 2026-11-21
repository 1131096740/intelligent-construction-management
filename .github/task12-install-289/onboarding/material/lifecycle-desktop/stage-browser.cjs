'use strict';
const fs=require('node:fs');
const path=require('node:path');
const source='/qualification/workspace/apps/web-admin';

function stageWebWorkspace(workDir) {
  if (!/^\/tmp\/jg394-[A-Za-z0-9]+$/u.test(workDir) ||
      fs.realpathSync(workDir)!==workDir || fs.statSync(workDir).uid!==process.getuid()) {
    throw new Error('OWNED_BROWSER_ROOT');
  }
  const target=path.join(workDir,'web-admin');
  fs.mkdirSync(target,{mode:0o700});
  for(const name of ['index.html','package.json','public','src','tsconfig.json','vite.config.ts']){
    fs.cpSync(path.join(source,name),path.join(target,name),{recursive:true,force:false,errorOnExist:true});
  }
  const modules=path.join(target,'node_modules');
  fs.mkdirSync(modules,{mode:0o700});
  for(const name of fs.readdirSync(path.join(source,'node_modules'))){
    if(name.startsWith('.'))continue;
    fs.symlinkSync(path.join(source,'node_modules',name),path.join(modules,name));
  }
  return target;
}
module.exports={stageWebWorkspace};
