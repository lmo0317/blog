import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export class NeighborHistoryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      records: [], // { blogId, bloggerName, keyword, message, status, statusText, timestamp, date }
      dailyCounts: {} // { 'YYYY-MM-DD': count }
    };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          records: Array.isArray(parsed.records) ? parsed.records : [],
          dailyCounts: parsed.dailyCounts && typeof parsed.dailyCounts === 'object' ? parsed.dailyCounts : {}
        };
      } else {
        await this.save();
      }
    } catch (e) {
      console.error('Failed to load neighbor history store, initializing empty store:', e.message);
      this.data = { records: [], dailyCounts: {} };
    }
    this.loaded = true;
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save neighbor history store:', e.message);
    }
  }

  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async hasHistory(blogId) {
    await this.load();
    const cleanId = String(blogId || '').trim().toLowerCase();
    if (!cleanId) return false;
    return this.data.records.some((r) => String(r.blogId).trim().toLowerCase() === cleanId);
  }

  async getExistingRecord(blogId) {
    await this.load();
    const cleanId = String(blogId || '').trim().toLowerCase();
    return this.data.records.find((r) => String(r.blogId).trim().toLowerCase() === cleanId) || null;
  }

  async addRecord({ blogId, bloggerName = '', keyword = '', message = '', status = 'requested', statusText = '' }) {
    await this.load();
    const today = this.getTodayDateString();
    const cleanId = String(blogId || '').trim();
    if (!cleanId) return;

    const existingIndex = this.data.records.findIndex((r) => String(r.blogId).trim().toLowerCase() === cleanId.toLowerCase());
    const newRecord = {
      blogId: cleanId,
      bloggerName: String(bloggerName || '').trim(),
      keyword: String(keyword || '').trim(),
      message: String(message || '').trim(),
      status,
      statusText: String(statusText || '').trim(),
      timestamp: new Date().toISOString(),
      date: today
    };

    if (existingIndex >= 0) {
      this.data.records[existingIndex] = newRecord;
    } else {
      this.data.records.unshift(newRecord);
    }

    if (status === 'requested' || status === 'added') {
      this.data.dailyCounts[today] = (this.data.dailyCounts[today] || 0) + 1;
    }

    await this.save();
    return newRecord;
  }

  async getTodayCount() {
    await this.load();
    const today = this.getTodayDateString();
    return this.data.dailyCounts[today] || 0;
  }

  async getSummary() {
    await this.load();
    const today = this.getTodayDateString();
    const todayCount = this.data.dailyCounts[today] || 0;
    const totalCount = this.data.records.length;
    const successfulCount = this.data.records.filter((r) => r.status === 'requested' || r.status === 'added').length;

    return {
      todayCount,
      totalCount,
      successfulCount,
      todayDate: today
    };
  }

  async getRecords({ limit = 100, page = 1, keyword = '', status = '' } = {}) {
    await this.load();
    let list = [...this.data.records];
    if (keyword) {
      const q = String(keyword).toLowerCase();
      list = list.filter((r) =>
        r.blogId.toLowerCase().includes(q) ||
        r.bloggerName.toLowerCase().includes(q) ||
        r.keyword.toLowerCase().includes(q)
      );
    }
    if (status) {
      list = list.filter((r) => r.status === status);
    }

    const total = list.length;
    const start = (page - 1) * limit;
    const items = list.slice(start, start + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  async exportCsv() {
    await this.load();
    // BOM for Korean Excel UTF-8 support
    const BOM = '\uFEFF';
    const headers = ['신청일시', '블로그ID', '블로거명', '검색키워드', '상태', '상태메시지', '전송메시지'];
    const rows = this.data.records.map((r) => [
      `"${r.timestamp.replace('T', ' ').slice(0, 19)}"`,
      `"${r.blogId.replace(/"/g, '""')}"`,
      `"${(r.bloggerName || '').replace(/"/g, '""')}"`,
      `"${(r.keyword || '').replace(/"/g, '""')}"`,
      `"${r.status}"`,
      `"${(r.statusText || '').replace(/"/g, '""')}"`,
      `"${(r.message || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    return BOM + csvContent;
  }

  async clear() {
    this.data = { records: [], dailyCounts: {} };
    await this.save();
  }
}

export class EngagementHistoryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      records: [], // { blogId, bloggerName, title, postUrl, keyword, liked, commented, commentText, status, statusMessage, timestamp, date }
      dailyCounts: {} // { 'YYYY-MM-DD': { likes: 0, comments: 0, total: 0 } }
    };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          records: Array.isArray(parsed.records) ? parsed.records : [],
          dailyCounts: parsed.dailyCounts && typeof parsed.dailyCounts === 'object' ? parsed.dailyCounts : {}
        };
      } else {
        await this.save();
      }
    } catch (e) {
      console.error('Failed to load engagement history store, initializing empty store:', e.message);
      this.data = { records: [], dailyCounts: {} };
    }
    this.loaded = true;
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save engagement history store:', e.message);
    }
  }

  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  normalizeUrlKey(url) {
    if (!url) return '';
    const text = String(url).trim();
    try {
      const parsed = new URL(text.startsWith('http') ? text : `https://${text}`);
      const logNo = parsed.searchParams.get('logNo') || parsed.pathname.match(/\/(\d{8,15})(?:\/|$)/)?.[1];
      const blogId = parsed.searchParams.get('blogId') || parsed.pathname.match(/\/(?:PostView\.naver\/)?([^/]+)\/(?:\d{8,15})(?:\/|$)/i)?.[1];
      if (blogId && logNo) return `${blogId.toLowerCase()}/${logNo}`;
      return `${parsed.hostname.replace(/^m\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return text.toLowerCase().replace(/^https?:\/\//, '').replace(/^m\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
  }

  async hasEngagedPost(postUrl, blogId = '') {
    await this.load();
    const urlKey = this.normalizeUrlKey(postUrl);
    const cleanId = String(blogId || '').trim().toLowerCase();

    return this.data.records.some((r) => {
      if (urlKey && this.normalizeUrlKey(r.postUrl) === urlKey) return true;
      if (!urlKey && cleanId && String(r.blogId).trim().toLowerCase() === cleanId) return true;
      return false;
    });
  }

  async getEngagedBlogIds() {
    await this.load();
    return [...new Set(this.data.records.map((r) => String(r.blogId).trim().toLowerCase()).filter(Boolean))];
  }

  async getRecentComments(limit = 30) {
    await this.load();
    return this.data.records.filter((record) => record.commented && record.commentText).slice(0, limit).map((record) => record.commentText);
  }

  async addRecord({
    blogId,
    bloggerName = '',
    title = '',
    postUrl = '',
    keyword = '',
    liked = false,
    commented = false,
    commentText = '',
    neighborRequested = false,
    neighborStatus = '',
    neighborMessage = '',
    status = 'success',
    statusMessage = ''
  }) {
    await this.load();
    const today = this.getTodayDateString();
    const cleanId = String(blogId || '').trim();
    if (!cleanId && !postUrl) return;

    const urlKey = this.normalizeUrlKey(postUrl);
    const existingIndex = this.data.records.findIndex((r) => {
      if (urlKey && this.normalizeUrlKey(r.postUrl) === urlKey) return true;
      if (!urlKey && cleanId && String(r.blogId).trim().toLowerCase() === cleanId.toLowerCase()) return true;
      return false;
    });

    const newRecord = {
      id: `eng_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      blogId: cleanId,
      bloggerName: String(bloggerName || '').trim(),
      title: String(title || '').trim(),
      postUrl: String(postUrl || '').trim(),
      keyword: String(keyword || '').trim(),
      liked: Boolean(liked),
      commented: Boolean(commented),
      commentText: String(commentText || '').trim(),
      neighborRequested: Boolean(neighborRequested),
      neighborStatus: String(neighborStatus || '').trim(),
      neighborMessage: String(neighborMessage || '').trim(),
      status,
      statusMessage: String(statusMessage || '').trim(),
      timestamp: new Date().toISOString(),
      date: today
    };

    if (existingIndex >= 0) {
      this.data.records[existingIndex] = newRecord;
    } else {
      this.data.records.unshift(newRecord);
    }

    if (!this.data.dailyCounts[today]) {
      this.data.dailyCounts[today] = { likes: 0, comments: 0, neighbors: 0, total: 0 };
    }

    if (liked) this.data.dailyCounts[today].likes = (this.data.dailyCounts[today].likes || 0) + 1;
    if (commented) this.data.dailyCounts[today].comments = (this.data.dailyCounts[today].comments || 0) + 1;
    if (neighborRequested) this.data.dailyCounts[today].neighbors = (this.data.dailyCounts[today].neighbors || 0) + 1;
    if (liked || commented || neighborRequested) this.data.dailyCounts[today].total = (this.data.dailyCounts[today].total || 0) + 1;

    await this.save();
    return newRecord;
  }

  async getSummary() {
    await this.load();
    const today = this.getTodayDateString();
    const todayCounts = this.data.dailyCounts[today] || { likes: 0, comments: 0, neighbors: 0, total: 0 };
    const totalRecords = this.data.records.length;
    const totalLikes = this.data.records.filter((r) => r.liked).length;
    const totalComments = this.data.records.filter((r) => r.commented).length;
    const totalNeighbors = this.data.records.filter((r) => r.neighborRequested).length;

    return {
      todayDate: today,
      todayLikes: todayCounts.likes || 0,
      todayComments: todayCounts.comments || 0,
      todayNeighbors: todayCounts.neighbors || 0,
      todayTotal: todayCounts.total || 0,
      totalRecords,
      totalLikes,
      totalComments,
      totalNeighbors
    };
  }

  async getRecords({ limit = 100, page = 1, keyword = '', status = '' } = {}) {
    await this.load();
    let list = [...this.data.records];
    if (keyword) {
      const q = String(keyword).toLowerCase();
      list = list.filter((r) =>
        r.blogId.toLowerCase().includes(q) ||
        r.bloggerName.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.keyword.toLowerCase().includes(q) ||
        r.commentText.toLowerCase().includes(q) ||
        (r.neighborStatus && r.neighborStatus.toLowerCase().includes(q))
      );
    }
    if (status) {
      list = list.filter((r) => r.status === status);
    }

    const total = list.length;
    const start = (page - 1) * limit;
    const items = list.slice(start, start + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  async exportCsv() {
    await this.load();
    const BOM = '\uFEFF';
    const headers = ['소통일시', '블로그ID', '블로거명', '포스팅제목', '포스팅URL', '검색키워드', '공감여부', 'AI댓글내용', '서로이웃신청', '상태', '결과메시지'];
    const rows = this.data.records.map((r) => [
      `"${r.timestamp.replace('T', ' ').slice(0, 19)}"`,
      `"${(r.blogId || '').replace(/"/g, '""')}"`,
      `"${(r.bloggerName || '').replace(/"/g, '""')}"`,
      `"${(r.title || '').replace(/"/g, '""')}"`,
      `"${(r.postUrl || '').replace(/"/g, '""')}"`,
      `"${(r.keyword || '').replace(/"/g, '""')}"`,
      `"${r.liked ? 'O' : 'X'}"`,
      `"${(r.commentText || '').replace(/"/g, '""')}"`,
      `"${r.neighborRequested ? (r.neighborStatus === 'requested' ? '신청완료' : r.neighborStatus) : (r.neighborStatus || '-')}"`,
      `"${r.status}"`,
      `"${(r.statusMessage || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    return BOM + csvContent;
  }

  async clear() {
    this.data = { records: [], dailyCounts: {} };
    await this.save();
  }
}
