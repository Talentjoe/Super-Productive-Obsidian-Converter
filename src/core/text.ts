export function stableId(value: string): string {
  // Reversible, filename and Obsidian block-id safe. Unlike short hashes this cannot collide.
  return Array.from(new TextEncoder().encode(value), (v) => v.toString(16).padStart(2, '0')).join('');
}
export function safeName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1f\[\]#^]/g, '-').replace(/[. ]+$/g, '').slice(0, 70);
  return !clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `_${clean || '未命名'}` : clean;
}
export function link(path: string, label?: string): string {
  return `[[${path.replace(/\.md$/, '')}${label ? `|${label.replace(/[\[\]|\r\n]/g, ' ')}` : ''}]]`;
}
export function frontmatterBody(content: string): { prefix: string; body: string } {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  return { prefix: match?.[0] ?? '', body: content.slice(match?.[0].length ?? 0) };
}
export function generatedBlock(existing: string | null, name: string, body: string, initial: string): string {
  const start = `<!-- sp-generated:${name}:start -->`;
  const end = `<!-- sp-generated:${name}:end -->`;
  const block = `${start}\n${body.trimEnd()}\n${end}`;
  if (existing === null) return `${initial}\n${block}\n`;
  const a = existing.indexOf(start), b = existing.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && b < a) || existing.indexOf(start, a + 1) >= 0) throw new Error(`生成区块损坏：${name}`);
  return a < 0 ? `${existing.trimEnd()}\n\n${block}\n` : existing.slice(0, a) + block + existing.slice(b + end.length);
}
export function operationMarker(operationId: string): string { return `<!-- sp-op:${operationId} -->`; }
export function stripOperationMarkers(notes: string): string { return notes.replace(/\n?<!-- sp-op:[a-zA-Z0-9-]+ -->/g, ''); }
