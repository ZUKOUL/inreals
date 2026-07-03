const SESSION_KEY = 'corya:auth-session:v1';

const form = document.querySelector('[data-auth-form]');
const modeButtons = document.querySelectorAll('[data-auth-mode]');
const title = document.querySelector('[data-auth-title]');
const subtitle = document.querySelector('[data-auth-subtitle]');
const submit = document.querySelector('[data-auth-submit]');
const nameField = document.querySelector('[data-name-field]');
const error = document.querySelector('[data-auth-error]');
const note = document.querySelector('[data-auth-note]');
const providerButtons = document.querySelectorAll('[data-provider]');
const modeCopy = document.querySelector('[data-mode-copy]');
const passwordToggle = document.querySelector('.password-toggle');
const passwordInput = document.querySelector('input[name="password"]');

const params = new URLSearchParams(window.location.search);
const next = params.get('next') || '/workspace';
let mode = params.get('mode') === 'signup' ? 'signup' : 'login';

function getSupabaseClient() {
  const config = window.CORYA_SUPABASE || {};
  if (!config.url || !config.anonKey || !window.supabase) return null;
  return window.supabase.createClient(config.url, config.anonKey);
}

function saveSession(session) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      email: session.email,
      name: session.name || session.email?.split('@')[0] || 'Corya user',
      provider: session.provider || 'demo',
      createdAt: new Date().toISOString()
    })
  );
}

function updateMode(nextMode) {
  mode = nextMode;
  modeButtons.forEach((button) => {
    const isActive = button.dataset.authMode === mode;
    button.classList.toggle('active', isActive);
    if (button.classList.contains('top-mode')) {
      button.textContent = mode === 'signup' ? 'Sign in' : 'Sign up';
      button.dataset.authMode = mode === 'signup' ? 'login' : 'signup';
    }
  });
  title.textContent = mode === 'signup' ? 'Create account' : 'Welcome back';
  subtitle.textContent =
    mode === 'signup'
      ? 'Create your Corya account.'
      : 'Sign in to continue to your Corya workspace.';
  submit.innerHTML =
    mode === 'signup'
      ? '<span>Create account</span><span aria-hidden="true">→</span>'
      : '<span>Sign in</span><span aria-hidden="true">→</span>';
  nameField.hidden = mode !== 'signup';
  passwordInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  modeCopy.innerHTML =
    mode === 'signup'
      ? 'Already have an account? <button type="button" data-auth-mode="login">Sign in</button>'
      : 'New to corya? <button type="button" data-auth-mode="signup">Create an account</button>';
  modeCopy.querySelector('[data-auth-mode]')?.addEventListener('click', (event) => {
    updateMode(event.currentTarget.dataset.authMode);
  });
  error.textContent = '';
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => updateMode(button.dataset.authMode));
});

providerButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    error.textContent = '';
    const provider = button.dataset.provider;
    const supabase = getSupabaseClient();

    if (supabase) {
      const { error: providerError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}${next}` }
      });
      if (providerError) error.textContent = providerError.message;
      return;
    }

    saveSession({
      email: `${provider}@corya.local`,
      name: provider === 'google' ? 'Google user' : 'X user',
      provider
    });
    window.location.href = next;
  });
});

passwordToggle?.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  passwordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  const name = String(data.get('name') || '').trim();

  if (!email.includes('@')) {
    error.textContent = 'Ajoute une adresse email valide.';
    return;
  }

  if (password.length < 6) {
    error.textContent = 'Le mot de passe doit contenir au moins 6 caractères.';
    return;
  }

  submit.disabled = true;
  submit.textContent = mode === 'signup' ? 'Creating…' : 'Connecting…';

  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const response =
        mode === 'signup'
          ? await supabase.auth.signUp({ email, password, options: { data: { name } } })
          : await supabase.auth.signInWithPassword({ email, password });

      if (response.error) throw response.error;
      saveSession({ email, name, provider: 'supabase' });
    } else {
      saveSession({ email, name, provider: 'demo' });
    }

    window.location.href = next;
  } catch (authError) {
    error.textContent = authError?.message || 'Connexion impossible pour le moment.';
  } finally {
    submit.disabled = false;
    submit.innerHTML =
      mode === 'signup'
        ? '<span>Create account</span><span aria-hidden="true">→</span>'
        : '<span>Sign in</span><span aria-hidden="true">→</span>';
  }
});

if (!getSupabaseClient()) {
  note.textContent = '';
}

updateMode(mode);
