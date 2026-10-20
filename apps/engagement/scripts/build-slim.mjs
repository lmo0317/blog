// TEST ONLY — smaller installers to compare with the real one (scripts/build-installer.mjs). Never released:
// a different app id, install folder and data folder, output in dist-slim/.
//   node scripts/build-slim.mjs electron   Electron with only the Korean and English language packs
//   node scripts/build-slim.mjs node       no Electron: Node runs the server, the window is Edge in app mode (slim/)
// NM_SLIM_VERSION sets the version (default: package.json), NM_SLIM_FEED the update feed (default: none).
import { cp, mkdir, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const mode = process.argv[2];
if (!['electron', 'node'].includes(mode)) throw new Error('usage: node scripts/build-slim.mjs electron|node');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..', '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.env.NM_SLIM_VERSION || pkg.version;
const out = path.join(root, 'dist-slim');
const work = path.join(root, '.build', `slim-${mode}`);
const app = mode === 'node' ? path.join(work, 'root', 'app') : path.join(work, 'app');
const PRODUCT = mode === 'node' ? '이웃메이트 경량 테스트' : '이웃메이트 언어축소 테스트';
const EXE = 'NeighborMateSlimTest.exe';
const step = (message) => console.log(`\n▶ ${message}`);

step('소스 복사');
await rm(work, { recursive: true, force: true });
await mkdir(app, { recursive: true });
const entries = mode === 'node' ? ['server.js', 'lib', 'public'] : ['main.js', 'server.js', 'updater.js', 'lib', 'public'];
for (const entry of entries) await cp(path.join(root, entry), path.join(app, entry), { recursive: true });
if (mode === 'node') for (const file of ['launcher.js', 'slim-updater.js']) await copyFile(path.join(root, 'slim', file), path.join(app, file));

// The Edge window shows the page icon in its title bar (Electron showed the exe icon).
if (mode === 'node') {
  await copyFile(path.join(root, 'build', 'icon.png'), path.join(app, 'public', 'app-icon.png'));
  const index = path.join(app, 'public', 'index.html');
  await writeFile(index, (await readFile(index, 'utf8')).replace('</head>', '<link rel="icon" type="image/png" href="/app-icon.png">\n</head>'));
}

step('코드 난독화 (build-installer.mjs와 같은 설정)');
const OBFUSCATE = { compact: true, identifierNamesGenerator: 'hexadecimal', renameGlobals: false, stringArray: true, stringArrayThreshold: 0.75, stringArrayEncoding: ['base64'], splitStrings: false, controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, sourceMap: false };
const NODE_SAFE = { stringArray: false, stringArrayEncoding: [] };
async function obfuscate(file, target) {
  const result = JavaScriptObfuscator.obfuscate(await readFile(file, 'utf8'), { ...OBFUSCATE, ...(target === 'node' ? NODE_SAFE : {}), target });
  await writeFile(file, result.getObfuscatedCode());
}
for (const name of await readdir(app)) if (name.endsWith('.js')) await obfuscate(path.join(app, name), 'node');
for (const name of await readdir(path.join(app, 'lib'))) if (name.endsWith('.js')) await obfuscate(path.join(app, 'lib', name), 'node');
await obfuscate(path.join(app, 'public', 'app.js'), 'browser');

step('실행에 필요한 패키지 설치');
const dependencies = { ...pkg.dependencies };
if (mode === 'node') delete dependencies['electron-updater'];
await writeFile(path.join(app, 'package.json'), JSON.stringify({
  name: 'neighbormate-slim-test',
  productName: PRODUCT,
  version,
  type: 'module',
  main: mode === 'node' ? 'launcher.js' : 'main.js',
  dependencies,
  ...(mode === 'node' ? { slim: { dataDirName: 'NeighborMate Slim Test', pipeName: 'neighbormate-slim-test', port: 4323, feedUrl: process.env.NM_SLIM_FEED || '', windowTitle: '이웃메이트' } } : {})
}, null, 2));
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --workspaces=false', { cwd: app, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });
await mkdir(out, { recursive: true });

if (mode === 'electron') {
  const { Arch, build, Platform } = await import('electron-builder');
  const electronVersion = JSON.parse(await readFile(path.join(repo, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  step('설치 파일 만들기 (Electron, 한국어·영어만)');
  const files = await build({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    projectDir: app,
    publish: 'never',
    config: {
      appId: 'com.neighbormate.engage.slimtest',
      productName: PRODUCT,
      electronVersion,
      electronLanguages: ['ko', 'en-US'],
      directories: { output: path.join(out, 'electron'), buildResources: path.join(root, 'build') },
      files: ['**/*'],
      asar: true,
      asarUnpack: ['node_modules/playwright-core/**'],
      compression: 'maximum',
      win: { icon: path.join(root, 'build', 'icon.png') },
      nsis: { oneClick: true, perMachine: false, installerLanguages: ['ko_KR'], language: '1042', artifactName: 'NeighborMate-LangTest-${version}.${ext}' }
    }
  });
  console.log(`\n✅ ${files.filter((file) => file.endsWith('.exe')).join('\n')}`);
  process.exit(0);
}

step('실행 파일 만들기 (Node + 아이콘, 콘솔 창 없음)');
const stageRoot = path.join(work, 'root');
const exe = path.join(stageRoot, EXE);
await copyFile(process.execPath, exe);
// Windows icons hold up to 256 px; resize build/icon.png and wrap the PNG in an .ico.
const png256 = path.join(work, 'icon-256.png');
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing; $s=[System.Drawing.Image]::FromFile('${path.join(root, 'build', 'icon.png')}'); $b=New-Object System.Drawing.Bitmap 256,256; $g=[System.Drawing.Graphics]::FromImage($b); $g.InterpolationMode='HighQualityBicubic'; $g.DrawImage($s,0,0,256,256); $b.Save('${png256}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose(); $s.Dispose()`]);
const pngData = fs.readFileSync(png256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(0, 6); ico.writeUInt8(0, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(pngData.length, 14); ico.writeUInt32LE(22, 18);
const icon = path.join(work, 'icon.ico');
fs.writeFileSync(icon, Buffer.concat([ico, pngData]));
const rcedit = path.join(repo, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
execFileSync(rcedit, [exe, '--set-icon', icon, '--set-version-string', 'ProductName', PRODUCT, '--set-version-string', 'FileDescription', PRODUCT,
  '--set-version-string', 'CompanyName', '이웃메이트', '--set-version-string', 'OriginalFilename', EXE, '--set-version-string', 'InternalName', 'NeighborMate', '--set-file-version', version, '--set-product-version', version]);
// Windows GUI subsystem instead of console, so no black console window opens with the app.
const bin = fs.readFileSync(exe);
const peOffset = bin.readUInt32LE(0x3c);
bin.writeUInt16LE(2, peOffset + 4 + 20 + 68);
fs.writeFileSync(exe, bin);

step('설치 파일 만들기 (NSIS)');
// electron-builder's own NSIS, unpacked in its cache by earlier builds.
const nsisCache = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'nsis-3.0.4.1');
const nsisDir = path.join(nsisCache, fs.readdirSync(nsisCache).find((name) => !name.endsWith('.7z')));
const installerName = `NeighborMate-SlimTest-${version}.exe`;
const outFile = path.join(out, 'node', installerName);
await mkdir(path.dirname(outFile), { recursive: true });
execFileSync(path.join(nsisDir, 'Bin', 'makensis.exe'), ['-V2', '-INPUTCHARSET', 'UTF8',
  `-DPRODUCT=${PRODUCT}`, `-DOUTFILE=${outFile}`, '-DDIRNAME=NeighborMateSlimTest', `-DEXE=${EXE}`, `-DSTAGE=${stageRoot}`, `-DICON=${icon}`, `-DVERSION=${version}`,
  path.join(root, 'slim', 'installer.nsi')], { stdio: 'inherit', env: { ...process.env, NSISDIR: nsisDir } });

// The update feed file, in electron-builder's latest.yml shape.
const data = fs.readFileSync(outFile);
const sha512 = crypto.createHash('sha512').update(data).digest('base64');
fs.writeFileSync(path.join(out, 'node', 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: ${sha512}\n    size: ${data.length}\npath: ${installerName}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
console.log(`\n✅ ${outFile} (${(data.length / 1024 / 1024).toFixed(1)}MB)`);
