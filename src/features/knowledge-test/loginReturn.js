const KEY = "history-archive:knowledge-login-return";
const PATH = "/knowledge-test";
const MAX_AGE = 30 * 60 * 1000;

export function rememberKnowledgeLoginReturn() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      path: PATH,
      expiresAt: Date.now() + MAX_AGE
    }));
  } catch {
    // Login itself must still remain available.
  }
}

export function takeKnowledgeLoginReturn() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);

    const value = raw ? JSON.parse(raw) : null;

    if (
      value?.path === PATH &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt > Date.now()
    ) {
      return PATH;
    }
  } catch {
    // Ignore missing or malformed navigation state.
  }

  return null;
}