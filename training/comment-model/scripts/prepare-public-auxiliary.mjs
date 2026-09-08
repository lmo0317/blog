import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(here, '../data');
const rawRoot = path.join(dataRoot, 'raw/public');
const outputDir = path.join(dataRoot, 'processed');
const reportDir = path.join(dataRoot, 'reports');

const sources = [
  {
    id: 'heegyu/open-korean-instructions',
    license: 'mit',
    format: 'concatenated',
    files: ['OIG-smallchip2-ko.json', 'koalpaca.json', 'korquad-chat.json', 'sharegpt_deepl_ko.json']
      .map((name) => path.join(rawRoot, 'heegyu__open-korean-instructions', name))
  },
  {
    id: 'nlpai-lab/kullm-v2',
    license: 'apache-2.0',
    format: 'jsonl',
    files: [path.join(rawRoot, 'nlpai-lab__kullm-v2', 'kullm-v2.jsonl')]
  },
  {
    id: 'changpt/ko-lima-vicuna',
    license: 'cc-by-2.0',
    format: 'array',
    files: [path.join(rawRoot, 'changpt__ko-lima-vicuna', 'ko_lima_vicuna.json')]
  }
];

const normalize = (value) => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const koreanCount = (text) => (text.match(/[가-힣]/g) || []).length;
const blocked = /https?:\/\/|www\.|```|<\/?(?:html|script)|\b(?:ffmpeg|python|javascript|function|SELECT|INSERT)\b/i;
const genericAssistant = /(?:AI|인공지능) (?:어시스턴트|언어 모델)|개인적인 경험(?:이|을) 없|도와드릴 수 없/i;

function qualify(input, output) {
  const prompt = normalize(input);
  const answer = normalize(output);
  if (prompt.length < 8 || prompt.length > 1500 || answer.length < 15 || answer.length > 220) return null;
  if (koreanCount(prompt) < 5 || koreanCount(answer) < 8) return null;
  if (blocked.test(prompt) || blocked.test(answer) || genericAssistant.test(answer)) return null;
  if ((answer.match(/[{}[\]<>]/g) || []).length > 1) return null;
  return { input: prompt, output: answer };
}

function pairsFromRecord(record) {
  if (record && typeof record.text === 'string') {
    const match = record.text.match(/<usr>\s*([\s\S]*?)\s*<bot>\s*([\s\S]*)$/i);
    return match ? [[match[1], match[2]]] : [];
  }
  if (record && typeof record.instruction === 'string' && typeof record.output === 'string') {
    return [[`${record.instruction}\n${record.input || ''}`, record.output]];
  }
  if (Array.isArray(record?.conversations)) {
    const pairs = [];
    for (let index = 0; index < record.conversations.length - 1; index += 1) {
      const current = record.conversations[index];
      const next = record.conversations[index + 1];
      if (current?.from === 'human' && next?.from === 'gpt') pairs.push([current.value, next.value]);
    }
    return pairs;
  }
  return [];
}

async function* concatenatedObjects(file) {
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  let object = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for await (const chunk of stream) {
    for (const char of chunk) {
      if (depth === 0 && char !== '{') continue;
      object += char;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          yield JSON.parse(object);
          object = '';
        }
      }
    }
  }
  if (depth !== 0) throw new Error(`Incomplete JSON object in ${file}`);
}

async function* jsonLines(file) {
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) yield JSON.parse(line);
}

async function* jsonArray(file) {
  const records = JSON.parse(await fsp.readFile(file, 'utf8'));
  for (const record of records) yield record;
}

await fsp.mkdir(outputDir, { recursive: true });
await fsp.mkdir(reportDir, { recursive: true });
const outputFile = path.join(outputDir, 'public-short-korean-candidates.jsonl');
const writer = fs.createWriteStream(outputFile, { encoding: 'utf8' });
const seen = new Set();
const report = { generatedAt: new Date().toISOString(), scanned: 0, accepted: 0, duplicates: 0, bySource: {} };

for (const source of sources) {
  const sourceStats = { scanned: 0, accepted: 0 };
  report.bySource[source.id] = sourceStats;
  for (const file of source.files) {
    const iterator = source.format === 'jsonl' ? jsonLines(file) : source.format === 'array' ? jsonArray(file) : concatenatedObjects(file);
    for await (const record of iterator) {
      report.scanned += 1;
      sourceStats.scanned += 1;
      for (const [input, output] of pairsFromRecord(record)) {
        const candidate = qualify(input, output);
        if (!candidate) continue;
        const key = `${candidate.input}\u0000${candidate.output}`.toLowerCase();
        if (seen.has(key)) {
          report.duplicates += 1;
          continue;
        }
        seen.add(key);
        writer.write(`${JSON.stringify({
          task: 'korean_short_response_auxiliary',
          ...candidate,
          source: source.id,
          license: source.license,
          quality: 'public_auxiliary_review_required',
          usableForBlogSft: false
        })}\n`);
        report.accepted += 1;
        sourceStats.accepted += 1;
      }
    }
  }
}

await new Promise((resolve, reject) => writer.end(resolve).on('error', reject));
await fsp.writeFile(path.join(reportDir, 'public-auxiliary-preparation.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

