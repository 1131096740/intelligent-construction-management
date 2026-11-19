// Pure synthetic HTTP/Web fixture; no database/resource driver is imported or executed.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const taskRoot = fs.realpathSync(path.resolve(__dirname, '../../..'));
if (fs.realpathSync(process.cwd()) !== path.join(taskRoot, 'services/api')) throw new Error('任务20浏览器夹具工作目录不正确');
require.extensions['.ts'] = (module, filename) => {
  if (!fs.realpathSync(filename).startsWith(taskRoot + path.sep)) throw new Error('浏览器夹具只加载本任务源码');
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } });
  module._compile(result.outputText, filename);
};
require('../src/general-procurement/general-procurement-request-browser.test-support.ts');
