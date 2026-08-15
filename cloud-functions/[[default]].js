/**
 * EdgeOne Pages Node.js 云函数入口（根级 [[default]]，兜底匹配所有请求）。
 *
 * 工作机制：
 * 1. 先导入 lib/sub-store-env.js 设置运行时环境（顺序不能变）；
 * 2. 同步加载后端打包产物 backend/dist/sub-store.bundle.js（CJS）——
 *    该文件加载即执行（migrate() + serve()），并把 Express 实例捕获到
 *    globalThis.__SUB_STORE_BACKEND_APP__（见 scripts/build-backend.mjs 的补丁）；
 *    加载失败时（如环境变量配置问题），返回一个携带真实报错信息的
 *    Express 实例，直接在浏览器里展示错误，便于排查；
 * 3. 为前端 SPA 的 history 路由做回退：非 /api、/download、/share 请求
 *    优先尝试读取静态文件（平台一般已处理，这里是兜底），否则返回 index.html；
 * 4. 以框架模式导出 Express 实例（EdgeOne Pages Node.js Functions 约定）。
 */
import '../lib/sub-store-env.js';
import express from 'express';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(
    typeof __filename !== 'undefined' ? __filename : import.meta.url,
);

// ---- 加载 Sub-Store 后端（同步，失败时进入自诊断模式）----
// 平台打包后函数的落盘位置不确定，这里按多个候选路径依次尝试：
//  1) 相对函数文件位置（目录结构保留时）
//  2) 相对进程工作目录的绝对路径（cwd 为项目根时）
const BUNDLE_CANDIDATES = [
    '../backend/dist/sub-store.bundle.js',
    path.join(process.cwd(), 'backend', 'dist', 'sub-store.bundle.js'),
];

let app = null;
let startupError = null;

try {
    let loaded = false;
    const missing = [];
    for (const candidate of BUNDLE_CANDIDATES) {
        try {
            require(candidate);
            loaded = true;
            break;
        } catch (e) {
            if (e?.code !== 'MODULE_NOT_FOUND') {
                // 文件存在但加载/执行失败（如环境变量配置错误）——这是真实错误
                throw e;
            }
            missing.push(`${candidate}: ${e.message}`);
        }
    }
    if (!loaded) {
        throw new Error(
            `未找到后端构建产物（已尝试 ${BUNDLE_CANDIDATES.length} 个候选路径）:\n` +
                missing.map((f) => `  - ${f}`).join('\n') +
                '\n请确认构建命令执行成功（pnpm run build）且 edgeone.json 的 includeFiles 包含 backend/dist/sub-store.bundle.js',
        );
    }
    app = globalThis.__SUB_STORE_BACKEND_APP__;
} catch (e) {
    startupError = e;
    console.error('[sub-store-edgeone] Sub-Store 后端初始化失败:', e);
}

if (!app) {
    if (!startupError) {
        startupError = new Error(
            '未能从 globalThis.__SUB_STORE_BACKEND_APP__ 获取 Express 实例，' +
                '请确认 backend/dist/sub-store.bundle.js 已由 pnpm run build 生成',
        );
    }
    const detail = startupError?.stack ?? String(startupError);
    const errApp = express();
    errApp.use((req, res) => {
        res.status(500)
            .set('Content-Type', 'text/html; charset=utf-8')
            .send(
                `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Sub-Store 后端启动失败</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:ui-monospace,monospace;background:#1e1e1e;color:#f0f0f0;padding:24px">
<h2 style="color:#ff6b6b">Sub-Store 后端初始化失败</h2>
<p>请根据以下错误排查（常见原因：环境变量配置有误，可先删除控制台里的
SUB_STORE_BACKEND_MERGE / SUB_STORE_FRONTEND_BACKEND_PATH 等变量后重新部署）。</p>
<pre style="white-space:pre-wrap;word-break:break-all;background:#2d2d2d;padding:16px;border-radius:8px">${String(
                    detail,
                )
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')}</pre>
</body></html>`,
            );
    });
    app = errApp;
}

const STATIC_BASE = 'frontend/dist';
const INDEX_HTML_CANDIDATES = [
    path.posix.join(STATIC_BASE, 'index.html'),
    'dist/index.html',
    'index.html',
];

const MIME = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    map: 'application/json',
    txt: 'text/plain; charset=utf-8',
    wasm: 'application/wasm',
    mp3: 'audio/mpeg',
    webmanifest: 'application/manifest+json',
};

let indexHtml = null;
function getIndexHtml() {
    if (indexHtml !== null) return indexHtml;
    for (const p of INDEX_HTML_CANDIDATES) {
        try {
            const content = readFileSync(p, 'utf8');
            if (content && content.length > 0) {
                indexHtml = content;
                return indexHtml;
            }
        } catch {
            /* 尝试下一个候选路径 */
        }
    }
    // 兜底页面：找不到前端产物时仍能确认后端可用
    indexHtml = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Sub-Store</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px">
<h1>Sub-Store 后端已就绪</h1>
<p>后端 API 工作正常（可访问 <a href="/api/utils/env">/api/utils/env</a> 验证），
但未找到前端静态文件 <code>frontend/dist/index.html</code>。</p>
<p>请确认仓库构建命令执行成功，且 edgeone.json 的 outputDirectory 为 <code>frontend/dist</code>。</p>
</body></html>`;
    return indexHtml;
}

const isBackendRoute = (p) => /^\/(api|download|share)(\/|$)/.test(p);

app.use((req, res, next) => {
    if (isBackendRoute(req.path)) return next();

    // 静态资源兜底（平台通常会优先处理静态资源，这里防御性处理）
    if (req.method === 'GET' || req.method === 'HEAD') {
        let rel = null;
        try {
            rel = path.posix
                .normalize(req.path)
                .replace(/^\/+/, '')
                .replace(/\0/g, '');
            if (rel && rel !== '.' && !rel.startsWith('..') && !rel.includes(':')) {
                const file = path.posix.join(STATIC_BASE, rel);
                const buf = readFileSync(file);
                const ext = path.posix.extname(rel).slice(1).toLowerCase();
                res.set('Content-Type', MIME[ext] || 'application/octet-stream');
                res.send(buf);
                return;
            }
        } catch {
            /* 文件不存在则回退到 index.html */
        }
    }

    // SPA history 路由回退
    res.set('Content-Type', MIME.html);
    res.send(getIndexHtml());
});

// 未匹配的 API 路由返回 404
app.use((req, res) => {
    res.status(404).end();
});

export default app;
