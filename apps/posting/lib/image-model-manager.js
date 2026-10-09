import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_MODEL_CATALOG = {
  // Google Imagen through the Gemini (agy) subscription is the only image model. When it cannot
  // generate (quota, network), ai-image-generator falls back to a matching photo on its own.
  'gemini-imagen': {
    id: 'gemini-imagen',
    name: '💎 Google Imagen (Gemini 구독 연동)',
    type: 'remote',
    sizeFormatted: '구독 연동',
    description: '글 내용에 맞춰 Google Imagen이 그림을 새로 그립니다. 한 장에 1분쯤 걸리고 3장을 동시에 만듭니다. 한도 초과 등으로 못 그리면 주제에 맞는 사진으로 대신 채웁니다.',
    isDefault: true
  }
};

export class ImageModelManager extends EventEmitter {
  constructor({ engineDir, configPath }) {
    super();
    this.engineDir = engineDir;
    this.configPath = configPath;
    this.activeModelId = 'gemini-imagen';
    this.agyClient = null;
  }

  async init() {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    try {
      const c = JSON.parse(await readFile(this.configPath, 'utf8'));
      if (IMAGE_MODEL_CATALOG[c.activeModelId]) {
        this.activeModelId = c.activeModelId;
      } else {
        this.activeModelId = 'gemini-imagen';
      }
    } catch {
      this.activeModelId = 'gemini-imagen';
    }
  }

  async installed(id) {
    return id in IMAGE_MODEL_CATALOG;
  }

  async list() {
    return Object.values(IMAGE_MODEL_CATALOG).map((m) => ({
      ...m,
      isInstalled: true,
      isActive: m.id === this.activeModelId,
      isDownloading: false,
      downloadedBytes: 0,
      downloadedFormatted: '클라우드 연동',
      percent: 100
    }));
  }

  async select(id) {
    const m = IMAGE_MODEL_CATALOG[id];
    if (!m) throw new Error('존재하지 않는 이미지 모델입니다.');
    this.activeModelId = id;
    await writeFile(this.configPath, JSON.stringify({ activeModelId: id }, null, 2));
    return m;
  }

  async download(id) {
    return { ok: true, message: '클라우드 모델은 별도 다운로드가 필요 없습니다.', id };
  }
}
