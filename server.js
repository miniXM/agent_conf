const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const { createDmapiAuthService, createLocalUserStore } = require("./dmapi-auth-service.cjs");

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PORT || 4788);
const ROOT = __dirname;

function resolveDataDir() {
  const customDataDir = String(process.env.AGENT_CONF_DATA_DIR || "").trim();
  if (customDataDir) return path.resolve(customDataDir);
  return path.join(ROOT, ".agent-conf");
}

function resolveAppDataDir() {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function resolveLocalAppDataDir() {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

const PUBLIC_DIR = path.join(ROOT, "public");
const ASSETS_DIR = path.join(ROOT, "assets");
const DATA_DIR = resolveDataDir();
const LEARN_DIR = path.join(DATA_DIR, "learn");
const LEARN_SOURCE_PATH = path.join(LEARN_DIR, "source.json");
const LEARN_CATALOG_CACHE_PATH = path.join(LEARN_DIR, "catalog-cache.json");
const LEARN_ARTICLES_DIR = path.join(LEARN_DIR, "articles");
const LEARN_COVERS_DIR = path.join(LEARN_DIR, "covers");
const LEARN_SAMPLE_CATALOG_PATH = path.join(PUBLIC_DIR, "learn-sample", "catalog.json");
const DEFAULT_LEARN_CATALOG_URL = "https://gitee.com/miniXM/agent_conf/raw/master/public/learn-sample/catalog.json";
const LAST_RUN_PATH = path.join(DATA_DIR, "last-direct-write.json");
const TOOL_STATE_PATH = path.join(DATA_DIR, "tool-state.json");
const USERCONF_PATH = path.join(DATA_DIR, "userconf.json");
const LEGACY_USERCONF_PATH = path.join(ROOT, "userconf.json");
const APPDATA = resolveAppDataDir();
const LOCALAPPDATA = resolveLocalAppDataDir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CODEX_AUTH_PATH = path.join(CODEX_HOME, "auth.json");
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
const HERMES_ENV_PATH = path.join(HERMES_HOME, ".env");
const LOBSTER_DB_PATH = process.env.LOBSTER_DB_PATH || path.join(APPDATA, "LobsterAI", "lobsterai.sqlite");
const LOBSTER_PROVIDER_KEY = "custom_0";
const DEFAULT_PROVIDER_BASE_URL = "https://token.minapp.xin/v1";
const BUYTOKEN_BASE_URL = "https://buytoken.clawos.cc";
const APP_NAME = "agent_conf";
const TOOL_REGISTRY_PATH = path.join(ROOT, "config", "tool-registry.json");
const WRITE_RULES_PATH = path.join(ROOT, "config", "write-rules.json");
const TOOL_VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const TOOL_VERSION_CACHE = new Map();

const API_TYPES = {
  "openai-responses": {
    label: "openai-responses",
    codexWireApi: "responses",
    hermesApiMode: "responses",
    lobsterApiFormat: "openai"
  },
  "openai-completions": {
    label: "openai-completions",
    codexWireApi: "chat",
    hermesApiMode: "chat_completions",
    lobsterApiFormat: "openai"
  },
  "anthropic-messages": {
    label: "anthropic-messages",
    codexWireApi: "anthropic",
    hermesApiMode: "anthropic_messages",
    lobsterApiFormat: "anthropic"
  }
};

const TOOL_ADAPTERS = {
  codex: {
    id: "codex",
    name: "Codex",
    type: "codex-toml",
    defaultPath: path.join(CODEX_HOME, "config.toml"),
    authPath: CODEX_AUTH_PATH,
    stable: true
  },
  lobster: {
    id: "lobster",
    name: "LobsterAI",
    type: "lobster-sqlite",
    defaultPath: LOBSTER_DB_PATH,
    stable: false
  },
  hermes: {
    id: "hermes",
    name: "Hermes",
    type: "hermes-files",
    defaultPath: path.join(HERMES_HOME, "config.yaml"),
    envPath: HERMES_ENV_PATH,
    stable: true
  }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8"
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureLearnDirs() {
  ensureDataDir();
  fs.mkdirSync(LEARN_DIR, { recursive: true });
  fs.mkdirSync(LEARN_ARTICLES_DIR, { recursive: true });
  fs.mkdirSync(LEARN_COVERS_DIR, { recursive: true });
}

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function parseCookieHeader(header) {
  const out = {};
  String(header || "").split(";").forEach(part => {
    const index = part.indexOf("=");
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function getHeaderValue(headers, name) {
  const normalized = String(name || "").toLowerCase();
  const value = headers ? headers[normalized] : "";
  return Array.isArray(value) ? value[0] : value || "";
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": `${APP_NAME}/0.1`
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": `${APP_NAME}/0.1`
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractFirstString(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
      return String(value[key]).trim();
    }
  }
  return "";
}

function maskSecret(value) {
  const textValue = String(value || "");
  if (!textValue) return "";
  if (textValue.length <= 10) return `${textValue.slice(0, 2)}...`;
  return `${textValue.slice(0, 6)}...${textValue.slice(-4)}`;
}

function escapeToml(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function escapeYaml(value) {
  return `"${String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function escapeDotenv(value) {
  return `"${String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function normalizeBaseUrl(input) {
  let value = String(input || "").trim();
  if (!value) throw new Error("Base URL is required.");
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL must start with http:// or https://.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function isOpenAiDefaultBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "") === "https://api.openai.com/v1";
}

function normalizeOpenAiApiKey(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.startsWith("sk-") ? value : `sk-${value}`;
}

function validateProviderId(id) {
  const value = String(id || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(value)) {
    throw new Error("Provider id must start with a letter and use lowercase letters, numbers, hyphens, or underscores.");
  }
  if (["openai", "ollama", "lmstudio", "amazon-bedrock"].includes(value)) {
    throw new Error("Provider id uses a reserved Codex provider name.");
  }
  return value;
}

function normalizeApiType(value) {
  const key = String(value || "openai-responses").trim();
  if (!API_TYPES[key]) {
    throw new Error("API type is not supported.");
  }
  return key;
}

function getApiTypeConfig(value) {
  return API_TYPES[normalizeApiType(value)];
}

function sanitizePath(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Target path is required.");
  return path.resolve(value);
}

function slugifyName(value, fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function isRemoteHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readJsonFile(filePath, fallback) {
  if (!exists(filePath)) return fallback;
  try {
    return JSON.parse(readFileSafe(filePath));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeLearnCatalogUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("卡片列表地址必须是 http:// 或 https:// 地址。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("卡片列表地址必须是 http:// 或 https:// 地址。");
  }
  if (parsed.hostname === "gitee.com" && parsed.pathname.includes("/blob/")) {
    parsed.pathname = parsed.pathname.replace("/blob/", "/raw/");
  }
  parsed.hash = "";
  return parsed.toString();
}

function readLearnSource() {
  const source = readJsonFile(LEARN_SOURCE_PATH, {});
  return {
    catalogUrl: String(source.catalogUrl || "").trim(),
    updatedAt: source.updatedAt || null
  };
}

function writeLearnSource(catalogUrl) {
  ensureLearnDirs();
  const normalizedUrl = normalizeLearnCatalogUrl(catalogUrl);
  const source = {
    catalogUrl: normalizedUrl,
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(LEARN_SOURCE_PATH, source);
  return source;
}

function getLearnSourceTarget() {
  const source = readLearnSource();
  if (source.catalogUrl) {
    return {
      catalogUrl: source.catalogUrl,
      configured: true,
      usingSample: false
    };
  }
  return {
    catalogUrl: DEFAULT_LEARN_CATALOG_URL,
    configured: false,
    usingSample: false
  };
}

function resolvePublicPath(publicUrl) {
  const parsed = new URL(String(publicUrl || ""), "http://local");
  const requested = decodeURIComponent(parsed.pathname || "");
  if (!requested.startsWith("/")) {
    throw new Error("Local public URL is invalid.");
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Local public URL is outside the public directory.");
  }
  if (!exists(filePath) || !statSafe(filePath).isFile()) {
    throw new Error(`Local file was not found: ${requested}`);
  }
  return filePath;
}

function resolveLearnUrl(value, baseUrl) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^data:/i.test(input)) return input;
  if (input.startsWith("/")) return input;
  if (isRemoteHttpUrl(input)) return input;
  if (isRemoteHttpUrl(baseUrl)) {
    return new URL(input, baseUrl).toString();
  }
  return new URL(input, `http://local${baseUrl || "/learn-sample/catalog.json"}`).pathname;
}

async function readLearnTextResource(resourceUrl) {
  if (String(resourceUrl || "").startsWith("/")) {
    return readFileSafe(resolvePublicPath(resourceUrl));
  }
  if (isRemoteHttpUrl(resourceUrl)) {
    return fetchText(resourceUrl);
  }
  throw new Error("Resource URL must be local public path or remote HTTP URL.");
}

async function readLearnBinaryResource(resourceUrl) {
  if (String(resourceUrl || "").startsWith("/")) {
    return fs.readFileSync(resolvePublicPath(resourceUrl));
  }
  if (isRemoteHttpUrl(resourceUrl)) {
    return fetchArrayBuffer(resourceUrl);
  }
  throw new Error("Resource URL must be local public path or remote HTTP URL.");
}

function normalizeLearnCatalog(content, catalogUrl) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("卡片列表不是有效 JSON。");
  }
  const rawCards = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.cards) ? parsed.cards : [];
  if (!rawCards.length) {
    throw new Error("卡片列表里没有 cards。");
  }
  const cards = rawCards
    .filter(card => card && typeof card === "object" && !Array.isArray(card))
    .map((card, index) => {
      const title = extractFirstString(card, ["title", "name"]) || `文章 ${index + 1}`;
      const id = slugifyName(extractFirstString(card, ["id", "slug", "key"]) || title, `article-${index + 1}`);
      const html = resolveLearnUrl(extractFirstString(card, ["html", "url", "href", "article", "contentUrl"]), catalogUrl);
      const cover = resolveLearnUrl(extractFirstString(card, ["cover", "image", "img", "thumbnail"]), catalogUrl);
      return {
        id,
        title,
        desc: extractFirstString(card, ["desc", "summary", "excerpt", "description"]),
        cover,
        html,
        htmlVersion: extractFirstString(card, ["htmlVersion", "contentVersion", "version", "updatedAt"]) || "1",
        coverVersion: extractFirstString(card, ["coverVersion", "imageVersion", "updatedAt"]) || "1",
        updatedAt: extractFirstString(card, ["updatedAt", "date", "time"]),
        style: extractFirstString(card, ["style", "variant"])
      };
    });

  return {
    version: extractFirstString(parsed, ["version", "updatedAt"]) || "1",
    sourceUrl: catalogUrl,
    updatedAt: new Date().toISOString(),
    cards
  };
}

function readLearnCatalogCache() {
  const catalog = readJsonFile(LEARN_CATALOG_CACHE_PATH, null);
  return catalog && Array.isArray(catalog.cards) ? catalog : null;
}

function writeLearnCatalogCache(catalog) {
  ensureLearnDirs();
  writeJsonFile(LEARN_CATALOG_CACHE_PATH, catalog);
}

function readLearnCacheMeta() {
  const meta = readJsonFile(path.join(LEARN_DIR, "cache-meta.json"), {});
  return {
    articles: meta && typeof meta.articles === "object" && !Array.isArray(meta.articles) ? meta.articles : {},
    covers: meta && typeof meta.covers === "object" && !Array.isArray(meta.covers) ? meta.covers : {}
  };
}

function writeLearnCacheMeta(meta) {
  ensureLearnDirs();
  writeJsonFile(path.join(LEARN_DIR, "cache-meta.json"), {
    articles: meta.articles || {},
    covers: meta.covers || {},
    updatedAt: new Date().toISOString()
  });
}

function learnArticlePath(id) {
  return path.join(LEARN_ARTICLES_DIR, `${slugifyName(id, "article")}.html`);
}

function learnArticleUrl(id) {
  return `/api/learn/article/${encodeURIComponent(slugifyName(id, "article"))}`;
}

function learnCoverExtension(coverUrl) {
  if (!coverUrl || /^data:/i.test(coverUrl)) return "";
  try {
    const parsed = new URL(coverUrl, "http://local");
    const ext = path.extname(parsed.pathname).toLowerCase();
    return MIME[ext] ? ext : ".png";
  } catch {
    return ".png";
  }
}

function learnCoverPath(card) {
  const ext = learnCoverExtension(card.cover);
  if (!ext) return "";
  return path.join(LEARN_COVERS_DIR, `${slugifyName(card.id, "cover")}${ext}`);
}

async function cacheLearnCover(card, meta, force = false) {
  if (!card.cover || /^data:/i.test(card.cover)) return null;
  const filePath = learnCoverPath(card);
  if (!filePath) return null;
  const current = meta.covers[card.id];
  if (
    !force
    && current
    && current.cover === card.cover
    && current.coverVersion === card.coverVersion
    && exists(path.join(LEARN_COVERS_DIR, current.filename || ""))
  ) {
    return current;
  }
  try {
    const buffer = await readLearnBinaryResource(card.cover);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    const next = {
      cover: card.cover,
      coverVersion: card.coverVersion,
      filename: path.basename(filePath),
      cachedAt: new Date().toISOString()
    };
    meta.covers[card.id] = next;
    return next;
  } catch {
    return current || null;
  }
}

function decorateLearnCatalog(catalog) {
  const meta = readLearnCacheMeta();
  const cards = catalog.cards.map(card => {
    const articleMeta = meta.articles[card.id];
    const articleFile = learnArticlePath(card.id);
    const hasCachedArticle = exists(articleFile);
    const isArticleCurrent = Boolean(
      hasCachedArticle
      && articleMeta
      && articleMeta.html === card.html
      && articleMeta.htmlVersion === card.htmlVersion
    );
    const coverMeta = meta.covers[card.id];
    const coverFile = coverMeta && coverMeta.filename ? path.join(LEARN_COVERS_DIR, coverMeta.filename) : "";
    const localCover = coverFile && exists(coverFile)
      ? `/api/learn/cover/${encodeURIComponent(card.id)}?v=${encodeURIComponent(card.coverVersion)}`
      : "";
    return {
      ...card,
      hasCachedArticle,
      isArticleCurrent,
      articleUrl: hasCachedArticle ? learnArticleUrl(card.id) : "",
      coverDisplay: localCover || card.cover || ""
    };
  });
  return {
    ...catalog,
    cards
  };
}

async function getLearnCatalog({ refresh = false } = {}) {
  ensureLearnDirs();
  const source = getLearnSourceTarget();
  let catalog = readLearnCatalogCache();
  let refreshed = false;
  let message = "";

  if (refresh || !catalog || catalog.sourceUrl !== source.catalogUrl) {
    try {
      const content = await readLearnTextResource(source.catalogUrl);
      catalog = normalizeLearnCatalog(content, source.catalogUrl);
      catalog.usingSample = source.usingSample;
      catalog.configured = source.configured;
      writeLearnCatalogCache(catalog);
      const meta = readLearnCacheMeta();
      for (const card of catalog.cards) {
        await cacheLearnCover(card, meta);
      }
      writeLearnCacheMeta(meta);
      refreshed = true;
    } catch (error) {
      if (!catalog) throw error;
      message = `更新失败，已使用本地缓存：${error.message}`;
    }
  }

  return {
    ok: true,
    refreshed,
    message,
    configured: source.configured,
    usingSample: source.usingSample,
    catalog: decorateLearnCatalog(catalog)
  };
}

async function cacheLearnArticle(id, { force = false } = {}) {
  ensureLearnDirs();
  const catalog = readLearnCatalogCache();
  if (!catalog || !Array.isArray(catalog.cards)) {
    throw new Error("请先刷新卡片列表。");
  }
  const safeId = slugifyName(id, "article");
  const card = catalog.cards.find(item => item.id === safeId);
  if (!card) {
    throw new Error("没有找到这篇文章。");
  }
  if (!card.html) {
    throw new Error("这张卡片缺少 HTML 地址。");
  }

  const filePath = learnArticlePath(card.id);
  const meta = readLearnCacheMeta();
  const current = meta.articles[card.id];
  const isCurrent = Boolean(
    exists(filePath)
    && current
    && current.html === card.html
    && current.htmlVersion === card.htmlVersion
  );

  if (isCurrent && !force) {
    return {
      ok: true,
      id: card.id,
      cached: true,
      fromCache: true,
      articleUrl: learnArticleUrl(card.id)
    };
  }

  try {
    const html = await readLearnTextResource(card.html);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, html, "utf8");
    meta.articles[card.id] = {
      html: card.html,
      htmlVersion: card.htmlVersion,
      cachedAt: new Date().toISOString()
    };
    writeLearnCacheMeta(meta);
    return {
      ok: true,
      id: card.id,
      cached: true,
      fromCache: false,
      articleUrl: learnArticleUrl(card.id)
    };
  } catch (error) {
    if (exists(filePath)) {
      return {
        ok: true,
        id: card.id,
        cached: true,
        stale: true,
        warning: error.message,
        articleUrl: learnArticleUrl(card.id)
      };
    }
    throw error;
  }
}

function serveLearnArticle(res, id) {
  const filePath = learnArticlePath(id);
  if (!exists(filePath) || !statSafe(filePath).isFile()) {
    text(res, 404, "Article has not been cached.");
    return;
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src data: blob: http: https:; media-src data: blob: http: https:; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; script-src 'none'"
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveLearnCover(res, id) {
  const meta = readLearnCacheMeta();
  const cover = meta.covers[String(id || "")];
  if (!cover || !cover.filename) {
    text(res, 404, "Cover has not been cached.");
    return;
  }
  const filePath = path.normalize(path.join(LEARN_COVERS_DIR, cover.filename));
  const relative = path.relative(LEARN_COVERS_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !exists(filePath) || !statSafe(filePath).isFile()) {
    text(res, 404, "Cover has not been cached.");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupFile(filePath) {
  if (!exists(filePath)) return null;
  const backupPath = `${filePath}.bak-${timestamp()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function writeManagedFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const backupPath = backupFile(filePath);
  fs.writeFileSync(filePath, content, "utf8");
  return backupPath;
}

function inferOriginalPathFromBackup(backupPath) {
  const markerIndex = String(backupPath || "").lastIndexOf(".bak-");
  if (markerIndex === -1) {
    throw new Error(`Backup path is not recognized: ${backupPath}`);
  }
  return backupPath.slice(0, markerIndex);
}

function restoreBackupFile(backupPath, originalPath) {
  const source = sanitizePath(backupPath);
  const destination = sanitizePath(originalPath || inferOriginalPathFromBackup(source));
  if (!exists(source)) {
    throw new Error(`Backup file was not found: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const currentBackupPath = backupFile(destination);
  fs.copyFileSync(source, destination);
  return {
    path: destination,
    backupPath: source,
    currentBackupPath
  };
}

function backupLobsterDatabaseFiles(dbPath) {
  const backupPaths = [];
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    const backupPath = backupFile(candidate);
    if (backupPath) backupPaths.push(backupPath);
  }
  return backupPaths;
}

function extractCodexSummary(content) {
  const summary = {
    model: "",
    modelProvider: "",
    baseUrl: "",
    requiresOpenaiAuth: false,
    wireApi: "",
    providerName: ""
  };
  const model = content.match(/^\s*model\s*=\s*"([^"]+)"/m);
  const provider = content.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
  summary.model = model ? model[1] : "";
  summary.modelProvider = provider ? provider[1] : "";

  if (summary.modelProvider) {
    const section = getTomlTable(content, `model_providers.${summary.modelProvider}`);
    summary.baseUrl = readTomlString(section, "base_url");
    summary.requiresOpenaiAuth = readTomlBoolean(section, "requires_openai_auth");
    summary.wireApi = readTomlString(section, "wire_api");
    summary.providerName = readTomlString(section, "name");
  }

  if (!summary.baseUrl) {
    summary.baseUrl = readTomlString(content, "openai_base_url");
  }
  return summary;
}

function getTomlTable(content, tableName) {
  const lines = content.split(/\r?\n/);
  let collecting = false;
  const out = [];
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const current = header[1].trim();
      if (current === tableName) {
        collecting = true;
        out.push(line);
        continue;
      }
      if (collecting) break;
    }
    if (collecting) out.push(line);
  }
  return out.join("\n");
}

function readTomlString(content, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m");
  const match = content.match(pattern);
  return match ? match[1] : "";
}

function readTomlBoolean(content, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, "mi");
  const match = content.match(pattern);
  return match ? match[1].toLowerCase() === "true" : false;
}

function removeTomlTables(content, providerId) {
  const lines = content.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const table = header[1].trim();
      skipping = table === `model_providers.${providerId}` || table.startsWith(`model_providers.${providerId}.`);
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd();
}

function upsertRootTomlKeys(content, keys) {
  const lines = content ? content.split(/\r?\n/) : [];
  let rootEnd = lines.findIndex(line => /^\s*\[/.test(line));
  if (rootEnd === -1) rootEnd = lines.length;

  for (const [key, value] of Object.entries(keys)) {
    const rendered = `${key} = "${escapeToml(value)}"`;
    let replaced = false;
    for (let i = 0; i < rootEnd; i += 1) {
      if (new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) {
        lines[i] = rendered;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      lines.splice(rootEnd, 0, rendered);
      rootEnd += 1;
    }
  }

  return lines.join("\n").trimEnd();
}

function codexProviderSnippet(config) {
  const providerName = config.providerName || "claw";
  return [
    "",
    `# Managed by ${APP_NAME}. Direct write mode: real provider URL, API key from auth.json.`,
    `[model_providers.${config.providerId}]`,
    `name = "${escapeToml(providerName)}"`,
    `base_url = "${escapeToml(config.baseUrl)}"`,
    `wire_api = "${escapeToml(getApiTypeConfig(config.apiType).codexWireApi)}"`,
    "requires_openai_auth = true",
    ""
  ].join("\n");
}

function buildCodexConfig(current, config) {
  let next = removeTomlTables(current || "", config.providerId);
  next = upsertRootTomlKeys(next, {
    model: config.model,
    model_provider: config.providerId
  });
  return `${next.trimEnd()}\n${codexProviderSnippet(config)}`;
}

function parseJsonObject(content, label) {
  if (!String(content || "").trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function stringifyJsonObject(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildCodexAuth(current, apiKey) {
  const next = parseJsonObject(current || "", "Codex auth.json");
  next.OPENAI_API_KEY = apiKey || "<OPENAI_API_KEY>";
  return stringifyJsonObject(next);
}

function removeYamlTopLevelBlock(content, key) {
  const lines = content.split(/\r?\n/);
  const kept = [];
  let skipping = false;
  const blockStart = new RegExp(`^${key}\\s*:`);

  for (const line of lines) {
    if (/^\S[^:]*:\s*/.test(line)) {
      skipping = blockStart.test(line);
    }
    if (!skipping) kept.push(line);
  }

  return kept.join("\n").trimEnd();
}

function buildHermesConfig(current, config, apiKey) {
  const preserved = removeYamlTopLevelBlock(current || "", "model");
  const withoutProviders = removeYamlTopLevelBlock(preserved, "providers");
  const modelBlock = [
    `# Managed by ${APP_NAME}. Direct custom endpoint.`,
    "model:",
    `  default: ${escapeYaml(config.model)}`,
    "  provider: custom",
    `  base_url: ${escapeYaml(config.baseUrl)}`,
    `  supports_vision: ${config.supportsVision ? "true" : "false"}`,
    `  api_key: ${escapeYaml(apiKey || "")}`
  ].join("\n");
  return `${withoutProviders ? `${withoutProviders}\n\n` : ""}${modelBlock}\n`;
}

function parseDotenvDisplayValue(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.indexOf(" #");
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}

function maskEnvFileContent(content, keys = []) {
  const keySet = new Set(keys);
  return String(content || "")
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/^(\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*)(.*)$/);
      if (!match || (!keySet.has(match[2]) && !isSensitiveKey(match[2]))) return line;
      const current = parseDotenvDisplayValue(match[3]);
      return `${match[1]}${escapeDotenv(maskSecret(current) || "<empty>")}`;
    })
    .join("\n");
}

function upsertDotenvValue(current, name, value) {
  const rendered = `${name}=${escapeDotenv(value)}`;
  const lines = current ? current.split(/\r?\n/) : [];
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  let replaced = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      lines[i] = rendered;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push(`# Managed by ${APP_NAME}.`);
    lines.push(rendered);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function buildGenericJson(tool, config) {
  return `${JSON.stringify(
    {
      managedBy: APP_NAME,
      mode: "direct-write",
      updatedAt: new Date().toISOString(),
      tool,
      provider: {
        type: config.apiType,
        baseUrl: config.baseUrl,
        model: config.model,
        wireApi: getApiTypeConfig(config.apiType).codexWireApi
      }
    },
    null,
    2
  )}\n`;
}

function defaultToolRegistry() {
  return {
    schemaVersion: 1,
    tools: {
      codex: {
        writerVersion: "codex-config-v1",
        versions: ["0.137.0"],
        versionSources: [
          {
            type: "file",
            path: "${APPDATA}\\npm\\node_modules\\@openai\\codex\\package.json",
            extract: {
              pattern: "\"version\"\\s*:\\s*\"([^\"]+)\"",
              flags: "m",
              group: 1
            }
          },
          {
            type: "command",
            command: "codex",
            args: ["--version"],
            timeoutMs: 1200,
            extract: {
              pattern: "codex-cli\\s+([^\\s]+)",
              flags: "m",
              group: 1
            }
          }
        ]
      },
      hermes: {
        writerVersion: "hermes-config-v1",
        versions: ["0.15.1"],
        versionSources: [
          {
            type: "file",
            path: "${LOCALAPPDATA}\\hermes\\hermes-agent\\hermes_agent.egg-info\\PKG-INFO",
            extract: {
              pattern: "^Version:\\s*([^\\r\\n]+)$",
              flags: "m",
              group: 1
            }
          },
          {
            type: "command",
            command: "hermes",
            args: ["--version"],
            timeoutMs: 1200,
            extract: {
              pattern: "Hermes Agent\\s+v?([0-9]+(?:\\.[0-9]+)+(?:\\.[0-9]+)?)",
              flags: "i",
              group: 1
            }
          }
        ]
      },
      lobster: {
        writerVersion: "lobster-sqlite-v1",
        versions: ["2026.6.15.0"],
        versionSources: [
          {
            type: "file-version",
            path: "${LOCALAPPDATA}\\Programs\\LobsterAI\\LobsterAI.exe"
          }
        ]
      }
    }
  };
}

function expandRegistryTemplate(value) {
  return String(value || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
    if (key === "ROOT") return ROOT;
    if (key === "CODEX_HOME") return CODEX_HOME;
    if (key === "HERMES_HOME") return HERMES_HOME;
    if (key === "APPDATA") return APPDATA;
    if (key === "LOCALAPPDATA") return LOCALAPPDATA;
    return process.env[key] || "";
  });
}

function normalizeRegistryPath(value) {
  const expanded = expandRegistryTemplate(value);
  if (process.platform === "win32") return expanded;
  return expanded.replace(/\\/g, "/");
}

function normalizeToolRegistry(registry) {
  const fallback = defaultToolRegistry();
  const tools = registry && registry.tools && typeof registry.tools === "object" && !Array.isArray(registry.tools)
    ? registry.tools
    : {};
  const out = {
    schemaVersion: Number(registry && registry.schemaVersion) || 1,
    tools: {}
  };
  for (const [toolId, defaults] of Object.entries(fallback.tools)) {
    const value = tools[toolId] && typeof tools[toolId] === "object" && !Array.isArray(tools[toolId])
      ? tools[toolId]
      : {};
    const versionSources = Array.isArray(value.versionSources) && value.versionSources.length
      ? value.versionSources
      : defaults.versionSources;
    out.tools[toolId] = {
      writerVersion: String(value.writerVersion || defaults.writerVersion || "").trim(),
      versions: Array.from(new Set([
        ...(Array.isArray(value.versions) ? value.versions : []),
        ...(Array.isArray(defaults.versions) ? defaults.versions : [])
      ].map(item => String(item || "").trim()).filter(Boolean))),
      versionSources: versionSources.map(source => ({
        ...source,
        type: String(source.type || "command").trim()
      }))
    };
  }
  return out;
}

function loadToolRegistry() {
  if (loadToolRegistry.cache) return loadToolRegistry.cache;
  let registry = defaultToolRegistry();
  if (exists(TOOL_REGISTRY_PATH)) {
    try {
      registry = parseJsonObject(readFileSafe(TOOL_REGISTRY_PATH), "Tool registry");
    } catch (error) {
      console.error(`Failed to read tool registry: ${error.message || error}`);
    }
  }
  loadToolRegistry.cache = normalizeToolRegistry(registry);
  return loadToolRegistry.cache;
}

function getToolRegistryEntry(toolId) {
  const registry = loadToolRegistry();
  return registry.tools[toolId] || defaultToolRegistry().tools[toolId] || { writerVersion: "", versions: [], versionSources: [] };
}

function firstNonEmptyValue(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function runCommandText(command, args = [], timeoutMs = 1200) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true
  });
  return firstNonEmptyValue([result.stdout, result.stderr]);
}

function readWindowsFileVersion(filePath) {
  if (process.platform !== "win32") return "";
  const resolved = sanitizePath(filePath);
  if (!exists(resolved)) return "";
  const script = [
    '$p = $env:VERSION_PATH',
    'if (Test-Path -LiteralPath $p) {',
    '  $item = Get-Item -LiteralPath $p',
    '  if ($item -and $item.VersionInfo) {',
    '    Write-Output $item.VersionInfo.ProductVersion',
    '    Write-Output $item.VersionInfo.FileVersion',
    '  }',
    '}'
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
    env: {
      ...process.env,
      VERSION_PATH: resolved
    }
  });
  return firstNonEmptyValue([result.stdout, result.stderr]);
}

function extractVersionText(text, extract) {
  const raw = firstNonEmptyValue([text]);
  if (!raw) return "";
  if (!extract || !extract.pattern) {
    return raw.split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
  }
  const flags = String(extract.flags || "m");
  const groupIndex = Number.isInteger(extract.group) ? extract.group : 1;
  const match = raw.match(new RegExp(extract.pattern, flags));
  if (!match) return "";
  return firstNonEmptyValue([match[groupIndex], match[0]]);
}

function detectVersionFromSource(source) {
  if (!source || typeof source !== "object") return null;
  const type = String(source.type || "command").trim();
  if (type === "command") {
    const command = expandRegistryTemplate(source.command);
    const args = Array.isArray(source.args) ? source.args.map(item => expandRegistryTemplate(item)) : [];
    const text = runCommandText(command, args, Number(source.timeoutMs) || 1200);
    const version = extractVersionText(text, source.extract);
    if (!version) return null;
    return {
      version,
      detail: version,
      sourceType: type
    };
  }
  if (type === "file") {
    const filePath = sanitizePath(normalizeRegistryPath(source.path));
    const raw = readFileSafe(filePath);
    const version = extractVersionText(raw, source.extract);
    if (!version) return null;
    return {
      version,
      detail: version,
      sourceType: type,
      sourcePath: filePath
    };
  }
  if (type === "file-version") {
    const filePath = sanitizePath(normalizeRegistryPath(source.path));
    const raw = readWindowsFileVersion(filePath);
    const version = extractVersionText(raw, source.extract);
    if (!version) return null;
    return {
      version,
      detail: version,
      sourceType: type,
      sourcePath: filePath
    };
  }
  return null;
}

function detectToolVersion(toolId) {
  const now = Date.now();
  const cached = TOOL_VERSION_CACHE.get(toolId);
  if (cached && now - cached.at < TOOL_VERSION_CACHE_TTL_MS) {
    return cached.value;
  }

  const registryEntry = getToolRegistryEntry(toolId);
  const sourceList = Array.isArray(registryEntry.versionSources) ? registryEntry.versionSources : [];
  let match = null;
  for (const source of sourceList) {
    match = detectVersionFromSource(source);
    if (match && match.version) break;
  }

  const value = {
    toolVersion: match ? match.version : firstNonEmptyValue(Array.isArray(registryEntry.versions) ? registryEntry.versions : []),
    toolVersions: Array.from(new Set([
      match ? match.version : "",
      ...(Array.isArray(registryEntry.versions) ? registryEntry.versions : [])
    ].map(item => String(item || "").trim()).filter(Boolean))),
    toolVersionDetail: match ? firstNonEmptyValue([match.detail, match.version]) : "",
    toolVersionSource: match ? match.sourceType : "",
    writerVersion: String(registryEntry.writerVersion || "").trim()
  };

  TOOL_VERSION_CACHE.set(toolId, { at: now, value });
  return value;
}

function buildLobsterAppConfig(currentConfig, config, apiKey) {
  const next = currentConfig && typeof currentConfig === "object" && !Array.isArray(currentConfig)
    ? { ...currentConfig }
    : {};
  const providers = next.providers && typeof next.providers === "object" && !Array.isArray(next.providers)
    ? { ...next.providers }
    : {};
  const existingProvider = providers[LOBSTER_PROVIDER_KEY] && typeof providers[LOBSTER_PROVIDER_KEY] === "object"
    ? { ...providers[LOBSTER_PROVIDER_KEY] }
    : {};
  const existingModels = Array.isArray(existingProvider.models) ? existingProvider.models : [];
  const existingModel = existingModels.find(item => item && item.id === config.model);
  const modelEntry = {
    ...(existingModel || {}),
    id: config.model,
    name: (existingModel && existingModel.name) || config.model,
    supportsImage: Boolean(config.supportsVision)
  };
  const existingAvailableModels = next.model && Array.isArray(next.model.availableModels)
    ? next.model.availableModels
    : [];
  const existingAvailableModel = existingAvailableModels.find(item => item && item.id === config.model);
  const availableModelEntry = {
    ...(existingAvailableModel || {}),
    id: config.model,
    name: (existingAvailableModel && existingAvailableModel.name) || modelEntry.name,
    supportsImage: Boolean(config.supportsVision)
  };

  providers[LOBSTER_PROVIDER_KEY] = {
    ...existingProvider,
    enabled: true,
    apiKey,
    baseUrl: config.baseUrl,
    apiFormat: getApiTypeConfig(config.apiType).lobsterApiFormat,
    displayName: config.providerName,
    models: [
      modelEntry,
      ...existingModels.filter(item => item && item.id !== config.model)
    ]
  };

  next.api = {
    ...(next.api && typeof next.api === "object" && !Array.isArray(next.api) ? next.api : {}),
    key: apiKey,
    baseUrl: config.baseUrl
  };
  next.model = {
    ...(next.model && typeof next.model === "object" && !Array.isArray(next.model) ? next.model : {}),
    availableModels: [
      availableModelEntry,
      ...existingAvailableModels.filter(item => item && item.id !== config.model)
    ],
    defaultModel: config.model,
    defaultModelProvider: LOBSTER_PROVIDER_KEY
  };
  next.providers = providers;
  return next;
}

function isSensitiveKey(key) {
  const normalized = String(key || "").toLowerCase();
  return normalized === "key"
    || normalized === "apikey"
    || normalized === "api_key"
    || normalized.includes("api_key")
    || normalized.endsWith("_key")
    || normalized.endsWith("-key")
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("password");
}

function maskConfigObject(value, parentKey = "") {
  if (Array.isArray(value)) return value.map(item => maskConfigObject(item, parentKey));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key) || (parentKey === "api" && key === "key")) {
      out[key] = typeof item === "string" ? maskSecret(item) || "<empty>" : "<redacted>";
    } else {
      out[key] = maskConfigObject(item, key);
    }
  }
  return out;
}

function maskPotentialSecretsInText(content) {
  return String(content || "").replace(
    /^(\s*(?:"|')?(?:experimental_bearer_token|api_key|openai_api_key|token|secret|password)(?:"|')?\s*[:=]\s*)(".*?"|'.*?'|[^,\r\n]+)(\s*,?\s*)$/gim,
    '$1"<redacted>"$3'
  );
}

function defaultWriteRules() {
  return {
    schemaVersion: 1,
    tools: {
      codex: {
        entries: [
          {
            id: "codex",
            name: "Codex config.toml",
            type: "codex-toml",
            format: "text",
            pathKey: "path",
            operations: [
              {
                op: "toml.removeTables",
                providerId: "${providerId}"
              },
              {
                op: "toml.upsertRoot",
                values: {
                  model: "${model}",
                  model_provider: "${providerId}"
                }
              },
              {
                op: "text.appendBlock",
                blockLines: [
                  "# Managed by ${appName}. Direct write mode: real provider URL, API key from auth.json.",
                  "[model_providers.${providerId}]",
                  "name = \"${providerName}\"",
                  "base_url = \"${baseUrl}\"",
                  "wire_api = \"${codexWireApi}\"",
                  "requires_openai_auth = true"
                ]
              }
            ]
          },
          {
            id: "codex-auth",
            name: "Codex auth.json",
            type: "codex-auth-json",
            format: "text",
            displayMode: "json-masked",
            pathKey: "authPath",
            operations: [
              {
                op: "json.set",
                path: "OPENAI_API_KEY",
                value: "${openaiAuthKey}"
              }
            ]
          }
        ]
      },
      hermes: {
        entries: [
          {
            id: "hermes-config",
            name: "Hermes config.yaml",
            type: "hermes-yaml",
            format: "text",
            pathKey: "path",
            operations: [
              {
                op: "yaml.removeTopLevelBlock",
                key: "model"
              },
              {
                op: "yaml.removeTopLevelBlock",
                key: "providers"
              },
              {
                op: "text.appendBlock",
                blockLines: [
                  "# Managed by ${appName}. Direct custom endpoint.",
                  "model:",
                  "  default: \"${model}\"",
                  "  provider: custom",
                  "  base_url: \"${baseUrl}\"",
                  "  supports_vision: ${supportsVision}",
                  "  api_key: \"${apiKey}\""
                ]
              }
            ]
          }
        ]
      },
      lobster: {
        entries: [
          {
            id: "lobster",
            name: "LobsterAI",
            type: "lobster-sqlite",
            format: "lobster",
            pathKey: "path",
            operations: [
              {
                op: "lobster.appConfig"
              }
            ]
          }
        ]
      }
    }
  };
}

function normalizeWriteRules(rules) {
  const fallback = defaultWriteRules();
  const tools = rules && rules.tools && typeof rules.tools === "object" && !Array.isArray(rules.tools)
    ? rules.tools
    : {};
  const out = {
    schemaVersion: Number(rules && rules.schemaVersion) || 1,
    tools: {}
  };
  for (const [toolId, defaults] of Object.entries(fallback.tools)) {
    const toolRule = tools[toolId] && typeof tools[toolId] === "object" && !Array.isArray(tools[toolId])
      ? tools[toolId]
      : {};
    out.tools[toolId] = {
      entries: Array.isArray(toolRule.entries) && toolRule.entries.length ? toolRule.entries : defaults.entries
    };
  }
  return out;
}

function loadWriteRules() {
  if (loadWriteRules.cache) return loadWriteRules.cache;
  let rules = defaultWriteRules();
  if (exists(WRITE_RULES_PATH)) {
    try {
      rules = parseJsonObject(readFileSafe(WRITE_RULES_PATH), "Write rules");
    } catch (error) {
      console.error(`Failed to read write rules: ${error.message || error}`);
    }
  }
  loadWriteRules.cache = normalizeWriteRules(rules);
  return loadWriteRules.cache;
}

function getWriteRule(toolId) {
  const rules = loadWriteRules();
  return rules.tools[toolId] || defaultWriteRules().tools[toolId] || { entries: [] };
}

function interpolateRuleValue(value, context) {
  if (Array.isArray(value)) return value.map(item => interpolateRuleValue(item, context));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = interpolateRuleValue(item, context);
    }
    return out;
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\$\{([^}]+)\}$/);
  if (exact) {
    return context[exact[1]];
  }
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const resolved = context[key];
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

function setObjectPath(target, pathText, value) {
  const parts = String(pathText || "").split(".").filter(Boolean);
  if (!parts.length) throw new Error("JSON set path is required.");
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function applyTextBlock(content, blockLines) {
  const block = Array.isArray(blockLines) ? blockLines.join("\n").trimEnd() : String(blockLines || "").trimEnd();
  const base = String(content || "").trimEnd();
  if (!block) return base ? `${base}\n` : "";
  return base ? `${base}\n\n${block}\n` : `${block}\n`;
}

function executeTextRuleOperation(current, operation, context, label) {
  const op = String(operation && operation.op || "").trim();
  if (op === "toml.removeTables") {
    return removeTomlTables(String(current || ""), String(interpolateRuleValue(operation.providerId, context) || ""));
  }
  if (op === "toml.upsertRoot") {
    return upsertRootTomlKeys(String(current || ""), interpolateRuleValue(operation.values || {}, context));
  }
  if (op === "yaml.removeTopLevelBlock") {
    return removeYamlTopLevelBlock(String(current || ""), String(interpolateRuleValue(operation.key, context) || ""));
  }
  if (op === "text.appendBlock") {
    return applyTextBlock(String(current || ""), interpolateRuleValue(operation.blockLines || [], context));
  }
  if (op === "json.set") {
    const next = parseJsonObject(String(current || ""), label);
    setObjectPath(next, interpolateRuleValue(operation.path, context), interpolateRuleValue(operation.value, context));
    return stringifyJsonObject(next);
  }
  throw new Error(`Unsupported write rule op: ${op}`);
}

function applyTextRuleOperations(current, operations, context, label) {
  let next = String(current || "");
  for (const operation of operations || []) {
    next = executeTextRuleOperation(next, operation, context, label);
  }
  return next;
}

function buildWriteRuleContext(target, config, apiKey, options = {}) {
  const includeSecrets = options.includeSecrets === true;
  const apiTypeConfig = getApiTypeConfig(config.apiType);
  return {
    appName: APP_NAME,
    toolId: target.id,
    toolName: target.name,
    targetPath: target.path,
    authPath: target.authPath || "",
    envPath: target.envPath || "",
    model: config.model,
    providerId: config.providerId,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    apiType: config.apiType,
    codexWireApi: apiTypeConfig.codexWireApi,
    hermesApiMode: apiTypeConfig.hermesApiMode,
    lobsterApiFormat: apiTypeConfig.lobsterApiFormat,
    supportsVision: Boolean(config.supportsVision),
    apiKey: includeSecrets ? (apiKey || "") : (apiKey ? maskSecret(apiKey) : ""),
    openaiAuthKey: includeSecrets ? (apiKey || "") : (apiKey ? maskSecret(apiKey) : "<OPENAI_API_KEY>"),
    lobsterProviderKey: LOBSTER_PROVIDER_KEY
  };
}

function resolveRulePath(target, entry) {
  if (entry.pathKey && target[entry.pathKey]) {
    return sanitizePath(target[entry.pathKey]);
  }
  if (entry.pathTemplate) {
    return sanitizePath(interpolateRuleValue(entry.pathTemplate, {
      path: target.path,
      authPath: target.authPath || "",
      envPath: target.envPath || ""
    }));
  }
  return sanitizePath(target.path);
}

function buildMaskedJsonPreview(definition, target, filePath, beforeRaw, afterRaw, actualAfter, includeSecrets) {
  const before = exists(filePath) && String(beforeRaw || "").trim()
    ? stringifyJsonObject(maskConfigObject(parseJsonObject(beforeRaw, definition.name)))
    : "";
  const after = String(afterRaw || "").trim()
    ? stringifyJsonObject(maskConfigObject(parseJsonObject(afterRaw, definition.name)))
    : "";
  return {
    id: definition.id,
    name: definition.name,
    path: filePath,
    type: definition.type || target.type,
    exists: exists(filePath),
    stable: target.stable,
    before,
    after,
    actualAfter: includeSecrets ? actualAfter : undefined,
    planOnly: false,
    diff: lineDiff(before, after)
  };
}

function executeLobsterRuleOperations(currentValue, operations, config, apiKey) {
  let next = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
    ? cloneJson(currentValue)
    : {};
  for (const operation of operations || []) {
    const op = String(operation && operation.op || "").trim();
    if (op === "lobster.appConfig") {
      next = buildLobsterAppConfig(next, config, apiKey);
    } else {
      throw new Error(`Unsupported lobster write rule op: ${op}`);
    }
  }
  return next;
}

function buildRuleTextPreview(definition, target, beforeRaw, displayContext, actualContext, includeSecrets) {
  const afterRaw = applyTextRuleOperations(beforeRaw, definition.operations, displayContext, definition.name);
  const actualAfter = includeSecrets
    ? applyTextRuleOperations(beforeRaw, definition.operations, actualContext, definition.name)
    : undefined;
  const filePath = resolveRulePath(target, definition);
  if (definition.displayMode === "json-masked") {
    return buildMaskedJsonPreview(definition, target, filePath, beforeRaw, afterRaw, actualAfter, includeSecrets);
  }
  return filePreview({
    id: definition.id,
    name: definition.name,
    type: definition.type || target.type,
    path: filePath,
    stable: target.stable,
    beforeRaw,
    afterRaw,
    actualAfter,
    includeSecrets
  });
}

function buildPreviewsForTarget(target, config, apiKey, includeSecrets) {
  const writeRule = getWriteRule(target.id);
  const definitions = Array.isArray(writeRule.entries) ? writeRule.entries : [];
  const displayContext = buildWriteRuleContext(target, config, apiKey, { includeSecrets: false });
  const actualContext = buildWriteRuleContext(target, config, apiKey, { includeSecrets: true });
  const previews = [];

  for (const definition of definitions) {
    const filePath = resolveRulePath(target, definition);
    if (definition.format === "lobster") {
      if (!exists(filePath)) {
        const message = [
          "# LobsterAI database was not found.",
          `# Expected path: ${filePath}`,
          "# Install or start LobsterAI once, then reload detection."
        ].join("\n");
        previews.push({
          id: definition.id,
          name: definition.name,
          path: filePath,
          type: definition.type || target.type,
          exists: false,
          stable: target.stable,
          before: "",
          after: message,
          blocked: true,
          reason: "LobsterAI database was not found.",
          planOnly: false,
          diff: message
        });
        continue;
      }

      try {
        const current = readLobsterAppConfig(filePath);
        const displayValue = executeLobsterRuleOperations(current.value || {}, definition.operations, config, apiKey ? maskSecret(apiKey) : "<API Key>");
        const before = `${JSON.stringify(maskConfigObject(current.value || {}), null, 2)}\n`;
        const after = `${JSON.stringify(maskConfigObject(displayValue), null, 2)}\n`;
        const actualConfig = includeSecrets ? executeLobsterRuleOperations(current.value || {}, definition.operations, config, apiKey) : undefined;
        previews.push({
          id: definition.id,
          name: definition.name,
          path: filePath,
          type: definition.type || target.type,
          exists: true,
          stable: target.stable,
          before,
          after,
          actualConfig,
          planOnly: false,
          diff: lineDiff(before, after)
        });
      } catch (error) {
        const message = [
          "# LobsterAI SQLite preview failed.",
          `# ${error.message || String(error)}`
        ].join("\n");
        previews.push({
          id: definition.id,
          name: definition.name,
          path: filePath,
          type: definition.type || target.type,
          exists: true,
          stable: target.stable,
          before: "",
          after: message,
          blocked: true,
          reason: error.message || String(error),
          planOnly: false,
          diff: message
        });
      }
      continue;
    }

    const beforeRaw = readFileSafe(filePath);
    try {
      previews.push(buildRuleTextPreview(definition, target, beforeRaw, displayContext, actualContext, includeSecrets));
    } catch (error) {
      const message = [
        `# ${definition.name} preview failed.`,
        `# ${error.message || String(error)}`
      ].join("\n");
      previews.push({
        id: definition.id,
        name: definition.name,
        path: filePath,
        type: definition.type || target.type,
        exists: exists(filePath),
        stable: target.stable,
        before: "",
        after: message,
        blocked: true,
        reason: error.message || String(error),
        planOnly: false,
        diff: message
      });
    }
  }

  return previews;
}

function pythonCandidates() {
  const out = [];
  if (process.env.PYTHON) out.push({ command: process.env.PYTHON, args: [] });
  const lobsterBundledPython = path.join(APPDATA, "LobsterAI", "runtimes", "python-win", "python.exe");
  if (exists(lobsterBundledPython)) out.push({ command: lobsterBundledPython, args: [] });
  out.push({ command: "python", args: [] });
  out.push({ command: "py", args: ["-3"] });
  out.push({ command: "python3", args: [] });
  return out;
}

function runPythonJson(script, payload) {
  let lastError = null;
  const failures = [];
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(
      candidate.command,
      [...candidate.args, "-c", script],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1"
        },
        timeout: 15000,
        windowsHide: true
      }
    );
    if (result.error && result.error.code === "ENOENT") {
      lastError = result.error;
      failures.push(`${candidate.command}: ${result.error.message}`);
      continue;
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      lastError = new Error((result.stderr || result.stdout || `Python exited with ${result.status}`).trim());
      const message = lastError.message.split(/\r?\n/).find(Boolean) || lastError.message;
      failures.push(`${candidate.command}: ${message}`);
      continue;
    }
    try {
      return JSON.parse(result.stdout || "{}");
    } catch {
      throw new Error("Python helper returned invalid JSON.");
    }
  }
  const detail = failures.length ? failures.join(" | ") : (lastError ? lastError.message : "");
  throw new Error(`Python with sqlite3 is required for LobsterAI writes. ${detail}`.trim());
}

const SQLITE_READ_SCRIPT = `
import json, sqlite3, sys, urllib.parse
payload = json.load(sys.stdin)
db_path = payload["dbPath"]
key = payload["key"]
uri = "file:" + urllib.parse.quote(db_path.replace("\\\\", "/"), safe="/:") + "?mode=ro"
conn = sqlite3.connect(uri, uri=True)
try:
    row = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'").fetchone()
    if not row:
        print(json.dumps({"ok": True, "found": False, "raw": ""}))
    else:
        row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        print(json.dumps({"ok": True, "found": bool(row), "raw": row[0] if row else ""}))
finally:
    conn.close()
`;

const SQLITE_WRITE_SCRIPT = `
import json, sqlite3, sys, time
payload = json.load(sys.stdin)
db_path = payload["dbPath"]
key = payload["key"]
value = json.dumps(payload["value"])
conn = sqlite3.connect(db_path)
try:
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)")
    conn.execute(
        "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, int(time.time() * 1000)),
    )
    conn.commit()
    print(json.dumps({"ok": True}))
finally:
    conn.close()
`;

const SQLITE_DELETE_SCRIPT = `
import json, sqlite3, sys
payload = json.load(sys.stdin)
db_path = payload["dbPath"]
key = payload["key"]
conn = sqlite3.connect(db_path)
try:
    row = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'").fetchone()
    if row:
        conn.execute("DELETE FROM kv WHERE key = ?", (key,))
        conn.commit()
    print(json.dumps({"ok": True}))
finally:
    conn.close()
`;

function readLobsterAppConfig(dbPath) {
  if (!exists(dbPath)) {
    return { exists: false, found: false, raw: "", value: null };
  }
  const result = runPythonJson(SQLITE_READ_SCRIPT, { dbPath, key: "app_config" });
  let value = null;
  if (result.raw) {
    try {
      value = JSON.parse(result.raw);
    } catch {
      value = null;
    }
  }
  return { exists: true, found: Boolean(result.found), raw: result.raw || "", value };
}

function writeLobsterAppConfig(dbPath, value) {
  return runPythonJson(SQLITE_WRITE_SCRIPT, { dbPath, key: "app_config", value });
}

function deleteLobsterAppConfig(dbPath) {
  return runPythonJson(SQLITE_DELETE_SCRIPT, { dbPath, key: "app_config" });
}

function isLobsterRunning() {
  if (process.platform !== "win32") return false;
  const result = spawnSync("tasklist.exe", ["/FO", "CSV", "/NH"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });
  if (result.status !== 0 || !result.stdout) return false;
  const lower = result.stdout.toLowerCase();
  return ["lobsterai.exe", "lobster ai.exe", "lobster.exe"].some(name => lower.includes(`"${name}"`));
}

function writeLobsterConfig(config, apiKey, dbPath) {
  if (!exists(dbPath)) {
    throw new Error(`LobsterAI database was not found: ${dbPath}`);
  }
  if (isLobsterRunning()) {
    throw new Error("Close LobsterAI before writing its SQLite configuration.");
  }
  const current = readLobsterAppConfig(dbPath);
  const next = buildLobsterAppConfig(current.value || {}, config, apiKey);
  const backupPaths = backupLobsterDatabaseFiles(dbPath);
  writeLobsterAppConfig(dbPath, next);

  const verified = readLobsterAppConfig(dbPath);
  const provider = verified.value
    && verified.value.providers
    && verified.value.providers[LOBSTER_PROVIDER_KEY];
  if (!provider || provider.baseUrl !== config.baseUrl || provider.apiKey !== apiKey) {
    throw new Error("LobsterAI SQLite write verification failed.");
  }

  return {
    providerKey: LOBSTER_PROVIDER_KEY,
    backupPaths
  };
}

function writeLobsterConfigValue(dbPath, value) {
  if (!exists(dbPath)) {
    throw new Error(`LobsterAI database was not found: ${dbPath}`);
  }
  if (isLobsterRunning()) {
    throw new Error("Close LobsterAI before writing its SQLite configuration.");
  }
  const backupPaths = backupLobsterDatabaseFiles(dbPath);
  writeLobsterAppConfig(dbPath, value);
  const verified = readLobsterAppConfig(dbPath);
  if (!verified.value || JSON.stringify(verified.value) !== JSON.stringify(value)) {
    throw new Error("LobsterAI SQLite write verification failed.");
  }
  return {
    providerKey: LOBSTER_PROVIDER_KEY,
    backupPaths
  };
}

function readToolState() {
  if (!exists(TOOL_STATE_PATH)) {
    return { managedBy: APP_NAME, tools: {} };
  }
  try {
    const parsed = parseJsonObject(readFileSafe(TOOL_STATE_PATH), "Tool state");
    if (!parsed.tools || typeof parsed.tools !== "object" || Array.isArray(parsed.tools)) {
      parsed.tools = {};
    }
    return parsed;
  } catch {
    return { managedBy: APP_NAME, tools: {} };
  }
}

function writeToolState(state) {
  ensureDataDir();
  fs.writeFileSync(TOOL_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeLastConfig(lastConfig) {
  if (!lastConfig || typeof lastConfig !== "object" || Array.isArray(lastConfig)) return null;
  const normalized = {
    ...lastConfig,
    providerName: "claw"
  };
  if (normalized.authPath === undefined && normalized.configPath) {
    normalized.authPath = "";
  }
  return normalized;
}

function restoreManagedFileSnapshot(snapshot) {
  const targetPath = sanitizePath(snapshot.path);
  if (snapshot.existed) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, String(snapshot.content || ""), "utf8");
  } else if (exists(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
}

function captureToolOriginal(toolId, adapter, targetPaths = {}) {
  const configPath = targetPaths.path || adapter.defaultPath;
  const authPath = targetPaths.authPath || adapter.authPath;
  const envPath = targetPaths.envPath || adapter.envPath;
  if (toolId === "codex") {
    return {
      files: [
        {
          role: "config",
          path: configPath,
          existed: exists(configPath),
          content: readFileSafe(configPath)
        },
        {
          role: "auth",
          path: authPath,
          existed: exists(authPath),
          content: readFileSafe(authPath)
        }
      ]
    };
  }
  if (toolId === "hermes") {
    return {
      files: [
        {
          role: "config",
          path: configPath,
          existed: exists(configPath),
          content: readFileSafe(configPath)
        },
        {
          role: "env",
          path: envPath,
          existed: exists(envPath),
          content: readFileSafe(envPath)
        }
      ]
    };
  }
  if (toolId === "lobster") {
    const current = readLobsterAppConfig(configPath);
    return {
      sqlite: {
        path: configPath,
        existed: exists(configPath),
        found: current.found,
        value: current.value
      }
    };
  }
  throw new Error("Unsupported tool.");
}

function restoreToolOriginal(toolId, original) {
  if (!original) throw new Error("Original configuration was not captured.");
  if (toolId === "codex" || toolId === "hermes") {
    for (const file of original.files || []) {
      restoreManagedFileSnapshot(file);
    }
    return;
  }
  if (toolId === "lobster") {
    const snapshot = original.sqlite;
    if (!snapshot) throw new Error("Original LobsterAI configuration was not captured.");
    if (isLobsterRunning()) throw new Error("Close LobsterAI before restoring its SQLite configuration.");
    if (!snapshot.existed) {
      if (exists(snapshot.path)) fs.rmSync(snapshot.path, { force: true });
      return;
    }
    if (!exists(snapshot.path)) {
      throw new Error(`LobsterAI database was not found: ${snapshot.path}`);
    }
    backupLobsterDatabaseFiles(snapshot.path);
    if (snapshot.found) {
      writeLobsterAppConfig(snapshot.path, snapshot.value);
    } else {
      deleteLobsterAppConfig(snapshot.path);
    }
    return;
  }
  throw new Error("Unsupported tool.");
}

function configForTool(payload, toolId) {
  const toolPayload = (payload.tools && payload.tools[toolId]) || {};
  const config = sanitizeConfig({
    baseUrl: toolPayload.baseUrl || payload.baseUrl,
    apiKey: payload.apiKey,
    model: toolPayload.model || payload.model,
    apiType: toolPayload.apiType || payload.apiType,
    providerId: toolPayload.providerId || payload.providerId || "agent_direct",
    providerName: "claw",
    supportsVision: toolPayload.supportsVision !== undefined ? toolPayload.supportsVision : payload.supportsVision
  });
  config.toolVersion = String(toolPayload.toolVersion || payload.toolVersion || "").trim();
  return config;
}

function resolveToolTargetPaths(toolId, payload, adapter) {
  const toolPayload = (payload.tools && payload.tools[toolId]) || {};
  const targetPayload = (payload.targets && payload.targets[toolId]) || {};
  const configuredPath = String(targetPayload.path || toolPayload.configPath || "").trim();
  const targetPath = sanitizePath(configuredPath || adapter.defaultPath);

  if (toolId === "codex") {
    const configuredAuthPath = String(targetPayload.authPath || toolPayload.authPath || "").trim();
    return {
      path: targetPath,
      authPath: sanitizePath(configuredAuthPath || path.join(path.dirname(targetPath), "auth.json"))
    };
  }
  if (toolId === "hermes") {
    return {
      path: targetPath,
      envPath: path.join(path.dirname(targetPath), ".env")
    };
  }
  return { path: targetPath };
}

function applySingleTool(toolId, payload) {
  const adapter = TOOL_ADAPTERS[toolId];
  if (!adapter) throw new Error("Unknown tool.");
  const apiKey = normalizeOpenAiApiKey(payload.apiKey);
  if (!apiKey) throw new Error("API Key is required.");

  const state = readToolState();
  const toolState = state.tools[toolId] || {};
  const targetPaths = resolveToolTargetPaths(toolId, payload, adapter);
  const currentManagedPath = toolState.lastConfig && toolState.lastConfig.configPath
    ? sanitizePath(toolState.lastConfig.configPath)
    : "";
  if (toolState.original && currentManagedPath && currentManagedPath !== targetPaths.path) {
    restoreToolOriginal(toolId, toolState.original);
    delete toolState.original;
  }
  if (!toolState.original) {
    toolState.original = captureToolOriginal(toolId, adapter, targetPaths);
  }

  const config = configForTool(payload, toolId);
  const toolTargets = {
    [toolId]: {
      enabled: true,
      path: targetPaths.path,
      authPath: targetPaths.authPath,
      envPath: targetPaths.envPath
    }
  };
  const previews = buildPreview({
    ...payload,
    ...config,
    apiKey,
    targets: toolTargets
  }, { includeSecrets: true });

  if (previews.some(preview => preview.type === "lobster-sqlite" && !preview.blocked) && isLobsterRunning()) {
    throw new Error("Close LobsterAI before applying.");
  }

  const results = [];
  for (const preview of previews) {
    if (preview.blocked) {
      throw new Error(preview.reason || "This tool cannot be written.");
    }
    if (preview.type === "lobster-sqlite") {
      const result = writeLobsterConfigValue(preview.path, preview.actualConfig || {});
      results.push({
        path: preview.path,
        backupPath: result.backupPaths[0] || null,
        backupPaths: result.backupPaths,
        providerKey: result.providerKey
      });
    } else {
      results.push({ path: preview.path, backupPath: writeManagedFile(preview.path, preview.actualAfter) });
    }
  }

  toolState.enabled = true;
  toolState.updatedAt = new Date().toISOString();
  toolState.lastConfig = {
    configPath: targetPaths.path,
    authPath: targetPaths.authPath,
    baseUrl: config.baseUrl,
    model: config.model,
    apiType: config.apiType,
    toolVersion: config.toolVersion,
    providerId: config.providerId,
    providerName: config.providerName,
    supportsVision: config.supportsVision
  };
  state.tools[toolId] = toolState;
  writeToolState(state);
  return { ok: true, tool: toolId, enabled: true, results };
}

function restoreSingleTool(toolId) {
  const adapter = TOOL_ADAPTERS[toolId];
  if (!adapter) throw new Error("Unknown tool.");
  const state = readToolState();
  const toolState = state.tools[toolId];
  if (!toolState || !toolState.original) {
    if (toolState) {
      toolState.enabled = false;
      toolState.updatedAt = new Date().toISOString();
      state.tools[toolId] = toolState;
      writeToolState(state);
    }
    return { ok: true, tool: toolId, enabled: false, skipped: true };
  }
  restoreToolOriginal(toolId, toolState.original);
  delete toolState.original;
  toolState.enabled = false;
  toolState.updatedAt = new Date().toISOString();
  state.tools[toolId] = toolState;
  writeToolState(state);
  return { ok: true, tool: toolId, enabled: false };
}

function setToolEnabled(payload) {
  const toolId = String(payload.tool || "").trim();
  if (payload.enabled) {
    return applySingleTool(toolId, payload);
  }
  return restoreSingleTool(toolId);
}

function saveToolSettings(payload) {
  const toolId = String(payload.tool || "").trim();
  const adapter = TOOL_ADAPTERS[toolId];
  if (!adapter) throw new Error("Unknown tool.");
  const config = configForTool(payload, toolId);
  const targetPaths = resolveToolTargetPaths(toolId, payload, adapter);
  const state = readToolState();
  const toolState = state.tools[toolId] || {};
  toolState.updatedAt = new Date().toISOString();
  toolState.lastConfig = {
    configPath: targetPaths.path,
    authPath: targetPaths.authPath,
    baseUrl: config.baseUrl,
    model: config.model,
    apiType: config.apiType,
    toolVersion: config.toolVersion,
    providerId: config.providerId,
    providerName: config.providerName,
    supportsVision: config.supportsVision
  };
  if (typeof toolState.enabled !== "boolean") {
    toolState.enabled = false;
  }
  state.tools[toolId] = toolState;
  writeToolState(state);
  return { ok: true, tool: toolId, settings: toolState.lastConfig, enabled: toolState.enabled };
}

function lineDiff(before, after) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out.join("\n");
}

function sanitizeConfig(payload) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const providerId = validateProviderId(payload.providerId || "agent_direct");
  const model = String(payload.model || "").trim();
  if (!model) throw new Error("Model is required.");
  return {
    baseUrl,
    providerId,
    apiType: normalizeApiType(payload.apiType),
    model,
    providerName: String(payload.providerName || "claw").trim() || "claw",
    supportsVision: payload.supportsVision !== undefined ? Boolean(payload.supportsVision) : true
  };
}

function selectedTargets(payload) {
  const targets = payload.targets || {};
  const out = [];
  for (const adapter of Object.values(TOOL_ADAPTERS)) {
    const item = targets[adapter.id];
    if (!item || item.enabled === false) continue;
    out.push({
      id: adapter.id,
      name: adapter.name,
      type: adapter.type,
      stable: adapter.stable,
      path: sanitizePath(item.path || adapter.defaultPath),
      authPath: item.authPath ? sanitizePath(item.authPath) : adapter.authPath,
      envPath: item.envPath ? sanitizePath(item.envPath) : adapter.envPath
    });
  }
  return out;
}

function filePreview({ id, name, type, path: filePath, stable, beforeRaw, afterRaw, actualAfter, includeSecrets }) {
  const before = maskPotentialSecretsInText(beforeRaw || "");
  const after = maskPotentialSecretsInText(afterRaw || "");
  return {
    id,
    name,
    path: filePath,
    type,
    exists: exists(filePath),
    stable,
    before,
    after,
    actualAfter: includeSecrets ? (actualAfter === undefined ? afterRaw : actualAfter) : undefined,
    planOnly: false,
    diff: lineDiff(before, after)
  };
}

function buildLobsterPreview(target, config, apiKey, includeSecrets) {
  if (!exists(target.path)) {
    const message = [
      "# LobsterAI database was not found.",
      `# Expected path: ${target.path}`,
      "# Install or start LobsterAI once, then reload detection."
    ].join("\n");
    return {
      id: "lobster",
      name: "LobsterAI",
      path: target.path,
      type: "lobster-sqlite",
      exists: false,
      stable: target.stable,
      before: "",
      after: message,
      blocked: true,
      reason: "LobsterAI database was not found.",
      planOnly: false,
      diff: message
    };
  }

  try {
    const current = readLobsterAppConfig(target.path);
    const currentValue = current.value || {};
    const displayKey = apiKey ? maskSecret(apiKey) : "<API Key>";
    const previewValue = buildLobsterAppConfig(currentValue, config, displayKey);
    const before = `${JSON.stringify(maskConfigObject(currentValue), null, 2)}\n`;
    const after = `${JSON.stringify(maskConfigObject(previewValue), null, 2)}\n`;
    const actualConfig = includeSecrets && apiKey ? buildLobsterAppConfig(currentValue, config, apiKey) : undefined;
    return {
      id: "lobster",
      name: "LobsterAI",
      path: target.path,
      type: "lobster-sqlite",
      exists: true,
      stable: target.stable,
      before,
      after,
      actualConfig,
      planOnly: false,
      diff: lineDiff(before, after)
    };
  } catch (error) {
    const message = [
      "# LobsterAI SQLite preview failed.",
      `# ${error.message || String(error)}`
    ].join("\n");
    return {
      id: "lobster",
      name: "LobsterAI",
      path: target.path,
      type: "lobster-sqlite",
      exists: true,
      stable: target.stable,
      before: "",
      after: message,
      blocked: true,
      reason: error.message || String(error),
      planOnly: false,
      diff: message
    };
  }
}

function buildPreview(payload, options = {}) {
  const includeSecrets = options.includeSecrets === true;
  const config = sanitizeConfig(payload);
  const apiKey = normalizeOpenAiApiKey(payload.apiKey);
  const targets = selectedTargets(payload);
  if (!targets.length) throw new Error("Select at least one tool to configure.");

  const previews = [];
  for (const target of targets) {
    previews.push(...buildPreviewsForTarget(target, config, apiKey, includeSecrets));
  }

  return previews;
}

async function validateApi(payload) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const apiKey = normalizeOpenAiApiKey(payload.apiKey);
  const model = String(payload.model || "").trim();
  if (!apiKey) throw new Error("API key is required for validation.");

  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), 12000);
  const url = `${baseUrl}/models`;
  let response;
  let bodyText = "";

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json"
      },
      signal: controller.signal
    });
    bodyText = await response.text();
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  const ids = Array.isArray(parsed && parsed.data)
    ? parsed.data.map(item => item && item.id).filter(Boolean).slice(0, 30)
    : [];

  return {
    ok: response.ok,
    status: response.status,
    elapsedMs: Date.now() - started,
    url,
    modelFound: model ? ids.includes(model) : null,
    modelSample: ids,
    message: response.ok
      ? "The /models endpoint accepted the key."
      : summarizeHttpError(response.status, parsed, bodyText)
  };
}

async function fetchBuytokenProducts() {
  const response = await fetch(`${BUYTOKEN_BASE_URL}/api/recharge/products`, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || `商品列表读取失败: HTTP ${response.status}`);
  }
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.products) ? data.products : [];
  return {
    ok: true,
    source: BUYTOKEN_BASE_URL,
    products: items.map(item => ({
      id: String(item.id || "").trim(),
      name: String(item.name || "").trim() || String(item.id || "").trim(),
      description: String(item.description || "").trim(),
      value: Number(item.value || 0),
      price: Number.isFinite(Number(item.priceCents)) ? Number(item.priceCents) / 100 : Number(item.price || 0),
      priceCents: Number(item.priceCents || 0),
      quota: item.quota ?? null,
      currency: String(item.currency || "CNY")
    })).filter(item => item.id)
  };
}

async function requestBuytoken(pathname, body = null) {
  const response = await fetch(`${BUYTOKEN_BASE_URL}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
        accept: "application/json",
        "content-type": "application/json"
      }
      : {
        accept: "application/json"
      },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { response, data };
}

async function createBuytokenOrder(payload, auth = {}) {
  const productId = String(payload && payload.productId ? payload.productId : "").trim();
  if (!productId) throw new Error("缺少商品 ID");
  const account = String(payload && payload.account ? payload.account : auth.account || auth.username || "").trim();
  if (!account) throw new Error("缺少充值账号");
  const { response, data } = await requestBuytoken("/api/recharge/create-order", { productId, account });
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `创建订单失败: HTTP ${response.status}`);
  }
  return {
    ok: true,
    productId,
    orderId: String(data.orderId || data.id || "").trim(),
    paymentUrl: String(data.paymentUrl || "").trim()
  };
}

async function checkBuytokenOrder(orderId) {
  const value = String(orderId || "").trim();
  if (!value) throw new Error("缺少订单 ID");
  const { response, data } = await requestBuytoken(`/api/check/${encodeURIComponent(value)}`);
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `查询订单失败: HTTP ${response.status}`);
  }
  return data;
}

async function claimBuytokenOrder(orderId) {
  const value = String(orderId || "").trim();
  if (!value) throw new Error("缺少订单 ID");
  const { response, data } = await requestBuytoken("/api/recharge/claim", { orderId: value });
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `确认充值失败: HTTP ${response.status}`);
  }
  return data;
}

function summarizeHttpError(status, parsed, bodyText) {
  const message = parsed && parsed.error && (parsed.error.message || parsed.error.code);
  if (message) return String(message).slice(0, 300);
  if (status === 401) return "Unauthorized. Check the key and account status.";
  if (status === 403) return "Forbidden. The key exists but the account may not have access.";
  if (status === 404) return "Not found. Check whether the Base URL should include /v1.";
  if (status >= 500) return "Provider server error. Try again or check the provider status.";
  return (bodyText || `HTTP ${status}`).slice(0, 300);
}

function getStatus() {
  const codexPath = TOOL_ADAPTERS.codex.defaultPath;
  const codexAuthPath = CODEX_AUTH_PATH;
  const codexContent = readFileSafe(codexPath);
  const codexSummary = extractCodexSummary(codexContent);
  const codexAuthSummary = extractCodexAuthSummary(readFileSafe(codexAuthPath));
  const toolState = readToolState();
  const defaultBaseUrl = getDefaultProviderBaseUrl(toolState, codexSummary);
  const tools = {};
  for (const [id, adapter] of Object.entries(TOOL_ADAPTERS)) {
    const rawLastConfig = toolState.tools && toolState.tools[id] ? normalizeLastConfig(toolState.tools[id].lastConfig) : null;
    const configPath = rawLastConfig && rawLastConfig.configPath ? rawLastConfig.configPath : adapter.defaultPath;
    const lastConfig = rawLastConfig
      ? {
        ...rawLastConfig,
        configPath,
        authPath: rawLastConfig.authPath || (id === "codex" ? adapter.authPath : undefined)
      }
      : null;
    const fileStat = statSafe(configPath);
    const versionInfo = detectToolVersion(id);
    tools[id] = {
      ...adapter,
      ...versionInfo,
      selectedToolVersion: lastConfig && lastConfig.toolVersion ? lastConfig.toolVersion : versionInfo.toolVersion,
      defaultPath: configPath,
      builtInDefaultPath: adapter.defaultPath,
      builtInAuthPath: adapter.authPath || null,
      exists: Boolean(fileStat),
      size: fileStat ? fileStat.size : 0,
      updatedAt: fileStat ? fileStat.mtime.toISOString() : null,
      managedEnabled: Boolean(toolState.tools && toolState.tools[id] && toolState.tools[id].enabled),
      lastConfig
    };
  }
  return {
    app: {
      name: APP_NAME,
      mode: "direct-write",
      dataDir: DATA_DIR,
      platform: process.platform,
      node: process.version
    },
    defaults: {
      baseUrl: defaultBaseUrl,
      model: codexSummary.model || "gpt-5.5",
      providerId: codexSummary.modelProvider || "agent_direct",
      providerName: "claw",
      apiType: "openai-responses",
      supportsVision: true
    },
    apiTypes: Object.keys(API_TYPES),
    codex: {
      path: codexPath,
      exists: exists(codexPath),
      authPath: codexAuthPath,
      authExists: exists(codexAuthPath),
      auth: codexAuthSummary,
      summary: codexSummary
    },
    hermes: {
      configPath: TOOL_ADAPTERS.hermes.defaultPath,
      envPath: HERMES_ENV_PATH,
      envExists: exists(HERMES_ENV_PATH)
    },
    restore: getRestoreStatus(),
    tools
  };
}

function extractCodexAuthSummary(content) {
  if (!String(content || "").trim()) {
    return {
      hasOpenaiApiKey: false,
      openaiApiKey: "",
      error: ""
    };
  }
  try {
    const parsed = parseJsonObject(content, "Codex auth.json");
    return {
      hasOpenaiApiKey: typeof parsed.OPENAI_API_KEY === "string" && Boolean(parsed.OPENAI_API_KEY),
      openaiApiKey: maskSecret(parsed.OPENAI_API_KEY),
      error: ""
    };
  } catch (error) {
    return {
      hasOpenaiApiKey: false,
      openaiApiKey: "",
      error: error.message || String(error)
    };
  }
}

function appendRunLog(entry) {
  ensureDataDir();
  const safe = {
    ...entry,
    apiKey: undefined,
    createdAt: new Date().toISOString()
  };
  fs.appendFileSync(path.join(DATA_DIR, "runs.jsonl"), `${JSON.stringify(safe)}\n`, "utf8");
}

function saveLastRunSummary(config, results) {
  ensureDataDir();
  fs.writeFileSync(
    LAST_RUN_PATH,
    `${JSON.stringify(
      {
        managedBy: APP_NAME,
        mode: "direct-write",
        updatedAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        model: config.model,
        providerId: config.providerId,
        targets: results.map(item => ({
          id: item.id,
          name: item.name,
          path: item.path,
          backupPath: item.backupPath || null,
          backupPaths: item.backupPaths || (item.backupPath ? [item.backupPath] : []),
          skipped: Boolean(item.skipped)
        }))
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return LAST_RUN_PATH;
}

function readLastRunSummary() {
  if (!exists(LAST_RUN_PATH)) return null;
  return parseJsonObject(readFileSafe(LAST_RUN_PATH), "Last write summary");
}

function getDefaultProviderBaseUrl(toolState, codexSummary) {
  const savedTools = toolState && toolState.tools && typeof toolState.tools === "object"
    ? Object.values(toolState.tools)
    : [];
  for (const item of savedTools) {
    const baseUrl = item && item.lastConfig && String(item.lastConfig.baseUrl || "").trim();
    if (baseUrl && !isOpenAiDefaultBaseUrl(baseUrl)) return baseUrl;
  }
  try {
    const lastRun = readLastRunSummary();
    const lastRunBaseUrl = lastRun && String(lastRun.baseUrl || "").trim();
    if (lastRunBaseUrl && !isOpenAiDefaultBaseUrl(lastRunBaseUrl)) return lastRunBaseUrl;
  } catch {
    // Ignore stale or malformed summaries; status should still load.
  }
  const codexBaseUrl = codexSummary && String(codexSummary.baseUrl || "").trim();
  return codexBaseUrl && !isOpenAiDefaultBaseUrl(codexBaseUrl)
    ? codexBaseUrl
    : DEFAULT_PROVIDER_BASE_URL;
}

function getRestoreStatus() {
  const summary = readLastRunSummary();
  if (!summary || !Array.isArray(summary.targets)) {
    return {
      available: false,
      path: LAST_RUN_PATH,
      updatedAt: null,
      targets: []
    };
  }
  const targets = summary.targets
    .filter(item => item && !item.skipped)
    .map(item => ({
      id: item.id,
      name: item.name,
      path: item.path,
      backupPath: item.backupPath || null,
      backupPaths: Array.isArray(item.backupPaths) ? item.backupPaths : [],
      restorable: Boolean(item.backupPath || (Array.isArray(item.backupPaths) && item.backupPaths.length))
    }));
  return {
    available: targets.some(item => item.restorable),
    path: LAST_RUN_PATH,
    updatedAt: summary.updatedAt || null,
    targets
  };
}

function restoreLastBackup() {
  const summary = readLastRunSummary();
  if (!summary || !Array.isArray(summary.targets)) {
    throw new Error("No backup summary was found. Apply once after enabling backup, then restore is available.");
  }

  const candidates = summary.targets.filter(item => item && !item.skipped);
  if (!candidates.length) {
    throw new Error("The last run has no restorable backup.");
  }
  if (candidates.some(item => item.id === "lobster") && isLobsterRunning()) {
    throw new Error("Close LobsterAI before restoring its SQLite backup.");
  }

  const results = [];
  for (const item of candidates) {
    const backupPaths = Array.isArray(item.backupPaths) && item.backupPaths.length
      ? item.backupPaths
      : (item.backupPath ? [item.backupPath] : []);

    if (!backupPaths.length) {
      results.push({
        id: item.id,
        name: item.name,
        path: item.path,
        skipped: true,
        reason: "This target did not have an existing file before the last write."
      });
      continue;
    }

    for (const backupPath of backupPaths) {
      const originalPath = backupPaths.length === 1 ? item.path : inferOriginalPathFromBackup(backupPath);
      const restored = restoreBackupFile(backupPath, originalPath);
      results.push({
        id: item.id,
        name: item.name,
        path: restored.path,
        backupPath: restored.backupPath,
        currentBackupPath: restored.currentBackupPath
      });
    }
  }

  appendRunLog({
    action: "restore",
    mode: "direct-write",
    summaryPath: LAST_RUN_PATH,
    targets: results.map(item => ({
      id: item.id,
      path: item.path,
      backupPath: item.backupPath,
      currentBackupPath: item.currentBackupPath,
      skipped: item.skipped
    }))
  });

  return {
    ok: true,
    summaryPath: LAST_RUN_PATH,
    results
  };
}

function applyConfig(payload) {
  const config = sanitizeConfig(payload);
  const apiKey = normalizeOpenAiApiKey(payload.apiKey);
  if (!apiKey) throw new Error("API key is required for direct write.");

  const previews = buildPreview(payload, { includeSecrets: true });
  const results = [];

  if (previews.some(preview => preview.type === "lobster-sqlite" && !preview.blocked) && isLobsterRunning()) {
    throw new Error("Close LobsterAI before applying. Then click one-key apply again.");
  }

  for (const preview of previews) {
    if (preview.blocked) {
      results.push({
        id: preview.id,
        name: preview.name,
        path: preview.path,
        backupPath: null,
        stable: preview.stable,
        skipped: true,
        reason: preview.reason || "Blocked by preflight."
      });
      continue;
    }

    if (preview.type === "lobster-sqlite") {
      const result = writeLobsterConfigValue(preview.path, preview.actualConfig || {});
      results.push({
        id: preview.id,
        name: preview.name,
        path: preview.path,
        backupPath: result.backupPaths[0] || null,
        backupPaths: result.backupPaths,
        providerKey: result.providerKey,
        stable: preview.stable
      });
      continue;
    }

    const backupPath = writeManagedFile(preview.path, preview.actualAfter);
    results.push({
      id: preview.id,
      name: preview.name,
      path: preview.path,
      backupPath,
      stable: preview.stable
    });
  }

  const summaryPath = saveLastRunSummary(config, results);
  appendRunLog({
    action: "apply",
    mode: "direct-write",
    baseUrl: config.baseUrl,
    model: config.model,
    providerId: config.providerId,
    summaryPath,
    targets: results.map(item => ({ id: item.id, path: item.path, backupPath: item.backupPath, skipped: item.skipped }))
  });

  return {
    ok: true,
    summaryPath,
    results
  };
}

function openPath(targetPath) {
  const resolved = sanitizePath(targetPath);
  const targetExists = exists(resolved);
  const targetStat = targetExists ? statSafe(resolved) : null;
  if (process.platform === "win32") {
    if (targetStat && targetStat.isFile()) {
      spawn("explorer.exe", ["/select,", resolved], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else {
      const dirPath = targetStat && targetStat.isDirectory() ? resolved : path.dirname(resolved);
      fs.mkdirSync(dirPath, { recursive: true });
      spawn("explorer.exe", [dirPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }).unref();
    }
    return { ok: true };
  }
  if (process.platform === "darwin") {
    if (targetStat && targetStat.isFile()) {
      spawn("open", ["-R", resolved], { detached: true, stdio: "ignore" }).unref();
    } else {
      const dirPath = targetStat && targetStat.isDirectory() ? resolved : path.dirname(resolved);
      fs.mkdirSync(dirPath, { recursive: true });
      spawn("open", [dirPath], { detached: true, stdio: "ignore" }).unref();
    }
    return { ok: true };
  }
  const dirPath = targetStat && targetStat.isDirectory() ? resolved : (targetStat && targetStat.isFile() ? path.dirname(resolved) : path.dirname(resolved));
  fs.mkdirSync(dirPath, { recursive: true });
  spawn("xdg-open", [dirPath], { detached: true, stdio: "ignore" }).unref();
  return { ok: true };
}

async function routeApi(req, res, current) {
  const pathname = current.pathname;
  try {
    if (req.method === "GET" && pathname === "/api/status") {
      json(res, 200, getStatus());
      return;
    }
    if (req.method === "GET" && pathname === "/api/learn/source") {
      const source = readLearnSource();
      json(res, 200, {
        ok: true,
        catalogUrl: source.catalogUrl || "",
        configured: Boolean(source.catalogUrl)
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/learn/source") {
      const body = await readBody(req);
      const source = writeLearnSource(body.catalogUrl || "");
      json(res, 200, {
        ok: true,
        catalogUrl: source.catalogUrl,
        configured: true
      });
      return;
    }
    if (req.method === "GET" && pathname === "/api/learn/catalog") {
      json(res, 200, await getLearnCatalog({
        refresh: current.searchParams.get("refresh") === "1"
      }));
      return;
    }
    if (req.method === "POST" && pathname.startsWith("/api/learn/article-cache/")) {
      const id = decodeURIComponent(pathname.slice("/api/learn/article-cache/".length));
      json(res, 200, await cacheLearnArticle(id, {
        force: current.searchParams.get("force") === "1"
      }));
      return;
    }
    if (req.method === "POST" && pathname === "/api/validate") {
      json(res, 200, await validateApi(await readBody(req)));
      return;
    }
    if (req.method === "GET" && pathname === "/api/buytoken/products") {
      json(res, 200, await fetchBuytokenProducts());
      return;
    }
    if (req.method === "POST" && pathname === "/api/buytoken/order") {
      const body = await readBody(req);
      const cookies = parseCookieHeader(getHeaderValue(req.headers, "cookie"));
      const localUserStore = createLocalUserStore({
        userconfPath: USERCONF_PATH,
        legacyUserconfPath: LEGACY_USERCONF_PATH
      });
      const localUser = localUserStore.getLocalUserRecord();
      if (!cookies.session && !localUser?.username) {
        throw new Error("当前未登录，无法创建充值订单");
      }
      json(
        res,
        200,
        await createBuytokenOrder(body, {
          session: cookies.session || "",
          userId: getHeaderValue(req.headers, "new-api-user") || localUser?.userId || "",
          account: localUser?.username || ""
        })
      );
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/api/buytoken/check/")) {
      const orderId = decodeURIComponent(pathname.slice("/api/buytoken/check/".length));
      json(res, 200, await checkBuytokenOrder(orderId));
      return;
    }
    if (req.method === "POST" && pathname === "/api/buytoken/claim") {
      const body = await readBody(req);
      json(res, 200, await claimBuytokenOrder(body.orderId));
      return;
    }
    if (req.method === "POST" && pathname === "/api/preview") {
      json(res, 200, { ok: true, previews: buildPreview(await readBody(req)) });
      return;
    }
    if (req.method === "POST" && pathname === "/api/apply") {
      json(res, 200, applyConfig(await readBody(req)));
      return;
    }
    if (req.method === "POST" && pathname === "/api/restore-last") {
      json(res, 200, restoreLastBackup());
      return;
    }
    if (req.method === "POST" && pathname === "/api/tool-toggle") {
      json(res, 200, setToolEnabled(await readBody(req)));
      return;
    }
    if (req.method === "POST" && pathname === "/api/tool-settings") {
      json(res, 200, saveToolSettings(await readBody(req)));
      return;
    }
    if (req.method === "POST" && pathname === "/api/open-path") {
      const body = await readBody(req);
      json(res, 200, openPath(body.path));
      return;
    }
    json(res, 404, { ok: false, error: "Unknown API route." });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || String(error) });
  }
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const staticRoot = requested.startsWith("/assets/") ? ASSETS_DIR : PUBLIC_DIR;
  const staticRequest = requested.startsWith("/assets/") ? requested.slice("/assets".length) : requested;
  const filePath = path.normalize(path.join(staticRoot, staticRequest));
  const relative = path.relative(staticRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    text(res, 403, "Forbidden");
    return;
  }
  if (!exists(filePath) || !statSafe(filePath).isFile()) {
    text(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function createDmapiHandler() {
  const app = express();
  const dmapiAuth = createDmapiAuthService({
    userconfPath: USERCONF_PATH,
    legacyUserconfPath: LEGACY_USERCONF_PATH
  });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(dmapiAuth.router);

  return app;
}

function isDmapiPath(pathname) {
  return pathname === "/api/session-status"
    || pathname === "/api/session/logout"
    || pathname === "/api/local-user"
    || pathname === "/api/local-user/relogin"
    || pathname.startsWith("/api/dmapi/");
}

function createServer() {
  const dmapiHandler = createDmapiHandler();

  return http.createServer(async (req, res) => {
    const current = new URL(req.url, `http://${req.headers.host || `${HOST}:${DEFAULT_PORT}`}`);
    if (isDmapiPath(current.pathname)) {
      dmapiHandler(req, res);
      return;
    }
    if (current.pathname.startsWith("/api/")) {
      if (req.method === "GET" && current.pathname.startsWith("/api/learn/article/")) {
        serveLearnArticle(res, decodeURIComponent(current.pathname.slice("/api/learn/article/".length)));
        return;
      }
      if (req.method === "GET" && current.pathname.startsWith("/api/learn/cover/")) {
        serveLearnCover(res, decodeURIComponent(current.pathname.slice("/api/learn/cover/".length)));
        return;
      }
      await routeApi(req, res, current);
      return;
    }
    serveStatic(req, res, decodeURIComponent(current.pathname));
  });
}

function start(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", error => {
      if (error.code === "EADDRINUSE" && port < DEFAULT_PORT + 20) {
        resolve(start(port + 1));
        return;
      }
      reject(error);
    });
    server.listen(port, HOST, () => {
      ensureDataDir();
      const address = server.address();
      const actualPort = address && typeof address === "object" ? address.port : port;
      const url = `http://${HOST}:${actualPort}`;
      fs.writeFileSync(
        path.join(DATA_DIR, "server.json"),
        JSON.stringify({ url, port: actualPort, startedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
      console.log(`${APP_NAME} is running at ${url}`);
      resolve({ server, port: actualPort, url });
    });
  });
}

if (require.main === module) {
  start(DEFAULT_PORT).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  APP_NAME,
  DEFAULT_PORT,
  HOST,
  DATA_DIR,
  ROOT,
  createServer,
  start
};
