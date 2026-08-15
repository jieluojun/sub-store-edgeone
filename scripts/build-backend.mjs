#!/usr/bin/env node
/**
 * 构建 Sub-Store 后端为单个自包含的 CJS 文件，供 EdgeOne Pages Node.js 云函数使用。
 *
 * 步骤：
 *  1. 将 backend/src 复制到临时目录（不改动仓库中上游原版源码）；
 *  2. 在临时副本上做两处适配：
 *     a) vendor/express.js —— app.start() 捕获 Express 实例到
 *        globalThis.__SUB_STORE_BACKEND_APP__；当 SUB_STORE_EDGEONE=1 时跳过
 *        app.listen()（云函数不需要监听端口，由平台注入请求）；
 *     b) 全部文件 —— 将 eval(`require("x")`) / eval('require("x")') 转换为
 *        require("x")，使上游为了规避浏览器打包而保留的动态 require 能被
 *        esbuild 静态打包进来，产出自包含单文件；
 *  3. esbuild 打包（platform=node, format=cjs, target=node20, minify）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(root, 'backend');
const SRC_DIR = path.join(BACKEND_DIR, 'src');
// 临时源码放在 backend/ 内，使 esbuild 的模块解析能命中 backend/node_modules
const TMP_DIR = path.join(BACKEND_DIR, '.build-src');
const OUT_DIR = path.join(BACKEND_DIR, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'sub-store.bundle.js');

const log = (...args) => console.log('[build:backend]', ...args);
const fail = (msg) => {
    console.error('[build:backend] 构建失败:', msg);
    process.exit(1);
};

async function readJson(p) {
    return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function copyDir(src, dest) {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory()) await copyDir(s, d);
        else await fs.copyFile(s, d);
    }
}

// 将 eval(`require("x")`) / eval('require("x")') / eval("require('x')")
// 及带换行、尾随逗号的变体统一转换为 require("x")。
// 只匹配 eval 内部恰为一个 require(...) 字面量的写法，不会误伤其他 eval。
const EVAL_REQUIRE_RE = /eval\(\s*([`'"])(require\([^)]*\))\1\s*,?\s*\)/gs;

async function patchFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            await patchFiles(p);
            continue;
        }
        if (!e.name.endsWith('.js') && !e.name.endsWith('.json')) continue;
        let src = await fs.readFile(p, 'utf8');
        src = src.replace(EVAL_REQUIRE_RE, '$2');
        await fs.writeFile(p, src);
    }
}

async function patchExpressAdapter(tmpSrcDir) {
    const f = path.join(tmpSrcDir, 'vendor', 'express.js');
    let src = await fs.readFile(f, 'utf8');

    const anchorStart = src.indexOf('// adapter');
    const anchorEnd = src.indexOf('return app;', anchorStart);
    if (anchorStart === -1 || anchorEnd === -1) {
        fail('未能在 vendor/express.js 中找到 app.start() 适配锚点（上游源码可能有变动）');
    }

    const replacement = `// adapter (patched by sub-store-edgeone)
        app.start = () => {
            // 捕获 app 实例，供 EdgeOne Pages 云函数 export default 使用
            globalThis.__SUB_STORE_BACKEND_APP__ = app;
            if (!eval('process.env.SUB_STORE_EDGEONE')) {
                app.get('*', function (req, res) {
                    res.status(404).end();
                });
                const listener = app.listen(port, host, () => {
                    const { address, port } = listener.address();
                    $.info(\`[BACKEND] listening on \${address}:\${port}\`);
                });
            }
        };
`;

    src = src.slice(0, anchorStart) + replacement + src.slice(anchorEnd);
    await fs.writeFile(f, src);
}

async function patchEnvRedaction(tmpSrcDir) {
    // 安全补丁：/api/utils/env 会原样返回所有 SUB_STORE_* 环境变量的值，
    // 其中 SUB_STORE_DATA_URL（含备份链接）与 SUB_STORE_PUSH_SERVICE
    // （可能含 Bark key）属于敏感信息，任何人访问站点都能看到。
    // 在 env 输出中隐藏这两个变量。
    const f = path.join(tmpSrcDir, 'utils', 'env.js');
    let src = await fs.readFile(f, 'utf8');

    const anchor = `        for (const key in env) {
            if (/^SUB_STORE_/.test(key)) {
                meta.node.env[key] = env[key];
            }
        }`;
    if (!src.includes(anchor)) {
        fail('未能在 env.js 中找到环境变量收集锚点（上游源码可能有变动）');
    }

    const replacement = `        for (const key in env) {
            if (/^SUB_STORE_/.test(key)) {
                // patched by sub-store-edgeone: 隐藏敏感变量, 防止通过公开的 /api/utils/env 泄露
                if (/^(SUB_STORE_DATA_URL|SUB_STORE_PUSH_SERVICE)$/.test(key)) continue;
                meta.node.env[key] = env[key];
            }
        }`;
    src = src.replace(anchor, replacement);
    await fs.writeFile(f, src);
}

async function patchMiscsRootRoute(tmpSrcDir) {
    // 上游在 Node 模式下注册了 GET / -> getEnv（返回 guide JSON）和
    // $app.all('/', 'Hello from sub-store')。在 EdgeOne Pages 上，/ 应由
    // 平台静态资源(index.html)优先响应；函数内跳过这两个路由，让请求
    // 落到本仓库云函数的 SPA 回退逻辑。
    const f = path.join(tmpSrcDir, 'restful', 'miscs.js');
    let src = await fs.readFile(f, 'utf8');

    // 1) GET / -> getEnv
    const a1 = src.indexOf('if (ENV().isNode) {');
    const e1 = src.indexOf('// Redirect sub.store to vercel webpage');
    if (a1 === -1 || e1 === -1) {
        fail('未能在 miscs.js 中找到 GET / 根路由锚点（上游源码可能有变动）');
    }
    src =
        src.slice(0, a1) +
        `if (ENV().isNode) {
        if (!eval('process.env.SUB_STORE_EDGEONE')) {
            $app.get('/', getEnv);
        }
    } else {
        ` +
        src.slice(e1);

    // 2) $app.all('/', 'Hello from sub-store')
    const helloBlock = `    $app.all('/', (_, res) => {
        res.send('Hello from sub-store, made with ❤️ by Peng-YM');
    });
`;
    const a2 = src.indexOf(helloBlock);
    if (a2 === -1) {
        fail('未能在 miscs.js 中找到 $app.all("/") 根路由（上游源码可能有变动）');
    }
    src =
        src.slice(0, a2) +
        `    if (!eval('process.env.SUB_STORE_EDGEONE')) {
` +
        helloBlock +
        `    }
` +
        src.slice(a2 + helloBlock.length);

    await fs.writeFile(f, src);
}

async function main() {
    const versions = await readJson(path.join(root, 'versions.json'));
    const backendTag = versions.subStoreBackend?.tag || 'unknown';

    log(`Sub-Store 后端版本: ${backendTag}`);
    log('准备临时源码副本...');
    await copyDir(SRC_DIR, path.join(TMP_DIR, 'src'));
    // main.js 通过 ../package.json 读取版本号，保持相对路径解析正确
    await fs.copyFile(
        path.join(BACKEND_DIR, 'package.json'),
        path.join(TMP_DIR, 'package.json'),
    );

    log('应用 EdgeOne 适配补丁...');
    await patchExpressAdapter(path.join(TMP_DIR, 'src'));
    await patchMiscsRootRoute(path.join(TMP_DIR, 'src'));
    await patchEnvRedaction(path.join(TMP_DIR, 'src'));
    await patchFiles(path.join(TMP_DIR, 'src'));

    log('esbuild 打包中...');
    const esbuild = (await import('esbuild')).default;
    await esbuild.build({
        entryPoints: [path.join(TMP_DIR, 'src', 'main.js')],
        bundle: true,
        minify: true,
        sourcemap: false,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        outfile: OUT_FILE,
        alias: { '@': path.join(TMP_DIR, 'src') },
        // 依赖全部安装在根 node_modules（EdgeOne 只执行根目录 pnpm install），
        // backend/node_modules 仅作本地旧环境的兜底
        nodePaths: [
            path.join(root, 'node_modules'),
            path.join(BACKEND_DIR, 'node_modules'),
        ],
        banner: { js: `// SUB_STORE_BACKEND_VERSION: ${backendTag}` },
        logLevel: 'warning',
    });

    // 校验：打包产物中不应再残留任何非内置模块的静态 require。
    // 先剥离字符串字面量，避免把错误消息文本误判为 require。
    const bundle = await fs.readFile(OUT_FILE, 'utf8');
    const noStrings = bundle.replace(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gs,
        '""',
    );
    // 浏览器兼容代码中 try/catch 保护的 polyfill 探测，Node 下恒有或恒安全
    const SAFE_EXTRA = new Set([
        'Buffer', 'process', 'sqlite', 'node:sqlite', 'diagnostics_channel',
    ]);
    const builtins = new Set(builtinModules);
    const leftovers = new Set();
    for (const m of noStrings.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
        const name = m[1];
        const bare = name.replace(/^node:/, '');
        if (builtins.has(name) || builtins.has(bare)) continue;
        if (SAFE_EXTRA.has(name) || SAFE_EXTRA.has(bare)) continue;
        leftovers.add(name);
    }
    if (leftovers.size > 0) {
        fail(
            `打包产物中仍残留非内置模块的 require: ${[...leftovers].join(', ')}。` +
                '请把这些包加入根 package.json 的 dependencies，' +
                '并将它们列入 edgeone.json 的 cloudFunctions.nodejs.externalNodeModules。',
        );
    }

    const size = (Buffer.byteLength(bundle) / 1024 / 1024).toFixed(2);
    log(`完成: ${path.relative(root, OUT_FILE)} (${size} MB)`);
}

main().catch((e) => fail(e?.message ?? e));
