// Builds the customer installer: dist/NeighborMate-Setup-<version>.exe, one file, one click.
// The shipped code is obfuscated; AI models and the llama runtime download on first run.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { Arch, build, Platform } from 'electron-builder';
import { UPDATE_FEED_URL } from '../lib/update-feed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.build', 'stage');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(await readFile(path.join(root, '..', '..', 'node_modules', 'electron', 'package.json'), 'utf8')).version;

const step = (message) => console.log(`\n▶ ${message}`);

step('소스 복사');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const entry of ['main.js', 'server.js', 'updater.js', 'lib', 'public']) {
  await cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
}

step('코드 난독화');
const OBFUSCATE = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  sourceMap: false
};
// Server code hands functions to Playwright (page.evaluate, addInitScript, ...), which sends their source
// text into the browser. The string array would make those functions call a decoder that only exists in
// Node ("_0x18fff4 is not defined"), so Node files only get renamed identifiers and compacted code.
const NODE_SAFE = { stringArray: false, stringArrayEncoding: [] };

async function obfuscate(file, target) {
  const source = await readFile(file, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, { ...OBFUSCATE, ...(target === 'node' ? NODE_SAFE : {}), target });
  await writeFile(file, result.getObfuscatedCode());
}
await obfuscate(path.join(stage, 'main.js'), 'node');
await obfuscate(path.join(stage, 'server.js'), 'node');
await obfuscate(path.join(stage, 'updater.js'), 'node');
for (const name of await readdir(path.join(stage, 'lib'))) {
  if (name.endsWith('.js')) await obfuscate(path.join(stage, 'lib', name), 'node');
}
await obfuscate(path.join(stage, 'public', 'app.js'), 'browser');

step('실행에 필요한 패키지 설치');
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'neighbormate-engage',
  productName: '이웃메이트',
  version: pkg.version,
  description: '이웃메이트 - 네이버 블로그 공감·AI 댓글·서로이웃',
  author: '이웃메이트',
  type: 'module',
  main: 'main.js',
  dependencies: pkg.dependencies
}, null, 2));
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --workspaces=false', {
  cwd: stage,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
});

step('설치 파일 만들기');
const [installer] = await build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  projectDir: stage,
  publish: 'never',
  config: {
    appId: 'com.neighbormate.engage',
    productName: '이웃메이트',
    electronVersion,
    directories: { output: path.join(root, 'dist'), buildResources: path.join(root, 'build') },
    files: ['**/*'],
    asar: true,
    // Playwright starts its driver from real files on disk.
    asarUnpack: ['node_modules/playwright-core/**'],
    compression: 'maximum',
    // Writes latest.yml for the auto-updater; scripts/release.mjs uploads it to the 112 server.
    publish: { provider: 'generic', url: UPDATE_FEED_URL },
    win: existsSync(path.join(root, 'build', 'icon.png')) ? { icon: path.join(root, 'build', 'icon.png') } : {},
    nsis: {
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      createDesktopShortcut: 'always',
      createStartMenuShortcut: true,
      shortcutName: '이웃메이트',
      deleteAppDataOnUninstall: false,
      installerLanguages: ['ko_KR'],
      language: '1042',
      artifactName: 'NeighborMate-Setup-${version}.${ext}'
    }
  }
}).then((files) => files.filter((file) => file.endsWith('.exe')));

console.log(`\n✅ 설치 파일: ${installer}`);
