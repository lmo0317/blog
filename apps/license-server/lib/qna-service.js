import { hashPassword, verifyPassword } from './crypto-utils.js';

const PAGE_SIZE = 15;
const LIMITS = { nickname: 20, title: 80, body: 3000, answer: 5000 };
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

const clean = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const fail = (error, message) => ({ ok: false, error, message });

// Q&A board on the promo site: anyone can ask, the seller answers from /admin.
// A question keeps a hashed password so its asker can open it (if private) or delete it.
export class QnaService {
  constructor(licenseDb, { maxPostsPerHour = 5, maxPasswordFailures = 10, now = () => Date.now() } = {}) {
    this.db = licenseDb.db;
    this.maxPostsPerHour = maxPostsPerHour;
    this.maxPasswordFailures = maxPasswordFailures;
    this.now = now;
    this.posts = new Map();
    this.failures = new Map();
    // Boards made before view counts existed get the column.
    const columns = this.db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
    if (!columns.includes('views')) this.db.exec('ALTER TABLE questions ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
  }

  // Board rows: a private question shows neither its title nor its body.
  summarize(row) {
    const isPrivate = Boolean(row.is_private);
    return {
      id: row.id,
      nickname: row.nickname,
      title: isPrivate ? '' : row.title,
      isPrivate,
      answered: row.answer != null,
      views: Number(row.views || 0),
      createdAt: row.created_at,
      answeredAt: row.answered_at
    };
  }

  detail(row) {
    return {
      id: row.id,
      nickname: row.nickname,
      title: row.title,
      body: row.body,
      isPrivate: Boolean(row.is_private),
      answer: row.answer,
      answeredAt: row.answered_at,
      views: Number(row.views || 0),
      createdAt: row.created_at
    };
  }

  // The older and newer question around one, for the 이전글/다음글 links.
  neighbors(id) {
    const older = this.db.prepare('SELECT * FROM questions WHERE id < ? ORDER BY id DESC LIMIT 1').get(id);
    const newer = this.db.prepare('SELECT * FROM questions WHERE id > ? ORDER BY id ASC LIMIT 1').get(id);
    return { prev: older ? this.summarize(older) : null, next: newer ? this.summarize(newer) : null };
  }

  countView(row) {
    this.db.prepare('UPDATE questions SET views = views + 1 WHERE id = ?').run(row.id);
    return { ...row, views: Number(row.views || 0) + 1 };
  }

  get(id) {
    return this.db.prepare('SELECT * FROM questions WHERE id = ?').get(Math.trunc(Number(id)) || 0);
  }

  // Search looks at titles and bodies of public questions, and at every asker's nickname.
  list({ page = 1, limit = PAGE_SIZE, query = '', field = 'all' } = {}) {
    const size = Math.min(PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || PAGE_SIZE));
    const q = clean(query, 40);
    let where = '';
    let args = [];
    if (q) {
      const like = `%${q.replace(/[!%_]/g, (c) => `!${c}`)}%`;
      const text = "(is_private = 0 AND (title LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!'))";
      const nick = "nickname LIKE ? ESCAPE '!'";
      if (field === 'nickname') { where = `WHERE ${nick}`; args = [like]; }
      else if (field === 'title') { where = `WHERE ${text}`; args = [like, like]; }
      else { where = `WHERE (${text} OR ${nick})`; args = [like, like, like]; }
    }
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM questions ${where}`).get(...args).n);
    const pages = Math.max(1, Math.ceil(total / size));
    const current = Math.min(pages, Math.max(1, Math.trunc(Number(page)) || 1));
    const rows = this.db.prepare(`SELECT * FROM questions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, size, (current - 1) * size);
    return { ok: true, items: rows.map((r) => this.summarize(r)), page: current, pages, total, pageSize: size };
  }

  read(id) {
    const row = this.get(id);
    if (!row) return fail('NOT_FOUND', '삭제됐거나 없는 질문입니다.');
    if (row.is_private) {
      return { ...fail('PRIVATE', '비밀글입니다. 글을 쓸 때 정한 비밀번호를 입력해 주세요.'), question: this.summarize(row), ...this.neighbors(row.id) };
    }
    return { ok: true, question: this.detail(this.countView(row)), ...this.neighbors(row.id) };
  }

  // Too many wrong passwords from one IP locks it out for the rest of the window.
  checkPassword(row, password, ip) {
    const now = this.now();
    const record = this.failures.get(ip);
    if (record && now - record.since > WINDOW_MS) this.failures.delete(ip);
    if ((this.failures.get(ip)?.count || 0) >= this.maxPasswordFailures) {
      return fail('TOO_MANY_ATTEMPTS', '비밀번호를 여러 번 틀렸습니다. 15분 뒤 다시 시도해 주세요.');
    }
    if (!verifyPassword(String(password || ''), row.password_hash, row.password_salt)) {
      const current = this.failures.get(ip) || { count: 0, since: now };
      this.failures.set(ip, { count: current.count + 1, since: current.since });
      return fail('WRONG_PASSWORD', '비밀번호가 맞지 않습니다.');
    }
    return null;
  }

  open(id, { password, ip = '' } = {}) {
    const row = this.get(id);
    if (!row) return fail('NOT_FOUND', '삭제됐거나 없는 질문입니다.');
    const denied = this.checkPassword(row, password, ip);
    if (denied) return denied;
    return { ok: true, question: this.detail(this.countView(row)), ...this.neighbors(row.id) };
  }

  create({ nickname, password, title, body, isPrivate = false, website = '', ip = '' } = {}) {
    // A hidden form field only bots fill in.
    if (clean(website, 200)) return fail('REJECTED', '질문을 등록하지 못했습니다.');
    const fields = { nickname: clean(nickname, LIMITS.nickname), title: clean(title, LIMITS.title), body: clean(body, LIMITS.body) };
    const pass = String(password ?? '');
    if (!fields.nickname) return fail('NICKNAME_REQUIRED', '닉네임을 입력해 주세요.');
    if (pass.length < 4 || pass.length > 64) return fail('PASSWORD_INVALID', '비밀번호는 4자 이상으로 정해 주세요.');
    if (fields.title.length < 2) return fail('TITLE_REQUIRED', '제목을 두 글자 이상 입력해 주세요.');
    if (fields.body.length < 5) return fail('BODY_REQUIRED', '질문 내용을 다섯 글자 이상 입력해 주세요.');

    const now = this.now();
    const recent = (this.posts.get(ip) || []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= this.maxPostsPerHour) {
      return fail('TOO_MANY_POSTS', '질문을 너무 자주 올렸습니다. 잠시 뒤 다시 시도해 주세요.');
    }
    this.posts.set(ip, [...recent, now]);

    const { hash, salt } = hashPassword(pass);
    const result = this.db.prepare(`
      INSERT INTO questions (nickname, title, body, is_private, password_hash, password_salt, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fields.nickname, fields.title, fields.body, isPrivate ? 1 : 0, hash, salt, String(ip).slice(0, 64), new Date(now).toISOString());
    return { ok: true, question: this.detail(this.get(result.lastInsertRowid)) };
  }

  remove(id, { password, ip = '' } = {}) {
    const row = this.get(id);
    if (!row) return fail('NOT_FOUND', '삭제됐거나 없는 질문입니다.');
    const denied = this.checkPassword(row, password, ip);
    if (denied) return denied;
    this.db.prepare('DELETE FROM questions WHERE id = ?').run(row.id);
    return { ok: true };
  }

  // ---- Seller admin ----
  adminList({ status = 'all' } = {}) {
    const where = status === 'unanswered' ? 'WHERE answer IS NULL' : '';
    const rows = this.db.prepare(`SELECT * FROM questions ${where} ORDER BY (answer IS NULL) DESC, id DESC LIMIT 200`).all();
    return { ok: true, questions: rows.map((r) => this.detail(r)) };
  }

  adminAnswer(id, answer) {
    const row = this.get(id);
    if (!row) return fail('NOT_FOUND', '삭제됐거나 없는 질문입니다.');
    const text = clean(answer, LIMITS.answer);
    if (!text) {
      this.db.prepare('UPDATE questions SET answer = NULL, answered_at = NULL WHERE id = ?').run(row.id);
    } else {
      this.db.prepare('UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?').run(text, new Date(this.now()).toISOString(), row.id);
    }
    return { ok: true, question: this.detail(this.get(row.id)) };
  }

  adminDelete(id) {
    const result = this.db.prepare('DELETE FROM questions WHERE id = ?').run(Math.trunc(Number(id)) || 0);
    if (!Number(result.changes)) return fail('NOT_FOUND', '삭제됐거나 없는 질문입니다.');
    return { ok: true };
  }
}
