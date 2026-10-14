#!/usr/bin/env node
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function connectionParameters(text) {
  const params = new Map();
  if (/^postgres(?:ql)?:\/\//u.test(text)) {
    // libpq has no fragment syntax and treats the database path as an opaque name.
    // WHATWG removes fragments, control characters and dot segments; never adopt that target.
    if (text.includes('#') || /[\u0000-\u0020\u007f]/u.test(text)) throw new Error('ambiguous connection URI');
    const originalPath = text.match(/^postgres(?:ql)?:\/\/[^/?#]*(\/[^?]*)?(?:\?.*)?$/u)?.[1] ?? '';
    const url = new URL(text);
    if (decodeURIComponent(url.pathname) !== decodeURIComponent(originalPath)) throw new Error('connection URI path would be normalized');
    if (url.username) params.set('user', decodeURIComponent(url.username));
    if (url.password) params.set('password', decodeURIComponent(url.password));
    if (url.hostname) params.set('host', url.hostname.replace(/^\[|\]$/gu, ''));
    if (url.port) params.set('port', url.port);
    if (url.pathname && url.pathname !== '/') params.set('dbname', decodeURIComponent(url.pathname.slice(1)));
    for (const entry of url.search.slice(1).split('&').filter(Boolean)) {
      const separator = entry.indexOf('=');
      if (separator < 0) throw new Error('invalid URI parameter');
      params.set(decodeURIComponent(entry.slice(0, separator)), decodeURIComponent(entry.slice(separator + 1)));
    }
  } else {
    let offset=0;
    while(offset<text.length) {
      while(/\s/u.test(text[offset]??'')) offset++;
      if(offset===text.length) break;
      const key=text.slice(offset).match(/^([a-z_][a-z0-9_]*)\s*=/u);
      if(!key) throw new Error('invalid connection parameters');
      offset+=key[0].length;
      while(/\s/u.test(text[offset]??'')) offset++;
      const quoted=text[offset]==="'";
      if(quoted) offset++;
      let value='', closed=!quoted;
      while(offset<text.length) {
        const character=text[offset++];
        if(character==='\\') {
          if(offset===text.length) throw new Error('invalid connection escape');
          value+=text[offset++];
        } else if(quoted && character==="'") {closed=true;break;}
        else if(!quoted && /\s/u.test(character)) break;
        else value+=character;
      }
      if(!closed) throw new Error('unterminated connection parameter');
      if(quoted && offset<text.length && !/\s/u.test(text[offset])) throw new Error('invalid parameter separator');
      params.set(key[1],value);
    }
  }
  for(const [key,value] of params) {
    if(!/^[a-z_][a-z0-9_]*$/u.test(key) || /[\r\n\0]/u.test(value)) throw new Error('unrepresentable connection parameter');
    if(key==='service') throw new Error('nested service connection requires explicit configuration');
    if(key!=='password' && value.trim()!==value) throw new Error('unrepresentable service parameter spacing');
  }
  return params;
}

export async function prepareService(text) {
  const params=connectionParameters(text);
  let directory;
  try {
    directory=await mkdtemp(join(tmpdir(),'jgzg-private-libpq-'));
    await chmod(directory,0o700);
    if(params.has('password')) {
      const password=params.get('password').replaceAll('\\','\\\\').replaceAll(':','\\:');
      const passfile=join(directory,'pgpass');
      await writeFile(passfile,`*:*:*:*:${password}\n`,{mode:0o600,flag:'wx'});
      params.delete('password');params.set('passfile',passfile);
      await writeFile(join(directory,'explicit-password'),'1',{mode:0o600,flag:'wx'});
    }
    const body='[jgzg_backup]\n'+[...params].map(([key,value])=>`${key}=${value}`).join('\n')+'\n';
    await writeFile(join(directory,'service.conf'),body,{mode:0o600,flag:'wx'});
    return directory;
  }catch(error){if(directory) await rm(directory,{recursive:true,force:true});throw error;}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  let input='';
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){input+=chunk;if(input.length>65536){process.stderr.write('Private connection input exceeds limit\n');process.exit(1);}}
  try {process.stdout.write(await prepareService(input));}
  catch {process.stderr.write('Private libpq connection preparation failed\n');process.exitCode=1;}
}
