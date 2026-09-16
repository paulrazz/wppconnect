// App-wide session state fed by the always-on live stream socket. Cached to
// localStorage so reloads/navigations render the last known state instantly
// instead of flashing "disconnected".
const KEY = (apiKey) => `wpp.session.state.${apiKey}`;

const emptyDetails = { ready: false, info: {} };

const state = { apiKey: null, status: 'DISCONNECTED', details: { ...emptyDetails }, qr: null };
const listeners = new Set();
let version = 0;

const notify = () => {
  version += 1;
  listeners.forEach(fn => { try { fn(); } catch (_) {} });
};

// Debounced so a burst of socket status/detail updates coalesces into one
// localStorage write instead of many synchronous main-thread blocking writes.
let persistTimer = null;
const persist = () => {
  if (!state.apiKey) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // Strip the base64 profile photo (large) from what's persisted; it is
      // refetched via REST/socket on the next connect anyway. Prevents blowing
      // the ~5MB localStorage quota on long-running busy sessions.
      const info = state.details?.info ? { ...state.details.info } : {};
      delete info.profilePic;
      localStorage.setItem(KEY(state.apiKey), JSON.stringify({
        status: state.status,
        details: { ready: state.details?.ready, info },
        qr: state.qr,
        at: Date.now(),
      }));
    } catch (_) {}
  }, 200);
};

export const sessionStore = {
  hydrate(apiKey) {
    if (!apiKey) return;
    if (state.apiKey === apiKey) return;
    state.apiKey = apiKey;
    try {
      const raw = localStorage.getItem(KEY(apiKey));
      if (raw) {
        const saved = JSON.parse(raw);
        state.status = saved.status || 'DISCONNECTED';
        state.details = saved.details || { ...emptyDetails };
        state.qr = saved.qr || null;
      } else {
        state.status = 'DISCONNECTED';
        state.details = { ...emptyDetails };
        state.qr = null;
      }
    } catch (_) {
      state.status = 'DISCONNECTED';
    }
    notify();
  },
  setStatus(status) {
    if (!state.apiKey || !status || status === state.status) return;
    state.status = status;
    persist();
    notify();
  },
  setDetails(details) {
    if (!state.apiKey || !details) return;
    state.details = details;
    persist();
    notify();
  },
  setQr(qr) {
    if (!state.apiKey) return;
    if (qr === state.qr) return;
    state.qr = qr;
    persist();
    notify();
  },
  clear() {
    const key = state.apiKey;
    state.apiKey = null;
    state.status = 'DISCONNECTED';
    state.details = { ...emptyDetails };
    state.qr = null;
    if (key) { try { localStorage.removeItem(KEY(key)); } catch (_) {} }
    notify();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get version() { return version; },
  getState: () => state,
};