import fs from 'node:fs';
import { stat, mkdir, readdir, unlink, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MODEL_CATALOG } from './hardware.js';

// Versions before the catalog correction called Gemma 2 files "Gemma 4".
// Preserve the user's usable local model while removing the false identity.
const LEGACY_MODEL_ID_ALIASES = {
  'gemma-4-12b': 'gemma-4-12b-it-qat-q4-0',
  'gemma-4-e4b': 'gemma-4-e4b-it-qat-q4-0',
  'gemma-4-e2b': 'gemma-4-e2b-it-qat-q4-0'
};

export class ModelManager extends EventEmitter {
  constructor(modelsDir = path.join(process.cwd(), '.models'), configPath = path.join(process.cwd(), '.data', 'ai-config.json')) {
    super();
    this.modelsDir = modelsDir;
    this.configPath = configPath;
    this.activeDownloads = new Map(); // modelId -> AbortController
    this.activeModelId = null;
  }

  async init() {
    await mkdir(this.modelsDir, { recursive: true }).catch(() => {});
    await mkdir(path.dirname(this.configPath), { recursive: true }).catch(() => {});
    await this.loadConfig();
  }

  async loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const configuredId = parsed.activeModelId || null;
        this.activeModelId = LEGACY_MODEL_ID_ALIASES[configuredId] || configuredId;
        if (this.activeModelId !== configuredId) await this.saveConfig();
      }
    } catch {
      this.activeModelId = null;
    }
  }

  async saveConfig() {
    try {
      await writeFile(this.configPath, JSON.stringify({
        activeModelId: this.activeModelId,
        updatedAt: new Date().toISOString()
      }, null, 2), 'utf-8');
    } catch {}
  }

  async getInstalledModels() {
    await this.init();
    const result = [];
    const files = await readdir(this.modelsDir).catch(() => []);

    for (const [id, meta] of Object.entries(MODEL_CATALOG)) {
      const targetPath = path.join(this.modelsDir, meta.filename);
      const isInstalled = files.includes(meta.filename);
      let fileSizeBytes = 0;
      if (isInstalled) {
        try {
          const stats = await stat(targetPath);
          fileSizeBytes = stats.size;
        } catch {}
      }

      result.push({
        ...meta,
        isInstalled,
        isActive: this.activeModelId === id,
        fileSizeBytes,
        actualPath: isInstalled ? targetPath : null,
        isDownloading: this.activeDownloads.has(id)
      });
    }

    return result;
  }

  async getActiveModel() {
    const models = await this.getInstalledModels();
    let active = models.find((m) => m.isActive && m.isInstalled);
    if (!active) {
      // Pick first installed model if active one is not found
      active = models.find((m) => m.isInstalled);
      if (active) {
        this.activeModelId = active.id;
        await this.saveConfig();
      }
    }
    return active || null;
  }

  async setActiveModel(modelId) {
    const meta = MODEL_CATALOG[modelId];
    if (!meta) throw new Error(`존재하지 않는 모델 ID입니다: ${modelId}`);
    
    const targetPath = path.join(this.modelsDir, meta.filename);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`모델 파일이 다운로드되어 있지 않습니다: ${meta.filename}`);
    }

    this.activeModelId = modelId;
    await this.saveConfig();
    this.emit('model_changed', { modelId, model: meta, path: targetPath });
    return meta;
  }

  async downloadModel(modelId, onProgress = null) {
    const meta = MODEL_CATALOG[modelId];
    if (!meta) throw new Error(`존재하지 않는 모델 ID입니다: ${modelId}`);

    if (this.activeDownloads.has(modelId)) {
      throw new Error('해당 모델은 이미 다운로드가 진행 중입니다.');
    }

    await mkdir(this.modelsDir, { recursive: true }).catch(() => {});
    const targetPath = path.join(this.modelsDir, meta.filename);
    const tempPath = `${targetPath}.download`;

    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    try {
      this.emit('download_start', { modelId, meta });
      const response = await fetch(meta.downloadUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'NeighborMate-AI-Downloader/1.0' }
      });

      if (!response.ok) {
        throw new Error(`다운로드 서버 오류: HTTP ${response.status} ${response.statusText}`);
      }

      const totalBytes = Number(response.headers.get('content-length')) || meta.sizeBytes || 0;
      let downloadedBytes = 0;
      let startTime = Date.now();
      let lastEmitTime = startTime;

      const fileStream = fs.createWriteStream(tempPath);
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fileStream.write(Buffer.from(value));
        downloadedBytes += value.length;

        const now = Date.now();
        if (now - lastEmitTime > 300) {
          lastEmitTime = now;
          const elapsedSec = (now - startTime) / 1000;
          const speedBps = elapsedSec > 0 ? downloadedBytes / elapsedSec : 0;
          const speedMbps = (speedBps / (1024 * 1024)).toFixed(1);
          const percent = totalBytes > 0 ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 99) : 0;
          const remainingSec = speedBps > 0 && totalBytes > downloadedBytes 
            ? Math.round((totalBytes - downloadedBytes) / speedBps) 
            : 0;

          const progressData = {
            modelId,
            percent,
            downloadedBytes,
            totalBytes,
            downloadedFormatted: `${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB`,
            totalFormatted: `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`,
            speedMbps: `${speedMbps} MB/s`,
            remainingSec
          };

          if (onProgress) onProgress(progressData);
          this.emit('download_progress', progressData);
        }
      }

      fileStream.end();
      await new Promise((resolve) => fileStream.on('finish', resolve));

      if (meta.sizeBytes && downloadedBytes < meta.sizeBytes * 0.94) {
        throw new Error(`다운로드 파일 크기가 예상보다 작습니다 (${downloadedBytes} / ${meta.sizeBytes} bytes). 모델 파일을 저장하지 않았습니다.`);
      }

      // Rename .download to actual .gguf
      if (fs.existsSync(targetPath)) {
        await unlink(targetPath).catch(() => {});
      }
      await fs.promises.rename(tempPath, targetPath);

      // Auto-set as active if no active model exists
      if (!this.activeModelId) {
        this.activeModelId = modelId;
        await this.saveConfig();
      }

      this.activeDownloads.delete(modelId);
      const completeData = { modelId, meta, path: targetPath };
      this.emit('download_complete', completeData);
      return completeData;
    } catch (err) {
      this.activeDownloads.delete(modelId);
      await unlink(tempPath).catch(() => {});
      if (err.name === 'AbortError') {
        this.emit('download_aborted', { modelId });
        throw new Error('다운로드가 취소되었습니다.');
      }
      this.emit('download_error', { modelId, error: err.message });
      throw err;
    }
  }

  cancelDownload(modelId) {
    const controller = this.activeDownloads.get(modelId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(modelId);
      return true;
    }
    return false;
  }

  async deleteModel(modelId) {
    const meta = MODEL_CATALOG[modelId];
    if (!meta) throw new Error(`존재하지 않는 모델 ID입니다: ${modelId}`);

    const targetPath = path.join(this.modelsDir, meta.filename);
    if (fs.existsSync(targetPath)) {
      await unlink(targetPath);
    }

    if (this.activeModelId === modelId) {
      this.activeModelId = null;
      await this.saveConfig();
    }

    this.emit('model_deleted', { modelId });
    return true;
  }
}
