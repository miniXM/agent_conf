const loginPage = document.querySelector("#loginPage");
const dashboardPage = document.querySelector("#dashboardPage");
const loginForm = document.querySelector("#loginForm");
const registerBtn = document.querySelector("#registerBtn");
const reloadStoredBtn = document.querySelector("#reloadStoredBtn");
const loginUsername = document.querySelector("#loginUsername");
const loginPassword = document.querySelector("#loginPassword");
const rememberCredential = document.querySelector("#rememberCredential");
const loginMessage = document.querySelector("#loginMessage");
const storedAccountText = document.querySelector("#storedAccountText");
const navButtons = document.querySelectorAll(".nav-button");
const languageButtons = document.querySelectorAll(".language-toggle button");
const views = document.querySelectorAll(".view");
const learnGrid = document.querySelector("#learnGrid");
const learnEmpty = document.querySelector("#learnEmpty");
const learnStatusText = document.querySelector("#learnStatusText");
const learnSourceBtn = document.querySelector("#learnSourceBtn");
const learnRefreshBtn = document.querySelector("#learnRefreshBtn");
const learnSourceDialog = document.querySelector("#learnSourceDialog");
const learnSourceForm = document.querySelector("#learnSourceForm");
const learnCatalogUrl = document.querySelector("#learnCatalogUrl");
const closeLearnSourceBtn = document.querySelector("#closeLearnSourceBtn");
const useSampleLearnBtn = document.querySelector("#useSampleLearnBtn");
const articleDialog = document.querySelector("#articleDialog");
const articleDialogTitle = document.querySelector("#articleDialogTitle");
const articleDialogMeta = document.querySelector("#articleDialogMeta");
const articleFrame = document.querySelector("#articleFrame");
const closeArticleBtn = document.querySelector("#closeArticleBtn");
const apiUrlInput = document.querySelector("#apiUrl");
const apiKeyInput = document.querySelector("#apiKey");
const apiUrlDisplay = document.querySelector("#apiUrlDisplay");
const apiKeyDisplay = document.querySelector("#apiKeyDisplay");
const toolCards = document.querySelectorAll(".template-card[data-tool]");
const settingsButtons = document.querySelectorAll("[data-tool-settings]");
const toolSettingsDialog = document.querySelector("#toolSettingsDialog");
const toolSettingsForm = document.querySelector("#toolSettingsForm");
const toolSettingsToolId = document.querySelector("#toolSettingsToolId");
const toolSettingsTitle = document.querySelector("#toolSettingsTitle");
const toolSettingsSubtitle = document.querySelector("#toolSettingsSubtitle");
const toolSettingsConfigPath = document.querySelector("#toolSettingsConfigPath");
const toolSettingsExtraPathField = document.querySelector("#toolSettingsExtraPathField");
const toolSettingsExtraPathLabel = document.querySelector("#toolSettingsExtraPathLabel");
const toolSettingsExtraPath = document.querySelector("#toolSettingsExtraPath");
const toolSettingsExtraPathHelp = document.querySelector("#toolSettingsExtraPathHelp");
const closeToolSettingsBtn = document.querySelector("#closeToolSettingsBtn");
const resetToolSettingsBtn = document.querySelector("#resetToolSettingsBtn");
const deleteLocalUserBtn = document.querySelector("#deleteLocalUserBtn");
const accountDetail = document.querySelector("#accountDetail");
const mineUsername = document.querySelector("#mineUsername");
const mineBalance = document.querySelector("#mineBalance");
const minePassword = document.querySelector("#minePassword");
const passwordVisibleToggle = document.querySelector("#passwordVisibleToggle");
const loginStatusText = document.querySelector("#loginStatusText");
const mineLogoutBtn = document.querySelector("#mineLogoutBtn");
const topupForm = document.querySelector("#topupForm");
const topupCode = document.querySelector("#topupCode");
const topupMessage = document.querySelector("#topupMessage");
const topupProducts = document.querySelector("#topupProducts");
const apiKeyPanel = document.querySelector("#apiKeyPanel");
const toggleApiKeyPanelBtn = document.querySelector("#toggleApiKeyPanelBtn");
const tokenForm = document.querySelector("#tokenForm");
const tokenName = document.querySelector("#tokenName");
const tokenList = document.querySelector("#tokenList");
const tokenEmpty = document.querySelector("#tokenEmpty");
const tokenMessage = document.querySelector("#tokenMessage");
const refreshKeysBtn = document.querySelector("#refreshKeysBtn");
const keyReveal = document.querySelector("#keyReveal");
const revealedKey = document.querySelector("#revealedKey");
const useRevealedKeyBtn = document.querySelector("#useRevealedKeyBtn");
const toast = document.querySelector("#toast");

const DEFAULT_PROVIDER_URL = "https://token.minapp.xin/v1";
const QUOTA_PER_YUAN = 500000;
const BUYTOKEN_PENDING_STORAGE_KEY = "agentConf.buytoken.pendingOrders";
const BUYTOKEN_POLL_INTERVAL_MS = 3000;
const BUYTOKEN_POLL_ATTEMPTS = 100;
const syncTimers = new Map();
const TOOL_LABELS = {
  codex: "Codex",
  hermes: "Hermes",
  lobster: "LobsterAI"
};
const DEFAULT_TOOL_SETTINGS = {
  codex: {
    configPath: "",
    authPath: "",
    providerId: "agent_direct",
    providerName: "claw",
    supportsVision: true
  },
  hermes: {
    configPath: "",
    providerId: "agent_direct",
    providerName: "claw",
    supportsVision: true
  },
  lobster: {
    configPath: "",
    providerId: "agent_direct",
    providerName: "claw",
    supportsVision: true
  }
};

let statusLoaded = false;
let currentUser = null;
let storedUser = null;
let buytokenLoaded = false;
let learnLoaded = false;
let learnCards = [];
const buytokenPolling = new Set();
let activeSettingsButton = null;
let tokenSyncPromise = null;
const toolDefaultPaths = {};
const toolDefaultExtraPaths = {};
const toolSettingsState = {};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false || data.success === false) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return data;
}

function setMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("is-error", type === "error");
  element.classList.toggle("is-success", type === "success");
}

function showToast(message, type = "success") {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.toggle("is-success", type === "success");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function isBuytokenPaid(data) {
  const status = String(data && data.status ? data.status : "").toLowerCase();
  return Boolean(
    data
    && (
      data.paid === true
      || status === "paid"
      || status === "success"
      || status === "claimed"
      || status === "completed"
    )
  );
}

function readPendingBuytokenOrders() {
  try {
    const raw = window.localStorage.getItem(BUYTOKEN_PENDING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingBuytokenOrders(list) {
  window.localStorage.setItem(BUYTOKEN_PENDING_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function savePendingBuytokenOrder(order) {
  const current = readPendingBuytokenOrders().filter(item => item && item.orderId !== order.orderId);
  current.unshift({
    orderId: String(order.orderId || "").trim(),
    productId: String(order.productId || "").trim(),
    createdAt: order.createdAt || new Date().toISOString()
  });
  writePendingBuytokenOrders(current.slice(0, 12));
}

function removePendingBuytokenOrder(orderId) {
  const value = String(orderId || "").trim();
  if (!value) return;
  writePendingBuytokenOrders(readPendingBuytokenOrders().filter(item => item && item.orderId !== value));
}

function pickFirst(value, keys) {
  for (const key of keys) {
    if (value && value[key] !== undefined && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }
  return "";
}

function extractPayload(data) {
  return data && data.data && data.data.data ? data.data.data : data && data.data ? data.data : data;
}

function extractUserId(data) {
  const payload = extractPayload(data);
  return pickFirst(payload, ["id", "userId", "user_id"]) || pickFirst(data && data.data, ["id", "userId", "user_id"]);
}

function extractQuota(data) {
  const payload = extractPayload(data);
  const quota = pickFirst(payload, ["quota", "balance", "credit", "credits", "amount"]);
  return quota === "" ? "--" : String(quota);
}

function formatBalance(value) {
  const quota = Number(value);
  if (!Number.isFinite(quota)) return "--";
  return (quota / QUOTA_PER_YUAN).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function extractTokens(data) {
  const payload = extractPayload(data);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload && payload.list)) return payload.list;
  if (Array.isArray(payload && payload.items)) return payload.items;
  if (Array.isArray(payload && payload.records)) return payload.records;
  if (Array.isArray(data && data.data)) return data.data;
  return [];
}

function extractKeyValue(data) {
  const payload = extractPayload(data);
  return String(
    pickFirst(payload, ["key", "apiKey", "api_key", "token", "value", "secret"])
      || pickFirst(data, ["key", "apiKey", "api_key", "token", "value", "secret"])
      || ""
  );
}

function withOpenAiKeyPrefix(key) {
  const value = String(key || "").trim();
  if (!value) return "";
  return value.startsWith("sk-") ? value : `sk-${value}`;
}

function maskMiddle(value, { start = 6, end = 4, mask = "*" } = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= start + end) return text;
  return `${text.slice(0, start)}${mask.repeat(text.length - start - end)}${text.slice(-end)}`;
}

function renderProviderSummary() {
  if (apiUrlDisplay) {
    const apiUrl = String(apiUrlInput?.value || "").trim();
    const displayApiUrl = apiUrl || "未设置";
    apiUrlDisplay.textContent = displayApiUrl;
    apiUrlDisplay.title = displayApiUrl;
  }
  if (apiKeyDisplay) {
    const apiKey = String(apiKeyInput?.value || "").trim();
    const displayApiKey = apiKey ? maskMiddle(apiKey) : "未设置";
    apiKeyDisplay.textContent = displayApiKey;
    apiKeyDisplay.title = displayApiKey;
  }
}

function buildTokenCreatePayload(name) {
  return {
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: "",
    allow_ips: "",
    group: "",
    cross_group_retry: false
  };
}

function tokenId(token) {
  return String(pickFirst(token, ["id", "token_id", "tokenId", "uuid"]) || "");
}

function tokenDisplayName(token) {
  return String(pickFirst(token, ["name", "title", "remark", "description"]) || tokenId(token) || "未命名 Key");
}

function tokenMaskedKey(token) {
  const key = String(pickFirst(token, ["key", "apiKey", "api_key", "token", "value", "secret"]) || "");
  if (key) return withOpenAiKeyPrefix(key);
  const id = tokenId(token);
  return id ? `ID ${id}` : "API Key";
}

function isMaskedSecret(value) {
  const text = String(value || "");
  return text.includes("*") || text.includes("...");
}

function setApiKeyPanelCollapsed(collapsed) {
  if (!apiKeyPanel || !toggleApiKeyPanelBtn) return;
  apiKeyPanel.classList.toggle("is-collapsed", collapsed);
  toggleApiKeyPanelBtn.setAttribute("aria-expanded", String(!collapsed));
}

function formatMaybeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function getCard(tool) {
  return document.querySelector(`.template-card[data-tool="${tool}"]`);
}

function cloneToolSettings(tool) {
  return {
    ...DEFAULT_TOOL_SETTINGS[tool],
    configPath: toolDefaultPaths[tool] || DEFAULT_TOOL_SETTINGS[tool].configPath,
    authPath: toolDefaultExtraPaths[tool] || DEFAULT_TOOL_SETTINGS[tool].authPath || ""
  };
}

function getToolLabel(tool) {
  return TOOL_LABELS[tool] || tool;
}

function getToolSettings(tool) {
  if (!toolSettingsState[tool]) {
    toolSettingsState[tool] = cloneToolSettings(tool);
  }
  return toolSettingsState[tool];
}

function getToolConfig(tool) {
  const card = getCard(tool);
  const settings = getToolSettings(tool);
  return {
    model: card.querySelector(".model-input").value.trim(),
    apiType: card.querySelector(".api-type-select").value,
    providerId: settings.providerId,
    providerName: settings.providerName,
    supportsVision: settings.supportsVision,
    configPath: settings.configPath,
    authPath: settings.authPath
  };
}

function payloadForTool(tool, enabled) {
  const toolConfig = getToolConfig(tool);
  return {
    tool,
    enabled,
    baseUrl: toolConfig.baseUrl || apiUrlInput.value.trim(),
    apiKey: withOpenAiKeyPrefix(apiKeyInput.value),
    apiType: toolConfig.apiType,
    providerId: toolConfig.providerId,
    providerName: toolConfig.providerName,
    supportsVision: toolConfig.supportsVision,
    tools: {
      [tool]: toolConfig
    },
    targets: {
      [tool]: {
        enabled,
        path: toolConfig.configPath || undefined,
        authPath: toolConfig.authPath || undefined
      }
    }
  };
}

function isToolEnabled(tool) {
  return Boolean(getCard(tool)?.querySelector(".tool-toggle")?.checked);
}

function setToolMissing(card, missing) {
  const badge = card.querySelector(".tool-missing-badge");
  if (badge) badge.hidden = !missing;
}

function applyToolSettings(tool, nextSettings = {}) {
  toolSettingsState[tool] = {
    ...cloneToolSettings(tool),
    ...nextSettings,
    configPath: String(nextSettings.configPath || DEFAULT_TOOL_SETTINGS[tool].configPath || "").trim(),
    authPath: String(nextSettings.authPath || DEFAULT_TOOL_SETTINGS[tool].authPath || "").trim(),
    providerId: String(nextSettings.providerId || DEFAULT_TOOL_SETTINGS[tool].providerId).trim() || DEFAULT_TOOL_SETTINGS[tool].providerId,
    providerName: "claw",
    supportsVision: nextSettings.supportsVision !== undefined
      ? Boolean(nextSettings.supportsVision)
      : DEFAULT_TOOL_SETTINGS[tool].supportsVision
  };
}

function openToolSettings(tool, triggerButton = null) {
  const settings = getToolSettings(tool);
  const label = getToolLabel(tool);
  toolSettingsToolId.value = tool;
  toolSettingsTitle.textContent = `${label} 配置文件地址`;
  toolSettingsSubtitle.textContent = `为 ${label} 指定实际要写入的本地配置文件位置。`;
  toolSettingsConfigPath.value = settings.configPath || "";
  const isCodex = tool === "codex";
  toolSettingsExtraPathField.hidden = !isCodex;
  toolSettingsExtraPath.disabled = !isCodex;
  if (isCodex) {
    toolSettingsExtraPathLabel.textContent = "auth.json 地址";
    toolSettingsExtraPathHelp.textContent = "Codex 的 API Key 会写入这个文件。";
    toolSettingsExtraPath.value = settings.authPath || "";
  } else {
    toolSettingsExtraPath.value = "";
  }
  toolSettingsDialog.hidden = false;
  activeSettingsButton = triggerButton;
}

function closeToolSettings() {
  toolSettingsDialog.hidden = true;
  if (activeSettingsButton) activeSettingsButton.focus();
  activeSettingsButton = null;
}

async function saveToolSettingsFromDialog() {
  const tool = toolSettingsToolId.value;
  if (!tool) return;
  applyToolSettings(tool, {
    configPath: toolSettingsConfigPath.value,
    authPath: tool === "codex" ? toolSettingsExtraPath.value : "",
    providerName: "claw"
  });
  await api("/api/tool-settings", {
    method: "POST",
    body: payloadForTool(tool, isToolEnabled(tool))
  });
  closeToolSettings();
  scheduleToolSync(tool);
  showToast(`${getToolLabel(tool)} 设置已保存`, "success");
}

function resetToolSettingsInDialog() {
  const tool = toolSettingsToolId.value;
  if (!tool) return;
  applyToolSettings(tool, cloneToolSettings(tool));
  openToolSettings(tool, activeSettingsButton);
}

function updateAccountView(user) {
  currentUser = user;
  const username = user && (user.username || user.displayName) ? user.username || user.displayName : "未登录";
  const userId = user && user.userId ? String(user.userId) : "--";
  const quota = user && user.quota !== undefined && user.quota !== null ? String(user.quota) : "--";

  if (mineUsername) mineUsername.textContent = username;
  if (mineBalance) mineBalance.textContent = formatBalance(quota);
  renderStoredPassword();
  if (loginStatusText) {
    loginStatusText.textContent = user ? "已登录" : "未登录";
    loginStatusText.classList.toggle("is-online", Boolean(user));
  }
  if (accountDetail) {
    accountDetail.textContent = user ? "账号已登录，可管理余额和 API Key" : "登录后显示余额和账户信息";
  }
}

function renderStoredPassword() {
  if (!minePassword) return;
  const password = storedUser?.password || "";
  minePassword.textContent = passwordVisibleToggle?.checked && password ? password : "••••••••";
}

function setLearnStatus(message) {
  if (learnStatusText) learnStatusText.textContent = message || "";
}

function learnCoverMarkup(card) {
  if (card.coverDisplay) {
    return `<img src="${card.coverDisplay}" alt="">`;
  }
  return '<div class="learn-cover-fallback">HTML</div>';
}

function renderLearnCards(cards = []) {
  learnCards = Array.isArray(cards) ? cards : [];
  if (!learnGrid || !learnEmpty) return;
  learnGrid.textContent = "";
  learnEmpty.hidden = learnCards.length > 0;

  learnCards.forEach(card => {
    const button = document.createElement("button");
    button.className = `learn-card ${card.style ? `is-${card.style}` : ""}`.trim();
    button.type = "button";
    button.dataset.articleId = card.id;
    button.innerHTML = `
      <div class="learn-cover">${learnCoverMarkup(card)}</div>
      <div class="learn-card-body">
        <div class="learn-card-title"></div>
        <div class="learn-card-desc"></div>
        <div class="learn-card-foot">
          <span class="learn-cache-badge"></span>
          <span class="learn-date"></span>
        </div>
      </div>
    `;
    button.querySelector(".learn-card-title").textContent = card.title || "未命名文章";
    button.querySelector(".learn-card-desc").textContent = card.desc || "点击阅读文章";
    button.querySelector(".learn-cache-badge").textContent = card.hasCachedArticle
      ? (card.isArticleCurrent ? "已离线" : "可更新")
      : "未缓存";
    button.querySelector(".learn-cache-badge").classList.toggle("is-cached", Boolean(card.hasCachedArticle));
    button.querySelector(".learn-date").textContent = card.updatedAt || "";
    button.addEventListener("click", () => openLearnArticle(card, button).catch(error => {
      showToast(error.message, "error");
      button.disabled = false;
      button.classList.remove("is-loading");
    }));
    learnGrid.appendChild(button);
  });
}

async function loadLearnSource() {
  const data = await api("/api/learn/source");
  if (learnCatalogUrl) {
    learnCatalogUrl.value = data.catalogUrl || "";
  }
  return data;
}

async function loadLearnCatalog({ refresh = false } = {}) {
  if (!learnGrid) return;
  if (learnRefreshBtn) learnRefreshBtn.disabled = true;
  setLearnStatus(refresh ? "正在刷新文章列表..." : "正在读取文章列表...");
  try {
    const data = await api(`/api/learn/catalog${refresh ? "?refresh=1" : ""}`);
    const catalog = data.catalog || {};
    renderLearnCards(catalog.cards || []);
    learnLoaded = true;
    if (data.message) {
      setLearnStatus(data.message);
    } else if (data.usingSample) {
      setLearnStatus("当前使用本地示例。设置 Gitee cards.json 后会读取你的文章。");
    } else {
      setLearnStatus(data.refreshed ? "文章列表已更新并保存到本地。" : "已读取本地缓存的文章列表。");
    }
  } catch (error) {
    renderLearnCards([]);
    setLearnStatus(`文章列表读取失败：${error.message}`);
  } finally {
    if (learnRefreshBtn) learnRefreshBtn.disabled = false;
  }
}

async function saveLearnSource(catalogUrl) {
  await api("/api/learn/source", {
    method: "POST",
    body: { catalogUrl }
  });
  learnSourceDialog.hidden = true;
  await loadLearnCatalog({ refresh: true });
}

function openLearnSourceDialog() {
  loadLearnSource().catch(console.error);
  learnSourceDialog.hidden = false;
  window.setTimeout(() => learnCatalogUrl?.focus(), 0);
}

function closeLearnSourceDialog() {
  learnSourceDialog.hidden = true;
  learnSourceBtn?.focus();
}

function openArticleDialog(card, articleUrl, metaText) {
  if (!articleDialog || !articleFrame) return;
  articleDialogTitle.textContent = card.title || "文章";
  articleDialogMeta.textContent = metaText || "本地缓存";
  articleFrame.src = articleUrl;
  articleDialog.hidden = false;
}

function closeArticleDialog() {
  if (articleFrame) articleFrame.src = "about:blank";
  if (articleDialog) articleDialog.hidden = true;
}

async function openLearnArticle(card, triggerButton) {
  if (!card || !card.id) return;
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.classList.add("is-loading");
  }
  setLearnStatus(card.hasCachedArticle && card.isArticleCurrent ? "正在打开本地文章..." : "正在缓存文章 HTML...");
  try {
    const data = await api(`/api/learn/article-cache/${encodeURIComponent(card.id)}`, { method: "POST" });
    const articleUrl = `${data.articleUrl}?t=${Date.now()}`;
    const nextCards = learnCards.map(item => item.id === card.id
      ? {
          ...item,
          hasCachedArticle: true,
          isArticleCurrent: true,
          articleUrl: data.articleUrl
        }
      : item);
    renderLearnCards(nextCards);
    openArticleDialog(card, articleUrl, data.stale ? "已打开本地旧缓存" : "已缓存到本地");
    setLearnStatus(data.stale ? "联网更新失败，已打开本地旧缓存。" : "文章已保存到本地，可离线阅读。");
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.classList.remove("is-loading");
    }
  }
}

function showDashboard() {
  document.body.classList.remove("is-login");
  loginPage.hidden = true;
  dashboardPage.hidden = false;
  if (!statusLoaded) loadConfigStatus();
}

function showLogin() {
  document.body.classList.add("is-login");
  loginPage.hidden = false;
  dashboardPage.hidden = true;
  updateAccountView(null);
}

async function setToolEnabled(tool, enabled) {
  const card = getCard(tool);
  const toggle = card.querySelector(".tool-toggle");
  const label = getToolLabel(tool);
  toggle.disabled = true;
  try {
    await api("/api/tool-toggle", {
      method: "POST",
      body: payloadForTool(tool, enabled)
    });
    showToast(`${label} 已${enabled ? "写入配置" : "恢复原配置"}`, "success");
  } catch (error) {
    toggle.checked = !enabled;
    console.error(error);
    showToast(`${label} 切换失败：${error.message}`, "error");
  } finally {
    toggle.disabled = false;
  }
}

function scheduleToolSync(tool) {
  const card = getCard(tool);
  const toggle = card.querySelector(".tool-toggle");
  if (!toggle.checked) return;
  clearTimeout(syncTimers.get(tool));
  syncTimers.set(tool, setTimeout(() => setToolEnabled(tool, true), 400));
}

async function loadConfigStatus() {
  try {
    const status = await api("/api/status");
    statusLoaded = true;
    apiUrlInput.value = status.defaults.baseUrl || DEFAULT_PROVIDER_URL;
    const defaultModel = status.defaults.model || "gpt-5.5";
    const defaultApiType = status.defaults.apiType || "openai-responses";

    toolCards.forEach(card => {
      const tool = card.dataset.tool;
      const toolState = status.tools && status.tools[tool];
      const lastConfig = toolState && toolState.lastConfig ? toolState.lastConfig : {};
      toolDefaultPaths[tool] = toolState.builtInDefaultPath || toolState.defaultPath || "";
      toolDefaultExtraPaths[tool] = toolState.builtInAuthPath || toolState.authPath || "";
      applyToolSettings(tool, {
        configPath: lastConfig.configPath || toolState.defaultPath || "",
        authPath: lastConfig.authPath || toolState.authPath || "",
        providerId: lastConfig.providerId,
        supportsVision: lastConfig.supportsVision
      });
      card.querySelector(".model-input").value =
        lastConfig.model || defaultModel;
      card.querySelector(".api-type-select").value =
        lastConfig.apiType || defaultApiType;
      card.querySelector(".tool-toggle").checked = Boolean(toolState && toolState.managedEnabled);
      setToolMissing(card, !Boolean(toolState && toolState.exists));
    });
    renderProviderSummary();
  } catch (error) {
    console.error(error);
  }
}

async function loadStoredUser() {
  try {
    const data = await api("/api/local-user");
    storedUser = data.exists ? data.data : null;
    storedAccountText.textContent = storedUser
      ? `已保存账号：${storedUser.username}`
      : "本机未发现已保存账号";
    if (storedUser && !loginUsername.value) {
      loginUsername.value = storedUser.username || "";
    }
    renderStoredPassword();
  } catch (error) {
    storedAccountText.textContent = "读取本地账号失败";
    console.error(error);
  }
}

async function saveLocalUser(username, password, userId = null) {
  await api("/api/local-user", {
    method: "POST",
    body: { username, password, userId }
  });
  await loadStoredUser();
}

async function refreshUserSelf() {
  const data = await api("/api/dmapi/user/self");
  const payload = extractPayload(data);
  const user = {
    username: pickFirst(payload, ["username", "email", "phone", "display_name"]) || currentUser?.username || "",
    displayName: pickFirst(payload, ["display_name", "name"]) || "",
    userId: extractUserId(data) || currentUser?.userId || "",
    quota: extractQuota(data)
  };
  updateAccountView(user);
  return user;
}

async function refreshSession() {
  try {
    const status = await api("/api/session-status");
    if (status.authenticated) {
      const user = {
        username: status.data.username || status.data.displayName || "",
        displayName: status.data.displayName || "",
        userId: status.data.userId || "",
        quota: status.data.quota ?? "--"
      };
      updateAccountView(user);
      showDashboard();
      refreshUserSelf().catch(console.error);
      ensureConfigApiKey().catch(console.error);
      return true;
    }
  } catch (error) {
    console.error(error);
  }
  return false;
}

async function reloginStoredUser() {
  setMessage(loginMessage, "正在恢复本地账号...");
  const data = await api("/api/local-user/relogin", { method: "POST" });
  const userId = extractUserId(data);
  updateAccountView({
    username: data.username || storedUser?.username || "",
    userId,
    quota: extractQuota(data)
  });
  setMessage(loginMessage, "已恢复登录", "success");
  showDashboard();
  refreshUserSelf().catch(console.error);
  ensureConfigApiKey().catch(console.error);
}

async function submitLogin(mode) {
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();

  if (!username || !password) {
    setMessage(loginMessage, "请输入账号和密码", "error");
    return;
  }

  setMessage(loginMessage, mode === "register" ? "正在注册..." : "正在登录...");
  const path = mode === "register" ? "/api/dmapi/register" : "/api/dmapi/login";
  const data = await api(path, {
    method: "POST",
    body: { username, password }
  });
  const userId = extractUserId(data);

  if (rememberCredential.checked) {
    await saveLocalUser(username, password, userId);
  }

  updateAccountView({
    username,
    userId,
    quota: extractQuota(data)
  });
  setMessage(loginMessage, mode === "register" ? "注册成功" : "登录成功", "success");
  showDashboard();
  refreshUserSelf().catch(console.error);
  ensureConfigApiKey().catch(console.error);
}

function renderTokens(tokens) {
  tokenList.innerHTML = "";
  tokenEmpty.hidden = tokens.length > 0;

  tokens.forEach(token => {
    const id = tokenId(token);
    const createdAt = formatMaybeDate(pickFirst(token, ["created_at", "createdAt", "created"]));
    const item = document.createElement("div");
    item.className = "token-item";
    item.innerHTML = `
      <div class="token-row">
        <div>
          <div class="token-name"></div>
          <div class="token-meta"></div>
        </div>
        <div class="token-actions">
          <button class="key-icon-button" type="button" data-action="read" aria-label="读取并填入 API Key" title="读取并填入 API Key">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 9h10v10H9z"></path>
              <path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"></path>
            </svg>
          </button>
          <button class="key-icon-button key-delete-button" type="button" data-action="delete" aria-label="删除 API Key" title="删除 API Key">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M6 7l1 13h10l1-13"></path>
              <path d="M9 7V4h6v3"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
    item.querySelector(".token-name").textContent = tokenMaskedKey(token);
    item.querySelector(".token-meta").textContent = [tokenDisplayName(token), createdAt ? `创建于 ${createdAt}` : ""]
      .filter(Boolean)
      .join(" · ") || (id ? `ID ${id}` : "无更多信息");
    item.querySelector('[data-action="read"]').addEventListener("click", () => readTokenKey(id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteToken(id));
    tokenList.appendChild(item);
  });
}

async function refreshTokenList() {
  if (!currentUser) return;
  setMessage(tokenMessage, "正在刷新 Key 列表...");
  const data = await api("/api/dmapi/token");
  const tokens = extractTokens(data);
  renderTokens(tokens);
  setMessage(tokenMessage, "Key 列表已更新", "success");
  return tokens;
}

function applyConfigApiKey(key, { reveal = true, sync = true } = {}) {
  const normalizedKey = withOpenAiKeyPrefix(key);
  if (!normalizedKey) return "";
  apiKeyInput.value = normalizedKey;
  renderProviderSummary();
  if (reveal) showRevealedKey(normalizedKey);
  if (sync) toolCards.forEach(card => scheduleToolSync(card.dataset.tool));
  return normalizedKey;
}

async function createTokenForConfig({ silent = false } = {}) {
  const name = tokenName.value.trim() || "agent_conf";
  if (!silent) setMessage(tokenMessage, "正在生成 API Key...");
  const data = await api("/api/dmapi/token", {
    method: "POST",
    body: buildTokenCreatePayload(name)
  });
  const key = applyConfigApiKey(extractKeyValue(data), { reveal: !silent, sync: true });
  tokenName.value = "";
  await refreshTokenList();
  if (!silent) {
    setMessage(tokenMessage, key ? "API Key 已生成并填入配置" : "API Key 已生成", "success");
  }
  return key;
}

async function ensureConfigApiKey({ force = false } = {}) {
  if (!currentUser) return "";
  if (!force && apiKeyInput.value.trim()) {
    renderProviderSummary();
    return apiKeyInput.value.trim();
  }
  if (tokenSyncPromise) return tokenSyncPromise;
  tokenSyncPromise = (async () => {
    const tokens = await refreshTokenList();
    if (Array.isArray(tokens) && tokens.length > 0) {
      const keyFromList = withOpenAiKeyPrefix(extractKeyValue(tokens[0]));
      if (keyFromList && !isMaskedSecret(keyFromList)) {
        return applyConfigApiKey(keyFromList, { reveal: false, sync: true });
      }
      const firstId = tokenId(tokens[0]);
      if (firstId) {
        const key = await readTokenKey(firstId, { silent: true });
        if (key) return key;
      }
    }
    return createTokenForConfig({ silent: true });
  })();
  try {
    return await tokenSyncPromise;
  } finally {
    tokenSyncPromise = null;
  }
}

async function createToken() {
  return createTokenForConfig({ silent: false });
}

function showRevealedKey(key) {
  revealedKey.textContent = key;
  keyReveal.hidden = false;
}

function renderBuytokenProducts(products) {
  if (!topupProducts) return;
  if (!Array.isArray(products) || products.length === 0) {
    topupProducts.innerHTML = "";
    buytokenLoaded = false;
    return;
  }
  topupProducts.textContent = "";
  products.forEach(product => {
    const button = document.createElement("button");
    button.className = "topup-product";
    button.type = "button";
    button.dataset.productId = product.id;

    const value = document.createElement("strong");
    value.textContent = `${product.value || "--"} 元`;

    const price = document.createElement("span");
    price.textContent = product.price ? `¥${Number(product.price).toFixed(2)}` : product.name;

    button.append(value, price);
    button.addEventListener("click", () => {
      openBuytokenOrder(button.dataset.productId, button).catch(error => {
        setMessage(topupMessage, error.message, "error");
        button.disabled = false;
        button.classList.remove("is-loading");
      });
    });
    topupProducts.append(button);
  });
  buytokenLoaded = true;
}

async function loadBuytokenProducts(force = false) {
  if (!topupProducts || (buytokenLoaded && !force)) return;
  try {
    const data = await api("/api/buytoken/products");
    renderBuytokenProducts(data.products || []);
  } catch (error) {
    topupProducts.innerHTML = '<p class="empty-state">充值选项加载失败，请稍后重试</p>';
    buytokenLoaded = false;
    console.error(error);
  }
}

async function ensureBuytokenProducts(force = false) {
  if (!topupProducts) return;
  if (force || !topupProducts.children.length) {
    await loadBuytokenProducts(true);
  }
}

async function claimBuytokenOrder(orderId, { silent = false } = {}) {
  if (!silent) setMessage(topupMessage, "支付已完成，正在充值到账...");
  const data = await api("/api/buytoken/claim", {
    method: "POST",
    body: { orderId }
  });
  removePendingBuytokenOrder(orderId);
  setMessage(topupMessage, "");
  showToast("充值成功", "success");
  await refreshUserSelf();
  return data;
}

async function pollBuytokenOrder(orderId, { attempts = BUYTOKEN_POLL_ATTEMPTS, silent = false } = {}) {
  const value = String(orderId || "").trim();
  if (!value || buytokenPolling.has(value)) return false;
  buytokenPolling.add(value);
  try {
    for (let index = 0; index < attempts; index += 1) {
      const status = await api(`/api/buytoken/check/${encodeURIComponent(value)}`);
      if (isBuytokenPaid(status)) {
        await claimBuytokenOrder(value, { silent });
        return true;
      }
      if (!silent && index === 0) {
        setMessage(topupMessage, "支付页已打开，支付成功后会自动充值到账", "success");
      }
      await wait(BUYTOKEN_POLL_INTERVAL_MS);
    }
    if (!silent) {
      setMessage(topupMessage, "未检测到支付完成，支付后返回本页会继续自动查询", "success");
    }
    return false;
  } catch (error) {
    if (silent) {
      console.error(error);
    } else {
      setMessage(topupMessage, error.message, "error");
    }
    return false;
  } finally {
    buytokenPolling.delete(value);
  }
}

function resumePendingBuytokenOrders() {
  readPendingBuytokenOrders().forEach(order => {
    if (order && order.orderId) {
      pollBuytokenOrder(order.orderId, { attempts: 8, silent: true }).catch(console.error);
    }
  });
}

async function openBuytokenOrder(productId, triggerButton) {
  if (!productId) return;
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.classList.add("is-loading");
  }
  const paymentWindow = window.open("about:blank", "_blank");
  if (paymentWindow) paymentWindow.opener = null;
  try {
    setMessage(topupMessage, "正在打开支付页面...");
    const data = await api("/api/buytoken/order", {
      method: "POST",
      body: {
        productId,
        account: currentUser?.username || storedUser?.username || ""
      }
    });
    if (!data.orderId || !data.paymentUrl) {
      throw new Error("创建订单失败，支付链接为空");
    }
    savePendingBuytokenOrder({
      orderId: data.orderId,
      productId
    });
    if (paymentWindow) {
      paymentWindow.location.href = data.paymentUrl;
    } else {
      window.location.href = data.paymentUrl;
    }
    setMessage(topupMessage, "支付页已打开，支付成功后会自动充值到账", "success");
    pollBuytokenOrder(data.orderId).catch(console.error);
  } catch (error) {
    if (paymentWindow) paymentWindow.close();
    throw error;
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.classList.remove("is-loading");
    }
  }
}

async function readTokenKey(id, { silent = false } = {}) {
  if (!id) {
    if (!silent) setMessage(tokenMessage, "缺少 Key ID，无法读取", "error");
    return "";
  }
  if (!silent) setMessage(tokenMessage, "正在读取 API Key...");
  const data = await api(`/api/dmapi/token/${encodeURIComponent(id)}/key`, { method: "POST" });
  const normalizedKey = applyConfigApiKey(extractKeyValue(data), { reveal: !silent, sync: true });
  if (!normalizedKey) {
    if (!silent) setMessage(tokenMessage, "接口未返回 Key 明文", "error");
    return "";
  }
  if (!silent) setMessage(tokenMessage, "已读取并填入配置", "success");
  return normalizedKey;
}

async function deleteToken(id) {
  if (!id) {
    setMessage(tokenMessage, "缺少 Key ID，无法删除", "error");
    return;
  }
  if (!window.confirm("确定删除这个 API Key 吗？")) return;
  setMessage(tokenMessage, "正在删除 API Key...");
  await api(`/api/dmapi/token/${encodeURIComponent(id)}`, { method: "DELETE" });
  keyReveal.hidden = true;
  if (apiKeyInput.value.trim()) {
    apiKeyInput.value = "";
    renderProviderSummary();
  }
  await ensureConfigApiKey({ force: true });
  setMessage(tokenMessage, "API Key 已删除，已自动补齐配置 Key", "success");
}

async function topupAccount() {
  const code = topupCode.value.trim();
  if (!code) {
    setMessage(topupMessage, "请输入充值码", "error");
    return;
  }
  setMessage(topupMessage, "正在充值...");
  await api("/api/dmapi/user/topup", {
    method: "POST",
    body: { code, key: code, card: code }
  });
  topupCode.value = "";
  setMessage(topupMessage, "");
  showToast("充值请求已提交", "success");
  await refreshUserSelf();
}

loginForm.addEventListener("submit", event => {
  event.preventDefault();
  submitLogin("login").catch(error => setMessage(loginMessage, error.message, "error"));
});

registerBtn.addEventListener("click", () => {
  submitLogin("register").catch(error => setMessage(loginMessage, error.message, "error"));
});

reloadStoredBtn.addEventListener("click", () => {
  reloginStoredUser().catch(error => setMessage(loginMessage, error.message, "error"));
});

mineLogoutBtn?.addEventListener("click", async () => {
  await api("/api/session/logout", { method: "POST" });
  showLogin();
});

deleteLocalUserBtn?.addEventListener("click", async () => {
  await api("/api/local-user", { method: "DELETE" });
  await loadStoredUser();
});

topupForm.addEventListener("submit", event => {
  event.preventDefault();
  topupAccount().catch(error => setMessage(topupMessage, error.message, "error"));
});

tokenForm.addEventListener("submit", event => {
  event.preventDefault();
  createToken().catch(error => setMessage(tokenMessage, error.message, "error"));
});

refreshKeysBtn.addEventListener("click", () => {
  refreshTokenList().catch(error => setMessage(tokenMessage, error.message, "error"));
});

useRevealedKeyBtn.addEventListener("click", () => {
  apiKeyInput.value = withOpenAiKeyPrefix(revealedKey.textContent);
  renderProviderSummary();
  toolCards.forEach(card => scheduleToolSync(card.dataset.tool));
});

toggleApiKeyPanelBtn?.addEventListener("click", () => {
  setApiKeyPanelCollapsed(!apiKeyPanel.classList.contains("is-collapsed"));
});

passwordVisibleToggle?.addEventListener("change", renderStoredPassword);

document.querySelectorAll(".copy-button").forEach(button => {
  button.addEventListener("click", async () => {
    const text = document.querySelector(`#${button.dataset.copyTarget}`)?.textContent || "";
    if (text && text !== "--") {
      await navigator.clipboard.writeText(text);
    }
  });
});

navButtons.forEach(button => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;

    navButtons.forEach(item => {
      item.classList.toggle("is-active", item === button);
    });

    views.forEach(item => {
      item.classList.toggle("is-active", item.id === `view-${view}`);
    });

    if (view === "mine") {
      refreshUserSelf().catch(console.error);
      ensureConfigApiKey().catch(console.error);
      ensureBuytokenProducts(true).catch(console.error);
    }
    if (view === "learn" && !learnLoaded) {
      loadLearnCatalog().catch(console.error);
    }
  });
});

languageButtons.forEach(button => {
  button.addEventListener("click", () => {
    const lang = button.dataset.lang;

    languageButtons.forEach(item => {
      item.classList.toggle("is-active", item === button);
    });

    navButtons.forEach(item => {
      item.textContent = item.dataset[lang];
    });
  });
});

toolCards.forEach(card => {
  const tool = card.dataset.tool;
  const toggle = card.querySelector(".tool-toggle");
  toggle.addEventListener("change", () => setToolEnabled(tool, toggle.checked));
  card.querySelector(".model-input").addEventListener("input", () => scheduleToolSync(tool));
  card.querySelector(".api-type-select").addEventListener("change", () => scheduleToolSync(tool));
});

settingsButtons.forEach(button => {
  button.addEventListener("click", () => {
    openToolSettings(button.dataset.toolSettings, button);
  });
});

toolSettingsForm?.addEventListener("submit", event => {
  event.preventDefault();
  saveToolSettingsFromDialog().catch(error => showToast(error.message, "error"));
});

resetToolSettingsBtn?.addEventListener("click", () => {
  resetToolSettingsInDialog();
});

closeToolSettingsBtn?.addEventListener("click", () => {
  closeToolSettings();
});

learnSourceBtn?.addEventListener("click", () => {
  openLearnSourceDialog();
});

learnRefreshBtn?.addEventListener("click", () => {
  loadLearnCatalog({ refresh: true }).catch(console.error);
});

learnSourceForm?.addEventListener("submit", event => {
  event.preventDefault();
  saveLearnSource(learnCatalogUrl.value).catch(error => showToast(error.message, "error"));
});

useSampleLearnBtn?.addEventListener("click", () => {
  learnCatalogUrl.value = "";
  saveLearnSource("").catch(error => showToast(error.message, "error"));
});

closeLearnSourceBtn?.addEventListener("click", () => {
  closeLearnSourceDialog();
});

learnSourceDialog?.addEventListener("click", event => {
  if (event.target === learnSourceDialog) {
    closeLearnSourceDialog();
  }
});

closeArticleBtn?.addEventListener("click", () => {
  closeArticleDialog();
});

articleDialog?.addEventListener("click", event => {
  if (event.target === articleDialog) {
    closeArticleDialog();
  }
});

toolSettingsDialog?.addEventListener("click", event => {
  if (event.target === toolSettingsDialog) {
    closeToolSettings();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && toolSettingsDialog && !toolSettingsDialog.hidden) {
    closeToolSettings();
  }
  if (event.key === "Escape" && learnSourceDialog && !learnSourceDialog.hidden) {
    closeLearnSourceDialog();
  }
  if (event.key === "Escape" && articleDialog && !articleDialog.hidden) {
    closeArticleDialog();
  }
});

apiUrlInput.addEventListener("input", () => {
  renderProviderSummary();
  toolCards.forEach(card => scheduleToolSync(card.dataset.tool));
});

apiKeyInput.addEventListener("input", () => {
  renderProviderSummary();
  toolCards.forEach(card => scheduleToolSync(card.dataset.tool));
});

renderProviderSummary();
loadStoredUser();
ensureBuytokenProducts().catch(console.error);
refreshSession().then(authenticated => {
  if (!authenticated) showLogin();
});
