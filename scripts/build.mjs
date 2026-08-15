#!/usr/bin/env node
/**
 * EdgeOne Pages 构建入口（edgeone.json 中的 buildCommand: pnpm run build）。
 * 顺序执行：后端打包 -> 前端构建。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script) {
    console.log(`\n===== ${script} =====`);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
        cwd: root,
        stdio: 'inherit',
    });
    if (r.status !== 0) {
        console.error(`[build] ${script} 失败，退出码 ${r.status}`);
        process.exit(r.status ?? 1);
    }
}

run('build-backend.mjs');
run('build-frontend.mjs');
console.log('\n[build] 全部完成 ✔');
