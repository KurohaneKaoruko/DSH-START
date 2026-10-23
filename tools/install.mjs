/**
 * tools/install.mjs —— 把本插件装进本机 DSH
 *
 *   node tools/install.mjs            # 安装（默认 desktop profile）
 *   node tools/install.mjs --dry-run  # 只看要改什么，不动文件
 *   node tools/install.mjs --uninstall
 *   node tools/install.mjs --profile web-desktop
 *
 * 做的事（和 pnpm link: 依赖完全等价，只是不需要跑包管理器）：
 *   1. 复制插件到 <DSH_HOME>/local-plugins/dsh-boot-sequence
 *   2. 在 profile 的 package.json 里加一条 link: 依赖 + bundles 条目（先备份）
 *   3. 在 profile/node_modules 里建一个目录链接
 *
 * 全是可逆操作：--uninstall 会撤掉 2、3 两步。
 */
import {
  existsSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  rmSync,
  lstatSync,
  readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PKG = 'dsh-boot-sequence';
const SRC = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const uninstall = argv.includes('--uninstall');
const profileArg = argv.indexOf('--profile');
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');

function pickProfile() {
  if (profileArg !== -1 && argv[profileArg + 1]) return argv[profileArg + 1];
  const root = join(dshHome, 'profiles');
  const names = existsSync(root) ? readdirSync(root) : [];
  const usable = names.filter((n) => existsSync(join(root, n, 'package.json')));
  if (usable.includes('desktop')) return 'desktop';
  return usable[0] || 'desktop';
}

const profileName = pickProfile();
const profileDir = join(dshHome, 'profiles', profileName);
const pkgJsonPath = join(profileDir, 'package.json');
const installDir = join(dshHome, 'local-plugins', PKG);
const linkPath = join(profileDir, 'node_modules', PKG);

if (!existsSync(pkgJsonPath)) {
  console.error(`找不到 profile：${pkgJsonPath}`);
  process.exit(1);
}

const say = (msg) => console.log(`${dryRun ? '[dry] ' : ''}${msg}`);

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function backup(p) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dst = `${p}.bak-${stamp}`;
  if (!dryRun) copyFileSync(p, dst);
  say(`已备份 ${dst}`);
}

function removeLink() {
  if (!existsSync(linkPath) && !isLink(linkPath)) return;
  say(`删除链接 ${linkPath}`);
  if (!dryRun) rmSync(linkPath, { recursive: true, force: true });
}

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function patchJson(add) {
  const pkg = readJson(pkgJsonPath);
  pkg.dependencies = pkg.dependencies || {};
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = (pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []);

  if (add) {
    if (!pkg.dependencies[PKG]) {
      pkg.dependencies[PKG] = 'link:' + installDir.replace(/\\/g, '/');
      say(`package.json → dependencies["${PKG}"] = link:${installDir}`);
    }
    if (!bundles.includes(PKG)) {
      bundles.push(PKG);
      say('package.json → dsh.profile.bundles += ' + PKG);
    }
  } else {
    if (pkg.dependencies[PKG]) {
      delete pkg.dependencies[PKG];
      say(`package.json → 移除 dependencies["${PKG}"]`);
    }
    const i = bundles.indexOf(PKG);
    if (i !== -1) {
      bundles.splice(i, 1);
      say('package.json → 移除 bundles 条目');
    }
  }
  if (!dryRun) writeJson(pkgJsonPath, pkg);
}

function copyPlugin() {
  const files = ['package.json', 'cordis.patch.yml', 'README.md', 'lib'];
  say(`复制插件 → ${installDir}`);
  if (dryRun) return;
  mkdirSync(installDir, { recursive: true });
  for (const f of files) {
    const from = join(SRC, f);
    if (!existsSync(from)) continue;
    cpSync(from, join(installDir, f), { recursive: true });
  }
}

function makeLink() {
  say(`建立链接 ${linkPath} → ${installDir}`);
  if (dryRun) return;
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true });
  rmSync(linkPath, { recursive: true, force: true });
  try {
    symlinkSync(installDir, linkPath, 'junction');
  } catch (e) {
    console.warn('  junction 失败，回退到 symlink：', e.message);
    symlinkSync(installDir, linkPath, 'dir');
  }
}

console.log(`DSH_HOME  ${dshHome}`);
console.log(`profile   ${profileName}`);
console.log('');

if (uninstall) {
  removeLink();
  patchJson(false);
  say(`（插件本体保留在 ${installDir}，需要的话手动删除）`);
  console.log('\n卸载完成，重启 DSH 生效。');
} else {
  backup(pkgJsonPath);
  copyPlugin();
  patchJson(true);
  makeLink();
  console.log('\n安装完成，重启 DSH 生效。');
  console.log('想立刻看效果：直接双击打开 preview.html（同一份代码，脱离 DSH 也能跑）。');
}
