const AUTH_KEY = 'cr_web_auth_v1';
const STATE_KEY = 'cr_web_state_v1';
const RESET_CODES_KEY = 'cr_web_reset_codes_v1';
const VERIFY_CODES_KEY = 'cr_web_verify_codes_v1';
const LEGACY_STATE_KEY = 'clientData';
const STATE_DB_NAME = 'cr_web_db';
const STATE_STORE_NAME = 'app';
const STATE_RECORD_ID = 'state';

let currentUser = null;
let currentPassword = null;
let lastAuthError = '';

const encoder = new TextEncoder();

const getJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const setJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const getAuth = () => getJson(AUTH_KEY, { users: [] });
const setAuth = (value) => setJson(AUTH_KEY, value);

function openStateDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(STATE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE_NAME)) {
        database.createObjectStore(STATE_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

async function idbGetState() {
  try {
    const database = await openStateDb();
    const result = await new Promise((resolve, reject) => {
      const tx = database.transaction(STATE_STORE_NAME, 'readonly');
      const store = tx.objectStore(STATE_STORE_NAME);
      const request = store.get(STATE_RECORD_ID);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error || new Error('Failed to read state from IndexedDB'));
    });
    database.close();
    if (result) {
      setJson(STATE_KEY, result);
      return result;
    }
  } catch (_error) {
  }

  return getJson(STATE_KEY, null);
}

async function idbSetState(value) {
  setJson(STATE_KEY, value);
  try {
    const database = await openStateDb();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(STATE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(STATE_STORE_NAME);
      const request = store.put({ id: STATE_RECORD_ID, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to write state to IndexedDB'));
    });
    database.close();
  } catch (_error) {
  }
}

async function idbDeleteState() {
  localStorage.removeItem(STATE_KEY);
  try {
    const database = await openStateDb();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(STATE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(STATE_STORE_NAME);
      const request = store.delete(STATE_RECORD_ID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to delete state from IndexedDB'));
    });
    database.close();
  } catch (_error) {
  }
}

async function sha256(value) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function migrateLegacyClientDataIfPresent() {
  const existing = await idbGetState();
  if (existing && existing.data) {
    return;
  }

  const legacy = getJson(LEGACY_STATE_KEY, null);
  if (!legacy || !legacy.data || !legacy.deletedItems) {
    return;
  }

  const migrated = {
    type: 'cr_web_state',
    version: 1,
    user: currentUser || null,
    updatedAt: new Date().toISOString(),
    data: {
      data: legacy.data,
      deletedItems: legacy.deletedItems,
      selectedClientId: legacy.selectedClientId ?? null,
      selectedAppointmentId: legacy.selectedAppointmentId ?? null,
      selectedNoteId: legacy.selectedNoteId ?? null,
      selectedIntakeId: legacy.selectedIntakeId ?? null
    }
  };

  await idbSetState(migrated);
}

function cleanupCodes(key) {
  const now = Date.now();
  const codes = getJson(key, []);
  const active = codes.filter(item => item.expiresAt > now && !item.used);
  setJson(key, active);
  return active;
}

function getUser(username) {
  const auth = getAuth();
  return auth.users.find(user => user.username === normalizeUsername(username));
}

function saveUser(updatedUser) {
  const auth = getAuth();
  const idx = auth.users.findIndex(user => user.username === updatedUser.username);
  if (idx >= 0) {
    auth.users[idx] = updatedUser;
    setAuth(auth);
  }
}

export function getLastAuthError() {
  return lastAuthError;
}

export function isDatabaseInitialized() {
  return !!currentUser;
}

export async function checkFirstLogin() {
  try {
    const auth = getAuth();
    lastAuthError = '';
    return (auth.users || []).length === 0;
  } catch (error) {
    lastAuthError = error?.message || 'Failed to read local authentication store.';
    return false;
  }
}

export async function createUser(username, password, email = '', smtpConfig = {}) {
  const normalized = normalizeUsername(username);
  if (!normalized || !password) {
    lastAuthError = 'Username and password are required.';
    return false;
  }
  if (password.length < 8) {
    lastAuthError = 'Password must be at least 8 characters.';
    return false;
  }

  const auth = getAuth();
  if (auth.users.some(user => user.username === normalized)) {
    lastAuthError = 'A user with that username already exists.';
    return false;
  }

  const passwordHash = await sha256(`${normalized}:${password}`);
  const newUser = {
    username: normalized,
    displayUsername: String(username || '').trim(),
    passwordHash,
    email: String(email || '').trim(),
    emailVerified: false,
    recoveryEnabled: !!email,
    smtp: {
      smtpHost: smtpConfig?.smtpHost || '',
      smtpPort: Number(smtpConfig?.smtpPort || 587),
      smtpSecurity: (smtpConfig?.smtpSecurity || 'starttls').toLowerCase(),
      smtpUsername: smtpConfig?.smtpUsername || '',
      smtpFrom: smtpConfig?.smtpFrom || String(email || '').trim()
    }
  };

  auth.users.push(newUser);
  setAuth(auth);

  currentUser = normalized;
  currentPassword = password;

  await requestEmailVerification(normalized);
  if (!lastAuthError) {
    lastAuthError = 'Verification code generated locally. Open browser console to read code for now.';
  }

  return true;
}

export async function loginUser(username, password) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const expected = await sha256(`${normalized}:${password}`);
  if (expected !== user.passwordHash) {
    lastAuthError = 'Invalid username or password.';
    return false;
  }

  if (!user.emailVerified) {
    lastAuthError = 'Email not verified. Use verification code flow.';
    return false;
  }

  currentUser = normalized;
  currentPassword = password;
  lastAuthError = '';
  return true;
}

export async function changePassword(currentPasswordInput, newPassword) {
  if (!currentUser) {
    lastAuthError = 'No active user.';
    return false;
  }
  if (!newPassword || newPassword.length < 8) {
    lastAuthError = 'New password must be at least 8 characters.';
    return false;
  }

  const user = getUser(currentUser);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const expected = await sha256(`${currentUser}:${currentPasswordInput}`);
  if (expected !== user.passwordHash) {
    lastAuthError = 'Current password is incorrect.';
    return false;
  }

  user.passwordHash = await sha256(`${currentUser}:${newPassword}`);
  saveUser(user);
  currentPassword = newPassword;
  lastAuthError = '';
  return true;
}

export async function requestPasswordReset(username) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const code = randomCode();
  const records = cleanupCodes(RESET_CODES_KEY);
  records.push({ username: normalized, codeHash: await sha256(`${normalized}:reset:${code}`), expiresAt: Date.now() + 10 * 60 * 1000, used: false });
  setJson(RESET_CODES_KEY, records);
  lastAuthError = `Password reset code: ${code} (web mode local code).`;
  return true;
}

export async function confirmPasswordReset(username, code, newPassword) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }
  if (!newPassword || newPassword.length < 8) {
    lastAuthError = 'New password must be at least 8 characters.';
    return false;
  }

  const records = cleanupCodes(RESET_CODES_KEY);
  const codeHash = await sha256(`${normalized}:reset:${String(code || '').trim()}`);
  const record = records.find(item => item.username === normalized && item.codeHash === codeHash && !item.used);
  if (!record) {
    lastAuthError = 'Invalid or expired reset code.';
    return false;
  }

  record.used = true;
  setJson(RESET_CODES_KEY, records);

  user.passwordHash = await sha256(`${normalized}:${newPassword}`);
  saveUser(user);
  lastAuthError = '';
  return true;
}

export async function requestEmailVerification(username) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const code = randomCode();
  const records = cleanupCodes(VERIFY_CODES_KEY);
  records.push({ username: normalized, codeHash: await sha256(`${normalized}:verify:${code}`), expiresAt: Date.now() + 10 * 60 * 1000, used: false });
  setJson(VERIFY_CODES_KEY, records);
  lastAuthError = `Verification code: ${code} (web mode local code).`;
  return true;
}

export async function confirmEmailVerification(username, code) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const records = cleanupCodes(VERIFY_CODES_KEY);
  const codeHash = await sha256(`${normalized}:verify:${String(code || '').trim()}`);
  const record = records.find(item => item.username === normalized && item.codeHash === codeHash && !item.used);
  if (!record) {
    lastAuthError = 'Invalid or expired verification code.';
    return false;
  }

  record.used = true;
  setJson(VERIFY_CODES_KEY, records);
  user.emailVerified = true;
  saveUser(user);
  lastAuthError = '';
  return true;
}

export async function updateRecoverySettings(username, password, email, smtpConfig = {}, sendVerification = false) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const expected = await sha256(`${normalized}:${password}`);
  if (expected !== user.passwordHash) {
    lastAuthError = 'Invalid password.';
    return false;
  }

  user.email = String(email || '').trim();
  user.recoveryEnabled = !!user.email;
  user.smtp = {
    smtpHost: smtpConfig?.smtpHost || '',
    smtpPort: Number(smtpConfig?.smtpPort || 587),
    smtpSecurity: (smtpConfig?.smtpSecurity || 'starttls').toLowerCase(),
    smtpUsername: smtpConfig?.smtpUsername || '',
    smtpFrom: smtpConfig?.smtpFrom || user.email
  };
  user.emailVerified = false;
  saveUser(user);

  if (sendVerification) {
    await requestEmailVerification(normalized);
  } else {
    lastAuthError = 'Recovery settings updated.';
  }
  return true;
}

export async function getRecoverySettings(username, password) {
  const normalized = normalizeUsername(username);
  const user = getUser(normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return null;
  }

  const expected = await sha256(`${normalized}:${password}`);
  if (expected !== user.passwordHash) {
    lastAuthError = 'Invalid password.';
    return null;
  }

  lastAuthError = '';
  return {
    email: user.email || '',
    smtpHost: user.smtp?.smtpHost || '',
    smtpPort: user.smtp?.smtpPort || 587,
    smtpSecurity: user.smtp?.smtpSecurity || 'starttls',
    smtpUsername: user.smtp?.smtpUsername || '',
    smtpFrom: user.smtp?.smtpFrom || user.email || ''
  };
}

export async function testSmtpSettings(username, password, email, smtpConfig = {}) {
  const settings = await getRecoverySettings(username, password);
  if (!settings) {
    return false;
  }
  if (!email || !smtpConfig?.smtpHost || !smtpConfig?.smtpUsername) {
    lastAuthError = 'SMTP fields are incomplete.';
    return false;
  }

  lastAuthError = 'SMTP test simulated in web mode (no email sent).';
  return true;
}

export async function deleteUserAccount(username, password) {
  const normalized = normalizeUsername(username);
  const auth = getAuth();
  const user = auth.users.find(item => item.username === normalized);
  if (!user) {
    lastAuthError = 'Account not found.';
    return false;
  }

  const expected = await sha256(`${normalized}:${password}`);
  if (expected !== user.passwordHash) {
    lastAuthError = 'Invalid password.';
    return false;
  }

  auth.users = auth.users.filter(item => item.username !== normalized);
  setAuth(auth);

  await idbDeleteState();
  localStorage.removeItem(RESET_CODES_KEY);
  localStorage.removeItem(VERIFY_CODES_KEY);

  if (currentUser === normalized) {
    currentUser = null;
    currentPassword = null;
  }

  lastAuthError = '';
  return true;
}

function encodePayload(payload) {
  return btoa(unescape(encodeURIComponent(payload)));
}

function decodePayload(payload) {
  return decodeURIComponent(escape(atob(payload)));
}

export async function saveState(state) {
  if (!currentUser) {
    lastAuthError = 'No authenticated user.';
    return false;
  }
  const wrapped = {
    type: 'cr_web_state',
    version: 1,
    user: currentUser,
    updatedAt: new Date().toISOString(),
    data: state
  };
  await idbSetState(wrapped);
  return true;
}

export async function loadState() {
  await migrateLegacyClientDataIfPresent();
  const wrapped = await idbGetState();
  if (!wrapped || !wrapped.data) {
    return null;
  }
  return wrapped.data;
}

export async function exportEncryptedSqlDump() {
  const wrapped = await idbGetState();
  const payload = JSON.stringify({
    type: 'cr_web_encrypted_sql',
    version: 1,
    wrapped: wrapped || null
  });

  return {
    format: 'web-encrypted-json',
    payload: encodePayload(payload)
  };
}

export async function importEncryptedSqlDump(input) {
  let parsed = input;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid encrypted payload format.');
  }
  if (typeof parsed.payload === 'string' && parsed.payload.trim().startsWith('{')) {
    try {
      parsed = JSON.parse(parsed.payload);
    } catch (_parseError) {
    }
  }
  if (parsed.payload) {
    let decoded = parsed.payload;
    try {
      decoded = decodePayload(parsed.payload);
    } catch (_decodeError) {
    }
    const wrapped = JSON.parse(decoded);
    if (!wrapped || wrapped.type !== 'cr_web_encrypted_sql') {
      throw new Error('Unsupported encrypted payload content for web mode.');
    }
    if (wrapped.wrapped) {
      await idbSetState(wrapped.wrapped);
    }
    return;
  }
  throw new Error('Missing payload field in encrypted import.');
}

export async function importSqlDump(contents) {
  let parsed = contents;
  if (typeof contents === 'string') {
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error('Expected JSON content for web SQL import.');
    }
  }

  if (parsed?.type === 'cr_web_encrypted_sql' && parsed?.payload) {
    await importEncryptedSqlDump(parsed);
    return;
  }

  if (parsed?.data && parsed?.deletedItems) {
    const state = {
      data: parsed.data,
      deletedItems: parsed.deletedItems,
      selectedClientId: parsed.selectedClientId ?? null,
      selectedAppointmentId: parsed.selectedAppointmentId ?? null,
      selectedNoteId: parsed.selectedNoteId ?? null,
      selectedIntakeId: parsed.selectedIntakeId ?? null
    };
    await saveState(state);
    return;
  }

  if (parsed?.type === 'cr_web_state' && parsed?.data) {
    await idbSetState(parsed);
    return;
  }

  if (parsed?.platforms || parsed?.signature || parsed?.url) {
    throw new Error('Updater metadata JSON was provided. Please import exported client data JSON instead.');
  }

  throw new Error('Unsupported import format for web mode.');
}
