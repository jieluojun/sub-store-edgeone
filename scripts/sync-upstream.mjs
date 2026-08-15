#!/usr/bin/env node
/**
 * 同步上游更新：Sub-Store 后端（backend/）与 Sub-Store-Front-End（前端版本号）。
 *
 * 用法：
 *   node scripts/sync-upstream.mjs --check    # 仅检查是否有新版本（有新版本退出码 1）
 *   node scripts/sync-upstream.mjs --yes      # 执行同步
 *   node scripts/sync-upstream.mjs --yes --build  # 同步后立即重新打包后端
 *
 * 后端同步步骤：
 *   1. 通过 GitHub API 获取上游最新 release tag；
 *   2. 若比 versions.json 记录的新：下载该 tag 的 tarball，提取其中 backend/
 *      整体替换本地 backend/（保持上游原样代码）；
 *   3. 扫描新后端源码的 import/require，把运行时依赖同步进根 package.json
 *      （EdgeOne 构建环境只执行根目录 pnpm install）；
 *   4. 更新 versions.json 的 tag 与 commit sha。
 *
 * 前端同步步骤：仅更新 versions.json 里的 tag（部署构建时由
 *   build-frontend.mjs 自动拉取对应版本的源码构建）。
 *
 * 退出码：0=已同步, 1=错误/仅检查模式下有更新, 2=无更新。
 */
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const BACKEND_REPO = 'sub-store-org/Sub-Store';
const FRONTEND_REPO = 'sub-store-org/Sub-Store-Front-End';

const log = (...a) => console.log('[sync-upstream]', ...a);
const fail = (m) => {
    console.error('[sync-upstream]', m);
    process.exit(1);
};

async function ghApi(apiPath) {
    const r = await fetch(`https://api.github.com/${apiPath}`, {
        headers: {
            'User-Agent': 'sub-store-edgeone-sync',
            Accept: 'application/vnd.github+json',
        },
    });
    if (!r.ok) throw new Error(`GitHub API ${apiPath} -> ${r.status}`);
    return r.json();
}

// 获取上游最新稳定版 tag：优先 releases/latest，失败时回退 tags 列表
async function latestTag(repo) {
    try {
        const rel = await ghApi(`repos/${repo}/releases/latest`);
        if (rel?.tag_name) return rel.tag_name;
    } catch (e) {
        log(`releases/latest 不可用 (${repo}): ${e.message}，回退 tags 列表`);
    }
    const tags = await ghApi(`repos/${repo}/tags?per_page=100`);
    const names = tags
        .map((t) => t.name)
        .filter((n) => /^v?\d+\.\d+\.\d+/.test(n));
    names.sort((a, b) => cmpVersion(b, a));
    return names[0];
}

function cmpVersion(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x - y;
    }
    return 0;
}

// 下载上游 tag 的 tarball 并返回其中 backend/ 目录路径
async function downloadBackend(tag) {
    const url = `https://codeload.github.com/${BACKEND_REPO}/tar.gz/refs/tags/${tag}`;
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sub-store-sync-'));
    const tarball = path.join(tmp, 'backend.tar.gz');
    log(`下载 ${BACKEND_REPO}@${tag} ...`);
    const res = await fetch(url);
    if (!res.ok) fail(`下载失败: HTTP ${res.status} ${url}`);
    await fs.writeFile(tarball, Buffer.from(await res.arrayBuffer()));
    const r = spawnSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: 'inherit' });
    if (r.status !== 0) fail('tarball 解压失败（需要 tar 命令）');
    // 解压出的顶层目录名形如 Sub-Store-<tag>，这里自动探测
    const entries = await fs.readdir(tmp, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const candidate = path.join(tmp, e.name, 'backend');
        try {
            await fs.access(path.join(candidate, 'src'));
            return candidate;
        } catch {
            /* 继续找 */
        }
    }
    fail(`tarball 中未找到 backend/ 目录: ${tmp}`);
}

// 扫描源码中静态引用的 npm 包（import / require / eval(require)），
// 排除 node 内置模块与测试目录
const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const EVAL_REQUIRE_RE = /eval\(\s*[`'"](require\([^)]*\))[`'"]\s*,?\s*\)/g;

function normalizePackageName(spec) {
    if (
        spec.startsWith('.') ||
        spec.startsWith('/') ||
        spec.startsWith('@/')
    ) {
        return null;
    }
    const bare = spec.replace(/^node:/, '');
    if (builtinModules.includes(bare)) return null;
    return bare.startsWith('@')
        ? bare.split('/').slice(0, 2).join('/')
        : bare.split('/')[0];
}

async function collectRuntimeDeps(backendDir) {
    const names = new Set();
    const add = (spec) => {
        const name = normalizePackageName(spec);
        if (name) names.add(name);
    };
    const srcDir = path.join(backendDir, 'src');
    const walk = async (dir) => {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'test') continue; // 跳过测试目录
                await walk(p);
                continue;
            }
            if (!e.name.endsWith('.js')) continue;
            const src = await fs.readFile(p, 'utf8');
            for (const m of src.matchAll(IMPORT_RE)) add(m[1]);
            for (const m of src.matchAll(REQUIRE_RE)) add(m[1]);
            for (const m of src.matchAll(EVAL_REQUIRE_RE)) {
                const inner = /require\(\s*['"]([^'"]+)['"]/.exec(m[1]);
                if (inner) add(inner[1]);
            }
        }
    };
    await walk(srcDir);
    return names;
}

// 把后端源码实际引用的包同步进根 package.json 的 dependencies
async function syncRootDeps(backendDir) {
    const bpkg = JSON.parse(
        await fs.readFile(path.join(backendDir, 'package.json'), 'utf8'),
    );
    const upstreamDeclared = {
        ...(bpkg.dependencies ?? {}),
        ...(bpkg.devDependencies ?? {}),
    };
    const required = await collectRuntimeDeps(backendDir);

    const deps = {};
    const missing = [];
    for (const name of [...required].sort()) {
        const range = upstreamDeclared[name];
        if (!range) {
            missing.push(name);
            continue;
        }
        deps[name] = range;
    }

    const rootPkgPath = path.join(root, 'package.json');
    const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf8'));
    const esbuildVersion = rootPkg.devDependencies?.esbuild ?? '0.19.8';
    rootPkg.dependencies = deps;
    rootPkg.devDependencies = { esbuild: esbuildVersion };
    await fs.writeFile(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
    log(`根 package.json 已同步: ${Object.keys(deps).length} 个运行时依赖`);
    if (missing.length > 0) {
        log(
            `⚠️ 以下包被源码引用但未在上游 package.json 声明，请人工确认: ${missing.join(', ')}`,
        );
    }
    return Object.keys(deps).length;
}

async function main() {
    const args = process.argv.slice(2);
    const checkOnly = args.includes('--check');
    const buildAfter = args.includes('--build');

    const versionsPath = path.join(root, 'versions.json');
    const versions = JSON.parse(await fs.readFile(versionsPath, 'utf8'));

    const beTag = await latestTag(BACKEND_REPO);
    const feTag = await latestTag(FRONTEND_REPO);
    log(`上游最新: 后端 ${beTag} | 前端 ${feTag}`);

    let updated = false;

    // ---- 后端 ----
    if (cmpVersion(beTag, versions.subStoreBackend.tag) > 0) {
        log(`后端有更新: ${versions.subStoreBackend.tag} -> ${beTag}`);
        updated = true;
        if (!checkOnly) {
            const newBackend = await downloadBackend(beTag);
            log('替换 backend/ ...');
            await fs.rm(path.join(root, 'backend'), {
                recursive: true,
                force: true,
            });
            await fs.cp(newBackend, path.join(root, 'backend'), {
                recursive: true,
            });
            await syncRootDeps(path.join(root, 'backend'));
            let commit;
            try {
                commit = (await ghApi(`repos/${BACKEND_REPO}/commits/${beTag}`))
                    .sha;
            } catch {
                commit = 'unknown';
            }
            versions.subStoreBackend.tag = beTag;
            versions.subStoreBackend.commit = commit;
        }
    } else {
        log(`后端已是最新: ${versions.subStoreBackend.tag}`);
    }

    // ---- 前端 ----
    if (cmpVersion(feTag, versions.subStoreFrontend.tag) > 0) {
        log(`前端有更新: ${versions.subStoreFrontend.tag} -> ${feTag}`);
        updated = true;
        if (!checkOnly) versions.subStoreFrontend.tag = feTag;
    } else {
        log(`前端已是最新: ${versions.subStoreFrontend.tag}`);
    }

    if (updated && !checkOnly) {
        await fs.writeFile(versionsPath, JSON.stringify(versions, null, 2) + '\n');
        log('versions.json 已更新');
        if (buildAfter) {
            log('重新打包后端 ...');
            const r = spawnSync(
                process.execPath,
                [path.join(root, 'scripts', 'build-backend.mjs')],
                { stdio: 'inherit' },
            );
            if (r.status !== 0) fail('后端重新打包失败');
        }
        log('同步完成 ✔ 提交并推送后，EdgeOne Pages 会自动重新构建部署');
        process.exit(0);
    }
    if (updated) {
        log('检测到更新（仅检查模式）。执行 node scripts/sync-upstream.mjs --yes 应用');
        process.exit(1);
    }
    log('无更新');
    process.exit(2);
}

main().catch((e) => fail(e?.message ?? e));
