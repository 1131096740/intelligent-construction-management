'use strict';

const knownClasses = /\b(?:PrismaClientKnownRequestError|PrismaClientUnknownRequestError|PrismaClientValidationError|ConflictException|ForbiddenException|BadRequestException|NotFoundException|ServiceUnavailableException|JestAssertionError|AssertionError|TypeError|RangeError|Error)\b/gu;
const projectFrames = /(?:^|[/\\])((?:historical-wage-takeover(?:\.service|\.pg\.spec)|wage-statement\.service|operating-takeover-coordinator\.service)\.ts):(\d{1,5}):(\d{1,4})\b/gu;
const unique = (matches) => [...new Set(matches)].slice(0, 8);

function observeWageFailures(rows) {
  return rows.flatMap((row, index) => {
    if (row.status !== 'failed') return [];
    const errorText = Array.isArray(row.failureMessages) ? row.failureMessages.filter(v => typeof v === 'string').join('\n').slice(0, 128 * 1024) : '';
    const details = (row.failureDetails ?? []).slice(0, 4).map(detail => {
      const chain = [];
      const visited = new Set();
      for (let node = detail; node && typeof node === 'object' && !visited.has(node) && chain.length < 6; node = node.cause) {
        visited.add(node);
        const name = typeof node.name === 'string' ? unique(node.name.match(knownClasses) ?? [])[0] : undefined;
        const status = Number.isInteger(node.status) && node.status >= 400 && node.status <= 599 ? node.status : undefined;
        const code = typeof node.code === 'string' && /^P\d{4}$/u.test(node.code) ? node.code : undefined;
        const sqlstate = typeof node.meta?.code === 'string' && /^[0-9A-Z]{5}$/u.test(node.meta.code) ? node.meta.code : undefined;
        chain.push({ name, status, code, sqlstate });
      }
      return chain;
    });
    const stack = [...errorText.matchAll(projectFrames)].slice(0, 8).map(match => ({file:match[1],line:Number(match[2]),column:Number(match[3])}));
    return [{
      position:index+1,
      httpStatus:unique([...errorText.matchAll(/\b(?:statusCode|status|HTTP)\s*["']?[:= ]\s*([45]\d{2})\b/gu)].map(match=>Number(match[1]))),
      sqlstate:unique([...errorText.matchAll(/\b(?:SQLSTATE|sqlstate|code)\s*["']?[:= ]\s*["']?([0-9A-Z]{5})\b/gu)]
        .map(match=>match[1]).filter(state=>!/^P\d{4}$/u.test(state))),
      prismaCode:unique(errorText.match(/\bP\d{4}\b/gu) ?? []),
      classes:unique(errorText.match(knownClasses) ?? []),
      timeout:/Exceeded timeout/u.test(errorText),
      details,
      stack,
    }];
  }).slice(0, 12);
}

module.exports={observeWageFailures};
