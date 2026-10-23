// Compiles the vendored Activepieces framework (vendor/, see its README) into
// node_modules/@activepieces/*, as ordinary CommonJS packages with type
// declarations: what a piece imports, what build.mjs bundles, and what tsc
// type-checks a piece against.
//
//   node prepare.mjs
//
// Run after `bun install` (which may clear node_modules). It is one tsc
// program over all four packages, each import between them mapped to its
// source, so they compile together the way Activepieces' own build does.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

const packages = ['core-utils', 'core-piece-types', 'pieces-framework', 'pieces-common'];
const vendor = path.join(root, 'vendor');
const out = path.join(root, 'node_modules', '@activepieces');

const files = [];
for (const name of packages) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);
    }
  };
  walk(path.join(vendor, name, 'src'));
}

const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  declaration: true,
  strict: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  skipLibCheck: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: ['node'],
  typeRoots: [path.join(root, 'node_modules', '@types')],
  rootDir: vendor,
  outDir: out,
  baseUrl: root,
  paths: Object.fromEntries(packages.map((name) => [`@activepieces/${name}`, [`vendor/${name}/src/index.ts`]])),
};

for (const name of packages) fs.rmSync(path.join(out, name), { recursive: true, force: true });
const program = ts.createProgram(files, options);
const emitted = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitted.diagnostics);
if (diagnostics.length > 0) {
  for (const diagnostic of diagnostics.slice(0, 30)) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const where = diagnostic.file
      ? `${path.relative(root, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1} `
      : '';
    console.error(where + message);
  }
  console.error(`${diagnostics.length} problem(s) compiling the vendored framework`);
  process.exit(1);
}

// Each package as node resolves it: its own package.json, pointing at the
// compiled entry point, with no dependencies (they are the toolchain's).
for (const name of packages) {
  const manifest = JSON.parse(fs.readFileSync(path.join(vendor, name, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(out, name, 'package.json'),
    JSON.stringify(
      { name: manifest.name, version: manifest.version, main: './src/index.js', types: './src/index.d.ts', license: 'MIT' },
      null,
      2,
    ) + '\n',
  );
}
console.log(`compiled ${packages.length} vendored packages (${files.length} files) into node_modules/@activepieces`);
