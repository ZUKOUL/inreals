const mobileMenu = document.querySelector('.mobile-menu');
const sideNav = document.querySelector('.side-nav');
const sidebarPanels = document.querySelectorAll('.side-nav, .sidebar-section, .sidebar-bottom');
const pages = document.querySelectorAll('.page');
const pageButtons = document.querySelectorAll('button[data-page]');
const navButtons = document.querySelectorAll('.side-nav button, .sidebar-section button, .sidebar-bottom button');
const simulatorForm = document.querySelector('#simulator-form');
const themeToggle = document.querySelector('[data-theme-toggle]');
const themeIcon = document.querySelector('[data-theme-icon]');
const builderPrompt = document.querySelector('[data-builder-prompt]');
const builderStatus = document.querySelector('[data-builder-status]');
const promptTemplateLabel = document.querySelector('[data-prompt-template-label]');

const SETTINGS_KEY = 'corya:simulation-settings:v1';
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

let settings = loadSettings();
let dashboardState = {
  range: '7',
  interval: 'day',
  compare: 'previous',
  topPeriod: 'yesterday'
};
let series = [];
let groupedSeries = [];

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
  const start = addDays(today, -89);
  const baseDaily = settings.averageDailyRevenue || settings.productPrice * settings.averageSales;
  const expectedSales = settings.productPrice > 0 ? baseDaily / settings.productPrice : settings.averageSales;
  const variability = settings.variability / 100;

  for (let index = 0; index < 90; index += 1) {
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

  if (dashboardState.range === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    start = addDays(today, -Number(dashboardState.range) + 1);
  }

  return series.filter((row) => row.date >= start && row.date <= today);
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
}

function getRangeLabel() {
  if (dashboardState.range === 'month') return 'This month';
  return `Last ${dashboardState.range} days`;
}

function getIntervalLabel() {
  if (dashboardState.interval === 'week') return 'Weekly';
  if (dashboardState.interval === 'month') return 'Monthly';
  return 'Daily';
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
    '.today-section, .overview-section, .finance-card, .interactive-chart, .mini-chart, .metrics-row, .today-side'
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
    closeFilterMenus();
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
});

simulatorForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const action = event.submitter?.dataset.simulate || 'daily';
  settings = readSettingsForm(action === 'spread' ? 'spread' : 'daily');
  saveSettings();
  renderDashboard();
});

document.querySelector('[data-simulate="reset"]')?.addEventListener('click', () => {
  settings = sanitizeSettings({ ...defaultSettings, seed: `${Date.now()}-reset` });
  saveSettings();
  renderDashboard();
});

window.addEventListener('popstate', () => {
  showPage(getPageFromUrl(), { resetScroll: true });
});

setInterval(() => {
  renderDashboard();
}, 60 * 1000);

const initialPage = getPageFromUrl();
applyTheme(loadTheme());
renderDashboard();
showPage(initialPage);
writeUrl(initialPage, true);
