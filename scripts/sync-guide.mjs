import { readFile, writeFile } from 'node:fs/promises';
for (const [path, guidePath] of [['README.md', 'docs/AI-GUIDE.en.md'], ['README.zh-CN.md', 'docs/AI-GUIDE.md']]) {
  const readme = await readFile(path, 'utf8'), guide = await readFile(guidePath, 'utf8');
  const block = /<!-- ai-guide:start -->[\s\S]*?<!-- ai-guide:end -->/g;
  if ([...readme.matchAll(block)].length !== 1) throw new Error(`Missing or duplicate AI guide block: ${path}`);
  await writeFile(path, readme.replace(block, () => `<!-- ai-guide:start -->\n${guide.trimEnd()}\n<!-- ai-guide:end -->`));
}
