(() => {
  'use strict';

  const PAGES = [
    ['dashboard', 'Dashboard', 'bar-chart'],
    ['storefront', 'Storefront', 'layout'],
    ['products', 'Products', 'cube'],
    ['orders', 'Orders', 'receipt'],
    ['customers', 'Customers', 'users'],
    ['marketing', 'Marketing', 'repeat'],
    ['analytics', 'Analytics', 'pie-chart'],
    ['finance', 'Finance', 'wallet'],
    ['integrations', 'Integrations', 'code-browser'],
    ['settings', 'Settings', 'settings'],
    ['admin-lab', 'Admin Lab', 'code']
  ];

  const PAGE_META = Object.fromEntries(PAGES.map(([id, label, icon]) => [id, { label, icon }]));
  const THEME_KEY = 'corya:theme:v1';
  const DASHBOARD_CHART_KEY = 'corya:dashboard-chart:v1';
  const DASHBOARD_CHART_TYPES = new Set(['bars', 'line', 'donut']);
  const app = {
    page: 'dashboard',
    routeToken: 0,
    dashboardRange: '30',
    dashboardStart: '',
    dashboardEnd: '',
    dashboardChartType: 'bars',
    analyticsRange: '30',
    analyticsStart: '',
    analyticsEnd: '',
    orderSearch: '',
    orderStatus: '',
    orderProduct: '',
    orderPage: 0,
    usageSearch: '',
    usageSort: 'user',
    usageSortDirection: 'asc',
    cache: {},
    chartCleanup: null
  };

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const uid = () => `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const num = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const money = (value, currency = 'EUR') => new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 2
  }).format(num(value));
  const compactMoney = (value, currency = 'EUR') => new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: currency || 'EUR', notation: 'compact', maximumFractionDigits: 1
  }).format(num(value));
  const integer = (value) => new Intl.NumberFormat('fr-FR').format(num(value));
  const percent = (value) => `${num(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`;
  const dateText = (value, options = { day: '2-digit', month: 'short', year: 'numeric' }) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat('en-GB', options).format(date);
  };
  const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'SW';
  const list = (data, key) => Array.isArray(data) ? data : (data?.[key] || data?.items || data?.data || []);
  const valueOf = (object, keys, fallback = 0) => {
    for (const key of keys) if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
    return fallback;
  };
  const metricValue = (metrics, key, fallback = 0) => valueOf(metrics?.[key], ['value'], metrics?.[key] ?? fallback);
  const metricChange = (metrics, key) => num(valueOf(metrics?.[key], ['change'], 0));
  const hasMetric = (metrics, key) => metrics?.[key] !== undefined && metrics?.[key] !== null;

  async function request(path, options = {}) {
    const config = { method: options.method || 'GET', headers: { Accept: 'application/json', ...(options.headers || {}) } };
    if (options.body !== undefined) {
      const raw = options.raw || options.body instanceof Blob || options.body instanceof FormData || typeof options.body === 'string';
      if (raw) config.body = options.body;
      else {
        config.headers['Content-Type'] = 'application/json';
        config.body = JSON.stringify(options.body);
      }
    }
    const response = await fetch(path, config);
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload.message || payload.error || '';
      } catch {
        detail = await response.text().catch(() => '');
      }
      throw new Error(detail || `Request failed (${response.status})`);
    }
    if (options.blob) return response.blob();
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : response.text();
  }

  function icon(name, className = '') {
    return `<svg class="ws-icon ${className}" aria-hidden="true"><use href="#icon-${esc(name)}"></use></svg>`;
  }

  function pageTitle(title, description, actions = '') {
    return `<header class="ws-page-heading">
      <div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>
      ${actions ? `<div class="ws-heading-actions">${actions}</div>` : ''}
    </header>`;
  }

  function button(label, action, options = {}) {
    const kind = options.kind || 'secondary';
    return `<button class="ws-button ws-button--${kind}" type="button" data-action="${esc(action)}"${options.id ? ` data-id="${esc(options.id)}"` : ''}${options.disabled ? ' disabled' : ''}>${options.icon ? icon(options.icon) : ''}<span>${esc(label)}</span></button>`;
  }

  function skeleton(rows = 4) {
    return `<div class="ws-loading" role="status" aria-label="Loading"><span></span>${Array.from({ length: rows }, () => '<i></i>').join('')}</div>`;
  }

  function emptyState(title, text, action = '') {
    return `<div class="ws-empty">${icon('cube')}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
  }

  function errorState(error) {
    return `<div class="ws-error" role="alert">${icon('help')}<div><h2>Unable to load this page</h2><p>${esc(error.message || error)}</p></div>${button('Try again', 'retry-page')}</div>`;
  }

  function badge(value, tone = '') {
    const safe = String(value || 'Unknown');
    const inferred = tone || (/paid|active|sent|completed|connected|published/i.test(safe) ? 'success' : /refund|failed|cancel|expired/i.test(safe) ? 'danger' : 'neutral');
    return `<span class="ws-badge ws-badge--${inferred}">${esc(safe)}</span>`;
  }

  function usageShell() {
    const sidebarLink = (id, label, iconName, extra = '') => `<button type="button" class="ws-usage-nav-item ${extra}" data-nav="${esc(id)}">${icon(iconName)}<span>${esc(label)}</span></button>`;
    return `<main class="ws-app ws-app--usage" data-shell="usage">
      <aside class="ws-usage-sidebar" aria-label="Usage workspace navigation">
        <div class="ws-usage-sidebar-head">
          <button class="ws-usage-brand" type="button" data-nav="dashboard" aria-label="Open Usage and Analytics"><span class="ws-usage-brand-orb"></span><span>shopway</span></button>
          <button class="ws-usage-collapse" type="button" data-action="toggle-usage-sidebar" aria-label="Collapse navigation">${icon('chevron-left')}</button>
        </div>
        <nav class="ws-usage-nav ws-usage-nav--primary">
          <button type="button" class="ws-usage-new-chat" data-action="new-campaign">${icon('plus')}<span>New chat</span></button>
          ${sidebarLink('products', 'Library', 'folder')}
          ${sidebarLink('dashboard', 'Usage & Analytics', 'bar-chart', 'is-active')}
          ${sidebarLink('storefront', 'Discover', 'book')}
        </nav>
        <div class="ws-usage-sidebar-scroll">
          <section class="ws-usage-sidebar-section"><h2>Pinned</h2>
            ${sidebarLink('marketing', 'Marketing Strategy', 'folder')}
            ${sidebarLink('analytics', 'Competitor Research', 'folder')}
            ${sidebarLink('storefront', 'SEO Content Plan', 'folder')}
          </section>
          <section class="ws-usage-sidebar-section"><h2>Today</h2>
            ${sidebarLink('marketing', 'Q3 marketing campaign', 'blank')}
            ${sidebarLink('customers', 'Customer interview summary', 'blank')}
            ${sidebarLink('analytics', 'Weekly performance report', 'blank')}
          </section>
          <section class="ws-usage-sidebar-section"><h2>Yesterday</h2>
            ${sidebarLink('marketing', 'AI feature brainstorm', 'blank')}
            ${sidebarLink('analytics', 'Competitor analysis', 'blank')}
            ${sidebarLink('storefront', 'UX research notes', 'blank')}
            ${sidebarLink('products', 'Content calendar', 'blank')}
            ${sidebarLink('admin-lab', 'Pricing strategy', 'blank')}
          </section>
        </div>
        <nav class="ws-usage-sidebar-foot">
          <button type="button" data-action="notifications">${icon('bell')}<span>Notification</span></button>
          ${sidebarLink('settings', 'Profile', 'users')}
          ${sidebarLink('admin-lab', 'Upgrade', 'diamond')}
          ${sidebarLink('integrations', 'Install', 'download')}
        </nav>
      </aside>
      <section class="ws-workspace ws-usage-workspace">
        <header class="ws-topbar ws-usage-topbar">
          <div class="ws-usage-title"><button class="ws-usage-back" type="button" data-nav="dashboard" aria-label="Back to dashboard">${icon('arrow-left')}</button><h1>Usage &amp; Analytics</h1></div>
          <div class="ws-usage-top-actions">
            <span class="ws-usage-updated">${icon('clock')}<span>Last updated 2m ago</span></span><span class="ws-usage-divider" aria-hidden="true"></span>
            <button class="ws-usage-control" type="button" data-action="usage-range-menu" aria-haspopup="menu" aria-expanded="false">${icon('calendar')}<span data-usage-range-label>Last 30 days</span>${icon('chevron-down')}</button>
          </div>
          <div class="ws-usage-range-menu" data-usage-range-menu hidden role="menu">${['24h', '7', '30', '90', '365', 'custom'].map((range) => `<button type="button" data-action="dashboard-range" data-range="${range}" role="menuitem">${range === '24h' ? 'Last 24 hours' : range === 'custom' ? 'Custom range' : `Last ${range} days`}</button>`).join('')}</div>
        </header>
        <div class="ws-search-results" data-search-results hidden></div>
        <section class="ws-content" id="ws-content" tabindex="-1"></section>
      </section>
      <div class="ws-toast-region" aria-live="polite" aria-atomic="true"></div>
      <dialog class="ws-modal" data-modal><div class="ws-modal-card"><header><div><p data-modal-kicker>Workspace</p><h2 data-modal-title>Modal</h2></div><button class="ws-icon-button" type="button" data-action="close-modal" aria-label="Close">${icon('plus')}</button></header><div class="ws-modal-body" data-modal-body></div></div></dialog>
    </main>`;
  }

  function shell(variant = 'shopway') {
    if (variant === 'usage') return usageShell();
    const nav = PAGES.map(([id, label, iconName]) => `<button type="button" class="ws-nav-item" data-nav="${id}">
      ${icon(iconName)}<span>${label}</span>
    </button>`).join('');
    return `<main class="ws-app" data-shell="shopway">
      <aside class="ws-sidebar" id="ws-sidebar" aria-label="Shopway navigation">
        <div class="ws-sidebar-head">
          <button class="ws-brand" type="button" data-nav="dashboard" aria-label="Shopway dashboard"><span class="ws-brand-mark">S</span><span>shopway</span></button>
          <button class="ws-icon-button ws-drawer-close" type="button" data-action="close-drawer" aria-label="Close navigation">${icon('plus')}</button>
        </div>
        <label class="ws-side-search">${icon('search')}<input type="search" data-sidebar-search placeholder="Search menu" aria-label="Search navigation"></label>
        <nav class="ws-nav">${nav}</nav>
        <div class="ws-sidebar-foot">
          <div class="ws-plan"><span>Shopway Pro</span><small>Digital commerce workspace</small></div>
          <button type="button" class="ws-account" data-nav="settings"><span class="ws-avatar">SW</span><span><b>Shopway Store</b><small>Manage account</small></span>${icon('chevron-down')}</button>
        </div>
      </aside>
      <div class="ws-drawer-scrim" data-action="close-drawer"></div>
      <section class="ws-workspace">
        <header class="ws-topbar">
          <button class="ws-icon-button ws-menu-button" type="button" data-action="open-drawer" aria-label="Open navigation" aria-expanded="false">${icon('layout')}</button>
          <label class="ws-global-search">${icon('search')}<input type="search" data-global-search placeholder="Search products, orders and customers" aria-label="Search workspace"><kbd>⌘ K</kbd></label>
          <div class="ws-top-actions">
            <button class="ws-icon-button" type="button" data-action="notifications" aria-label="Notifications">${icon('bell')}<span class="ws-notification-dot"></span></button>
            <button class="ws-icon-button" type="button" data-action="toggle-theme" aria-label="Toggle theme">${icon('moon', 'ws-theme-icon')}</button>
            <button class="ws-button ws-button--primary ws-create-trigger" type="button" data-action="toggle-create">${icon('plus')}<span>Create</span></button>
          </div>
          <div class="ws-create-menu" data-create-menu hidden>
            <button type="button" data-action="new-product">${icon('cube')}<span><b>Product</b><small>Add a digital product</small></span></button>
            <button type="button" data-action="new-customer">${icon('users')}<span><b>Customer</b><small>Add a customer record</small></span></button>
            <button type="button" data-action="new-discount">${icon('repeat')}<span><b>Discount</b><small>Create a promotion</small></span></button>
            <button type="button" data-action="new-campaign">${icon('bell')}<span><b>Campaign</b><small>Email your audience</small></span></button>
          </div>
        </header>
        <div class="ws-search-results" data-search-results hidden></div>
        <section class="ws-content" id="ws-content" tabindex="-1"></section>
      </section>
      <div class="ws-toast-region" aria-live="polite" aria-atomic="true"></div>
      <dialog class="ws-modal" data-modal><div class="ws-modal-card"><header><div><p data-modal-kicker>Shopway</p><h2 data-modal-title>Modal</h2></div><button class="ws-icon-button" type="button" data-action="close-modal" aria-label="Close">${icon('plus')}</button></header><div class="ws-modal-body" data-modal-body></div></div></dialog>
    </main>`;
  }

  function setContent(html) {
    const content = $('#ws-content');
    if (content) content.innerHTML = html;
  }

  function toast(message, tone = 'success') {
    const region = $('.ws-toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `ws-toast ws-toast--${tone}`;
    item.innerHTML = `${icon(tone === 'success' ? 'home' : 'help')}<span>${esc(message)}</span>`;
    region.append(item);
    window.setTimeout(() => item.remove(), 3800);
  }

  function showModal(title, body, kicker = 'Shopway') {
    const modal = $('[data-modal]');
    $('[data-modal-title]').textContent = title;
    $('[data-modal-kicker]').textContent = kicker;
    $('[data-modal-body]').innerHTML = body;
    if (!modal.open) modal.showModal();
    const first = $('input, select, textarea, button', $('[data-modal-body]'));
    window.setTimeout(() => first?.focus(), 30);
  }

  function closeModal() {
    const modal = $('[data-modal]');
    if (modal?.open) modal.close();
  }

  function formField(label, name, options = {}) {
    const id = uid();
    const required = options.required ? ' required' : '';
    const help = options.help ? `<small>${esc(options.help)}</small>` : '';
    let control;
    if (options.type === 'textarea') control = `<textarea id="${id}" name="${esc(name)}" placeholder="${esc(options.placeholder || '')}"${required}>${esc(options.value || '')}</textarea>`;
    else if (options.type === 'select') control = `<select id="${id}" name="${esc(name)}"${required}>${(options.options || []).map(([value, text]) => `<option value="${esc(value)}"${String(options.value) === String(value) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
    else control = `<input id="${id}" name="${esc(name)}" type="${esc(options.type || 'text')}" value="${esc(options.value ?? '')}" placeholder="${esc(options.placeholder || '')}"${options.step ? ` step="${esc(options.step)}"` : ''}${options.min !== undefined ? ` min="${esc(options.min)}"` : ''}${options.max !== undefined ? ` max="${esc(options.max)}"` : ''}${required}>`;
    return `<label class="ws-field"><span>${esc(label)}</span>${control}${help}</label>`;
  }

  function modalSubmit(label) {
    return `<div class="ws-form-actions"><button class="ws-button ws-button--secondary" type="button" data-action="close-modal">Cancel</button><button class="ws-button ws-button--primary" type="submit">${esc(label)}</button></div>`;
  }

  function currentPage() {
    const value = new URLSearchParams(location.search).get('page') || 'dashboard';
    return PAGE_META[value] ? value : 'dashboard';
  }

  function updateActiveNavigation() {
    $$('[data-nav]').forEach((item) => {
      const active = item.dataset.nav === app.page;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.title = `${PAGE_META[app.page].label} — Shopway`;
  }

  function navigate(page, replace = false) {
    const safe = PAGE_META[page] ? page : 'dashboard';
    const url = new URL(location.href);
    url.searchParams.set('page', safe);
    history[replace ? 'replaceState' : 'pushState']({ page: safe }, '', url);
    const existingShell = $('.ws-app');
    if (existingShell?.dataset.shell !== 'shopway') {
      if (existingShell) existingShell.outerHTML = shell('shopway');
    }
    app.page = safe;
    closeDrawer();
    updateActiveNavigation();
    renderPage();
  }

  function openDrawer() {
    $('.ws-app')?.classList.add('is-drawer-open');
    $('.ws-menu-button')?.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    $('.ws-app')?.classList.remove('is-drawer-open');
    $('.ws-menu-button')?.setAttribute('aria-expanded', 'false');
  }

  function queryWith(path, parameters) {
    const url = new URL(path, location.origin);
    Object.entries(parameters).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, value);
    });
    return `${url.pathname}${url.search}`;
  }

  function metricCard(label, value, change, iconName = 'bar-chart') {
    const direction = num(change) > 0 ? 'up' : num(change) < 0 ? 'down' : 'flat';
    return `<article class="ws-metric-card"><div class="ws-card-label">${icon(iconName)}<span>${esc(label)}</span></div><strong>${esc(value)}</strong><p class="ws-change ws-change--${direction}">${num(change) > 0 ? '+' : ''}${percent(change)} <span>vs previous period</span></p></article>`;
  }

  function dashboardChartSwitcher(activeType) {
    const options = [
      ['bars', 'Rounded bars'],
      ['line', 'Smooth line'],
      ['donut', 'Donut mix']
    ];
    return `<div class="ws-chart-switcher" role="group" aria-label="Chart display">${options.map(([type, label]) => `<button type="button" data-action="dashboard-chart-type" data-chart-type="${type}" class="${activeType === type ? 'is-active' : ''}" aria-pressed="${activeType === type}" title="${label}">
      <span class="ws-chart-glyph ws-chart-glyph--${type}" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span>
    </button>`).join('')}</div>`;
  }

  function smoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    return points.slice(0, -1).reduce((path, point, index) => {
      const previous = points[index - 1] || point;
      const next = points[index + 1];
      const after = points[index + 2] || next;
      const controlOneX = point.x + (next.x - previous.x) / 6;
      const controlOneY = point.y + (next.y - previous.y) / 6;
      const controlTwoX = next.x - (after.x - point.x) / 6;
      const controlTwoY = next.y - (after.y - point.y) / 6;
      return `${path} C ${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)}, ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
    }, `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`);
  }

  function groupedRevenueSeries(series) {
    if (!series.length) return [];
    const desiredBuckets = series.length <= 7 ? series.length : series.length <= 31 ? 5 : 6;
    const bucketSize = Math.ceil(series.length / desiredBuckets);
    const buckets = [];
    for (let start = 0; start < series.length; start += bucketSize) {
      const items = series.slice(start, start + bucketSize);
      const first = items[0];
      const last = items[items.length - 1];
      buckets.push({
        label: first.label === last.label ? first.label : `${first.label} – ${last.label}`,
        value: items.reduce((total, point) => total + point.value, 0),
        orders: items.reduce((total, point) => total + point.orders, 0)
      });
    }
    return buckets;
  }

  function revenueChart(series, currency, type) {
    if (!series.length) return emptyState('No revenue yet', 'Your chart will appear after your first sale.');
    const max = Math.max(...series.map((point) => point.value), 1);
    const labelEvery = series.length <= 14 ? 1 : series.length <= 45 ? 5 : series.length <= 120 ? 15 : 60;

    if (type === 'line') {
      const step = series.length <= 31 ? 34 : series.length <= 120 ? 20 : 14;
      const width = Math.max(720, ((series.length - 1) * step) + 80);
      const chartTop = 28;
      const chartBase = 228;
      const points = series.map((point, index) => ({
        ...point,
        x: series.length === 1 ? width / 2 : 40 + (index * ((width - 80) / (series.length - 1))),
        y: chartBase - ((point.value / max) * (chartBase - chartTop))
      }));
      const line = smoothPath(points);
      const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${chartBase} L ${points[0].x.toFixed(2)} ${chartBase} Z`;
      const horizontalGrid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = chartBase - (ratio * (chartBase - chartTop));
        return `<line x1="32" y1="${y}" x2="${width - 32}" y2="${y}"></line>`;
      }).join('');
      return `<div class="ws-line-chart-scroll"><svg class="ws-line-chart" data-chart viewBox="0 0 ${width} 276" role="img" aria-label="Smooth revenue chart" style="width:${width}px">
        <defs><linearGradient id="ws-revenue-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--ws-blue)" stop-opacity=".24"></stop><stop offset="100%" stop-color="var(--ws-blue)" stop-opacity=".015"></stop></linearGradient></defs>
        <g class="ws-line-grid">${horizontalGrid}</g>
        <path class="ws-line-area" d="${area}"></path><path class="ws-line-path" d="${line}"></path>
        ${points.map((point, index) => {
          const detail = `${point.label} · ${money(point.value, currency)} · ${integer(point.orders)} order${point.orders === 1 ? '' : 's'}`;
          const tooltipWidth = 190;
          const tooltipX = Math.min(Math.max(point.x - (tooltipWidth / 2), 8), width - tooltipWidth - 8);
          const tooltipY = point.y < 62 ? point.y + 14 : point.y - 46;
          return `<g class="ws-chart-point ws-chart-interactive" data-chart-key="point-${index}" tabindex="0" role="button" aria-label="${esc(detail)}">
            <circle class="ws-line-hit" cx="${point.x}" cy="${point.y}" r="13"></circle><circle class="ws-line-dot" cx="${point.x}" cy="${point.y}" r="4"></circle>
            <foreignObject class="ws-line-tooltip" x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="36"><div xmlns="http://www.w3.org/1999/xhtml">${esc(detail)}</div></foreignObject>
          </g>
          ${index % labelEvery === 0 || index === points.length - 1 ? `<text class="ws-line-label" x="${point.x}" y="258" text-anchor="middle">${esc(point.label)}</text>` : ''}`;
        }).join('')}
      </svg></div>`;
    }

    if (type === 'donut') {
      const buckets = groupedRevenueSeries(series);
      const total = Math.max(buckets.reduce((sum, bucket) => sum + bucket.value, 0), 1);
      let offset = 0;
      const segments = buckets.map((bucket, index) => {
        const share = (bucket.value / total) * 100;
        const visibleShare = Math.max(share - Math.min(1.1, share * 0.12), 0.2);
        const detail = `${bucket.label} · ${money(bucket.value, currency)} · ${percent(share)} of revenue`;
        const segment = `<g class="ws-donut-segment ws-chart-interactive" data-chart-key="bucket-${index}" tabindex="0" role="button" aria-label="${esc(detail)}" style="--segment-color:var(--ws-donut-${(index % 6) + 1})">
          <circle cx="142" cy="136" r="82" pathLength="100" stroke-dasharray="${visibleShare.toFixed(3)} ${(100 - visibleShare).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}"></circle>
          <foreignObject class="ws-donut-tooltip" x="62" y="104" width="160" height="66"><div xmlns="http://www.w3.org/1999/xhtml"><b>${esc(bucket.label)}</b><span>${money(bucket.value, currency)} · ${percent(share)}</span></div></foreignObject>
        </g>`;
        offset += share;
        return segment;
      }).join('');
      return `<div class="ws-donut-layout" data-chart>
        <svg class="ws-donut-chart" viewBox="0 0 284 272" role="img" aria-label="Revenue distribution by period">
          <circle class="ws-donut-track" cx="142" cy="136" r="82"></circle>
          <text class="ws-donut-title" x="142" y="132" text-anchor="middle">Revenue</text><text class="ws-donut-subtitle" x="142" y="151" text-anchor="middle">distribution</text>${segments}
        </svg>
        <div class="ws-donut-legend" aria-label="Revenue periods">${buckets.map((bucket, index) => {
          const share = (bucket.value / total) * 100;
          return `<button type="button" class="ws-donut-legend-item ws-chart-interactive" data-chart-key="bucket-${index}" aria-label="${esc(`${bucket.label} · ${money(bucket.value, currency)} · ${percent(share)} of revenue`)}" style="--segment-color:var(--ws-donut-${(index % 6) + 1})"><i></i><span><b>${esc(bucket.label)}</b><small>Revenue period</small></span><output>${money(bucket.value, currency)} · ${percent(share)}</output></button>`;
        }).join('')}</div>
      </div>`;
    }

    return `<div class="ws-chart ws-chart--bars" data-chart aria-label="Rounded bar revenue chart">${series.map((point, index) => {
      const detail = `${point.label} · ${money(point.value, currency)} · ${integer(point.orders)} order${point.orders === 1 ? '' : 's'}`;
      return `<button type="button" class="ws-chart-bar ws-chart-interactive" data-chart-key="bar-${index}" style="--bar-height:${Math.max(4, point.value / max * 100)}%" aria-label="${esc(detail)}"><output>${esc(detail)}</output><i></i><span${index % labelEvery !== 0 && index !== series.length - 1 ? ' class="is-hidden"' : ''}>${esc(point.label)}</span></button>`;
    }).join('')}</div>`;
  }

  function compactFinancial(value, currency = 'EUR') {
    const amount = num(value);
    if (amount >= 1_000_000) return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
    if (amount >= 1_000) return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
    return money(amount, currency);
  }

  function financialSeries(data) {
    const source = list(data?.series || data?.chart || [], 'series');
    return source.map((point, index) => {
      const rawDate = point.date || point.period || '';
      const parsed = rawDate ? new Date(`${rawDate}T12:00:00Z`) : null;
      const day = parsed && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' }).format(parsed) : String(index + 1);
      const formatted = parsed && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed) : `Period ${index + 1}`;
      const grouped = point.granularity && point.granularity !== 'day';
      return {
        value: num(valueOf(point, ['value', 'revenue', 'amount', 'total'])),
        label: grouped ? (point.label || formatted) : day,
        dateLabel: grouped ? (point.label || formatted) : formatted,
        orders: num(valueOf(point, ['orders', 'sales', 'orderCount']))
      };
    });
  }

  function usageMonthLabel(data) {
    const end = data?.range?.end;
    if (!end) return 'Current period';
    const parsed = new Date(`${end}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 'Current period' : new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
  }

  function usageMonthOptions(data) {
    const endText = data?.range?.end || isoDateForClient(new Date());
    const endDate = new Date(`${endText}T12:00:00Z`);
    if (Number.isNaN(endDate.getTime())) return [];
    return Array.from({ length: 12 }, (_, index) => {
      const month = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - index, 1, 12));
      const year = month.getUTCFullYear();
      const monthNumber = String(month.getUTCMonth() + 1).padStart(2, '0');
      const lastDay = new Date(Date.UTC(year, month.getUTCMonth() + 1, 0, 12)).getUTCDate();
      const start = `${year}-${monthNumber}-01`;
      const naturalEnd = `${year}-${monthNumber}-${String(lastDay).padStart(2, '0')}`;
      const end = naturalEnd > endText ? endText : naturalEnd;
      return { label: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(month), start, end };
    });
  }

  function isoDateForClient(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(date);
  }

  function usagePeriodLabel(range) {
    if (range === '24h') return 'Last 24 hours';
    if (range === 'custom') return 'Custom range';
    return `Last ${range} days`;
  }

  function dashboardPeriodControl() {
    const options = ['24h', '7', '30', '90', '365', 'custom'];
    return `<div class="ws-dashboard-period-wrap"><button class="ws-button ws-button--secondary ws-dashboard-period" type="button" data-action="usage-range-menu" aria-haspopup="menu" aria-expanded="false">${icon('calendar')}<span data-usage-range-label>${esc(usagePeriodLabel(app.dashboardRange))}</span>${icon('chevron-down')}</button><div class="ws-usage-range-menu ws-dashboard-range-menu" data-usage-range-menu hidden role="menu">${options.map((range) => `<button type="button" data-action="dashboard-range" data-range="${range}" role="menuitem">${range === '24h' ? 'Last 24 hours' : range === 'custom' ? 'Custom range' : `Last ${range} days`}</button>`).join('')}</div></div>`;
  }

  function dashboardHeadingActions() {
    return `<span class="ws-dashboard-updated">${icon('clock')}<span>Last updated 2m ago</span></span>${dashboardPeriodControl()}`;
  }

  function usageMetricCard(label, value, unit, change, tone, fill) {
    const changeNumber = num(String(change).replace('%', '').replace(',', '.'));
    const changeTone = changeNumber < 0 ? 'down' : changeNumber > 0 ? 'up' : 'flat';
    return `<article class="ws-usage-metric ws-usage-metric--${tone}">
      <header><span>${esc(label)}</span>${icon('arrow-up-right')}</header>
      <div class="ws-usage-metric-value"><strong>${esc(value)}</strong><span>${esc(unit)}</span></div>
      <div class="ws-usage-metric-meta"><b class="ws-usage-change--${changeTone}">${esc(change)}</b><span>vs last month</span></div>
      <div class="ws-usage-progress" aria-hidden="true"><i style="width:${fill}%"></i></div>
    </article>`;
  }

  function revenueAxisStep(maxValue) {
    const max = Math.max(1, num(maxValue));
    const targetStep = max / 6;
    const roundedSteps = [25, 50, 100, 150, 200, 250, 500, 1000, 2000, 5000, 10000];
    const matchingStep = roundedSteps.find((step) => step >= targetStep);
    if (matchingStep) return matchingStep;
    const magnitude = 10 ** Math.floor(Math.log10(targetStep));
    const normalized = targetStep / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return Math.max(25, niceNormalized * magnitude);
  }

  function axisMoney(value, currency = 'EUR') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Math.max(0, Math.round(num(value))));
  }

  function usageBarChart(series, currency = 'EUR') {
    const max = Math.max(...series.map((point) => point.value), 1);
    const axisStep = revenueAxisStep(max);
    const axisMax = axisStep * 6;
    const yLabels = Array.from({ length: 7 }, (_, index) => axisMoney(axisMax - (index * axisStep), currency));
    const bars = series.map((point, index) => {
      const detail = `${point.dateLabel} · ${money(point.value, currency)} revenue`;
      return `<button type="button" class="ws-chart-bar ws-usage-bar ws-chart-interactive" data-chart-key="usage-bar-${index}" style="--bar-height:${Math.max(5, Math.min(100, point.value / axisMax * 100))}%" aria-label="${esc(detail)}">
        <output><b>${esc(point.dateLabel)}</b><span><em>Revenue</em><strong>${money(point.value, currency)}</strong></span></output><i></i>
      </button>`;
    }).join('');
    return `<div class="ws-usage-chart" data-chart style="--usage-count:${series.length}" aria-label="Daily revenue chart">
      <div class="ws-usage-y-axis">${yLabels.map((label) => `<span>${label}</span>`).join('')}</div>
      <div class="ws-usage-plot"><div class="ws-usage-grid" aria-hidden="true">${yLabels.map(() => '<i></i>').join('')}</div><div class="ws-usage-bars">${bars}</div><div class="ws-usage-x-axis">${series.map((point) => `<span>${esc(point.label)}</span>`).join('')}</div></div>
    </div>`;
  }

  function usageAltChart(series, type, currency = 'EUR') {
    const max = Math.max(...series.map((point) => point.value), 1);
    if (type === 'line') {
      const width = Math.max(920, series.length * 42);
      const points = series.map((point, index) => ({ ...point, x: 32 + index * ((width - 64) / Math.max(1, series.length - 1)), y: 230 - ((point.value / max) * 185) }));
      const line = smoothPath(points);
      const tooltipWidth = 178;
      const labels = points.map((point, index) => {
        const detail = `${point.dateLabel} · ${money(point.value, currency)} revenue`;
        const tooltipX = Math.min(Math.max(point.x - (tooltipWidth / 2), 4), width - tooltipWidth - 4);
        const tooltipY = point.y < 72 ? point.y + 14 : point.y - 50;
        return `<g class="ws-chart-point ws-chart-interactive" data-chart-key="usage-point-${index}" tabindex="0" aria-label="${esc(detail)}"><circle cx="${point.x}" cy="${point.y}" r="12" class="ws-usage-line-hit"></circle><circle cx="${point.x}" cy="${point.y}" r="4" class="ws-usage-line-dot"></circle><foreignObject class="ws-usage-line-tooltip" x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="38"><div xmlns="http://www.w3.org/1999/xhtml">${esc(detail)}</div></foreignObject></g><text class="ws-usage-line-label" x="${point.x}" y="260" text-anchor="middle">${esc(point.label)}</text>`;
      }).join('');
      return `<div class="ws-usage-alt-chart ws-usage-line-wrap" data-chart><svg viewBox="0 0 ${width} 270" style="width:${width}px" role="img" aria-label="Smooth daily revenue chart"><path class="ws-usage-line-grid" d="M20 45H${width - 20}M20 92H${width - 20}M20 139H${width - 20}M20 186H${width - 20}M20 233H${width - 20}"></path><path class="ws-usage-line-area" d="${line} L ${points.at(-1).x} 233 L ${points[0].x} 233 Z"></path><path class="ws-usage-line" d="${line}"></path>${labels}</svg></div>`;
    }
    const buckets = groupedRevenueSeries(series.map((point) => ({ ...point, label: point.dateLabel })));
    const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0) || 1;
    let offset = 0;
    const donutColors = ['#bd72ee', '#c689f2', '#d5a5f6', '#e0bef8', '#ae62e8', '#ca8df1'];
    const segments = buckets.map((bucket, index) => { const share = bucket.value / total * 100; const segment = `${donutColors[index % donutColors.length]} ${offset}% ${offset + share}%`; offset += share; return segment; }).join(', ');
    return `<div class="ws-usage-alt-chart ws-usage-donut-wrap" data-chart><div class="ws-usage-donut" style="background:conic-gradient(${segments})"><div><b>${compactFinancial(total, currency)}</b><span>revenue</span></div></div><div class="ws-usage-donut-legend">${buckets.map((bucket, index) => `<button class="ws-chart-interactive" data-chart-key="usage-donut-${index}" type="button"><i style="--legend-color:${donutColors[index % donutColors.length]}"></i><span><b>${esc(bucket.label)}</b><small>Revenue period</small></span><output>${compactFinancial(bucket.value, currency)}</output></button>`).join('')}</div></div>`;
  }

  function usageChart(series, currency = 'EUR') {
    return app.dashboardChartType === 'bars' ? usageBarChart(series, currency) : usageAltChart(series, app.dashboardChartType, currency);
  }

  function usageChartTypeSwitcher(activeType) {
    const options = [['bars', 'Bars'], ['line', 'Line'], ['donut', 'Donut']];
    return `<div class="ws-usage-chart-switcher" role="group" aria-label="Chart type">${options.map(([type, label]) => `<button type="button" data-action="dashboard-chart-type" data-chart-type="${type}" class="${activeType === type ? 'is-active' : ''}" aria-pressed="${activeType === type}"><span class="ws-chart-glyph ws-chart-glyph--${type}" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span></button>`).join('')}</div>`;
  }

  function usageRowsMarkup(rows) {
    const sourceRows = rows.length ? rows : [{ name: 'No matching customers', email: 'Try another search', product: '—', purchaseDate: '', amount: 0, initials: '—', avatar: '#eeeeee' }];
    return sourceRows.map((row, index) => `<tr${rows.length ? ` data-action="usage-row" data-usage-row="${index}"` : ''}>
      <td><div class="ws-usage-person"><span class="ws-usage-avatar" style="--avatar-bg:${esc(row.avatar)}">${esc(row.face || row.initials)}</span><span><b>${esc(row.name)}</b><small>${esc(row.email || '')}</small></span></div></td>
      <td>${esc(row.product || 'Digital product')}</td><td>${esc(dateText(row.purchaseDate, { day: '2-digit', month: 'short', year: 'numeric' }))}</td><td><b>${money(row.amount)}</b></td><td>${esc(row.source || 'Direct checkout')}</td><td class="ws-usage-row-action"><button type="button" aria-label="Open ${esc(row.name)}">${icon('link-external')}</button></td>
    </tr>`).join('');
  }

  function usageTable(rows) {
    return `<section class="ws-usage-table-panel">
      <header><h2>Recent customers</h2><div class="ws-usage-table-actions"><label class="ws-usage-table-search">${icon('search')}<input type="search" data-usage-search value="${esc(app.usageSearch)}" placeholder="Search..." aria-label="Search customers"></label><button class="ws-usage-more" type="button" data-action="usage-chart-menu" aria-label="Chart display options">${icon('more')}</button><div class="ws-usage-view-menu" data-usage-chart-menu hidden><span>Chart display</span><button type="button" data-action="dashboard-chart-type" data-chart-type="bars">Rounded bars</button><button type="button" data-action="dashboard-chart-type" data-chart-type="line">Smooth line</button><button type="button" data-action="dashboard-chart-type" data-chart-type="donut">Donut mix</button></div></div></header>
      <div class="ws-usage-table-scroll"><table class="ws-usage-table"><thead><tr><th><button type="button" data-action="usage-sort" data-sort="user">Customer <span>⌃⌄</span></button></th><th><button type="button" data-action="usage-sort" data-sort="product">Product <span>⌃⌄</span></button></th><th><button type="button" data-action="usage-sort" data-sort="purchaseDate">Purchase date <span>⌃⌄</span></button></th><th><button type="button" data-action="usage-sort" data-sort="amount">Amount <span>⌃⌄</span></button></th><th>Source</th><th></th></tr></thead><tbody data-usage-table-body>${usageRowsMarkup(rows)}</tbody></table></div>
    </section>`;
  }

  function refreshUsageTable() {
    const body = $('[data-usage-table-body]');
    if (!body) return;
    const query = app.usageSearch.trim().toLowerCase();
    const rows = (app.cache.usageRows || []).filter((row) => `${row.name} ${row.email} ${row.product}`.toLowerCase().includes(query));
    const key = app.usageSort === 'user' ? 'name' : app.usageSort;
    rows.sort((a, b) => {
      const left = a[key]; const right = b[key];
      const result = typeof left === 'string' ? left.localeCompare(right) : num(left) - num(right);
      return app.usageSortDirection === 'desc' ? -result : result;
    });
    body.innerHTML = usageRowsMarkup(rows);
  }

  async function renderDashboard() {
    const token = ++app.routeToken;
    setContent(pageTitle('Dashboard', 'Track revenue, orders and customers.', dashboardHeadingActions()) + '<div class="ws-usage-loading"><span></span><span></span><span></span></div>');
    try {
      const path = queryWith('/api/dashboard', {
        range: app.dashboardRange,
        start: app.dashboardRange === 'custom' ? app.dashboardStart : '',
        end: app.dashboardRange === 'custom' ? app.dashboardEnd : ''
      });
      const data = await request(path);
      if (token !== app.routeToken) return;
      app.cache.dashboard = data;
      const metrics = data?.kpis || data?.metrics || data?.summary || data || {};
      const revenue = num(metricValue(metrics, 'revenue', valueOf(metrics, ['totalRevenue', 'grossSales'])));
      const orders = num(metricValue(metrics, 'orders', valueOf(metrics, ['totalOrders', 'sales'])));
      const customers = num(metricValue(metrics, 'customers', valueOf(metrics, ['totalCustomers', 'newCustomers'])));
      const averageOrder = num(metricValue(metrics, 'averageOrder', valueOf(metrics, ['averageOrderValue', 'aov'])));
      const currency = data?.currency || 'EUR';
      const changes = data?.changes || {};
      const series = financialSeries(data);
      const rawCustomers = list(data?.recentCustomers || data?.customers || [], 'customers');
      const avatarFaces = ['🧑🏽‍🎨', '👩🏻‍💻', '👩🏽‍🔬', '🧔🏻‍♂️', '👩🏾‍💼', '🧑🏻‍🚀'];
      const rows = rawCustomers.slice(0, 12).map((customer, index) => {
        const name = customer.name || customer.customer?.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Customer';
        return {
          name,
          email: customer.email || customer.customer?.email || '',
          product: customer.product || customer.productName || 'Digital product',
          purchaseDate: customer.purchaseDate || customer.createdAt || customer.lastOrderAt || '',
          amount: num(valueOf(customer, ['amount', 'price', 'total'])),
          source: customer.source || 'Direct checkout',
          initials: initials(name),
          face: avatarFaces[index % avatarFaces.length],
          avatar: ['#e8c09d', '#d8a68d', '#e3b8a0', '#f0d5bd', '#b9d6c4', '#e5c3db'][index % 6]
        };
      });
      app.cache.usageRows = rows;
      const filteredRows = rows.filter((row) => `${row.name} ${row.email} ${row.product}`.toLowerCase().includes(app.usageSearch.trim().toLowerCase()));
      const sortedRows = [...filteredRows].sort((a, b) => {
        const key = app.usageSort === 'user' ? 'name' : app.usageSort;
        const left = a[key]; const right = b[key];
        const result = typeof left === 'string' ? left.localeCompare(right) : num(left) - num(right);
        return app.usageSortDirection === 'desc' ? -result : result;
      });
      const monthLabel = usageMonthLabel(data);
      const monthOptions = usageMonthOptions(data);
      setContent(pageTitle('Dashboard', 'Track revenue, orders and customers.', dashboardHeadingActions()) + `<div class="ws-usage-dashboard">
        <section class="ws-usage-metrics">${usageMetricCard('Total revenue', compactFinancial(revenue, currency), 'Revenue', `${num(valueOf(metrics.revenue, ['change'], changes.revenue)) >= 0 ? '+' : ''}${percent(valueOf(metrics.revenue, ['change'], changes.revenue))}`, 'purple', Math.min(92, Math.max(22, revenue ? 58 : 12)))}${usageMetricCard('Orders', integer(orders), 'Sales', `${num(valueOf(metrics.orders, ['change'], changes.orders)) >= 0 ? '+' : ''}${percent(valueOf(metrics.orders, ['change'], changes.orders))}`, 'orange', Math.min(92, Math.max(22, orders ? 55 : 12)))}${usageMetricCard('Customers', integer(customers), 'Buyers', `${num(valueOf(metrics.customers, ['change'], changes.customers)) >= 0 ? '+' : ''}${percent(valueOf(metrics.customers, ['change'], changes.customers))}`, 'green', Math.min(92, Math.max(22, customers ? 84 : 12)))}</section>
        <section class="ws-usage-chart-panel"><header><div><h2>Daily revenue</h2><p>Revenue generated by your digital products</p></div><div class="ws-usage-chart-actions"><div class="ws-usage-chart-type-wrap">${usageChartTypeSwitcher(app.dashboardChartType)}</div><div class="ws-usage-month-wrap"><button type="button" class="ws-usage-month" data-action="usage-month-menu" aria-haspopup="menu" aria-expanded="false">${icon('calendar')}<span data-usage-month-label>${esc(monthLabel)}</span>${icon('chevron-down')}</button><div class="ws-usage-month-menu" data-usage-month-menu hidden role="menu">${monthOptions.map((option) => `<button type="button" data-action="usage-month-select" data-start="${esc(option.start)}" data-end="${esc(option.end)}" role="menuitem">${esc(option.label)}</button>`).join('')}<button type="button" data-action="usage-month-custom" role="menuitem">Custom range</button></div></div></div></header>${usageChart(series, currency)}</section>
        ${usageTable(sortedRows)}
      </div>`);
      attachCharts();
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Dashboard', 'Track revenue, orders and customers.', dashboardHeadingActions()) + errorState(error));
    }
  }

  function customerTable(customers, currency = 'EUR', compact = false) {
    if (!customers.length) return emptyState('No customers yet', 'New buyers will appear here after checkout.', compact ? button('Open customers', 'view-customers') : button('Add customer', 'new-customer', { kind: 'primary' }));
    const headings = compact
      ? '<th>Customer</th><th>Product</th><th>Purchase date</th><th class="ws-align-right">Amount</th>'
      : '<th>Customer</th><th>Country & source</th><th>Last purchase</th><th class="ws-align-right">Total spent</th><th class="ws-align-right">Orders</th>';
    return `<div class="ws-table-wrap"><table class="ws-table"><thead><tr>${headings}</tr></thead><tbody>${customers.slice(0, compact ? 6 : customers.length).map((customer) => {
      const name = customer.name || customer.customer?.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Customer';
      const email = customer.email || customer.customer?.email || '';
      const person = `<td><div class="ws-person"><span class="ws-avatar">${esc(initials(name))}</span><span><b>${esc(name)}</b><small>${esc(email)}</small></span></div></td>`;
      if (compact) {
        return `<tr>${person}<td>${esc(customer.product || customer.productName || customer.lastProduct || 'Digital product')}</td><td>${dateText(customer.purchaseDate || customer.createdAt || customer.lastOrderAt)}</td><td class="ws-align-right"><b>${money(valueOf(customer, ['amount', 'price', 'total']), customer.currency || currency)}</b></td></tr>`;
      }
      const country = customer.country || '—';
      const source = customer.source || 'Unknown source';
      const totalSpent = valueOf(customer, ['totalSpent', 'lifetimeValue', 'total'], 0);
      return `<tr>${person}<td><span class="ws-table-stack"><b>${esc(country)}</b><small>${esc(source)}</small></span></td><td>${dateText(customer.lastOrderAt || customer.purchaseDate)}</td><td class="ws-align-right"><b>${money(totalSpent, customer.currency || currency)}</b></td><td class="ws-align-right"><b>${integer(valueOf(customer, ['orders', 'orderCount', 'ordersCount'], 0))}</b></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function attachCharts() {
    if (app.chartCleanup) app.chartCleanup();
    const charts = $$('[data-chart]');
    const clearAll = () => $$('.ws-chart-bar.is-active, .ws-chart-interactive.is-active').forEach((item) => item.classList.remove('is-active'));
    const listeners = [];
    charts.forEach((chart) => {
      $$('.ws-chart-bar, .ws-chart-interactive', chart).forEach((item) => {
        const related = () => {
          const key = item.dataset.chartKey;
          if (!key) return [item];
          return $$(`[data-chart-key="${CSS.escape(key)}"]`, chart);
        };
        const activate = () => { clearAll(); related().forEach((target) => target.classList.add('is-active')); };
        const clear = () => related().forEach((target) => target.classList.remove('is-active'));
        [['pointerenter', activate], ['pointerleave', clear], ['focus', activate], ['blur', clear]].forEach(([name, handler]) => {
          item.addEventListener(name, handler); listeners.push([item, name, handler]);
        });
      });
    });
    app.chartCleanup = () => { listeners.forEach(([node, name, handler]) => node.removeEventListener(name, handler)); clearAll(); };
  }

  async function renderStorefront() {
    const token = ++app.routeToken;
    setContent(pageTitle('Storefront', 'Design, preview and publish your customer-facing store.') + skeleton());
    try {
      const [storeData, templateData] = await Promise.all([request('/api/store'), request('/api/templates')]);
      if (token !== app.routeToken) return;
      const store = storeData?.store || storeData || {};
      app.cache.store = store || {};
      app.cache.templates = list(templateData, 'templates');
      const storeTheme = store?.theme || {};
      const accent = storeTheme.accent || storeTheme.accentColor || '#168CFF';
      const heroImage = storeTheme.heroImage || '';
      const liveUrl = store?.url || store?.publicUrl || `${location.origin}/store.html`;
      setContent(pageTitle('Storefront', 'Design, preview and publish your customer-facing store.', `${button('Copy store link', 'copy-store-link', { icon: 'link-external' })}${button('Open live store', 'open-store', { icon: 'link-external' })}${button(store?.published ? 'Publish updates' : 'Publish store', 'publish-store', { kind: 'primary', icon: 'link-external' })}`)
        + `<div class="ws-store-grid"><section class="ws-panel"><header><div><span class="ws-eyebrow">Store editor</span><h2>Brand and sales page</h2></div>${badge(store?.published ? 'Published' : 'Draft')}</header>
          <form class="ws-form" data-form="store">${formField('Store name', 'name', { value: store?.name || '', required: true })}${formField('Headline', 'tagline', { value: store?.tagline || '', required: true })}${formField('Description', 'description', { type: 'textarea', value: store?.description || '' })}<div class="ws-form-row">${formField('Store slug', 'slug', { value: store?.slug || '' })}${formField('Accent colour', 'accent', { type: 'color', value: accent })}</div>${formField('Logo URL', 'logoUrl', { type: 'url', value: store?.logoUrl || '' })}${formField('Hero image URL', 'heroImage', { type: 'url', value: heroImage })}<div class="ws-form-actions"><span class="ws-muted">Changes update the preview instantly.</span><button class="ws-button ws-button--primary" type="submit">Save storefront</button></div></form>
        </section><aside class="ws-preview-column"><div class="ws-preview-label"><span>Live preview</span><small>Desktop storefront</small></div><div class="ws-store-preview" data-store-preview style="--preview-accent:${esc(accent)}"><div class="ws-preview-nav"><b data-preview-name>${esc(store?.name || 'Your store')}</b><span>Products&nbsp;&nbsp; About</span></div><div class="ws-preview-hero">${heroImage ? `<img data-preview-image src="${esc(heroImage)}" alt="">` : '<div class="ws-preview-art"></div>'}<span>Digital products, made simple</span><h3 data-preview-headline>${esc(store?.tagline || 'Everything you need to grow your creative business.')}</h3><p data-preview-description>${esc(store?.description || 'Premium resources, instant delivery and secure checkout.')}</p><i>Explore products</i></div></div><input type="hidden" data-store-url value="${esc(liveUrl)}"></aside></div>
        <section class="ws-panel"><header><div><span class="ws-eyebrow">Templates</span><h2>Start from a proven layout</h2></div></header>${templateGrid(app.cache.templates)}</section>`);
      bindStorePreview();
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Storefront', 'Design, preview and publish your customer-facing store.') + errorState(error));
    }
  }

  function templateGrid(templates) {
    if (!templates.length) return emptyState('No templates available', 'Templates will appear here when they are added to your workspace.');
    return `<div class="ws-template-grid">${templates.map((template, index) => `<article class="ws-template-card"><div class="ws-template-art ws-template-art--${index % 4}"><i></i><span></span><b></b></div><div><span><b>${esc(template.name || 'Store template')}</b><small>${esc(template.description || template.category || 'Conversion-focused storefront')}</small></span>${button('Apply', 'apply-template', { id: template.id })}</div></article>`).join('')}</div>`;
  }

  function bindStorePreview() {
    const form = $('[data-form="store"]');
    form?.addEventListener('input', () => {
      const data = new FormData(form);
      $('[data-preview-name]').textContent = data.get('name') || 'Your store';
      $('[data-preview-headline]').textContent = data.get('tagline') || 'Your new headline';
      $('[data-preview-description]').textContent = data.get('description') || 'Tell buyers what makes your products valuable.';
      $('[data-store-preview]')?.style.setProperty('--preview-accent', data.get('accent') || '#168CFF');
      const image = $('[data-preview-image]');
      if (image && data.get('heroImage')) image.src = data.get('heroImage');
    });
  }

  async function renderProducts() {
    const token = ++app.routeToken;
    setContent(pageTitle('Products', 'Create, price and deliver every digital product.', button('New product', 'new-product', { kind: 'primary', icon: 'plus' })) + skeleton());
    try {
      const data = await request('/api/products');
      if (token !== app.routeToken) return;
      const products = list(data, 'products');
      app.cache.products = products;
      setContent(pageTitle('Products', 'Create, price and deliver every digital product.', button('New product', 'new-product', { kind: 'primary', icon: 'plus' })) + (products.length ? `<section class="ws-panel ws-table-panel"><header><div><span class="ws-eyebrow">Catalogue</span><h2>${products.length} product${products.length === 1 ? '' : 's'}</h2></div><span class="ws-muted">Digital delivery is automatic after payment.</span></header><div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Product</th><th>Price</th><th>Status</th><th>Sales</th><th class="ws-align-right">Actions</th></tr></thead><tbody>${products.map((product) => `<tr><td><div class="ws-product-cell"><span class="ws-product-thumb">${product.thumbnailUrl ? `<img src="${esc(product.thumbnailUrl)}" alt="">` : icon('cube')}</span><span><b>${esc(product.name || 'Untitled product')}</b><small>${esc(product.category || 'Digital product')}</small></span></div></td><td><b>${money(product.price, product.currency || 'EUR')}</b></td><td>${badge(product.status || (product.active === false ? 'Draft' : 'Active'))}</td><td>${integer(valueOf(product, ['sales', 'orderCount'], 0))}</td><td class="ws-align-right"><div class="ws-row-actions">${button('Edit', 'edit-product', { id: product.id })}${button('Archive', 'delete-product', { id: product.id, kind: 'danger' })}</div></td></tr>`).join('')}</tbody></table></div></section>` : emptyState('Create your first product', 'Add a file, course, template, membership or service and start selling.', button('New product', 'new-product', { kind: 'primary' }))));
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Products', 'Create, price and deliver every digital product.', button('New product', 'new-product', { kind: 'primary', icon: 'plus' })) + errorState(error));
    }
  }

  function productModal(product = {}) {
    showModal(product.id ? 'Edit product' : 'New product', `<form class="ws-form" data-form="product" data-id="${esc(product.id || '')}">${formField('Product name', 'name', { value: product.name || '', required: true })}<div class="ws-form-row">${formField('Price (EUR)', 'price', { type: 'number', value: product.price ?? '', min: 0, step: '0.01', required: true })}${formField('Category', 'category', { type: 'select', value: product.category || 'Digital download', options: [['Digital download', 'Digital download'], ['Course', 'Course'], ['Membership', 'Membership'], ['Service', 'Service'], ['Bundle', 'Bundle']] })}</div>${formField('Description', 'description', { type: 'textarea', value: product.description || '', required: true })}${formField('Delivery file', 'file', { type: 'file', help: product.assetPath ? `Current file: ${product.assetPath}` : 'Uploaded securely and delivered after checkout.' })}${formField('Status', 'status', { type: 'select', value: product.status || 'active', options: product.id ? [['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']] : [['active', 'Active'], ['draft', 'Draft']] })}${modalSubmit(product.id ? 'Save changes' : 'Create product')}</form>`, 'Catalogue');
  }

  async function renderOrders() {
    const token = ++app.routeToken;
    setContent(pageTitle('Orders', 'Find purchases, help buyers and manage refunds.', button('Export CSV', 'export-orders', { icon: 'link-external' })) + orderFilters() + skeleton());
    try {
      const pageSize = 100;
      const data = await request(queryWith('/api/orders', {
        search: app.orderSearch,
        status: app.orderStatus,
        product: app.orderProduct,
        limit: pageSize,
        page: app.orderPage + 1
      }));
      if (token !== app.routeToken) return;
      const orders = list(data, 'orders');
      app.cache.orders = orders;
      const totalOrders = num(data?.total, orders.length);
      const pageCount = Math.max(1, Math.ceil(totalOrders / pageSize));
      app.orderPage = Math.min(app.orderPage, pageCount - 1);
      // Older API versions return the full collection even when limit/offset are
      // present. Keep those versions usable while preferring server pagination.
      const pageOrders = orders.length > pageSize
        ? orders.slice(app.orderPage * pageSize, (app.orderPage + 1) * pageSize)
        : orders;
      const products = [...new Set(orders.map((order) => order.product || order.productName).filter(Boolean))];
      setContent(pageTitle('Orders', 'Find purchases, help buyers and manage refunds.', button('Export CSV', 'export-orders', { icon: 'link-external' })) + orderFilters(products) + (pageOrders.length ? `<section class="ws-panel ws-table-panel"><header><div><span class="ws-eyebrow">Transactions</span><h2>${integer(totalOrders)} order${totalOrders === 1 ? '' : 's'}</h2></div><span class="ws-muted">Refund availability depends on the connected payment provider.</span></header><div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Date</th><th>Total</th><th>Status</th><th class="ws-align-right">Actions</th></tr></thead><tbody>${pageOrders.map((order) => {
        const paid = /^paid$/i.test(order.status || '');
        return `<tr><td><b>#${esc(order.number || order.orderNumber || String(order.id || '').slice(-6) || '—')}</b></td><td><div class="ws-person"><span class="ws-avatar">${esc(initials(order.customerName || order.customer?.name))}</span><span><b>${esc(order.customerName || order.customer?.name || 'Customer')}</b><small>${esc(order.email || order.customer?.email || '')}</small></span></div></td><td>${esc(order.product || order.productName || order.items?.[0]?.name || 'Digital product')}</td><td>${dateText(order.createdAt || order.date)}</td><td><b>${money(valueOf(order, ['total', 'amount', 'price']), order.currency || 'EUR')}</b></td><td>${badge(order.status || 'Paid')}</td><td class="ws-align-right"><div class="ws-row-actions">${button('Resend', 'resend-order', { id: order.id, disabled: !paid })}${button('Refund', 'refund-order', { id: order.id, kind: 'danger', disabled: !paid })}</div></td></tr>`;
      }).join('')}</tbody></table></div><footer class="ws-pagination"><span>Page ${app.orderPage + 1} of ${pageCount} · ${integer(totalOrders)} total</span><div>${button('Previous', 'orders-prev', { disabled: app.orderPage === 0 })}${button('Next', 'orders-next', { disabled: app.orderPage >= pageCount - 1 })}</div></footer></section>` : emptyState('No matching orders', 'Try changing the search or filters.')));
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Orders', 'Find purchases, help buyers and manage refunds.', button('Export CSV', 'export-orders', { icon: 'link-external' })) + orderFilters() + errorState(error));
    }
  }

  function orderFilters(products = []) {
    return `<form class="ws-filterbar" data-form="order-filter"><label>${icon('search')}<input type="search" name="search" value="${esc(app.orderSearch)}" placeholder="Search order, name or email"></label><select name="status" aria-label="Filter by status"><option value="">All statuses</option>${['paid', 'pending', 'refunded', 'failed'].map((status) => `<option value="${status}"${app.orderStatus === status ? ' selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select><select name="product" aria-label="Filter by product"><option value="">All products</option>${products.map((product) => `<option value="${esc(product)}"${app.orderProduct === product ? ' selected' : ''}>${esc(product)}</option>`).join('')}</select><button class="ws-button ws-button--secondary" type="submit">Apply filters</button><button class="ws-button ws-button--ghost" type="button" data-action="clear-order-filters">Clear</button></form>`;
  }

  async function renderCustomers() {
    const token = ++app.routeToken;
    setContent(pageTitle('Customers', 'Understand your audience and keep buyer records organised.', `${button('Export CSV', 'export-customers', { icon: 'link-external' })}${button('Add customer', 'new-customer', { kind: 'primary', icon: 'plus' })}`) + skeleton());
    try {
      const data = await request('/api/customers?limit=100&page=1');
      if (token !== app.routeToken) return;
      const customers = list(data, 'customers');
      const totalCustomers = num(data?.total, customers.length);
      app.cache.customers = customers;
      setContent(pageTitle('Customers', 'Understand your audience and keep buyer records organised.', `${button('Export CSV', 'export-customers', { icon: 'link-external' })}${button('Add customer', 'new-customer', { kind: 'primary', icon: 'plus' })}`) + `<section class="ws-panel ws-table-panel"><header><div><span class="ws-eyebrow">Customer list</span><h2>${integer(totalCustomers)} customer${totalCustomers === 1 ? '' : 's'}</h2></div><span class="ws-muted">${customers.length < totalCustomers ? `Showing the latest ${integer(customers.length)} buyers.` : 'Spend, source and country are consolidated from purchases.'}</span></header>${customerTable(customers)}</section>`);
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Customers', 'Understand your audience and keep buyer records organised.') + errorState(error));
    }
  }

  function customerModal() {
    showModal('Add customer', `<form class="ws-form" data-form="customer">${formField('Full name', 'name', { required: true })}${formField('Email address', 'email', { type: 'email', required: true })}<div class="ws-form-row">${formField('Country', 'country', { value: 'France' })}${formField('Source', 'source', { value: 'Manual' })}</div><label class="ws-check"><input type="checkbox" name="marketingOptIn" value="true"><span>Customer accepts marketing emails</span></label>${modalSubmit('Add customer')}</form>`, 'Customers');
  }

  async function renderMarketing() {
    const token = ++app.routeToken;
    setContent(pageTitle('Marketing', 'Convert more visitors with offers and email campaigns.', `${button('New discount', 'new-discount')}${button('New campaign', 'new-campaign', { kind: 'primary' })}`) + skeleton());
    try {
      const [discountData, campaignData] = await Promise.all([request('/api/discounts'), request('/api/campaigns')]);
      if (token !== app.routeToken) return;
      const discounts = list(discountData, 'discounts');
      const campaigns = list(campaignData, 'campaigns');
      app.cache.discounts = discounts;
      app.cache.campaigns = campaigns;
      setContent(pageTitle('Marketing', 'Convert more visitors with offers and email campaigns.', `${button('New discount', 'new-discount')}${button('New campaign', 'new-campaign', { kind: 'primary' })}`) + `<div class="ws-two-column"><section class="ws-panel"><header><div><span class="ws-eyebrow">Discounts</span><h2>Active offers</h2></div>${button('Create', 'new-discount')}</header>${discountList(discounts)}</section><section class="ws-panel"><header><div><span class="ws-eyebrow">Email</span><h2>Campaigns</h2></div>${button('Create', 'new-campaign')}</header>${campaignList(campaigns)}</section></div>`);
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Marketing', 'Convert more visitors with offers and email campaigns.') + errorState(error));
    }
  }

  function discountList(discounts) {
    if (!discounts.length) return emptyState('No discounts', 'Create a code for a launch, bundle or seasonal offer.', button('New discount', 'new-discount', { kind: 'primary' }));
    return `<div class="ws-stack-list">${discounts.map((discount) => `<article><span class="ws-code">${esc(discount.code || 'CODE')}</span><div><b>${esc(discount.name || discount.code || 'Discount')}</b><small>${discount.type === 'fixed' ? money(discount.value, discount.currency || 'EUR') : percent(discount.value)} off · ${esc(discount.status || (discount.active === false ? 'Inactive' : 'Active'))}</small></div><div class="ws-row-actions">${button(discount.active === false ? 'Activate' : 'Pause', 'toggle-discount', { id: discount.id })}${button('Delete', 'delete-discount', { id: discount.id, kind: 'danger' })}</div></article>`).join('')}</div>`;
  }

  function campaignList(campaigns) {
    if (!campaigns.length) return emptyState('No campaigns', 'Write an announcement and send it to your customers.', button('New campaign', 'new-campaign', { kind: 'primary' }));
    return `<div class="ws-stack-list">${campaigns.map((campaign) => `<article>${icon('bell')}<div><b>${esc(campaign.name || campaign.subject || 'Campaign')}</b><small>${esc(campaign.subject || '')} · ${esc(campaign.status || 'Draft')}</small></div>${button(/sent/i.test(campaign.status || '') ? 'Sent' : 'Mark sent', 'send-campaign', { id: campaign.id, disabled: /sent/i.test(campaign.status || '') })}</article>`).join('')}</div>`;
  }

  function discountModal() {
    showModal('New discount', `<form class="ws-form" data-form="discount"><div class="ws-form-row">${formField('Discount code', 'code', { required: true, placeholder: 'LAUNCH20' })}${formField('Type', 'type', { type: 'select', value: 'percent', options: [['percent', 'Percentage'], ['fixed', 'Fixed amount']] })}</div><div class="ws-form-row">${formField('Value', 'value', { type: 'number', required: true, min: 0, step: '0.01' })}${formField('Maximum uses', 'maxUses', { type: 'number', min: 1 })}</div>${formField('Expiry date', 'expiresAt', { type: 'datetime-local' })}${modalSubmit('Create discount')}</form>`, 'Marketing');
  }

  function campaignModal() {
    showModal('New campaign', `<form class="ws-form" data-form="campaign">${formField('Campaign name', 'name', { required: true })}${formField('Email subject', 'subject', { required: true })}${formField('Audience', 'audience', { type: 'select', value: 'all', options: [['all', 'All customers'], ['customers', 'Customers only'], ['subscribers', 'Marketing subscribers']] })}${formField('Schedule for later', 'scheduledAt', { type: 'datetime-local', help: 'Leave empty to keep this campaign as a draft.' })}<label class="ws-check"><input type="checkbox" name="sendNow" value="true"><span>Mark as sent immediately (demo)</span></label>${modalSubmit('Create campaign')}</form>`, 'Marketing');
  }

  async function renderAnalytics() {
    const token = ++app.routeToken;
    const filters = `<div class="ws-range">${['7', '30', '90', '365', 'custom'].map((range) => `<button type="button" data-action="analytics-range" data-range="${range}" class="${app.analyticsRange === range ? 'is-active' : ''}">${range === 'custom' ? 'Custom' : `${range} days`}</button>`).join('')}</div>`;
    setContent(pageTitle('Analytics', 'See how visitors move from discovery to purchase.', filters) + skeleton());
    try {
      const data = await request(queryWith('/api/analytics', {
        range: app.analyticsRange,
        start: app.analyticsRange === 'custom' ? app.analyticsStart : '',
        end: app.analyticsRange === 'custom' ? app.analyticsEnd : ''
      }));
      if (token !== app.routeToken) return;
      app.cache.analytics = data;
      const metrics = data?.kpis || data?.metrics || data?.summary || data || {};
      const detailMetrics = data?.metrics || data?.summary || {};
      const changes = data?.changes || detailMetrics?.changes || {};
      const series = list(data?.series || data?.traffic || [], 'series').map((point, index) => ({ label: point.label || point.date || `${index + 1}`, value: num(valueOf(point, ['value', 'visitors', 'sessions'])) }));
      const max = Math.max(...series.map((point) => point.value), 1);
      const sources = list(data?.sources || data?.channels || [], 'sources');
      const funnel = list(data?.funnel || [], 'funnel');
      const topProducts = list(data?.topProducts || data?.products || [], 'topProducts');
      const funnelValue = (step) => valueOf(funnel.find((item) => String(item.step || '').toLowerCase().includes(step)), ['value'], 0);
      const visitors = metricValue(metrics, 'visitors', metricValue(detailMetrics, 'visitors'));
      const productViews = metricValue(detailMetrics, 'productViews', funnelValue('product view'));
      const checkouts = metricValue(detailMetrics, 'checkouts', funnelValue('checkout'));
      const conversion = metricValue(metrics, 'conversion', metricValue(detailMetrics, 'conversion'));
      setContent(pageTitle('Analytics', 'See how visitors move from discovery to purchase.', filters)
        + `<section class="ws-metrics">${metricCard('Store visitors', integer(visitors), metricChange(metrics, 'visitors') || valueOf(changes, ['visitors']), 'users')}${metricCard('Product views', integer(productViews), valueOf(changes, ['productViews', 'views']), 'cube')}${metricCard('Checkout starts', integer(checkouts), valueOf(changes, ['checkouts', 'checkoutStarts']), 'credit-card')}${metricCard('Conversion rate', percent(conversion), metricChange(metrics, 'conversion') || valueOf(changes, ['conversion', 'conversionRate']), 'repeat')}</section>
        <div class="ws-two-column ws-analytics-grid"><section class="ws-panel ws-chart-panel"><header><div><span class="ws-eyebrow">Traffic</span><h2>Visitors over time</h2></div></header>${series.length ? `<div class="ws-chart ws-chart--compact" data-chart>${series.map((point) => `<button class="ws-chart-bar" type="button" style="--bar-height:${Math.max(4, point.value / max * 100)}%" aria-label="${esc(point.label)}: ${integer(point.value)} visitors"><output>${esc(point.label)} · ${integer(point.value)} visitors</output><i></i><span>${esc(point.label)}</span></button>`).join('')}</div>` : emptyState('No traffic data', 'Visits will appear as people discover your store.')}</section><section class="ws-panel"><header><div><span class="ws-eyebrow">Acquisition</span><h2>Top sources</h2></div></header>${sourceList(sources)}</section></div>
        <div class="ws-two-column"><section class="ws-panel"><header><div><span class="ws-eyebrow">Journey</span><h2>Conversion funnel</h2></div></header>${funnelList(funnel)}</section><section class="ws-panel"><header><div><span class="ws-eyebrow">Catalogue</span><h2>Top products</h2></div></header>${topProductList(topProducts)}</section></div>`);
      attachCharts();
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Analytics', 'See how visitors move from discovery to purchase.', filters) + errorState(error));
    }
  }

  function sourceList(sources) {
    if (!sources.length) return emptyState('No sources yet', 'Traffic sources will be grouped here.');
    const total = Math.max(...sources.map((source) => num(valueOf(source, ['value', 'visitors', 'sessions', 'orders']))), 1);
    const sum = sources.reduce((amount, item) => amount + num(valueOf(item, ['value', 'visitors', 'sessions', 'orders'])), 0);
    return `<div class="ws-source-list">${sources.map((source) => { const value = num(valueOf(source, ['value', 'visitors', 'sessions', 'orders'])); return `<div><span><b>${esc(source.name || source.source || 'Direct')}</b><small>${integer(value)} visitor${value === 1 ? '' : 's'}</small></span><i><b style="width:${value / total * 100}%"></b></i><strong>${percent(source.share ?? (sum ? value / sum * 100 : 0))}</strong></div>`; }).join('')}</div>`;
  }

  function funnelList(funnel) {
    if (!funnel.length) return emptyState('No funnel data', 'Journey steps will appear when storefront traffic is recorded.');
    const maximum = Math.max(...funnel.map((step) => num(valueOf(step, ['value', 'count']))), 1);
    return `<div class="ws-funnel-list">${funnel.map((step) => {
      const value = num(valueOf(step, ['value', 'count']));
      const rate = step.rate ?? (value / maximum * 100);
      return `<article><span><b>${esc(step.step || step.name || 'Step')}</b><small>${integer(value)} people</small></span><i><b style="width:${Math.min(100, value / maximum * 100)}%"></b></i><strong>${percent(rate)}</strong></article>`;
    }).join('')}</div>`;
  }

  function topProductList(products) {
    if (!products.length) return emptyState('No product sales', 'Top products will appear after attributed purchases.');
    return `<div class="ws-top-product-list">${products.map((product, index) => `<article><span>${index + 1}</span><div><b>${esc(product.name || product.productName || 'Digital product')}</b><small>${integer(valueOf(product, ['sales', 'orders'], 0))} sale${num(valueOf(product, ['sales', 'orders'], 0)) === 1 ? '' : 's'}</small></div><strong>${money(valueOf(product, ['revenue', 'amount'], 0), product.currency || 'EUR')}</strong></article>`).join('')}</div>`;
  }

  async function renderFinance() {
    const token = ++app.routeToken;
    setContent(pageTitle('Finance', 'Track available funds and request payouts.', button('Request payout', 'new-payout', { kind: 'primary' })) + skeleton());
    try {
      const data = await request('/api/payouts');
      if (token !== app.routeToken) return;
      const payouts = list(data, 'payouts');
      app.cache.payouts = payouts;
      const summary = data?.summary || {};
      const currency = data?.currency || summary.currency || 'EUR';
      const available = valueOf(summary, ['available', 'availableBalance'], valueOf(data, ['available', 'availableBalance'], 0));
      const pending = valueOf(summary, ['pending', 'pendingBalance'], payouts.filter((item) => /pending/i.test(item.status || '')).reduce((sum, item) => sum + num(item.amount), 0));
      const paid = valueOf(summary, ['paid', 'paidOut', 'totalPaid'], payouts.filter((item) => /paid|complete/i.test(item.status || '')).reduce((sum, item) => sum + num(item.amount), 0));
      app.cache.financeSummary = { ...summary, available, pending, paid, currency };
      setContent(pageTitle('Finance', 'Track available funds and request payouts.', button('Request payout', 'new-payout', { kind: 'primary', disabled: available <= 0 })) + `<section class="ws-balance-card ws-balance-card--three"><div><span>Available balance</span><strong>${money(available, currency)}</strong><small>Maximum currently available to request</small></div><div><span>Pending payouts</span><strong>${money(pending, currency)}</strong><small>Transfers currently being processed</small></div><div><span>Paid out to date</span><strong>${money(paid, currency)}</strong><small>${esc(summary?.bankLabel || 'Default payout account')}</small></div></section><section class="ws-panel ws-table-panel"><header><div><span class="ws-eyebrow">Payout history</span><h2>Transfers</h2></div></header>${payoutTable(payouts, currency)}</section>`);
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Finance', 'Track available funds and request payouts.') + errorState(error));
    }
  }

  function payoutTable(payouts, currency) {
    if (!payouts.length) return emptyState('No payouts yet', 'Your completed and pending transfers will appear here.', button('Request payout', 'new-payout', { kind: 'primary' }));
    return `<div class="ws-table-wrap"><table class="ws-table"><thead><tr><th>Transfer</th><th>Requested</th><th>Arrival</th><th>Status</th><th class="ws-align-right">Amount</th></tr></thead><tbody>${payouts.map((payout) => `<tr><td><b>#${esc(payout.reference || String(payout.id || '').slice(-8))}</b></td><td>${dateText(payout.createdAt || payout.requestedAt)}</td><td>${dateText(payout.arrivalDate || payout.completedAt || payout.paidAt)}</td><td>${badge(payout.status || 'Pending')}</td><td class="ws-align-right"><b>${money(payout.amount, payout.currency || currency)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  function payoutModal() {
    const summary = app.cache.financeSummary || {};
    showModal('Request payout', `<form class="ws-form" data-form="payout">${formField('Amount (EUR)', 'amount', { type: 'number', required: true, min: 1, max: summary.available || undefined, step: '0.01', help: summary.available !== undefined ? `${money(summary.available, summary.currency || 'EUR')} available` : '' })}${formField('Destination', 'method', { type: 'select', options: [['Bank account', 'Default bank account']] })}<div class="ws-notice">This records a payout request in the workspace. A connected payment provider is required to move funds.</div>${modalSubmit('Record payout request')}</form>`, 'Finance');
  }

  async function renderIntegrations() {
    const token = ++app.routeToken;
    setContent(pageTitle('Integrations', 'Connect the tools that power your store and workflow.') + skeleton());
    try {
      const data = await request('/api/integrations');
      if (token !== app.routeToken) return;
      const integrations = list(data, 'integrations');
      app.cache.integrations = integrations;
      setContent(pageTitle('Integrations', 'Connect the tools that power your store and workflow.') + `<div class="ws-notice ws-demo-notice">${icon('help')}<span><b>Demo connections</b> These switches save a local demo state. A real connection requires provider credentials and OAuth.</span></div>` + (integrations.length ? `<div class="ws-integration-grid">${integrations.map((integration) => { const connected = integration.status === 'connected' || integration.connected || integration.enabled; return `<article class="ws-integration-card"><span class="ws-integration-logo">${integration.logo ? `<img src="${esc(integration.logo)}" alt="">` : esc(initials(integration.name))}</span><div><b>${esc(integration.name || 'Integration')}</b><p>${esc(integration.description || 'Connect this service to Shopway.')}</p><small>${connected ? 'Demo connection enabled · saved locally' : 'Demo connection disabled'}</small></div><label class="ws-switch"><input type="checkbox" data-integration-toggle="${esc(integration.id)}"${connected ? ' checked' : ''}><span></span><em>${connected ? 'Demo on' : 'Off'}</em></label></article>`; }).join('')}</div>` : emptyState('No integrations available', 'Available connections will appear here.')));
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Integrations', 'Connect the tools that power your store and workflow.') + errorState(error));
    }
  }

  async function renderSettings() {
    const token = ++app.routeToken;
    setContent(pageTitle('Settings', 'Manage your business details, locale and notifications.') + skeleton());
    try {
      const settingsData = await request('/api/settings');
      if (token !== app.routeToken) return;
      const settings = settingsData?.settings || settingsData || {};
      app.cache.settings = settings || {};
      setContent(pageTitle('Settings', 'Manage your business details, locale and notifications.') + `<div class="ws-settings-grid"><nav class="ws-settings-nav" aria-label="Settings sections"><a href="#business">Business</a><a href="#email-identity">Email identity</a><a href="#regional">Regional</a><a href="#notifications">Notifications</a></nav><form class="ws-panel ws-form ws-settings-form" data-form="settings"><section id="business"><span class="ws-eyebrow">Business</span><h2>Company details</h2><div class="ws-form-row">${formField('Business name', 'businessName', { value: settings?.businessName || settings?.name || '', required: true })}${formField('Support email', 'supportEmail', { value: settings?.supportEmail || settings?.email || '', type: 'email', required: true })}</div>${formField('Business address', 'address', { type: 'textarea', value: settings?.address || '' })}</section><section id="email-identity"><span class="ws-eyebrow">Email</span><h2>Sender identity</h2><div class="ws-form-row">${formField('Sender name', 'senderName', { value: settings?.senderName || '', required: true })}${formField('Sender email', 'senderEmail', { value: settings?.senderEmail || '', type: 'email', required: true })}</div></section><section id="regional"><span class="ws-eyebrow">Regional</span><h2>Currency, language and time zone</h2><div class="ws-form-row">${formField('Currency', 'currency', { type: 'select', value: settings?.currency || 'EUR', options: [['EUR', 'EUR — Euro'], ['USD', 'USD — US dollar'], ['GBP', 'GBP — Pound sterling'], ['CHF', 'CHF — Swiss franc'], ['CAD', 'CAD — Canadian dollar']] })}${formField('Language', 'language', { type: 'select', value: settings?.language || 'fr', options: [['fr', 'Français'], ['en', 'English'], ['es', 'Español']] })}</div>${formField('Time zone', 'timezone', { value: settings?.timezone || 'Europe/Paris' })}<label class="ws-check"><input type="checkbox" name="taxEnabled"${settings?.taxEnabled ? ' checked' : ''}><span>Enable tax calculation</span></label></section><section id="notifications"><span class="ws-eyebrow">Notifications</span><h2>Email preferences</h2><label class="ws-check"><input type="checkbox" name="orderNotifications"${settings?.orderNotifications !== false ? ' checked' : ''}><span>New order notifications</span></label><label class="ws-check"><input type="checkbox" name="payoutNotifications"${settings?.payoutNotifications !== false ? ' checked' : ''}><span>Payout notifications</span></label><label class="ws-check"><input type="checkbox" name="marketingEmails"${settings?.marketingEmails ? ' checked' : ''}><span>Shopway product updates</span></label></section><div class="ws-form-actions"><span class="ws-muted">Settings are saved for this workspace.</span><button class="ws-button ws-button--primary" type="submit">Save settings</button></div></form></div>`);
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Settings', 'Manage your business details, locale and notifications.') + errorState(error));
    }
  }

  const DEFAULT_PRICE_MIX = [
    { priceCents: 900, weight: 15 },
    { priceCents: 5700, weight: 30 },
    { priceCents: 9700, weight: 25 },
    { priceCents: 11700, weight: 18 },
    { priceCents: 12700, weight: 12 }
  ];

  function normalizeDemoProfile(payload) {
    const source = payload?.profile || payload?.demoProfile || payload || {};
    const rawMix = Array.isArray(source.priceMix) ? source.priceMix : Array.isArray(source.prices) ? source.prices : [];
    const priceMix = DEFAULT_PRICE_MIX.map((fallback, index) => {
      const item = rawMix[index] || {};
      const priceCents = item.priceCents !== undefined ? num(item.priceCents, fallback.priceCents) : Math.round(num(item.price, fallback.priceCents / 100) * 100);
      return { priceCents, weight: num(item.weight, fallback.weight) };
    });
    return {
      monthlyMinCents: num(valueOf(source, ['monthlyMinCents', 'monthlyRevenueMinCents'], source.monthlyRevenue?.minCents), 600000),
      monthlyMaxCents: num(valueOf(source, ['monthlyMaxCents', 'monthlyRevenueMaxCents'], source.monthlyRevenue?.maxCents), 1200000),
      priceMix,
      conversionRate: num(source.conversionRate, 2.4),
      addToCartRate: num(source.addToCartRate, 8),
      checkoutRate: num(source.checkoutRate, 4.5),
      refundRate: num(source.refundRate, 3),
      repeatBuyerRate: num(source.repeatBuyerRate, 8),
      seed: Math.round(num(source.seed, 20260723)),
      identityPoolSize: Math.round(num(valueOf(source, ['identityPoolSize', 'customerPoolSize'], 320000), 320000)),
      updatedAt: source.updatedAt || payload?.updatedAt || null,
      lastGeneratedAt: source.lastGeneratedAt || payload?.lastGeneratedAt || null
    };
  }

  function diagnosticItems(payload) {
    const candidate = payload?.checks || payload?.diagnostics || payload?.items || payload;
    if (Array.isArray(candidate)) return candidate;
    if (!candidate || typeof candidate !== 'object') return [];
    return Object.entries(candidate)
      .filter(([key]) => !['summary', 'generatedAt', 'updatedAt'].includes(key))
      .map(([key, value]) => {
        if (typeof value === 'boolean') return { name: key, status: value ? 'pass' : 'fail', message: value ? 'Check passed.' : 'Check failed.' };
        if (typeof value === 'string') return { name: key, status: /pass|ok|healthy/i.test(value) ? 'pass' : /warn/i.test(value) ? 'warning' : 'fail', message: value };
        return { name: value?.name || value?.label || key, status: value?.status || (value?.ok === false ? 'fail' : value?.warning ? 'warning' : 'pass'), message: value?.message || value?.detail || '' };
      });
  }

  function diagnosticCards(payload) {
    const items = diagnosticItems(payload);
    if (!items.length) return `<div class="ws-diagnostic-card ws-diagnostic-card--warning">${icon('help')}<div><b>Diagnostics unavailable</b><p>The API did not return any checks.</p></div></div>`;
    return `<div class="ws-diagnostic-grid">${items.map((item) => {
      const rawStatus = String(item.status || (item.ok === false ? 'fail' : 'pass')).toLowerCase();
      const status = /fail|error|critical/.test(rawStatus) ? 'fail' : /warn|attention/.test(rawStatus) ? 'warning' : 'pass';
      const title = item.name || item.label || item.key || (item.id ? String(item.id).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Diagnostic');
      return `<article class="ws-diagnostic-card ws-diagnostic-card--${status}"><span>${status === 'pass' ? '✓' : status === 'warning' ? '!' : '×'}</span><div><b>${esc(title)}</b><p>${esc(item.message || item.detail || (status === 'pass' ? 'Check passed.' : 'Review this check.'))}</p></div><small>${status}</small></article>`;
    }).join('')}</div>`;
  }

  function demoPriceRows(priceMix) {
    return `<div class="ws-price-mix"><div class="ws-price-mix-head"><span>Price</span><span>Sales mix</span></div>${priceMix.map((item, index) => `<div class="ws-price-row"><label><span class="sr-only">Price ${index + 1}</span><input type="number" name="price${index}" min="0.01" step="0.01" value="${esc((item.priceCents / 100).toFixed(2))}" required><em>€</em></label><label><span class="sr-only">Weight ${index + 1}</span><input type="number" name="weight${index}" min="0" max="100" step="0.1" value="${esc(item.weight)}" required><em>%</em></label></div>`).join('')}</div>`;
  }

  function updateAdminPreview() {
    const form = $('[data-form="demo-profile"]');
    if (!form) return;
    const data = new FormData(form);
    const prices = DEFAULT_PRICE_MIX.map((_, index) => ({ price: num(data.get(`price${index}`)), weight: num(data.get(`weight${index}`)) }));
    const weightTotal = prices.reduce((sum, item) => sum + item.weight, 0);
    const weightedAov = weightTotal ? prices.reduce((sum, item) => sum + item.price * item.weight, 0) / weightTotal : 0;
    const monthlyMidpoint = (num(data.get('monthlyMin')) + num(data.get('monthlyMax'))) / 2;
    const monthlyOrders = weightedAov ? monthlyMidpoint / weightedAov : 0;
    const conversionRate = num(data.get('conversionRate'));
    const repeatRate = num(data.get('repeatBuyerRate'));
    const annualVisitors = conversionRate ? monthlyOrders * 12 / (conversionRate / 100) : 0;
    const annualBuyers = monthlyOrders * 12 / (1 + repeatRate / 100);
    $('[data-admin-aov]').textContent = money(weightedAov);
    $('[data-admin-orders]').textContent = `${integer(Math.round(monthlyOrders))}/mo`;
    $('[data-admin-buyers]').textContent = integer(Math.round(annualBuyers));
    $('[data-admin-audience]').textContent = integer(Math.round(annualVisitors));
    const weightNode = $('[data-admin-weight]');
    if (weightNode) {
      weightNode.textContent = `${num(weightTotal).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`;
      weightNode.classList.toggle('is-invalid', Math.abs(weightTotal - 100) > 0.01);
    }
    const explanation = $('[data-admin-explanation]');
    if (explanation) explanation.textContent = `At this price mix, the scenario needs about ${integer(Math.round(monthlyOrders))} paid orders per month. “Audience” means visitors; “buyers” are customers who completed a purchase.`;
  }

  async function renderAdminLab() {
    const token = ++app.routeToken;
    setContent(pageTitle('Admin Lab', 'Control and verify the synthetic commerce scenario.') + skeleton(6));
    try {
      const [profileResult, diagnosticResult] = await Promise.allSettled([
        request('/api/admin/demo-profile'),
        request('/api/admin/diagnostics')
      ]);
      if (token !== app.routeToken) return;
      if (profileResult.status === 'rejected') throw profileResult.reason;
      const profile = normalizeDemoProfile(profileResult.value);
      app.cache.demoProfile = profile;
      const diagnostics = diagnosticResult.status === 'fulfilled'
        ? diagnosticResult.value
        : { checks: [{ name: 'Diagnostics API', status: 'warning', message: diagnosticResult.reason?.message || 'Diagnostics could not be loaded.' }] };
      setContent(pageTitle('Admin Lab', 'Control and verify the synthetic commerce scenario.', button('Refresh checks', 'refresh-diagnostics', { icon: 'repeat' }))
        + `<div class="ws-admin-layout"><form class="ws-panel ws-form ws-admin-form" data-form="demo-profile"><section><span class="ws-eyebrow">Revenue engine</span><h2>Monthly scenario</h2><p class="ws-muted">Generate credible monthly performance while preserving a deterministic seed.</p><div class="ws-form-row">${formField('Monthly minimum (€)', 'monthlyMin', { type: 'number', min: 0, step: '1', value: (profile.monthlyMinCents / 100).toFixed(0), required: true })}${formField('Monthly maximum (€)', 'monthlyMax', { type: 'number', min: 0, step: '1', value: (profile.monthlyMaxCents / 100).toFixed(0), required: true })}</div></section><section><span class="ws-eyebrow">Price ladder</span><h2>Exactly five offers</h2><p class="ws-muted">Weights must total 100%. The weighted result sets the average order value.</p>${demoPriceRows(profile.priceMix)}<div class="ws-weight-total"><span>Weight total</span><strong data-admin-weight>100%</strong></div></section><section><span class="ws-eyebrow">Funnel</span><h2>Traffic and buyer behaviour</h2><div class="ws-form-row">${formField('Conversion rate (%)', 'conversionRate', { type: 'number', min: 0.01, max: 100, step: '0.01', value: profile.conversionRate, required: true })}${formField('Add-to-cart rate (%)', 'addToCartRate', { type: 'number', min: 0.01, max: 100, step: '0.01', value: profile.addToCartRate, required: true })}</div><div class="ws-form-row">${formField('Checkout rate (%)', 'checkoutRate', { type: 'number', min: 0.01, max: 100, step: '0.01', value: profile.checkoutRate, required: true })}${formField('Refund rate (%)', 'refundRate', { type: 'number', min: 0, max: 49.99, step: '0.01', value: profile.refundRate, required: true })}</div><div class="ws-form-row">${formField('Repeat buyer rate (%)', 'repeatBuyerRate', { type: 'number', min: 0, max: 89.99, step: '0.01', value: profile.repeatBuyerRate, required: true })}${formField('Deterministic seed', 'seed', { type: 'number', min: 1, max: 2147483647, step: '1', value: profile.seed, required: true })}</div>${formField('Audience / identity combinations', 'identityPoolSize', { type: 'number', min: 250000, max: 10000000, step: '1', value: profile.identityPoolSize, required: true, help: 'Controls the available gamer/creator identity combinations. Only customers who actually buy are materialized.' })}</section><div class="ws-form-actions ws-admin-actions"><button class="ws-button ws-button--danger" type="button" data-action="reset-demo-profile">Reset defaults</button><span></span><button class="ws-button ws-button--secondary" type="button" data-action="regenerate-demo-data">Regenerate synthetic data</button><button class="ws-button ws-button--primary" type="submit">Save scenario</button></div></form>
        <aside class="ws-admin-side"><section class="ws-panel ws-admin-preview"><header><div><span class="ws-eyebrow">Live estimate</span><h2>Scenario maths</h2></div></header><div class="ws-admin-stats"><div><span>Weighted AOV</span><strong data-admin-aov>—</strong></div><div><span>Paid orders</span><strong data-admin-orders>—</strong></div><div><span>Annual buyers</span><strong data-admin-buyers>—</strong></div><div><span>Annual audience</span><strong data-admin-audience>—</strong></div></div><p data-admin-explanation></p><div class="ws-notice"><b>Reality check</b> Buyers are not visitors. At €6k–€12k/month, a credible dataset has roughly one thousand annual buyers—not hundreds of thousands.</div>${profile.lastGeneratedAt ? `<small>Last regenerated ${dateText(profile.lastGeneratedAt)}</small>` : ''}</section></aside></div>
        <section class="ws-panel ws-diagnostics"><header><div><span class="ws-eyebrow">Diagnostics</span><h2>Data and dashboard health</h2></div><span class="ws-muted">Pass, warning and failure states come from the backend.</span></header>${diagnosticCards(diagnostics)}</section>`);
      updateAdminPreview();
    } catch (error) {
      if (token === app.routeToken) setContent(pageTitle('Admin Lab', 'Control and verify the synthetic commerce scenario.') + errorState(error));
    }
  }

  const renderers = {
    dashboard: renderDashboard, storefront: renderStorefront, products: renderProducts, orders: renderOrders,
    customers: renderCustomers, marketing: renderMarketing, analytics: renderAnalytics, finance: renderFinance,
    integrations: renderIntegrations, settings: renderSettings, 'admin-lab': renderAdminLab
  };

  function renderPage() {
    if (app.chartCleanup) { app.chartCleanup(); app.chartCleanup = null; }
    renderers[app.page]?.();
    $('#ws-content')?.focus({ preventScroll: true });
  }

  async function download(path, filename) {
    try {
      const blob = await request(path, { blob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast(`${filename} downloaded`);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function customRangeModal(context = 'dashboard') {
    const start = context === 'analytics' ? app.analyticsStart : app.dashboardStart;
    const end = context === 'analytics' ? app.analyticsEnd : app.dashboardEnd;
    showModal('Custom date range', `<form class="ws-form" data-form="custom-range" data-context="${context}"><div class="ws-form-row">${formField('Start date', 'start', { type: 'date', value: start, required: true })}${formField('End date', 'end', { type: 'date', value: end, required: true })}</div>${modalSubmit('Apply range')}</form>`, 'Analytics');
  }

  function notificationModal() {
    showModal('Notifications', `<div class="ws-notification-list"><article>${icon('receipt')}<div><b>Orders are ready to fulfil</b><p>Digital delivery runs automatically after every successful payment.</p><small>System update</small></div></article><article>${icon('wallet')}<div><b>Payout tracking is active</b><p>Open Finance to review transfers and available balance.</p><small>Workspace tip</small></div></article></div><div class="ws-form-actions">${button('Open orders', 'view-orders')}${button('Open finance', 'view-finance', { kind: 'primary' })}</div>`, 'Inbox');
  }

  function globalSearch(query) {
    const panel = $('[data-search-results]');
    const value = query.trim().toLowerCase();
    if (!value) { panel.hidden = true; panel.innerHTML = ''; return; }
    const pageMatches = PAGES.filter(([, label]) => label.toLowerCase().includes(value)).map(([id, label, iconName]) => ({ type: 'page', id, title: label, subtitle: 'Open section', icon: iconName }));
    const productMatches = (app.cache.products || []).filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(value)).slice(0, 4).map((item) => ({ type: 'page', id: 'products', title: item.name, subtitle: money(item.price, item.currency || 'EUR'), icon: 'cube' }));
    const customerMatches = (app.cache.customers || []).filter((item) => `${item.name || ''} ${item.firstName || ''} ${item.lastName || ''} ${item.email || ''}`.toLowerCase().includes(value)).slice(0, 4).map((item) => ({ type: 'page', id: 'customers', title: item.name || `${item.firstName || ''} ${item.lastName || ''}`, subtitle: item.email || 'Customer', icon: 'users' }));
    const matches = [...pageMatches, ...productMatches, ...customerMatches].slice(0, 8);
    panel.innerHTML = matches.length ? `<p>Search results</p>${matches.map((item) => `<button type="button" data-nav="${item.id}">${icon(item.icon)}<span><b>${esc(item.title)}</b><small>${esc(item.subtitle)}</small></span></button>`).join('')}` : `<div class="ws-search-empty">No matching section or loaded record. Try “Products” or “Orders”.</div>`;
    panel.hidden = false;
  }

  function openStoreLink() {
    return $('[data-store-url]')?.value || app.cache.store?.url || app.cache.store?.publicUrl || `${location.origin}/store.html`;
  }

  async function handleAction(buttonNode) {
    const action = buttonNode.dataset.action;
    const id = buttonNode.dataset.id;
    if (!action) return;
    if (action === 'open-drawer') return openDrawer();
    if (action === 'close-drawer') return closeDrawer();
    if (action === 'close-modal') return closeModal();
    if (action === 'retry-page') return renderPage();
    if (action === 'toggle-theme') {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(THEME_KEY, theme);
      $('.ws-theme-icon use')?.setAttribute('href', theme === 'dark' ? '#icon-sun' : '#icon-moon');
      return;
    }
    if (action === 'toggle-create') {
      const menu = $('[data-create-menu]');
      menu.hidden = !menu.hidden;
      return;
    }
    if (action === 'toggle-usage-sidebar') {
      $('.ws-app--usage')?.classList.toggle('is-sidebar-collapsed');
      return;
    }
    $('[data-create-menu]')?.setAttribute('hidden', '');
    if (action === 'notifications') return notificationModal();
    if (action === 'usage-range-menu') {
      const menu = $('[data-usage-range-menu]');
      if (!menu) return;
      menu.hidden = !menu.hidden;
      buttonNode.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (action === 'usage-month-menu') {
      const menu = $('[data-usage-month-menu]');
      if (!menu) return;
      menu.hidden = !menu.hidden;
      buttonNode.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (action === 'usage-month-select') {
      app.dashboardRange = 'custom';
      app.dashboardStart = buttonNode.dataset.start || '';
      app.dashboardEnd = buttonNode.dataset.end || '';
      $('[data-usage-month-menu]')?.setAttribute('hidden', '');
      return renderDashboard();
    }
    if (action === 'usage-month-custom') {
      $('[data-usage-month-menu]')?.setAttribute('hidden', '');
      return customRangeModal('dashboard');
    }
    if (action === 'usage-chart-menu') {
      const menu = $('[data-usage-chart-menu]');
      if (menu) menu.hidden = !menu.hidden;
      return;
    }
    if (action === 'usage-sort') {
      const sort = buttonNode.dataset.sort || 'user';
      if (app.usageSort === sort) app.usageSortDirection = app.usageSortDirection === 'asc' ? 'desc' : 'asc';
      else { app.usageSort = sort; app.usageSortDirection = 'asc'; }
      return refreshUsageTable();
    }
    if (action === 'usage-row') {
      const row = (app.cache.usageRows || [])[num(buttonNode.dataset.usageRow)];
      if (row) return showModal(row.name, `<div class="ws-usage-detail"><strong>${esc(row.email)}</strong><p>${esc(row.product)} · ${dateText(row.purchaseDate)} · ${money(row.amount)}</p></div>`, 'Customer');
      return;
    }
    if (action === 'dashboard-chart-type') {
      const type = buttonNode.dataset.chartType;
      if (!DASHBOARD_CHART_TYPES.has(type)) return;
      app.dashboardChartType = type;
      localStorage.setItem(DASHBOARD_CHART_KEY, type);
      $('[data-usage-chart-menu]')?.setAttribute('hidden', '');
      return renderDashboard();
    }
    if (action === 'dashboard-range') {
      const range = buttonNode.dataset.range;
      if (range === 'custom') return customRangeModal('dashboard');
      app.dashboardRange = range;
      $('[data-usage-range-menu]')?.setAttribute('hidden', '');
      $('[data-usage-range-menu]')?.previousElementSibling?.setAttribute('aria-expanded', 'false');
      return renderDashboard();
    }
    if (action === 'analytics-range') {
      const range = buttonNode.dataset.range;
      if (range === 'custom') return customRangeModal('analytics');
      app.analyticsRange = range;
      return renderAnalytics();
    }
    if (action === 'refresh-diagnostics') return renderAdminLab();
    if (action === 'regenerate-demo-data') {
      const confirmation = window.prompt('Type REGENERATE to replace the current synthetic dataset. Manual and checkout data are preserved.');
      if (confirmation !== 'REGENERATE') return;
      buttonNode.disabled = true;
      try {
        await request('/api/admin/demo-profile/regenerate', { method: 'POST', body: { confirmation: 'REGENERATE' } });
        toast('Synthetic data regenerated');
        window.setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        buttonNode.disabled = false;
        toast(error.message, 'error');
      }
      return;
    }
    if (action === 'reset-demo-profile') {
      const confirmation = window.prompt('Type RESET to restore the default scenario and regenerate its synthetic data.');
      if (confirmation !== 'RESET') return;
      buttonNode.disabled = true;
      try {
        await request('/api/admin/demo-profile/reset', { method: 'POST', body: { confirmation: 'RESET' } });
        toast('Demo scenario reset');
        window.setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        buttonNode.disabled = false;
        toast(error.message, 'error');
      }
      return;
    }
    if (action === 'view-customers') return navigate('customers');
    if (action === 'view-orders') { closeModal(); return navigate('orders'); }
    if (action === 'view-finance') { closeModal(); return navigate('finance'); }
    if (action === 'new-product') return productModal();
    if (action === 'edit-product') return productModal((app.cache.products || []).find((item) => String(item.id) === String(id)) || {});
    if (action === 'delete-product') {
      if (!confirm('Archive this product? It will be removed from the active catalogue.')) return;
      try { await request(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Product archived'); renderProducts(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'copy-store-link') {
      try { await navigator.clipboard.writeText(openStoreLink()); toast('Store link copied'); } catch { toast('Copy is unavailable in this browser', 'error'); }
      return;
    }
    if (action === 'open-store') { window.open(openStoreLink(), '_blank', 'noopener'); return; }
    if (action === 'publish-store') {
      try { await request('/api/store/publish', { method: 'POST' }); toast('Store published'); renderStorefront(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'apply-template') {
      try { await request(`/api/templates/${encodeURIComponent(id)}/apply`, { method: 'POST' }); toast('Template applied'); renderStorefront(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'clear-order-filters') { app.orderSearch = ''; app.orderStatus = ''; app.orderProduct = ''; app.orderPage = 0; return renderOrders(); }
    if (action === 'orders-prev') { app.orderPage = Math.max(0, app.orderPage - 1); return renderOrders(); }
    if (action === 'orders-next') { app.orderPage += 1; return renderOrders(); }
    if (action === 'refund-order') {
      if (!confirm('Record this order as refunded? A payment provider must be connected to move funds.')) return;
      try { await request(`/api/orders/${encodeURIComponent(id)}/refund`, { method: 'POST' }); toast('Refund recorded in the workspace'); renderOrders(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'resend-order') {
      try { await request(`/api/orders/${encodeURIComponent(id)}/resend`, { method: 'POST' }); toast('Resend request recorded'); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'export-orders') return download(queryWith('/api/orders/export', { search: app.orderSearch, status: app.orderStatus, product: app.orderProduct }), 'shopway-orders.csv');
    if (action === 'new-customer') return customerModal();
    if (action === 'export-customers') return download('/api/customers/export', 'shopway-customers.csv');
    if (action === 'new-discount') return discountModal();
    if (action === 'toggle-discount') {
      const discount = (app.cache.discounts || []).find((item) => String(item.id) === String(id));
      try { await request(`/api/discounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { active: discount?.active === false } }); toast(discount?.active === false ? 'Discount activated' : 'Discount paused'); renderMarketing(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'delete-discount') {
      if (!confirm('Delete this discount code?')) return;
      try { await request(`/api/discounts/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Discount deleted'); renderMarketing(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'new-campaign') return campaignModal();
    if (action === 'send-campaign') {
      if (!confirm('Mark this campaign as sent? No external email provider is connected in demo mode.')) return;
      try { await request(`/api/campaigns/${encodeURIComponent(id)}/send`, { method: 'POST' }); toast('Campaign marked as sent'); renderMarketing(); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'new-payout') return payoutModal();
  }

  async function handleSubmit(form) {
    const type = form.dataset.form;
    const data = Object.fromEntries(new FormData(form));
    const submit = $('button[type="submit"]', form);
    if (submit) { submit.disabled = true; submit.dataset.label = submit.textContent; submit.textContent = 'Working…'; }
    try {
      if (type === 'custom-range') {
        if (new Date(data.start) > new Date(data.end)) throw new Error('Start date must be before the end date.');
        const context = form.dataset.context || 'dashboard';
        closeModal();
        if (context === 'analytics') {
          app.analyticsRange = 'custom'; app.analyticsStart = data.start; app.analyticsEnd = data.end;
          return renderAnalytics();
        }
        app.dashboardRange = 'custom'; app.dashboardStart = data.start; app.dashboardEnd = data.end;
        return renderDashboard();
      }
      if (type === 'store') {
        const payload = { name: data.name, tagline: data.tagline, description: data.description, slug: data.slug, logoUrl: data.logoUrl || null, theme: { ...(app.cache.store?.theme || {}), accent: data.accent, heroImage: data.heroImage } };
        const saved = await request('/api/store', { method: 'PATCH', body: payload });
        app.cache.store = saved?.store || saved || { ...app.cache.store, ...payload }; toast('Storefront saved'); return renderStorefront();
      }
      if (type === 'product') {
        let assetPath = '';
        const file = form.elements.file?.files?.[0];
        if (file) {
          const uploaded = await request(`/api/uploads?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, raw: true });
          assetPath = uploaded?.upload?.assetPath || uploaded?.assetPath || uploaded?.path || (typeof uploaded === 'string' ? uploaded : '');
        }
        const payload = { ...data, price: num(data.price), ...(assetPath ? { assetPath } : {}) };
        delete payload.file;
        const id = form.dataset.id;
        await request(id ? `/api/products/${encodeURIComponent(id)}` : '/api/products', { method: id ? 'PATCH' : 'POST', body: payload });
        closeModal(); toast(id ? 'Product updated' : 'Product created'); return renderProducts();
      }
      if (type === 'order-filter') {
        app.orderSearch = data.search || ''; app.orderStatus = data.status || ''; app.orderProduct = data.product || ''; app.orderPage = 0; return renderOrders();
      }
      if (type === 'customer') {
        await request('/api/customers', { method: 'POST', body: { name: data.name, email: data.email, country: data.country, source: data.source, marketingOptIn: data.marketingOptIn === 'true' } }); closeModal(); toast('Customer added'); return renderCustomers();
      }
      if (type === 'discount') {
        await request('/api/discounts', { method: 'POST', body: { ...data, value: num(data.value), maxUses: data.maxUses ? num(data.maxUses) : null } }); closeModal(); toast('Discount created'); return renderMarketing();
      }
      if (type === 'campaign') {
        const campaignResult = await request('/api/campaigns', { method: 'POST', body: { name: data.name, subject: data.subject, audience: data.audience, scheduledAt: data.scheduledAt || null } });
        const campaign = campaignResult?.campaign || campaignResult;
        if (data.sendNow === 'true' && campaign?.id) await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/send`, { method: 'POST' });
        closeModal(); toast(data.sendNow === 'true' ? 'Campaign created and sent' : 'Campaign created'); return renderMarketing();
      }
      if (type === 'payout') {
        const available = num(app.cache.financeSummary?.available, Number.POSITIVE_INFINITY);
        if (num(data.amount) > available) throw new Error(`Amount cannot exceed the available balance of ${money(available, app.cache.financeSummary?.currency || 'EUR')}.`);
        await request('/api/payouts', { method: 'POST', body: { ...data, amount: num(data.amount) } }); closeModal(); toast('Payout request recorded'); return renderFinance();
      }
      if (type === 'demo-profile') {
        const monthlyMinCents = Math.round(num(data.monthlyMin) * 100);
        const monthlyMaxCents = Math.round(num(data.monthlyMax) * 100);
        if (monthlyMinCents <= 0 || monthlyMaxCents <= 0 || monthlyMinCents > monthlyMaxCents) throw new Error('Monthly minimum must be positive and no greater than the maximum.');
        const priceMix = DEFAULT_PRICE_MIX.map((_, index) => ({
          priceCents: Math.round(num(data[`price${index}`]) * 100),
          weight: num(data[`weight${index}`])
        }));
        if (priceMix.some((item) => item.priceCents <= 0 || item.weight <= 0)) throw new Error('Each price and weight must be positive.');
        const weightTotal = priceMix.reduce((sum, item) => sum + item.weight, 0);
        if (Math.abs(weightTotal - 100) > 0.01) throw new Error(`Price weights must total 100% (currently ${weightTotal.toFixed(1)}%).`);
        const conversionRate = num(data.conversionRate);
        const addToCartRate = num(data.addToCartRate);
        const checkoutRate = num(data.checkoutRate);
        if (conversionRate > checkoutRate || checkoutRate > addToCartRate) throw new Error('Funnel rates must follow: conversion ≤ checkout ≤ add to cart.');
        const payload = {
          monthlyMinCents,
          monthlyMaxCents,
          priceMix,
          conversionRate,
          addToCartRate,
          checkoutRate,
          refundRate: num(data.refundRate),
          repeatBuyerRate: num(data.repeatBuyerRate),
          seed: Math.round(num(data.seed)),
          identityPoolSize: Math.round(num(data.identityPoolSize))
        };
        await request('/api/admin/demo-profile', { method: 'PATCH', body: payload });
        toast('Demo scenario saved');
        return renderAdminLab();
      }
      if (type === 'settings') {
        const payload = {
          businessName: data.businessName,
          supportEmail: data.supportEmail,
          address: data.address,
          senderName: data.senderName,
          senderEmail: data.senderEmail,
          currency: data.currency,
          language: data.language,
          timezone: data.timezone,
          taxEnabled: Boolean(form.elements.taxEnabled.checked),
          orderNotifications: Boolean(form.elements.orderNotifications.checked),
          payoutNotifications: Boolean(form.elements.payoutNotifications.checked),
          marketingEmails: Boolean(form.elements.marketingEmails.checked)
        };
        await request('/api/settings', { method: 'PATCH', body: payload }); toast('Settings saved'); return renderSettings();
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      if (submit?.isConnected) { submit.disabled = false; submit.textContent = submit.dataset.label || 'Save'; }
    }
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-nav]');
      if (nav) { event.preventDefault(); $('[data-search-results]')?.setAttribute('hidden', ''); return navigate(nav.dataset.nav); }
      const action = event.target.closest('[data-action]');
      if (action) { event.preventDefault(); handleAction(action); return; }
      if (!event.target.closest('[data-create-menu], .ws-create-trigger')) $('[data-create-menu]')?.setAttribute('hidden', '');
      if (!event.target.closest('.ws-global-search, [data-search-results]')) $('[data-search-results]')?.setAttribute('hidden', '');
      if (!event.target.closest('[data-usage-range-menu], [data-action="usage-range-menu"]')) {
        $('[data-usage-range-menu]')?.setAttribute('hidden', '');
        $('[data-usage-range-menu]')?.previousElementSibling?.setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('[data-usage-month-menu], [data-action="usage-month-menu"]')) {
        $('[data-usage-month-menu]')?.setAttribute('hidden', '');
        $('[data-action="usage-month-menu"]')?.setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('[data-usage-chart-menu], [data-action="usage-chart-menu"]')) $('[data-usage-chart-menu]')?.setAttribute('hidden', '');
    });
    document.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-form]');
      if (!form) return;
      event.preventDefault(); handleSubmit(form);
    });
    document.addEventListener('input', (event) => {
      if (event.target.matches('[data-sidebar-search]')) {
        const query = event.target.value.trim().toLowerCase();
        $$('.ws-nav-item').forEach((item) => { item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query); });
      }
      if (event.target.matches('[data-global-search]')) globalSearch(event.target.value);
      if (event.target.matches('[data-usage-search]')) { app.usageSearch = event.target.value; refreshUsageTable(); }
      if (event.target.closest('[data-form="demo-profile"]')) updateAdminPreview();
    });
    document.addEventListener('change', async (event) => {
      const toggle = event.target.closest('[data-integration-toggle]');
      if (!toggle) return;
      const connected = toggle.checked;
      toggle.disabled = true;
      try { await request(`/api/integrations/${encodeURIComponent(toggle.dataset.integrationToggle)}`, { method: 'PATCH', body: { status: connected ? 'connected' : 'disconnected' } }); toast(connected ? 'Demo connection enabled' : 'Demo connection disabled'); renderIntegrations(); }
      catch (error) { toggle.checked = !connected; toggle.disabled = false; toast(error.message, 'error'); }
    });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('[data-global-search]')?.focus(); }
      if (event.key === 'Escape') { $('[data-search-results]')?.setAttribute('hidden', ''); $('[data-create-menu]')?.setAttribute('hidden', ''); closeDrawer(); }
    });
    window.addEventListener('popstate', () => { app.page = currentPage(); updateActiveNavigation(); renderPage(); });
    $('[data-modal]')?.addEventListener('click', (event) => { if (event.target.matches('[data-modal]')) closeModal(); });
  }

  function boot() {
    const existing = $('main.app-shell') || $('main');
    if (!existing || $('.ws-app')) return;
    app.page = currentPage();
    existing.outerHTML = shell('shopway');
    document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    const savedChartType = localStorage.getItem(DASHBOARD_CHART_KEY);
    app.dashboardChartType = DASHBOARD_CHART_TYPES.has(savedChartType) ? savedChartType : 'bars';
    $('.ws-theme-icon use')?.setAttribute('href', document.documentElement.dataset.theme === 'dark' ? '#icon-sun' : '#icon-moon');
    bindEvents();
    updateActiveNavigation();
    navigate(app.page, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
