function clean(value, maxLength) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function valid(items) {
  return items.map((item) => ({ topic: clean(item.topic, 200), content: clean(item.content, 3000) }))
    .filter((item) => item.topic.length >= 2 && item.content.length >= 2)
    .slice(0, 20);
}

export function parseMarkdownBatch(markdown = '') {
  const text = clean(markdown, 100000);
  if (!text) return [];

  const labeled = [];
  const labelPattern = /(?:^|\n)\s*(?:#{1,3}\s*)?주제\s*[:：]\s*(.+?)\s*\n\s*(?:#{1,3}\s*)?내용\s*[:：]?\s*\n([\s\S]*?)(?=\n\s*(?:---+\s*\n)?\s*(?:#{1,3}\s*)?주제\s*[:：]|$)/gi;
  for (const match of text.matchAll(labelPattern)) labeled.push({ topic: match[1], content: match[2].replace(/\n---+\s*$/,'') });
  if (labeled.length) return valid(labeled);

  const headings = [];
  const headingPattern = /^#{1,2}\s+(.+)\n([\s\S]*?)(?=^#{1,2}\s+|$)/gm;
  for (const match of text.matchAll(headingPattern)) headings.push({ topic: match[1], content: match[2] });
  if (headings.length) return valid(headings);

  return valid(text.split(/\n\s*---+\s*\n/).map((block) => {
    const [topic = '', ...lines] = block.trim().split('\n');
    return { topic: topic.replace(/^주제\s*[:：]?\s*/,'').trim(), content: lines.join('\n').replace(/^내용\s*[:：]?\s*/,'').trim() };
  }));
}

