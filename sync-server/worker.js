/**
 * changji-sync · Cloudflare Worker
 *
 * 提供 GitHub OAuth 登录 + 整份 state 上下传到 Cloudflare KV。
 * 部署：见 README.md
 *
 * 环境变量（通过 wrangler secret put 设置）：
 *   GITHUB_CLIENT_ID      OAuth App 的 Client ID
 *   GITHUB_CLIENT_SECRET  OAuth App 的 Client Secret
 *   SESSION_SECRET        用于签发/校验 JWT 的密钥（任取 32+ 字符串）
 *   FRONTEND_ORIGIN       重定向回前端的 origin（如 https://atelierqin.github.io）
 *
 * KV 绑定（wrangler.toml 中配置）：
 *   CHANGJI_STATE         状态存储 namespace
 */

const KV_KEY_PREFIX = 'user:';
const KV_CODE_PREFIX = 'code:';  // 一次性 OAuth code，TTL 60s
const OAUTH_CODE_TTL = 60;       // seconds

// ─── JWT（HS256）───────────────────────────────────────────────

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  return Uint8Array.from(atob(str + pad), c => c.charCodeAt(0));
}
async function hmacSign(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
// JWT 默认有效期 7 天 — 之前 30 天太长，配合"code 交换"模式可以短一些；
// 短 TTL 减少 localStorage 被偷时的伤害窗口，过期用户重新登录即可
async function signJWT(payload, secret, ttlSeconds = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + ttlSeconds };
  const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(full)}`;
  const sig = await hmacSign(secret, unsigned);
  return `${unsigned}.${b64urlEncode(sig)}`;
}
async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const unsigned = `${h}.${p}`;
  const expected = await hmacSign(secret, unsigned);
  const got = b64urlDecode(s);
  if (expected.length !== got.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i];
  if (diff !== 0) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ─── HTTP helpers ──────────────────────────────────────────────

function corsHeaders(req, env) {
  // 收紧 CORS：只允许已配置的 FRONTEND_ORIGIN（或请求的 Origin 一致时回显，
  // 主要给本地开发 / 预览部署用）。生产环境务必配 FRONTEND_ORIGIN。
  const allowed = env.FRONTEND_ORIGIN || 'https://atelierqin.github.io';
  const requestOrigin = req && req.headers.get('Origin');
  const origin = requestOrigin === allowed ? requestOrigin : allowed;
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
function json(data, init = {}, req, env) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(req, env),
      ...(init.headers || {}),
    },
  });
}
function err(msg, status, req, env) {
  return json({ error: msg }, { status }, req, env);
}

// ─── Auth ──────────────────────────────────────────────────────

async function requireAuth(req, env) {
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return err('unauthorized', 401, req, env);
  const payload = await verifyJWT(auth.slice(7), env.SESSION_SECRET);
  if (!payload) return err('invalid token', 401, req, env);
  return payload;
}

function handleAuthStart(req, env) {
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/auth/github/callback`;
  const state = crypto.randomUUID();
  const url =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=read%3Auser` +
    `&state=${state}`;
  // 把 state 通过 HttpOnly cookie 带回，callback 时校验后清空。
  // 这样可以防 OAuth CSRF（攻击者发起的授权链接骗用户点击，把受害者的 session 绑到攻击者账号）。
  const isHttps = origin.startsWith('https://');
  const cookie = [
    `oauth_state=${state}`,
    'Path=/',
    'HttpOnly',
    isHttps ? 'Secure' : '',
    'SameSite=Lax',
    'Max-Age=600',
  ].filter(Boolean).join('; ');
  return new Response(null, {
    status: 302,
    headers: { 'Location': url, 'Set-Cookie': cookie },
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function clearStateCookie(req) {
  const isHttps = new URL(req.url).origin.startsWith('https://');
  return [
    'oauth_state=',
    'Path=/',
    'HttpOnly',
    isHttps ? 'Secure' : '',
    'SameSite=Lax',
    'Max-Age=0',
  ].filter(Boolean).join('; ');
}

async function handleAuthCallback(req, env) {
  const url = new URL(req.url);
  const ghCode = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!ghCode) return err('no code', 400, req, env);

  // 校验 OAuth state — 防止攻击者用自己的 code 诱使受害者绑到自己账号
  const cookies = parseCookies(req.headers.get('Cookie'));
  if (!stateParam || !cookies.oauth_state || cookies.oauth_state !== stateParam) {
    return err('invalid state', 400, req, env);
  }

  // 用 GitHub code 换 access_token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: ghCode,
    }),
  });
  if (!tokenRes.ok) return err(`github token: ${tokenRes.status}`, 502, req, env);
  let tokenData;
  try { tokenData = await tokenRes.json(); }
  catch (_) { return err('github token: invalid response', 502, req, env); }
  if (tokenData.error) return err(`github: ${tokenData.error_description || tokenData.error}`, 400, req, env);
  const accessToken = tokenData.access_token;
  if (!accessToken) return err('no access token', 400, req, env);

  // 拿用户信息
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'changji-sync',
    },
  });
  if (!userRes.ok) return err(`github user: ${userRes.status}`, 502, req, env);
  let userData;
  try { userData = await userRes.json(); }
  catch (_) { return err('github user: invalid response', 502, req, env); }

  // 签发 JWT
  const session = await signJWT({
    id: String(userData.id),
    login: userData.login,
    name: userData.name || userData.login,
    avatar: userData.avatar_url,
  }, env.SESSION_SECRET);

  // 不直接把 JWT 放 URL（会进浏览器历史、可能被 referer/扩展/截图泄漏）。
  // 改为：生成一次性 code 存 KV（60s TTL），前端 POST /auth/exchange 换 JWT。
  const oneTimeCode = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await env.CHANGJI_STATE.put(
    KV_CODE_PREFIX + oneTimeCode,
    JSON.stringify({
      token: session,
      user: {
        id: String(userData.id),
        login: userData.login,
        name: userData.name || userData.login,
        avatar: userData.avatar_url,
      },
    }),
    { expirationTtl: OAUTH_CODE_TTL }
  );

  // 重定向回前端，URL 里只放 60s 的一次性 code
  const front = env.FRONTEND_ORIGIN || 'https://atelierqin.github.io';
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${front}/real-life-skill-tree.html#code=${oneTimeCode}`,
      'Set-Cookie': clearStateCookie(req),
    },
  });
}

async function handleAuthExchange(req, env) {
  // 一次性 code → JWT。任何人都可以 POST，但 code 用一次即失效。
  let body;
  try { body = await req.json(); } catch (_) { return err('invalid json', 400, req, env); }
  const code = body && body.code;
  if (!code || typeof code !== 'string' || code.length < 16) return err('invalid code', 400, req, env);

  const raw = await env.CHANGJI_STATE.get(KV_CODE_PREFIX + code);
  if (!raw) return err('code expired or invalid', 400, req, env);
  // 立刻删除，避免重放
  await env.CHANGJI_STATE.delete(KV_CODE_PREFIX + code);

  try {
    const data = JSON.parse(raw);
    return json({ token: data.token, user: data.user }, {}, req, env);
  } catch (_) {
    return err('code payload corrupted', 500, req, env);
  }
}

// ─── Sync ──────────────────────────────────────────────────────

async function handleGet(req, env, user) {
  const raw = await env.CHANGJI_STATE.get(KV_KEY_PREFIX + user.id);
  if (!raw) return json({ found: false }, {}, req, env);
  try {
    const data = JSON.parse(raw);
    return json({ found: true, ...data }, {}, req, env);
  } catch (_) {
    return json({ found: false, corrupted: true }, {}, req, env);
  }
}

// 单条 state 的硬上限，防止恶意用户上传巨大 payload 撑爆 KV
const MAX_STATE_BYTES = 256 * 1024; // 256KB — 单用户一份进度的合理上限
const MAX_REQUEST_BYTES = 512 * 1024; // 含 metadata 的整请求上限

async function handlePut(req, env, user) {
  // 入口先按 Content-Length / 实际读取双重限制，避免单请求拖垮 KV
  const contentLen = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (contentLen && contentLen > MAX_REQUEST_BYTES) {
    return err('payload too large', 413, req, env);
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_REQUEST_BYTES) return err('payload too large', 413, req, env);
    body = JSON.parse(raw);
  } catch (_) {
    return err('invalid json', 400, req, env);
  }
  if (!body || typeof body !== 'object') return err('invalid body', 400, req, env);
  const state = body.state;
  if (!state || typeof state !== 'object') return err('missing state', 400, req, env);
  if (state.schema !== 'changji-state') return err('invalid schema', 400, req, env);
  if (typeof state.version !== 'number') return err('invalid version', 400, req, env);

  // 字段类型校验 — schema 名 + version 号不够；防止前端后续操作崩溃
  const objErr = (k) => typeof state[k] !== 'object' || state[k] === null || Array.isArray(state[k]);
  if (objErr('skills'))        return err('invalid skills', 400, req, env);
  if (objErr('quests'))        return err('invalid quests', 400, req, env);
  if (objErr('dailyBrush'))    return err('invalid dailyBrush', 400, req, env);
  if (objErr('weeklyClaimed')) return err('invalid weeklyClaimed', 400, req, env);
  if (!Array.isArray(state.log)) return err('invalid log', 400, req, env);

  // 序列化后再限一次，防止 JSON 里塞大字符串
  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_BYTES) {
    return err('state too large', 413, req, env);
  }

  const data = {
    state,
    meta: {
      updatedAt: Date.now(),
      uploader: user.login,
    },
  };
  await env.CHANGJI_STATE.put(KV_KEY_PREFIX + user.id, JSON.stringify(data));
  return json({ ok: true, updatedAt: data.meta.updatedAt }, {}, req, env);
}

async function handleDelete(req, env, user) {
  await env.CHANGJI_STATE.delete(KV_KEY_PREFIX + user.id);
  return json({ ok: true }, {}, req, env);
}

// ─── Router ────────────────────────────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req, env) });

    // 健康检查
    if (path === '/' || path === '/health') {
      return new Response('changji-sync · ok', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(req, env) },
      });
    }

    // OAuth（无需鉴权）
    if (path === '/auth/github' && method === 'GET') return handleAuthStart(req, env);
    if (path === '/auth/github/callback' && method === 'GET') return handleAuthCallback(req, env);
    if (path === '/auth/exchange' && method === 'POST') return handleAuthExchange(req, env);

    // 鉴权路由
    const user = await requireAuth(req, env);
    if (user instanceof Response) return user;

    if (path === '/me') return json(user, {}, req, env);

    if (path === '/sync') {
      if (method === 'GET') return handleGet(req, env, user);
      if (method === 'PUT') return handlePut(req, env, user);
      if (method === 'DELETE') return handleDelete(req, env, user);
      return err('method not allowed', 405, req, env);
    }

    return err('not found', 404, req, env);
  },
};