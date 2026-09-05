import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class CommentReplyStore {
  constructor(filePath) { this.filePath = filePath; this.records = []; this.loaded = false; }
  async load() { if (this.loaded) return; try { const data = JSON.parse(await readFile(this.filePath, 'utf8')); this.records = Array.isArray(data.records) ? data.records : []; } catch { this.records = []; } this.loaded = true; }
  key(postUrl, commentId) { return `${String(postUrl).replace(/[?#].*$/, '')}::${String(commentId)}`; }
  async has(postUrl, commentId) { await this.load(); const key = this.key(postUrl, commentId); return this.records.some((item) => item.key === key && (item.replied || item.status === 'completed')); }
  async add(record) { await this.load(); const saved = { ...record, key: this.key(record.postUrl, record.commentId), repliedAt: new Date().toISOString() }; this.records = [saved, ...this.records.filter((item) => item.key !== saved.key)].slice(0, 2000); await mkdir(path.dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2), 'utf8'); return saved; }
  async list() { await this.load(); return [...this.records]; }
}
