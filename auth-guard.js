(() => {
  const SESSION_KEY = 'corya:auth-session:v1';

  const hasSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw);
      return Boolean(session?.email && session?.createdAt);
    } catch {
      return false;
    }
  };

  if (hasSession()) return;

  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/login.html?next=${encodeURIComponent(next || '/workspace')}`);
})();

