import { frontmatterBody } from './text';
/** Plugin-owned scalar properties only; unknown YAML is never parsed or reformatted. */
export function property(content: string, key: string): string | null | undefined {
  const prefix = frontmatterBody(content).prefix;
  const match = new RegExp(`^${key}:\\s*([^\\r\\n]*)`, 'm').exec(prefix);
  if (!match) return undefined;
  const value = match[1].trim();
  if (value === 'null' || value === '~') return null;
  if (value.startsWith('"')) { const parsed: unknown = JSON.parse(value); if (typeof parsed !== 'string') throw new Error(`${key} 必须为文字`); return parsed; }
  if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (/^[\[{>|]/.test(value)) throw new Error(`${key} 必须为单行文字`);
  return value;
}
export function setProperty(content: string, key: string, value: string | null): string {
  const { prefix, body } = frontmatterBody(content); const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const line = `${key}: ${JSON.stringify(value)}`;
  if (!prefix) return `---${newline}${line}${newline}---${newline}${content}`;
  const pattern = new RegExp(`^${key}:[^\\r\\n]*`, 'm');
  return (pattern.test(prefix) ? prefix.replace(pattern, line) : prefix.replace(/\r?\n---(?:\r?\n|$)$/, `${newline}${line}${newline}---${newline}`)) + body;
}
