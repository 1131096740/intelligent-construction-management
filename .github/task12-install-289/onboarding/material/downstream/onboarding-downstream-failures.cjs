'use strict';

const { stripVTControlCharacters } = require('node:util');

function summarizeDownstream(json, api, entries) {
  return entries.map(([file]) => {
    const suite = json.testResults?.find(candidate => candidate.name === api+'/'+file);
    const name=file.split('/').at(-1);
    const rows=suite?.assertionResults ?? [];
    const failures=[];
    for(const [index,row] of rows.entries()){
      if(row.status!=='failed') continue;
      const text=stripVTControlCharacters((row.failureMessages??[]).join('\n')).slice(0,65_536);
      const frames=[];
      for(const match of text.matchAll(/(?:^|[/\\( ])([^/\\() :]+\.ts):(\d{1,4}):(\d{1,3})(?=\)|\s|$)/gu)){
        if(match[1]!==name) continue;
        const frame={line:Number(match[2]),column:Number(match[3])};
        if(!frames.some(other=>other.line===frame.line&&other.column===frame.column)) frames.push(frame);
        if(frames.length===4) break;
      }
      const browserProjects=[...new Set([...text.matchAll(/\[(desktop|mobile)\][^\n]*employee-onboarding-real\.e2e\.ts/gu)]
        .map(match=>match[1]))];
      const browserFrames=[...text.matchAll(/\bemployee-onboarding-real\.e2e\.ts:(\d{1,4}):(\d{1,3})\b/gu)]
        .slice(0,4).map(([,line,column])=>({line:Number(line),column:Number(column)}));
      const browserFirstMarker=
        /webServer.*(?:timed out|timeout)|timed out waiting.*webServer/iu.test(text) ? 'WEB_SERVER_TIMEOUT'
        : /browserType\.launch|Executable doesn't exist/iu.test(text) ? 'BROWSER_LAUNCH_ERROR'
        : /net::ERR_ABORTED|frame was detached/iu.test(text) ? 'NAVIGATION_ABORT'
        : /locator\.|toHaveCount|toBeVisible/iu.test(text) ? 'PAGE_ASSERTION_OR_LOCATOR'
        : null;
      const statuses=/Expected:\s*([1-5]\d{2})\s+Received:\s*([1-5]\d{2})(?!\d)/u.exec(text);
      failures.push({ordinal:index+1,frames,browserProjects,browserFrames,browserFirstMarker,
        timeout:/\b(?:timed? ?out|timeout)\b/iu.test(text),
        browser:/\b(?:playwright|webkit|chromium)\b/iu.test(text),
        prismaCode:/\bP(?:1001|1010|1011|2002|2003|2004|2010|2021|2022|2024|2025|2028|2034)\b/u.exec(text)?.[0],
        sqlstate:/\b(?:23505|23514|42501|42P01|55000|55P03|57014)\b/u.exec(text)?.[0],
        ...(statuses ? {expectedStatus:Number(statuses[1]),receivedStatus:Number(statuses[2])} : {}),
      });
    }
    return {suite:name,seen:!!suite,passed:rows.filter(row=>row.status==='passed').length,
      failed:failures.length,skipped:rows.filter(row=>row.status==='pending').length,failures};
  });
}

module.exports={summarizeDownstream};
