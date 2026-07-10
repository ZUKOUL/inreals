const mobileMenu = document.querySelector('.mobile-menu');
const sideNav = document.querySelector('.side-nav');
const sidebarPanels = document.querySelectorAll('.side-nav, .sidebar-section, .sidebar-bottom');
const pages = document.querySelectorAll('.page');
const pageButtons = document.querySelectorAll('button[data-page]');
const navButtons = document.querySelectorAll('.side-nav button, .sidebar-section button, .sidebar-bottom button');
const simulatorForm = document.querySelector('#simulator-form');
const revenueSettingsForm = document.querySelector('#revenue-settings-form');
const themeToggle = document.querySelector('[data-theme-toggle]');
const themeIcon = document.querySelector('[data-theme-icon]');
const builderPrompt = document.querySelector('[data-builder-prompt]');
const builderStatus = document.querySelector('[data-builder-status]');
const promptTemplateLabel = document.querySelector('[data-prompt-template-label]');
const accountName = document.querySelector('[data-account-name]');
const accountEmail = document.querySelector('[data-account-email]');
const logoutButton = document.querySelector('[data-logout]');

const AUTH_SESSION_KEY = 'corya:auth-session:v1';
const SETTINGS_KEY = 'corya:simulation-settings:v1';
const REVENUE_SETTINGS_KEY = 'corya:revenue-settings:v1';
const THEME_KEY = 'corya:theme:v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const defaultSettings = {
  currency: 'EUR',
  totalRevenue: 9200,
  averageDailyRevenue: 405,
  productPrice: 27,
  averageSales: 15,
  variability: 28,
  mode: 'daily',
  seed: 'corya-sample'
};

const defaultRevenueSettings = {
  productPrice: 39,
  minSales: 5,
  maxSales: 6,
  emailDomain: 'corya.fr',
  clientNames: 'Lina Moreau\nNadia Ferrand\nJules Martin\nSofia Benali\nHugo Laurent\nCamille Roy\nNoah Petit\nMaya Cohen\nAdam Lefevre\nEva Bernard',
  products: 'Digital Download\nTemplate Shop Access\nCorya Starter\nCreator Pack\nPrivate Setup\nRevenue Report',
  blur: false,
  seed: 'corya-income'
};

let settings = loadSettings();
let revenueSettings = loadRevenueSettings();
let dashboardState = {
  range: '7',
  interval: 'day',
  compare: 'previous',
  topPeriod: 'yesterday',
  customStart: '',
  customEnd: ''
};
let revenueState = {
  range: '365',
  grain: 'day',
  customStart: '',
  customEnd: ''
};
let series = [];
let groupedSeries = [];
let revenueSeries = [];
let revenueOrders = [];

function loadAuthSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}

function applyAuthSession() {
  const session = loadAuthSession();
  if (session?.name && accountName) accountName.textContent = session.name;
  if (session?.email && accountEmail) accountEmail.textContent = session.email;
}

function signOut() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  window.location.href = '/login.html?next=%2Fworkspace%3Fpage%3Dhome';
}

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}

function applyTheme(theme) {
  const safeTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = safeTheme;
  themeToggle?.setAttribute('aria-pressed', String(safeTheme === 'dark'));
  themeToggle?.setAttribute(
    'aria-label',
    safeTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  );
  themeIcon?.setAttribute('href', safeTheme === 'dark' ? '#icon-sun' : '#icon-moon');
}

const pageExists = (page) => !!document.querySelector(`.page[data-page="${page}"]`);

const getPageFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('page');
  const fromOldHash = window.location.hash.replace('#', '');

  if (fromQuery && pageExists(fromQuery)) return fromQuery;
  if (fromOldHash && pageExists(fromOldHash)) return fromOldHash;
  return 'home';
};

const writeUrl = (page, replace = false) => {
  const url = new URL(window.location.href);
  url.hash = '';

  if (page === 'home') {
    url.searchParams.delete('page');
  } else {
    url.searchParams.set('page', page);
  }

  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ page }, '', url);
};

const showPage = (page, options = {}) => {
  const safePage = pageExists(page) ? page : 'home';

  pages.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.page === safePage);
  });

  navButtons.forEach((button) => {
    const isActive = button.dataset.page === safePage;
    button.classList.toggle('active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  mobileMenu?.setAttribute('aria-expanded', 'false');
  sidebarPanels.forEach((panel) => panel.classList.remove('open'));

  if (options.updateUrl) {
    writeUrl(safePage);
  }

  if (options.resetScroll) {
    window.scrollTo(0, 0);
    lastStableScroll = { x: 0, y: 0 };
  }
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return sanitizeSettings({ ...defaultSettings, ...saved });
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadRevenueSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(REVENUE_SETTINGS_KEY));
    return sanitizeRevenueSettings({ ...defaultRevenueSettings, ...saved });
  } catch {
    return { ...defaultRevenueSettings };
  }
}

function saveRevenueSettings() {
  localStorage.setItem(REVENUE_SETTINGS_KEY, JSON.stringify(revenueSettings));
}

function sanitizeSettings(input) {
  const productPrice = clamp(toNumber(input.productPrice, defaultSettings.productPrice), 1, 100000);
  const averageSales = clamp(toNumber(input.averageSales, defaultSettings.averageSales), 0, 100000);
  const inferredDailyRevenue = productPrice * averageSales;

  return {
    currency: input.currency === 'USD' ? 'USD' : 'EUR',
    totalRevenue: clamp(toNumber(input.totalRevenue, defaultSettings.totalRevenue), 0, 100000000),
    averageDailyRevenue: clamp(toNumber(input.averageDailyRevenue, inferredDailyRevenue || defaultSettings.averageDailyRevenue), 0, 100000000),
    productPrice,
    averageSales,
    variability: clamp(toNumber(input.variability, defaultSettings.variability), 0, 80),
    mode: input.mode === 'spread' ? 'spread' : 'daily',
    seed: String(input.seed || Date.now())
  };
}

function sanitizeRevenueSettings(input) {
  const productPrice = clamp(toNumber(input.productPrice, defaultRevenueSettings.productPrice), 1, 100000);
  const minSales = Math.round(clamp(toNumber(input.minSales, defaultRevenueSettings.minSales), 1, 100));
  const maxSales = Math.round(clamp(toNumber(input.maxSales, defaultRevenueSettings.maxSales), minSales, 100));

  return {
    productPrice,
    minSales,
    maxSales,
    emailDomain: String(input.emailDomain || defaultRevenueSettings.emailDomain).replace(/^@/, '').trim() || defaultRevenueSettings.emailDomain,
    clientNames: String(input.clientNames || defaultRevenueSettings.clientNames),
    products: String(input.products || defaultRevenueSettings.products),
    blur: Boolean(input.blur),
    seed: String(input.seed || defaultRevenueSettings.seed)
  };
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDay(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function randomFromKey(key) {
  let seed = hashString(key);
  seed += 0x6d2b79f5;
  let value = seed;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function getDayProgress() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return clamp(minutes / 1440, 0.04, 1);
}

function getMinuteOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function buildSeries() {
  const rows = [];
  const today = startOfDay(new Date());
  const start = addDays(today, -364);
  const baseDaily = settings.averageDailyRevenue || settings.productPrice * settings.averageSales;
  const expectedSales = settings.productPrice > 0 ? baseDaily / settings.productPrice : settings.averageSales;
  const variability = settings.variability / 100;

  for (let index = 0; index < 365; index += 1) {
    const date = addDays(start, index);
    const iso = isoDay(date);
    const weekday = date.getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.82 : 1;
    const mondayLift = weekday === 1 ? 1.12 : 1;
    const trend = 0.94 + index * 0.0019;
    const seasonality = 1 + Math.sin(index / 6.2) * 0.08;
    const randomSwing = (randomFromKey(`${settings.seed}:${iso}:sales`) - 0.5) * 2 * variability;
    const sales = Math.max(0, Math.round(expectedSales * weekendFactor * mondayLift * trend * seasonality * (1 + randomSwing)));
    const gross = sales * settings.productPrice;

    const refundChance = randomFromKey(`${settings.seed}:${iso}:refund`);
    const refunds = refundChance > 0.88 ? gross * (0.02 + refundChance * 0.018) : 0;
    const fees = gross * 0.036 + sales * 0.24;
    const net = Math.max(0, gross - fees - refunds);

    rows.push({
      iso,
      date,
      gross: roundMoney(gross),
      net: roundMoney(net),
      fees: roundMoney(fees),
      refunds: roundMoney(refunds),
      sales
    });
  }

  if (settings.mode === 'spread' && settings.totalRevenue > 0) {
    spreadTotalAcrossLastThirty(rows);
  }

  attachSalesEvents(rows);

  return rows;
}

function spreadTotalAcrossLastThirty(rows) {
  const lastThirty = rows.slice(-30);
  const currentTotal = lastThirty.reduce((sum, row) => sum + row.gross, 0) || 1;
  const scale = settings.totalRevenue / currentTotal;

  lastThirty.forEach((row) => {
    row.gross = roundMoney(row.gross * scale);
    row.sales = Math.max(0, Math.round(row.gross / settings.productPrice));
    row.fees = roundMoney(row.gross * 0.036 + row.sales * 0.24);
    row.refunds = roundMoney(row.refunds * scale);
    row.net = roundMoney(Math.max(0, row.gross - row.fees - row.refunds));
  });
}

function attachSalesEvents(rows) {
  const todayIso = isoDay(startOfDay(new Date()));
  const currentMinute = getMinuteOfDay();

  rows.forEach((row) => {
    const fullGross = row.gross;
    const fullSales = row.sales;
    row.fullGross = fullGross;
    row.fullSales = fullSales;
    row.fullEvents = buildDayEvents(row.iso, fullSales, fullGross);
    row.events = row.iso === todayIso
      ? row.fullEvents.filter((event) => event.minute <= currentMinute)
      : row.fullEvents;

    row.sales = row.events.length;
    row.gross = roundMoney(row.events.reduce((sum, event) => sum + event.amount, 0));
    row.refunds = roundMoney(row.refunds * (fullGross ? row.gross / fullGross : 0));
    row.fees = roundMoney(row.gross * 0.036 + row.sales * 0.24);
    row.net = roundMoney(Math.max(0, row.gross - row.fees - row.refunds));
  });
}

function buildDayEvents(iso, salesCount, gross) {
  if (!salesCount || !gross) return [];

  const hourWeights = [
    0.08, 0.05, 0.04, 0.03, 0.04, 0.08,
    0.18, 0.34, 0.52, 0.72, 0.86, 0.94,
    0.82, 0.76, 0.72, 0.84, 0.98, 1.08,
    1.16, 1.02, 0.78, 0.48, 0.28, 0.14
  ];
  const totalWeight = hourWeights.reduce((sum, weight) => sum + weight, 0);
  const rawEvents = [];

  for (let index = 0; index < salesCount; index += 1) {
    const hourRoll = randomFromKey(`${settings.seed}:${iso}:event:${index}:hour`) * totalWeight;
    let cumulative = 0;
    let hour = 9;

    for (let candidate = 0; candidate < hourWeights.length; candidate += 1) {
      cumulative += hourWeights[candidate];
      if (hourRoll <= cumulative) {
        hour = candidate;
        break;
      }
    }

    const minute = hour * 60 + Math.floor(randomFromKey(`${settings.seed}:${iso}:event:${index}:minute`) * 60);
    const amountWeight = 0.88 + randomFromKey(`${settings.seed}:${iso}:event:${index}:amount`) * 0.28;
    rawEvents.push({ minute, amountWeight });
  }

  const amountWeightTotal = rawEvents.reduce((sum, event) => sum + event.amountWeight, 0) || 1;
  let distributed = 0;

  return rawEvents
    .sort((a, b) => a.minute - b.minute)
    .map((event, index) => {
      const isLast = index === rawEvents.length - 1;
      const amount = isLast
        ? roundMoney(gross - distributed)
        : roundMoney((event.amountWeight / amountWeightTotal) * gross);
      distributed += amount;

      return {
        minute: event.minute,
        amount
      };
    });
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getCurrentRows() {
  const today = startOfDay(new Date());
  let start;
  let end = today;

  if (dashboardState.range === 'custom') {
    start = dashboardState.customStart ? parseIsoDay(dashboardState.customStart) : addDays(today, -29);
    end = dashboardState.customEnd ? parseIsoDay(dashboardState.customEnd) : today;
    if (start > end) [start, end] = [end, start];
    if (end > today) end = today;
    const firstAvailable = series[0]?.date || addDays(today, -364);
    if (start < firstAvailable) start = firstAvailable;
  } else if (dashboardState.range === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    start = addDays(today, -Number(dashboardState.range) + 1);
  }

  return series.filter((row) => row.date >= start && row.date <= end);
}

function getPreviousRows(currentRows) {
  if (!currentRows.length) return [];
  const start = currentRows[0].date;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -currentRows.length + 1);
  return series.filter((row) => row.date >= previousStart && row.date <= previousEnd);
}

function groupRows(rows, interval) {
  if (interval === 'day') {
    return rows.map((row) => ({
      iso: row.iso,
      start: row.date,
      end: row.date,
      label: formatDateShort(row.date),
      tooltipLabel: formatDateLong(row.date),
      gross: row.gross,
      net: row.net,
      sales: row.sales
    }));
  }

  if (interval === 'month') {
    const buckets = new Map();
    rows.forEach((row) => {
      const key = `${row.date.getFullYear()}-${row.date.getMonth()}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          start: row.date,
          end: row.date,
          gross: 0,
          net: 0,
          sales: 0
        });
      }
      const bucket = buckets.get(key);
      bucket.end = row.date;
      bucket.gross += row.gross;
      bucket.net += row.net;
      bucket.sales += row.sales;
    });

    return [...buckets.values()].map(normalizeBucket);
  }

  const grouped = [];
  for (let index = 0; index < rows.length; index += 7) {
    const chunk = rows.slice(index, index + 7);
    grouped.push(normalizeBucket({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      gross: chunk.reduce((sum, row) => sum + row.gross, 0),
      net: chunk.reduce((sum, row) => sum + row.net, 0),
      sales: chunk.reduce((sum, row) => sum + row.sales, 0)
    }));
  }
  return grouped;
}

function normalizeBucket(bucket) {
  const sameDay = isoDay(bucket.start) === isoDay(bucket.end);
  const sameMonth = bucket.start.getMonth() === bucket.end.getMonth() && bucket.start.getFullYear() === bucket.end.getFullYear();

  let label;
  if (dashboardState.interval === 'month') {
    label = bucket.start.toLocaleDateString('en-US', { month: 'short' });
  } else if (sameDay) {
    label = formatDateShort(bucket.start);
  } else if (sameMonth) {
    label = `${bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${bucket.end.getDate()}`;
  } else {
    label = `${formatDateShort(bucket.start)}–${formatDateShort(bucket.end)}`;
  }

  return {
    start: bucket.start,
    end: bucket.end,
    label,
    tooltipLabel: sameDay ? formatDateLong(bucket.start) : `${formatDateShort(bucket.start)} – ${formatDateShort(bucket.end)}`,
    gross: roundMoney(bucket.gross),
    net: roundMoney(bucket.net),
    sales: bucket.sales
  };
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateLong(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(value) {
  const symbol = settings.currency === 'USD' ? '$' : '€';
  const absolute = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${value < 0 ? '-' : ''}${symbol}${absolute}`;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatPercent(current, previous) {
  if (!previous) return 'No previous period';
  const delta = ((current - previous) / previous) * 100;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}% vs previous`;
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function renderDashboard() {
  series = buildSeries();
  const currentRows = getCurrentRows();
  const previousRows = getPreviousRows(currentRows);
  groupedSeries = groupRows(currentRows, dashboardState.interval);

  renderToday();
  renderOverview(currentRows, previousRows);
  renderNeoDashboard(currentRows, previousRows);
  renderRevenueDashboard();
  renderFilters();
  populateSettingsForm();
  renderSimulationPreview();
}

function renderToday() {
  const todayIso = isoDay(startOfDay(new Date()));
  const today = series.find((row) => row.iso === todayIso) || series[series.length - 1];
  const lastSeven = series.slice(-7);
  const balance = sumRows(lastSeven, 'net');
  const payouts = Math.max(0, balance * 0.72);
  const now = new Date();
  const topPeriod = getTopPeriodData(dashboardState.topPeriod, today);

  setText('[data-today-gross]', formatCurrency(today.gross));
  setText('[data-top-period-label]', topPeriod.label);
  setText('[data-top-period-value]', formatCurrency(topPeriod.value));
  setText('[data-top-period-meta]', topPeriod.meta);
  setText('[data-today-time]', now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  setText('[data-current-time-label]', now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  setText('[data-balance]', formatCurrency(balance));
  setText('[data-payouts]', formatCurrency(payouts));
  setText('[data-payout-date]', `Estimated ${formatDateShort(addDays(now, 2))}`);
  renderTopPeriodMenu();

  renderTopPeriodChart(topPeriod);
}

function getTopPeriodData(period, today) {
  const todayIndex = series.indexOf(today);
  const yesterday = series[todayIndex - 1] || today;
  const monthStart = new Date(today.date.getFullYear(), today.date.getMonth(), 1);
  const summaries = {
    yesterday: {
      period: 'yesterday',
      label: 'Yesterday',
      rows: [yesterday],
      meta: 'Previous day'
    },
    last7: {
      period: 'last7',
      label: 'Last 7 days',
      rows: series.slice(-7),
      meta: 'Rolling period'
    },
    last30: {
      period: 'last30',
      label: 'Last 30 days',
      rows: series.slice(-30),
      meta: 'Rolling period'
    },
    month: {
      period: 'month',
      label: 'This month',
      rows: series.filter((row) => row.date >= monthStart && row.date <= today.date),
      meta: 'Month to date'
    }
  };
  const summary = summaries[period] || summaries.yesterday;

  return {
    period: summary.period,
    label: summary.label,
    value: sumRows(summary.rows, 'gross'),
    sales: sumRows(summary.rows, 'sales'),
    meta: summary.meta,
    rows: summary.rows
  };
}

function renderTopPeriodMenu() {
  document.querySelectorAll('[data-top-period]').forEach((button) => {
    button.classList.toggle('active', button.dataset.topPeriod === dashboardState.topPeriod);
  });
}

function renderTopPeriodChart(topPeriod) {
  if (!topPeriod?.rows?.length) return;
  const chart = document.querySelector('[data-chart="intraday"]');

  if (topPeriod.period === 'yesterday') {
    chart?.setAttribute('aria-label', 'Gross volume by hour yesterday');
    renderIntradayChart(topPeriod.rows[0], {
      fullDay: true,
      startLabel: '12:00 AM',
      endLabel: '11:59 PM',
      defaultLabel: `${formatNumber(topPeriod.sales)} sales`
    });
    return;
  }

  chart?.setAttribute('aria-label', `Gross volume over ${topPeriod.label}`);
  renderPeriodTrendChart(topPeriod.rows, topPeriod);
}

function renderIntradayChart(row, options = {}) {
  const chart = document.querySelector('[data-chart="intraday"]');
  const line = chart?.querySelector('[data-intraday-line]');
  const projected = chart?.querySelector('[data-intraday-projected]');
  if (!chart || !line || !projected || !row) return;

  const fullDay = Boolean(options.fullDay);
  const currentMinute = fullDay ? 1440 : getMinuteOfDay();
  const actualEvents = fullDay ? (row.fullEvents || row.events || []) : (row.events || []);
  const fullEvents = row.fullEvents || actualEvents;
  const actualTotal = actualEvents.reduce((sum, event) => sum + event.amount, 0);
  const fullTotal = Math.max(row.fullGross || actualTotal, actualTotal, 1);
  const actualPoints = buildIntradayCurvePoints(actualEvents, currentMinute, actualTotal, fullTotal);
  const projectedPoints = fullDay
    ? []
    : [
        mapIntradayPoint({ minute: currentMinute, value: actualTotal }, fullTotal),
        ...buildIntradayCurvePoints(fullEvents, 1440, fullTotal, fullTotal)
          .filter((point) => point.minute > currentMinute)
      ];
  const defaultLabel = options.defaultLabel || (actualEvents.length ? `${formatNumber(actualEvents.length)} sales` : 'No sales yet');

  setSmoothPath(line, actualPoints, 0.24);
  projected.setAttribute('d', projectedPoints.length ? buildSmoothPath(projectedPoints, 0.2) : '');
  chart.__points = buildIntradayHoverPoints(actualPoints, actualEvents);
  chart.__defaultLabel = defaultLabel;
  chart.classList.remove('is-active');
  chart.__activeIndex = undefined;

  setTopChartAxis(options.startLabel || '12:00 AM', defaultLabel, options.endLabel || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
}

function renderPeriodTrendChart(rows, topPeriod) {
  const chart = document.querySelector('[data-chart="intraday"]');
  const line = chart?.querySelector('[data-intraday-line]');
  const projected = chart?.querySelector('[data-intraday-projected]');
  if (!chart || !line || !projected || !rows.length) return;

  const points = getChartPoints(rows, 'gross', 860, 180, 0, 24, 152).map((point) => ({
    ...point,
    label: formatDateShort(point.date),
    tooltipLabel: formatDateLong(point.date),
    value: point.gross
  }));
  const defaultLabel = `${formatNumber(topPeriod.sales)} sales`;

  setSmoothPath(line, points, rows.length > 12 ? 0.16 : 0.22);
  projected.setAttribute('d', '');
  chart.__points = points;
  chart.__defaultLabel = defaultLabel;
  chart.classList.remove('is-active');
  chart.__activeIndex = undefined;

  setTopChartAxis(formatDateShort(rows[0].date), defaultLabel, formatDateShort(rows[rows.length - 1].date));
}

function setTopChartAxis(startLabel, activeLabel, endLabel) {
  const labels = document.querySelectorAll('.intraday-chart .chart-times span');
  if (labels[0]) labels[0].textContent = startLabel;
  setText('[data-intraday-active-time]', activeLabel);
  setText('[data-current-time-label]', endLabel);
}

function buildIntradayCurvePoints(events, endMinute, finalAmount, maxAmount) {
  const safeEndMinute = clamp(endMinute, 0, 1440);
  const safeEvents = events
    .filter((event) => event.minute <= safeEndMinute)
    .sort((first, second) => first.minute - second.minute);
  const sampleCount = Math.max(8, Math.min(28, Math.ceil(Math.max(safeEndMinute, 1) / 52)));
  const points = [];
  let eventIndex = 0;
  let total = 0;

  for (let index = 0; index <= sampleCount; index += 1) {
    const minute = (safeEndMinute / sampleCount) * index;

    while (eventIndex < safeEvents.length && safeEvents[eventIndex].minute <= minute) {
      total += safeEvents[eventIndex].amount;
      eventIndex += 1;
    }

    points.push({ minute, value: total });
  }

  points[0] = { minute: 0, value: 0 };
  points[points.length - 1] = { minute: safeEndMinute, value: finalAmount };

  return points.map((point) => mapIntradayPoint(point, maxAmount));
}

function buildIntradayHoverPoints(points, events) {
  const safeEvents = [...events].sort((first, second) => first.minute - second.minute);
  let eventIndex = 0;

  return points.map((point) => {
    while (eventIndex < safeEvents.length && safeEvents[eventIndex].minute <= point.minute) {
      eventIndex += 1;
    }

    return {
      ...point,
      sales: eventIndex,
      tooltipLabel: `${formatTimeFromMinute(point.minute)} · ${eventIndex} sales`,
      label: formatTimeFromMinute(point.minute)
    };
  });
}

function mapIntradayPoint(point, maxAmount) {
  const width = 860;
  const height = 180;
  const top = 24;
  const bottom = 152;
  const x = (point.minute / 1440) * width;
  const y = bottom - (point.value / Math.max(maxAmount, 1)) * (bottom - top);

  return {
    ...point,
    x,
    y,
    chartWidth: width,
    chartHeight: height
  };
}

function formatTimeFromMinute(minute) {
  const safeMinute = clamp(Math.round(minute), 0, 1439);
  const hours = Math.floor(safeMinute / 60);
  const minutes = safeMinute % 60;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderOverview(currentRows, previousRows) {
  const gross = sumRows(currentRows, 'gross');
  const net = sumRows(currentRows, 'net');
  const sales = sumRows(currentRows, 'sales');
  const previousGross = sumRows(previousRows, 'gross');
  const previousNet = sumRows(previousRows, 'net');
  const dayCount = Math.max(currentRows.length, 1);
  const dailyAverage = gross / dayCount;
  const averageOrder = sales ? gross / sales : settings.productPrice;
  const today = new Date();
  const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const projectedMonth = dailyAverage * monthDays;

  setText('[data-payments-total]', formatCurrency(gross));
  setText('[data-payments-meta]', `${formatNumber(sales)} sales · ${getRangeLabel()}`);
  setText('[data-gross-total]', formatCurrency(gross));
  setText('[data-gross-previous]', dashboardState.compare === 'previous' ? `${formatCurrency(previousGross)} previous period` : `${getRangeLabel()} selected`);
  setText('[data-gross-delta]', dashboardState.compare === 'previous' ? formatPercent(gross, previousGross) : 'Compare off');
  setText('[data-net-total]', formatCurrency(net));
  setText('[data-net-previous]', dashboardState.compare === 'previous' ? `${formatCurrency(previousNet)} previous period` : `${getRangeLabel()} selected`);
  setText('[data-net-delta]', dashboardState.compare === 'previous' ? formatPercent(net, previousNet) : 'Compare off');
  setText('[data-sales-total]', formatNumber(sales));
  setText('[data-sales-meta]', `${(sales / dayCount).toFixed(1)}/day average`);
  setText('[data-average-order]', formatCurrency(averageOrder));
  setText('[data-daily-average]', formatCurrency(dailyAverage));
  setText('[data-projected-month]', formatCurrency(projectedMonth));

  renderMainChart(groupedSeries);
  renderMiniChart('gross', groupedSeries);
  renderMiniChart('net', groupedSeries);
}

function renderNeoDashboard(currentRows, previousRows) {
  const lastThirty = series.slice(-30);
  const gross = sumRows(currentRows, 'gross');
  const net = sumRows(currentRows, 'net');
  const expense = sumRows(currentRows, 'fees') + sumRows(currentRows, 'refunds');
  const previousGross = sumRows(previousRows, 'gross');
  const previousNet = sumRows(previousRows, 'net');
  const previousExpense = sumRows(previousRows, 'fees') + sumRows(previousRows, 'refunds');
  const balance = sumRows(lastThirty, 'net');

  setText('[data-neo-balance]', formatCurrency(balance));
  setText('[data-neo-income]', formatCurrency(gross));
  setText('[data-neo-expense]', formatCurrency(expense));
  renderNeoDelta('[data-neo-balance-delta]', net, previousNet);
  renderNeoDelta('[data-neo-income-delta]', gross, previousGross);
  renderNeoDelta('[data-neo-expense-delta]', expense, previousExpense, true);

  renderNeoMeter('balance', getRatio(net, Math.max(previousNet, gross * 0.75, 1)));
  renderNeoMeter('income', getRatio(gross, Math.max(previousGross, gross * 0.72, 1)));
  renderNeoMeter('expense', getRatio(expense, Math.max(gross * 0.22, previousExpense, 1)));

  renderNeoMonthChart();
  renderNeoCashflow(currentRows, previousRows);
  renderNeoTransactions(currentRows);

  const transactionLabel = dashboardState.range === 'month'
    ? 'This month'
    : `Last ${dashboardState.range} days`;
  setText('[data-neo-transactions-label]', transactionLabel);
}

function getRatio(value, max) {
  return clamp(value / Math.max(max, 1), 0.08, 1);
}

function renderNeoDelta(selector, current, previous, reverse = false) {
  const element = document.querySelector(selector);
  if (!element) return;

  const delta = previous ? ((current - previous) / previous) * 100 : 0;
  const good = reverse ? delta <= 0 : delta >= 0;
  element.classList.toggle('negative', !good);
  element.innerHTML = `<span>${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</span> vs last period`;
}

function renderNeoMeter(name, ratio) {
  const meter = document.querySelector(`[data-neo-meter="${name}"]`);
  if (!meter) return;

  const total = 28;
  const active = Math.max(3, Math.round(total * ratio));
  meter.innerHTML = Array.from({ length: total }, (_, index) => (
    `<span class="${index < active ? 'active' : ''}"></span>`
  )).join('');
}

function getMonthBuckets() {
  const today = startOfDay(new Date());
  const startMonth = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const buckets = [];

  for (let index = 0; index < 12; index += 1) {
    const date = new Date(startMonth.getFullYear(), startMonth.getMonth() + index, 1);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    buckets.push({
      key,
      date,
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      gross: 0,
      net: 0,
      sales: 0
    });
  }

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  series.forEach((row) => {
    const key = `${row.date.getFullYear()}-${row.date.getMonth()}`;
    const bucket = bucketMap.get(key);
    if (!bucket) return;

    bucket.gross += row.gross;
    bucket.net += row.net;
    bucket.sales += row.sales;
  });

  return buckets.map((bucket) => ({
    ...bucket,
    gross: roundMoney(bucket.gross),
    net: roundMoney(bucket.net)
  }));
}

function renderNeoMonthChart() {
  const chart = document.querySelector('[data-neo-month-chart]');
  if (!chart) return;

  const periods = groupedSeries.length ? groupedSeries : groupRows(getCurrentRows(), dashboardState.interval);
  const total = sumRows(periods, 'gross');
  const max = Math.max(...periods.map((period) => period.gross), 1);
  const activeIndex = periods.reduce((bestIndex, period, index, rows) => (
    period.gross > rows[bestIndex].gross ? index : bestIndex
  ), 0);
  const scale = createNeoScale(max);
  const count = periods.length;
  const barWidth = count > 180 ? 10 : count > 60 ? 14 : count > 30 ? 20 : count > 14 ? 28 : 52;
  const minWidth = Math.max(620, count * (barWidth + 8));
  setText('[data-neo-usage-total]', formatCurrency(total));
  setText('[data-neo-month-range]', getRangeLabel());

  const bars = periods.map((period, index) => {
    const height = Math.max(4, (period.gross / max) * 100);
    const paletteIndex = index % 7;
    const accent = paletteIndex === 2 || paletteIndex === 5 ? '#a98bff' : paletteIndex === 1 || paletteIndex === 4 ? '#62c5ff' : '#159cf5';
    const soft = paletteIndex === 2 || paletteIndex === 5 ? '#e0d5ff' : '#c9ecff';
    const showLabel = count <= 14 || index === 0 || index === count - 1 || index % Math.max(1, Math.ceil(count / 8)) === 0;
    return `
      <button class="neo-month-bar-wrap ${index === activeIndex ? 'active' : ''}" type="button"
        style="--bar: ${height}%; --bar-accent: ${accent}; --bar-soft: ${soft}"
        aria-label="${period.tooltipLabel}: ${formatCurrency(period.gross)}, ${formatNumber(period.sales)} sales">
        <span class="neo-month-tooltip"><strong>${formatCurrency(period.gross)}</strong><small>${period.tooltipLabel} · ${formatNumber(period.sales)} sales</small></span>
        <span class="neo-month-track"><span class="neo-month-bar"></span></span>
        <small class="neo-period-label ${showLabel ? '' : 'visually-muted'}">${showLabel ? period.label : '·'}</small>
      </button>
    `;
  }).join('');

  chart.innerHTML = `
    <div class="neo-month-scale" aria-hidden="true">
      ${scale.map((value) => `<span>${formatNeoAxis(value)}</span>`).join('')}
    </div>
    <div class="neo-month-bars-shell" tabindex="0" aria-label="Scrollable revenue chart">
      <div class="neo-month-bars" style="--bar-count: ${count}; --bar-width: ${barWidth}px; --bars-min-width: ${minWidth}px">${bars}</div>
    </div>
  `;
}

function createNeoScale(max) {
  const roughStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return [step * 4, step * 3, step * 2, step, 0];
}

function formatNeoAxis(value) {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return Math.round(value).toString();
}

function renderNeoCashflow(currentRows, previousRows) {
  const svg = document.querySelector('.neo-line-chart svg');
  const line = document.querySelector('[data-neo-line]');
  const area = document.querySelector('[data-neo-area]');
  if (!svg || !line || !area) return;

  const source = groupedSeries.length ? groupedSeries : currentRows;
  const points = getChartPoints(source, 'net', 980, 268, 12, 24, 226);
  const path = buildSmoothPath(points, source.length > 16 ? 0.12 : 0.2);
  const baseY = 240;

  line.setAttribute('d', path);
  area.setAttribute(
    'd',
    points.length
      ? `${path} L ${formatPathNumber(points[points.length - 1].x)} ${baseY} L ${formatPathNumber(points[0].x)} ${baseY} Z`
      : ''
  );

  const net = sumRows(currentRows, 'net');
  const previousNet = sumRows(previousRows, 'net');
  setText('[data-neo-cashflow-total]', formatCurrency(net));
  setText('[data-neo-cashflow-meta]', `${formatCurrency(previousNet)} previous period`);
  setText('[data-neo-growth-one]', formatNeoGrowth(currentRows.slice(-Math.min(currentRows.length, 30)), previousRows.slice(-Math.min(previousRows.length, 30))));
  setText('[data-neo-growth-two]', formatNeoGrowth(currentRows.slice(-Math.min(currentRows.length, 60)), previousRows.slice(-Math.min(previousRows.length, 60))));
  setText('[data-neo-growth-three]', formatNeoGrowth(currentRows, previousRows));
}

function formatNeoGrowth(currentRows, previousRows) {
  const current = sumRows(currentRows, 'gross');
  const previous = sumRows(previousRows, 'gross');
  if (!previous) return '+0.0% ↑';
  const delta = ((current - previous) / previous) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% ${delta >= 0 ? '↑' : '↓'}`;
}

function renderNeoTransactions(currentRows) {
  const tbody = document.querySelector('[data-neo-transactions]');
  if (!tbody) return;

  const names = ['Paypal Withdraw', 'Stripe Checkout', 'Template Sale', 'Creator Pack', 'Customer Access', 'Corya Starter', 'Digital Download'];
  const categories = ['Withdraw', 'Product', 'Template', 'Subscription', 'Access'];
  const rows = currentRows
    .slice()
    .reverse()
    .flatMap((row) => {
      const events = (row.events || []).slice(-2).reverse();
      return events.map((event, eventIndex) => ({
        name: names[Math.floor(randomFromKey(`${row.iso}:neo:name:${eventIndex}`) * names.length)],
        date: row.date,
        category: categories[Math.floor(randomFromKey(`${row.iso}:neo:cat:${eventIndex}`) * categories.length)],
        amount: event.amount,
        status: event.amount > settings.productPrice * 1.8 ? 'Completed' : 'Paid'
      }));
    })
    .slice(0, 8);

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${row.name}</strong></td>
      <td>${formatDateLong(row.date)}</td>
      <td><span class="neo-status">${row.category}</span></td>
      <td>${formatCurrency(row.amount)}</td>
      <td>${row.status}</td>
    </tr>
  `).join('');
}

function renderFilters() {
  setText('[data-range-label]', getRangeLabel());
  setText('[data-interval-label]', getIntervalLabel());
  setText('[data-compare-label]', dashboardState.compare === 'previous' ? 'Previous period' : 'Off');

  document.querySelectorAll('[data-range]').forEach((button) => {
    button.classList.toggle('active', button.dataset.range === dashboardState.range);
  });
  document.querySelectorAll('[data-interval]').forEach((button) => {
    button.classList.toggle('active', button.dataset.interval === dashboardState.interval);
  });
  document.querySelectorAll('[data-compare]').forEach((button) => {
    button.classList.toggle('active', button.dataset.compare === dashboardState.compare);
  });

  const customPanel = document.querySelector('[data-neo-custom-range]');
  customPanel?.toggleAttribute('hidden', dashboardState.range !== 'custom');
  const today = startOfDay(new Date());
  const startField = document.querySelector('[data-dashboard-start]');
  const endField = document.querySelector('[data-dashboard-end]');
  if (startField) startField.value = dashboardState.customStart || isoDay(addDays(today, -29));
  if (endField) endField.value = dashboardState.customEnd || isoDay(today);
}

function getRangeLabel() {
  if (dashboardState.range === 'month') return 'This month';
  if (dashboardState.range === 'custom') {
    const start = dashboardState.customStart ? parseIsoDay(dashboardState.customStart) : addDays(startOfDay(new Date()), -29);
    const end = dashboardState.customEnd ? parseIsoDay(dashboardState.customEnd) : startOfDay(new Date());
    return `${formatDateShort(start)} – ${formatDateShort(end)}`;
  }
  return `Last ${dashboardState.range} days`;
}

function getIntervalLabel() {
  if (dashboardState.interval === 'week') return 'Weekly';
  if (dashboardState.interval === 'month') return 'Monthly';
  return 'Daily';
}

function getListFromTextarea(value, fallback) {
  const items = String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback.split('\n').map((item) => item.trim()).filter(Boolean);
}

function buildRevenueData() {
  const rows = [];
  const orders = [];
  const today = startOfDay(new Date());
  const start = addDays(today, -364);
  const clients = getListFromTextarea(revenueSettings.clientNames, defaultRevenueSettings.clientNames);
  const products = getListFromTextarea(revenueSettings.products, defaultRevenueSettings.products);
  const salesRange = Math.max(0, revenueSettings.maxSales - revenueSettings.minSales);

  for (let dayIndex = 0; dayIndex < 365; dayIndex += 1) {
    const date = addDays(start, dayIndex);
    const iso = isoDay(date);
    const salesCount = revenueSettings.minSales + Math.round(randomFromKey(`${revenueSettings.seed}:${iso}:count`) * salesRange);
    const spikeRoll = randomFromKey(`${revenueSettings.seed}:${iso}:spike`);
    const isSpike = spikeRoll > 0.965;
    const dayOrders = [];
    let gross = 0;

    for (let saleIndex = 0; saleIndex < salesCount; saleIndex += 1) {
      const minute = getRevenueSaleMinute(iso, saleIndex);
      const client = clients[Math.floor(randomFromKey(`${revenueSettings.seed}:${iso}:client:${saleIndex}`) * clients.length) % clients.length];
      const product = products[Math.floor(randomFromKey(`${revenueSettings.seed}:${iso}:product:${saleIndex}`) * products.length) % products.length];
      const emailName = client.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '');
      const amountVariation = 0.84 + randomFromKey(`${revenueSettings.seed}:${iso}:amount:${saleIndex}`) * 0.34;
      const spikeBoost = isSpike && saleIndex < 2 ? 8.4 + randomFromKey(`${revenueSettings.seed}:${iso}:boost:${saleIndex}`) * 4.2 : 1;
      const amount = roundMoney(revenueSettings.productPrice * amountVariation * spikeBoost);
      const dateTime = new Date(date);
      dateTime.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
      const discountCode = randomFromKey(`${revenueSettings.seed}:${iso}:discount:${saleIndex}`) > 0.74
        ? ['WELCOME10', 'CREATOR20', 'LAUNCH', 'VIP'][Math.floor(randomFromKey(`${iso}:code:${saleIndex}`) * 4) % 4]
        : '—';

      const order = {
        id: `${iso}-${saleIndex}`,
        iso,
        date,
        dateTime,
        minute,
        email: `${emailName || 'client'}${Math.floor(randomFromKey(`${iso}:mail:${saleIndex}`) * 87) + 10}@${revenueSettings.emailDomain}`,
        client,
        product,
        amount,
        discountCode,
        payment: randomFromKey(`${iso}:payment:${saleIndex}`) > 0.12 ? 'Stripe' : 'Referral Bonus'
      };

      gross += amount;
      dayOrders.push(order);
      orders.push(order);
    }

    rows.push({
      iso,
      date,
      gross: roundMoney(gross),
      net: roundMoney(gross * 0.952),
      sales: salesCount,
      orders: dayOrders,
      isSpike
    });
  }

  return {
    rows,
    orders: orders.sort((a, b) => b.dateTime - a.dateTime)
  };
}

function getRevenueSaleMinute(iso, saleIndex) {
  const windows = [390, 520, 675, 815, 1010, 1220];
  const base = windows[saleIndex % windows.length] || 720;
  const jitter = Math.floor((randomFromKey(`${revenueSettings.seed}:${iso}:minute:${saleIndex}`) - 0.5) * 92);
  return clamp(base + jitter, 6 * 60, 23 * 60);
}

function getRevenueRowsInRange() {
  const today = startOfDay(new Date());
  let start;
  let end = today;

  if (revenueState.range === 'custom') {
    start = revenueState.customStart ? parseIsoDay(revenueState.customStart) : addDays(today, -29);
    end = revenueState.customEnd ? parseIsoDay(revenueState.customEnd) : today;
  } else if (revenueState.range === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    start = addDays(today, -Number(revenueState.range) + 1);
  }

  if (start > end) [start, end] = [end, start];
  return revenueSeries.filter((row) => row.date >= start && row.date <= end);
}

function groupRevenueRows(rows, grain) {
  if (grain === 'day') {
    return rows.map((row) => ({
      ...row,
      start: row.date,
      end: row.date,
      label: formatDateShort(row.date),
      tooltipLabel: formatDateLong(row.date)
    }));
  }

  if (grain === 'month') {
    const buckets = new Map();
    rows.forEach((row) => {
      const key = `${row.date.getFullYear()}-${row.date.getMonth()}`;
      if (!buckets.has(key)) {
        buckets.set(key, { start: row.date, end: row.date, gross: 0, net: 0, sales: 0, orders: [] });
      }
      const bucket = buckets.get(key);
      bucket.end = row.date;
      bucket.gross += row.gross;
      bucket.net += row.net;
      bucket.sales += row.sales;
      bucket.orders.push(...row.orders);
    });
    return [...buckets.values()].map((bucket) => normalizeRevenueBucket(bucket, grain));
  }

  const grouped = [];
  for (let index = 0; index < rows.length; index += 7) {
    const chunk = rows.slice(index, index + 7);
    grouped.push(normalizeRevenueBucket({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      gross: chunk.reduce((sum, row) => sum + row.gross, 0),
      net: chunk.reduce((sum, row) => sum + row.net, 0),
      sales: chunk.reduce((sum, row) => sum + row.sales, 0),
      orders: chunk.flatMap((row) => row.orders)
    }, grain));
  }
  return grouped;
}

function normalizeRevenueBucket(bucket, grain) {
  const sameDay = isoDay(bucket.start) === isoDay(bucket.end);
  const sameMonth = bucket.start.getMonth() === bucket.end.getMonth() && bucket.start.getFullYear() === bucket.end.getFullYear();
  let label;

  if (grain === 'month') {
    label = bucket.start.toLocaleDateString('en-US', { month: 'short' });
  } else if (sameDay) {
    label = formatDateShort(bucket.start);
  } else if (sameMonth) {
    label = `${bucket.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${bucket.end.getDate()}`;
  } else {
    label = `${formatDateShort(bucket.start)}–${formatDateShort(bucket.end)}`;
  }

  return {
    start: bucket.start,
    end: bucket.end,
    label,
    tooltipLabel: sameDay ? formatDateLong(bucket.start) : `${formatDateShort(bucket.start)} – ${formatDateShort(bucket.end)}`,
    gross: roundMoney(bucket.gross),
    net: roundMoney(bucket.net),
    sales: bucket.sales,
    orders: bucket.orders || []
  };
}

function renderRevenueDashboard() {
  const built = buildRevenueData();
  revenueSeries = built.rows;
  revenueOrders = built.orders;

  normalizeRevenueCustomRange();
  const rows = getRevenueRowsInRange();
  const grouped = groupRevenueRows(rows, revenueState.grain);
  const total = sumRows(rows, 'gross');
  const ordersInRange = rows.flatMap((row) => row.orders).sort((a, b) => b.dateTime - a.dateTime);

  setText('[data-revenue-total]', formatCurrency(total));
  setText('[data-revenue-range-label]', getRevenueRangeLabel());
  document.querySelector('[data-revenue-custom]')?.toggleAttribute('hidden', revenueState.range !== 'custom');
  const firstDate = revenueSeries[0]?.iso || '';
  const lastDate = revenueSeries[revenueSeries.length - 1]?.iso || '';
  document.querySelectorAll('[data-revenue-start], [data-revenue-end]').forEach((field) => {
    field.min = firstDate;
    field.max = lastDate;
  });
  const startField = document.querySelector('[data-revenue-start]');
  const endField = document.querySelector('[data-revenue-end]');
  if (startField) startField.value = revenueState.customStart || isoDay(addDays(startOfDay(new Date()), -29));
  if (endField) endField.value = revenueState.customEnd || lastDate;
  const blurToggle = document.querySelector('[data-revenue-blur]');
  if (blurToggle) blurToggle.checked = revenueSettings.blur;
  document.querySelector('[data-dashboard-panel="revenue"]')?.classList.toggle('is-blurred', revenueSettings.blur);

  document.querySelectorAll('[data-revenue-range]').forEach((button) => {
    button.classList.toggle('active', button.dataset.revenueRange === revenueState.range);
  });
  document.querySelectorAll('[data-revenue-grain]').forEach((button) => {
    button.classList.toggle('active', button.dataset.revenueGrain === revenueState.grain);
  });

  populateRevenueSettingsForm();
  renderRevenueChart(grouped);
  renderRevenueOrders(ordersInRange.slice(0, 28));
}

function getRevenueRangeLabel() {
  if (revenueState.range === 'custom') return 'Personnalisé';
  if (revenueState.range === 'month') return 'Ce mois';
  if (revenueState.range === '7') return '7 jours';
  if (revenueState.range === '30') return '30 jours';
  return '365 jours';
}

function renderRevenueChart(data) {
  const chart = document.querySelector('[data-revenue-chart]');
  const line = chart?.querySelector('[data-revenue-line]');
  const area = chart?.querySelector('[data-revenue-area]');
  if (!chart || !line || !area) return;

  if (!data.length) {
    line.setAttribute('d', '');
    area.setAttribute('d', '');
    chart.__points = [];
    chart.classList.remove('is-active');
    chart.__activeIndex = undefined;
    setText('[data-revenue-axis-start]', '');
    setText('[data-revenue-axis-active]', 'Aucune donnée');
    setText('[data-revenue-axis-end]', '');
    return;
  }

  const points = getChartPoints(data, 'gross', 960, 300, 34, 36, 254);
  const path = buildRevenuePath(points, data.length);
  const firstX = data.length === 1 ? Math.max(34, points[0].x - 42) : points[0].x;
  const lastX = data.length === 1 ? Math.min(926, points[0].x + 42) : points[points.length - 1].x;
  const areaPath = `${path} L ${formatPathNumber(lastX)} 268 L ${formatPathNumber(firstX)} 268 Z`;

  line.setAttribute('d', path);
  area.setAttribute('d', areaPath);
  chart.__points = points;
  chart.classList.remove('is-active');
  chart.__activeIndex = undefined;

  setText('[data-revenue-axis-start]', data[0]?.label || '');
  setText('[data-revenue-axis-active]', `${formatNumber(sumRows(data, 'sales'))} sales`);
  setText('[data-revenue-axis-end]', data[data.length - 1]?.label || '');
}

function buildRevenuePath(points, length) {
  if (length !== 1) return buildSmoothPath(points, length > 90 ? 0.08 : 0.18);
  const point = points[0];
  const startX = Math.max(34, point.x - 42);
  const endX = Math.min(926, point.x + 42);
  return `M ${formatPathNumber(startX)} ${formatPathNumber(point.y)} L ${formatPathNumber(endX)} ${formatPathNumber(point.y)}`;
}

function normalizeRevenueCustomRange() {
  if (revenueState.range !== 'custom') return;

  const today = startOfDay(new Date());
  const firstDate = revenueSeries[0]?.iso || isoDay(addDays(today, -364));
  const lastDate = revenueSeries[revenueSeries.length - 1]?.iso || isoDay(today);
  revenueState.customStart = revenueState.customStart || isoDay(addDays(today, -29));
  revenueState.customEnd = revenueState.customEnd || lastDate;

  if (revenueState.customStart < firstDate) revenueState.customStart = firstDate;
  if (revenueState.customEnd > lastDate) revenueState.customEnd = lastDate;
  if (revenueState.customStart > revenueState.customEnd) {
    const previousStart = revenueState.customStart;
    revenueState.customStart = revenueState.customEnd;
    revenueState.customEnd = previousStart;
  }
}

function renderRevenueOrders(orders) {
  const tbody = document.querySelector('[data-revenue-orders]');
  if (!tbody) return;

  tbody.innerHTML = orders.map((order) => `
    <tr>
      <td>${formatOrderDateTime(order.dateTime)}</td>
      <td data-blur-field>${escapeHtml(order.email)}</td>
      <td data-blur-field>${escapeHtml(order.client)}</td>
      <td>${escapeHtml(order.product)}</td>
      <td>${formatCurrency(order.amount)}</td>
      <td>${escapeHtml(order.discountCode)}</td>
      <td class="payment-cell">via ${escapeHtml(order.payment)}</td>
    </tr>
  `).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatOrderDateTime(date) {
  return `${formatDateShort(date)}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function setRevenueHover(chart, index) {
  const points = chart.__points || [];
  const point = points[clamp(index, 0, points.length - 1)];
  if (!point) return;

  const line = chart.querySelector('[data-revenue-hover-line]');
  const dot = chart.querySelector('[data-revenue-hover-dot]');
  const tooltip = chart.querySelector('[data-revenue-tooltip]');
  const svg = chart.querySelector('svg');
  const svgRect = svg.getBoundingClientRect();
  const chartRect = chart.getBoundingClientRect();
  const scaledX = (point.x / point.chartWidth) * svgRect.width;
  const scaledY = (point.y / point.chartHeight) * svgRect.height;
  const tooltipX = clamp(scaledX, 78, Math.max(78, svgRect.width - 78));
  const tooltipTop = clamp(scaledY + svgRect.top - chartRect.top - 8, 56, Math.max(56, svgRect.height - 4));

  line?.setAttribute('x1', point.x);
  line?.setAttribute('x2', point.x);
  dot?.setAttribute('cx', point.x);
  dot?.setAttribute('cy', point.y);

  if (tooltip) {
    tooltip.style.left = `${tooltipX + svgRect.left - chartRect.left}px`;
    tooltip.style.top = `${tooltipTop}px`;
    tooltip.querySelector('[data-revenue-tooltip-value]').textContent = formatCurrency(point.value);
    tooltip.querySelector('[data-revenue-tooltip-date]').textContent = `${point.tooltipLabel} · ${formatNumber(point.sales)} sales`;
  }

  setText('[data-revenue-axis-active]', point.label);
  chart.classList.add('is-active');
  chart.__activeIndex = index;
}

function populateRevenueSettingsForm() {
  if (!revenueSettingsForm) return;
  Object.entries(revenueSettings).forEach(([key, value]) => {
    const field = revenueSettingsForm.querySelector(`[data-revenue-setting="${key}"]`);
    if (field) field.value = value;
  });
}

function readRevenueSettingsForm() {
  const formData = new FormData(revenueSettingsForm);
  return sanitizeRevenueSettings({
    ...revenueSettings,
    productPrice: formData.get('productPrice'),
    minSales: formData.get('minSales'),
    maxSales: formData.get('maxSales'),
    emailDomain: formData.get('emailDomain'),
    clientNames: formData.get('clientNames'),
    products: formData.get('products')
  });
}

function renderMainChart(data) {
  const chart = document.querySelector('[data-chart="payments"]');
  const line = chart?.querySelector('[data-chart-line]');
  if (!chart || !line || !data.length) return;

  const points = getChartPoints(data, 'gross', 640, 240, 24, 28, 212);
  setSmoothPath(line, points, 0.2);
  chart.__points = points;

  setText('[data-axis-start]', data[0]?.label || '');
  setText('[data-axis-active]', data[Math.floor(data.length / 2)]?.label || '');
  setText('[data-axis-end]', data[data.length - 1]?.label || '');
  chart.classList.remove('is-active');
  chart.__activeIndex = undefined;
}

function renderMiniChart(key, data) {
  const line = document.querySelector(`[data-mini-line="${key}"]`);
  if (!line || !data.length) return;
  const points = getChartPoints(data, key, 260, 90, 0, 14, 70);
  setSmoothPath(line, points, 0.2);
}

function setSmoothPath(element, points, tension = 0.2) {
  element.setAttribute('d', buildSmoothPath(points, tension));
}

function buildSmoothPath(points, tension = 0.2) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${formatPathNumber(points[0].x)} ${formatPathNumber(points[0].y)}`;

  const commands = [`M ${formatPathNumber(points[0].x)} ${formatPathNumber(points[0].y)}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] || points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] || next;
    const minY = Math.min(current.y, next.y);
    const maxY = Math.max(current.y, next.y);

    const controlOne = {
      x: clamp(current.x + (next.x - previous.x) * tension, current.x, next.x),
      y: clamp(current.y + (next.y - previous.y) * tension, minY, maxY)
    };
    const controlTwo = {
      x: clamp(next.x - (afterNext.x - current.x) * tension, current.x, next.x),
      y: clamp(next.y - (afterNext.y - current.y) * tension, minY, maxY)
    };

    commands.push(
      `C ${formatPathNumber(controlOne.x)} ${formatPathNumber(controlOne.y)} ` +
        `${formatPathNumber(controlTwo.x)} ${formatPathNumber(controlTwo.y)} ` +
        `${formatPathNumber(next.x)} ${formatPathNumber(next.y)}`
    );
  }

  return commands.join(' ');
}

function formatPathNumber(value) {
  return String(Math.round(value * 100) / 100);
}

function getChartPoints(data, key, width, height, padX, top, bottom) {
  const values = data.map((item) => item[key]);
  const max = Math.max(...values, 1) * 1.16;
  const plotWidth = width - padX * 2;
  const plotHeight = bottom - top;

  return data.map((item, index) => {
    const x = data.length === 1 ? width / 2 : padX + (index / (data.length - 1)) * plotWidth;
    const y = bottom - (item[key] / max) * plotHeight;
    return {
      ...item,
      value: item[key],
      x,
      y,
      chartWidth: width,
      chartHeight: height
    };
  });
}

function getNearestPointIndexByClientX(points, svg, clientX) {
  if (!points.length) return 0;
  const svgRect = svg.getBoundingClientRect();
  const chartWidth = points[0]?.chartWidth || svgRect.width;
  const targetX = clamp((clientX - svgRect.left) / svgRect.width, 0, 1) * chartWidth;
  let closestIndex = 0;
  let closestDistance = Math.abs(points[0].x - targetX);

  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].x - targetX);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

function setChartHover(chart, index) {
  const points = chart.__points || [];
  const point = points[clamp(index, 0, points.length - 1)];
  if (!point) return;

  const line = chart.querySelector('[data-chart-hover-line]');
  const dot = chart.querySelector('[data-chart-hover-dot]');
  const tooltip = chart.querySelector('[data-chart-tooltip]');
  const svg = chart.querySelector('svg');
  const svgRect = svg.getBoundingClientRect();
  const chartRect = chart.getBoundingClientRect();
  const scaledX = (point.x / point.chartWidth) * svgRect.width;
  const scaledY = (point.y / point.chartHeight) * svgRect.height;
  const tooltipX = clamp(scaledX, 74, Math.max(74, svgRect.width - 74));
  const tooltipTop = clamp(scaledY + svgRect.top - chartRect.top - 8, 54, Math.max(54, svgRect.height - 6));

  line?.setAttribute('x1', point.x);
  line?.setAttribute('x2', point.x);
  dot?.setAttribute('cx', point.x);
  dot?.setAttribute('cy', point.y);

  if (tooltip) {
    tooltip.style.left = `${tooltipX + svgRect.left - chartRect.left}px`;
    tooltip.style.top = `${tooltipTop}px`;
    tooltip.querySelector('[data-tooltip-value]').textContent = formatCurrency(point.value);
    tooltip.querySelector('[data-tooltip-date]').textContent = point.tooltipLabel;
  }

  setText('[data-axis-active]', point.label);
  chart.classList.add('is-active');
  chart.__activeIndex = index;
}

function hideChartHover(chart) {
  if (!chart) return;
  chart.classList.remove('is-active');
  chart.__activeIndex = undefined;
}

function resetIntradayLabel() {
  const chart = document.querySelector('[data-chart="intraday"]');
  setText('[data-intraday-active-time]', chart?.__defaultLabel || 'No sales yet');
}

function setIntradayHover(chart, index) {
  const points = chart.__points || [];
  const point = points[clamp(index, 0, points.length - 1)];
  if (!point) return;

  const line = chart.querySelector('[data-intraday-hover-line]');
  const dot = chart.querySelector('[data-intraday-hover-dot]');
  const tooltip = chart.querySelector('[data-intraday-tooltip]');
  const svg = chart.querySelector('svg');
  const svgRect = svg.getBoundingClientRect();
  const chartRect = chart.getBoundingClientRect();
  const scaledX = (point.x / point.chartWidth) * svgRect.width;
  const scaledY = (point.y / point.chartHeight) * svgRect.height;
  const tooltipX = clamp(scaledX, 64, Math.max(64, svgRect.width - 64));
  const tooltipTop = clamp(scaledY + svgRect.top - chartRect.top - 6, 48, Math.max(48, svgRect.height - 10));

  line?.setAttribute('x1', point.x);
  line?.setAttribute('x2', point.x);
  dot?.setAttribute('cx', point.x);
  dot?.setAttribute('cy', point.y);

  if (tooltip) {
    tooltip.style.left = `${tooltipX + svgRect.left - chartRect.left}px`;
    tooltip.style.top = `${tooltipTop}px`;
    tooltip.querySelector('[data-intraday-tooltip-value]').textContent = formatCurrency(point.value);
    tooltip.querySelector('[data-intraday-tooltip-date]').textContent = point.tooltipLabel;
  }

  setText('[data-intraday-active-time]', point.label);
  chart.classList.add('is-active');
  chart.__activeIndex = index;
}

function populateSettingsForm() {
  if (!simulatorForm) return;
  Object.entries(settings).forEach(([key, value]) => {
    const field = simulatorForm.querySelector(`[data-setting="${key}"]`);
    if (field) field.value = value;
  });
}

function readSettingsForm(mode) {
  const formData = new FormData(simulatorForm);
  return sanitizeSettings({
    currency: formData.get('currency'),
    totalRevenue: formData.get('totalRevenue'),
    averageDailyRevenue: formData.get('averageDailyRevenue'),
    productPrice: formData.get('productPrice'),
    averageSales: formData.get('averageSales'),
    variability: formData.get('variability'),
    mode,
    seed: `${Date.now()}-${Math.random()}`
  });
}

function renderSimulationPreview() {
  const lastThirty = series.slice(-30);
  const thirtyGross = sumRows(lastThirty, 'gross');
  const dailyPace = settings.mode === 'spread' && settings.totalRevenue > 0
    ? settings.totalRevenue / 30
    : settings.averageDailyRevenue;

  setText('[data-sidebar-simulation]', `${formatCurrency(dailyPace)}/day · ${formatNumber(settings.averageSales)} sales`);
  setText('[data-preview-daily]', `${formatCurrency(dailyPace)}/day`);
  setText('[data-preview-product]', `${formatCurrency(settings.productPrice)} · ${formatNumber(settings.averageSales)} sales/day`);
  setText('[data-preview-thirty]', formatCurrency(thirtyGross));
  setText('[data-preview-mode]', settings.mode === 'spread' ? 'Distributed total' : 'Daily average');
}

function closeFilterMenus() {
  document.querySelectorAll('.filter-control.open').forEach((control) => {
    control.classList.remove('open');
    control.querySelector('[data-filter-button]')?.setAttribute('aria-expanded', 'false');
  });
}

function closeTopPeriodMenu() {
  const card = document.querySelector('[data-top-period-card]');
  card?.classList.remove('open');
  card?.querySelector('[data-top-period-button]')?.setAttribute('aria-expanded', 'false');
}

let lastStableScroll = { x: window.scrollX, y: window.scrollY };
let isRestoringScroll = false;

function isDashboardLocalSurface(target) {
  const dashboardPage = document.querySelector('.page[data-page="dashboard"]');

  if (!dashboardPage?.classList.contains('active')) return false;
  if (!(target instanceof Element)) return false;
  if (!dashboardPage.contains(target)) return false;
  if (target.closest('[data-page]')) return false;

  return !!target.closest(
    '.today-section, .overview-section, .revenue-dashboard, .dashboard-tabs, .finance-card, .interactive-chart, .mini-chart, .metrics-row, .today-side, .neo-dashboard, .neo-stat-card, .neo-chart-card, .neo-line-card, .neo-table-card'
  );
}

function rememberScrollPosition() {
  lastStableScroll = { x: window.scrollX, y: window.scrollY };
}

function rememberScrolledPosition() {
  if (isRestoringScroll) return;
  if (window.scrollY <= 0) return;

  lastStableScroll = { x: window.scrollX, y: window.scrollY };
}

function removeIconHashIfNeeded(position = lastStableScroll) {
  if (!window.location.hash.startsWith('#icon-')) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = '';
  window.history.replaceState(window.history.state, '', cleanUrl);
  window.scrollTo(position.x, position.y);
}

function restoreScrollPosition(position = lastStableScroll) {
  removeIconHashIfNeeded(position);
  window.scrollTo(position.x, position.y);
}

function stabilizeScrollPosition(position = lastStableScroll) {
  const restore = () => restoreScrollPosition(position);

  isRestoringScroll = true;
  requestAnimationFrame(restore);
  requestAnimationFrame(() => requestAnimationFrame(restore));
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 80);
  window.setTimeout(restore, 180);
  window.setTimeout(restore, 360);
  window.setTimeout(() => {
    restore();
    isRestoringScroll = false;
  }, 700);
}

function getSafeScrollPosition() {
  return { x: window.scrollX, y: window.scrollY };
}

function keepVisualButtonStill(event) {
  const position = getSafeScrollPosition();
  event.preventDefault();
  lastStableScroll = position;

  stabilizeScrollPosition(position);
}

function preserveDashboardScroll(event) {
  const target = event.target;

  if (!isDashboardLocalSurface(target)) return;

  const position = getSafeScrollPosition();
  lastStableScroll = position;
  stabilizeScrollPosition(position);
}

mobileMenu?.addEventListener('click', () => {
  const isOpen = mobileMenu.getAttribute('aria-expanded') === 'true';
  mobileMenu.setAttribute('aria-expanded', String(!isOpen));
  sidebarPanels.forEach((panel) => panel.classList.toggle('open', !isOpen));
});

pageButtons.forEach((button) => {
  button.addEventListener('click', () => {
    showPage(button.dataset.page, { updateUrl: true, resetScroll: true });
  });
});

document.querySelectorAll('[data-filter-button]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const control = button.closest('.filter-control');
    const willOpen = !control.classList.contains('open');
    closeTopPeriodMenu();
    closeFilterMenus();
    control.classList.toggle('open', willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
  });
});

document.querySelector('[data-top-period-button]')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const card = event.currentTarget.closest('[data-top-period-card]');
  const willOpen = !card.classList.contains('open');
  closeFilterMenus();
  closeTopPeriodMenu();
  card.classList.toggle('open', willOpen);
  event.currentTarget.setAttribute('aria-expanded', String(willOpen));
});

document.querySelectorAll('[data-top-period]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    dashboardState.topPeriod = button.dataset.topPeriod;
    closeTopPeriodMenu();
    renderDashboard();
  });
});

document.querySelectorAll('[data-range]').forEach((button) => {
  button.addEventListener('click', () => {
    dashboardState.range = button.dataset.range;
    if (dashboardState.range === 'custom') {
      const today = startOfDay(new Date());
      dashboardState.customStart = dashboardState.customStart || isoDay(addDays(today, -29));
      dashboardState.customEnd = dashboardState.customEnd || isoDay(today);
    }
    closeFilterMenus();
    renderDashboard();
  });
});

document.querySelectorAll('[data-dashboard-start], [data-dashboard-end]').forEach((field) => {
  field.addEventListener('change', () => {
    dashboardState.customStart = document.querySelector('[data-dashboard-start]')?.value || '';
    dashboardState.customEnd = document.querySelector('[data-dashboard-end]')?.value || '';
    dashboardState.range = 'custom';
    renderDashboard();
  });
});

document.querySelectorAll('[data-interval]').forEach((button) => {
  button.addEventListener('click', () => {
    dashboardState.interval = button.dataset.interval;
    closeFilterMenus();
    renderDashboard();
  });
});

document.querySelectorAll('[data-compare]').forEach((button) => {
  button.addEventListener('click', () => {
    dashboardState.compare = button.dataset.compare;
    closeFilterMenus();
    renderDashboard();
  });
});

document.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    const tab = button.dataset.dashboardTab;

    document.querySelectorAll('[data-dashboard-tab]').forEach((tabButton) => {
      const isActive = tabButton.dataset.dashboardTab === tab;
      tabButton.classList.toggle('active', isActive);
      tabButton.setAttribute('aria-selected', String(isActive));
    });

    document.querySelectorAll('[data-dashboard-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.dashboardPanel === tab);
    });

    renderRevenueDashboard();
  });
});

document.querySelectorAll('[data-revenue-range]').forEach((button) => {
  button.addEventListener('click', () => {
    revenueState.range = button.dataset.revenueRange;
    if (revenueState.range === '365') {
      revenueState.grain = 'month';
    } else {
      revenueState.grain = 'day';
    }
    if (revenueState.range === 'custom') {
      const today = startOfDay(new Date());
      revenueState.customStart = revenueState.customStart || document.querySelector('[data-revenue-start]')?.value || isoDay(addDays(today, -29));
      revenueState.customEnd = revenueState.customEnd || document.querySelector('[data-revenue-end]')?.value || isoDay(today);
    }
    closeFilterMenus();
    renderRevenueDashboard();
  });
});

document.querySelectorAll('[data-revenue-grain]').forEach((button) => {
  button.addEventListener('click', () => {
    revenueState.grain = button.dataset.revenueGrain;
    renderRevenueDashboard();
  });
});

document.querySelectorAll('[data-revenue-start], [data-revenue-end]').forEach((field) => {
  field.addEventListener('change', () => {
    revenueState.customStart = document.querySelector('[data-revenue-start]')?.value || '';
    revenueState.customEnd = document.querySelector('[data-revenue-end]')?.value || '';
    revenueState.range = 'custom';
    renderRevenueDashboard();
  });
});

document.querySelector('[data-revenue-blur]')?.addEventListener('change', (event) => {
  revenueSettings = sanitizeRevenueSettings({ ...revenueSettings, blur: event.currentTarget.checked });
  saveRevenueSettings();
  renderRevenueDashboard();
});

themeToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  saveTheme(nextTheme);
  applyTheme(nextTheme);
});

document.querySelectorAll('[data-template-card]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-template-card]').forEach((card) => {
      card.classList.toggle('active', card === button);
    });

    if (promptTemplateLabel) {
      promptTemplateLabel.textContent = `${button.dataset.templateCard} template selected`;
    }

    if (builderPrompt && !builderPrompt.value.trim()) {
      builderPrompt.value = button.dataset.templatePrompt || '';
    }

    if (builderStatus) {
      builderStatus.textContent = `${button.dataset.templateCard} selected. Describe what you want to launch.`;
    }
  });
});

document.querySelector('[data-launch-build]')?.addEventListener('click', () => {
  const prompt = builderPrompt?.value.trim();
  const selectedTemplate = document.querySelector('[data-template-card].active')?.dataset.templateCard || 'Product';

  if (!builderStatus) return;

  if (!prompt) {
    builderStatus.textContent = 'Write one sentence about the product you want Corya to build.';
    builderPrompt?.focus();
    return;
  }

  builderStatus.textContent = `${selectedTemplate} brief ready — builder workspace coming next.`;
});

document.addEventListener('click', () => {
  closeFilterMenus();
  closeTopPeriodMenu();
});

document.addEventListener('pointerdown', rememberScrollPosition, true);
document.addEventListener('click', preserveDashboardScroll, true);
window.addEventListener('scroll', rememberScrolledPosition, { passive: true });

document.querySelectorAll('.card-head button, [data-metric-trigger], .icon-button, .create-button, .section-actions button').forEach((button) => {
  button.addEventListener('click', keepVisualButtonStill);
});

window.addEventListener('hashchange', () => restoreScrollPosition());

const mainChart = document.querySelector('[data-chart="payments"]');
mainChart?.addEventListener('pointermove', (event) => {
  const points = mainChart.__points || [];
  if (!points.length) return;
  const svg = mainChart.querySelector('svg');
  if (!svg) return;
  setChartHover(mainChart, getNearestPointIndexByClientX(points, svg, event.clientX));
});

mainChart?.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const points = mainChart.__points || [];
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  setChartHover(mainChart, clamp((mainChart.__activeIndex || 0) + direction, 0, points.length - 1));
});

mainChart?.addEventListener('pointerleave', () => {
  hideChartHover(mainChart);
});

mainChart?.addEventListener('mouseleave', () => {
  hideChartHover(mainChart);
});

mainChart?.addEventListener('blur', () => {
  hideChartHover(mainChart);
});

const revenueChart = document.querySelector('[data-revenue-chart]');
revenueChart?.addEventListener('pointermove', (event) => {
  const points = revenueChart.__points || [];
  if (!points.length) return;
  const svg = revenueChart.querySelector('svg');
  if (!svg) return;
  setRevenueHover(revenueChart, getNearestPointIndexByClientX(points, svg, event.clientX));
});

revenueChart?.addEventListener('pointerleave', () => {
  hideChartHover(revenueChart);
  setText('[data-revenue-axis-active]', `${formatNumber(sumRows(getRevenueRowsInRange(), 'sales'))} sales`);
});

revenueChart?.addEventListener('mouseleave', () => {
  hideChartHover(revenueChart);
});

revenueChart?.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const points = revenueChart.__points || [];
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  setRevenueHover(revenueChart, clamp((revenueChart.__activeIndex || 0) + direction, 0, points.length - 1));
});

revenueChart?.addEventListener('blur', () => {
  hideChartHover(revenueChart);
});

const intradayChart = document.querySelector('[data-chart="intraday"]');
intradayChart?.addEventListener('pointermove', (event) => {
  const points = intradayChart.__points || [];
  if (!points.length) return;
  const svg = intradayChart.querySelector('svg');
  if (!svg) return;
  setIntradayHover(intradayChart, getNearestPointIndexByClientX(points, svg, event.clientX));
});

intradayChart?.addEventListener('pointerleave', () => {
  hideChartHover(intradayChart);
  resetIntradayLabel();
});

intradayChart?.addEventListener('mouseleave', () => {
  hideChartHover(intradayChart);
  resetIntradayLabel();
});

intradayChart?.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const points = intradayChart.__points || [];
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  setIntradayHover(intradayChart, clamp((intradayChart.__activeIndex || 0) + direction, 0, points.length - 1));
});

intradayChart?.addEventListener('blur', () => {
  hideChartHover(intradayChart);
});

document.addEventListener('pointermove', (event) => {
  if (mainChart?.classList.contains('is-active') && !mainChart.contains(event.target)) {
    hideChartHover(mainChart);
  }

  if (intradayChart?.classList.contains('is-active') && !intradayChart.contains(event.target)) {
    hideChartHover(intradayChart);
    resetIntradayLabel();
  }

  if (revenueChart?.classList.contains('is-active') && !revenueChart.contains(event.target)) {
    hideChartHover(revenueChart);
  }
});

simulatorForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const action = event.submitter?.dataset.simulate || 'daily';
  settings = readSettingsForm(action === 'spread' ? 'spread' : 'daily');
  saveSettings();
  renderDashboard();
});

revenueSettingsForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  revenueSettings = readRevenueSettingsForm();
  saveRevenueSettings();
  renderRevenueDashboard();
});

document.querySelector('[data-revenue-reset]')?.addEventListener('click', () => {
  revenueSettings = sanitizeRevenueSettings({ ...defaultRevenueSettings, seed: `${Date.now()}-revenue-reset` });
  saveRevenueSettings();
  renderRevenueDashboard();
});

document.querySelector('[data-revenue-regenerate]')?.addEventListener('click', (event) => {
  event.preventDefault();
  revenueSettings = sanitizeRevenueSettings({ ...revenueSettings, seed: `${Date.now()}-revenue` });
  saveRevenueSettings();
  renderRevenueDashboard();
});

document.querySelector('[data-simulate="reset"]')?.addEventListener('click', () => {
  settings = sanitizeSettings({ ...defaultSettings, seed: `${Date.now()}-reset` });
  saveSettings();
  renderDashboard();
});

logoutButton?.addEventListener('click', signOut);

window.addEventListener('popstate', () => {
  showPage(getPageFromUrl(), { resetScroll: true });
});

setInterval(() => {
  renderDashboard();
}, 60 * 1000);

const initialPage = getPageFromUrl();
applyAuthSession();
applyTheme(loadTheme());
renderDashboard();
showPage(initialPage);
writeUrl(initialPage, true);
