import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
// Vercel functions run from a read-only deployment bundle. Keep their demo
// database in /tmp while retaining the project-local database for local work.
const DATA_DIR = process.env.VERCEL ? join('/tmp', 'shopway-data') : join(ROOT_DIR, 'data');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const DB_PATH = join(DATA_DIR, 'shopway.db');
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '4173', 10);
const JSON_LIMIT = 1_048_576;
const UPLOAD_LIMIT = 25 * 1_048_576;

await mkdir(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'archived')),
    category TEXT NOT NULL DEFAULT 'Digital product',
    thumbnail_url TEXT,
    asset_path TEXT,
    is_synthetic INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gamer_tag TEXT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    country TEXT NOT NULL DEFAULT 'France',
    source TEXT NOT NULL DEFAULT 'Manual',
    marketing_opt_in INTEGER NOT NULL DEFAULT 0,
    is_synthetic INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    orders_count INTEGER NOT NULL DEFAULT 0,
    total_spent_cents INTEGER NOT NULL DEFAULT 0,
    last_order_at TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    product_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('paid', 'pending', 'refunded', 'failed')),
    source TEXT NOT NULL DEFAULT 'Direct',
    country TEXT NOT NULL DEFAULT 'France',
    created_at TEXT NOT NULL,
    refunded_at TEXT,
    resend_count INTEGER NOT NULL DEFAULT 0,
    is_synthetic INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);

  CREATE TABLE IF NOT EXISTS entitlements (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
    value INTEGER NOT NULL CHECK (value > 0),
    active INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent')),
    recipients INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
    method TEXT NOT NULL DEFAULT 'Bank account',
    reference TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    paid_at TEXT,
    is_synthetic INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    preview TEXT NOT NULL,
    theme_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS store (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    logo_url TEXT,
    hero_image_url TEXT,
    theme_json TEXT NOT NULL DEFAULT '{}',
    published INTEGER NOT NULL DEFAULT 0,
    published_snapshot_json TEXT,
    published_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    currency TEXT NOT NULL DEFAULT 'EUR',
    timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
    sender_name TEXT NOT NULL DEFAULT 'Shopway',
    sender_email TEXT NOT NULL DEFAULT 'hello@example.com',
    business_name TEXT NOT NULL DEFAULT 'Shopway Store',
    support_email TEXT NOT NULL DEFAULT 'hello@example.com',
    business_address TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en',
    tax_enabled INTEGER NOT NULL DEFAULT 0,
    order_notifications INTEGER NOT NULL DEFAULT 1,
    payout_notifications INTEGER NOT NULL DEFAULT 1,
    marketing_emails INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_analytics (
    date TEXT PRIMARY KEY,
    visitors INTEGER NOT NULL,
    page_views INTEGER NOT NULL,
    add_to_carts INTEGER NOT NULL,
    checkouts INTEGER NOT NULL,
    direct_visitors INTEGER NOT NULL,
    social_visitors INTEGER NOT NULL,
    email_visitors INTEGER NOT NULL,
    search_visitors INTEGER NOT NULL,
    is_synthetic INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS demo_profiles (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    monthly_min_cents INTEGER NOT NULL CHECK (monthly_min_cents > 0),
    monthly_max_cents INTEGER NOT NULL CHECK (monthly_max_cents >= monthly_min_cents),
    price_mix_json TEXT NOT NULL,
    conversion_rate REAL NOT NULL CHECK (conversion_rate > 0 AND conversion_rate <= 100),
    add_to_cart_rate REAL NOT NULL CHECK (add_to_cart_rate > 0 AND add_to_cart_rate <= 100),
    checkout_rate REAL NOT NULL CHECK (checkout_rate > 0 AND checkout_rate <= 100),
    refund_rate REAL NOT NULL CHECK (refund_rate >= 0 AND refund_rate < 100),
    repeat_buyer_rate REAL NOT NULL CHECK (repeat_buyer_rate >= 0 AND repeat_buyer_rate < 100),
    seed INTEGER NOT NULL,
    identity_pool_size INTEGER NOT NULL CHECK (identity_pool_size >= 250000),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
`);

// Forward-only local migrations keep an existing workspace usable when the
// development schema grows. Column names and definitions are static here.
const migrations = [
  ['customers', 'source', "TEXT NOT NULL DEFAULT 'Manual'"],
  ['customers', 'marketing_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
  ['customers', 'gamer_tag', 'TEXT'],
  ['customers', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0'],
  ['products', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0'],
  ['orders', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0'],
  ['daily_analytics', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0'],
  ['payouts', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0'],
  ['store', 'hero_image_url', 'TEXT'],
  ['settings', 'business_name', "TEXT NOT NULL DEFAULT 'Shopway Store'"],
  ['settings', 'support_email', "TEXT NOT NULL DEFAULT 'hello@example.com'"],
  ['settings', 'business_address', "TEXT NOT NULL DEFAULT ''"],
  ['settings', 'language', "TEXT NOT NULL DEFAULT 'en'"],
  ['settings', 'payout_notifications', 'INTEGER NOT NULL DEFAULT 1'],
];
for (const [table, column, definition] of migrations) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_synthetic_created_at ON orders(is_synthetic, created_at);
  CREATE INDEX IF NOT EXISTS idx_customers_synthetic_last_order ON customers(is_synthetic, last_order_at);
`);

const nowIso = () => new Date().toISOString();
const euro = (cents) => Number((cents / 100).toFixed(2));
const id = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const token = () => randomBytes(24).toString('base64url');
const isoDate = (date) => date.toISOString().slice(0, 10);
const dateAtUtcNoon = (dateString) => new Date(`${dateString}T12:00:00.000Z`);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = dateAtUtcNoon(value);
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || `item-${Date.now()}`;
}

function seededRandom(seed = 20260722) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function inTransaction(callback) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = callback();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function audit(action, entityType, entityId, payload = {}) {
  db.prepare(`
    INSERT INTO audit_events (id, action, entity_type, entity_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id('evt'), action, entityType, entityId || null, JSON.stringify(payload), nowIso());
}

function refreshCustomerStats(customerId = null) {
  const condition = customerId ? 'WHERE customers.id = ?' : '';
  const statement = db.prepare(`
    UPDATE customers
    SET orders_count = COALESCE((
          SELECT COUNT(*) FROM orders
          WHERE orders.customer_id = customers.id AND orders.status = 'paid'
        ), 0),
        total_spent_cents = COALESCE((
          SELECT SUM(amount_cents) FROM orders
          WHERE orders.customer_id = customers.id AND orders.status = 'paid'
        ), 0),
        last_order_at = (
          SELECT MAX(created_at) FROM orders
          WHERE orders.customer_id = customers.id AND orders.status = 'paid'
        ),
        updated_at = ?
    ${condition}
  `);
  if (customerId) statement.run(nowIso(), customerId);
  else statement.run(nowIso());
}

function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    price: euro(row.price_cents),
    priceCents: row.price_cents,
    status: row.status,
    category: row.category,
    type: row.category,
    currency: 'EUR',
    thumbnailUrl: row.thumbnail_url,
    hasAsset: Boolean(row.asset_path),
    assetPath: row.asset_path || null,
    fileUrl: row.asset_path || null,
    sales: Number(row.sales_count || 0),
    revenue: euro(Number(row.revenue_cents || 0)),
    revenueCents: Number(row.revenue_cents || 0),
    isSynthetic: Boolean(row.is_synthetic),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    gamerTag: row.gamer_tag || null,
    email: row.email,
    country: row.country,
    source: row.source,
    marketingOptIn: Boolean(row.marketing_opt_in),
    ordersCount: row.orders_count,
    orders: row.orders_count,
    orderCount: row.orders_count,
    totalSpent: euro(row.total_spent_cents),
    totalSpentCents: row.total_spent_cents,
    lastOrderAt: row.last_order_at,
    isSynthetic: Boolean(row.is_synthetic),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    productId: row.product_id,
    customer: { name: row.customer_name, email: row.customer_email },
    productName: row.product_name,
    amount: euro(row.amount_cents),
    amountCents: row.amount_cents,
    discount: euro(row.discount_cents),
    discountCents: row.discount_cents,
    status: row.status,
    source: row.source,
    country: row.country,
    createdAt: row.created_at,
    refundedAt: row.refunded_at,
    resendCount: row.resend_count,
    isSynthetic: Boolean(row.is_synthetic),
  };
}

function serializeDiscount(row) {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.type === 'fixed' ? euro(row.value) : row.value,
    valueCents: row.type === 'fixed' ? row.value : null,
    active: Boolean(row.active),
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeStore(row) {
  const theme = safeJson(row.theme_json, {});
  return {
    id: 'store_1',
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    headline: row.tagline,
    description: row.description,
    logoUrl: row.logo_url,
    logo: row.logo_url,
    heroImage: row.hero_image_url,
    theme,
    accent: theme.accent || '#0a8dff',
    currency: 'EUR',
    published: Boolean(row.published),
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    publicUrl: `/store.html?store=${encodeURIComponent(row.slug)}`,
    url: `/store.html?store=${encodeURIComponent(row.slug)}`,
  };
}

function serializeSettings(row) {
  return {
    currency: row.currency,
    timezone: row.timezone,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    businessName: row.business_name,
    name: row.business_name,
    supportEmail: row.support_email,
    email: row.support_email,
    address: row.business_address,
    language: row.language,
    taxEnabled: Boolean(row.tax_enabled),
    orderNotifications: Boolean(row.order_notifications),
    orderEmails: Boolean(row.order_notifications),
    payoutNotifications: Boolean(row.payout_notifications),
    payoutEmails: Boolean(row.payout_notifications),
    marketingEmails: Boolean(row.marketing_emails),
    updatedAt: row.updated_at,
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildPublishedSnapshot() {
  const storeRow = db.prepare('SELECT * FROM store WHERE id = 1').get();
  const productRows = db.prepare(`
    SELECT products.*, 0 AS sales_count, 0 AS revenue_cents
    FROM products WHERE status = 'active' ORDER BY created_at DESC
  `).all();
  return {
    store: { ...serializeStore(storeRow), published: true },
    products: productRows.map(serializeProduct),
    publishedAt: nowIso(),
  };
}

const DEMO_SEED_VERSION = '2';
const DEFAULT_PRICE_MIX = Object.freeze([
  { priceCents: 900, weight: 15 },
  { priceCents: 5700, weight: 30 },
  { priceCents: 9700, weight: 25 },
  { priceCents: 11700, weight: 18 },
  { priceCents: 12700, weight: 12 },
]);
const DEFAULT_DEMO_PROFILE = Object.freeze({
  monthlyMinCents: 600_000,
  monthlyMaxCents: 1_200_000,
  priceMix: DEFAULT_PRICE_MIX,
  conversionRate: 2.83,
  addToCartRate: 9.5,
  checkoutRate: 5.56,
  refundRate: 3,
  repeatBuyerRate: 18,
  seed: 20_260_723,
  identityPoolSize: 320_000,
});
const DEMO_MONTHLY_TARGETS = Object.freeze([
  674_000, 718_000, 792_000, 846_000, 938_000, 879_000,
  961_000, 1_024_000, 987_000, 1_094_000, 1_162_000, 1_078_000,
]);
const DEMO_PRODUCT_SEEDS = Object.freeze([
  ['prd_demo_tags', '250 Tags Twitch & Kick', 'demo-tags-twitch-kick', '250 étiquettes, badges et panneaux prêts à personnaliser pour une chaîne gaming cohérente.', 900, 'Assets'],
  ['prd_demo_obs', 'OBS Neon Stream Pack', 'demo-obs-neon-stream-pack', 'Scènes OBS, alertes, overlays et transitions conçus pour lancer un stream premium.', 5700, 'Streaming'],
  ['prd_demo_discord', 'Discord Community OS', 'demo-discord-community-os', 'Le système complet pour structurer, animer et monétiser une communauté Discord.', 9700, 'Community'],
  ['prd_demo_creator', 'Gaming Creator Launch System', 'demo-gaming-creator-launch-system', 'Un plan guidé pour transformer une audience gaming en offre digitale qui convertit.', 11700, 'Course'],
  ['prd_demo_masterclass', 'Community Monetization Masterclass', 'demo-community-monetization-masterclass', 'La masterclass avancée pour construire revenus, tunnels et partenariats autour de sa communauté.', 12700, 'Masterclass'],
]);

function demoMonthlyTargets(profile, scale = 1) {
  const defaultSpan = DEFAULT_DEMO_PROFILE.monthlyMaxCents - DEFAULT_DEMO_PROFILE.monthlyMinCents;
  return DEMO_MONTHLY_TARGETS.map((target) => {
    const position = defaultSpan
      ? (target - DEFAULT_DEMO_PROFILE.monthlyMinCents) / defaultSpan
      : 0.5;
    const configured = profile.monthlyMinCents
      + Math.max(0, Math.min(1, position)) * (profile.monthlyMaxCents - profile.monthlyMinCents);
    return Math.round(configured * scale);
  });
}

function demoProductsForMix(priceMix) {
  const known = new Map(DEMO_PRODUCT_SEEDS.map((product) => [product[4], product]));
  const categories = ['Assets', 'Streaming', 'Community', 'Course', 'Masterclass'];
  return priceMix.map((item, index) => {
    if (known.has(item.priceCents)) return known.get(item.priceCents);
    const euros = euro(item.priceCents);
    return [
      `prd_demo_offer_${item.priceCents}`,
      `Creator Gaming Offer ${euros} €`,
      `demo-creator-gaming-offer-${item.priceCents}`,
      `Une offre digitale creator & gaming configurée dans le Demo Data Studio au prix de ${euros} €.`,
      item.priceCents,
      categories[index % categories.length],
    ];
  });
}

function ensureDemoProfile() {
  const stamp = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO demo_profiles (
      id, monthly_min_cents, monthly_max_cents, price_mix_json,
      conversion_rate, add_to_cart_rate, checkout_rate, refund_rate,
      repeat_buyer_rate, seed, identity_pool_size, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_DEMO_PROFILE.monthlyMinCents,
    DEFAULT_DEMO_PROFILE.monthlyMaxCents,
    JSON.stringify(DEFAULT_DEMO_PROFILE.priceMix),
    DEFAULT_DEMO_PROFILE.conversionRate,
    DEFAULT_DEMO_PROFILE.addToCartRate,
    DEFAULT_DEMO_PROFILE.checkoutRate,
    DEFAULT_DEMO_PROFILE.refundRate,
    DEFAULT_DEMO_PROFILE.repeatBuyerRate,
    DEFAULT_DEMO_PROFILE.seed,
    DEFAULT_DEMO_PROFILE.identityPoolSize,
    stamp,
  );
}

function serializeDemoProfile(row) {
  const priceMix = safeJson(row.price_mix_json, DEFAULT_PRICE_MIX).map((item) => ({
    priceCents: Number(item.priceCents),
    price: euro(Number(item.priceCents)),
    weight: Number(item.weight),
  }));
  return {
    monthlyMinCents: row.monthly_min_cents,
    monthlyMaxCents: row.monthly_max_cents,
    monthlyRevenueMin: euro(row.monthly_min_cents),
    monthlyRevenueMax: euro(row.monthly_max_cents),
    priceMix,
    prices: priceMix.map(({ price, weight }) => ({ price, weight })),
    conversionRate: row.conversion_rate,
    addToCartRate: row.add_to_cart_rate,
    checkoutRate: row.checkout_rate,
    refundRate: row.refund_rate,
    repeatBuyerRate: row.repeat_buyer_rate,
    seed: row.seed,
    identityPoolSize: row.identity_pool_size,
    identityPool: row.identity_pool_size,
    updatedAt: row.updated_at,
  };
}

function currentDemoProfile() {
  ensureDemoProfile();
  return serializeDemoProfile(db.prepare('SELECT * FROM demo_profiles WHERE id = 1').get());
}

function randomChoice(random, values) {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function weightedChoice(random, values) {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  let roll = random() * total;
  for (const value of values) {
    roll -= value.weight;
    if (roll <= 0) return value;
  }
  return values.at(-1);
}

function calendarMonthKey(date) {
  return isoDate(date).slice(0, 7);
}

function monthDays(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function groupDaysByMonth(days) {
  const groups = new Map();
  days.forEach((day) => {
    const key = calendarMonthKey(day);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  });
  return [...groups.entries()].map(([key, monthDates]) => ({ key, days: monthDates }));
}

function allocateIntegers(total, weights) {
  if (!weights.length) return [];
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0) || safeWeights.length;
  const raw = safeWeights.map((weight) => total * (weightTotal ? weight / weightTotal : 1 / safeWeights.length));
  const result = raw.map(Math.floor);
  let remainder = total - result.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remainder > 0) {
        result[index] += 1;
        remainder -= 1;
      }
    });
  return result;
}

function adjustAmountsToTarget(amounts, targetCents, allowedPrices) {
  let total = amounts.reduce((sum, amount) => sum + amount, 0);
  for (let attempt = 0; attempt < 5000 && Math.abs(targetCents - total) > 100; attempt += 1) {
    let best = null;
    const currentGap = Math.abs(targetCents - total);
    for (let index = 0; index < amounts.length; index += 1) {
      for (const price of allowedPrices) {
        if (price === amounts[index]) continue;
        const candidateTotal = total - amounts[index] + price;
        const gap = Math.abs(targetCents - candidateTotal);
        if (gap < currentGap && (!best || gap < best.gap)) best = { index, price, total: candidateTotal, gap };
      }
    }
    if (!best) break;
    amounts[best.index] = best.price;
    total = best.total;
  }
  return amounts;
}

function makeDemoIdentity(random, sequence, periodStart) {
  const firstNames = [
    'Maya', 'Rayan', 'Lina', 'Nolan', 'Yasmine', 'Maël', 'Aya', 'Eliott', 'Nora', 'Ilyes',
    'Jade', 'Sami', 'Mila', 'Naël', 'Anissa', 'Théo', 'Louna', 'Amine', 'Kiara', 'Enzo',
    'Mélissa', 'Yanis', 'Alyssa', 'Noam', 'Imane', 'Liam', 'Clara', 'Nassim', 'Eva', 'Timéo',
    'Selma', 'Kylian', 'Romane', 'Adem', 'Maëlys', 'Ismaël', 'Naya', 'Loan', 'Soraya', 'Axel',
    'Mina', 'Ilian', 'Zélie', 'Rayane', 'Alix', 'Sofiane', 'Elena', 'Tiago', 'Nawal', 'Léo',
  ];
  const lastNames = [
    'Benali', 'Lefèvre', 'Martins', 'Diallo', 'Nguyen', 'Cohen', 'Da Silva', 'Meyer', 'Fernandes', 'Bensaïd',
    'Costa', 'Lemoine', 'Khelifi', 'Renard', 'Moretti', 'Aït Ali', 'Dumont', 'Lopez', 'Sy', 'Rossi',
    'Carvalho', 'Meunier', 'Traoré', 'Schmitt', 'Pereira', 'Le Goff', 'Boukari', 'Haddad', 'Roy', 'Colin',
    'Fontaine', 'Mercier', 'Lacroix', 'Bailly', 'Gomes', 'Mendes', 'Marchand', 'Carlier', 'Hoarau', 'El Amrani',
    'Klein', 'Barbier', 'Leclercq', 'Pasquier', 'Ribeiro', 'Aubry', 'Dias', 'Moulin', 'Prevost', 'Navarro',
    'Santos', 'Faure', 'Blanchard', 'Guérin', 'Adam', 'Renaud', 'Vidal', 'Masson', 'Rodrigues', 'Pires',
  ];
  const handleStarts = [
    'Nyx', 'Kairo', 'Vex', 'Lynx', 'Nova', 'Ghost', 'Pixel', 'Rift', 'Echo', 'Onyx',
    'Astra', 'Frost', 'Ember', 'Neko', 'Raven', 'Zen', 'Volt', 'Crimson', 'Lunar', 'Drift',
    'Mochi', 'Sora', 'Kitsune', 'Nox', 'Orion', 'Viral', 'Jinx', 'Blaze', 'Mira', 'Kyro',
  ];
  const handleEnds = [
    'ra', 'Zen', 'FPS', 'Wave', 'Byte', 'Rush', 'Quest', 'Core', 'Live', 'GG',
    'Pulse', 'Arc', 'Mode', 'Shot', 'Spark', 'Prime', 'Shift', 'Dream', 'Play', 'Realm',
    'Vibe', 'Storm', 'Clutch', 'Craft', 'Bloom', 'Dash', 'Flux', 'Keen', 'Hive', 'Loop',
  ];
  const first = firstNames[sequence % firstNames.length];
  const last = lastNames[(sequence * 17 + Math.floor(sequence / firstNames.length)) % lastNames.length];
  const handleVariant = Math.floor(sequence / (handleStarts.length * handleEnds.length));
  const handle = `${handleStarts[sequence % handleStarts.length]}${handleEnds[Math.floor(sequence / handleStarts.length) % handleEnds.length]}${handleVariant ? handleVariant.toString(36).toUpperCase() : ''}`;
  const domains = ['gmail.com', 'outlook.fr', 'icloud.com', 'proton.me', 'hotmail.fr', 'yahoo.fr', 'gmx.fr', 'laposte.net'];
  const separators = ['.', '_', ''];
  const separator = separators[sequence % separators.length];
  const local = `${slugify(handle)}${separator}${slugify(first)}${(sequence + 37).toString(36)}`;
  // A generated customer must exist before every generated purchase. The
  // exact first-order timestamp is assigned later, so the period start is the
  // safe deterministic acquisition boundary.
  const created = `${isoDate(periodStart)}T00:00:00.000Z`;
  return {
    id: `cus_demo_${String(sequence + 1).padStart(6, '0')}`,
    name: `${first} “${handle}” ${last}`,
    gamerTag: handle,
    email: `${local}@${domains[(sequence * 11 + 3) % domains.length]}`,
    country: randomChoice(random, ['France', 'France', 'France', 'Belgique', 'Suisse', 'Canada', 'Luxembourg', 'Maroc']),
    source: randomChoice(random, ['TikTok', 'Instagram', 'YouTube', 'Twitch', 'Discord', 'Google', 'Email', 'Direct', 'Affiliate']),
    created,
  };
}

function ensureDemoSupportingRows(seedNow) {
  const stamp = nowIso();
  const theme = JSON.stringify({
    template: 'minimal',
    background: '#ffffff',
    text: '#292929',
    accent: '#0a8dff',
    radius: 18,
    font: 'SF Pro Display',
  });
  db.prepare(`
    INSERT OR IGNORE INTO store (id, name, slug, tagline, description, theme_json, published, updated_at)
    VALUES (1, 'Studio Nova', 'studio-nova', 'Passez de joueur à créateur rentable.',
            'Ressources premium pour streamers, créateurs gaming et communautés en ligne.', ?, 1, ?)
  `).run(theme, stamp);
  db.prepare(`
    INSERT OR IGNORE INTO settings (
      id, currency, timezone, sender_name, sender_email, business_name,
      support_email, business_address, language, tax_enabled,
      order_notifications, payout_notifications, marketing_emails, updated_at
    ) VALUES (
      1, 'EUR', 'Europe/Paris', 'Studio Nova', 'hello@studionova.gg',
      'Studio Nova', 'support@studionova.gg', '12 rue de la Création, 75011 Paris',
      'fr', 0, 1, 1, 1, ?
    )
  `).run(stamp);
  db.prepare(`
    UPDATE settings
    SET sender_email = CASE WHEN sender_email = 'hello@studio-nova.example' THEN 'hello@studionova.gg' ELSE sender_email END,
        support_email = CASE WHEN support_email = 'support@studio-nova.example' THEN 'support@studionova.gg' ELSE support_email END,
        updated_at = ?
    WHERE id = 1
  `).run(stamp);

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO templates (id, name, category, description, preview, theme_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  [
    ['tpl_minimal', 'Minimal', 'Creator', 'Une boutique épurée qui met vos produits au premier plan.', 'minimal', { background: '#ffffff', text: '#292929', accent: '#0a8dff', radius: 18, font: 'SF Pro Display' }],
    ['tpl_midnight', 'Midnight', 'Gaming', 'Un univers sombre et premium pour les offres gaming.', 'midnight', { background: '#111111', text: '#f7f7f7', accent: '#7b61ff', radius: 16, font: 'SF Pro Display' }],
    ['tpl_warm', 'Warm Studio', 'Personal brand', 'Une direction chaleureuse et éditoriale pour raconter votre histoire.', 'warm', { background: '#fbf7f1', text: '#2f2925', accent: '#e96b43', radius: 24, font: 'SF Pro Display' }],
    ['tpl_bold', 'Bold Launch', 'Launch', 'Une page énergique, conçue pour les lancements et promotions.', 'bold', { background: '#f6fbff', text: '#101828', accent: '#006eff', radius: 12, font: 'SF Pro Display' }],
  ].forEach(([templateId, name, category, description, preview, templateTheme]) => {
    insertTemplate.run(templateId, name, category, description, preview, JSON.stringify(templateTheme));
  });

  const insertDiscount = db.prepare(`
    INSERT OR IGNORE INTO discounts (id, code, type, value, active, uses, max_uses, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDiscount.run('dsc_welcome', 'WELCOME10', 'percent', 10, 1, 23, 200, addDays(seedNow, 180).toISOString(), stamp, stamp);
  insertDiscount.run('dsc_creator', 'CREATOR20', 'percent', 20, 1, 11, 50, addDays(seedNow, 45).toISOString(), stamp, stamp);

  const insertCampaign = db.prepare(`
    INSERT OR IGNORE INTO campaigns (id, name, subject, audience, status, recipients, scheduled_at, sent_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCampaign.run('cmp_summer', 'Creator summer drop', 'Le pack qui transforme votre prochain lancement', 'all', 'sent', 1137, null, addDays(seedNow, -12).toISOString(), addDays(seedNow, -15).toISOString(), stamp);
  insertCampaign.run('cmp_discord', 'Discord OS launch', 'Votre communauté, enfin structurée et rentable', 'customers', 'draft', 0, null, null, stamp, stamp);

  const insertIntegration = db.prepare(`
    INSERT OR IGNORE INTO integrations (id, name, provider, description, status, config_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  [
    ['int_stripe', 'Stripe', 'stripe', 'Paiements et remboursements sécurisés.', 'connected', { account: 'acct_demo' }],
    ['int_mailchimp', 'Mailchimp', 'mailchimp', 'Synchronisez clients et campagnes email.', 'disconnected', {}],
    ['int_zapier', 'Zapier', 'zapier', 'Automatisez vos outils sans code.', 'disconnected', {}],
    ['int_meta', 'Meta Pixel', 'meta', 'Mesurez les conversions de vos campagnes Meta.', 'connected', { pixelId: 'demo-pixel' }],
    ['int_analytics', 'Google Analytics', 'google', 'Comprenez le parcours de vos visiteurs.', 'connected', { measurementId: 'G-DEMO' }],
    ['int_convertkit', 'ConvertKit', 'convertkit', 'Développez et segmentez votre audience.', 'disconnected', {}],
  ].forEach((integration) => insertIntegration.run(...integration.slice(0, 5), JSON.stringify(integration[5]), stamp));
}

function markLegacySeedRows() {
  db.prepare(`
    UPDATE products SET is_synthetic = 1
    WHERE id IN ('prd_creator_kit','prd_notion_os','prd_social_pack','prd_launch_blueprint','prd_email_vault','prd_pricing','prd_contracts','prd_hooks')
  `).run();
  db.prepare("UPDATE customers SET is_synthetic = 1 WHERE id LIKE 'cus_seed_%' OR source = 'Seed'").run();
  db.prepare("UPDATE orders SET is_synthetic = 1 WHERE id LIKE 'ord_seed_%'").run();
  db.prepare('UPDATE daily_analytics SET is_synthetic = 1').run();
  db.prepare("UPDATE payouts SET is_synthetic = 1 WHERE id IN ('pay_001','pay_002','pay_003')").run();
}

function clearSyntheticDemoData() {
  db.prepare('DELETE FROM orders WHERE is_synthetic = 1').run();
  db.prepare('DELETE FROM customers WHERE is_synthetic = 1').run();
  db.prepare('DELETE FROM products WHERE is_synthetic = 1').run();
  db.prepare('DELETE FROM daily_analytics WHERE is_synthetic = 1').run();
  db.prepare('DELETE FROM payouts WHERE is_synthetic = 1').run();
}

function regenerateDemoData(profile, { migrateLegacy = false } = {}) {
  const random = seededRandom(profile.seed);
  const today = dateAtUtcNoon(isoDate(new Date()));
  const currentStart = addDays(today, -364);
  const previousStart = addDays(today, -729);
  const allowedPrices = profile.priceMix.map((item) => item.priceCents);
  const demoProducts = demoProductsForMix(profile.priceMix);
  const productByPrice = new Map(demoProducts.map((product) => [product[4], product]));
  const paidByDate = new Map();
  const orderSpecs = [];
  let customerSequence = 0;
  let orderSequence = 1;

  inTransaction(() => {
    if (migrateLegacy) markLegacySeedRows();
    clearSyntheticDemoData();
    ensureDemoSupportingRows(today);

    const stamp = nowIso();
    const insertProduct = db.prepare(`
      INSERT INTO products (
        id, name, slug, description, price_cents, status, category,
        is_synthetic, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, 1, ?, ?)
    `);
    demoProducts.forEach((product, index) => {
      const created = addDays(today, -690 + index * 17).toISOString();
      insertProduct.run(...product, created, created);
    });

    const insertCustomer = db.prepare(`
      INSERT INTO customers (
        id, name, gamer_tag, email, country, source, marketing_opt_in,
        is_synthetic, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `);
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, product_id, customer_name, customer_email,
        product_name, amount_cents, discount_cents, status, source, country,
        created_at, refunded_at, is_synthetic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1)
    `);
    const insertEntitlement = db.prepare(`
      INSERT INTO entitlements (id, order_id, product_id, email, token, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const periods = [
      { start: previousStart, end: addDays(currentStart, -1), targetScale: 0.79, label: 'previous' },
      { start: currentStart, end: today, targetScale: 1, label: 'current' },
    ];

    for (const period of periods) {
      const days = [];
      for (let day = period.start; day <= period.end; day = addDays(day, 1)) days.push(day);
      const monthGroups = groupDaysByMonth(days);
      const configuredTargets = demoMonthlyTargets(profile, period.targetScale);
      const targetWeights = monthGroups.map((month, index) => {
        const nominal = configuredTargets[index % configuredTargets.length];
        return nominal * (month.days.length / monthDays(month.key));
      });
      const totalWeight = profile.priceMix.reduce((sum, item) => sum + item.weight, 0);
      const weightedAverageCents = profile.priceMix.reduce(
        (sum, item) => sum + item.priceCents * item.weight,
        0,
      ) / totalWeight;
      const paidGoal = Math.max(1, Math.round(
        targetWeights.reduce((sum, target) => sum + target, 0) / weightedAverageCents,
      ));
      const uniqueGoal = Math.max(1, Math.min(
        paidGoal,
        Math.round(paidGoal * (1 - profile.repeatBuyerRate / 100)),
      ));
      const paidCounts = allocateIntegers(paidGoal, targetWeights);
      const customers = [];
      for (let index = 0; index < uniqueGoal; index += 1) {
        const customer = makeDemoIdentity(random, customerSequence, period.start);
        customerSequence += 1;
        customers.push(customer);
        insertCustomer.run(
          customer.id,
          customer.name,
          customer.gamerTag,
          customer.email,
          customer.country,
          customer.source,
          customer.created,
          customer.created,
        );
      }

      const paidSpecs = [];
      monthGroups.forEach((month, monthIndex) => {
        const count = paidCounts[monthIndex];
        const targetCents = Math.round(targetWeights[monthIndex]);
        const amounts = Array.from({ length: count }, () => weightedChoice(random, profile.priceMix).priceCents);
        adjustAmountsToTarget(amounts, targetCents, allowedPrices);
        amounts.forEach((amountCents) => {
          const day = randomChoice(random, month.days);
          paidSpecs.push({ status: 'paid', amountCents, day });
        });
      });

      for (let index = paidSpecs.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [paidSpecs[index], paidSpecs[swap]] = [paidSpecs[swap], paidSpecs[index]];
      }
      paidSpecs.forEach((spec, index) => {
        spec.customer = index < customers.length ? customers[index] : randomChoice(random, customers);
      });

      const refundCount = Math.round(paidGoal * (profile.refundRate / Math.max(1, 100 - profile.refundRate)));
      const refundedSpecs = Array.from({ length: refundCount }, () => ({
        status: 'refunded',
        amountCents: weightedChoice(random, profile.priceMix).priceCents,
        day: randomChoice(random, days),
        customer: randomChoice(random, customers),
      }));
      orderSpecs.push(...paidSpecs, ...refundedSpecs);
    }

    orderSpecs.sort((a, b) => a.day - b.day || a.status.localeCompare(b.status));
    for (const spec of orderSpecs) {
      const product = productByPrice.get(spec.amountCents) || demoProducts[0];
      const customer = spec.customer;
      const created = new Date(Date.UTC(
        spec.day.getUTCFullYear(),
        spec.day.getUTCMonth(),
        spec.day.getUTCDate(),
        7 + Math.floor(random() * 15),
        Math.floor(random() * 60),
        Math.floor(random() * 60),
      )).toISOString();
      const orderId = `ord_demo_${String(orderSequence).padStart(7, '0')}`;
      const orderNumber = `SW-${String(20_000 + orderSequence).padStart(7, '0')}`;
      const refundedAt = spec.status === 'refunded'
        ? new Date(new Date(created).getTime() + (1 + Math.floor(random() * 5)) * 86_400_000).toISOString()
        : null;
      insertOrder.run(
        orderId,
        orderNumber,
        customer.id,
        product[0],
        customer.name,
        customer.email,
        product[1],
        spec.amountCents,
        spec.status,
        customer.source,
        customer.country,
        created,
        refundedAt,
      );
      if (spec.status === 'paid') {
        const key = isoDate(spec.day);
        paidByDate.set(key, (paidByDate.get(key) || 0) + 1);
        insertEntitlement.run(`ent_demo_${orderSequence}`, orderId, product[0], customer.email, `download_demo_${profile.seed}_${orderSequence}`, created);
      }
      orderSequence += 1;
    }

    const insertDaily = db.prepare(`
      INSERT INTO daily_analytics (
        date, visitors, page_views, add_to_carts, checkouts,
        direct_visitors, social_visitors, email_visitors, search_visitors,
        is_synthetic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(date) DO NOTHING
    `);
    const allDays = [];
    for (let day = previousStart; day <= today; day = addDays(day, 1)) allDays.push(day);
    const trafficMonths = groupDaysByMonth(allDays);
    for (const month of trafficMonths) {
      const paidCounts = month.days.map((day) => paidByDate.get(isoDate(day)) || 0);
      const monthlyPaid = paidCounts.reduce((sum, count) => sum + count, 0);
      const monthlyVisitors = Math.max(month.days.length * 20, Math.round(monthlyPaid / (profile.conversionRate / 100)));
      const weights = month.days.map((day) => {
        const weekday = day.getUTCDay();
        const weekdayWeight = weekday === 0 ? 0.72 : weekday === 6 ? 0.84 : 1.08;
        return weekdayWeight * (0.84 + random() * 0.34);
      });
      const visitorsByDay = allocateIntegers(monthlyVisitors, weights);
      month.days.forEach((day, index) => {
        const purchases = paidCounts[index];
        let visitors = Math.max(visitorsByDay[index], Math.ceil(purchases / (profile.checkoutRate / 100)), purchases);
        let checkouts = Math.max(purchases, Math.round(visitors * profile.checkoutRate / 100));
        let carts = Math.max(checkouts, Math.round(visitors * profile.addToCartRate / 100));
        let productViews = Math.max(carts, Math.round(visitors * (0.56 + random() * 0.08)));
        productViews = Math.min(visitors, productViews);
        carts = Math.min(productViews, carts);
        checkouts = Math.min(carts, checkouts);
        const social = Math.round(visitors * (0.39 + random() * 0.04));
        const direct = Math.round(visitors * (0.24 + random() * 0.04));
        const email = Math.round(visitors * (0.13 + random() * 0.03));
        const search = Math.max(0, visitors - social - direct - email);
        insertDaily.run(isoDate(day), visitors, productViews, carts, checkouts, direct, social, email, search);
      });
    }

    refreshCustomerStats();

    const insertPayout = db.prepare(`
      INSERT INTO payouts (
        id, amount_cents, status, method, reference, requested_at, paid_at, is_synthetic
      ) VALUES (?, ?, ?, 'Bank account •••• 4281', ?, ?, ?, 1)
    `);
    const revenueMonths = db.prepare(`
      SELECT substr(created_at, 1, 7) AS month, SUM(amount_cents) AS revenue_cents
      FROM orders
      WHERE is_synthetic = 1 AND status = 'paid'
      GROUP BY substr(created_at, 1, 7)
      ORDER BY month
    `).all();
    revenueMonths.forEach((row, index) => {
      const isCurrentMonth = row.month === calendarMonthKey(today);
      const amountCents = Math.max(1, Math.round(row.revenue_cents * (isCurrentMonth ? 0.72 : 0.965)));
      const [year, month] = row.month.split('-').map(Number);
      const requestedDate = isCurrentMonth
        ? addDays(today, -2)
        : new Date(Date.UTC(year, month, 3, 10, 0, 0));
      const paidAt = isCurrentMonth ? null : addDays(requestedDate, 2).toISOString();
      insertPayout.run(
        `pay_demo_${String(index + 1).padStart(3, '0')}`,
        amountCents,
        isCurrentMonth ? 'processing' : 'paid',
        `PAYOUT-${row.month}`,
        requestedDate.toISOString(),
        paidAt,
      );
    });

    const snapshot = buildPublishedSnapshot();
    db.prepare(`
      UPDATE store
      SET published = 1, published_snapshot_json = ?, published_at = ?, updated_at = ?
      WHERE id = 1
    `).run(JSON.stringify(snapshot), snapshot.publishedAt, stamp);
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('seed_version', ?)").run(DEMO_SEED_VERSION);
    audit('demo.regenerated', 'demo_profile', '1', {
      seed: profile.seed,
      syntheticCustomers: customerSequence,
      syntheticOrders: orderSpecs.length,
    });
  });
}

function seedDatabase() {
  ensureDemoProfile();
  const seeded = db.prepare("SELECT value FROM metadata WHERE key = 'seed_version'").get();
  if (seeded?.value === DEMO_SEED_VERSION) return;
  regenerateDemoData(currentDemoProfile(), { migrateLegacy: seeded?.value === '1' });
}

seedDatabase();

class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function sendError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { message: error.message, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    return;
  }
  if (String(error?.message || '').includes('UNIQUE constraint failed')) {
    sendJson(res, 409, { message: 'Une ressource avec cette valeur existe déjà.', error: { code: 'CONFLICT', message: 'Une ressource avec cette valeur existe déjà.' } });
    return;
  }
  console.error(error);
  sendJson(res, 500, { message: 'Une erreur interne est survenue.', error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } });
}

function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  const message = `Méthode autorisée : ${methods.join(', ')}.`;
  sendJson(res, 405, { message, error: { code: 'METHOD_NOT_ALLOWED', message } });
  return false;
}

async function readBuffer(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Le contenu dépasse la limite de ${Math.round(limit / 1_048_576)} Mo.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Le corps doit être envoyé en application/json.');
  const buffer = await readBuffer(req, JSON_LIMIT);
  if (!buffer.length) throw new HttpError(400, 'EMPTY_BODY', 'Le corps JSON est requis.');
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('object expected');
    return parsed;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Le corps JSON est invalide.');
  }
}

function requireString(value, field, { min = 1, max = 200, optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return undefined;
  if (typeof value !== 'string') throw new HttpError(422, 'VALIDATION_ERROR', `${field} doit être un texte.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new HttpError(422, 'VALIDATION_ERROR', `${field} doit contenir entre ${min} et ${max} caractères.`);
  return normalized;
}

function requireEmail(value, field = 'email') {
  const email = requireString(value, field, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'VALIDATION_ERROR', `${field} est invalide.`);
  return email;
}

function integer(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(422, 'VALIDATION_ERROR', `${field} doit être un entier compris entre ${min} et ${max}.`);
  return value;
}

function boolean(value, field, optional = false) {
  if ((value === undefined || value === null) && optional) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(422, 'VALIDATION_ERROR', `${field} doit être un booléen.`);
  return value;
}

function parseIsoTimestamp(value, field, optional = true) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new HttpError(422, 'VALIDATION_ERROR', `${field} doit être une date ISO valide.`);
  return new Date(value).toISOString();
}

function parsePriceCents(body, required = true) {
  if (body.priceCents !== undefined) return integer(body.priceCents, 'priceCents', { min: 0, max: 100_000_000 });
  if (body.price !== undefined) {
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 1_000_000) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'price doit être un montant positif en euros.');
    }
    return Math.round(body.price * 100);
  }
  if (!required) return undefined;
  throw new HttpError(422, 'VALIDATION_ERROR', 'price ou priceCents est requis.');
}

function demoRate(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${field} doit être un pourcentage compris entre 0 et 100.`);
  }
  return Number(value.toFixed(4));
}

function demoMoneyCents(body, centsField, eurosField, fallback) {
  if (body[centsField] !== undefined) {
    return integer(body[centsField], centsField, { min: 100, max: 100_000_000 });
  }
  if (body[eurosField] !== undefined) {
    const value = body[eurosField];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000) {
      throw new HttpError(422, 'VALIDATION_ERROR', `${eurosField} doit être un montant positif en euros.`);
    }
    return Math.round(value * 100);
  }
  return fallback;
}

function parseDemoPriceMix(body, fallback) {
  const submitted = body.priceMix ?? body.prices;
  if (submitted === undefined) return fallback.map(({ priceCents, weight }) => ({ priceCents, weight }));
  if (!Array.isArray(submitted) || submitted.length < 1 || submitted.length > 12) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'priceMix/prices doit contenir entre 1 et 12 prix.');
  }
  const parsed = submitted.map((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') {
      throw new HttpError(422, 'VALIDATION_ERROR', `Le prix ${index + 1} est invalide.`);
    }
    let priceCents;
    if (item.priceCents !== undefined) {
      priceCents = integer(item.priceCents, `priceMix[${index}].priceCents`, { min: 100, max: 10_000_000 });
    } else if (typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 1 && item.price <= 100_000) {
      priceCents = Math.round(item.price * 100);
    } else {
      throw new HttpError(422, 'VALIDATION_ERROR', `Le prix ${index + 1} doit fournir priceCents ou price.`);
    }
    const weight = item.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 100) {
      throw new HttpError(422, 'VALIDATION_ERROR', `Le poids du prix ${index + 1} doit être compris entre 0 et 100.`);
    }
    return { priceCents, weight: Number(weight.toFixed(4)) };
  });
  if (new Set(parsed.map((item) => item.priceCents)).size !== parsed.length) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Chaque prix du mix doit être unique.');
  }
  const totalWeight = parsed.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.01) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'La somme des poids du mix doit être égale à 100.');
  }
  return parsed;
}

function updateDemoProfile(body) {
  const current = currentDemoProfile();
  const monthlyMinCents = demoMoneyCents(body, 'monthlyMinCents', 'monthlyRevenueMin', current.monthlyMinCents);
  const monthlyMaxCents = demoMoneyCents(body, 'monthlyMaxCents', 'monthlyRevenueMax', current.monthlyMaxCents);
  if (monthlyMaxCents < monthlyMinCents) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Le revenu mensuel maximum doit être supérieur ou égal au minimum.');
  }
  const priceMix = parseDemoPriceMix(body, current.priceMix);
  const conversionRate = demoRate(body.conversionRate, 'conversionRate', current.conversionRate);
  const addToCartRate = demoRate(body.addToCartRate, 'addToCartRate', current.addToCartRate);
  const checkoutRate = demoRate(body.checkoutRate, 'checkoutRate', current.checkoutRate);
  const refundRate = demoRate(body.refundRate, 'refundRate', current.refundRate);
  const repeatBuyerRate = demoRate(body.repeatBuyerRate ?? body.repeatRate, 'repeatBuyerRate', current.repeatBuyerRate);
  if (conversionRate <= 0 || checkoutRate <= 0 || addToCartRate <= 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Les taux de conversion, checkout et ajout au panier doivent être supérieurs à zéro.');
  }
  if (!(conversionRate <= checkoutRate && checkoutRate <= addToCartRate)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Les taux doivent respecter conversion ≤ checkout ≤ ajout au panier.');
  }
  if (refundRate >= 50) throw new HttpError(422, 'VALIDATION_ERROR', 'refundRate doit être inférieur à 50%.');
  if (repeatBuyerRate >= 90) throw new HttpError(422, 'VALIDATION_ERROR', 'repeatBuyerRate doit être inférieur à 90%.');
  const seed = body.seed === undefined
    ? current.seed
    : integer(body.seed, 'seed', { min: 1, max: 2_147_483_647 });
  const submittedPool = body.identityPoolSize ?? body.identityPool;
  const identityPoolSize = submittedPool === undefined
    ? current.identityPoolSize
    : integer(submittedPool, 'identityPoolSize', { min: 250_000, max: 100_000_000 });
  const stamp = nowIso();
  db.prepare(`
    UPDATE demo_profiles
    SET monthly_min_cents = ?, monthly_max_cents = ?, price_mix_json = ?,
        conversion_rate = ?, add_to_cart_rate = ?, checkout_rate = ?,
        refund_rate = ?, repeat_buyer_rate = ?, seed = ?,
        identity_pool_size = ?, updated_at = ?
    WHERE id = 1
  `).run(
    monthlyMinCents,
    monthlyMaxCents,
    JSON.stringify(priceMix),
    conversionRate,
    addToCartRate,
    checkoutRate,
    refundRate,
    repeatBuyerRate,
    seed,
    identityPoolSize,
    stamp,
  );
  audit('demo.profile_updated', 'demo_profile', '1', { fields: Object.keys(body) });
  return currentDemoProfile();
}

function parseRange(url) {
  const key = url.searchParams.get('range') || '30';
  if (!['24h', '7', '30', '90', '365', 'custom'].includes(key)) {
    throw new HttpError(422, 'INVALID_RANGE', 'range doit valoir 24h, 7, 30, 90, 365 ou custom.');
  }
  const latestDate = db.prepare(`
    SELECT MAX(day) AS latest FROM (
      SELECT MAX(date) AS day FROM daily_analytics
      UNION ALL
      SELECT MAX(substr(created_at, 1, 10)) AS day FROM orders
    )
  `).get()?.latest || isoDate(new Date());
  const today = dateAtUtcNoon(latestDate);
  let start;
  let end = today;
  if (key === 'custom') {
    const startText = url.searchParams.get('start');
    const endText = url.searchParams.get('end');
    if (!isValidIsoDate(startText) || !isValidIsoDate(endText)) {
      throw new HttpError(422, 'INVALID_RANGE', 'start et end sont requis au format YYYY-MM-DD pour une période personnalisée.');
    }
    start = dateAtUtcNoon(startText);
    end = dateAtUtcNoon(endText);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new HttpError(422, 'INVALID_RANGE', 'La période personnalisée est invalide.');
    const numberOfDays = Math.floor((end - start) / 86_400_000) + 1;
    if (numberOfDays > 366) throw new HttpError(422, 'INVALID_RANGE', 'La période ne peut pas dépasser 366 jours.');
  } else if (key === '24h') {
    start = today;
  } else {
    start = addDays(end, -(Number(key) - 1));
  }
  const days = Math.floor((end - start) / 86_400_000) + 1;
  return {
    key,
    start: isoDate(start),
    end: isoDate(end),
    days,
    label: key === '24h' ? 'Dernières 24 heures' : key === 'custom' ? `${isoDate(start)} → ${isoDate(end)}` : `${key} derniers jours`,
  };
}

function dateBounds(range) {
  return [`${range.start}T00:00:00.000Z`, `${range.end}T23:59:59.999Z`];
}

function percentageChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function chartBucket(range) {
  if (range.days <= 30) {
    return {
      granularity: 'day',
      analyticsExpression: 'date',
      ordersExpression: "substr(created_at, 1, 10)",
    };
  }
  if (range.days <= 120) {
    return {
      granularity: 'week',
      analyticsExpression: "date(date, '-' || ((CAST(strftime('%w', date) AS INTEGER) + 6) % 7) || ' days')",
      ordersExpression: "date(substr(created_at, 1, 10), '-' || ((CAST(strftime('%w', substr(created_at, 1, 10)) AS INTEGER) + 6) % 7) || ' days')",
    };
  }
  return {
    granularity: 'month',
    analyticsExpression: "substr(date, 1, 7) || '-01'",
    ordersExpression: "substr(created_at, 1, 7) || '-01'",
  };
}

function chartLabel(date, granularity) {
  const parsed = dateAtUtcNoon(date);
  if (granularity === 'month') {
    return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
  }
  const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(parsed);
  return granularity === 'week' ? `Sem. du ${day}` : day;
}

function dashboardData(range) {
  const [start, end] = dateBounds(range);
  const previousEndDate = addDays(dateAtUtcNoon(range.start), -1);
  const previousStartDate = addDays(previousEndDate, -(range.days - 1));
  const previousStart = `${isoDate(previousStartDate)}T00:00:00.000Z`;
  const previousEnd = `${isoDate(previousEndDate)}T23:59:59.999Z`;
  const summaryQuery = `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS revenue_cents,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS orders_count,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded_count,
      COUNT(DISTINCT CASE WHEN status = 'paid' THEN customer_id END) AS customers_count
    FROM orders WHERE created_at BETWEEN ? AND ?
  `;
  const current = db.prepare(summaryQuery).get(start, end);
  const previous = db.prepare(summaryQuery).get(previousStart, previousEnd);
  const traffic = db.prepare(`
    SELECT COALESCE(SUM(visitors), 0) AS visitors FROM daily_analytics WHERE date BETWEEN ? AND ?
  `).get(range.start, range.end);
  const previousTraffic = db.prepare(`
    SELECT COALESCE(SUM(visitors), 0) AS visitors FROM daily_analytics WHERE date BETWEEN ? AND ?
  `).get(isoDate(previousStartDate), isoDate(previousEndDate));
  const averageCents = current.orders_count ? Math.round(current.revenue_cents / current.orders_count) : 0;
  const previousAverage = previous.orders_count ? Math.round(previous.revenue_cents / previous.orders_count) : 0;
  const conversion = traffic.visitors ? (current.orders_count / traffic.visitors) * 100 : 0;
  const previousConversion = previousTraffic.visitors ? (previous.orders_count / previousTraffic.visitors) * 100 : 0;
  const refundRate = current.orders_count + current.refunded_count
    ? current.refunded_count / (current.orders_count + current.refunded_count) * 100
    : 0;
  const previousRefundRate = previous.orders_count + previous.refunded_count
    ? previous.refunded_count / (previous.orders_count + previous.refunded_count) * 100
    : 0;
  const repeatQuery = `
    SELECT COUNT(*) AS count FROM (
      SELECT customer_id
      FROM orders
      WHERE status = 'paid' AND customer_id IS NOT NULL AND created_at BETWEEN ? AND ?
      GROUP BY customer_id
      HAVING COUNT(*) > 1
    )
  `;
  const repeatCustomers = db.prepare(repeatQuery).get(start, end).count;
  const previousRepeatCustomers = db.prepare(repeatQuery).get(previousStart, previousEnd).count;

  const bucket = chartBucket(range);
  const chartRows = db.prepare(`
    WITH traffic_by_bucket AS (
      SELECT ${bucket.analyticsExpression} AS bucket,
             COALESCE(SUM(visitors), 0) AS visitors
      FROM daily_analytics
      WHERE date BETWEEN ? AND ?
      GROUP BY bucket
    ),
    sales_by_bucket AS (
      SELECT ${bucket.ordersExpression} AS bucket,
             COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS revenue_cents,
             COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS orders_count
      FROM orders
      WHERE created_at BETWEEN ? AND ?
      GROUP BY bucket
    )
    SELECT traffic_by_bucket.bucket AS date,
           traffic_by_bucket.visitors,
           COALESCE(sales_by_bucket.revenue_cents, 0) AS revenue_cents,
           COALESCE(sales_by_bucket.orders_count, 0) AS orders_count
    FROM traffic_by_bucket
    LEFT JOIN sales_by_bucket ON sales_by_bucket.bucket = traffic_by_bucket.bucket
    ORDER BY traffic_by_bucket.bucket
  `).all(range.start, range.end, start, end);
  const recentRows = db.prepare(`
    WITH ranked AS (
      SELECT orders.*,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(customer_id, lower(customer_email))
               ORDER BY created_at DESC, id DESC
             ) AS customer_rank
      FROM orders
      WHERE status = 'paid' AND created_at BETWEEN ? AND ?
    )
    SELECT * FROM ranked
    WHERE customer_rank = 1
    ORDER BY created_at DESC
    LIMIT 8
  `).all(start, end);

  const kpis = {
      revenue: { value: euro(current.revenue_cents), valueCents: current.revenue_cents, change: percentageChange(current.revenue_cents, previous.revenue_cents) },
      orders: { value: current.orders_count, change: percentageChange(current.orders_count, previous.orders_count) },
      customers: { value: current.customers_count, change: percentageChange(current.customers_count, previous.customers_count) },
      averageOrder: { value: euro(averageCents), valueCents: averageCents, change: percentageChange(averageCents, previousAverage) },
      visitors: { value: traffic.visitors, change: percentageChange(traffic.visitors, previousTraffic.visitors) },
      conversion: { value: Number(conversion.toFixed(2)), change: Number((conversion - previousConversion).toFixed(2)) },
      refunds: { value: current.refunded_count, change: percentageChange(current.refunded_count, previous.refunded_count) },
      refundRate: { value: Number(refundRate.toFixed(2)), change: Number((refundRate - previousRefundRate).toFixed(2)) },
      repeatCustomers: { value: repeatCustomers, change: percentageChange(repeatCustomers, previousRepeatCustomers) },
  };
  const chartRowByDate = new Map(chartRows.map((row) => [row.date, row]));
  const chartDates = range.days <= 31 && bucket.granularity === 'day'
    ? Array.from({ length: range.days }, (_, index) => isoDate(addDays(dateAtUtcNoon(range.start), index)))
    : chartRows.map((row) => row.date);
  const chart = chartDates.map((date) => {
    const row = chartRowByDate.get(date) || { revenue_cents: 0, orders_count: 0, visitors: 0 };
    return {
      date,
      label: chartLabel(date, bucket.granularity),
      granularity: bucket.granularity,
      revenue: euro(row.revenue_cents),
      value: euro(row.revenue_cents),
      revenueCents: row.revenue_cents,
      orders: row.orders_count,
      visitors: row.visitors,
    };
  });
  const recentSales = recentRows.map(serializeOrder);
  const changes = {
    revenue: kpis.revenue.change,
    orders: kpis.orders.change,
    customers: kpis.customers.change,
    averageOrder: kpis.averageOrder.change,
    visitors: kpis.visitors.change,
    conversion: kpis.conversion.change,
    conversionRate: kpis.conversion.change,
    refunds: kpis.refunds.change,
    refundRate: kpis.refundRate.change,
    repeatCustomers: kpis.repeatCustomers.change,
  };
  return {
    kpis,
    metrics: {
      revenue: kpis.revenue.value,
      orders: kpis.orders.value,
      customers: kpis.customers.value,
      averageOrder: kpis.averageOrder.value,
      visitors: kpis.visitors.value,
      conversion: kpis.conversion.value,
      conversionRate: kpis.conversion.value,
      refunds: kpis.refunds.value,
      refundRate: kpis.refundRate.value,
      repeatCustomers: kpis.repeatCustomers.value,
      changes,
    },
    changes,
    currency: 'EUR',
    chart,
    series: chart,
    recentSales,
    recentCustomers: recentSales.map((sale) => ({
      id: sale.customerId,
      name: sale.customer.name,
      email: sale.customer.email,
      product: sale.productName,
      productName: sale.productName,
      purchaseDate: sale.createdAt,
      createdAt: sale.createdAt,
      amount: sale.amount,
      amountCents: sale.amountCents,
      currency: 'EUR',
    })),
    range,
    periodLabel: range.label,
  };
}

function analyticsData(range) {
  const dashboard = dashboardData(range);
  const [start, end] = dateBounds(range);
  const previousEndDate = addDays(dateAtUtcNoon(range.start), -1);
  const previousStartDate = addDays(previousEndDate, -(range.days - 1));
  const topProducts = db.prepare(`
    SELECT product_id, product_name, COUNT(*) AS sales, SUM(amount_cents) AS revenue_cents
    FROM orders WHERE status = 'paid' AND created_at BETWEEN ? AND ?
    GROUP BY product_id, product_name ORDER BY revenue_cents DESC LIMIT 8
  `).all(start, end).map((row) => ({
    id: row.product_id,
    name: row.product_name,
    sales: row.sales,
    revenue: euro(row.revenue_cents),
    revenueCents: row.revenue_cents,
  }));
  const sourceRow = db.prepare(`
    SELECT COALESCE(SUM(direct_visitors), 0) AS direct,
           COALESCE(SUM(social_visitors), 0) AS social,
           COALESCE(SUM(email_visitors), 0) AS email,
           COALESCE(SUM(search_visitors), 0) AS search
    FROM daily_analytics WHERE date BETWEEN ? AND ?
  `).get(range.start, range.end);
  const sourceTotal = sourceRow.direct + sourceRow.social + sourceRow.email + sourceRow.search;
  const sources = [
    ['Social', sourceRow.social],
    ['Direct', sourceRow.direct],
    ['Search', sourceRow.search],
    ['Email', sourceRow.email],
  ].map(([name, visitors]) => ({
    name,
    value: visitors,
    visitors,
    share: sourceTotal ? Number(((visitors / sourceTotal) * 100).toFixed(1)) : 0,
  }));
  const funnelStatement = db.prepare(`
    SELECT COALESCE(SUM(visitors), 0) AS visitors,
           COALESCE(SUM(page_views), 0) AS page_views,
           COALESCE(SUM(add_to_carts), 0) AS add_to_carts,
           COALESCE(SUM(checkouts), 0) AS checkouts
    FROM daily_analytics WHERE date BETWEEN ? AND ?
  `);
  const funnelRow = funnelStatement.get(range.start, range.end);
  const previousFunnel = funnelStatement.get(isoDate(previousStartDate), isoDate(previousEndDate));
  const normalizeFunnel = (row) => {
    const visitors = Math.max(0, Number(row.visitors || 0));
    const pageViews = Math.min(visitors, Math.max(0, Number(row.page_views || 0)));
    const addToCarts = Math.min(pageViews, Math.max(0, Number(row.add_to_carts || 0)));
    const checkouts = Math.min(addToCarts, Math.max(0, Number(row.checkouts || 0)));
    return { visitors, page_views: pageViews, add_to_carts: addToCarts, checkouts };
  };
  const normalizedFunnel = normalizeFunnel(funnelRow);
  const normalizedPreviousFunnel = normalizeFunnel(previousFunnel);
  const paid = dashboard.kpis.orders.value;
  const purchases = Math.min(normalizedFunnel.checkouts, paid);
  const funnel = [
    { step: 'Visitors', value: normalizedFunnel.visitors, rate: 100 },
    { step: 'Product views', value: normalizedFunnel.page_views, rate: normalizedFunnel.visitors ? Number(((normalizedFunnel.page_views / normalizedFunnel.visitors) * 100).toFixed(1)) : 0 },
    { step: 'Add to cart', value: normalizedFunnel.add_to_carts, rate: normalizedFunnel.visitors ? Number(((normalizedFunnel.add_to_carts / normalizedFunnel.visitors) * 100).toFixed(1)) : 0 },
    { step: 'Checkout', value: normalizedFunnel.checkouts, rate: normalizedFunnel.visitors ? Number(((normalizedFunnel.checkouts / normalizedFunnel.visitors) * 100).toFixed(1)) : 0 },
    { step: 'Purchase', value: purchases, rate: normalizedFunnel.visitors ? Number(((purchases / normalizedFunnel.visitors) * 100).toFixed(1)) : 0 },
  ];
  const changes = {
    visitors: dashboard.kpis.visitors.change,
    productViews: percentageChange(normalizedFunnel.page_views, normalizedPreviousFunnel.page_views),
    addToCarts: percentageChange(normalizedFunnel.add_to_carts, normalizedPreviousFunnel.add_to_carts),
    checkouts: percentageChange(normalizedFunnel.checkouts, normalizedPreviousFunnel.checkouts),
    conversion: dashboard.kpis.conversion.change,
    conversionRate: dashboard.kpis.conversion.change,
  };
  const metrics = {
    visitors: normalizedFunnel.visitors,
    productViews: normalizedFunnel.page_views,
    views: normalizedFunnel.page_views,
    addToCarts: normalizedFunnel.add_to_carts,
    checkouts: normalizedFunnel.checkouts,
    checkoutStarts: normalizedFunnel.checkouts,
    conversion: dashboard.kpis.conversion.value,
    conversionRate: dashboard.kpis.conversion.value,
    changes,
  };
  const series = dashboard.chart.map((point) => ({
    date: point.date,
    label: point.label,
    value: point.visitors,
    visitors: point.visitors,
  }));
  return { kpis: dashboard.kpis, metrics, changes, chart: dashboard.chart, series, traffic: series, topProducts, sources, funnel, range };
}

function demoProfilePreview(profile) {
  const totalWeight = profile.priceMix.reduce((sum, item) => sum + item.weight, 0);
  const weightedAverageCents = Math.round(profile.priceMix.reduce(
    (sum, item) => sum + item.priceCents * item.weight,
    0,
  ) / totalWeight);
  const targets = demoMonthlyTargets(profile);
  const annualRevenueCents = targets.reduce((sum, value) => sum + value, 0);
  const annualPaidOrders = Math.max(1, Math.round(annualRevenueCents / weightedAverageCents));
  const annualUniqueCustomers = Math.max(1, Math.round(annualPaidOrders * (1 - profile.repeatBuyerRate / 100)));
  const annualRefundedOrders = Math.round(annualPaidOrders * (profile.refundRate / Math.max(1, 100 - profile.refundRate)));
  const annualVisitors = Math.round(annualPaidOrders / (profile.conversionRate / 100));
  return {
    monthlyTargets: targets.map((value, index) => ({ monthIndex: index + 1, revenueCents: value, revenue: euro(value) })),
    annualRevenueCents,
    annualRevenue: euro(annualRevenueCents),
    weightedAverageOrderCents: weightedAverageCents,
    weightedAverageOrder: euro(weightedAverageCents),
    estimatedPaidOrders: annualPaidOrders,
    estimatedRefundedOrders: annualRefundedOrders,
    estimatedUniqueCustomers: annualUniqueCustomers,
    estimatedVisitors: annualVisitors,
    configuredIdentityCombinations: profile.identityPoolSize,
  };
}

function demoDiagnostics() {
  const profile = currentDemoProfile();
  const endDate = isoDate(new Date());
  const startDate = isoDate(addDays(dateAtUtcNoon(endDate), -364));
  const [start, end] = dateBounds({ start: startDate, end: endDate });
  const version = db.prepare("SELECT value FROM metadata WHERE key = 'seed_version'").get()?.value || null;
  const summaryRow = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_orders,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded_orders,
      COUNT(DISTINCT CASE WHEN status = 'paid' THEN customer_id END) AS unique_customers,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS revenue_cents,
      COALESCE(AVG(CASE WHEN status = 'paid' THEN amount_cents END), 0) AS average_order_cents
    FROM orders
    WHERE is_synthetic = 1 AND created_at BETWEEN ? AND ?
  `).get(start, end);
  const traffic = db.prepare(`
    SELECT
      COUNT(*) AS days,
      COALESCE(SUM(visitors), 0) AS visitors,
      COALESCE(SUM(page_views), 0) AS product_views,
      COALESCE(SUM(add_to_carts), 0) AS add_to_carts,
      COALESCE(SUM(checkouts), 0) AS checkouts,
      MIN(date) AS first_date,
      MAX(date) AS last_date
    FROM daily_analytics
    WHERE is_synthetic = 1 AND date BETWEEN ? AND ?
  `).get(startDate, endDate);
  const totalSyntheticDays = db.prepare('SELECT COUNT(*) AS count, MIN(date) AS first_date, MAX(date) AS last_date FROM daily_analytics WHERE is_synthetic = 1').get();
  const productRows = db.prepare(`
    SELECT price_cents, name
    FROM products
    WHERE is_synthetic = 1 AND status != 'archived'
    ORDER BY price_cents
  `).all();
  const monthly = db.prepare(`
    SELECT
      substr(orders.created_at, 1, 7) AS month,
      COUNT(CASE WHEN orders.status = 'paid' THEN 1 END) AS paidOrders,
      COUNT(CASE WHEN orders.status = 'refunded' THEN 1 END) AS refundedOrders,
      COUNT(DISTINCT CASE WHEN orders.status = 'paid' THEN orders.customer_id END) AS customers,
      COALESCE(SUM(CASE WHEN orders.status = 'paid' THEN orders.amount_cents ELSE 0 END), 0) AS revenueCents,
      COALESCE(AVG(CASE WHEN orders.status = 'paid' THEN orders.amount_cents END), 0) AS averageOrderCents
    FROM orders
    WHERE orders.is_synthetic = 1 AND orders.created_at BETWEEN ? AND ?
    GROUP BY substr(orders.created_at, 1, 7)
    ORDER BY month
  `).all(start, end).map((row) => ({
    month: row.month,
    paidOrders: row.paidOrders,
    refundedOrders: row.refundedOrders,
    customers: row.customers,
    revenueCents: row.revenueCents,
    revenue: euro(row.revenueCents),
    averageOrderCents: Math.round(row.averageOrderCents),
    averageOrder: euro(Math.round(row.averageOrderCents)),
    partial: row.month === startDate.slice(0, 7) || row.month === endDate.slice(0, 7),
  }));
  const configuredPrices = profile.priceMix.map((item) => item.priceCents).sort((a, b) => a - b);
  const actualPrices = productRows.map((row) => row.price_cents);
  const conversionRate = traffic.visitors ? Number((summaryRow.paid_orders / traffic.visitors * 100).toFixed(2)) : 0;
  const refundRate = summaryRow.paid_orders + summaryRow.refunded_orders
    ? Number((summaryRow.refunded_orders / (summaryRow.paid_orders + summaryRow.refunded_orders) * 100).toFixed(2))
    : 0;
  const repeatBuyerRate = summaryRow.paid_orders
    ? Number(((1 - summaryRow.unique_customers / summaryRow.paid_orders) * 100).toFixed(2))
    : 0;
  const checks = [
    {
      id: 'seed_version',
      status: version === DEMO_SEED_VERSION ? 'pass' : 'fail',
      message: version === DEMO_SEED_VERSION ? 'Le seed v2 est actif.' : 'Le seed v2 doit être régénéré.',
      value: version,
      target: DEMO_SEED_VERSION,
    },
    {
      id: 'history',
      status: totalSyntheticDays.count >= 730 ? 'pass' : 'fail',
      message: `${totalSyntheticDays.count} jours analytiques synthétiques disponibles.`,
      value: totalSyntheticDays.count,
      target: '>=730',
    },
    {
      id: 'price_mix',
      status: JSON.stringify(actualPrices) === JSON.stringify(configuredPrices) ? 'pass' : 'fail',
      message: 'Les produits synthétiques correspondent au mix de prix configuré.',
      value: actualPrices,
      target: configuredPrices,
    },
    {
      id: 'funnel',
      status: traffic.visitors >= traffic.product_views
        && traffic.product_views >= traffic.add_to_carts
        && traffic.add_to_carts >= traffic.checkouts
        && traffic.checkouts >= summaryRow.paid_orders ? 'pass' : 'fail',
      message: 'Le funnel reste monotone de la visite à l’achat.',
      value: [traffic.visitors, traffic.product_views, traffic.add_to_carts, traffic.checkouts, summaryRow.paid_orders],
      target: 'visitors ≥ productViews ≥ carts ≥ checkouts ≥ purchases',
    },
    {
      id: 'conversion_rate',
      status: Math.abs(conversionRate - profile.conversionRate) <= 0.25 ? 'pass' : 'warn',
      message: `Conversion observée ${conversionRate}% pour ${profile.conversionRate}% configuré.`,
      value: conversionRate,
      target: profile.conversionRate,
    },
    {
      id: 'refund_rate',
      status: Math.abs(refundRate - profile.refundRate) <= 0.5 ? 'pass' : 'warn',
      message: `Remboursements observés ${refundRate}% pour ${profile.refundRate}% configuré.`,
      value: refundRate,
      target: profile.refundRate,
    },
    {
      id: 'identity_pool',
      status: profile.identityPoolSize >= 250_000 ? 'pass' : 'fail',
      message: `${profile.identityPoolSize.toLocaleString('fr-FR')} combinaisons d’identité configurées.`,
      value: profile.identityPoolSize,
      target: '>=250000',
    },
  ];
  const hasFailure = checks.some((check) => check.status === 'fail');
  const hasWarning = checks.some((check) => check.status === 'warn');
  return {
    status: hasFailure ? 'error' : hasWarning ? 'warning' : 'ok',
    checks,
    summary: {
      period: { start: startDate, end: endDate },
      revenue: euro(summaryRow.revenue_cents),
      revenueCents: summaryRow.revenue_cents,
      paidOrders: summaryRow.paid_orders,
      refundedOrders: summaryRow.refunded_orders,
      uniqueCustomers: summaryRow.unique_customers,
      averageOrder: euro(Math.round(summaryRow.average_order_cents)),
      averageOrderCents: Math.round(summaryRow.average_order_cents),
      visitors: traffic.visitors,
      productViews: traffic.product_views,
      addToCarts: traffic.add_to_carts,
      checkouts: traffic.checkouts,
      conversionRate,
      refundRate,
      repeatBuyerRate,
      syntheticHistory: {
        days: totalSyntheticDays.count,
        firstDate: totalSyntheticDays.first_date,
        lastDate: totalSyntheticDays.last_date,
      },
      nonSynthetic: {
        products: db.prepare('SELECT COUNT(*) AS count FROM products WHERE is_synthetic = 0').get().count,
        customers: db.prepare('SELECT COUNT(*) AS count FROM customers WHERE is_synthetic = 0').get().count,
        orders: db.prepare('SELECT COUNT(*) AS count FROM orders WHERE is_synthetic = 0').get().count,
      },
    },
    monthly,
  };
}

function productsList(includeArchived = false) {
  return db.prepare(`
    SELECT products.*,
      SUM(CASE WHEN orders.status = 'paid' THEN 1 ELSE 0 END) AS sales_count,
      COALESCE(SUM(CASE WHEN orders.status = 'paid' THEN orders.amount_cents ELSE 0 END), 0) AS revenue_cents
    FROM products LEFT JOIN orders ON orders.product_id = products.id
    ${includeArchived ? '' : "WHERE products.status != 'archived'"}
    GROUP BY products.id ORDER BY products.created_at DESC
  `).all().map(serializeProduct);
}

function paginationFromUrl(url) {
  const requested = url.searchParams.has('page') || url.searchParams.has('limit');
  if (!requested) return { requested: false, page: 1, limit: null, offset: 0 };
  const pageText = url.searchParams.get('page') || '1';
  const limitText = url.searchParams.get('limit') || '100';
  if (!/^\d+$/.test(pageText) || !/^\d+$/.test(limitText)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'page et limit doivent être des entiers positifs.');
  }
  const page = Number(pageText);
  const limit = Number(limitText);
  if (page < 1 || page > 1_000_000 || limit < 1 || limit > 100) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'page doit être >= 1 et limit compris entre 1 et 100.');
  }
  return { requested: true, page, limit, offset: (page - 1) * limit };
}

function queryOrders(url, { paginate = false } = {}) {
  const search = (url.searchParams.get('search') || '').trim().slice(0, 120);
  const status = (url.searchParams.get('status') || '').trim();
  const product = (url.searchParams.get('product') || '').trim();
  if (status && !['paid', 'pending', 'refunded', 'failed'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', 'Statut de commande invalide.');
  const clauses = [];
  const parameters = [];
  if (search) {
    clauses.push('(customer_name LIKE ? OR customer_email LIKE ? OR order_number LIKE ? OR product_name LIKE ?)');
    const like = `%${search}%`;
    parameters.push(like, like, like, like);
  }
  if (status) {
    clauses.push('status = ?');
    parameters.push(status);
  }
  if (product) {
    clauses.push('(product_id = ? OR product_name LIKE ?)');
    parameters.push(product, `%${product}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const pagination = paginate ? paginationFromUrl(url) : { requested: false, page: 1, limit: null, offset: 0 };
  const total = db.prepare(`SELECT COUNT(*) AS count FROM orders ${where}`).get(...parameters).count;
  const rows = pagination.requested
    ? db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...parameters, pagination.limit, pagination.offset)
    : db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC, id DESC`).all(...parameters);
  return {
    rows,
    total,
    page: pagination.page,
    limit: pagination.requested ? pagination.limit : total,
    totalPages: pagination.requested ? Math.max(1, Math.ceil(total / pagination.limit)) : 1,
    hasMore: pagination.requested ? pagination.offset + rows.length < total : false,
    paginated: pagination.requested,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sendCsv(res, filename, headers, rows) {
  const csv = `\uFEFF${headers.map(csvCell).join(',')}\n${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
  const payload = Buffer.from(csv);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    if (!methodAllowed(req, res, ['GET'])) return;
    const database = db.prepare('SELECT 1 AS ok').get();
    sendJson(res, 200, { ok: database.ok === 1, service: 'shopway-local-api', version: 2, database: 'sqlite', uptime: Math.round(process.uptime()) });
    return;
  }

  if (pathname === '/api/admin/demo-profile') {
    if (!methodAllowed(req, res, ['GET', 'PATCH'])) return;
    if (req.method === 'GET') {
      const profile = currentDemoProfile();
      const diagnostics = demoDiagnostics();
      sendJson(res, 200, { profile, preview: demoProfilePreview(profile), diagnostics });
      return;
    }
    const submitted = await readJson(req);
    const body = submitted.profile && !Array.isArray(submitted.profile) && typeof submitted.profile === 'object'
      ? submitted.profile
      : submitted;
    const profile = updateDemoProfile(body);
    sendJson(res, 200, {
      profile,
      preview: demoProfilePreview(profile),
      diagnostics: demoDiagnostics(),
      regenerated: false,
    });
    return;
  }

  if (pathname === '/api/admin/demo-profile/regenerate') {
    if (!methodAllowed(req, res, ['POST'])) return;
    const body = await readJson(req);
    if (body.confirmation !== 'REGENERATE') {
      throw new HttpError(422, 'CONFIRMATION_REQUIRED', 'confirmation doit valoir REGENERATE.');
    }
    const profile = currentDemoProfile();
    regenerateDemoData(profile);
    sendJson(res, 200, {
      regenerated: true,
      profile: currentDemoProfile(),
      preview: demoProfilePreview(currentDemoProfile()),
      diagnostics: demoDiagnostics(),
    });
    return;
  }

  if (pathname === '/api/admin/demo-profile/reset') {
    if (!methodAllowed(req, res, ['POST'])) return;
    const body = await readJson(req);
    if (body.confirmation !== 'RESET') {
      throw new HttpError(422, 'CONFIRMATION_REQUIRED', 'confirmation doit valoir RESET.');
    }
    const stamp = nowIso();
    db.prepare(`
      UPDATE demo_profiles
      SET monthly_min_cents = ?, monthly_max_cents = ?, price_mix_json = ?,
          conversion_rate = ?, add_to_cart_rate = ?, checkout_rate = ?,
          refund_rate = ?, repeat_buyer_rate = ?, seed = ?,
          identity_pool_size = ?, updated_at = ?
      WHERE id = 1
    `).run(
      DEFAULT_DEMO_PROFILE.monthlyMinCents,
      DEFAULT_DEMO_PROFILE.monthlyMaxCents,
      JSON.stringify(DEFAULT_DEMO_PROFILE.priceMix),
      DEFAULT_DEMO_PROFILE.conversionRate,
      DEFAULT_DEMO_PROFILE.addToCartRate,
      DEFAULT_DEMO_PROFILE.checkoutRate,
      DEFAULT_DEMO_PROFILE.refundRate,
      DEFAULT_DEMO_PROFILE.repeatBuyerRate,
      DEFAULT_DEMO_PROFILE.seed,
      DEFAULT_DEMO_PROFILE.identityPoolSize,
      stamp,
    );
    const profile = currentDemoProfile();
    regenerateDemoData(profile);
    sendJson(res, 200, {
      reset: true,
      regenerated: true,
      profile: currentDemoProfile(),
      preview: demoProfilePreview(currentDemoProfile()),
      diagnostics: demoDiagnostics(),
    });
    return;
  }

  if (pathname === '/api/admin/diagnostics') {
    if (!methodAllowed(req, res, ['GET'])) return;
    sendJson(res, 200, demoDiagnostics());
    return;
  }

  if (pathname === '/api/dashboard') {
    if (!methodAllowed(req, res, ['GET'])) return;
    sendJson(res, 200, dashboardData(parseRange(url)));
    return;
  }

  if (pathname === '/api/analytics') {
    if (!methodAllowed(req, res, ['GET'])) return;
    sendJson(res, 200, analyticsData(parseRange(url)));
    return;
  }

  if (pathname === '/api/products') {
    if (!methodAllowed(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      sendJson(res, 200, { products: productsList(url.searchParams.get('includeArchived') === 'true') });
      return;
    }
    const body = await readJson(req);
    const name = requireString(body.name, 'name', { max: 120 });
    const productId = id('prd');
    const stamp = nowIso();
    const status = body.status === undefined ? 'draft' : requireString(body.status, 'status', { max: 20 });
    if (!['active', 'draft'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', 'status doit valoir active ou draft.');
    const requestedAssetPath = body.assetPath ?? body.fileUrl ?? body.path;
    const assetPath = requestedAssetPath === undefined || requestedAssetPath === null ? null : requireString(requestedAssetPath, 'assetPath', { max: 300 });
    if (assetPath && (!assetPath.startsWith('uploads/') || resolve(DATA_DIR, assetPath).indexOf(resolve(UPLOAD_DIR) + sep) !== 0)) throw new HttpError(422, 'VALIDATION_ERROR', 'assetPath est invalide.');
    db.prepare(`
      INSERT INTO products (id, name, slug, description, price_cents, status, category, thumbnail_url, asset_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      name,
      slugify(body.slug || name),
      body.description === undefined ? '' : requireString(body.description, 'description', { min: 0, max: 4000 }),
      parsePriceCents(body),
      status,
      body.category === undefined && body.type === undefined ? 'Digital product' : requireString(body.category ?? body.type, 'category', { max: 80 }),
      body.thumbnailUrl === undefined || body.thumbnailUrl === null ? null : requireString(body.thumbnailUrl, 'thumbnailUrl', { max: 600 }),
      assetPath,
      stamp,
      stamp,
    );
    audit('product.created', 'product', productId, { name });
    const created = productsList(true).find((product) => product.id === productId);
    sendJson(res, 201, { product: created }, { Location: `/api/products/${productId}` });
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch) {
    if (!methodAllowed(req, res, ['PATCH', 'DELETE'])) return;
    const productId = decodeURIComponent(productMatch[1]);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
    if (req.method === 'DELETE') {
      db.prepare("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), productId);
      audit('product.archived', 'product', productId);
      sendJson(res, 200, { deleted: true, id: productId });
      return;
    }
    const body = await readJson(req);
    const fields = [];
    const values = [];
    const set = (column, value) => { fields.push(`${column} = ?`); values.push(value); };
    if (body.name !== undefined) set('name', requireString(body.name, 'name', { max: 120 }));
    if (body.slug !== undefined) set('slug', slugify(requireString(body.slug, 'slug', { max: 120 })));
    if (body.description !== undefined) set('description', requireString(body.description, 'description', { min: 0, max: 4000 }));
    const priceCents = parsePriceCents(body, false);
    if (priceCents !== undefined) set('price_cents', priceCents);
    if (body.status !== undefined) {
      const status = requireString(body.status, 'status', { max: 20 });
      if (!['active', 'draft', 'archived'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', 'Statut produit invalide.');
      set('status', status);
    }
    if (body.category !== undefined) set('category', requireString(body.category, 'category', { max: 80 }));
    if (body.type !== undefined && body.category === undefined) set('category', requireString(body.type, 'type', { max: 80 }));
    if (body.thumbnailUrl !== undefined) set('thumbnail_url', body.thumbnailUrl === null ? null : requireString(body.thumbnailUrl, 'thumbnailUrl', { max: 600 }));
    if (body.assetPath !== undefined || body.fileUrl !== undefined || body.path !== undefined) {
      const requestedAssetPath = body.assetPath ?? body.fileUrl ?? body.path;
      const assetPath = requestedAssetPath === null || requestedAssetPath === undefined ? null : requireString(requestedAssetPath, 'assetPath', { max: 300 });
      if (assetPath && (!assetPath.startsWith('uploads/') || resolve(DATA_DIR, assetPath).indexOf(resolve(UPLOAD_DIR) + sep) !== 0)) throw new HttpError(422, 'VALIDATION_ERROR', 'assetPath est invalide.');
      set('asset_path', assetPath);
    }
    if (!fields.length) throw new HttpError(422, 'VALIDATION_ERROR', 'Aucune modification reconnue.');
    set('updated_at', nowIso());
    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values, productId);
    audit('product.updated', 'product', productId, { fields: Object.keys(body) });
    sendJson(res, 200, { product: productsList(true).find((product) => product.id === productId) });
    return;
  }

  if (pathname === '/api/uploads') {
    if (!methodAllowed(req, res, ['POST'])) return;
    const original = requireString(url.searchParams.get('filename'), 'filename', { max: 180 });
    const extension = extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    const safeExtension = extension && extension !== '.' ? extension : '.bin';
    const generated = `${Date.now()}-${randomBytes(8).toString('hex')}${safeExtension}`;
    const destination = resolve(UPLOAD_DIR, generated);
    if (!destination.startsWith(resolve(UPLOAD_DIR) + sep)) throw new HttpError(400, 'INVALID_FILENAME', 'Nom de fichier invalide.');
    const buffer = await readBuffer(req, UPLOAD_LIMIT);
    if (!buffer.length) throw new HttpError(400, 'EMPTY_BODY', 'Le fichier est vide.');
    await writeFile(destination, buffer, { flag: 'wx' });
    audit('upload.created', 'upload', generated, { original, size: buffer.length, contentType: req.headers['content-type'] || null });
    const assetPath = `uploads/${generated}`;
    const upload = { filename: generated, originalFilename: original, assetPath, path: assetPath, fileUrl: assetPath, size: buffer.length };
    sendJson(res, 201, { upload, assetPath, path: assetPath, fileUrl: assetPath, url: assetPath });
    return;
  }

  if (pathname === '/api/orders/export') {
    if (!methodAllowed(req, res, ['GET'])) return;
    const orders = queryOrders(url).rows;
    sendCsv(res, `shopway-orders-${isoDate(new Date())}.csv`, ['Order', 'Customer', 'Email', 'Product', 'Amount EUR', 'Status', 'Source', 'Date'], orders.map((order) => [order.order_number, order.customer_name, order.customer_email, order.product_name, euro(order.amount_cents).toFixed(2), order.status, order.source, order.created_at]));
    return;
  }

  if (pathname === '/api/orders') {
    if (!methodAllowed(req, res, ['GET'])) return;
    const result = queryOrders(url, { paginate: true });
    sendJson(res, 200, {
      orders: result.rows.map(serializeOrder),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      hasMore: result.hasMore,
      paginated: result.paginated,
    });
    return;
  }

  const orderActionMatch = pathname.match(/^\/api\/orders\/([^/]+)\/(refund|resend)$/);
  if (orderActionMatch) {
    if (!methodAllowed(req, res, ['POST'])) return;
    const orderId = decodeURIComponent(orderActionMatch[1]);
    const action = orderActionMatch[2];
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Commande introuvable.');
    if (action === 'refund') {
      if (order.status !== 'paid') throw new HttpError(409, 'INVALID_ORDER_STATE', 'Seule une commande payée peut être remboursée.');
      inTransaction(() => {
        db.prepare("UPDATE orders SET status = 'refunded', refunded_at = ? WHERE id = ?").run(nowIso(), orderId);
        refreshCustomerStats(order.customer_id);
        audit('order.refunded', 'order', orderId, { amountCents: order.amount_cents });
      });
      sendJson(res, 200, { order: serializeOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)) });
      return;
    }
    if (order.status !== 'paid') throw new HttpError(409, 'INVALID_ORDER_STATE', 'Le téléchargement ne peut être renvoyé que pour une commande payée.');
    db.prepare('UPDATE orders SET resend_count = resend_count + 1 WHERE id = ?').run(orderId);
    audit('order.download_resent', 'order', orderId, { email: order.customer_email });
    const entitlement = db.prepare('SELECT token FROM entitlements WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(orderId);
    sendJson(res, 200, { sent: true, email: order.customer_email, downloadUrl: entitlement ? `/api/download/${entitlement.token}` : null, order: serializeOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)) });
    return;
  }

  if (pathname === '/api/customers/export') {
    if (!methodAllowed(req, res, ['GET'])) return;
    const rows = db.prepare('SELECT * FROM customers ORDER BY last_order_at DESC, created_at DESC').all();
    sendCsv(res, `shopway-customers-${isoDate(new Date())}.csv`, ['Name', 'Email', 'Country', 'Orders', 'Total spent EUR', 'Last order', 'Created'], rows.map((customer) => [customer.name, customer.email, customer.country, customer.orders_count, euro(customer.total_spent_cents).toFixed(2), customer.last_order_at || '', customer.created_at]));
    return;
  }

  if (pathname === '/api/customers') {
    if (!methodAllowed(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      const search = (url.searchParams.get('search') || '').trim().slice(0, 120);
      const parameters = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
      const where = search ? 'WHERE name LIKE ? OR email LIKE ? OR gamer_tag LIKE ?' : '';
      const pagination = paginationFromUrl(url);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM customers ${where}`).get(...parameters).count;
      const rows = pagination.requested
        ? db.prepare(`
            SELECT * FROM customers ${where}
            ORDER BY last_order_at DESC, created_at DESC, id DESC
            LIMIT ? OFFSET ?
          `).all(...parameters, pagination.limit, pagination.offset)
        : db.prepare(`
            SELECT * FROM customers ${where}
            ORDER BY last_order_at DESC, created_at DESC, id DESC
          `).all(...parameters);
      sendJson(res, 200, {
        customers: rows.map(serializeCustomer),
        total,
        page: pagination.page,
        limit: pagination.requested ? pagination.limit : total,
        totalPages: pagination.requested ? Math.max(1, Math.ceil(total / pagination.limit)) : 1,
        hasMore: pagination.requested ? pagination.offset + rows.length < total : false,
        paginated: pagination.requested,
      });
      return;
    }
    const body = await readJson(req);
    const customerId = id('cus');
    const stamp = nowIso();
    const email = requireEmail(body.email);
    const submittedName = body.name ?? [body.firstName, body.lastName].filter((part) => typeof part === 'string' && part.trim()).join(' ');
    const name = submittedName
      ? requireString(submittedName, 'name', { max: 120 })
      : email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 120);
    const country = body.country === undefined ? 'France' : requireString(body.country, 'country', { max: 80 });
    const source = body.source === undefined ? 'Manual' : requireString(body.source, 'source', { max: 80 });
    const marketingOptIn = body.marketingOptIn === undefined ? false : boolean(body.marketingOptIn, 'marketingOptIn');
    db.prepare(`INSERT INTO customers (id, name, email, country, source, marketing_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(customerId, name, email, country, source, Number(marketingOptIn), stamp, stamp);
    audit('customer.created', 'customer', customerId, { email });
    sendJson(res, 201, { customer: serializeCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId)) });
    return;
  }

  if (pathname === '/api/store') {
    if (!methodAllowed(req, res, ['GET', 'PATCH'])) return;
    if (req.method === 'GET') {
      const store = serializeStore(db.prepare('SELECT * FROM store WHERE id = 1').get());
      sendJson(res, 200, { ...store, store });
      return;
    }
    const body = await readJson(req);
    const fields = [];
    const values = [];
    const set = (column, value) => { fields.push(`${column} = ?`); values.push(value); };
    if (body.name !== undefined) set('name', requireString(body.name, 'name', { max: 100 }));
    if (body.slug !== undefined) set('slug', slugify(requireString(body.slug, 'slug', { max: 100 })));
    if (body.tagline !== undefined) set('tagline', requireString(body.tagline, 'tagline', { min: 0, max: 180 }));
    if (body.headline !== undefined && body.tagline === undefined) set('tagline', requireString(body.headline, 'headline', { min: 0, max: 180 }));
    if (body.description !== undefined) set('description', requireString(body.description, 'description', { min: 0, max: 2000 }));
    if (body.logoUrl !== undefined) set('logo_url', body.logoUrl === null ? null : requireString(body.logoUrl, 'logoUrl', { max: 600 }));
    if (body.logo !== undefined && body.logoUrl === undefined) set('logo_url', body.logo ? requireString(body.logo, 'logo', { max: 600 }) : null);
    if (body.heroImage !== undefined) set('hero_image_url', body.heroImage ? requireString(body.heroImage, 'heroImage', { max: 600 }) : null);
    if (body.theme !== undefined || body.accent !== undefined) {
      if (body.theme !== undefined && (!body.theme || Array.isArray(body.theme) || typeof body.theme !== 'object')) throw new HttpError(422, 'VALIDATION_ERROR', 'theme doit être un objet.');
      const currentTheme = safeJson(db.prepare('SELECT theme_json FROM store WHERE id = 1').get().theme_json, {});
      const theme = { ...currentTheme, ...(body.theme || {}) };
      if (body.accent !== undefined) {
        const accent = requireString(body.accent, 'accent', { max: 30 });
        if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new HttpError(422, 'VALIDATION_ERROR', 'accent doit être une couleur hexadécimale.');
        theme.accent = accent;
      }
      const encoded = JSON.stringify(theme);
      if (encoded.length > 20_000) throw new HttpError(422, 'VALIDATION_ERROR', 'theme est trop volumineux.');
      set('theme_json', encoded);
    }
    if (!fields.length) throw new HttpError(422, 'VALIDATION_ERROR', 'Aucune modification reconnue.');
    set('updated_at', nowIso());
    db.prepare(`UPDATE store SET ${fields.join(', ')} WHERE id = 1`).run(...values);
    audit('store.updated', 'store', '1', { fields: Object.keys(body) });
    const store = serializeStore(db.prepare('SELECT * FROM store WHERE id = 1').get());
    sendJson(res, 200, { ...store, store });
    return;
  }

  if (pathname === '/api/store/publish') {
    if (!methodAllowed(req, res, ['POST'])) return;
    const snapshot = buildPublishedSnapshot();
    db.prepare(`UPDATE store SET published = 1, published_snapshot_json = ?, published_at = ?, updated_at = ? WHERE id = 1`)
      .run(JSON.stringify(snapshot), snapshot.publishedAt, nowIso());
    audit('store.published', 'store', '1', { products: snapshot.products.length });
    sendJson(res, 200, { published: true, publishedAt: snapshot.publishedAt, publicUrl: `/store.html?store=${encodeURIComponent(snapshot.store.slug)}` });
    return;
  }

  if (pathname === '/api/templates') {
    if (!methodAllowed(req, res, ['GET'])) return;
    const templates = db.prepare('SELECT * FROM templates ORDER BY name').all().map((row) => ({ id: row.id, name: row.name, category: row.category, description: row.description, preview: row.preview, theme: safeJson(row.theme_json, {}) }));
    sendJson(res, 200, { templates });
    return;
  }

  const templateApplyMatch = pathname.match(/^\/api\/templates\/([^/]+)\/apply$/);
  if (templateApplyMatch) {
    if (!methodAllowed(req, res, ['POST'])) return;
    const templateId = decodeURIComponent(templateApplyMatch[1]);
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) throw new HttpError(404, 'NOT_FOUND', 'Template introuvable.');
    db.prepare('UPDATE store SET theme_json = ?, updated_at = ? WHERE id = 1').run(template.theme_json, nowIso());
    audit('template.applied', 'template', templateId);
    sendJson(res, 200, { applied: true, templateId, store: serializeStore(db.prepare('SELECT * FROM store WHERE id = 1').get()) });
    return;
  }

  if (pathname === '/api/discounts') {
    if (!methodAllowed(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      sendJson(res, 200, { discounts: db.prepare('SELECT * FROM discounts ORDER BY created_at DESC').all().map(serializeDiscount) });
      return;
    }
    const body = await readJson(req);
    const discountId = id('dsc');
    const code = requireString(body.code, 'code', { max: 40 }).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code) throw new HttpError(422, 'VALIDATION_ERROR', 'code est invalide.');
    const submittedType = requireString(body.type, 'type', { max: 20 });
    const type = submittedType === 'percentage' ? 'percent' : submittedType;
    if (!['percent', 'fixed'].includes(type)) throw new HttpError(422, 'VALIDATION_ERROR', 'type doit valoir percent ou fixed.');
    let value;
    if (type === 'percent') value = integer(body.value, 'value', { min: 1, max: 100 });
    else if (body.valueCents !== undefined) value = integer(body.valueCents, 'valueCents', { min: 1, max: 100_000_000 });
    else {
      if (typeof body.value !== 'number' || body.value <= 0) throw new HttpError(422, 'VALIDATION_ERROR', 'value doit être un montant positif en euros.');
      value = Math.round(body.value * 100);
    }
    const stamp = nowIso();
    db.prepare(`
      INSERT INTO discounts (id, code, type, value, active, max_uses, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discountId,
      code,
      type,
      value,
      body.active === undefined ? 1 : Number(boolean(body.active, 'active')),
      body.maxUses === undefined || body.maxUses === null ? null : integer(body.maxUses, 'maxUses', { min: 1, max: 10_000_000 }),
      parseIsoTimestamp(body.expiresAt, 'expiresAt'),
      stamp,
      stamp,
    );
    audit('discount.created', 'discount', discountId, { code });
    sendJson(res, 201, { discount: serializeDiscount(db.prepare('SELECT * FROM discounts WHERE id = ?').get(discountId)) });
    return;
  }

  const discountMatch = pathname.match(/^\/api\/discounts\/([^/]+)$/);
  if (discountMatch) {
    if (!methodAllowed(req, res, ['PATCH', 'DELETE'])) return;
    const discountId = decodeURIComponent(discountMatch[1]);
    const existing = db.prepare('SELECT * FROM discounts WHERE id = ?').get(discountId);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Code promo introuvable.');
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM discounts WHERE id = ?').run(discountId);
      audit('discount.deleted', 'discount', discountId, { code: existing.code });
      sendJson(res, 200, { deleted: true, id: discountId });
      return;
    }
    const body = await readJson(req);
    const fields = [];
    const values = [];
    const set = (column, value) => { fields.push(`${column} = ?`); values.push(value); };
    if (body.code !== undefined) {
      const code = requireString(body.code, 'code', { max: 40 }).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!code) throw new HttpError(422, 'VALIDATION_ERROR', 'code est invalide.');
      set('code', code);
    }
    if (body.type !== undefined) {
      const submittedType = requireString(body.type, 'type', { max: 20 });
      const type = submittedType === 'percentage' ? 'percent' : submittedType;
      if (!['percent', 'fixed'].includes(type)) throw new HttpError(422, 'VALIDATION_ERROR', 'type invalide.');
      set('type', type);
    }
    if (body.value !== undefined) {
      const effectiveType = body.type === 'percentage' ? 'percent' : (body.type || existing.type);
      if (effectiveType === 'percent') set('value', integer(body.value, 'value', { min: 1, max: 100 }));
      else {
        if (typeof body.value !== 'number' || body.value <= 0) throw new HttpError(422, 'VALIDATION_ERROR', 'value doit être un montant positif en euros.');
        set('value', Math.round(body.value * 100));
      }
    }
    if (body.valueCents !== undefined) set('value', integer(body.valueCents, 'valueCents', { min: 1, max: 100_000_000 }));
    if (body.active !== undefined) set('active', Number(boolean(body.active, 'active')));
    if (body.maxUses !== undefined) set('max_uses', body.maxUses === null ? null : integer(body.maxUses, 'maxUses', { min: 1, max: 10_000_000 }));
    if (body.expiresAt !== undefined) set('expires_at', parseIsoTimestamp(body.expiresAt, 'expiresAt'));
    if (!fields.length) throw new HttpError(422, 'VALIDATION_ERROR', 'Aucune modification reconnue.');
    set('updated_at', nowIso());
    db.prepare(`UPDATE discounts SET ${fields.join(', ')} WHERE id = ?`).run(...values, discountId);
    audit('discount.updated', 'discount', discountId, { fields: Object.keys(body) });
    sendJson(res, 200, { discount: serializeDiscount(db.prepare('SELECT * FROM discounts WHERE id = ?').get(discountId)) });
    return;
  }

  if (pathname === '/api/campaigns') {
    if (!methodAllowed(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all().map((row) => ({ id: row.id, name: row.name, subject: row.subject, audience: row.audience, status: row.status, recipients: row.recipients, scheduledAt: row.scheduled_at, sentAt: row.sent_at, createdAt: row.created_at, updatedAt: row.updated_at }));
      sendJson(res, 200, { campaigns });
      return;
    }
    const body = await readJson(req);
    const campaignId = id('cmp');
    const stamp = nowIso();
    const status = body.scheduledAt ? 'scheduled' : 'draft';
    db.prepare(`
      INSERT INTO campaigns (id, name, subject, audience, status, scheduled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(campaignId, requireString(body.name, 'name', { max: 120 }), requireString(body.subject, 'subject', { max: 180 }), body.audience === undefined ? 'all' : requireString(body.audience, 'audience', { max: 80 }), status, parseIsoTimestamp(body.scheduledAt, 'scheduledAt'), stamp, stamp);
    audit('campaign.created', 'campaign', campaignId);
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    sendJson(res, 201, { id: campaignId, campaign });
    return;
  }

  const campaignSendMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/send$/);
  if (campaignSendMatch) {
    if (!methodAllowed(req, res, ['POST'])) return;
    const campaignId = decodeURIComponent(campaignSendMatch[1]);
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) throw new HttpError(404, 'NOT_FOUND', 'Campagne introuvable.');
    if (campaign.status === 'sent') throw new HttpError(409, 'ALREADY_SENT', 'Cette campagne a déjà été envoyée.');
    // Synthetic addresses make the dashboard realistic, but they must never
    // become deliverable contacts. A future email provider integration should
    // use deliverableRecipients only.
    const recipientCounts = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN is_synthetic = 0 AND marketing_opt_in = 1 THEN 1 ELSE 0 END), 0) AS deliverable,
        COALESCE(SUM(CASE WHEN is_synthetic = 1 THEN 1 ELSE 0 END), 0) AS simulated
      FROM customers
    `).get();
    const recipients = recipientCounts.deliverable + recipientCounts.simulated;
    const sentAt = nowIso();
    db.prepare("UPDATE campaigns SET status = 'sent', recipients = ?, sent_at = ?, updated_at = ? WHERE id = ?").run(recipients, sentAt, sentAt, campaignId);
    audit('campaign.sent', 'campaign', campaignId, {
      recipients,
      deliverableRecipients: recipientCounts.deliverable,
      simulatedRecipients: recipientCounts.simulated,
    });
    sendJson(res, 200, {
      sent: true,
      recipients,
      deliverableRecipients: recipientCounts.deliverable,
      simulatedRecipients: recipientCounts.simulated,
      syntheticEmailsSuppressed: true,
      sentAt,
      campaign: db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId),
    });
    return;
  }

  if (pathname === '/api/payouts') {
    if (!methodAllowed(req, res, ['GET', 'POST'])) return;
    if (req.method === 'GET') {
      const payouts = db.prepare('SELECT * FROM payouts ORDER BY requested_at DESC').all().map((row) => ({ id: row.id, amount: euro(row.amount_cents), amountCents: row.amount_cents, status: row.status, method: row.method, reference: row.reference, requestedAt: row.requested_at, paidAt: row.paid_at }));
      const revenueCents = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM orders WHERE status = 'paid'").get().total;
      const payoutTotals = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid,
               COALESCE(SUM(CASE WHEN status IN ('pending', 'processing') THEN amount_cents ELSE 0 END), 0) AS pending
        FROM payouts
      `).get();
      const summary = {
        available: euro(Math.max(0, revenueCents - payoutTotals.paid - payoutTotals.pending)),
        availableCents: Math.max(0, revenueCents - payoutTotals.paid - payoutTotals.pending),
        pending: euro(payoutTotals.pending),
        pendingCents: payoutTotals.pending,
        paid: euro(payoutTotals.paid),
        paidCents: payoutTotals.paid,
        bankLabel: 'Bank account •••• 4281',
        currency: 'EUR',
      };
      sendJson(res, 200, { payouts, summary, currency: 'EUR', ...summary });
      return;
    }
    const body = await readJson(req);
    const amountCents = parsePriceCents(body);
    if (amountCents <= 0) throw new HttpError(422, 'VALIDATION_ERROR', 'Le montant doit être supérieur à zéro.');
    const payoutId = id('pay');
    const stamp = nowIso();
    db.prepare(`INSERT INTO payouts (id, amount_cents, status, method, reference, requested_at) VALUES (?, ?, 'pending', ?, ?, ?)`)
      .run(payoutId, amountCents, body.method === undefined ? 'Bank account' : requireString(body.method, 'method', { max: 100 }), `PAYOUT-${Date.now()}`, stamp);
    audit('payout.requested', 'payout', payoutId, { amountCents });
    const row = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);
    sendJson(res, 201, { payout: { id: row.id, amount: euro(row.amount_cents), amountCents: row.amount_cents, status: row.status, method: row.method, reference: row.reference, requestedAt: row.requested_at, paidAt: row.paid_at } });
    return;
  }

  if (pathname === '/api/integrations') {
    if (!methodAllowed(req, res, ['GET'])) return;
    const integrations = db.prepare('SELECT * FROM integrations ORDER BY name').all().map((row) => ({ id: row.id, name: row.name, provider: row.provider, description: row.description, status: row.status, connected: row.status === 'connected', enabled: row.status === 'connected', config: safeJson(row.config_json, {}), updatedAt: row.updated_at }));
    sendJson(res, 200, { integrations });
    return;
  }

  const integrationMatch = pathname.match(/^\/api\/integrations\/([^/]+)$/);
  if (integrationMatch) {
    if (!methodAllowed(req, res, ['PATCH'])) return;
    const integrationId = decodeURIComponent(integrationMatch[1]);
    const existing = db.prepare('SELECT * FROM integrations WHERE id = ?').get(integrationId);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Intégration introuvable.');
    const body = await readJson(req);
    const requestedStatus = body.status ?? (body.connected !== undefined ? (boolean(body.connected, 'connected') ? 'connected' : 'disconnected') : undefined) ?? (body.enabled !== undefined ? (boolean(body.enabled, 'enabled') ? 'connected' : 'disconnected') : undefined);
    const status = requestedStatus === undefined ? existing.status : requireString(requestedStatus, 'status', { max: 20 });
    if (!['connected', 'disconnected'].includes(status)) throw new HttpError(422, 'VALIDATION_ERROR', 'status doit valoir connected ou disconnected.');
    let config = safeJson(existing.config_json, {});
    if (body.config !== undefined) {
      if (!body.config || Array.isArray(body.config) || typeof body.config !== 'object') throw new HttpError(422, 'VALIDATION_ERROR', 'config doit être un objet.');
      const encoded = JSON.stringify(body.config);
      if (encoded.length > 20_000) throw new HttpError(422, 'VALIDATION_ERROR', 'config est trop volumineux.');
      config = body.config;
    }
    db.prepare('UPDATE integrations SET status = ?, config_json = ?, updated_at = ? WHERE id = ?').run(status, JSON.stringify(config), nowIso(), integrationId);
    audit('integration.updated', 'integration', integrationId, { status });
    const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(integrationId);
    sendJson(res, 200, { integration: { id: row.id, name: row.name, provider: row.provider, description: row.description, status: row.status, connected: row.status === 'connected', enabled: row.status === 'connected', config: safeJson(row.config_json, {}), updatedAt: row.updated_at } });
    return;
  }

  if (pathname === '/api/settings') {
    if (!methodAllowed(req, res, ['GET', 'PATCH'])) return;
    if (req.method === 'GET') {
      const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      const settings = serializeSettings(row);
      sendJson(res, 200, { ...settings, settings });
      return;
    }
    const body = await readJson(req);
    const fields = [];
    const values = [];
    const set = (column, value) => { fields.push(`${column} = ?`); values.push(value); };
    if (body.currency !== undefined) {
      const currency = requireString(body.currency, 'currency', { min: 3, max: 3 }).toUpperCase();
      if (!['EUR', 'USD', 'GBP', 'CHF', 'CAD'].includes(currency)) throw new HttpError(422, 'VALIDATION_ERROR', 'Devise non prise en charge.');
      set('currency', currency);
    }
    if (body.timezone !== undefined) {
      const timezone = requireString(body.timezone, 'timezone', { max: 80 });
      try { new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(); } catch { throw new HttpError(422, 'VALIDATION_ERROR', 'Fuseau horaire invalide.'); }
      set('timezone', timezone);
    }
    if (body.senderName !== undefined) set('sender_name', requireString(body.senderName, 'senderName', { max: 100 }));
    if (body.senderEmail !== undefined) set('sender_email', requireEmail(body.senderEmail, 'senderEmail'));
    if (body.businessName !== undefined) set('business_name', requireString(body.businessName, 'businessName', { max: 120 }));
    if (body.supportEmail !== undefined) set('support_email', requireEmail(body.supportEmail, 'supportEmail'));
    if (body.address !== undefined) set('business_address', requireString(body.address, 'address', { min: 0, max: 500 }));
    if (body.language !== undefined) {
      const language = requireString(body.language, 'language', { min: 2, max: 5 }).toLowerCase();
      if (!['en', 'fr', 'es'].includes(language)) throw new HttpError(422, 'VALIDATION_ERROR', 'Langue non prise en charge.');
      set('language', language);
    }
    if (body.taxEnabled !== undefined) set('tax_enabled', Number(boolean(body.taxEnabled, 'taxEnabled')));
    if (body.orderNotifications !== undefined) set('order_notifications', Number(boolean(body.orderNotifications, 'orderNotifications')));
    if (body.orderEmails !== undefined && body.orderNotifications === undefined) set('order_notifications', Number(boolean(body.orderEmails, 'orderEmails')));
    if (body.payoutNotifications !== undefined) set('payout_notifications', Number(boolean(body.payoutNotifications, 'payoutNotifications')));
    if (body.payoutEmails !== undefined && body.payoutNotifications === undefined) set('payout_notifications', Number(boolean(body.payoutEmails, 'payoutEmails')));
    if (body.marketingEmails !== undefined) set('marketing_emails', Number(boolean(body.marketingEmails, 'marketingEmails')));
    if (!fields.length) throw new HttpError(422, 'VALIDATION_ERROR', 'Aucune modification reconnue.');
    set('updated_at', nowIso());
    db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
    audit('settings.updated', 'settings', '1', { fields: Object.keys(body) });
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const settings = serializeSettings(row);
    sendJson(res, 200, { ...settings, settings });
    return;
  }

  const publicStoreMatch = pathname.match(/^\/api\/public\/store\/([^/]+)$/);
  if (publicStoreMatch) {
    if (!methodAllowed(req, res, ['GET'])) return;
    const slug = decodeURIComponent(publicStoreMatch[1]);
    const row = db.prepare('SELECT published, published_snapshot_json FROM store WHERE slug = ?').get(slug);
    if (!row || !row.published || !row.published_snapshot_json) throw new HttpError(404, 'NOT_FOUND', 'Boutique publiée introuvable.');
    const snapshot = safeJson(row.published_snapshot_json, null);
    if (!snapshot) throw new HttpError(500, 'INVALID_SNAPSHOT', 'La version publiée est invalide.');
    sendJson(res, 200, { store: snapshot.store, products: snapshot.products });
    return;
  }

  if (pathname === '/api/checkout') {
    if (!methodAllowed(req, res, ['POST'])) return;
    const body = await readJson(req);
    const productId = requireString(body.productId, 'productId', { max: 120 });
    const name = requireString(body.name, 'name', { max: 120 });
    const emailAddress = requireEmail(body.email);
    const storeRow = db.prepare('SELECT published_snapshot_json FROM store WHERE id = 1 AND published = 1').get();
    const snapshot = safeJson(storeRow?.published_snapshot_json, null);
    const publishedProduct = snapshot?.products?.find((product) => product.id === productId && product.status === 'active');
    if (!publishedProduct) throw new HttpError(404, 'NOT_FOUND', 'Ce produit n’est pas disponible dans la boutique publiée.');
    const liveProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!liveProduct) throw new HttpError(409, 'PRODUCT_UNAVAILABLE', 'Ce produit n’est plus disponible. Republiez la boutique.');

    let discount = null;
    let discountCents = 0;
    if (body.discountCode !== undefined && body.discountCode !== null && String(body.discountCode).trim()) {
      const code = requireString(body.discountCode, 'discountCode', { max: 40 }).toUpperCase();
      discount = db.prepare('SELECT * FROM discounts WHERE code = ? COLLATE NOCASE').get(code);
      if (!discount || !discount.active) throw new HttpError(422, 'INVALID_DISCOUNT', 'Ce code promo est invalide.');
      if (discount.expires_at && Date.parse(discount.expires_at) < Date.now()) throw new HttpError(422, 'INVALID_DISCOUNT', 'Ce code promo a expiré.');
      if (discount.max_uses !== null && discount.uses >= discount.max_uses) throw new HttpError(422, 'INVALID_DISCOUNT', 'Ce code promo a atteint sa limite d’utilisation.');
      discountCents = discount.type === 'percent'
        ? Math.round(publishedProduct.priceCents * discount.value / 100)
        : Math.min(publishedProduct.priceCents, discount.value);
    }

    const orderId = id('ord');
    const orderNumber = `SW-${String(Date.now()).slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`;
    const entitlementId = id('ent');
    const downloadToken = token();
    const stamp = nowIso();
    let customerId;
    inTransaction(() => {
      let customer = db.prepare('SELECT * FROM customers WHERE email = ? COLLATE NOCASE').get(emailAddress);
      if (!customer) {
        customerId = id('cus');
        db.prepare(`INSERT INTO customers (id, name, email, country, source, marketing_opt_in, created_at, updated_at) VALUES (?, ?, ?, 'France', 'Store checkout', ?, ?, ?)`)
          .run(customerId, name, emailAddress, Number(Boolean(body.marketingOptIn)), stamp, stamp);
      } else {
        customerId = customer.id;
        db.prepare('UPDATE customers SET name = ?, updated_at = ? WHERE id = ?').run(name, stamp, customerId);
      }
      db.prepare(`
        INSERT INTO orders (
          id, order_number, customer_id, product_id, customer_name, customer_email,
          product_name, amount_cents, discount_cents, status, source, country, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'Store checkout', 'France', ?)
      `).run(orderId, orderNumber, customerId, productId, name, emailAddress, publishedProduct.name, Math.max(0, publishedProduct.priceCents - discountCents), discountCents, stamp);
      db.prepare(`INSERT INTO entitlements (id, order_id, product_id, email, token, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(entitlementId, orderId, productId, emailAddress, downloadToken, stamp);
      if (discount) db.prepare('UPDATE discounts SET uses = uses + 1, updated_at = ? WHERE id = ?').run(stamp, discount.id);
      refreshCustomerStats(customerId);
      audit('checkout.completed', 'order', orderId, { productId, customerId, discountId: discount?.id || null });
    });
    const order = serializeOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId));
    sendJson(res, 201, { order, downloadUrl: `/api/download/${downloadToken}` });
    return;
  }

  const downloadMatch = pathname.match(/^\/api\/download\/([^/]+)$/);
  if (downloadMatch) {
    if (!methodAllowed(req, res, ['GET'])) return;
    const downloadToken = decodeURIComponent(downloadMatch[1]);
    const entitlement = db.prepare(`
      SELECT entitlements.*, products.asset_path, products.name AS product_name,
             orders.order_number, orders.customer_name, orders.amount_cents
      FROM entitlements
      JOIN orders ON orders.id = entitlements.order_id
      LEFT JOIN products ON products.id = entitlements.product_id
      WHERE entitlements.token = ? AND orders.status = 'paid'
    `).get(downloadToken);
    if (!entitlement) throw new HttpError(404, 'NOT_FOUND', 'Lien de téléchargement invalide ou révoqué.');
    if (entitlement.asset_path) {
      const asset = resolve(DATA_DIR, entitlement.asset_path);
      if (!asset.startsWith(resolve(UPLOAD_DIR) + sep) || !existsSync(asset)) throw new HttpError(404, 'ASSET_NOT_FOUND', 'Le fichier associé est introuvable.');
      const info = await stat(asset);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${entitlement.product_name ? slugify(entitlement.product_name) : 'download'}${extname(asset)}"`,
        'Content-Length': info.size,
        'Cache-Control': 'private, no-store',
      });
      createReadStream(asset).pipe(res);
      return;
    }
    const receipt = [
      'SHOPWAY — TÉLÉCHARGEMENT DIGITAL',
      '',
      `Commande : ${entitlement.order_number}`,
      `Client : ${entitlement.customer_name}`,
      `Produit : ${entitlement.product_name || 'Produit digital'}`,
      `Montant : ${euro(entitlement.amount_cents).toFixed(2)} EUR`,
      '',
      'Merci pour votre achat. Ce fichier confirme que le téléchargement sécurisé fonctionne.',
    ].join('\n');
    const payload = Buffer.from(receipt);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slugify(entitlement.product_name || 'shopway-download')}.txt"`,
      'Content-Length': payload.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(payload);
    return;
  }

  throw new HttpError(404, 'NOT_FOUND', 'Endpoint API introuvable.');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

async function serveStatic(req, res, url) {
  if (!methodAllowed(req, res, ['GET', 'HEAD'])) return;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', 'Chemin invalide.');
  }
  if (pathname.includes('\0') || pathname.includes('\\')) throw new HttpError(400, 'INVALID_PATH', 'Chemin invalide.');
  const relative = pathname === '/' ? 'landing.html' : pathname.replace(/^\/+/, '');
  const firstSegment = relative.split('/')[0];
  if (!relative || relative.split('/').some((part) => part.startsWith('.')) || ['data', 'node_modules', 'server.mjs', 'package.json', 'package-lock.json'].includes(firstSegment)) {
    throw new HttpError(404, 'NOT_FOUND', 'Fichier introuvable.');
  }
  let filePath = resolve(ROOT_DIR, relative);
  if (filePath !== ROOT_DIR && !filePath.startsWith(ROOT_DIR + sep)) throw new HttpError(403, 'FORBIDDEN', 'Accès refusé.');
  let info;
  try {
    info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
      if (!filePath.startsWith(ROOT_DIR + sep)) throw new HttpError(403, 'FORBIDDEN', 'Accès refusé.');
      info = await stat(filePath);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, 'NOT_FOUND', 'Fichier introuvable.');
  }
  if (!info.isFile()) throw new HttpError(404, 'NOT_FOUND', 'Fichier introuvable.');
  const type = contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(filePath).pipe(res);
}

export async function handleRequest(req, res) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (error) {
    if (!res.headersSent) sendError(res, error);
    else res.destroy();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = http.createServer(handleRequest);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  server.listen(PORT, HOST, () => {
    console.log(`Shopway is running at http://${HOST}:${PORT}`);
  });

  function shutdown() {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
