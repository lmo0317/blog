import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataPath } from './app-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CACHE_PATH = dataPath('hwid-cache.json');

let inMemoryHwid = null;

/**
 * Retrieves the raw OS/hardware UUID safely without external npm packages
 */
function getSystemUuid() {
  const platform = os.platform();

  if (platform === 'win32') {
    try {
      const output = execSync('powershell -NoProfile -NonInteractive -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"', {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (output && output.length > 8 && !output.includes('Error')) {
        return output;
      }
    } catch {
      // Fallback to registry MachineGuid
      try {
        const regOutput = execSync('powershell -NoProfile -NonInteractive -Command "(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid"', {
          encoding: 'utf8',
          timeout: 4000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (regOutput && regOutput.length > 8) {
          return regOutput;
        }
      } catch {
        // Continue to fallback
      }
    }
  } else if (platform === 'linux') {
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        if (fs.existsSync(p)) {
          const id = fs.readFileSync(p, 'utf8').trim();
          if (id) return id;
        }
      } catch {
        // continue
      }
    }
  } else if (platform === 'darwin') {
    try {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/ { print $3 }'", {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim().replace(/"/g, '');
      if (out) return out;
    } catch {
      // continue
    }
  }

  // Pure fallback based on network interfaces + platform
  return 'FALLBACK_SYS_UUID';
}

/**
 * Gets first physical MAC address from network interfaces
 */
function getPrimaryMac() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        return net.mac;
      }
    }
  }
  return '00:00:00:00:00:00';
}

/**
 * Generates a deterministic, unique 1-PC HWID hardware fingerprint (SHA-256)
 */
export function getHardwareFingerprint(options = {}) {
  if (options.forceFresh !== true && inMemoryHwid) {
    return inMemoryHwid;
  }

  const cachePath = options.cachePath || DEFAULT_CACHE_PATH;

  // Check persistent disk cache
  if (options.forceFresh !== true && fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (data && data.hwid && typeof data.hwid === 'string' && data.hwid.length === 64) {
        inMemoryHwid = data.hwid;
        return inMemoryHwid;
      }
    } catch {
      // Corrupt cache, regenerate
    }
  }

  const systemUuid = options.mockUuid || getSystemUuid();
  const cpuModel = options.mockCpu || (os.cpus()[0]?.model || 'UNKNOWN_CPU');
  const totalMem = options.mockMem || Math.round(os.totalmem() / (1024 * 1024 * 1024)); // in GB
  const primaryMac = options.mockMac || getPrimaryMac();
  const platform = os.platform();
  const arch = os.arch();

  const rawFingerprint = [
    systemUuid,
    cpuModel,
    totalMem,
    primaryMac,
    platform,
    arch
  ].join(':::');

  const hwid = crypto.createHash('sha256').update(rawFingerprint).digest('hex');
  inMemoryHwid = hwid;

  // Persist to disk
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify({
      hwid,
      systemUuid: systemUuid.slice(0, 8) + '...',
      createdAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal if disk write fails
  }

  return hwid;
}
