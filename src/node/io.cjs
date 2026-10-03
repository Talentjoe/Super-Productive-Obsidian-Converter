/* Executed by the sanctioned Node bridge. args contain data, never executable code. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const input = args[0];
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
if (input.action === 'browse') {
  if (!input.directory) {
    if (process.platform === 'win32') return { directory: '', parent: null, directories: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => c + ':\\').filter((p) => fs.existsSync(p)) };
    input.directory = '/';
  }
  const directory = fs.realpathSync(input.directory);
  return { directory, parent: path.dirname(directory), directories: fs.readdirSync(directory, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(directory, e.name)) };
}
const root = fs.realpathSync(input.root);
if (!fs.statSync(root).isDirectory()) throw new Error('Vault 路径不是文件夹');
function resolve(relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) throw new Error('路径必须为 vault 内的相对路径');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('路径超出所选 vault');
  let ancestor = target;
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('找不到路径祖先'); ancestor = parent; }
  if (!inside(root, fs.realpathSync(ancestor))) throw new Error('符号链接超出所选 vault');
  // Reject dangling links too; existsSync alone would overlook them.
  const pieces = path.relative(root, target).split(path.sep);
  let walk = root;
  for (const piece of pieces) { walk = path.join(walk, piece); try { const stat = fs.lstatSync(walk); if (stat.isSymbolicLink() && !inside(root, fs.realpathSync(walk))) throw new Error('符号链接超出所选 vault'); } catch (e) { if (e.code !== 'ENOENT') throw e; try { if (fs.lstatSync(walk).isSymbolicLink()) throw new Error('符号链接无效'); } catch (nested) { if (nested.code !== 'ENOENT') throw nested; } } }
  return target;
}
function read(relative) {
  const target = resolve(relative);
  try { const stat = fs.statSync(target); if (!stat.isFile()) throw new Error('目标不是文件'); const internal = relative.startsWith('Super Productivity/.sp-sync/'); if (stat.size > (internal ? 64 : 4) * 1024 * 1024) throw new Error(internal ? '同步状态超过 64 MB' : '笔记超过 4 MB，请拆分后同步'); const content = fs.readFileSync(target, 'utf8'); return { content, hash: sha(content) }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function atomic(relative, content) {
  const target = resolve(relative); fs.mkdirSync(path.dirname(target), { recursive: true }); resolve(relative);
  const temporary = target + '.sp-' + crypto.randomUUID() + '.tmp';
  let fd;
  try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, target); }
  finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function scan() {
  const result = []; const seen = new Set();
  function visit(directory) {
    const real = fs.realpathSync(directory); if (!inside(root, real) || seen.has(real)) return; seen.add(real);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.obsidian', '.git', '.sp-sync', 'node_modules'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name), rel = path.relative(root, full).split(path.sep).join('/');
      // Do not follow directory symlinks. File symlinks are checked before read/write.
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.md')) { try { resolve(rel); const stat = fs.statSync(full); result.push({ path: rel, mtime: stat.mtimeMs, size: stat.size }); } catch (e) { if (e.code !== 'ENOENT') continue; } }
    }
  }
  visit(root); return result.sort((a, b) => a.path.localeCompare(b.path));
}
function write(relative, content, expectedHash) {
  const limit = relative.startsWith('Super Productivity/.sp-sync/') ? 64 : 4;
  if (Buffer.byteLength(content, 'utf8') > limit * 1024 * 1024) throw new Error('文件超出大小限制');
  const existing = read(relative);
  if ((existing?.hash ?? null) !== expectedHash) throw new Error('文件已在同步期间变化，请重新同步：' + relative);
  if (existing?.content === content) return existing.hash;
  if (existing && !relative.startsWith('Super Productivity/.sp-sync/')) {
    const created = new Date().toISOString();
    atomic('Super Productivity/.sp-sync/backups/' + crypto.randomUUID() + '.json', JSON.stringify({ version: 1, originalPath: relative, created, hash: existing.hash, content: existing.content }));
  }
  atomic(relative, content); return sha(content);
}
function stagePath() {
  if (typeof input.stageId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.stageId)) throw new Error('暂存操作标识无效');
  return 'Super Productivity/.sp-sync/staging/' + input.stageId + '.part';
}
function batchWrite(operations) {
  if (!Array.isArray(operations) || operations.length > 500 || new Set(operations.map(op => op.path)).size !== operations.length) throw new Error('批量写入格式无效');
  // Check every target before starting. Each write checks its hash again and
  // uses the same backup/atomic replacement path as an individual write.
  for (const op of operations) {
    const existing = read(op.path);
    if ((existing?.hash ?? null) !== op.expectedHash) throw new Error('文件已在同步期间变化，请重新同步：' + op.path);
  }
  return Object.fromEntries(operations.map(op => [op.path, write(op.path, op.content, op.expectedHash)]));
}
switch (input.action) {
  case 'read': return read(input.path);
  case 'read-many': return Object.fromEntries(input.paths.map(relative => {
    try { return [relative, { file: read(relative) }]; }
    catch (e) { return [relative, { file: null, error: e.message }]; }
  }));
  case 'write': return write(input.path, input.content, input.expectedHash);
  case 'write-many': return batchWrite(input.operations);
  case 'remove-task-note': {
    const target = resolve(input.path), normalized = path.relative(root, target).split(path.sep).join('/');
    if (!/^Super Productivity\/projects\/[^/]+\/task-notes\/(?:[^/]+\/)*[^/]+\.md$/.test(normalized)) throw new Error('只能清理托管任务 notes 文件');
    const existing = read(input.path); if (!existing) return;
    if (existing.hash !== input.expectedHash) throw new Error('任务 note 在清理期间变化，保留原文件');
    fs.unlinkSync(target); return;
  }
  case 'stage-begin': atomic(stagePath(), ''); return true;
  case 'stage-append': {
    const target = resolve(stagePath()), stat = fs.statSync(target);
    if (stat.size !== input.offset || stat.size > 64 * 1024 * 1024) throw new Error('暂存文件长度不符');
    if (typeof input.data !== 'string' || input.data.length > 10924 || !/^[A-Za-z0-9+/=]*$/.test(input.data)) throw new Error('暂存数据无效');
    fs.appendFileSync(target, Buffer.from(input.data, 'base64')); return true;
  }
  case 'stage-commit': case 'stage-commit-many': {
    const buffer = fs.readFileSync(resolve(stagePath()));
    if (buffer.length !== input.length || crypto.createHash('sha256').update(buffer).digest('hex') !== input.contentHash) throw new Error('暂存内容校验失败');
    return input.action === 'stage-commit-many' ? batchWrite(JSON.parse(buffer.toString('utf8'))) : write(input.path, buffer.toString('utf8'), input.expectedHash);
  }
  case 'stage-abort': { const target = resolve(stagePath()); if (fs.existsSync(target)) fs.unlinkSync(target); return true; }
  case 'list': return scan().map((e) => e.path);
  case 'fingerprint': return sha(JSON.stringify(scan()));
  case 'backups': {
    const directory = resolve('Super Productivity/.sp-sync/backups'); if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((n) => n.endsWith('.json')).map((n) => { const relative = 'Super Productivity/.sp-sync/backups/' + n; const data = JSON.parse(read(relative).content); return { path: relative, originalPath: data.originalPath, created: data.created }; }).sort((a, b) => b.created.localeCompare(a.created));
  }
  default: throw new Error('未知文件操作');
}
