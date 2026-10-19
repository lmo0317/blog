import crypto from 'node:crypto';
import { isEmail } from './mailer.js';

const HOUR_MS = 60 * 60 * 1000;
const LIMITS = { name: 20, body: 3000, reply: 5000 };
export const TOPICS = { usage: '사용 방법', error: '오류·버그', billing: '구매·이용권', other: '기타' };
const SITE = 'https://minohlee.mooo.com/neighbormate-app';

const clean = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const fail = (error, message) => ({ ok: false, error, message });

// 1:1 inquiries from the promo site's contact page (/neighbormate-app/contact.html).
// The customer needs no account: the thread lives at a secret link (contact.html#t=<token>), kept in their
// browser and sent in every reply mail. The seller answers from /admin; each answer is mailed to the customer,
// and each customer message is mailed to the seller's own mailbox.
export class InquiryService {
  constructor(licenseDb, { mailer = null, notifyTo = '', maxPerHour = 5, maxMessagesPerHour = 30, now = () => Date.now() } = {}) {
    this.db = licenseDb.db;
    this.mailer = mailer;
    this.notifyTo = notifyTo || mailer?.user || '';
    this.maxPerHour = maxPerHour;
    this.maxMessagesPerHour = maxMessagesPerHour;
    this.now = now;
    this.hits = new Map();
    this.pendingMail = [];
  }

  iso() { return new Date(this.now()).toISOString(); }

  // Per-IP rate limit for one kind of action.
  allow(kind, ip, max) {
    const now = this.now();
    const key = `${kind}:${ip}`;
    const recent = (this.hits.get(key) || []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= max) return false;
    this.hits.set(key, [...recent, now]);
    return true;
  }

  byToken(token) {
    const t = String(token || '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
    return this.db.prepare('SELECT * FROM inquiries WHERE token = ?').get(t) || null;
  }

  byId(id) {
    return this.db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Math.trunc(Number(id)) || 0) || null;
  }

  messages(id) {
    return this.db.prepare('SELECT id, sender, body, mail_status, created_at FROM inquiry_messages WHERE inquiry_id = ? ORDER BY id ASC').all(id)
      .map((m) => ({ id: m.id, sender: m.sender, body: m.body, mailStatus: m.mail_status || '', createdAt: m.created_at }));
  }

  // What the customer sees: never the IP or mail delivery details.
  customerView(row) {
    return {
      inquiry: { email: row.email, name: row.name, topic: row.topic, topicLabel: TOPICS[row.topic] || TOPICS.other, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at },
      messages: this.messages(row.id).map(({ mailStatus, ...m }) => m)
    };
  }

  addMessage(row, sender, body) {
    const at = this.iso();
    const result = this.db.prepare('INSERT INTO inquiry_messages (inquiry_id, sender, body, created_at) VALUES (?, ?, ?, ?)').run(row.id, sender, body, at);
    const status = sender === 'admin' ? 'answered' : 'waiting';
    this.db.prepare('UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?').run(status, at, row.id);
    return Number(result.lastInsertRowid);
  }

  // Mail goes out in the background; the result is stored on the message so the admin page can show it.
  notify(messageId, mail) {
    if (!this.mailer?.configured || !mail.to) {
      this.db.prepare('UPDATE inquiry_messages SET mail_status = ? WHERE id = ?').run(this.mailer?.configured ? 'no-address' : 'off', messageId);
      return Promise.resolve();
    }
    const job = this.mailer.send(mail).then((result) => {
      this.db.prepare('UPDATE inquiry_messages SET mail_status = ? WHERE id = ?').run(result.ok ? 'sent' : `failed: ${String(result.error || '').slice(0, 120)}`, messageId);
    });
    this.pendingMail.push(job);
    return job;
  }

  /** Waits for mails started so far (tests). */
  async flush() {
    const jobs = this.pendingMail.splice(0);
    await Promise.all(jobs);
  }

  link(row) { return `${SITE}/contact.html#t=${row.token}`; }

  notifySeller(row, messageId, body, first) {
    const who = row.name ? `${row.name} (${row.email})` : row.email;
    return this.notify(messageId, {
      to: this.notifyTo,
      replyTo: row.email,
      subject: `[이웃메이트 1:1 문의] ${first ? '새 문의' : '추가 메시지'} · ${TOPICS[row.topic] || TOPICS.other} · ${who}`,
      text: `${who} 님이 ${first ? '1:1 문의를 남겼습니다' : '문의에 메시지를 더 남겼습니다'}.\n\n${body}\n\n관리자 페이지에서 답변하기: https://minohlee.mooo.com/license/admin#qna`
    });
  }

  // ---- Customer (contact page) ----
  create({ email, name = '', topic = 'other', body, website = '', ip = '' } = {}) {
    if (clean(website, 200)) return fail('REJECTED', '문의를 보내지 못했습니다.');
    const address = clean(email, 120).toLowerCase();
    const text = clean(body, LIMITS.body);
    if (!isEmail(address)) return fail('EMAIL_INVALID', '답변 받을 이메일 주소를 정확히 입력해 주세요.');
    if (text.length < 5) return fail('BODY_REQUIRED', '문의 내용을 다섯 글자 이상 적어 주세요.');
    if (!this.allow('create', ip, this.maxPerHour)) return fail('TOO_MANY', '문의를 너무 자주 보냈습니다. 잠시 뒤 다시 시도해 주세요.');
    const token = crypto.randomBytes(24).toString('base64url');
    const at = this.iso();
    const result = this.db.prepare(`
      INSERT INTO inquiries (token, email, name, topic, status, ip, created_at, updated_at) VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?)
    `).run(token, address, clean(name, LIMITS.name), TOPICS[topic] ? topic : 'other', String(ip).slice(0, 64), at, at);
    const row = this.byId(result.lastInsertRowid);
    const messageId = this.addMessage(row, 'customer', text);
    this.notifySeller(row, messageId, text, true);
    return { ok: true, token, ...this.customerView(this.byId(row.id)) };
  }

  thread(token) {
    const row = this.byToken(token);
    if (!row) return fail('NOT_FOUND', '문의를 찾지 못했습니다. 링크가 맞는지 확인해 주세요.');
    return { ok: true, ...this.customerView(row) };
  }

  reply(token, { body, ip = '' } = {}) {
    const row = this.byToken(token);
    if (!row) return fail('NOT_FOUND', '문의를 찾지 못했습니다. 링크가 맞는지 확인해 주세요.');
    const text = clean(body, LIMITS.body);
    if (text.length < 2) return fail('BODY_REQUIRED', '메시지를 입력해 주세요.');
    if (!this.allow('message', ip, this.maxMessagesPerHour)) return fail('TOO_MANY', '메시지를 너무 자주 보냈습니다. 잠시 뒤 다시 시도해 주세요.');
    const messageId = this.addMessage(row, 'customer', text);
    this.notifySeller(row, messageId, text, false);
    return { ok: true, ...this.customerView(this.byId(row.id)) };
  }

  // ---- Seller admin ----
  adminList({ status = 'waiting' } = {}) {
    const where = status === 'waiting' ? "WHERE status = 'waiting'" : '';
    const rows = this.db.prepare(`SELECT * FROM inquiries ${where} ORDER BY (status = 'waiting') DESC, updated_at DESC LIMIT 200`).all();
    const users = new Map(this.db.prepare('SELECT id, LOWER(email) AS email FROM users').all().map((u) => [u.email, u.id]));
    return {
      ok: true,
      inquiries: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        topic: row.topic,
        topicLabel: TOPICS[row.topic] || TOPICS.other,
        status: row.status,
        unread: !row.admin_read_at || row.admin_read_at < row.updated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        customerId: users.get(row.email) || null,
        link: this.link(row),
        messages: this.messages(row.id)
      }))
    };
  }

  adminRead(id) {
    const row = this.byId(id);
    if (!row) return fail('NOT_FOUND', '없는 문의입니다.');
    this.db.prepare('UPDATE inquiries SET admin_read_at = ? WHERE id = ?').run(this.iso(), row.id);
    return { ok: true };
  }

  adminReply(id, body) {
    const row = this.byId(id);
    if (!row) return fail('NOT_FOUND', '없는 문의입니다.');
    const text = clean(body, LIMITS.reply);
    if (!text) return fail('BODY_REQUIRED', '답변을 입력해 주세요.');
    const messageId = this.addMessage(row, 'admin', text);
    this.db.prepare('UPDATE inquiries SET admin_read_at = ? WHERE id = ?').run(this.iso(), row.id);
    this.notify(messageId, {
      to: row.email,
      replyTo: this.notifyTo,
      subject: '[이웃메이트] 1:1 문의에 답변이 도착했습니다',
      text: `안녕하세요${row.name ? `, ${row.name}님` : ''}. 이웃메이트입니다.\n남겨 주신 문의에 답변드립니다.\n\n${text}\n\n─────────────\n대화 이어서 보기·추가 문의: ${this.link(row)}\n(이 메일에 바로 회신하셔도 됩니다.)`
    });
    return { ok: true };
  }

  adminSetStatus(id, status) {
    const row = this.byId(id);
    if (!row) return fail('NOT_FOUND', '없는 문의입니다.');
    if (!['waiting', 'answered', 'closed'].includes(status)) return fail('BAD_STATUS', '알 수 없는 상태입니다.');
    this.db.prepare('UPDATE inquiries SET status = ? WHERE id = ?').run(status, row.id);
    return { ok: true };
  }

  waitingCount() {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'waiting'").get().n);
  }
}
