import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import ts from '../node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const entryHtml = path.join(root, 'index.html');
const entryTs = path.join(root, 'src', 'main.ts');
const distDir = path.join(root, 'dist');

const normalizeId = (filePath) => `/${path.relative(root, filePath).replace(/\\/g, '/')}`;

const resolveImport = (fromPath, specifier) => {
  const base = path.resolve(path.dirname(fromPath), specifier);
  const candidates = [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to resolve import "${specifier}" from ${fromPath}`);
  }
  return resolved;
};

const collectModules = (filePath, modules = new Map()) => {
  const normalized = normalizeId(filePath);
  if (modules.has(normalized)) {
    return modules;
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const imports = ts.preProcessFile(source).importedFiles;
  imports.forEach((entry) => {
    if (entry.fileName.startsWith('.')) {
      collectModules(resolveImport(filePath, entry.fileName), modules);
    }
  });

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true
    },
    fileName: filePath
  }).outputText;

  modules.set(normalized, transpiled);
  return modules;
};

const writeBundle = () => {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  const html = fs
    .readFileSync(entryHtml, 'utf8')
    .replace(/<script type="module" src="\/src\/main\.ts"><\/script>/, '<script src="/assets/main.js"></script>');
  fs.writeFileSync(path.join(distDir, 'index.html'), html);

  const modules = collectModules(entryTs);
  const bundle = `(() => {
const modules = {
${Array.from(modules.entries())
  .map(
    ([id, code]) =>
      `${JSON.stringify(id)}: (require, module, exports) => {\n${code}\n}`
  )
  .join(',\n')}
};

const cache = {};
const resolve = (fromId, request) => {
  if (!request.startsWith('.')) return request;
  const fromParts = fromId.split('/');
  fromParts.pop();
  const requestParts = request.split('/');
  for (const part of requestParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      fromParts.pop();
    } else {
      fromParts.push(part);
    }
  }
  const joined = fromParts.join('/');
  const candidates = [joined, joined + '.ts', joined + '.js', joined + '/index.ts'];
  for (const candidate of candidates) {
    if (modules[candidate]) return candidate;
  }
  throw new Error('Missing module ' + request + ' from ' + fromId);
};

const requireModule = (id, request) => {
  const targetId = resolve(id, request);
  if (cache[targetId]) return cache[targetId].exports;
  const module = { exports: {} };
  cache[targetId] = module;
  modules[targetId]((childRequest) => requireModule(targetId, childRequest), module, module.exports);
  return module.exports;
};

requireModule(${JSON.stringify(normalizeId(entryTs))}, ${JSON.stringify(normalizeId(entryTs))});
})();`;

  fs.writeFileSync(path.join(distDir, 'assets', 'main.js'), bundle);
};

const getContentType = (filePath) => {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
};

const serve = () => {
  writeBundle();
  const port = 5173;
  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url || '/index.html';
    const targetPath = path.join(distDir, urlPath);
    if (!targetPath.startsWith(distDir) || !fs.existsSync(targetPath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', getContentType(targetPath));
    res.end(fs.readFileSync(targetPath));
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`vite-lite dev server running at http://0.0.0.0:${port}\n`);
  });
};

const command = process.argv[2] || 'build';
if (command === 'build') {
  writeBundle();
  process.stdout.write('vite-lite build complete\n');
} else if (command === 'dev') {
  serve();
} else if (command === 'preview') {
  serve();
} else {
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exit(1);
}
