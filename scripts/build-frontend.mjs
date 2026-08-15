#!/usr/bin/env node
/**
 * 构建 Sub-Store 前端：克隆指定版本的 Sub-Store-Front-End 源码，
 * 以 VITE_API_URL=/ 构建（与后端同源），产物输出到 frontend/dist。
 *
 * 已存在且版本一致的产物会被跳过（便于本地反复构建）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FE_SRC_DIR = path.join(root, 'frontend-src');
const FE_DIST_DIR = path.join(root, 'frontend', 'dist');
const STAMP_FILE = path.join(FE_DIST_DIR, '.sub-store-frontend-version');

const log = (...args) => console.log('[build:frontend]', ...args);
const fail = (msg) => {
    console.error('[build:frontend] 构建失败:', msg);
    process.exit(1);
};

const exists = async (p) => {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
};

async function readJson(p) {
    return JSON.parse(await fs.readFile(p, 'utf8'));
}

function run(cmd, args, opts = {}) {
    log('$', cmd, args.join(' '));
    const r = spawnSync(cmd, args, {
        cwd: opts.cwd ?? root,
        env: opts.env ?? process.env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (r.status !== 0) fail(`${cmd} ${args.join(' ')} 退出码 ${r.status}`);
    return r;
}

function runPnpm(args, opts = {}) {
    const check = spawnSync('pnpm', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
    if (check.status === 0) {
        run('pnpm', args, opts);
    } else {
        run('corepack', ['pnpm', ...args], opts);
    }
}

async function main() {
    const versions = await readJson(path.join(root, 'versions.json'));
    const tag = versions.subStoreFrontend?.tag;
    if (!tag) fail('versions.json 缺少 subStoreFrontend.tag');

    const indexHtml = path.join(FE_DIST_DIR, 'index.html');
    let stamp = '';
    try {
        stamp = await fs.readFile(STAMP_FILE, 'utf8');
    } catch {}

    if (stamp.trim() === tag && (await exists(indexHtml))) {
        log(`前端产物已是最新 (${tag})，跳过构建`);
        return;
    }

    log(`前端版本: ${tag}`);
    await fs.rm(FE_SRC_DIR, { recursive: true, force: true });

    log(`克隆 Sub-Store-Front-End@${tag} ...`);
    run('git', [
        'clone', '--depth', '1', '--branch', tag,
        'https://github.com/sub-store-org/Sub-Store-Front-End.git',
        FE_SRC_DIR,
    ]);

    // 上游 frontend 的 packageManager 是 pnpm@11，用本仓库统一的 pnpm@10 安装
    await fs.writeFile(
        path.join(FE_SRC_DIR, '.npmrc'),
        'manage-package-manager-versions=false\n',
    );

    const env = { ...process.env, VITE_API_URL: '/', CI: 'true' };

    log('安装前端依赖（首次较慢）...');
    runPnpm(['install', '--dir', FE_SRC_DIR, '--frozen-lockfile'], { env });

    log('构建前端 (vue-tsc + vite build) ...');
    runPnpm(['--dir', FE_SRC_DIR, 'build'], { env });

    await fs.rm(FE_DIST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(root, 'frontend'), { recursive: true });
    await fs.rename(path.join(FE_SRC_DIR, 'dist'), FE_DIST_DIR);

    await fs.writeFile(STAMP_FILE, tag);

    if (!(await exists(indexHtml))) fail('构建完成但未找到 frontend/dist/index.html');
    log(`完成: frontend/dist (${tag})`);
}

main().catch((e) => fail(e?.message ?? e));
