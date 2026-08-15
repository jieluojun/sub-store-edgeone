<p align="center">
  <img src="https://raw.githubusercontent.com/cc63/ICON/main/Sub-Store.png" alt="Sub-Store" width="96" />
</p>

<h1 align="center">Sub-Store · EdgeOne Pages 一键部署</h1>

<p align="center">
  <a href="https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fjieluojun%2Fsub-store-edgeone&project-name=sub-store">
    <img src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg" alt="部署到 EdgeOne Pages" height="40"/>
  </a>
</p>

<p align="center">把 <a href="https://github.com/sub-store-org/Sub-Store">Sub-Store</a>（订阅管理神器，支持 QX / Loon / Surge / Stash / Egern / Shadowrocket / mihomo 等）免费部署到腾讯云 <a href="https://edgeone.cloud.tencent.com/pages/document/162936635171454976">EdgeOne Pages</a>，无需服务器，开箱即用。</p>

- **前端**：Sub-Store 官方前端，与后端同域名托管，打开网址就能用（无需手动配置后端地址）
- **后端**：Sub-Store 官方后端打包为 EdgeOne Pages **Node.js 云函数**，`/api` 全功能可用
- **零成本**：EdgeOne Pages 目前免费；中国站国内访问更快（需备案绑自定义域名），国际站自定义域名**无需备案**
- **自动构建**：推送到 GitHub 即触发部署

---

## 一键部署（腾讯云中国站，推荐）

1. 注册/登录 [腾讯云](https://console.cloud.tencent.com/)（需完成实名认证，已有账号直接登录）
2. 点击上方 **部署到 EdgeOne Pages** 按钮（或直接打开 [此链接](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fjieluojun%2Fsub-store-edgeone&project-name=sub-store)）
3. 按提示**绑定 GitHub** 并授权访问本仓库
4. 构建配置已由 [`edgeone.json`](./edgeone.json) 自动填好，直接点击**创建 / 开始部署**
5. 等待构建完成（首次约 3~5 分钟），打开平台分配的预览域名即可使用 🎉

> 构建过程：安装依赖 → 打包后端云函数 → 克隆官方前端源码并构建（`VITE_API_URL=/` 同源模式）→ 静态资源 + 云函数一起部署。
>
> 注意：中国站绑定自定义域名**需要 ICP 备案**，默认分配的预览域名可直接使用，无需备案。

### EdgeOne 国际站

国际站控制台：登录 [edgeone.ai](https://edgeone.ai/register)（支持 Google / 邮箱登录，无需绑卡、无需备案）→ 创建项目 → 导入 Git 仓库 → 选择本仓库即可（构建参数已随仓库提供），或直接打开一键部署链接：[https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fjieluojun%2Fsub-store-edgeone&project-name=sub-store](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fjieluojun%2Fsub-store-edgeone&project-name=sub-store)。注意：国际站自定义域名**无需备案**，适合海外用户或不需要备案的场景。

---

## ⚠️ 数据持久化：重新部署后如何不丢数据/配置

两类状态分开存放，重新部署后的行为不同：

| 状态 | 存放位置 | 重新部署后 |
| --- | --- | --- |
| 前端配置（后端路径等） | 浏览器 localStorage，跟随域名 | 同域名不丢；**预览部署每次换新域名会丢** |
| 后端数据（订阅、设置、GitHub 令牌） | 云函数临时文件系统 | **必然清空** |

### 一、后端数据：Gist 备份 + 启动自动恢复（一次配置，永久生效）

1. 首次部署后，前端 → **我的 → 设置** 填写 GitHub Token（勾选 `gist` 权限）
2. 配好订阅等数据后，**我的 → 同步/备份 → 备份**（上传到 Gist），得到一个私有 Gist
3. 复制该 Gist 的 raw 链接（建议使用 **secret gist**）：
   `https://gist.githubusercontent.com/<用户名>/<gist_id>/raw`
4. EdgeOne 控制台 → 项目设置 → **环境变量** 添加：
   `SUB_STORE_DATA_URL = 上面的 raw 链接`
   （环境变量是**项目级配置，重新部署不会丢**）
5. 此后每次重新部署 / 实例回收冷启动，后端启动时**自动从 Gist 拉回全部数据**——订阅、设置、令牌、文件全部恢复，无需再手动填任何东西

> 可选自动化：外部定时服务（如 cron-job.org）定时 `GET https://你的域名/api/sync/artifact/name` 触发同步到 Gist，保证备份新鲜。
>
> ⚠️ 安全提示：请务必使用 **secret gist**（只有知道链接的人能访问），且备份数据里包含你的 GitHub Token。本仓库已从公开接口 `/api/utils/env` 的返回值中隐藏 `SUB_STORE_DATA_URL`，但仍要保管好 gist 链接本身，不要发到公开场合。

### 二、前端路径：为什么每次重新部署要重填、如何解决

前端「后端管理」里填的路径保存在**浏览器 localStorage**，与域名绑定：

- 同域名重新部署：不会丢，无需重填
- **预览部署每次会分配新的 `*.edgeone.dev` 域名**，换了域名 localStorage 失效，所以每次都会弹配置框

解决办法（三选一，按推荐排序）：

1. **不用路径前缀（推荐）**：删除控制台里的 `SUB_STORE_BACKEND_MERGE` / `SUB_STORE_FRONTEND_BACKEND_PATH` 环境变量，用默认零配置（前端已内置同源 `/api`），**根本不需要填路径**
2. **固定域名**：绑定自定义域名（中国站需备案、国际站免备案），或固定使用生产部署的域名访问——域名稳定后 localStorage 一直有效
3. **收藏一键配置链接**：保留前缀时，收藏 `https://你的域名/?api=https://你的域名/你的前缀`，每次打开自动完成配置

### 三、定时备份（可选）

也可以给项目设置环境变量（控制台 → 项目设置 → 环境变量）由后端定时同步：

| 环境变量 | 说明 | 示例 |
| --- | --- | --- |
| `SUB_STORE_BACKEND_SYNC_CRON` | 定时同步订阅/文件到私有 Gist | `55 23 * * *` |
| `SUB_STORE_BACKEND_UPLOAD_CRON` | 定时备份全部数据到 Gist | `20 3 * * *` |

> ⚠️ Serverless 环境下定时任务依赖实例存活，**不稳定**；可靠做法是外部定时请求触发（如快捷指令 / cron 服务定时 `GET https://你的域名/api/sync/artifact/name`），或使用前端手动同步。
>
> 全部环境变量见下文 [环境变量](#环境变量)。

---

## 环境变量

设置位置：EdgeOne 控制台 → 项目 → 项目设置 → **环境变量**（修改后需重新部署生效）。

以下为 Sub-Store 后端（v2.36.38）支持的全部环境变量，按用途分类：

### 数据与备份

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUB_STORE_DATA_BASE_PATH` | 数据文件（订阅、设置等）存放目录 | 本仓库默认 `/tmp/sub-store-data` |
| `SUB_STORE_DATA_URL` | 启动时从该 URL **自动恢复全部数据**（Gist 备份还原，建议 secret gist 的 raw 链接；本仓库已在公开接口 `/api/utils/env` 中隐藏此变量） | `https://gist.githubusercontent.com/USER/ID/raw` |
| `SUB_STORE_DATA_URL_POST` | 恢复完成后执行的后处理 JS 脚本 | - |

### 定时任务（Cron）

| 环境变量 | 说明 | 格式 / 示例 |
| --- | --- | --- |
| `SUB_STORE_BACKEND_SYNC_CRON` | 定时同步订阅/文件到私有 Gist（需在前端设置 Gist Token） | `55 23 * * *` |
| `SUB_STORE_BACKEND_UPLOAD_CRON` | 定时备份全部数据到 Gist | `20 3 * * *` |
| `SUB_STORE_BACKEND_DOWNLOAD_CRON` | 定时从 Gist 恢复全部数据 | `0 4 * * *` |
| `SUB_STORE_PRODUCE_CRON` | 定时生成指定订阅/组合订阅（`sub`=单条订阅，`col`=组合订阅） | `0 */2 * * *,sub,订阅名;0 */3 * * *,col,组合名` |
| `SUB_STORE_MMDB_CRON` | 定时更新 GeoIP 数据库（配合下面四个变量使用） | `0 4 * * 0` |
| `SUB_STORE_MMDB_COUNTRY_PATH` / `SUB_STORE_MMDB_COUNTRY_URL` | GeoIP 国家库本地路径 / 下载地址 | - |
| `SUB_STORE_MMDB_ASN_PATH` / `SUB_STORE_MMDB_ASN_URL` | GeoIP ASN 库本地路径 / 下载地址 | - |
| `SUB_STORE_CRON` / `SUB_STORE_BACKEND_CRON` | ⛔ 已弃用，后端会报错提示改用上面的新变量 | - |

> ⚠️ Serverless 实例会被平台回收，上述 cron 在 EdgeOne Pages 上**不稳定**，建议用外部定时请求触发代替。

### 路径 / 端口 / 合并

> 这些主要用于 Docker/VPS 部署；**本仓库的 EdgeOne Pages 部署无需设置**（无端口概念，请求由平台注入）。若设置了 `SUB_STORE_BACKEND_MERGE`，则 `SUB_STORE_FRONTEND_BACKEND_PATH` 必须同时设置且**以 `/` 开头**（本仓库会自动补全开头的 `/`）。

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUB_STORE_FRONTEND_BACKEND_PATH` | 前端访问后端的 API 路径前缀（需与 `SUB_STORE_BACKEND_MERGE` / `SUB_STORE_BACKEND_PREFIX` 成对使用） | - |
| `SUB_STORE_BACKEND_MERGE` | 合并前后端：同一端口同时处理 API 与前端静态资源 | - |
| `SUB_STORE_BACKEND_PREFIX` | 后端 API 再加一层路径前缀（防扫描） | - |
| `SUB_STORE_BACKEND_API_HOST` | 后端 API 监听地址 | `::` |
| `SUB_STORE_BACKEND_API_PORT` | 后端 API 端口 | `3000` |
| `SUB_STORE_FRONTEND_HOST` | 前端监听地址 | `::` |
| `SUB_STORE_FRONTEND_PORT` | 前端端口 | `3001` |
| `SUB_STORE_FRONTEND_PATH` | 前端静态文件目录（本仓库本地开发脚本自动设置） | - |

### 网络 / 请求

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUB_STORE_BACKEND_DEFAULT_PROXY` | 后端抓取订阅/同步请求使用的默认代理（SOCKS5 / HTTP） | - |
| `all_proxy` / `ALL_PROXY` | 全局代理 | - |
| `SUB_STORE_MAX_HEADER_SIZE` | undici 响应头大小上限（bytes） | `32768` |
| `SUB_STORE_BODY_JSON_LIMIT` | JSON 请求体大小上限 | `1mb` |

### 推送 / CORS / 其他

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUB_STORE_PUSH_SERVICE` | 推送服务 URL，支持 shoutrrr / Bark / PushPlus / Telegram Bot，`[推送标题]`、`[推送内容]` 会被自动替换 | - |
| `SUB_STORE_CORS_ALLOWED_ORIGINS` | 浏览器 CORS 白名单（逗号分隔，`*` 表示不限制任何来源） | `*` |
| `SUB_STORE_X_POWERED_BY` | 自定义 `X-Powered-By` 响应头 | `Sub-Store` |
| `SUB_STORE_EDGEONE` | 本仓库适配开关：跳过端口监听、由平台注入请求（**内部变量，请勿修改**） | 自动设为 `1` |

> 🔒 安全提示：后端接口 `/api/utils/env` 无需鉴权，会返回所有 `SUB_STORE_*` 前缀环境变量的值。本仓库已打补丁：**`SUB_STORE_DATA_URL` 与 `SUB_STORE_PUSH_SERVICE` 两个敏感变量不会出现在该接口的返回值中**。其余敏感信息（Bark key、Gist Token 等）请在前端「我的 → 设置」中配置（存于数据文件，也不会出现在 env 接口里）。

---

## 自定义域名

- **中国站（推荐）**：控制台 → 项目 → 自定义域名 → 按提示解析 CNAME，需完成 **ICP 备案**后绑定，自动签发 HTTPS 证书，国内访问更快（有国内节点加速）
- **国际站（edgeone.ai）**：控制台 → 项目 → 自定义域名 → 按提示解析 CNAME，**无需备案**，自动签发 HTTPS 证书

---

## 项目结构

```
├── cloud-functions/[[default]].js   # Node.js 云函数入口：初始化后端 + SPA 回退，导出 Express 实例
├── lib/sub-store-env.js             # 运行时环境初始化（先于后端加载）
├── backend/                         # Sub-Store 官方后端源码（原样拷贝，锁定版本见 versions.json）
│                                    #   其运行时依赖统一在根 package.json 安装（EdgeOne 只执行根 pnpm install）
│   └── dist/sub-store.bundle.js     # 构建产物：自包含单文件后端（已提交，兜底用）
├── scripts/
│   ├── build-backend.mjs            # 后端打包：eval(require) 转换 + 适配补丁 + esbuild 打包
│   ├── build-frontend.mjs           # 前端构建：克隆官方前端源码，以 VITE_API_URL=/ 构建
│   └── dev-backend.mjs              # 本地开发：以与云函数完全相同的代码路径启动服务
├── edgeone.json                     # EdgeOne Pages 构建配置
├── versions.json                    # 锁定后端/前端版本
└── .github/workflows/ci.yml         # CI：构建 + 冒烟测试
```

## 工作原理

1. **构建阶段**：`pnpm run build` 把后端打包成自包含单文件（上游代码里为规避浏览器打包而保留的 `eval(require(...))` 被转换为静态依赖，全部打进一个文件），并从官方仓库克隆前端源码、以同源 API（`/`）构建；
2. **部署产物**：`frontend/dist` 作为静态资源托管；`cloud-functions/[[default]].js` 作为根级兜底云函数；
3. **运行时**：静态资源由平台边缘节点直接响应（优先级高于云函数）；`/api/*`、`/download/*`、`/share/*` 路由到云函数中的 Express 后端；其余路径回退 `index.html`（前端为 history 路由的单页应用）。

## 🔄 同步上游更新

本仓库锁定上游版本于 [`versions.json`](./versions.json)。官方发布新版本后，有两种更新方式：

### 方式一：自动（推荐）

仓库内置了 [`.github/workflows/sync-upstream.yml`](./.github/workflows/sync-upstream.yml)：

- **每周一自动检查**官方前后端仓库的最新版本，发现更新会自动创建 PR
- PR 的 CI 会验证：后端打包 ✅ 前端构建 ✅ 冒烟测试 ✅
- 你只需**审阅并合并 PR**——合并后 EdgeOne Pages 自动重新构建部署
- 也可以随时在仓库 Actions 页面手动触发（Run workflow）

### 方式二：手动

```bash
node scripts/sync-upstream.mjs --yes   # 检查并同步（替换后端/更新前端版本号/同步依赖）
pnpm install                           # 依赖变化时更新 lockfile
pnpm run build:backend                 # 重新打包后端（可选，EdgeOne 部署时会自动构建）
git add -A && git commit -m "chore: 同步上游更新" && git push
```

### 同步逻辑与注意事项

- **后端**：`backend/` 会被上游新版本的 `backend/` **整体替换**（保持原样代码，便于 diff）；脚本自动扫描新源码的 import/require，把运行时依赖同步进根 `package.json`（EdgeOne 构建环境只执行根 `pnpm install`）
- **前端**：仅更新 `versions.json` 中的 tag，部署构建时自动拉取新版本源码
- **补丁失配**：若上游调整了源码结构，导致本仓库适配补丁的锚点失配（构建脚本会明确报错），需相应更新 `scripts/build-backend.mjs` 中的补丁逻辑
- **破坏性变更**：上游偶有破坏性变更（如新增必填环境变量），合并 PR 前看一眼 Release Notes 与 PR 的 CI 结果

## 本地开发

```bash
# 要求 Node.js >= 20 / pnpm 10
pnpm install                # 安装全部依赖（后端运行时依赖 + 构建工具，与 EdgeOne 一致）
pnpm run build              # 构建后端 + 前端（前端首次约 2 分钟）
pnpm run dev:backend        # http://127.0.0.1:3000（与云函数相同的代码路径）
```

## 常见问题

### API 请求全部返回 500 / 前端提示"无法连接后端"

1. 打开 EdgeOne 控制台 → 项目设置 → **环境变量**，确认没有误设 `SUB_STORE_BACKEND_MERGE` / `SUB_STORE_BACKEND_PREFIX` / `SUB_STORE_FRONTEND_BACKEND_PATH`——默认部署**不需要任何环境变量**（前端已烘焙为同源 `/api`）。建议先删除全部自定义变量 → 保存 → 触发重新部署。
2. 若要启用路径前缀，`SUB_STORE_FRONTEND_BACKEND_PATH` 的值必须**以 `/` 开头**（本仓库已自动容错补全）。
3. 本仓库云函数自带诊断：若后端启动失败，浏览器访问任意地址会直接显示具体报错；也可在控制台 → 日志分析 → 函数日志中查看。

### 构建失败：Could not resolve "xxx"

确认仓库最新版（后端依赖已并入根 `package.json`，EdgeOne 构建环境只执行根目录 `pnpm install`）。若你修改过后端版本，请同步把 `backend/package.json` 的依赖合并到根 `package.json`。

## 已知限制

- **冷启动**：云函数不常驻，闲置后首次请求可能慢 1~3 秒
- **实例时长**：单次请求最长 120 秒（`edgeone.json` 已设 `maxDuration: 120`）
- **文件系统不持久**：见上文备份说明
- **定时任务不可靠**：serverless 实例会被回收，建议用外部定时触发
- 免费额度以 EdgeOne Pages 官方说明为准（项目总大小 5G、构建次数等）

## 许可证

- Sub-Store 后端：AGPL-3.0；Sub-Store 前端：GPL-3.0（构建时拉取）
- 本仓库整体以 **AGPL-3.0** 分发，适配代码（`cloud-functions/`、`lib/`、`scripts/`）亦按 AGPL-3.0 授权
- 感谢 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 原作者 [Peng-YM](https://github.com/Peng-YM) / [xream](https://github.com/xream) 及 [EdgeOne Pages](https://edgeone.ai/products/pages) 团队
