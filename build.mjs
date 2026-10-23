// Turns a generated Activepieces piece into what Activepieces installs.
//
//   node build.mjs <pieceDir>
//
// <pieceDir> holds the piece's source as NativeShip generated it
// (package.json, tsconfig.json, src/index.ts ...). This script links this
// toolchain's node_modules into it, type-checks the source with tsc, bundles
// it the way Activepieces' own CLI does (packages/cli/src/lib/utils/
// bundle-piece-utils.ts: one self-contained CommonJS file at src/index.js,
// every @activepieces/* library inlined, class names kept), writes the
// published package.json beside it, and then loads the bundle the way
// Activepieces' engine does (extractPieceFromModule: the export whose
// constructor is named "Piece") and asks the piece for its metadata. It
// prints one JSON object on stdout:
//
//   { name, version, typeErrors: [...], validationErrors: [...],
//     packageFiles: [...], metadata: {...} }
//
// and leaves the package in <pieceDir>/dist. Packing the .tgz is the
// caller's job, so the archive is byte-for-byte reproducible from Go.
//
// Activepieces stopped publishing pieces-framework to npm when pieces moved
// to bundles; this toolchain pins the last published versions. A bundle
// carries its own copy, so the framework a piece was built with only has to
// produce metadata the server understands -- minimumSupportedRelease says
// which servers that is.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The esbuild warnings Activepieces' bundler treats as a broken bundle: code
// that will not work once bundled.
const HAZARD_WARNING_IDS = new Set([
  'indirect-require',
  'unsupported-require-call',
  'unsupported-dynamic-import',
  'require-resolve-not-external',
  'import-is-undefined',
  'call-import-namespace',
  'commonjs-variable-in-esm',
]);

const toolchainDir = path.dirname(fileURLToPath(import.meta.url));
const pieceDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(path.join(pieceDir, 'src', 'index.ts'))) {
  console.error('usage: node build.mjs <pieceDir containing src/index.ts>');
  process.exit(2);
}

const require = createRequire(path.join(toolchainDir, 'package.json'));
const esbuild = require('esbuild');
const ts = require('typescript');

// A junction rather than a symlink: Windows makes one without administrator
// rights, and Linux treats the type argument as a plain symlink.
const nodeModules = path.join(pieceDir, 'node_modules');
if (!fs.existsSync(nodeModules)) {
  fs.symlinkSync(path.join(toolchainDir, 'node_modules'), nodeModules, 'junction');
}

const manifest = JSON.parse(fs.readFileSync(path.join(pieceDir, 'package.json'), 'utf8'));
const typeErrors = typeCheck();

const distDir = path.join(pieceDir, 'dist');
fs.rmSync(distDir, { recursive: true, force: true });
const bundleFile = path.join(distDir, 'src', 'index.js');
const bundled = await esbuild.build({
  entryPoints: [path.join(pieceDir, 'src', 'index.ts')],
  absWorkingDir: pieceDir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: bundleFile,
  minify: true,
  // The engine finds the piece by constructor.name === 'Piece'; minifying
  // without keepNames renames the class and no server could install it.
  keepNames: true,
  treeShaking: true,
  metafile: true,
  logLevel: 'silent',
  legalComments: 'none',
});
const hazards = bundled.warnings.filter((warning) => HAZARD_WARNING_IDS.has(warning.id));
if (hazards.length > 0) {
  throw new Error('the piece cannot be bundled safely: ' + hazards.map((warning) => warning.text).join('; '));
}

const packageFiles = ['package.json', 'src/index.js'];
for (const extra of ['README.md', 'logo.png', 'logo.svg']) {
  if (fs.existsSync(path.join(pieceDir, extra))) {
    fs.copyFileSync(path.join(pieceDir, extra), path.join(distDir, extra));
    packageFiles.push(extra);
  }
}
const i18nDir = path.join(pieceDir, 'src', 'i18n');
if (fs.existsSync(i18nDir)) {
  fs.mkdirSync(path.join(distDir, 'src', 'i18n'), { recursive: true });
  for (const name of fs.readdirSync(i18nDir).sort()) {
    fs.copyFileSync(path.join(i18nDir, name), path.join(distDir, 'src', 'i18n', name));
    packageFiles.push(`src/i18n/${name}`);
  }
}
// What Activepieces' bundler publishes: no dependencies, because everything
// is inside src/index.js. Fields beyond these are the generator's own;
// repository must reach npm because trusted publishing checks it against the
// workflow's repository, and nativeShip is the digest NativeShip matches the
// published version to its build by.
const published = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  license: manifest.license,
  keywords: manifest.keywords,
  author: manifest.author,
  repository: manifest.repository,
  homepage: manifest.homepage,
  nativeShip: manifest.nativeShip,
  main: './src/index.js',
  dependencies: {},
  files: packageFiles.filter((file) => file !== 'package.json' && !file.startsWith('src/i18n/')).concat(
    fs.existsSync(i18nDir) ? ['src/i18n'] : [],
  ),
};
for (const key of Object.keys(published)) if (published[key] === undefined) delete published[key];
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(published, null, 2) + '\n');

const { metadata, validationErrors } = loadPiece(bundleFile);
process.stdout.write(
  JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    typeErrors,
    validationErrors,
    packageFiles: packageFiles.sort(),
    metadata,
  }) + '\n',
);

function typeCheck() {
  const configPath = path.join(pieceDir, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return [ts.flattenDiagnosticMessageText(config.error.messageText, '\n')];
  // The config's own path, or TypeScript looks for @types from the current
  // directory rather than the piece's.
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, pieceDir, undefined, configPath);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (!diagnostic.file) return message;
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const file = path.relative(pieceDir, diagnostic.file.fileName).split(path.sep).join('/');
      return `${file}:${line + 1}:${character + 1} ${message}`;
    });
}

// The engine's own steps: require the bundle, take the export whose
// constructor is named Piece, call metadata(). The checks after it are the
// ones the server or builder would otherwise trip over later.
function loadPiece(file) {
  const errors = [];
  let piece;
  let metadata;
  try {
    const module = createRequire(file)(file);
    piece = Object.values(module).find((value) => value != null && value.constructor?.name === 'Piece');
    if (!piece) return { metadata: null, validationErrors: ['the bundle exports no Piece'] };
    metadata = JSON.parse(JSON.stringify(piece.metadata()));
  } catch (error) {
    // The message only: the stack points into a minified bundle, and Node
    // would print a line of it a megabyte long.
    return { metadata: null, validationErrors: [`the bundle does not load: ${error?.message ?? error}`] };
  }
  if (!metadata.displayName) errors.push('the piece has no displayName');
  if (!/^https:\/\//.test(metadata.logoUrl ?? '')) errors.push('logoUrl must be an https URL');
  if (Object.keys(metadata.actions ?? {}).length + Object.keys(metadata.triggers ?? {}).length === 0) {
    errors.push('the piece has no actions and no triggers');
  }
  for (const [kind, steps] of [['action', metadata.actions], ['trigger', metadata.triggers]]) {
    for (const [key, step] of Object.entries(steps ?? {})) {
      if (key !== step.name) errors.push(`${kind} ${key} is registered under another name (${step.name})`);
      if (!/^[a-z0-9_]+$/.test(key) && key !== 'custom_api_call') errors.push(`${kind} name ${key} is not snake_case`);
      if (!step.displayName) errors.push(`${kind} ${key} has no displayName`);
      for (const [propName, prop] of Object.entries(step.props ?? {})) {
        // Dynamic props (Custom API Call's URL) build their own display.
        if (!prop.displayName && prop.type !== 'DYNAMIC') errors.push(`${kind} ${key} prop ${propName} has no displayName`);
      }
    }
  }
  return { metadata, validationErrors: errors };
}
