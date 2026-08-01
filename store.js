(() => {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const shell = $('[data-store-shell]');
  const loadingState = $('[data-loading-state]');
  const errorState = $('[data-error-state]');
  const errorMessage = $('[data-error-message]');
  const emptyState = $('[data-empty-state]');
  const productGrid = $('[data-product-grid]');
  const productCount = $('[data-product-count]');
  const checkoutDialog = $('[data-checkout-dialog]');
  const checkoutForm = $('[data-checkout-form]');
  const checkoutFormView = $('[data-checkout-form-view]');
  const checkoutSuccess = $('[data-checkout-success]');
  const checkoutFeedback = $('[data-checkout-feedback]');
  const legalDialog = $('[data-legal-dialog]');
  const newsletterForm = $('[data-newsletter-form]');
  const newsletterFeedback = $('[data-newsletter-feedback]');
  const toast = $('[data-toast]');
  const menuToggle = $('[data-menu-toggle]');
  const navigation = $('[data-navigation]');

  const params = new URLSearchParams(window.location.search);
  const requestedSlug = (params.get('slug') || params.get('store') || '').trim();
  const slug = requestedSlug || 'studio-nova';

  const state = {
    store: null,
    products: [],
    selectedProduct: null,
    checkoutTrigger: null,
    loadController: null,
    toastTimer: null
  };

  const DEFAULT_LEGAL = {
    terms: {
      title: 'Conditions de vente',
      paragraphs: [
        'Les produits proposés sur cette boutique sont des contenus digitaux. La commande est confirmée dès que son numéro et son lien d’accès sont affichés.',
        'Le prix présenté au moment de la commande est le prix final applicable. Le client reste responsable de l’exactitude de son adresse e-mail.',
        'L’achat accorde un droit d’utilisation personnel. La revente, le partage public ou la redistribution des fichiers ne sont pas autorisés sauf mention contraire sur le produit.'
      ]
    },
    privacy: {
      title: 'Confidentialité',
      paragraphs: [
        'Les informations saisies servent uniquement à traiter la commande, délivrer le produit et assurer le suivi demandé par le client.',
        'L’inscription aux nouveautés est indépendante d’un achat. Vous pouvez demander à ne plus recevoir ces messages à tout moment.',
        'Aucune donnée de contact n’est affichée publiquement depuis cette boutique.'
      ]
    },
    refunds: {
      title: 'Politique de remboursement',
      paragraphs: [
        'En raison de la livraison immédiate des contenus digitaux, les achats finalisés ne sont normalement pas remboursables.',
        'Si un fichier est inutilisable ou différent de sa description, contactez la boutique avec votre numéro de commande afin qu’une solution soit proposée.',
        'Cette politique ne limite pas les droits impératifs dont vous bénéficiez selon votre pays de résidence.'
      ]
    }
  };

  const textValue = (...values) => {
    const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim());
    return value ? value.trim() : '';
  };

  const apiMessage = (payload, fallback = '') => textValue(
    payload?.message,
    typeof payload?.error === 'string' ? payload.error : '',
    payload?.error?.message
  ) || fallback;

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => '');
      payload = text ? { message: text } : null;
    }

    if (!response.ok) {
      const error = new Error(apiMessage(payload, `La requête a échoué (${response.status}).`));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload || {};
  };

  const safeUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  };

  const initials = (value, fallback = 'SW') => {
    const parts = String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return fallback;
    return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts.at(-1)[0]}`)
      .toLocaleUpperCase('fr-FR');
  };

  const normalizePublicPayload = (payload) => {
    const envelope = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const store = envelope?.store || envelope?.shop || envelope?.boutique || envelope;
    const products = Array.isArray(envelope?.products)
      ? envelope.products
      : Array.isArray(store?.products)
        ? store.products
        : [];

    return { store: store || {}, products };
  };

  const normalizeProduct = (product, index) => {
    const status = String(product.status || '').toLowerCase();
    return {
      ...product,
      id: product.id ?? product.productId ?? product._id ?? `product-${index + 1}`,
      title: textValue(product.title, product.name) || `Produit ${index + 1}`,
      description: textValue(product.description, product.shortDescription, product.subtitle),
      type: textValue(product.type, product.category, product.format) || 'Produit digital',
      imageUrl: safeUrl(product.imageUrl || product.coverUrl || product.thumbnailUrl || product.image),
      published: product.published !== false && (!status || ['active', 'published', 'live'].includes(status))
    };
  };

  const moneyAmount = (product) => {
    const cents = Number(product.priceCents ?? product.amountCents ?? product.unitAmount);
    if (Number.isFinite(cents)) return cents / 100;
    const major = Number(product.price ?? product.amount ?? 0);
    return Number.isFinite(major) ? major : 0;
  };

  const currencyOf = (product) => String(product.currency || state.store?.currency || 'EUR').toUpperCase();

  const formatPrice = (product) => {
    const amount = moneyAmount(product);
    if (amount === 0) return 'Gratuit';
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: currencyOf(product),
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2
      }).format(amount);
    } catch {
      return `${amount.toFixed(2).replace('.', ',')} €`;
    }
  };

  const setText = (selector, value, scope = document) => {
    const node = $(selector, scope);
    if (node && value) node.textContent = value;
  };

  const setAvatar = (selector, name, imageUrl) => {
    $$(selector).forEach((node) => {
      node.replaceChildren();
      const image = safeUrl(imageUrl);
      if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
          node.replaceChildren(document.createTextNode(initials(name, 'S')));
        }, { once: true });
        node.append(img);
      } else {
        node.textContent = initials(name, 'S');
      }
    });
  };

  const isSupportedColor = (color) => {
    if (typeof color !== 'string' || color.length > 40) return false;
    return window.CSS?.supports?.('color', color.trim()) || false;
  };

  const applyTheme = (store) => {
    const theme = store.theme && typeof store.theme === 'object' ? store.theme : {};
    const background = theme.background || theme.paper || store.backgroundColor;
    const text = theme.text || theme.ink || store.textColor;
    const derivedSurface = isSupportedColor(background) && isSupportedColor(text)
      ? `color-mix(in srgb, ${background.trim()} 94%, ${text.trim()} 6%)`
      : '';
    const colors = {
      '--store-accent': theme.accent || theme.primary || store.accentColor || store.primaryColor,
      '--store-ink': text,
      '--store-paper': background,
      '--store-surface': theme.surface || theme.card || store.surfaceColor || derivedSurface
    };

    Object.entries(colors).forEach(([property, value]) => {
      if (isSupportedColor(value)) document.documentElement.style.setProperty(property, value.trim());
    });

    if (isSupportedColor(background) && isSupportedColor(text)) {
      document.documentElement.style.setProperty('--store-muted', `color-mix(in srgb, ${text.trim()} 62%, ${background.trim()})`);
      document.documentElement.style.setProperty('--store-subtle', `color-mix(in srgb, ${text.trim()} 48%, ${background.trim()})`);
      document.documentElement.style.setProperty('--store-border', `color-mix(in srgb, ${text.trim()} 14%, ${background.trim()})`);
      document.documentElement.style.setProperty('--store-soft', `color-mix(in srgb, ${text.trim()} 8%, ${background.trim()})`);
    }

    const metaTheme = $('meta[name="theme-color"]');
    if (metaTheme && isSupportedColor(colors['--store-paper'])) {
      metaTheme.content = colors['--store-paper'].trim();
    }
  };

  const renderFaq = (store) => {
    const list = $('[data-faq-list]');
    const faqs = Array.isArray(store.faqs) ? store.faqs : Array.isArray(store.faq) ? store.faq : [];
    if (!list || !faqs.length) return;

    list.replaceChildren();
    faqs.slice(0, 8).forEach((item) => {
      const question = textValue(item.question, item.title);
      const answer = textValue(item.answer, item.content, item.description);
      if (!question || !answer) return;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const indicator = document.createElement('span');
      const paragraph = document.createElement('p');
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = '+';
      summary.append(document.createTextNode(question), indicator);
      paragraph.textContent = answer;
      details.append(summary, paragraph);
      list.append(details);
    });
  };

  const renderStore = (store) => {
    const name = textValue(store.name, store.displayName, store.businessName) || 'Boutique Shopway';
    const title = textValue(store.headline, store.title, store.heroTitle, store.tagline) || `Les ressources de ${name}`;
    const description = textValue(store.description, store.bio, store.subtitle) || 'Des produits digitaux utiles, disponibles immédiatement.';
    const kicker = textValue(store.kicker, store.category) || 'Ressources digitales';
    const aboutTitle = textValue(store.aboutTitle) || 'Créé avec soin, pensé pour être utilisé.';
    const aboutCopy = textValue(store.about, store.aboutCopy) || description;
    const role = textValue(store.creatorRole, store.role) || 'Créateur indépendant';
    const avatar = store.avatarUrl || store.logoUrl || store.imageUrl;

    setText('[data-store-name]', name);
    setText('[data-store-title]', title);
    setText('[data-store-description]', description);
    setText('[data-store-kicker]', kicker);
    setText('[data-about-title]', aboutTitle);
    setText('[data-about-copy]', aboutCopy);
    setText('[data-about-name]', name);
    setText('[data-about-role]', role);
    setText('[data-footer-name]', name);
    setText('[data-copyright-name]', name);
    setAvatar('[data-brand-avatar], [data-creator-avatar], [data-about-avatar], [data-footer-avatar]', name, avatar);
    renderFaq(store);
    applyTheme(store);
    document.title = `${name} · Shopway`;
  };

  const makeProductCard = (product, index) => {
    const article = document.createElement('article');
    const button = document.createElement('button');
    const cover = document.createElement('span');
    const coverInner = document.createElement('span');
    const body = document.createElement('span');
    const meta = document.createElement('span');
    const type = document.createElement('span');
    const title = document.createElement('strong');
    const description = document.createElement('span');
    const footer = document.createElement('span');
    const price = document.createElement('strong');
    const action = document.createElement('span');

    article.className = 'product-card';
    button.className = 'product-card-button';
    button.type = 'button';
    button.dataset.productId = String(product.id);
    button.setAttribute('aria-label', `Voir ${product.title}, ${formatPrice(product)}`);
    cover.className = `product-cover product-tone-${(index % 4) + 1}`;
    coverInner.className = 'product-cover-inner';

    if (product.imageUrl) {
      const image = document.createElement('img');
      image.src = product.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        image.remove();
        coverInner.textContent = initials(product.title);
      }, { once: true });
      coverInner.append(image);
    } else {
      coverInner.textContent = initials(product.title);
    }

    body.className = 'product-card-body';
    meta.className = 'product-meta';
    type.className = 'product-type';
    type.textContent = product.type;
    meta.append(type);

    title.className = 'product-title';
    title.textContent = product.title;
    description.className = 'product-description';
    description.textContent = product.description || 'Une ressource digitale prête à utiliser.';

    footer.className = 'product-card-footer';
    price.className = 'product-price';
    price.textContent = formatPrice(product);
    action.className = 'product-action';
    action.innerHTML = 'Découvrir <span aria-hidden="true">→</span>';
    footer.append(price, action);
    body.append(meta, title, description, footer);
    cover.append(coverInner);
    button.append(cover, body);
    article.append(button);
    return article;
  };

  const renderProducts = (products) => {
    productGrid.replaceChildren();
    products.forEach((product, index) => productGrid.append(makeProductCard(product, index)));
    const countLabel = `${products.length} produit${products.length > 1 ? 's' : ''}`;
    productCount.textContent = countLabel;
    productGrid.hidden = products.length === 0;
    emptyState.hidden = products.length !== 0;
  };

  const showCatalogState = (type, message = '') => {
    loadingState.hidden = type !== 'loading';
    errorState.hidden = type !== 'error';
    emptyState.hidden = type !== 'empty';
    productGrid.hidden = type !== 'ready';
    if (message) errorMessage.textContent = message;
  };

  const loadStore = async () => {
    state.loadController?.abort();
    state.loadController = new AbortController();
    showCatalogState('loading');
    shell.setAttribute('aria-busy', 'true');
    productCount.textContent = 'Chargement des produits…';

    try {
      const payload = await requestJson(`/api/public/store/${encodeURIComponent(slug)}`, {
        signal: state.loadController.signal
      });
      const normalized = normalizePublicPayload(payload);
      if (normalized.store?.published === false || normalized.store?.status === 'draft') {
        const unpublished = new Error('Cette boutique n’est pas encore publiée.');
        unpublished.status = 404;
        throw unpublished;
      }

      state.store = normalized.store;
      state.products = normalized.products
        .map(normalizeProduct)
        .filter((product) => product.published);
      renderStore(state.store);
      renderProducts(state.products);
      showCatalogState(state.products.length ? 'ready' : 'empty');
    } catch (error) {
      if (error.name === 'AbortError') return;
      const message = error.status === 404
        ? 'Cette boutique est introuvable ou n’est pas encore publiée.'
        : 'La boutique ne répond pas pour le moment. Vous pouvez réessayer dans quelques instants.';
      productCount.textContent = 'Boutique indisponible';
      showCatalogState('error', message);
      console.error('Store loading failed:', error);
    } finally {
      shell.setAttribute('aria-busy', 'false');
    }
  };

  const openCheckout = (product, trigger) => {
    state.selectedProduct = product;
    state.checkoutTrigger = trigger;
    checkoutForm.reset();
    checkoutFeedback.textContent = '';
    checkoutFeedback.className = 'form-feedback checkout-feedback';
    checkoutFormView.hidden = false;
    checkoutSuccess.hidden = true;

    setText('[data-modal-title]', product.title, checkoutDialog);
    setText('[data-modal-description]', product.description || 'Une ressource digitale prête à utiliser.', checkoutDialog);
    setText('[data-modal-type]', product.type, checkoutDialog);
    setText('[data-modal-price]', formatPrice(product), checkoutDialog);
    setText('[data-modal-initials]', initials(product.title), checkoutDialog);

    const cover = $('[data-modal-cover]', checkoutDialog);
    cover.className = 'modal-cover cover-neutral';
    const existingImage = $('img', cover);
    if (existingImage) existingImage.remove();
    $('[data-modal-initials]', cover).hidden = false;
    if (product.imageUrl) {
      const image = document.createElement('img');
      image.src = product.imageUrl;
      image.alt = '';
      image.addEventListener('load', () => {
        $('[data-modal-initials]', cover).hidden = true;
      }, { once: true });
      image.addEventListener('error', () => image.remove(), { once: true });
      cover.prepend(image);
    }

    if (typeof checkoutDialog.showModal === 'function') checkoutDialog.showModal();
    else checkoutDialog.setAttribute('open', '');
    requestAnimationFrame(() => $('input[name="name"]', checkoutDialog)?.focus());
  };

  const closeCheckout = () => {
    if (checkoutDialog.open && typeof checkoutDialog.close === 'function') checkoutDialog.close();
    else checkoutDialog.removeAttribute('open');
  };

  const setCheckoutBusy = (busy) => {
    const button = $('.checkout-submit', checkoutForm);
    $$('input, button', checkoutForm).forEach((control) => { control.disabled = busy; });
    button?.classList.toggle('is-loading', busy);
    setText('[data-checkout-button-label]', busy ? 'Commande en cours…' : 'Obtenir ce produit', checkoutForm);
  };

  const handleCheckout = async (event) => {
    event.preventDefault();
    if (!state.selectedProduct || !checkoutForm.reportValidity()) return;

    const formData = new FormData(checkoutForm);
    const orderPayload = {
      productId: state.selectedProduct.id,
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim().toLowerCase(),
      discountCode: String(formData.get('discountCode') || '').trim()
    };

    setCheckoutBusy(true);
    checkoutFeedback.textContent = '';
    try {
      const payload = await requestJson('/api/checkout', {
        method: 'POST',
        body: JSON.stringify(orderPayload)
      });
      const order = payload.data?.order || payload.order || payload.data || payload;
      const orderNumber = textValue(
        String(order.orderNumber || ''),
        String(order.order_number || ''),
        String(order.number || ''),
        String(order.id || ''),
        String(payload.orderNumber || '')
      ) || 'Confirmée';
      const downloadUrl = safeUrl(
        payload.downloadUrl || payload.downloadURL || order.downloadUrl || order.downloadURL || order.url
      );

      setText('[data-success-email]', orderPayload.email, checkoutDialog);
      setText('[data-order-number]', orderNumber, checkoutDialog);
      setText('[data-success-product]', state.selectedProduct.title, checkoutDialog);

      const download = $('[data-download-url]', checkoutDialog);
      if (downloadUrl) {
        download.href = downloadUrl;
        download.removeAttribute('aria-disabled');
        download.textContent = 'Télécharger maintenant ↓';
      } else {
        download.removeAttribute('href');
        download.setAttribute('aria-disabled', 'true');
        download.textContent = 'Lien envoyé par e-mail';
      }

      checkoutFormView.hidden = true;
      checkoutSuccess.hidden = false;
      $('[data-close-checkout]', checkoutSuccess)?.focus();
    } catch (error) {
      checkoutFeedback.textContent = apiMessage(error.payload, 'La commande n’a pas pu être finalisée. Vérifiez vos informations et réessayez.');
      checkoutFeedback.classList.add('is-error');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const showToast = (message) => {
    clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => { toast.hidden = true; }, 180);
    }, 2600);
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Copy unavailable');
  };

  const shareStore = async (preferNative = false) => {
    const url = window.location.href;
    const title = state.store?.name || 'Boutique Shopway';
    try {
      if (preferNative && navigator.share) {
        await navigator.share({ title, text: `Découvrez ${title}`, url });
      } else {
        await copyText(url);
        showToast('Lien de la boutique copié');
      }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('Impossible de copier le lien');
    }
  };

  const legalEntry = (kind) => {
    const source = state.store?.legal || state.store?.policies || {};
    const aliases = kind === 'terms'
      ? ['terms', 'termsOfSale', 'conditions']
      : kind === 'privacy'
        ? ['privacy', 'privacyPolicy']
        : ['refunds', 'refundPolicy'];
    const value = aliases.map((key) => source[key] ?? state.store?.[key]).find(Boolean);
    const fallback = DEFAULT_LEGAL[kind];
    if (typeof value === 'string') return { title: fallback.title, paragraphs: [value] };
    if (value && typeof value === 'object') {
      const paragraphs = Array.isArray(value.paragraphs)
        ? value.paragraphs.filter((item) => typeof item === 'string' && item.trim())
        : [textValue(value.content, value.text, value.description)].filter(Boolean);
      return { title: textValue(value.title) || fallback.title, paragraphs: paragraphs.length ? paragraphs : fallback.paragraphs };
    }
    return fallback;
  };

  const openLegal = (kind) => {
    const entry = legalEntry(kind);
    setText('[data-legal-title]', entry.title, legalDialog);
    const content = $('[data-legal-content]', legalDialog);
    content.replaceChildren(...entry.paragraphs.map((text) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      return paragraph;
    }));
    if (typeof legalDialog.showModal === 'function') legalDialog.showModal();
    else legalDialog.setAttribute('open', '');
    requestAnimationFrame(() => $('[data-close-legal]', legalDialog)?.focus());
  };

  const handleNewsletter = async (event) => {
    event.preventDefault();
    if (!newsletterForm.reportValidity()) return;
    const button = $('button[type="submit"]', newsletterForm);
    const input = $('input[name="email"]', newsletterForm);
    const email = input.value.trim().toLowerCase();
    button.disabled = true;
    input.disabled = true;
    newsletterFeedback.textContent = 'Inscription en cours…';
    newsletterFeedback.className = 'form-feedback';

    try {
      await requestJson('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Abonné newsletter',
          email,
          country: 'France',
          storeId: state.store?.id || state.store?._id || null,
          storeSlug: slug,
          source: 'storefront'
        })
      });
      newsletterFeedback.textContent = 'C’est enregistré. À très bientôt dans votre boîte mail.';
      newsletterFeedback.classList.add('is-success');
      newsletterForm.reset();
    } catch (error) {
      if (error.status === 409) {
        newsletterFeedback.textContent = 'Cette adresse est déjà inscrite. Vous ne manquerez rien.';
        newsletterFeedback.classList.add('is-success');
        newsletterForm.reset();
      } else {
        newsletterFeedback.textContent = apiMessage(error.payload, 'L’inscription n’a pas fonctionné. Réessayez dans un instant.');
        newsletterFeedback.classList.add('is-error');
      }
    } finally {
      button.disabled = false;
      input.disabled = false;
    }
  };

  const closeMenu = () => {
    menuToggle.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  };

  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('is-open', open);
  });

  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) closeMenu();
  });

  productGrid?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-product-id]');
    if (!trigger) return;
    const product = state.products.find((item) => String(item.id) === trigger.dataset.productId);
    if (product) openCheckout(product, trigger);
  });

  checkoutForm?.addEventListener('submit', handleCheckout);
  newsletterForm?.addEventListener('submit', handleNewsletter);
  $('[data-retry-store]')?.addEventListener('click', loadStore);
  $('[data-copy-store]')?.addEventListener('click', () => shareStore(false));
  $('[data-share-store]')?.addEventListener('click', () => shareStore(true));

  $$('[data-close-checkout]').forEach((button) => button.addEventListener('click', closeCheckout));
  $$('[data-close-legal]').forEach((button) => button.addEventListener('click', () => {
    if (legalDialog.open && typeof legalDialog.close === 'function') legalDialog.close();
    else legalDialog.removeAttribute('open');
  }));
  $$('[data-legal]').forEach((button) => button.addEventListener('click', () => openLegal(button.dataset.legal)));

  [checkoutDialog, legalDialog].forEach((dialog) => {
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  checkoutDialog?.addEventListener('close', () => {
    state.checkoutTrigger?.focus();
    state.checkoutTrigger = null;
  });

  $('[data-faq-list]')?.addEventListener('toggle', (event) => {
    const opened = event.target;
    if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
    $$('details', event.currentTarget).forEach((details) => {
      if (details !== opened) details.open = false;
    });
  }, true);

  document.addEventListener('click', (event) => {
    if (!navigation?.classList.contains('is-open')) return;
    if (!navigation.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeMenu();
  });

  $('[data-current-year]').textContent = String(new Date().getFullYear());
  loadStore();
})();
