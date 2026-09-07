# changji-sync · Cloudflare Worker 云同步后端

为 [real-life-skill-tree.html](../real-life-skill-tree.html) 提供：
- GitHub OAuth 登录（无需密码，开发者友好）
- 整份 state 序列化到 Cloudflare KV（按 GitHub user_id 隔离）
- 跨设备同步

**架构**：单文件 HTML 仍是客户端，只是把"导出/导入"这一步交给云。零前端依赖不变，只是多了一个可选的同步端点。

---

## 1. 注册 GitHub OAuth App

1. 打开 https://github.com/settings/developers
2. **New OAuth App**
3. 填写：
   - Application name: `changji-sync`（或自定义）
   - Homepage URL: `https://atelierqin.github.io/real-life-skill-tree.html`（你的前端 origin）
   - Authorization callback URL: `https://changji-sync.YOUR-SUBDOMAIN.workers.dev/auth/github/callback`
     - 临时用占位 URL；Worker 部署后会拿到真实 URL，再回来改这里
4. 创建后拿到 **Client ID** 和 **Client Secret**（先记下）

## 2. 部署 Worker

需要 [wrangler](https://developers.cloudflare.com/workers/wrangler/)：

```bash
cd sync-server

# 登录 Cloudflare
wrangler login

# 创建 KV namespace
wrangler kv:namespace create CHANGJI_STATE
# 输出形如：{ binding = "CHANGJI_STATE", id = "abc123..." }
# 把这个 id 填到 wrangler.toml 的 id 字段

# 设置 secrets
wrangler secret put GITHUB_CLIENT_ID         # 粘贴 Client ID
wrangler secret put GITHUB_CLIENT_SECRET     # 粘贴 Client Secret
wrangler secret put SESSION_SECRET           # 任取 32+ 字符串，如 openssl rand -hex 32
wrangler secret put FRONTEND_ORIGIN          # 如 https://atelierqin.github.io

# 部署
wrangler deploy
```

部署成功后会输出 Worker URL，如 `https://changji-sync.YOUR-SUBDOMAIN.workers.dev`。

## 3. 把 callback URL 填回 GitHub OAuth App

回到 https://github.com/settings/developers，把 Authorization callback URL 改为：

```
https://changji-sync.YOUR-SUBDOMAIN.workers.dev/auth/github/callback
```

## 4. 前端配置

打开 `real-life-skill-tree.html`，找到 sync-server URL 配置（开发时会加在设置 modal 里），填入：

```js
const SYNC_SERVER = 'https://changji-sync.YOUR-SUBDOMAIN.workers.dev';
```

---

## API 文档

### `GET /health`

健康检查。返回 `changji-sync · ok`。

### `GET /auth/github`

发起 GitHub OAuth 流程。浏览器跳转 → GitHub 授权 → callback → 重定向回前端 URL 带 `#code=<一次性 code>`。

### `POST /auth/exchange`

Body：
```json
{ "code": "<一次性 code>" }
```

把 60s TTL 的一次性 code 换成 JWT。返回：
```json
{ "token": "<JWT>", "user": { "id", "login", "name", "avatar" } }
```

**为什么不让 JWT 直接进 URL**：
- 浏览器历史会持久化 30 天
- 浏览器扩展/截图/共享电脑可能泄漏
- Referer 在 RFC 3986 下不含 fragment，但实际仍有第三方 JS 能读 location

code 一次性 + 60s TTL，即使泄漏也几乎无窗口。

### `GET /me`

返回当前 JWT payload（id/login/name/avatar）。

### `GET /sync`

返回当前用户的云端 state：
```json
{
  "found": true,
  "state": { "schema": "changji-state", "version": 1, ... },
  "meta": { "updatedAt": 1234567890, "uploader": "alice" }
}
```

### `PUT /sync`

Body：
```json
{
  "state": { "schema": "changji-state", "version": 1, ... }
}
```

覆盖上传（latest-wins）。返回：
```json
{ "ok": true, "updatedAt": 1234567890 }
```

### `DELETE /sync`

清除当前用户的云端 state。

---

## 安全说明

- **JWT 默认有效期 30 天**；到期后用户需要重新登录
- **OAuth state 校验**：用 HttpOnly cookie 校验回调，防 OAuth CSRF
- **一次性 code**：回调只返回 60s TTL code，前端 POST 换 JWT，URL 不带 JWT
- **所有 KV 数据按 GitHub user_id 隔离**；用户只能读写自己的数据
- **state 由前端直接序列化**；后端不解析内部字段，只校验 schema 名称 + 字段类型 + 大小（256KB 上限）
- **GitHub OAuth 只请求 `read:user` scope**；不读写仓库、不发邮件

---

## 本地开发

```bash
wrangler dev
# 默认起 http://localhost:8787
# 测试 OAuth：先把 GitHub OAuth App 的 callback URL 临时改为
# http://localhost:8787/auth/github/callback
```