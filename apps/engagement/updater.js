import electronUpdater from 'electron-updater';
import { UPDATE_FEED_URL } from './lib/update-feed.js';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// Downloads new versions quietly in the background. The user restarts from the in-app banner,
// or the update installs by itself the next time the app closes.
export function createAppUpdater({ app, beforeInstall = async () => {} }) {
  const state = { currentVersion: app.getVersion(), status: 'idle', version: '', percent: 0, error: '' };
  const getState = () => ({ ...state });

  if (!app.isPackaged) {
    state.status = 'dev';
    return { getState, start() {}, async install() { return false; } };
  }

  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    if (state.status !== 'ready' && state.status !== 'downloading') state.status = 'checking';
  });
  autoUpdater.on('update-not-available', () => { state.status = 'latest'; });
  autoUpdater.on('update-available', (info) => {
    Object.assign(state, { status: 'downloading', version: info.version, percent: 0, error: '' });
  });
  autoUpdater.on('download-progress', (progress) => { state.percent = Math.round(progress.percent || 0); });
  autoUpdater.on('update-downloaded', (info) => {
    Object.assign(state, { status: 'ready', version: info.version, percent: 100 });
  });
  // Offline or server down: keep the current version and try again on the next check.
  autoUpdater.on('error', (err) => {
    if (state.status !== 'ready') Object.assign(state, { status: 'error', error: err?.message || String(err) });
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});

  return {
    getState,
    start() {
      check();
      setInterval(check, CHECK_EVERY_MS).unref();
    },
    async install() {
      if (state.status !== 'ready') return false;
      state.status = 'installing';
      await beforeInstall();
      // Silent reinstall, then the new version opens by itself.
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return true;
    }
  };
}
