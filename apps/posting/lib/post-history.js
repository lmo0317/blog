import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function normalize(text) {
  return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^0-9a-z가-힣]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function shingles(text) {
  const compact = normalize(text).replace(/\s/g, '');
  const result = new Set();
  for (let i = 0; i < compact.length - 2; i += 1) result.add(compact.slice(i, i + 3));
  return result;
}

export function contentSimilarity(a, b) {
  const left = shingles(a); const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const value of left) if (right.has(value)) common += 1;
  return common / Math.min(left.size, right.size);
}

export class PostHistoryStore {
  constructor(filePath) { this.filePath = filePath; this.records = []; this.loaded = false; }
  async load() { if (this.loaded) return; try { const parsed=JSON.parse(await readFile(this.filePath,'utf8')); this.records=Array.isArray(parsed.records)?parsed.records:[]; } catch { this.records=[]; } this.loaded=true; }
  async save() { await mkdir(path.dirname(this.filePath),{recursive:true}); await writeFile(this.filePath,JSON.stringify({records:this.records},null,2),'utf8'); }
  async add({title,content,url='',sourceTopic=''}) { await this.load(); const record={id:`post-${Date.now()}`,publishedAt:new Date().toISOString(),title:String(title||'').trim().slice(0,300),sourceTopic:String(sourceTopic||'').trim().slice(0,300),contentSummary:normalize(content).slice(0,1200),url:String(url||'').trim()}; if(!record.title&&!record.contentSummary)return null; this.records.unshift(record); this.records=this.records.slice(0,300); await this.save(); return record; }
  async recent(limit=30) { await this.load(); return this.records.slice(0,limit).map(({publishedAt,title,sourceTopic,url})=>({publishedAt,title,sourceTopic,url})); }
  async findSimilar({title='',content='',topic=''},threshold=.72) { await this.load(); const candidate=`${topic} ${title} ${content}`; let best=null; for(const record of this.records){const score=contentSimilarity(candidate,`${record.sourceTopic} ${record.title} ${record.contentSummary}`); if(!best||score>best.score)best={record,score};} return best&&best.score>=threshold?best:null; }
  async importNaverRss(xml) { const items=String(xml||'').match(/<item>[\s\S]*?<\/item>/g)||[]; let added=0; for(const item of items){const field=(name)=>{const match=item.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`)); return String(match?.[1]||'').replace(/<[^>]+>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();}; const title=field('title'); const content=field('description'); const url=field('guid')||field('link'); if(title&&!this.records.some((record)=>record.url===url||record.title===title)){await this.add({title,content,url,sourceTopic:title}); added+=1;}} return added; }
}
