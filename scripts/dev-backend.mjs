#!/usr/bin/env node
/**
 * 本地开发/调试：以与 EdgeOne Pages 完全相同的代码路径启动后端。
 *
 * 即：加载 cloud-functions/[[default]].js（内部会先设置运行时环境、
 * 初始化 Sub-Store 后端、注册 SPA 回退），拿到导出的 Express 实例后
 * 在本地监听端口（云函数在平台上不需要 listen，由平台注入请求）。
 *
 * 用法：
 *   pnpm run build           # 先构建后端 + 前端
 *   pnpm run dev:backend     # 然后 http://127.0.0.1:3000
 */
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'backend', 'dist', 'sub-store.bundle.js');
const frontendIndex = path.join(root, 'frontend', 'dist', 'index.html');
const functionFile = path.join(root, 'cloud-functions', '[[default]].js');

if (!existsSync(bundle)) {
    console.error('未找到后端构建产物，请先运行: pnpm run build:backend');
    process.exit(1);
}
if (!existsSync(frontendIndex)) {
    console.error('未找到前端构建产物（frontend/dist），请先运行: pnpm run build:frontend');
    console.error('（仅测 API 也可继续，前端相关请求会显示兜底提示页）');
}

// 本地数据目录（云函数里默认 /tmp/sub-store-data）
const dataDir = process.env.SUB_STORE_DATA_BASE_PATH ?? path.join(root, '.local-data');
mkdirSync(dataDir, { recursive: true });
process.env.SUB_STORE_DATA_BASE_PATH = dataDir;

const port = Number(process.env.SUB_STORE_DEV_PORT ?? 3000);

const mod = await import(pathToFileURL(functionFile).href);
const app = mod.default;

if (!app || typeof app !== 'function') {
    console.error('[dev:backend] 云函数模块未导出 Express 实例');
    process.exit(1);
}

app.listen(port, '0.0.0.0', () => {
    console.log(`[dev:backend] http://127.0.0.1:${port}  (Ctrl+C 退出)`);
    console.log(`[dev:backend] 数据目录: ${dataDir}`);
});
