import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// One row per neighbor-management action (accept / reject / hold / withdraw / prune), so the
// activity report can list who was handled and why instead of only daily counts.
export const NEIGHBOR_ACTION_LABELS = {
  accepted: '받은 신청 수락',
  rejected: '받은 신청 거절',
  held: '받은 신청 보류',
  canceled: '보낸 신청 회수',
  removed: '비활성 이웃 정리',
  failed: '처리 실패'
};

export class NeighborActionStore {
  constructor(filePath) { this.filePath = filePath; this.records = []; this.loaded = false; this.writing = Promise.resolve(); }
  async load() {
    if (this.loaded) return;
    try { const data = JSON.parse(await readFile(this.filePath, 'utf8')); this.records = Array.isArray(data.records) ? data.records : []; } catch { this.records = []; }
    this.loaded = true;
  }
  async add({ action, blogId = '', nickname = '', reason = '', source = '' }) {
    await this.load();
    const saved = { action, blogId: String(blogId || ''), nickname: String(nickname || ''), reason: String(reason || ''), source, timestamp: new Date().toISOString() };
    this.records = [saved, ...this.records].slice(0, 5000);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2), 'utf8');
    }).catch(() => {});
    await this.writing;
    return saved;
  }
  async list() { await this.load(); return [...this.records]; }
}
