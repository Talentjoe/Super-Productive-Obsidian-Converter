import { frontmatterBody, stableId } from './text';

export interface EmbeddedReference { path: string; body: string }
export interface NoteParts { own: string; embedded: EmbeddedReference[] }
const START = '<!-- sp-references:start -->', END = '<!-- sp-references:end -->';
const decodeId = (hex: string) => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16)));
export function noteParts(content: string): NoteParts {
  const a = content.indexOf(START), b = content.indexOf(END);
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || content.indexOf(START, a + START.length) >= 0 || content.indexOf(END, b + END.length) >= 0))) throw new Error('引用区块边界损坏，请恢复 sp-references 标记');
  if (a < 0) return { own: content, embedded: [] };
  const section = content.slice(a + START.length, b), embedded: EmbeddedReference[] = [];
  const pattern = /<!-- sp-ref:([a-f0-9]+):start -->\n([\s\S]*?)\n<!-- sp-ref:\1:end -->/g;
  const seen = new Set<string>();
  for (const match of section.matchAll(pattern)) {
    const path = decodeId(match[1]); if (seen.has(path)) throw new Error('引用区块重复'); seen.add(path);
    embedded.push({ path, body: match[2] });
  }
  const leftovers = section.replace(pattern, '');
  if (/<!-- sp-ref:/.test(leftovers)) throw new Error('引用正文边界损坏，请保留 sp-ref 标记');
  const before = content.slice(0, a);
  const own = (before.endsWith('\n\n') ? before.slice(0, -2) : before) + content.slice(b + END.length);
  return { own, embedded };
}
export function composeNote(own: string, references: EmbeddedReference[], excerpts: Array<{ target: string; body: string }> = []): string {
  if (!references.length && !excerpts.length) return own;
  const sections = references.map(({ path, body }) => `### [[${path.replace(/\.md$/, '')}]]\n<!-- sp-ref:${stableId(path)}:start -->\n${body}\n<!-- sp-ref:${stableId(path)}:end -->`);
  sections.push(...excerpts.map(({ target, body }) => `### [[${target}]]（只读摘录）\n${body}`));
  return `${own}\n\n${START}\n${sections.join('\n\n')}\n${END}`;
}
export function referenceTargets(own: string): string[] {
  const readable = own.replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\s*\2[^\n]*(?=\n|$)/g, '').replace(/`[^`\n]*`/g, '');
  const targets = [...readable.matchAll(/!?\[\[([^\]\n]+)\]\]/g)].map((match) => match[1].split('|')[0].trim());
  for (const match of readable.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && /\.md(?:#|$)/i.test(target)) { try { targets.push(decodeURIComponent(target)); } catch { targets.push(target); } }
  }
  return [...new Set(targets)];
}
export function resolveReference(target: string, origin: string, files: string[]): { path: string; anchor: string | null } {
  const [name, ...anchors] = target.split('#');
  const anchor = anchors.length ? anchors.join('#') : null;
  const clean = name.replace(/^\//, '').replace(/\\/g, '/');
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean)) throw new Error(`引用路径无效：${target}`);
  const wanted = clean.endsWith('.md') ? clean : `${clean}.md`;
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
    }
    return parts.join('/');
  };
  const relative = normalize(`${origin.slice(0, origin.lastIndexOf('/') + 1)}${wanted}`);
  if (!relative) throw new Error(`引用超出 vault：${target}`);
  if (files.includes(wanted)) return { path: wanted, anchor };
  if (files.includes(relative)) return { path: relative, anchor };
  if (wanted.includes('/')) throw new Error(`引用不存在：${target}`);
  const matches = files.filter((path) => path.split('/').at(-1) === wanted);
  if (matches.length !== 1) throw new Error(matches.length ? `引用重名，请使用 vault 内完整路径：${target}` : `引用不存在：${target}`);
  return { path: matches[0], anchor };
}
export function excerpt(content: string, anchor: string): string {
  const lines = frontmatterBody(content).body.split(/\r?\n/);
  if (anchor.startsWith('^')) {
    const index = lines.findIndex((line) => line.trimEnd().endsWith(anchor));
    if (index < 0) throw new Error(`找不到 block：${anchor}`);
    let start = index; while (start > 0 && lines[start - 1].trim()) start--;
    return lines.slice(start, index + 1).join('\n');
  }
  const index = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim() === anchor);
  if (index < 0) throw new Error(`找不到标题：${anchor}`);
  const level = /^#+/.exec(lines[index])![0].length;
  let end = index + 1; while (end < lines.length && !(new RegExp(`^#{1,${level}}\\s`)).test(lines[end])) end++;
  return lines.slice(index, end).join('\n');
}
