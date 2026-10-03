import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
await import('./sync-guide.mjs');

await mkdir('dist', { recursive: true });
await viteBuild({ build: { outDir: '.tmp/ui-build', emptyOutDir: true, cssCodeSplit: false, minify: 'esbuild', rollupOptions: { output: { inlineDynamicImports: true } } } });
const built = await readFile('.tmp/ui-build/index.html', 'utf8');
const assets = await readdir('.tmp/ui-build/assets');
const js = await readFile(`.tmp/ui-build/assets/${assets.find((name) => name.endsWith('.js'))}`, 'utf8');
const css = await readFile(`.tmp/ui-build/assets/${assets.find((name) => name.endsWith('.css'))}`, 'utf8');
// Replacement strings interpret $$, $&, $` and $'. Keep bundled source literal.
const html = built.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/, () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`).replace(/<link[^>]*href="[^"]+\.css"[^>]*>/, () => `<style>${css}</style>`);
if (/<(?:script|link)[^>]*(?:src|href)="\//.test(html)) throw new Error('UI still depends on external assets');
if (strToU8(html).length > 100 * 1024) throw new Error('index.html exceeds the host 100 KB limit');
await writeFile('dist/index.html', html);
await esbuild({ entryPoints: ['src/background.ts'], outfile: 'dist/plugin.js', bundle: true, format: 'iife', target: 'es2022', minify: true, loader: { '.cjs': 'text', '.md': 'text' }, plugins: [{ name: 'raw', setup(build) { build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' })); build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' })); } }] });
const files = ['manifest.json', 'THIRD_PARTY_NOTICES.md', 'LICENSE'];
for (const file of files) await writeFile(`dist/${file}`, await readFile(file));
let notices = await readFile('THIRD_PARTY_NOTICES.md', 'utf8');
for (const dependency of ['solid-js', '@js-temporal/polyfill', 'jsbi']) {
  const directory = `node_modules/${dependency}`;
  const names = await readdir(directory);
  const license = names.find((name) => /^licen[sc]e(?:\.|$)/i.test(name));
  if (!license) throw new Error(`Missing license: ${dependency}`);
  notices += `\n\n## ${dependency}\n\n${await readFile(`${directory}/${license}`, 'utf8')}\n`;
}
await writeFile('dist/THIRD_PARTY_NOTICES.md', notices);
await writeFile('dist/README.md', await readFile('README.md'));
await mkdir('dist/docs', { recursive: true });
const documentFiles = ['AI-GUIDE.md', 'FORMAT-EXAMPLES.md', 'VALIDATION.md', 'USER-GUIDE.md', 'GIT-GUIDE.md'];
for (const file of documentFiles) await writeFile(`dist/docs/${file}`, await readFile(`docs/${file}`));
const archive = {};
for (const file of ['plugin.js', 'index.html', ...files, 'README.md', ...documentFiles.map(file => `docs/${file}`)]) archive[file] = new Uint8Array(await readFile(`dist/${file}`));
const zip = zipSync(archive, { level: 9 });
await writeFile('dist/sp-obsidian-sync.zip', zip);
await writeFile('dist/sp-obsidian-sync.zip.sha256', `${createHash('sha256').update(zip).digest('hex')}  sp-obsidian-sync.zip\n`);
console.log(`Plugin packaged: dist/sp-obsidian-sync.zip (UI ${strToU8(html).length} bytes)`);
