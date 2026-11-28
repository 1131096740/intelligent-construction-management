'use strict';

const { stripVTControlCharacters } = require('node:util');
const titles = new Set(require('./personnel-lifecycle-titles.json'));
const suitePattern = /\/src\/database\/personnel-lifecycle-http-postgres\.owned282\.spec\.ts$/u;
const framePattern = /\b(personnel-lifecycle-http-postgres(?:\.owned282)?\.spec\.ts|personnel-lifecycle-real\.e2e\.ts):(\d{1,4}):(\d{1,3})\b/gu;

function reportLifecycleFailures(json) {
  const suite = json.testResults?.find(row => typeof row.name==='string' && suitePattern.test(row.name));
  return (suite?.assertionResults ?? []).filter(row=>row.status==='failed').slice(0,20).map(row=>{
    const text=stripVTControlCharacters((row.failureMessages??[]).join('\n')).slice(0,65536);
    const frames=[];
    for(const [,file,line,column] of text.matchAll(framePattern)){
      const frame={file,line:Number(line),column:Number(column)};
      if(!frames.some(item=>item.file===frame.file&&item.line===frame.line&&item.column===frame.column))frames.push(frame);
      if(frames.length===4)break;
    }
    return {
      title:titles.has(row.title)?row.title:null,
      frames,
      timeout:/\b(?:timed? ?out|timeout)\b/iu.test(text),
      prismaCode:/\bP(?:1001|1010|1011|2010|2024|2028|2034)\b/u.exec(text)?.[0],
      sqlstate:/\b(?:23505|23514|42501|42P01|55000|55P03|57014)\b/u.exec(text)?.[0],
      browserProject:/\[(?:desktop|mobile)\].*personnel-lifecycle-real\.e2e\.ts/u.test(text)
        ? [...new Set((text.match(/\[(?:desktop|mobile)\](?=[^\n]*personnel-lifecycle-real\.e2e\.ts)/gu)??[])
            .map(project=>project.slice(1,-1)))].sort() : [],
    };
  });
}

module.exports = { reportLifecycleFailures };
