const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
const files = [
  'index.html',
  'landing.html',
  'login.html',
  'styles.css',
  'landing.css',
  'landing-overrides.css',
  'auth.css',
  'app.js',
  'auth.js',
  'auth-guard.js'
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

fs.cpSync(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });

fs.copyFileSync(path.join(dist, 'index.html'), path.join(dist, 'workspace.html'));
fs.copyFileSync(path.join(dist, 'landing.html'), path.join(dist, 'index.html'));

fs.writeFileSync(
  path.join(dist, 'auth-config.js'),
  `window.CORYA_SUPABASE = ${JSON.stringify({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  })};\n`
);

