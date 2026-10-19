import tls from 'node:tls';
import crypto from 'node:crypto';

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
export const isEmail = (value) => EMAIL_RE.test(String(value || '')) && String(value).length <= 120;

const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');
const word = (text) => `=?UTF-8?B?${b64(text)}?=`;
const oneLine = (text) => String(text || '').replace(/[\r\n]+/g, ' ').trim();

/** The RFC 5322 message: UTF-8 plain text, base64 body, encoded subject and sender name. */
export function buildMessage({ from, fromName = '', to, subject, text, replyTo = '' }) {
  const domain = String(from).split('@')[1] || 'localhost';
  const headers = [
    `From: ${fromName ? `${word(oneLine(fromName))} ` : ''}<${from}>`,
    `To: <${to}>`,
    ...(replyTo ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${word(oneLine(subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  const body = b64(String(text || '').replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/**
 * Sends mail through Gmail SMTP (SMTP_USER + SMTP_APP_PASSWORD, the same account the KidsNote service uses).
 * Not configured → { ok: false, skipped: true }, so the inquiry flow works without mail.
 */
export class Mailer {
  constructor({ user = process.env.SMTP_USER, pass = process.env.SMTP_APP_PASSWORD, host = 'smtp.gmail.com', port = 465, fromName = '이웃메이트', transport = null } = {}) {
    this.user = user || '';
    this.pass = pass || '';
    this.host = host;
    this.port = port;
    this.fromName = fromName;
    this.transport = transport; // tests: async (envelope, message) => void
  }

  get configured() {
    return Boolean(this.transport || (this.user && this.pass));
  }

  async send({ to, subject, text, replyTo = '' }) {
    if (!this.configured) return { ok: false, skipped: true, error: '메일 계정이 설정되지 않았습니다.' };
    if (!isEmail(to)) return { ok: false, error: '받는 주소가 올바르지 않습니다.' };
    const message = buildMessage({ from: this.user || 'noreply@localhost', fromName: this.fromName, to, subject, text, replyTo: isEmail(replyTo) ? replyTo : '' });
    try {
      if (this.transport) await this.transport({ from: this.user, to }, message);
      else await this.smtp(to, message);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  smtp(to, message) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(this.port, this.host, { servername: this.host });
      socket.setTimeout(20000, () => socket.destroy(new Error('메일 서버 응답 시간 초과')));
      let buffer = '';
      let waiting = null;
      const finish = (error) => { socket.end(); error ? reject(error) : resolve(); };
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        // A reply is complete at a line "NNN text" (a "NNN-" line means more follow).
        const lines = buffer.split('\r\n');
        const last = lines.findIndex((line) => /^\d{3} /.test(line));
        if (last === -1 || !waiting) return;
        const code = Number(lines[last].slice(0, 3));
        const text = lines.slice(0, last + 1).join(' ');
        buffer = lines.slice(last + 1).join('\r\n');
        const { expect, next } = waiting;
        waiting = null;
        if (code !== expect) return finish(new Error(`메일 서버 오류: ${text.slice(0, 160)}`));
        next();
      });
      const step = (expect, line, next) => {
        waiting = { expect, next };
        if (line != null) socket.write(`${line}\r\n`);
      };
      const dotted = message.replace(/\r\n\./g, '\r\n..');
      step(220, null, () =>
        step(250, 'EHLO neighbormate', () =>
          step(334, 'AUTH LOGIN', () =>
            step(334, b64(this.user), () =>
              step(235, b64(this.pass), () =>
                step(250, `MAIL FROM:<${this.user}>`, () =>
                  step(250, `RCPT TO:<${to}>`, () =>
                    step(354, 'DATA', () =>
                      step(250, `${dotted}\r\n.`, () => { socket.write('QUIT\r\n'); finish(); })))))))));
    });
  }
}
