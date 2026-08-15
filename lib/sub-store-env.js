/**
 * Sub-Store 后端的 EdgeOne Pages 运行时环境初始化。
 *
 * 本模块必须最先被导入（cloud-functions/[[default]].js 的第一行 import），
 * 确保以下环境变量在 Sub-Store 后端初始化（import 即执行）之前生效：
 *
 * - SUB_STORE_EDGEONE=1
 *   告诉被适配过的 app.start() 跳过 app.listen()，由平台把请求注入 Express；
 * - SUB_STORE_DATA_BASE_PATH
 *   数据文件（订阅、设置等）的存放目录。云函数文件系统不持久化，
 *   默认放到 /tmp；可在控制台用同名环境变量覆盖。
 *
 * 另做容错处理：SUB_STORE_FRONTEND_BACKEND_PATH 必须以 "/" 开头
 * （上游后端如此要求），否则启动即抛异常导致全部请求 500。
 * 这里自动补全开头的 "/"，避免因配置格式问题导致整个后端不可用。
 */
import { mkdirSync } from 'node:fs';

process.env.SUB_STORE_EDGEONE = '1';

if (!process.env.SUB_STORE_DATA_BASE_PATH) {
    process.env.SUB_STORE_DATA_BASE_PATH = '/tmp/sub-store-data';
}

// 路径前缀自动补 "/"（上游要求：合并模式/前缀模式下该值必须以 "/" 开头）
const pathKey = 'SUB_STORE_FRONTEND_BACKEND_PATH';
if (process.env[pathKey]) {
    const raw = String(process.env[pathKey]).trim();
    if (raw && !raw.startsWith('/')) {
        console.warn(
            `[sub-store-edgeone] ${pathKey} 缺少开头的 "/"，已自动补全: "${raw}" -> "/${raw}"`,
        );
        process.env[pathKey] = `/${raw}`;
    } else if (raw) {
        process.env[pathKey] = raw;
    }
}

try {
    mkdirSync(process.env.SUB_STORE_DATA_BASE_PATH, { recursive: true });
    console.log(
        `[sub-store-edgeone] 数据目录: ${process.env.SUB_STORE_DATA_BASE_PATH}`,
    );
} catch (e) {
    console.error('[sub-store-edgeone] 创建数据目录失败:', e?.message ?? e);
}

export {};
