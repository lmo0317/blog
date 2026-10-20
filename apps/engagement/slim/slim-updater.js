// Auto-update for the Electron-free test build, with the same face as updater.js (getState / start / check /
// install): reads latest.yml from the feed, downloads the new installer in the background, checks its sha512,
// and runs it silently, either right away (then the new version opens) or when the app closes.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CHECK_EVERY_MS = 30 * 60 * 1000;

const newer = (a, b) => {
  const pa = String(a).split(/[.-]/).map(Number);
  const pb = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// The top-level fields of electron-builder's latest.yml: version, path, sha512.
const parseFeed = (text) => Object.fromEntries(text.split(/\r?\n/).map((line) => line.match(/^(version|path|sha512):\s*'?([^']*)'?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));

export function createSlimUpdater({ currentVersion, feedUrl, dataDir, beforeInstall = async () => {} }) {
  const state = { currentVersion, status: 'idle', version: '', percent: 0, error: '' };
  const getState = () => ({ ...state });
  let installer = '';
  let busy = false;

  async function check() {
    if (!feedUrl || busy || state.status === 'ready' || state.status === 'installing') return;
    busy = true;
    try {
      if (state.status !== 'downloading') state.status = 'checking';
      const feed = parseFeed(await (await fetch(new URL('latest.yml', feedUrl), { cache: 'no-store' })).text());
      if (!feed.version || !feed.path || !newer(feed.version, currentVersion)) {
        state.status = 'latest';
        return;
      }
      Object.assign(state, { status: 'downloading', version: feed.version, percent: 0, error: '' });
      const res = await fetch(new URL(encodeURIComponent(feed.path), feedUrl));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const dir = path.join(dataDir, 'updates');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, path.basename(feed.path));
      const out = fs.createWriteStream(`${file}.download`);
      const hash = crypto.createHash('sha512');
      let got = 0;
      for await (const chunk of res.body) {
        hash.update(chunk);
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (total) state.percent = Math.min(99, Math.round((got / total) * 100));
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (feed.sha512 && hash.digest('base64') !== feed.sha512) throw new Error('받은 파일이 손상되었습니다 (sha512 불일치)');
      fs.renameSync(`${file}.download`, file);
      installer = file;
      Object.assign(state, { status: 'ready', percent: 100 });
    } catch (err) {
      // Offline or server down: keep the current version and try again on the next check.
      Object.assign(state, { status: 'error', error: err?.message || String(err) });
    } finally {
      busy = false;
    }
  }

  const run = (args) => spawn(installer, ['/S', ...args], { detached: true, stdio: 'ignore', windowsHide: true }).unref();

  return {
    getState,
    start() {
      check();
      setInterval(check, CHECK_EVERY_MS).unref();
    },
    async check() {
      await check();
      return getState();
    },
    async install() {
      if (state.status !== 'ready') return false;
      state.status = 'installing';
      await beforeInstall();
      // Silent reinstall, then the new version opens by itself (/RUN).
      setTimeout(() => { run(['/RUN']); process.exit(0); }, 300);
      return true;
    },
    installOnQuit() {
      if (state.status === 'ready' && installer) run([]);
    }
  };
}
