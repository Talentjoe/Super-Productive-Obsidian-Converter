import { readFile, writeFile } from 'node:fs/promises';
const readme = await readFile('README.md', 'utf8');
const guide = await readFile('docs/AI-GUIDE.md', 'utf8');
await writeFile('README.md', readme.replace(/<!-- ai-guide:start -->[\s\S]*?<!-- ai-guide:end -->/, () => `<!-- ai-guide:start -->\n${guide.trimEnd()}\n<!-- ai-guide:end -->`));
