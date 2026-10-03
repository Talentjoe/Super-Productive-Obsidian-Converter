import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
if (!existsSync(join(root, '.git'))) git('init', '-b', 'main');
if (realpathSync(git('rev-parse', '--show-toplevel')).toLowerCase() !== root.toLowerCase()) throw new Error('Git 根目录与项目不一致');
if (!git('remote').split('\n').includes('origin')) git('remote', 'add', 'origin', 'https://github.com/Talentjoe/Super-Productive-Obsidian-Converter.git');
git('config', '--local', 'core.autocrlf', 'false');
git('config', '--local', 'alias.changes', 'status --short');
git('config', '--local', 'alias.history', 'log --graph --oneline --decorate -20');
git('config', '--local', 'alias.last', 'show --stat --oneline HEAD');
console.log('本项目 Git 管理已配置：git changes / git history / git last');
console.log('现有 origin 保留；未修改全局 Git 配置。');
