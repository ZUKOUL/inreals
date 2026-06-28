const SESSION_KEY = 'corya:auth-session:v1';

const form = document.querySelector('[data-auth-form]');
const modeButtons = document.querySelectorAll('[data-auth-mode]');
const title = document.querySelector('[data-auth-title]');
const subtitle = document.querySelector('[data-auth-subtitle]');
const submit = document.querySelector('[data-auth-submit]');
const nameField = document.querySelector('[data-name-field]');
const error = document.querySelector('[data-auth-error]');
const note = document.querySelector('[data-auth-note]');

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
    button.classList.toggle('active', button.dataset.authMode === mode);
  });
  title.textContent = mode === 'signup' ? 'Create your workspace' : 'Welcome back';
  subtitle.textContent =
    mode === 'signup'
      ? 'Create your Corya account and open the workspace.'
      : 'Sign in to continue to your Corya workspace.';
  submit.textContent = mode === 'signup' ? 'Create account' : 'Continue';
  nameField.hidden = mode !== 'signup';
  error.textContent = '';
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => updateMode(button.dataset.authMode));
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
    submit.textContent = mode === 'signup' ? 'Create account' : 'Continue';
  }
});

if (!getSupabaseClient()) {
  note.textContent =
    'Mode démo actif : la session est enregistrée localement. On branchera Supabase dès que tu me donnes l’URL du projet et la clé anon publique.';
}

updateMode(mode);

