const express = require('express');
const fs = require('fs');
const path = require('path');

const DEFAULT_DMAPI_BASE_URL = 'https://token.minapp.xin';
const DEFAULT_REGISTER_GROUP = process.env.DMAPI_DEFAULT_USER_GROUP || 'default';

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_DMAPI_BASE_URL).replace(/\/+$/, '');
}

async function readResponseJson(response, fallbackLabel) {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`${fallbackLabel} returned non-JSON response: ${preview || 'empty response'}`);
  }
}

function getSetCookieHeaders(response) {
  if (!response || !response.headers) {
    return [];
  }

  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  if (typeof response.headers.raw === 'function') {
    const rawHeaders = response.headers.raw();
    return rawHeaders && Array.isArray(rawHeaders['set-cookie']) ? rawHeaders['set-cookie'] : [];
  }

  const singleHeader = typeof response.headers.get === 'function' ? response.headers.get('set-cookie') : '';
  return singleHeader ? [singleHeader] : [];
}

function rewriteCookieForLocalProxy(cookie) {
  return String(cookie || '')
    .replace(/;\s*Domain=[^;]*/ig, '')
    .replace(/;\s*Secure/ig, '');
}

function forwardSetCookies(response, res) {
  const cookies = getSetCookieHeaders(response).map(rewriteCookieForLocalProxy);
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies);
  }
}

function getHeaderValue(headers, name) {
  const value = headers ? headers[name] : '';
  return Array.isArray(value) ? value[0] : value;
}

function buildDmapiHeaders({ session = '', userId = '', json = false } = {}) {
  const headers = {};

  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  if (session) {
    headers.Cookie = `session=${session}`;
  }
  if (userId) {
    headers['New-Api-User'] = String(userId);
  }

  return headers;
}

function resolveUserIdFromLoginData(data, fallbackUserId = null) {
  return data?.data?.data?.id ?? data?.data?.id ?? fallbackUserId ?? null;
}

function normalizeRegisterPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const group = String(source.group || DEFAULT_REGISTER_GROUP).trim() || DEFAULT_REGISTER_GROUP;
  return {
    ...source,
    group
  };
}

function normalizeApiKeyCreatePayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const name = String(source.name || '').trim() || 'agent_conf';

  return {
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group: '',
    cross_group_retry: false,
    ...source,
    name,
    unlimited_quota: source.unlimited_quota === undefined ? true : Boolean(source.unlimited_quota),
    remain_quota: source.unlimited_quota === false ? Number(source.remain_quota || 0) : 0,
    expired_time: source.expired_time === undefined || source.expired_time === '' ? -1 : source.expired_time,
    model_limits: Array.isArray(source.model_limits) ? source.model_limits.join(',') : String(source.model_limits || ''),
    model_limits_enabled: Array.isArray(source.model_limits)
      ? source.model_limits.length > 0
      : Boolean(source.model_limits_enabled),
    allow_ips: String(source.allow_ips || ''),
    group: String(source.group || ''),
    cross_group_retry: Boolean(source.cross_group_retry)
  };
}

function createLocalUserStore({ userconfPath, legacyUserconfPath }) {
  if (!userconfPath) {
    throw new Error('userconfPath is required');
  }

  function migrateLegacyUserConfIfNeeded() {
    try {
      if (!legacyUserconfPath || fs.existsSync(userconfPath) || !fs.existsSync(legacyUserconfPath)) {
        return;
      }

      ensureParentDir(userconfPath);
      fs.copyFileSync(legacyUserconfPath, userconfPath);
    } catch (error) {
      console.warn('[dmapi-auth] Unable to migrate legacy userconf.json:', error.message);
    }
  }

  function readUserConf() {
    try {
      migrateLegacyUserConfIfNeeded();

      if (!fs.existsSync(userconfPath)) {
        return {};
      }

      const raw = fs.readFileSync(userconfPath, 'utf8').trim();
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeUserConf(nextValue) {
    ensureParentDir(userconfPath);
    fs.writeFileSync(userconfPath, JSON.stringify(nextValue, null, 2), 'utf8');
  }

  function protectForCurrentUser(value) {
    return String(value || '');
  }

  function unprotectForCurrentUser(protectedValue) {
    return String(protectedValue || '');
  }

  function getLocalUserRecord() {
    const userconf = readUserConf();
    const localUser = userconf.localUser;

    if (!localUser || !localUser.username) {
      return null;
    }

    const protectedPassword = String(localUser.passwordProtected || '').trim();
    const legacyPassword = String(localUser.password || '').trim();
    let password = '';

    if (protectedPassword) {
      try {
        password = unprotectForCurrentUser(protectedPassword);
      } catch (error) {
        password = '';
      }
    } else if (legacyPassword) {
      password = legacyPassword;
    }

    return {
      username: String(localUser.username || '').trim(),
      password,
      hasStoredCredential: Boolean(password),
      userId: localUser.userId ?? null,
      createdAt: localUser.createdAt || null,
      autoGenerated: Boolean(localUser.autoGenerated)
    };
  }

  function upsertLocalUserRecord({ username, password, autoGenerated = false, userId = null }) {
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '').trim();

    if (!normalizedUsername || !normalizedPassword) {
      throw new Error('username and password are required');
    }

    const userconf = readUserConf();
    const previous = userconf.localUser && typeof userconf.localUser === 'object' ? userconf.localUser : {};

    userconf.localUser = {
      username: normalizedUsername,
      passwordProtected: protectForCurrentUser(normalizedPassword),
      password: normalizedPassword,
      autoGenerated: Boolean(autoGenerated),
      userId: userId ?? previous.userId ?? null,
      createdAt: previous.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    writeUserConf(userconf);
    return getLocalUserRecord();
  }

  function clearLocalUserRecord() {
    const userconf = readUserConf();
    delete userconf.localUser;
    writeUserConf(userconf);
  }

  function tryUpsertLocalUserRecord(payload) {
    try {
      return upsertLocalUserRecord(payload);
    } catch (error) {
      console.warn('[dmapi-auth] Unable to persist local user record:', error.message);
      return null;
    }
  }

  return {
    readUserConf,
    writeUserConf,
    getLocalUserRecord,
    upsertLocalUserRecord,
    clearLocalUserRecord,
    tryUpsertLocalUserRecord
  };
}

function createDmapiClient({ baseUrl = DEFAULT_DMAPI_BASE_URL } = {}) {
  const rootUrl = normalizeBaseUrl(baseUrl);

  async function request(pathname, { method = 'GET', headers = {}, body } = {}) {
    const response = await fetch(`${rootUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await readResponseJson(response, pathname);
    return { response, data };
  }

  return {
    registerUser(payload) {
      return request('/api/user/register', {
        method: 'POST',
        headers: buildDmapiHeaders({ json: true }),
        body: payload
      });
    },

    loginUser(username, password) {
      return request('/api/user/login', {
        method: 'POST',
        headers: buildDmapiHeaders({ json: true }),
        body: { username, password }
      });
    },

    getUserSelf({ session = '', userId = '' } = {}) {
      return request('/api/user/self', {
        method: 'GET',
        headers: buildDmapiHeaders({ session, userId })
      });
    },

    createApiKey(payload, { session = '', userId = '' } = {}) {
      return request('/api/token/', {
        method: 'POST',
        headers: buildDmapiHeaders({ session, userId, json: true }),
        body: payload
      });
    },

    listApiKeys({ session = '', userId = '', p, pageSize } = {}) {
      const params = new URLSearchParams();
      if (p) params.append('p', p);
      if (pageSize) params.append('page_size', pageSize);
      const suffix = params.toString() ? `?${params.toString()}` : '';

      return request(`/api/token/${suffix}`, {
        method: 'GET',
        headers: buildDmapiHeaders({ session, userId })
      });
    },

    getApiKeyValue(tokenId, { session = '', userId = '' } = {}) {
      return request(`/api/token/${encodeURIComponent(tokenId)}/key`, {
        method: 'POST',
        headers: buildDmapiHeaders({ session, userId })
      });
    },

    deleteApiKey(tokenId, { session = '', userId = '' } = {}) {
      return request(`/api/token/${encodeURIComponent(tokenId)}`, {
        method: 'DELETE',
        headers: buildDmapiHeaders({ session, userId })
      });
    },

    topupUser(payload, { session = '', userId = '' } = {}) {
      return request('/api/user/topup', {
        method: 'POST',
        headers: buildDmapiHeaders({ session, userId, json: true }),
        body: payload
      });
    }
  };
}

function createDmapiAuthService(options = {}) {
  const router = express.Router();
  const client = createDmapiClient(options);
  const localUserStore = createLocalUserStore(options);

  function getRequestAuth(req) {
    const localUser = localUserStore.getLocalUserRecord();
    return {
      session: req.cookies?.session || '',
      userId: getHeaderValue(req.headers, 'new-api-user') || localUser?.userId || ''
    };
  }

  function sendLocalUser(localUser) {
    return {
      username: localUser.username,
      userId: localUser.userId,
      createdAt: localUser.createdAt,
      autoGenerated: localUser.autoGenerated,
      hasStoredCredential: localUser.hasStoredCredential
    };
  }

  router.get('/api/local-user', (req, res) => {
    const localUser = localUserStore.getLocalUserRecord();

    if (!localUser || !localUser.username || !localUser.hasStoredCredential) {
      res.json({ success: true, exists: false });
      return;
    }

    res.json({
      success: true,
      exists: true,
      data: {
        ...sendLocalUser(localUser),
        password: localUser.password
      }
    });
  });

  router.post('/api/local-user', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const autoGenerated = Boolean(req.body?.autoGenerated);
    const userId = req.body?.userId ?? null;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'username and password are required' });
      return;
    }

    const localUser = localUserStore.upsertLocalUserRecord({ username, password, autoGenerated, userId });
    res.json({ success: true, data: sendLocalUser(localUser) });
  });

  router.delete('/api/local-user', (req, res) => {
    localUserStore.clearLocalUserRecord();
    res.json({ success: true });
  });

  router.get('/api/session-status', async (req, res) => {
    try {
      const session = req.cookies?.session;
      const localUser = localUserStore.getLocalUserRecord();

      if (!session) {
        res.json({ success: true, authenticated: false });
        return;
      }

      const { response, data } = await client.getUserSelf({ session, userId: localUser?.userId });
      if (!response.ok || !data?.success) {
        res.json({ success: true, authenticated: false });
        return;
      }

      const resolvedUserId = data?.data?.id ?? localUser?.userId ?? null;
      if (localUser?.username && localUser?.password && resolvedUserId && resolvedUserId !== localUser.userId) {
        localUserStore.tryUpsertLocalUserRecord({
          username: localUser.username,
          password: localUser.password,
          autoGenerated: localUser.autoGenerated,
          userId: resolvedUserId
        });
      }

      res.json({
        success: true,
        authenticated: true,
        data: {
          username: localUser?.username || '',
          userId: resolvedUserId,
          displayName: data?.data?.display_name || '',
          quota: data?.data?.quota || 0
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, authenticated: false, message: error.message || 'session check failed' });
    }
  });

  router.post('/api/local-user/relogin', async (req, res) => {
    try {
      const localUser = localUserStore.getLocalUserRecord();
      if (!localUser || !localUser.username || !localUser.password) {
        res.status(404).json({ success: false, message: 'stored credential not found' });
        return;
      }

      const { response, data } = await client.loginUser(localUser.username, localUser.password);
      forwardSetCookies(response, res);

      if (response.ok && data?.success) {
        const resolvedUserId = resolveUserIdFromLoginData(data, localUser.userId);
        localUserStore.tryUpsertLocalUserRecord({
          username: localUser.username,
          password: localUser.password,
          autoGenerated: localUser.autoGenerated,
          userId: resolvedUserId
        });
      }

      res.status(response.status).json({
        ...data,
        username: localUser.username
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'stored relogin failed', error: error.message });
    }
  });

  router.post('/api/session/logout', (req, res) => {
    res.clearCookie('session');
    res.json({ success: true });
  });

  router.post('/api/dmapi/register', async (req, res) => {
    try {
      const { response, data } = await client.registerUser(normalizeRegisterPayload(req.body));
      forwardSetCookies(response, res);
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi register proxy failed', error: error.message });
    }
  });

  router.post('/api/dmapi/login', async (req, res) => {
    try {
      const { response, data } = await client.loginUser(req.body?.username, req.body?.password);
      forwardSetCookies(response, res);
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi login proxy failed', error: error.message });
    }
  });

  router.post('/api/dmapi/token', async (req, res) => {
    try {
      const { response, data } = await client.createApiKey(normalizeApiKeyCreatePayload(req.body), getRequestAuth(req));
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi create token proxy failed', error: error.message });
    }
  });

  router.get('/api/dmapi/token', async (req, res) => {
    try {
      const { response, data } = await client.listApiKeys({
        ...getRequestAuth(req),
        p: req.query.p,
        pageSize: req.query.page_size
      });
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi list token proxy failed', error: error.message });
    }
  });

  router.post('/api/dmapi/token/:id/key', async (req, res) => {
    try {
      const { response, data } = await client.getApiKeyValue(req.params.id, getRequestAuth(req));
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi token key proxy failed', error: error.message });
    }
  });

  router.delete('/api/dmapi/token/:id', async (req, res) => {
    try {
      const { response, data } = await client.deleteApiKey(req.params.id, getRequestAuth(req));
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi delete token proxy failed', error: error.message });
    }
  });

  router.post('/api/dmapi/user/topup', async (req, res) => {
    try {
      const { response, data } = await client.topupUser(req.body, getRequestAuth(req));
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi topup proxy failed', error: error.message });
    }
  });

  router.get('/api/dmapi/user/self', async (req, res) => {
    try {
      const { response, data } = await client.getUserSelf(getRequestAuth(req));
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: 'dmapi user self proxy failed', error: error.message });
    }
  });

  return {
    router,
    client,
    localUserStore
  };
}

module.exports = {
  createDmapiAuthService,
  createDmapiClient,
  createLocalUserStore,
  buildDmapiHeaders,
  forwardSetCookies
};
