// Test build without Electron (scripts/build-slim.mjs node): a plain Node runs the app server and the window
// is the Edge (or Chrome) already on the PC, opened in app mode. Closing the window quits the app, a second
// launch brings the open window forward, and updates install the way electron-updater did.
//   <installed exe> <app folder>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const { dataDirName, pipeName, port, feedUrl, windowTitle } = pkg.slim;
const dataDir = path.join(process.env.APPDATA || os.homedir(), dataDirName);
fs.mkdirSync(dataDir, { recursive: true });
process.env.NEIGHBORMATE_DATA_DIR = dataDir;

// The exe has no console: keep what the app prints in a log next to its data.
const logFile = path.join(dataDir, 'app.log');
const log = (level) => (...args) => {
  try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`); } catch {}
};
console.log = log('info'); console.info = log('info'); console.warn = log('warn'); console.error = log('error');

// One copy only: a second launch tells the first to bring its window forward, then leaves.
const PIPE = `\\\\.\\pipe\\${pipeName}-${os.userInfo().username}`;
const alreadyRunning = await new Promise((resolve) => {
  const client = net.connect(PIPE, () => { client.end('show'); resolve(true); });
  client.on('error', () => resolve(false));
});
if (alreadyRunning) process.exit(0);

let quitting = false;
const { startServer, shutdown } = await import('./server.js');
const { createSlimUpdater } = await import('./slim-updater.js');
// Installing an update closes the app first: server, browser automation and the window.
const updater = createSlimUpdater({ currentVersion: pkg.version, feedUrl, dataDir, beforeInstall: async () => { quitting = true; await shutdown(); closeWindow(); } });

let serverPort = port;
try {
  ({ port: serverPort } = await startServer(port, { enforceLicense: true, updater }));
} catch {
  ({ port: serverPort } = await startServer(0, { enforceLicense: true, updater }));
}

function findBrowser() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const rel of ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']) {
    for (const base of bases) {
      const file = path.join(base, rel);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

// The window gets its own browser profile, so its browser process lives exactly as long as the window.
const uiProfile = path.join(dataDir, 'ui');
const browser = findBrowser();
let windowOpen = false;

// Whether a browser process for our window profile is still running (Edge can hand the window to a new process).
function windowProcessAlive() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `(${ourWindows} | Measure-Object).Count`],
    { windowsHide: true, encoding: 'utf8' });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
}

const ourWindows = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${uiProfile.replace(/'/g, "''")}*' }`;

function closeWindow() {
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `${ourWindows} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { windowsHide: true }); } catch {}
}

function openWindow() {
  if (windowOpen) {
    spawn('powershell.exe', ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate('${windowTitle}')`], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  const url = `http://127.0.0.1:${serverPort}`;
  if (!browser) {
    // No Edge or Chrome: the default browser still shows the app.
    spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  windowOpen = true;
  const child = spawn(browser, [`--app=${url}`, `--user-data-dir=${uiProfile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1200,880', '--disable-sync', '--disable-features=Translate'], { stdio: 'ignore' });
  child.on('exit', async () => {
    while (windowProcessAlive()) await new Promise((r) => setTimeout(r, 2000));
    windowOpen = false;
    await quit();
  });
}

async function quit() {
  if (quitting) return;
  quitting = true;
  await shutdown();
  // An update that finished downloading installs when the app closes, as before.
  updater.installOnQuit();
  process.exit(0);
}

net.createServer((socket) => socket.on('data', () => openWindow())).listen(PIPE);
openWindow();
updater.start();
