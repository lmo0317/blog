import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, shutdown } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverPort = null;

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

async function createWindow() {
  // Start backend server on safe internal port
  try {
    const { port } = await startServer(4310);
    serverPort = port;
  } catch (err) {
    // If port 4310 is busy, use an open port
    const { port } = await startServer(0);
    serverPort = port;
  }

  // Create native desktop window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 880,
    minWidth: 980,
    minHeight: 700,
    title: '이웃메이트 Pro - 네이버 블로그 자동화',
    autoHideMenuBar: true,
    show: false, // Show when ready
    backgroundColor: '#f8f9fa',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the desktop interface with retry
  const targetUrl = `http://127.0.0.1:${serverPort}`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await mainWindow.loadURL(targetUrl);
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

app.whenReady().then(async () => {
  if (!gotTheLock) return;
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await shutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await shutdown();
});