import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export class NeighborGroupStore {
  constructor(filePath) {
    this.filePath = filePath || path.resolve(process.cwd(), '.data', 'neighbor-group-state.json');
    this.state = {
      activeGroupName: '',
      fullGroupNames: [],
      groupHistory: [],
      lastUpdated: null
    };
    this.loaded = false;
    this.loadSync();
  }

  loadSync() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          activeGroupName: parsed.activeGroupName || '',
          fullGroupNames: Array.isArray(parsed.fullGroupNames) ? parsed.fullGroupNames : [],
          groupHistory: Array.isArray(parsed.groupHistory) ? parsed.groupHistory : [],
          lastUpdated: parsed.lastUpdated || null
        };
        this.loaded = true;
      }
    } catch (e) {
      console.warn('[NeighborGroupStore] Load error (sync):', e.message);
    }
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          activeGroupName: parsed.activeGroupName || '',
          fullGroupNames: Array.isArray(parsed.fullGroupNames) ? parsed.fullGroupNames : [],
          groupHistory: Array.isArray(parsed.groupHistory) ? parsed.groupHistory : [],
          lastUpdated: parsed.lastUpdated || null
        };
      }
      this.loaded = true;
    } catch (e) {
      console.warn('[NeighborGroupStore] Load error (async):', e.message);
    }
  }

  saveSync() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.state.lastUpdated = new Date().toISOString();
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('[NeighborGroupStore] Save error (sync):', e.message);
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      this.state.lastUpdated = new Date().toISOString();
      await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('[NeighborGroupStore] Save error (async):', e.message);
    }
  }

  getActiveGroupName() {
    return this.state.activeGroupName || '';
  }

  setActiveGroupName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    this.state.activeGroupName = trimmed;
    if (!this.state.groupHistory.includes(trimmed)) {
      this.state.groupHistory.push(trimmed);
    }
    this.saveSync();
  }

  isGroupFull(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;
    return this.state.fullGroupNames.includes(trimmed);
  }

  markGroupFull(name) {
    const trimmed = String(name || '').trim();
    if (trimmed && !this.state.fullGroupNames.includes(trimmed)) {
      this.state.fullGroupNames.push(trimmed);
    }
    const nextGroup = this.generateNextGroupName();
    this.state.activeGroupName = nextGroup;
    if (!this.state.groupHistory.includes(nextGroup)) {
      this.state.groupHistory.push(nextGroup);
    }
    this.saveSync();
    return nextGroup;
  }

  generateNextGroupName(basePrefix = '소통이웃') {
    let maxNum = 0;
    const allKnown = [
      ...this.state.fullGroupNames,
      ...this.state.groupHistory,
      this.state.activeGroupName
    ].filter(Boolean);

    for (const g of allKnown) {
      const m = String(g).match(/(?:소통이웃-|이웃-?|그룹-?)(\d+)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const nextNum = maxNum + 1;
    return `${basePrefix}-${nextNum}`;
  }

  getState() {
    return {
      activeGroupName: this.state.activeGroupName || '',
      fullGroupNames: [...this.state.fullGroupNames],
      groupHistory: [...this.state.groupHistory],
      lastUpdated: this.state.lastUpdated
    };
  }
}
