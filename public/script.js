// Visitor storage choice: optional visit counting is off until explicitly accepted.
function vampStorageChoice() {
    try {
        const value=JSON.parse(localStorage.getItem('vamp_storage_choice') || 'null');
        return value && value.version===1 && typeof value.analytics==='boolean' && Number.isFinite(value.at) && value.at<=Date.now() && Date.now()-value.at < 180*24*60*60*1000 ? value : null;
    } catch (_) { return null; }
}
function vampAnalyticsAllowed() { const choice=vampStorageChoice(); return !!(choice && choice.analytics); }
window.vampAnalyticsAllowed=vampAnalyticsAllowed;


// Флаг админа — устанавливается после логина
window.__isAdmin = false;
window.__userId = null;
function updateUserFlags() {
    if (window.CURRENT_USER) {
        window.__isAdmin = window.CURRENT_USER.role === 'admin';
        window.__userId = window.CURRENT_USER.id;
    } else if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        window.__isAdmin = CURRENT_USER.role === 'admin';
        window.__userId = CURRENT_USER.id;
    } else if (window.user && window.user.role) {
        window.__isAdmin = window.user.role === 'admin';
        window.__userId = window.user.id;
    }
    console.log('[auth] isAdmin:', window.__isAdmin, '| userId:', window.__userId);
}


// ===== ГРАФИК ОНЛАЙНА =====

window.drawOnlineChart = drawOnlineChart;


window.loadOnlineDates = loadOnlineDates;


// ===== ONLINE COUNTER =====
function updateAllCounters(value) {
    // 1. Все элементы с классом .online-value
    var spans = document.querySelectorAll('.online-value, #online-value-active, #online-now');
    for (var i = 0; i < spans.length; i++) {
        spans[i].textContent = value;
    }
    // 2. Также сохраняем для быстрого доступа
    window.__lastOnlineValue = value;
    console.log('[online] обновлены счётчики:', spans.length, '→', value);
}
window.updateAllCounters = updateAllCounters;

// ===== Heartbeat (всегда, но в фоне реже) =====
(function() {
    var sid = null;
    if (!vampAnalyticsAllowed()) { try { localStorage.removeItem('vamp_session_id'); } catch (_) {} }
    window.__sessionId = null;
    
    var timer = null;
    var currentInterval = 10000; // 10 сек по умолчанию (активная вкладка)
    
    function ping() {
        if (!vampAnalyticsAllowed() || !sid) return;
        try {
            fetch('/api/online/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sid })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data && data.online != null) {
                    updateAllCounters(data.online);
                }
            }).catch(function(){});
        } catch(e) {}
    }
    
    function start(interval) {
        if (timer) clearInterval(timer);
        timer=null;
        if (!vampAnalyticsAllowed()) return;
        if (!sid) {
            try { sid=localStorage.getItem('vamp_session_id'); } catch (_) {}
            if (!sid) sid='s_'+Date.now()+'_'+Math.random().toString(36).slice(2,10);
            try { localStorage.setItem('vamp_session_id',sid); } catch (_) {}
        }
        window.__sessionId=sid;
        currentInterval = interval || 10000;
        ping();
        timer = setInterval(ping, currentInterval);
        console.log('[online] heartbeat запущен (интервал ' + currentInterval + 'мс)');
    }
    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }
    
    // При смене видимости — меняем частоту, но НЕ останавливаем
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            // В фоне — реже (60 сек), чтобы не грузить сервер
            start(60000);
        } else {
            // Активна — чаще (10 сек)
            start(10000);
        }
    });
    
    window.addEventListener('focus', function() {
        if (!document.hidden) start(10000);
    });
    
    // При закрытии — сразу убираем сессию
    window.addEventListener('beforeunload', function() {
        if (vampAnalyticsAllowed() && sid) { try { navigator.sendBeacon('/api/online/leave', JSON.stringify({ session_id: sid })); } catch(e) {} }
    });
    
    window.addEventListener('vamp-storage-choice',function(){
        if (vampAnalyticsAllowed()) start(document.hidden ? 60000 : 10000);
        else {
            stop();
            if (sid) { try { fetch('/api/online/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sid}),keepalive:true}); } catch (_) {} }
            sid=null;window.__sessionId=null;
            try { localStorage.removeItem('vamp_session_id'); } catch (_) {}
        }
    });
    window.addEventListener('storage',function(event){if(event.key==='vamp_storage_choice') window.dispatchEvent(new Event('vamp-storage-choice'));});
    // Запускаем сразу — с нужной частотой
    start(document.hidden ? 60000 : 10000);
})();

// ===== Периодический запрос current (для случая, когда ping не прошёл) =====
setInterval(async function() {
    var tab = document.getElementById('admin-users');
    if (!tab || !tab.classList.contains('active')) return;
    if (document.hidden) return;
    try {
        var r = await api('/api/online/current');
        if (r && r.online != null) {
            updateAllCounters(r.online);
        }
    } catch(e) {}
}, 2000);

async function loadOnlineCount() {
    try {
        var r = await api('/api/online/current');
        var val = (r && r.online != null) ? r.online : 0;
        updateAllCounters(val);
        return val;
    } catch(e) { return 0; }
}
window.loadOnlineCount = loadOnlineCount;


// ===== SVG-иконки =====
const ICONS = {
    phone: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    mail: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
    telegram: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>',
    map: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    clock: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    pause: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
};


async function loadContacts() {
    let c = {};
    try { c = await api('/api/contacts'); } catch (e) {}
    const box = document.getElementById('contacts-box');
    if (!box) return;

    const items = [];
    if (c.phone) items.push({ icon: ICONS.phone, title: 'Телефон', value: c.phone, link: 'tel:' + c.phone.replace(/\s/g, '') });
    if (c.email) items.push({ icon: ICONS.mail, title: 'Email', value: c.email, link: 'mailto:' + c.email });
    if (c.telegram) items.push({ icon: ICONS.telegram, title: 'Telegram (основной)', value: c.telegram, link: 'https://t.me/' + c.telegram.replace('@', '') });
    if (c.instagram) items.push({ icon: ICONS.telegram, title: 'Telegram продавца 2', value: c.instagram, link: 'https://t.me/' + c.instagram.replace('@', '') });
    if (c.whatsapp) items.push({ icon: ICONS.telegram, title: 'Telegram продавца 3', value: c.whatsapp, link: 'https://t.me/' + c.whatsapp.replace('@', '') });
    if (c.address) items.push({ icon: ICONS.map, title: 'Адрес', value: c.address, link: null });
    if (c.work_hours) items.push({ icon: ICONS.clock, title: 'Часы работы', value: c.work_hours, link: null });

    const cardStyle = 'display:flex;align-items:center;gap:20px;padding:24px 28px;border:1px solid #e5e5e5;background:#fff;text-decoration:none;color:#111;transition:all 0.25s ease;min-height:90px;box-sizing:border-box;width:100%;';
    const iconStyle = 'font-size:24px;line-height:1;flex-shrink:0;width:52px;height:52px;display:flex;align-items:center;justify-content:center;background:#f5f5f5;border-radius:50%;color:#111;';
    const bodyStyle = 'display:flex;flex-direction:column;gap:5px;flex:1;min-width:0;';
    const titleStyle = 'font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#999;font-weight:600;';
    const valueStyle = 'font-size:16px;color:#111;word-break:break-word;line-height:1.35;';

    const cardsHtml = items.map(function(it) {
        const inner = '<div style="' + iconStyle + '">' + it.icon + '</div>' +
            '<div style="' + bodyStyle + '">' +
                '<div style="' + titleStyle + '">' + it.title + '</div>' +
                '<div style="' + valueStyle + '">' + esc(it.value) + '</div>' +
            '</div>';
        if (it.link) return '<a href="' + esc(safeContactUrl(it.link)) + '" target="_blank" rel="noopener" style="' + cardStyle + '">' + inner + '</a>';
        return '<div style="' + cardStyle + '">' + inner + '</div>';
    }).join('');

    const gridStyle = 'display:grid;grid-template-columns:repeat(2,1fr);gap:18px;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;';
    box.innerHTML = '<div style="' + gridStyle + '">' + cardsHtml + '</div>';

    // Центрируем заголовок "Контакты"
    const view = document.getElementById('contacts-view');
    if (view) {
        const h2 = view.querySelector('h2');
        if (h2) {
            h2.style.cssText = 'text-align:center;font-size:40px;font-weight:normal;letter-spacing:2px;text-transform:uppercase;margin:20px auto 45px;display:block;width:100%;font-family:Georgia,serif;';
        }
    }

    // Адаптив — на узких экранах одна колонка
    if (window.innerWidth < 700) {
        box.firstChild.style.gridTemplateColumns = '1fr';
    }
}


// ===== Выбор способа оплаты =====
window.selectedPayment = 'cash';
function selectPayment(method) {
    console.log('[payment] выбран способ:', method);
    window.selectedPayment = method;
    var buttons = document.querySelectorAll('.payment-method');
    console.log('[payment] найдено кнопок:', buttons.length);
    buttons.forEach(function(btn) {
        var isSelected = btn.dataset.method === method;
        btn.classList.toggle('selected', isSelected);
        if (isSelected) {
            btn.style.background = '#111';
            btn.style.color = '#fff';
        } else {
            btn.style.background = '#fff';
            btn.style.color = '#111';
        }
    });
}
window.selectPayment = selectPayment;



// ===== Telegram WebApp =====
if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    console.log('[TG] WebApp запущен, user:', tg.initDataUnsafe?.user);
    // Опционально: сохранить user_id для привязки заказов
    if (tg.initDataUnsafe?.user?.id) {
        window.__tgUserId = tg.initDataUnsafe.user.id;
    }
}

'use strict';
/* ============================================================
   VAMP SHMOT — фронтенд
   Работает поверх REST API из server.js. Все состояния (корзина,
   избранное, токен) хранятся в localStorage.
   ============================================================ */

/* ================= СОСТОЯНИЕ ================= */
let TOKEN = localStorage.getItem('token') || null;
let CURRENT_USER = null;
let CATEGORIES = [];
let BRANDS = [];
let BADGES = [];
let CART = safeParse(localStorage.getItem('cart'), []);
let FAVORITES = safeParse(localStorage.getItem('favorites'), []);
let CURRENT_PRODUCT = null;
let CURRENT_IMAGE_IDX = 0;
let SELECTED_SIZE = null;
let CURRENT_QTY = 1;
let RESERVE_ENABLED = false;
let CURRENT_FILTERS = { category: '', sort: 'recommended' };
let CURRENT_PRODUCT_PHOTOS = [];
let CURRENT_BRAND_LOGO = '';
let CURRENT_SLIDE_IMG = '';
let SLIDES = [];
let SLIDE_IDX = 0;
let slideTimer = null;
let chatES = null;
let authMode = 'login';

function safeParse(str, fallback) {
    try { const v = JSON.parse(str); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// HTML escaping and JavaScript-string escaping are distinct contexts.
function jsArg(value) { return esc(JSON.stringify(String(value == null ? '' : value))); }
function safeImageUrl(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
        const url = new URL(value, window.location.href);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
}
function safeContactUrl(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '#';
    try {
        const url = new URL(value);
        return ['http:', 'https:', 'tel:', 'mailto:'].includes(url.protocol) ? url.href : '#';
    } catch (_) { return '#'; }
}
function safeColor(value) { return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value)) ? value : '#111111'; }

function money(n) { return Math.round(n || 0).toLocaleString('ru-RU') + ' ₽'; }
function saveCart() { localStorage.setItem('cart', JSON.stringify(CART)); updateCartCount(); }
function saveFavorites() { localStorage.setItem('favorites', JSON.stringify(FAVORITES)); updateFavCount(); }

/* ================= API ================= */
async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    console.log('[api]', path, '| TOKEN:', TOKEN ? 'есть' : 'НЕТ');
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса (' + res.status + ')');
    return data;
}

/* ================= TOASTS ================= */
function toast(text, type) {
    type = type || 'info';
    const box = document.getElementById('toast-container');
    if (!box) { console.log(text); return; }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
    el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${esc(text)}</span><button class="toast-close" aria-label="Закрыть">✕</button>`;
    el.querySelector('.toast-close').onclick = () => removeToast(el);
    box.appendChild(el);
    setTimeout(() => removeToast(el), 4000);
}
function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 300);
}

/* ================= ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ ================= */
const PAGE_IDS = ['fav-view', 'product-view', 'brands-view', 'brand-view', 'cart-view', 'my-orders-view', 'contacts-view', 'admin-view'];
function hideAllPages() {
    const hero = document.querySelector('.hero');
    const catalogSection = document.getElementById('catalog-section');
    if (hero) hero.style.display = 'none';
    if (catalogSection) catalogSection.style.display = 'none';
    PAGE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = 'none';
        el.classList.remove('active');
    });
}
function showPage(id) {
    hideAllPages();
    const el = document.getElementById(id);
    if (el) { el.style.display = 'block'; el.classList.add('active'); }
    window.scrollTo(0, 0);
}
function showCatalog() {
    hideAllPages();
    const hero = document.querySelector('.hero');
    const catalogSection = document.getElementById('catalog-section');
    if (hero) hero.style.display = '';
    if (catalogSection) catalogSection.style.display = '';
    loadProducts();
    window.scrollTo(0, 0);
}
function showFavorites() { showPage('fav-view'); renderFavorites(); }
function showCart() { showPage('cart-view'); renderCart(); }
function showBrands() { showPage('brands-view'); loadBrands(true); }
function showContacts() { showPage('contacts-view'); loadContacts(); }
function showMyOrders() {
    if (!TOKEN) { toast('Войдите, чтобы посмотреть заказы', 'info'); openAuthModal('login'); return; }
    showPage('my-orders-view');
    loadMyOrders();
}
async function showAdmin() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'admin') { toast('Доступ только для администратора', 'error'); return; }
    showPage('admin-view');
    await loadAdminEverything();
}

/* ================= КАТЕГОРИИ / БРЕНДЫ / БЕЙДЖИ (общие справочники) ================= */
async function loadCategories() {
    try {
        CATEGORIES = await api('/api/categories');
    } catch (e) { CATEGORIES = []; }
    fillSelect('category-select', CATEGORIES, 'Все категории');
    fillSelect('filterCategory', CATEGORIES, 'Все категории');
    fillSelect('f-category', CATEGORIES, '— без категории —');
}
function fillSelect(id, items, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${esc(placeholder)}</option>` + items.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
}
async function loadBrandsRef() {
    try { BRANDS = await api('/api/brands'); } catch (e) { BRANDS = []; }
    const sel = document.getElementById('f-brand');
    if (sel) {
        const current = sel.value;
        sel.innerHTML = '<option value="">— без бренда —</option>' + BRANDS.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
        if ([...sel.options].some(o => o.value === current)) sel.value = current;
    }
}
async function loadBadgesRef() {
    try { BADGES = await api('/api/badges'); } catch (e) { BADGES = []; }
}

/* ================= КАТАЛОГ ================= */
function onCategoryChange(v) { CURRENT_FILTERS.category = v; syncFilterUI(); loadProducts(); }
function onSortChange(v) { CURRENT_FILTERS.sort = v; syncFilterUI(); loadProducts(); }
function resetFilters() {
    CURRENT_FILTERS = { category: '', sort: 'recommended' };
    syncFilterUI();
    loadProducts();
}
function syncFilterUI() {
    const cs = document.getElementById('category-select'); if (cs) cs.value = CURRENT_FILTERS.category;
    const ss = document.getElementById('sort-select'); if (ss) ss.value = CURRENT_FILTERS.sort;
    const fc = document.getElementById('filterCategory'); if (fc) fc.value = CURRENT_FILTERS.category;
    const fs = document.getElementById('filterSort'); if (fs) fs.value = mapSortToBurger(CURRENT_FILTERS.sort);
}
function mapSortToBurger(v) {
    if (v === 'cheap') return 'price_asc';
    if (v === 'expensive') return 'price_desc';
    if (v === 'new') return 'new';
    return 'recommended';
}
function mapBurgerToSort(v) {
    if (v === 'price_asc') return 'cheap';
    if (v === 'price_desc') return 'expensive';
    if (v === 'new') return 'new';
    return 'recommended';
}

async function loadProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    grid.innerHTML = '<p style="padding:40px;text-align:center;color:#888;">Загрузка...</p>';
    const params = new URLSearchParams();
    if (CURRENT_FILTERS.category) params.set('category', CURRENT_FILTERS.category);
    if (CURRENT_FILTERS.sort) params.set('sort', CURRENT_FILTERS.sort);
    let products = [];
    try { products = await api('/api/products?' + params.toString()); } catch (e) { grid.innerHTML = '<p>Не удалось загрузить товары.</p>'; return; }
    const info = document.getElementById('filter-info');
    if (info) info.textContent = products.length ? `Найдено товаров: ${products.length}` : '';
    if (!products.length) { grid.innerHTML = '<p style="padding:40px;text-align:center;color:#888;">Товары не найдены.</p>'; return; }
    grid.innerHTML = products.map(productCardHtml).join('');
}
function productCardHtml(p) {
    const img = (p.images && p.images[0]) || '';
    const outOfStock = p.stock_status === 'out_of_stock' || (p.stock === 0 && p.stock_status !== 'coming_soon');
    let badge = '';
    if (p.discount > 0) badge = `<div class="badge badge-discount">-${esc(p.discount)}%</div>`;
    else if (p.is_new) badge = `<div class="badge badge-new">Новинка</div>`;
    const priceHtml = p.discount > 0
        ? `<span style="text-decoration:line-through;color:#999;font-size:14px;">${money(p.price)}</span> ${money(p.final_price)}`
        : money(p.price);
    return `
    <div class="product-card${outOfStock ? ' out-of-stock' : ''}" onclick="openProduct(${p.id})">
        ${badge}
        <img src="${esc(safeImageUrl(img))}" alt="${esc(p.name)}" loading="lazy">
        <h3>${esc(p.name)}</h3>
        <div class="price">${priceHtml}</div>
        <button class="btn" onclick="event.stopPropagation();quickAddToCart(${p.id})">${outOfStock ? 'Нет в наличии' : 'В корзину'}</button>
    </div>`;
}
async function quickAddToCart(id) {
    try {
        const p = await api('/api/products/' + id);
        addToCartInternal(p, (p.sizes && p.sizes[0]) || null, 1);
        toast('Добавлено в корзину', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ================= СТРАНИЦА ТОВАРА ================= */
async function openProduct(id) {
    showPage('product-view');
    try {
        CURRENT_PRODUCT = await api('/api/products/' + id);
    } catch (e) { toast('Товар не найден', 'error'); showCatalog(); return; }
    CURRENT_IMAGE_IDX = 0;
    CURRENT_QTY = 1;
    SELECTED_SIZE = (CURRENT_PRODUCT.sizes && CURRENT_PRODUCT.sizes[0]) || null;
    renderProductPage();
    loadReviews(id);
    loadRelated(id);
}
function renderProductPage() {
    const p = CURRENT_PRODUCT;
    if (!p) return;
    document.getElementById('pv-brand').textContent = (p.brand && p.brand.name) || '';
    document.getElementById('pv-name').textContent = p.name;
    document.getElementById('pv-price').innerHTML = p.discount > 0
        ? `<span style="text-decoration:line-through;color:#999;font-size:16px;">${money(p.price)}</span> ${money(p.final_price)}`
        : money(p.price);
    document.getElementById('pv-description').textContent = p.description || 'Без описания.';
    const specsEl = document.getElementById('pv-specs');
    specsEl.innerHTML = (p.specs && p.specs.length)
        ? p.specs.map(s => `<div><strong>${esc(s.label || s.key || '')}:</strong> ${esc(s.value || '')}</div>`).join('')
        : '—';

    const imgs = (p.images && p.images.length) ? p.images : [''];
    document.getElementById('pv-image').src = safeImageUrl(imgs[CURRENT_IMAGE_IDX] || '');
    document.getElementById('pv-thumbs').innerHTML = imgs.map((im, i) =>
        `<img class="thumb${i === CURRENT_IMAGE_IDX ? ' active' : ''}" src="${esc(safeImageUrl(im))}" onclick="CURRENT_IMAGE_IDX=${i};renderProductPage()">`).join('');

    const sizesEl = document.getElementById('pv-sizes');
    if (p.sizes && p.sizes.length) {
        sizesEl.innerHTML = p.sizes.map(s => `<button class="size-btn${s === SELECTED_SIZE ? ' selected' : ''}" onclick="selectSize(${jsArg(s)})">${esc(s)}</button>`).join('');
    } else {
        sizesEl.innerHTML = '';
    }
    document.getElementById('pv-qty').textContent = CURRENT_QTY;

    const favBtnIcon = document.getElementById('fav-btn-icon');
    const favBtnLabel = document.getElementById('fav-btn-label');
    const isFav = FAVORITES.includes(p.id);
    if (favBtnIcon) favBtnIcon.setAttribute('fill', isFav ? '#8b0000' : 'none');
    if (favBtnLabel) favBtnLabel.textContent = isFav ? 'В избранном' : 'В избранное';

    const reserveBtn = document.querySelector('.reserve-btn');
    if (reserveBtn) reserveBtn.style.display = (RESERVE_ENABLED && (p.stock_status === 'out_of_stock' || p.stock === 0)) ? '' : 'none';

    const outOfStock = p.stock_status === 'out_of_stock' || (p.stock === 0 && p.stock_status !== 'coming_soon');
    const addBtn = document.querySelector('.add-to-cart-btn');
    const goBtn = document.querySelector('.go-to-checkout-btn');
    if (addBtn) { addBtn.disabled = outOfStock; addBtn.textContent = outOfStock ? 'Нет в наличии' : 'Добавить в корзину'; }
    if (goBtn) goBtn.style.display = outOfStock ? 'none' : '';
}
function selectSize(s) { SELECTED_SIZE = s; renderProductPage(); }
function changeQty(delta) {
    CURRENT_QTY = Math.max(1, CURRENT_QTY + delta);
    document.getElementById('pv-qty').textContent = CURRENT_QTY;
}
function prevProductImage() {
    if (!CURRENT_PRODUCT || !CURRENT_PRODUCT.images || !CURRENT_PRODUCT.images.length) return;
    CURRENT_IMAGE_IDX = (CURRENT_IMAGE_IDX - 1 + CURRENT_PRODUCT.images.length) % CURRENT_PRODUCT.images.length;
    renderProductPage();
}
function nextProductImage() {
    if (!CURRENT_PRODUCT || !CURRENT_PRODUCT.images || !CURRENT_PRODUCT.images.length) return;
    CURRENT_IMAGE_IDX = (CURRENT_IMAGE_IDX + 1) % CURRENT_PRODUCT.images.length;
    renderProductPage();
}
function toggleAccordion(btn) {
    const item = btn.closest('.accordion-item');
    item.classList.toggle('open-acc');
    const body = item.querySelector('.accordion-body');
    if (!body) return;
    body.style.maxHeight = body.style.maxHeight ? '' : (body.scrollHeight + 20) + 'px';
}
function addToCartInternal(p, size, qty) {
    const price = p.final_price != null ? p.final_price : p.price;
    const img = (p.images && p.images[0]) || '';
    const existing = CART.find(it => it.id === p.id && it.size === size);
    if (existing) existing.qty += qty;
    else CART.push({ id: p.id, name: p.name, price, size: size || null, qty, img });
    saveCart();
}
function addCurrentToCart() {
    if (!CURRENT_PRODUCT) return;
    addToCartInternal(CURRENT_PRODUCT, SELECTED_SIZE, CURRENT_QTY);
    toast('Добавлено в корзину', 'success');
}
function goToCheckout() { submitOrder(); }
function reserveCurrentProduct() {
    if (!CURRENT_PRODUCT) return;
    addToCartInternal(CURRENT_PRODUCT, SELECTED_SIZE, CURRENT_QTY);
    showCart();
    setTimeout(() => {
        const cb = document.getElementById('checkout-reserve');
        if (cb) { cb.checked = true; toast('Отметьте оформление как бронирование ниже', 'info'); }
    }, 50);
}
function toggleFavorite() {
    if (!CURRENT_PRODUCT) return;
    const id = CURRENT_PRODUCT.id;
    const idx = FAVORITES.indexOf(id);
    if (idx >= 0) FAVORITES.splice(idx, 1); else FAVORITES.push(id);
    saveFavorites();
    renderProductPage();
}
function updateFavCount() { const el = document.getElementById('fav-count'); if (el) el.textContent = FAVORITES.length; }
function updateCartCount() { const el = document.getElementById('cart-count'); if (el) el.textContent = CART.reduce((s, i) => s + i.qty, 0); }

async function renderFavorites() {
    const grid = document.getElementById('fav-grid');
    const empty = document.getElementById('fav-empty');
    if (!FAVORITES.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    grid.innerHTML = '<p style="padding:20px;color:#888;">Загрузка...</p>';
    const items = [];
    for (const id of FAVORITES) {
        try { items.push(await api('/api/products/' + id)); } catch (e) {}
    }
    grid.innerHTML = items.map(productCardHtml).join('') || '<p style="padding:20px;color:#888;">Товары не найдены.</p>';
}

/* ================= ОТЗЫВЫ ================= */
let selectedReviewStars = 5;
async function loadReviews(productId) {
    var reviews = [];
    try { reviews = await api('/api/products/' + productId + '/reviews'); } catch (e) {}
    var list = document.getElementById('reviews-list');
    if (!list) return;
    
    // Проверяем роль
    updateUserFlags();
    var isAdmin = window.__isAdmin === true;
    var myId = window.__userId;
    
    if (!reviews.length) {
        list.innerHTML = '<p style="color:#999;">Пока нет отзывов. Будьте первым!</p>';
        return;
    }
    
    list.innerHTML = reviews.map(function(r) {
        var canDelete = isAdmin || (r.user_id === myId);
        var stars = '';
        for (var i = 1; i <= 5; i++) stars += (i <= r.rating ? '★' : '☆');
        
        var btn = canDelete
            ? '<button onclick="deleteReview(' + r.id + ', ' + productId + ')" style="background:#8b0000;border:0;color:#fff;padding:6px 12px;font-size:11px;cursor:pointer;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">Удалить</button>'
            : '';
        
        return '<div class="review-item" style="border-bottom:1px solid #eee;padding:14px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
            '<div style="flex:1;">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">' +
                    '<strong style="font-size:14px;">' + esc(r.user_name || 'Аноним') + '</strong>' +
                    '<span style="color:#8b0000;font-size:14px;letter-spacing:2px;">' + stars + '</span>' +
                    '<span style="color:#999;font-size:11px;">' + esc((r.created_at || '').substring(0, 10)) + '</span>' +
                '</div>' +
                '<div style="font-size:14px;color:#333;line-height:1.5;">' + esc(r.text) + '</div>' +
            '</div>' +
            (btn ? '<div>' + btn + '</div>' : '') +
        '</div>';
    }).join('');
    
    var cnt = document.getElementById('rv-count');
    if (cnt) cnt.textContent = '(' + reviews.length + ')';
    var avg = document.getElementById('rv-avg');
    if (avg && reviews.length) {
        var sum = 0;
        for (var i = 0; i < reviews.length; i++) sum += reviews[i].rating;
        avg.textContent = (sum / reviews.length).toFixed(1) + ' ★';
    }
}

async function deleteReview(id, productId) {
    if (!confirm('Удалить этот отзыв?')) return;
    try {
        await api('/api/reviews/' + id, { method: 'DELETE' });
        toast('Отзыв удалён', 'success');
        loadReviews(productId);
    } catch(e) { toast(e.message || 'Ошибка', 'error'); }
}
window.deleteReview = deleteReview;

async function deleteReview(id, productId) {
    if (!confirm('Удалить этот отзыв?')) return;
    try {
        await api('/api/reviews/' + id, { method: 'DELETE' });
        toast('Отзыв удалён', 'success');
        loadReviews(productId);
    } catch(e) { toast(e.message || 'Ошибка', 'error'); }
}
window.deleteReview = deleteReview;

async function deleteReview(id, productId) {
    if (!confirm('Удалить этот отзыв?')) return;
    try {
        await api('/api/reviews/' + id, { method: 'DELETE' });
        toast('Отзыв удалён', 'success');
        loadReviews(productId);
    } catch(e) { toast(e.message || 'Ошибка', 'error'); }
}
window.deleteReview = deleteReview;

async function deleteReview(id, productId) {
    if (!confirm('Удалить этот отзыв?')) return;
    try {
        await api('/api/reviews/' + id, { method: 'DELETE' });
        toast('Отзыв удалён', 'success');
        loadReviews(productId);
    } catch(e) { toast(e.message || 'Ошибка', 'error'); }
}
window.deleteReview = deleteReview;
function paintStars() {
    document.querySelectorAll('#review-stars span').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.r, 10) <= selectedReviewStars);
    });
}
async function submitReview(ev) {
    ev.preventDefault();
    if (!TOKEN) { toast('Войдите, чтобы оставить отзыв', 'info'); return; }
    const text = document.getElementById('review-text').value.trim();
    if (!text) { toast('Напишите текст отзыва', 'error'); return; }
    try {
        await api('/api/products/' + CURRENT_PRODUCT.id + '/reviews', { method: 'POST', body: JSON.stringify({ rating: selectedReviewStars, text }) });
        document.getElementById('review-text').value = '';
        toast('Спасибо за отзыв!', 'success');
        loadReviews(CURRENT_PRODUCT.id);
    } catch (e) { toast(e.message, 'error'); }
}

/* ================= ПОХОЖИЕ ТОВАРЫ ================= */
async function loadRelated(productId) {
    let items = [];
    try { items = await api('/api/products/' + productId + '/related'); } catch (e) {}
    document.getElementById('related-track').innerHTML = items.map(productCardHtml).join('');
}
function scrollRelated(dir) {
    const track = document.getElementById('related-track');
    if (track) track.scrollBy({ left: dir * 260, behavior: 'smooth' });
}

/* ================= БРЕНДЫ ================= */
async function loadBrands(renderPage) {
    try { BRANDS = await api('/api/brands'); } catch (e) { BRANDS = []; }
    if (!renderPage) return;
    const grid = document.getElementById('brands-grid');
    grid.innerHTML = BRANDS.map(b => `
        <div class="brand-card" onclick="openBrand(${b.id})" style="cursor:pointer;text-align:center;padding:20px;border:1px solid #eee;">
            <img src="${esc(safeImageUrl(b.logo || ''))}" alt="${esc(b.name)}" style="max-width:120px;max-height:80px;object-fit:contain;">
            <h3 style="margin-top:10px;font-weight:normal;">${esc(b.name)}</h3>
        </div>`).join('') || '<p>Бренды пока не добавлены.</p>';
}
async function openBrand(id) {
    showPage('brand-view');
    let b;
    try { b = await api('/api/brands/' + id); } catch (e) { toast('Бренд не найден', 'error'); showBrands(); return; }
    document.getElementById('bv-logo').src = safeImageUrl(b.logo || '');
    document.getElementById('bv-name').textContent = b.name;
    document.getElementById('bv-desc').textContent = b.description || '';
    let products = [];
    try { products = await api('/api/products?brand=' + id); } catch (e) {}
    document.getElementById('brand-products').innerHTML = products.map(productCardHtml).join('') || '<p>У бренда пока нет товаров.</p>';
}

/* ================= КОНТАКТЫ ================= */


/* ================= КОРЗИНА / ОФОРМЛЕНИЕ ================= */
function renderCart() {
    const box = document.getElementById('cart-content');
    if (!CART.length) {
        box.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">Корзина пуста</p>';
        return;
    }

    let total = 0;
    const itemsHtml = CART.map(function(it, i) {
        total += it.price * it.qty;
        return '<div class="cart-item" style="display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid #eee;">' +
            '<img src="' + esc(safeImageUrl(it.img || '')) + '" style="width:70px;height:70px;object-fit:cover;border:1px solid #eee;" onerror="this.style.display=\'none\'">' +
            '<div style="flex:1;">' +
                '<div style="font-size:15px;margin-bottom:4px;">' + esc(it.name) + '</div>' +
                (it.size ? '<div style="font-size:12px;color:#999;">Размер: ' + esc(it.size) + '</div>' : '') +
                '<div style="font-size:13px;color:#666;margin-top:4px;">' + esc(it.qty) + ' × ' + money(it.price) + '</div>' +
            '</div>' +
            '<div style="font-weight:600;font-size:16px;">' + money(it.price * it.qty) + '</div>' +
            '<button onclick="removeCartItem(' + i + ')" style="background:transparent;border:0;color:#8b0000;cursor:pointer;font-size:18px;">✕</button>' +
        '</div>';
    }).join('');

    box.innerHTML = itemsHtml +
        '<div style="text-align:right;font-size:22px;margin:24px 0;">Итого: <strong>' + money(total) + '</strong></div>' +
        '<div style="max-width:600px;margin:24px auto;padding:24px;background:#fafafa;border:1px solid #ececec;border-radius:12px;">' +
        '<p style="margin:0 0 16px;line-height:1.6;">Оформите покупку у администратора в Telegram. Список товаров уже будет в сообщении — останется нажать «Отправить».</p>' +
        '<button class="btn" onclick="submitOrder()" style="width:100%;">Оформить заказ</button>' +
        '<div id="telegram-order-fallback" hidden style="margin-top:16px;">' +
        '<label for="telegram-order-text">Список слишком длинный для ссылки. Скопируйте его и отправьте администратору:</label>' +
        '<textarea id="telegram-order-text" readonly rows="8" style="width:100%;box-sizing:border-box;margin:12px 0;"></textarea>' +
        '<button class="btn" onclick="copyTelegramOrder()" type="button">Скопировать сообщение</button> ' +
        '<a href="https://t.me/yulya_Lavrinenko" target="_blank" rel="noopener noreferrer">Открыть Telegram</a>' +
        '</div></div>';
}
window.renderCart = renderCart;
async function loadCheckoutContacts() {
    var box = document.getElementById('checkout-contact-list');
    if (!box) return;
    var c = {};
    try { c = await api('/api/contacts'); } catch(e) {}
    
    var items = [];
    if (c.phone) items.push({ icon: 'phone', title: 'Телефон', value: c.phone, link: 'tel:' + c.phone.replace(/\s/g, '') });
    if (c.telegram) items.push({ icon: 'telegram', title: 'Telegram основной', value: c.telegram, link: 'https://t.me/' + c.telegram.replace('@', '') });
    if (c.instagram) items.push({ icon: 'telegram', title: 'Telegram продавец 2', value: c.instagram, link: 'https://t.me/' + c.instagram.replace('@', '') });
    if (c.whatsapp) items.push({ icon: 'telegram', title: 'Telegram продавец 3', value: c.whatsapp, link: 'https://t.me/' + c.whatsapp.replace('@', '') });
    if (c.address) items.push({ icon: 'map', title: 'Адрес', value: c.address, link: null });
    if (c.work_hours) items.push({ icon: 'clock', title: 'Часы работы', value: c.work_hours, link: null });
    
    if (!items.length) {
        box.innerHTML = '<p style="text-align:center;color:#999;">Контакты не заполнены. Зайдите в админку → Контакты.</p>';
        return;
    }
    
    // SVG-иконки (совместимо с уже определёнными)
    var IC = (typeof ICONS !== 'undefined') ? ICONS : {
        phone: '📞', telegram: '✈️', map: '📍', clock: '🕐'
    };
    
    var cardStyle = 'display:flex;align-items:center;gap:16px;padding:16px 20px;border:1px solid #e5e5e5;background:#fff;text-decoration:none;color:#111;border-radius:8px;transition:all 0.2s;';
    var iconStyle = 'width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:#f5f5f5;border-radius:50%;flex-shrink:0;';
    var titleStyle = 'font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#999;font-weight:600;margin-bottom:3px;';
    var valueStyle = 'font-size:15px;color:#111;word-break:break-word;';
    
    box.innerHTML = items.map(function(it) {
        var icon = IC[it.icon] || '';
        var inner = '<div style="' + iconStyle + '">' + icon + '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="' + titleStyle + '">' + it.title + '</div>' +
                '<div style="' + valueStyle + '">' + esc(it.value) + '</div>' +
            '</div>';
        if (it.link) {
            return '<a href="' + esc(safeContactUrl(it.link)) + '" target="_blank" rel="noopener" style="' + cardStyle + '">' + inner + '</a>';
        }
        return '<div style="' + cardStyle + '">' + inner + '</div>';
    }).join('');
}
window.loadCheckoutContacts = loadCheckoutContacts;
function changeCartQty(idx, delta) {
    CART[idx].qty += delta;
    if (CART[idx].qty <= 0) CART.splice(idx, 1);
    saveCart();
    renderCart();
}
function removeCartItem(idx) { CART.splice(idx, 1); saveCart(); renderCart(); }

function buildTelegramOrderMessage(items) {
    return 'Здравствуйте, хочу купить:\n\n' + items.map(function(it) {
        return '• ' + String(it.name || 'Товар') +
            (it.size ? ' — размер ' + String(it.size) : '') +
            ' — ' + String(it.qty) + ' шт.';
    }).join('\n');
}
function submitOrder() {
    if (!CART.length) { toast('Корзина пуста', 'error'); return; }
    const message = buildTelegramOrderMessage(CART);
    // Keep the basket: opening Telegram does not confirm that a message was sent.
    const link = 'https://t.me/yulya_Lavrinenko?text=' + encodeURIComponent(message);
    if (Array.from(message).length > 3500 || link.length > 8000) {
        showCart();
        document.getElementById('telegram-order-fallback').hidden = false;
        document.getElementById('telegram-order-text').value = message;
        return;
    }
    window.location.assign(link);
}
async function copyTelegramOrder() {
    const field = document.getElementById('telegram-order-text');
    if (!field) return;
    try { await navigator.clipboard.writeText(field.value); toast('Сообщение скопировано', 'success'); }
    catch (_) { field.focus(); field.select(); toast('Скопируйте выделенный текст', 'info'); }
}
window.copyTelegramOrder = copyTelegramOrder;
window.submitOrder = submitOrder;
function showSuccess(text) {
    document.getElementById('success-text').textContent = text;
    document.body.classList.add('success-active');
    document.getElementById('success-view').classList.add('active');
    window.__hideSuccess = function () {
        document.body.classList.remove('success-active');
        document.getElementById('success-view').classList.remove('active');
        showCatalog();
    };
}

/* ================= МОИ ЗАКАЗЫ ================= */
async function loadMyOrders() {
    const box = document.getElementById('my-orders-content');
    box.innerHTML = 'Загрузка...';
    let orders = [];
    try { orders = await api('/api/orders/my'); } catch (e) { box.innerHTML = 'Не удалось загрузить заказы.'; return; }
    if (!orders.length) { box.innerHTML = '<p style="color:#888;">У вас пока нет заказов.</p>'; return; }
    const statusLabels = { new: 'Новый', processing: 'В обработке', reserved: 'Резерв', done: 'Выполнен', cancelled: 'Отменён', payment_status: { unpaid: 'Не оплачено', paid: 'Оплачено', refund: 'Возврат', paid_card: 'Оплачено картой' } };
    box.innerHTML = orders.map(o => `
        <div class="order-card" style="border:1px solid #e0e0e0;padding:15px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;">
                <strong>Заказ №${o.id}</strong>
                <span>${esc((o.created_at || '').replace('T', ' ').slice(0, 16))}</span>
            </div>
            <div>Статус: <strong>${esc(statusLabels[o.status] || o.status)}</strong> · Оплата: ${o.payment_method === 'online' ? 'картой' : 'при получении'} (${esc((statusLabels.payment_status && statusLabels.payment_status[o.payment_status]) || o.payment_status || 'unpaid')})</div>
            <div style="margin-top:8px;">
                ${(o.items || []).map(it => `<div>${esc(it.name)}${it.size ? ' (' + esc(it.size) + ')' : ''} × ${esc(it.qty)}</div>`).join('')}
            </div>
            <div style="text-align:right;font-weight:bold;margin-top:8px;">${money(o.total)}</div>
        </div>`).join('');
}

/* ================= АВТОРИЗАЦИЯ ================= */
function openAuthModal(mode) {
    authMode = mode || 'login';
    switchAuthForm(authMode);
    document.getElementById('auth-modal').classList.add('active');
}
function closeAuthModal() { document.getElementById('auth-modal').classList.remove('active'); }

async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
        const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        TOKEN = data.token;
        CURRENT_USER = data.user; if (typeof updateUserFlags === 'function') updateUserFlags(); if (typeof restartAdminSSE === 'function') restartAdminSSE();
        localStorage.setItem('token', TOKEN);
        if (typeof updateUserFlags === 'function') updateUserFlags();
        if (typeof updateUserFlags === 'function') updateUserFlags();
        closeAuthModal();
        renderUserArea();
        toast('Добро пожаловать, ' + data.user.name + '!', 'success');
    } catch (e) { errEl.textContent = e.message; }
}
async function doRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    errEl.textContent = '';
    try {
        const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
        TOKEN = data.token;
        CURRENT_USER = data.user; if (typeof updateUserFlags === 'function') updateUserFlags(); if (typeof restartAdminSSE === 'function') restartAdminSSE();
        localStorage.setItem('token', TOKEN);
        closeAuthModal();
        renderUserArea();
        toast('Регистрация успешна!', 'success');
    } catch (e) { errEl.textContent = e.message; }
}
function logout() {
    TOKEN = null; CURRENT_USER = null; window.__isAdmin = false;
    localStorage.removeItem('token');
    renderUserArea();
    showCatalog();
}
function renderUserArea() {
    const box = document.getElementById('user-area');
    if (!box) return;
    if (CURRENT_USER) {
        box.innerHTML = `<div>
            <span class="user-info">Привет, <strong>${esc(CURRENT_USER.name)}</strong></span>
            <button class="user-btn" onclick="showMyOrders()">Заказы</button>
            ${CURRENT_USER.role === 'admin' ? '<button class="user-btn" onclick="showAdmin()">Админка</button>' : ''}
            <button class="user-btn" onclick="logout()">Выйти</button>
        </div>`;
    } else {
        box.innerHTML = `<div><button class="user-btn" onclick="openAuthModal('login')">Войти</button></div>`;
    }
}
async function restoreSession() {
    if (!TOKEN) { renderUserArea(); return; }
    try {
        CURRENT_USER = await api('/api/me');
    } catch (e) {
        TOKEN = null; localStorage.removeItem('token'); CURRENT_USER = null;
    }
    renderUserArea();
}

/* ================= ГЛАВНЫЙ СЛАЙДЕР ================= */
async function loadSlides() {
    try { SLIDES = await api('/api/slides'); } catch (e) { SLIDES = []; }
    const slider = document.getElementById('hero-slider');
    const dotsBox = document.getElementById('slider-dots');
    if (!slider) return;
    Array.from(slider.querySelectorAll('.slide')).forEach(s => s.remove());
    if (!SLIDES.length) { dotsBox.innerHTML = ''; return; }
    SLIDES.forEach((s, i) => {
        const div = document.createElement('div');
        div.className = 'slide' + (i === 0 ? ' active' : '');
        div.style.cssText = 'position:absolute;inset:0;background-image:url(' + JSON.stringify(safeImageUrl(s.img)) + ');background-size:cover;background-position:center;opacity:0;transition:opacity .6s;';
        if (i === 0) div.style.opacity = '1';
        slider.insertBefore(div, slider.firstChild);
    });
    dotsBox.innerHTML = SLIDES.map((s, i) => `<span class="dot${i === 0 ? ' active' : ''}" onclick="goToSlide(${i})"></span>`).join('');
    SLIDE_IDX = 0;
    clearInterval(slideTimer);
    if (SLIDES.length > 1) slideTimer = setInterval(() => nextSlide(), 6000);
}
function applySlide() {
    const slides = document.querySelectorAll('#hero-slider .slide');
    const dots = document.querySelectorAll('#slider-dots .dot');
    slides.forEach((s, i) => { s.style.opacity = i === SLIDE_IDX ? '1' : '0'; s.classList.toggle('active', i === SLIDE_IDX); });
    dots.forEach((d, i) => d.classList.toggle('active', i === SLIDE_IDX));
}
function nextSlide() { if (!SLIDES.length) return; SLIDE_IDX = (SLIDE_IDX + 1) % SLIDES.length; applySlide(); }
function prevSlide() { if (!SLIDES.length) return; SLIDE_IDX = (SLIDE_IDX - 1 + SLIDES.length) % SLIDES.length; applySlide(); }
function goToSlide(i) { SLIDE_IDX = i; applySlide(); }

/* ================= НАСТРОЙКА БРОНИРОВАНИЯ ================= */
async function loadReserveSetting() {
    try { const r = await api('/api/settings/reserve'); RESERVE_ENABLED = !!r.enabled; } catch (e) { RESERVE_ENABLED = false; }
}

/* ================= ЮРИДИЧЕСКИЕ МОДАЛКИ ================= */
const LEGAL_TEXTS = {
    privacy: ['Политика конфиденциальности', 'Мы собираем только данные, необходимые для оформления и доставки заказа: имя, телефон, адрес и email. Данные не передаются третьим лицам, кроме платёжного провайдера (ЮKassa) и службы доставки.'],
    terms: ['Пользовательское соглашение', 'Используя сайт, вы соглашаетесь с условиями продажи, актуальными ценами и сроками, указанными в карточках товаров. Администрация вправе изменять ассортимент и цены.'],
    delivery: ['Доставка и оплата', 'Доставка по Мариуполю — по таксометру (стоимость зависит от расстояния). Оплата картой, СБП или наличными при получении.'],
    return: ['Возврат и обмен', 'Обмен и возврат товара надлежащего качества возможен в течение 14 дней с момента получения, если сохранён товарный вид.']
};
function openLegal(key) {
    const page = { privacy: '/legal/privacy.html', terms: '/legal/offer.html' }[key];
    if (page) { window.location.assign(page); return; }
    const data = LEGAL_TEXTS[key];
    if (!data) return;
    document.getElementById('legal-title').textContent = data[0];
    document.getElementById('legal-body').innerHTML = '<p>' + esc(data[1]) + '</p>';
    document.getElementById('legal-modal').classList.add('open');
}
function closeLegal() { document.getElementById('legal-modal').classList.remove('open'); }

/* ================= ЧАТ С ПРОДАВЦОМ ================= */
function setChatVisualState(isOpen) {
    const widget = document.getElementById('chat-widget');
    const windowEl = document.getElementById('chat-window');
    const openIcon = widget && widget.querySelector('.chat-ico--open');
    const closeIcon = widget && widget.querySelector('.chat-ico--close');
    if (!widget || !windowEl) return;
    widget.classList.toggle('is-open', isOpen);
    windowEl.classList.toggle('open', isOpen);
    if (openIcon) openIcon.style.display = isOpen ? 'none' : 'block';
    if (closeIcon) closeIcon.style.display = isOpen ? 'block' : 'none';
}

function toggleChat(forceOpen) {
    const widget = document.getElementById('chat-widget');
    const windowEl = document.getElementById('chat-window');
    if (!widget || !windowEl) return;
    const shouldOpen = forceOpen !== undefined ? !!forceOpen : !windowEl.classList.contains('open');
    setChatVisualState(shouldOpen);
    if (shouldOpen) openChat();
    else {
        if (chatES) { chatES.close(); chatES = null; }
        window.__currentChatId = null;
        if (window.__chatPollTimer) { clearInterval(window.__chatPollTimer); window.__chatPollTimer = null; }
    }
}

let guestChatToken = '';
try { guestChatToken = localStorage.getItem('vamp_guest_chat_token') || ''; } catch (_) {}
async function visitorChatSession() {
    if (TOKEN) return api('/api/chats/me');
    if (guestChatToken) {
        try { return await visitorChatApi('/me'); }
        catch (e) { if (e.status !== 401) throw e; guestChatToken = ''; }
    }
    const response = await fetch('/api/guest-chat/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось открыть чат');
    guestChatToken=data.token;
    try { localStorage.setItem('vamp_guest_chat_token',guestChatToken); } catch (_) {}
    return data;
}
async function visitorChatApi(suffix,opts={}) {
    if (TOKEN) return api('/api/chats/' + window.__currentChatId + suffix,opts);
    const response=await fetch('/api/guest-chat'+suffix,{...opts,cache:'no-store',headers:{'Content-Type':'application/json','X-Guest-Chat-Token':guestChatToken}});
    const data=await response.json();
    if (!response.ok) { const error=new Error(data.error || 'Чат недоступен');error.status=response.status;throw error; }
    return data;
}
async function openChat() {
    const authNote = document.getElementById('chat-auth-note');
    const form = document.getElementById('chat-form');
    const body = document.getElementById('chat-body');
    if (!authNote || !form || !body) return;
    setChatVisualState(true);
    authNote.style.display = 'none';
    form.style.display = 'flex';
    body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;font-size:13px;">Загрузка чата…</div>';
    try {
        const data = await visitorChatSession();
        window.__currentChatId = data.chat.id;
        const messages = await visitorChatApi('/messages');
        renderChatMessages(messages);
        if (chatES) chatES.close();
        const streamUrl = '/api/chats/' + data.chat.id + '/stream';
        chatES = TOKEN ? authenticatedStream(streamUrl) : { close() {} };
        chatES.onmessage = (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                if (payload.type === 'message' && payload.message) appendChatMessage(payload.message);
            } catch (e) { console.warn('Chat SSE parse error:', e); }
        };
        chatES.onerror = () => {};
        // Polling fallback: каждые 3 сек подтягиваем новые
        window.__chatSeenIds = new Set((messages || []).map(m => m.id));
        if (window.__chatPollTimer) clearInterval(window.__chatPollTimer);
        window.__chatPollTimer = setInterval(async () => {
            if (!window.__currentChatId) return;
            try {
                const fresh = await visitorChatApi('/messages');
                const box = document.getElementById('chat-body');
                if (!box) return;
                let changed = false;
                for (const m of fresh) {
                    if (!window.__chatSeenIds.has(m.id)) {
                        window.__chatSeenIds.add(m.id);
                        box.insertAdjacentHTML('beforeend', chatMessageHtml(m));
                        changed = true;
                    }
                }
                if (changed) box.scrollTop = box.scrollHeight;
            } catch (e) {}
        }, 3000);
    } catch (e) {
        console.error('Chat open error:', e);
        body.innerHTML = '<div style="padding:24px;text-align:center;color:#8b0000;font-size:13px;">Не удалось загрузить чат. Попробуйте закрыть и открыть его снова.</div>';
        toast(e.message || 'Ошибка чата', 'error');
    }
}
function renderChatMessages(list) {
    const body = document.getElementById('chat-body');
    body.innerHTML = list.map(chatMessageHtml).join('');
    body.scrollTop = body.scrollHeight;
}
function chatMessageHtml(m) {
    const mine = m.sender_role === (CURRENT_USER && CURRENT_USER.role === 'admin' ? 'admin' : 'user');
    const author = mine ? 'Вы' : (m.sender_role === 'admin' ? 'Продавец' : 'Клиент');
    const time = m.created_at ? new Date(m.created_at.replace(' ', 'T') + (m.created_at.includes('Z') ? '' : 'Z')).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';
    return `<div class="chat-msg ${mine ? 'chat-msg--me' : 'chat-msg--them'}" data-message-id="${m.id || ''}"><div class="chat-msg__author">${author}</div>${esc(m.text)}${time ? `<span class="chat-msg__time">${time}</span>` : ''}</div>`;
}
function appendChatMessage(m) {
    const body = document.getElementById('chat-body');
    body.insertAdjacentHTML('beforeend', chatMessageHtml(m));
    body.scrollTop = body.scrollHeight;
}
async function sendChatMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !window.__currentChatId) return;
    input.value = '';
    try {
        const msg = await visitorChatApi('/messages', { method: 'POST', body: JSON.stringify({ text }) });
        if (!window.__chatSeenIds) window.__chatSeenIds = new Set();
        if (!window.__chatSeenIds.has(msg.id)) { window.__chatSeenIds.add(msg.id); appendChatMessage(msg); }
    } catch (e) { input.value = text; toast(e.message, 'error'); }
}

/* ================= ПОИСК ================= */
let searchCache = [];
function openSearch() {
    document.getElementById('search-overlay').classList.add('active');
    document.getElementById('search-input').focus();
    renderSearchHistory();
}
function closeSearch() { document.getElementById('search-overlay').classList.remove('active'); }
function renderSearchHistory() {
    const hist = safeParse(localStorage.getItem('searchHistory'), []);
    document.getElementById('search-history').innerHTML = hist.map(h => `<span class="search-history-item" onclick="doSearch(${jsArg(h)})" style="cursor:pointer;display:inline-block;margin:4px;padding:6px 12px;background:#f2f2f2;">${esc(h)}</span>`).join('');
}
async function doSearch(q) {
    document.getElementById('search-input').value = q;
    if (!q.trim()) return;
    if (!searchCache.length) { try { searchCache = await api('/api/products'); } catch (e) { searchCache = []; } }
    const found = searchCache.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()));
    const histSection = document.getElementById('search-history-section');
    const suggestSection = document.getElementById('search-suggests-section');
    const emptyBox = document.getElementById('search-empty');
    histSection.style.display = 'none';
    if (!found.length) { suggestSection.style.display = 'none'; emptyBox.style.display = 'block'; return; }
    emptyBox.style.display = 'none';
    suggestSection.style.display = 'block';
    document.getElementById('search-suggests').innerHTML = found.slice(0, 20).map(p => `
        <div class="search-suggest-item" style="cursor:pointer;padding:10px;display:flex;gap:10px;align-items:center;" onclick="closeSearch();openProduct(${p.id})">
            <img src="${esc(safeImageUrl((p.images && p.images[0]) || ''))}" style="width:44px;height:44px;object-fit:cover;">
            <div><div>${esc(p.name)}</div><div style="color:#666;">${money(p.final_price)}</div></div>
        </div>`).join('');

    const hist = safeParse(localStorage.getItem('searchHistory'), []);
    const q2 = q.trim();
    const updated = [q2, ...hist.filter(h => h !== q2)].slice(0, 8);
    localStorage.setItem('searchHistory', JSON.stringify(updated));
}
function clearSearchHistory() { localStorage.removeItem('searchHistory'); renderSearchHistory(); }

/* ================= МОБИЛЬНЫЕ ФИЛЬТРЫ (бургер) ================= */
function openFiltersPanel() {
    document.getElementById('burgerBtn').classList.add('is-open');
    document.getElementById('filtersBackdrop').classList.add('is-open');
    document.getElementById('filtersPanel').classList.add('is-open');
}
function closeFiltersPanel() {
    document.getElementById('burgerBtn').classList.remove('is-open');
    document.getElementById('filtersBackdrop').classList.remove('is-open');
    document.getElementById('filtersPanel').classList.remove('is-open');
}

/* ============================================================
   АДМИН-ПАНЕЛЬ
   ============================================================ */


async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"?')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) {
        toast(e.message || 'Ошибка', 'error');
    }
}

async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"?')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) {
        toast(e.message || 'Ошибка', 'error');
    }
}

async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"? Это действие нельзя отменить.')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) {
        toast(e.message || 'Ошибка удаления', 'error');
    }
}

function switchAdminTab(name, btn) {
    console.log('[admin] switch:', name);
    
    document.querySelectorAll('.admin-section').forEach(function(s) {
        s.classList.remove('active');
        s.style.removeProperty('display');
    });
    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    
    var section = document.getElementById('admin-' + name);
    if (section) {
        section.classList.add('active');
        section.style.setProperty('display', 'block', 'important');
        // ДИАГНОСТИКА
        setTimeout(function() {
            console.log('[admin] детей в секции:', section.children.length);
            console.log('[admin] innerHTML длина:', section.innerHTML.length);
            console.log('[admin] computed display:', getComputedStyle(section).display);
            console.log('[admin] computed height:', getComputedStyle(section).height);
            console.log('[admin] getBoundingClientRect:', JSON.stringify(section.getBoundingClientRect()));
            // Что видно внутри
            for (var i = 0; i < section.children.length; i++) {
                var c = section.children[i];
                console.log('[admin] child', i, c.tagName, c.id || c.className, '| display:', getComputedStyle(c).display, '| height:', c.getBoundingClientRect().height);
            }
        }, 500);
    }
    
    // Отдельный fixed-счётчик — показываем только на "users"
    var fixedCounter = document.getElementById('fixed-online-counter');
    if (fixedCounter) {
        fixedCounter.style.display = (name === 'users') ? 'flex' : 'none';
    }
    
    document.body.classList.toggle('admin-chats-active', name === 'chats');
    forceShowAdmin();
    
    if (name === 'chats') loadAdminChats();
    if (name === 'orders') loadAdminOrders();
    if (name === 'contacts') loadAdminContacts();
    if (name === 'settings') loadAdminSettings();
    if (name === 'products') loadAdminProducts();
    if (name === 'categories') loadAdminCategories();
    if (name === 'users') {
        loadOnlineCount();
        loadAdminUsers();
        setTimeout(function() {
            var el = document.getElementById('admin-users');
            var chain = [];
            while (el && el !== document.body) {
                var cs = getComputedStyle(el);
                var r = el.getBoundingClientRect();
                chain.push(el.tagName + (el.id ? '#' + el.id : '') + ' | display:' + cs.display + ' | vis:' + cs.visibility + ' | pos:' + cs.position + ' | rect:' + Math.round(r.width) + 'x' + Math.round(r.height));
                el = el.parentElement;
            }
            console.log('[parents] ЦЕПОЧКА:\n' + chain.join('\n'));
        }, 700);
    }
}
async function loadAdminEverything() {
    await Promise.all([loadCategories(), loadBrandsRef(), loadBadgesRef()]);
    await Promise.all([
        loadAdminProducts(), loadAdminCategories(), loadAdminBrands(), loadAdminBadges(),
        loadAdminSlides(), loadAdminOrders(), loadAdminContacts(), loadRegistrationStatus(),
        loadAdminSettings(), loadAdminUsers()
    ]);
    renderProductBadgeCheckboxes();
}

/* ---- Товары (список) ---- */
let adminProductsCache = [];
let adminProductsSearch = '';
async function loadAdminProducts() {
    try {
        const q = adminProductsSearch.trim();
        adminProductsCache = await api('/api/products' + (q ? '?q=' + encodeURIComponent(q) : ''));
    } catch (e) { adminProductsCache = []; }
    const body = document.getElementById('admin-products-body');
    const count = document.getElementById('admin-products-count');
    if (count) count.textContent = adminProductsSearch ? `Найдено: ${adminProductsCache.length}` : `Всего: ${adminProductsCache.length}`;
    body.innerHTML = adminProductsCache.map(p => `
        <tr>
            <td><img src="${esc(safeImageUrl((p.images && p.images[0]) || ''))}" style="width:50px;height:50px;object-fit:cover;"></td>
            <td><strong>${esc(p.name)}</strong>${p.sku ? `<div class="admin-product-sku">${esc(p.sku)}</div>` : ''}</td>
            <td>${esc((p.category && p.category.name) || '—')}</td>
            <td>${esc((p.brand && p.brand.name) || '—')}</td>
            <td>${money(p.price)}</td>
            <td>${esc(p.discount || 0)}%</td>
            <td>
                <button class="btn btn-small" onclick="editProduct(${p.id})">Изменить</button>
                <button class="btn btn-small btn-danger" onclick="deleteProduct(${p.id})">Удалить</button>
            </td>
        </tr>`).join('') || '<tr><td colspan="7">Товаров по вашему запросу не найдено.</td></tr>';
}

/* ---- Форма добавления/редактирования товара ---- */
function renderProductBadgeCheckboxes(selectedIds) {
    selectedIds = selectedIds || [];
    document.getElementById('f-badges').innerHTML = BADGES.map(b => `
        <label style="margin-right:12px;"><input type="checkbox" value="${b.id}" ${selectedIds.includes(b.id) ? 'checked' : ''}> ${BADGE_ICONS[b.icon] || esc(b.icon || '')} ${esc(b.label)}</label>
    `).join('');
}
function renderStockBySizeInputs(sizesStr, existing) {
    existing = existing || {};
    const sizes = sizesStr.split(',').map(s => s.trim()).filter(Boolean);
    const box = document.getElementById('f-stock-by-size');
    if (!sizes.length) { box.innerHTML = '<span style="color:#888;font-size:12px;">Сначала укажите размеры выше</span>'; return; }
    box.innerHTML = sizes.map(s => `
        <div style="display:inline-block;margin:4px 8px 4px 0;">
            <label style="font-size:12px;display:block;">${esc(s)}</label>
            <input type="number" min="0" data-size="${esc(s)}" class="stock-size-input" value="${esc(existing[s] != null ? existing[s] : 0)}" style="width:70px;">
        </div>`).join('');
}
function collectStockBySize() {
    const out = {};
    document.querySelectorAll('.stock-size-input').forEach(inp => { out[inp.dataset.size] = parseInt(inp.value, 10) || 0; });
    return out;
}
function addSpecRow(label, value) {
    const list = document.getElementById('f-specs-list');
    const row = document.createElement('div');
    row.className = 'spec-row';
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;';
    row.innerHTML = `<input type="text" placeholder="Параметр" class="spec-label" value="${esc(label || '')}" style="flex:1;">
                      <input type="text" placeholder="Значение" class="spec-value" value="${esc(value || '')}" style="flex:1;">
                      <button type="button" class="btn btn-small btn-danger" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
}
function collectSpecs() {
    return Array.from(document.querySelectorAll('#f-specs-list .spec-row')).map(row => ({
        label: row.querySelector('.spec-label').value.trim(),
        value: row.querySelector('.spec-value').value.trim()
    })).filter(s => s.label);
}
function renderProductPhotos() {
    document.getElementById('product-photos-list').innerHTML = CURRENT_PRODUCT_PHOTOS.map((url, i) => `
        <div style="display:inline-block;position:relative;margin:4px;">
            <img src="${esc(safeImageUrl(url))}" style="width:70px;height:70px;object-fit:cover;">
            <button type="button" onclick="removeProductPhoto(${i})" style="position:absolute;top:-6px;right:-6px;background:#8b0000;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;">✕</button>
        </div>`).join('');
}
function removeProductPhoto(i) { CURRENT_PRODUCT_PHOTOS.splice(i, 1); renderProductPhotos(); }
function addUrlPhoto() {
    const input = document.getElementById('f-img-url');
    const url = input.value.trim();
    if (!url) return;
    CURRENT_PRODUCT_PHOTOS.push(url);
    input.value = '';
    renderProductPhotos();
}
async function uploadFiles(files) {
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('photos', f));
    const data = await api('/api/upload', { method: 'POST', body: fd });
    return data.urls || [];
}
function resetProductForm() {
    document.getElementById('edit-id').value = '';
    document.getElementById('form-title').textContent = 'Новый товар';
    document.getElementById('f-name').value = '';
    document.getElementById('f-price').value = '';
    document.getElementById('f-discount').value = 0;
    document.getElementById('f-sku').value = '';
    document.getElementById('f-brand').value = '';
    document.getElementById('f-category').value = '';
    document.getElementById('f-stock').value = 0;
    document.getElementById('f-stock-status').value = 'in_stock';
    document.getElementById('f-sizes').value = '';
    document.getElementById('f-desc').value = '';
    document.getElementById('f-specs-list').innerHTML = '';
    CURRENT_PRODUCT_PHOTOS = [];
    renderProductPhotos();
    renderStockBySizeInputs('', {});
    renderProductBadgeCheckboxes([]);
}
function editProduct(id) {
    const p = adminProductsCache.find(x => x.id === id);
    if (!p) return;
    switchAdminTab('add', document.querySelector('.admin-tab[onclick*="\'add\'"]'));
    document.getElementById('edit-id').value = p.id;
    document.getElementById('form-title').textContent = 'Редактировать товар';
    document.getElementById('f-name').value = p.name;
    document.getElementById('f-price').value = p.price;
    document.getElementById('f-discount').value = p.discount || 0;
    document.getElementById('f-sku').value = p.sku || '';
    document.getElementById('f-brand').value = p.brand_id || '';
    document.getElementById('f-category').value = p.category_id || '';
    document.getElementById('f-stock').value = p.stock || 0;
    document.getElementById('f-stock-status').value = p.stock_status || 'in_stock';
    document.getElementById('f-sizes').value = (p.sizes || []).join(', ');
    document.getElementById('f-desc').value = p.description || '';
    document.getElementById('f-specs-list').innerHTML = '';
    (p.specs || []).forEach(s => addSpecRow(s.label || s.key, s.value));
    CURRENT_PRODUCT_PHOTOS = (p.images || []).slice();
    renderProductPhotos();
    renderStockBySizeInputs((p.sizes || []).join(', '), p.stock_by_size || {});
    renderProductBadgeCheckboxes((p.badges || []).map(b => b.id));
    window.scrollTo(0, 0);
}
async function saveProduct() {
    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('f-name').value.trim();
    const price = parseFloat(document.getElementById('f-price').value);
    if (!name || !price) { toast('Укажите название и цену', 'error'); return; }
    if (!CURRENT_PRODUCT_PHOTOS.length) { toast('Добавьте хотя бы одно фото', 'error'); return; }
    const sizesStr = document.getElementById('f-sizes').value.trim();
    const sizes = sizesStr ? sizesStr.split(',').map(s => s.trim()).filter(Boolean) : ['ONE SIZE'];
    const badge_ids = Array.from(document.querySelectorAll('#f-badges input:checked')).map(cb => parseInt(cb.value, 10));
    const payload = {
        name, price,
        description: document.getElementById('f-desc').value.trim(),
        sizes, images: CURRENT_PRODUCT_PHOTOS,
        brand_id: document.getElementById('f-brand').value || null,
        category_id: document.getElementById('f-category').value || null,
        discount: parseInt(document.getElementById('f-discount').value, 10) || 0,
        stock: parseInt(document.getElementById('f-stock').value, 10) || 0,
        stock_status: document.getElementById('f-stock-status').value,
        sku: document.getElementById('f-sku').value.trim(),
        specs: collectSpecs(),
        stock_by_size: collectStockBySize(),
        badge_ids
    };
    try {
        if (id) await api('/api/products/' + id, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
        toast('Товар сохранён', 'success');
        resetProductForm();
        await loadAdminProducts();
        switchAdminTab('products', document.querySelector('.admin-tab[onclick*="\'products\'"]'));
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteProduct(id) {
    if (!confirm('Удалить товар?')) return;
    try { await api('/api/products/' + id, { method: 'DELETE' }); toast('Удалено', 'success'); loadAdminProducts(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Бренды ---- */

async function loadAdminCategories() {
    const body = document.getElementById('admin-categories-body');
    if (!body) return;

    try {
        const categories = await api('/api/categories');

        const count = document.getElementById('admin-categories-count');
        if (count) count.textContent = categories.length;

        body.innerHTML = categories.map(c => `
            <tr>
                <td>${c.id}</td>
                <td><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.slug || '')}</td>
                <td>${esc(c.sort_order || 0)}</td>
                <td>
                    <button
                        type="button"
                        class="btn btn-small"
                        onclick="deleteAdminCategory(${c.id}, ${jsArg(c.name)})"
                    >
                        Удалить
                    </button>
                </td>
            </tr>
        `).join('');

        if (!categories.length) {
            body.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center;color:#888;">
                        Категорий пока нет
                    </td>
                </tr>
            `;
        }
    } catch (e) {
        console.error(e);
        body.innerHTML = `
            <tr>
                <td colspan="5">Ошибка загрузки категорий</td>
            </tr>
        `;
    }
}

async function addAdminCategory() {
    const nameEl = document.getElementById('admin-category-name');
    const sortEl = document.getElementById('admin-category-sort');

    const name = (nameEl.value || '').trim();
    const sort_order = parseInt(sortEl.value, 10) || 0;

    if (!name) {
        toast('Введите название категории', 'error');
        nameEl.focus();
        return;
    }

    try {
        await api('/api/categories', {
            method: 'POST',
            body: JSON.stringify({
                name,
                sort_order
            })
        });

        nameEl.value = '';
        sortEl.value = '0';

        await loadCategories();
        await loadAdminCategories();

        toast('Категория добавлена', 'success');
    } catch (e) {
        toast(e.message || 'Не удалось добавить категорию', 'error');
    }
}

async function deleteAdminCategory(id, name) {
    if (!confirm('Удалить категорию «' + name + '»?')) {
        return;
    }

    try {
        await api('/api/categories/' + id, {
            method: 'DELETE'
        });

        await loadCategories();
        await loadAdminCategories();
        await loadAdminProducts();

        toast('Категория удалена', 'success');
    } catch (e) {
        toast(e.message || 'Не удалось удалить категорию', 'error');
    }
}

async function loadAdminBrands() {
    let brands = [];
    try { brands = await api('/api/brands'); } catch (e) {}
    document.getElementById('admin-brands-body').innerHTML = brands.map(b => `
        <tr>
            <td><img src="${esc(safeImageUrl(b.logo || ''))}" style="width:40px;height:40px;object-fit:contain;"></td>
            <td>${esc(b.name)}</td>
            <td>${esc(b.description || '')}</td>
            <td><button class="btn btn-small btn-danger" onclick="deleteBrand(${b.id})">Удалить</button></td>
        </tr>`).join('') || '<tr><td colspan="4">Брендов пока нет.</td></tr>';
}
async function saveBrand() {
    const name = document.getElementById('b-name').value.trim();
    if (!name) { toast('Укажите название бренда', 'error'); return; }
    const payload = {
        name,
        description: document.getElementById('b-desc').value.trim(),
        logo: CURRENT_BRAND_LOGO || document.getElementById('b-logo-url').value.trim()
    };
    try {
        await api('/api/brands', { method: 'POST', body: JSON.stringify(payload) });
        toast('Бренд добавлен', 'success');
        document.getElementById('b-name').value = ''; document.getElementById('b-desc').value = ''; document.getElementById('b-logo-url').value = '';
        CURRENT_BRAND_LOGO = '';
        document.getElementById('brand-upload-preview').style.display = 'none';
        loadAdminBrands(); loadBrandsRef();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteBrand(id) {
    if (!confirm('Удалить бренд?')) return;
    try { await api('/api/brands/' + id, { method: 'DELETE' }); loadAdminBrands(); loadBrandsRef(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Бейджи ---- */
const BADGE_ICONS = {
    sparkles: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>',
    flame: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    tag: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
    star: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    hourglass: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',
    xcircle: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
    gem: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 12L2 9Z"/><path d="M11 3 8 9l4 12 4-12-3-6"/><path d="M2 9h20"/></svg>',
    gift: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>'
};
const BADGE_ICON_CHOICES = Object.keys(BADGE_ICONS);
function renderBadgeIconGrid(selected) {
    document.getElementById('badge-icon-grid').innerHTML = BADGE_ICON_CHOICES.map(ic => `
        <button type="button" class="badge-icon-btn${ic === selected ? ' selected' : ''}" onclick="pickBadgeIcon('${ic}', this)">${BADGE_ICONS[ic]}</button>`).join('');
}
function pickBadgeIcon(icon, btn) {
    document.getElementById('bd-icon').value = icon;
    document.querySelectorAll('.badge-icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}
async function loadAdminBadges() {
    let badges = [];
    try { badges = await api('/api/badges'); } catch (e) {}
    renderBadgeIconGrid('');
    document.getElementById('admin-badges-body').innerHTML = badges.map(b => `
        <tr>
            <td>${BADGE_ICONS[b.icon] || esc(b.icon || '')}</td>
            <td>${esc(b.label)}</td>
            <td>${esc(b.code)}</td>
            <td><span style="display:inline-block;width:16px;height:16px;background:${esc(safeColor(b.color))};"></span></td>
            <td>${b.auto ? 'Да' : 'Нет'}</td>
            <td>${esc(b.sort_order)}</td>
            <td><button class="btn btn-small btn-danger" onclick="deleteBadge(${b.id})">Удалить</button></td>
        </tr>`).join('') || '<tr><td colspan="7">Бейджей пока нет.</td></tr>';
}
async function saveBadge() {
    const code = document.getElementById('bd-code').value.trim();
    const label = document.getElementById('bd-label').value.trim();
    if (!code || !label) { toast('Укажите код и название', 'error'); return; }
    const payload = {
        code, label,
        icon: document.getElementById('bd-icon').value,
        color: document.getElementById('bd-color').value,
        text_color: document.getElementById('bd-text-color').value,
        auto: document.getElementById('bd-auto').checked,
        sort_order: parseInt(document.getElementById('bd-sort').value, 10) || 0
    };
    try {
        await api('/api/badges', { method: 'POST', body: JSON.stringify(payload) });
        toast('Бейдж добавлен', 'success');
        document.getElementById('bd-code').value = ''; document.getElementById('bd-label').value = '';
        loadAdminBadges(); loadBadgesRef();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteBadge(id) {
    if (!confirm('Удалить бейдж?')) return;
    try { await api('/api/badges/' + id, { method: 'DELETE' }); loadAdminBadges(); loadBadgesRef(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Слайдер ---- */
async function loadAdminSlides() {
    let slides = [];
    try { slides = await api('/api/slides'); } catch (e) {}
    document.getElementById('slides-list').innerHTML = slides.map(s => `
        <div style="display:inline-block;position:relative;margin:6px;">
            <img src="${esc(safeImageUrl(s.img))}" style="width:120px;height:70px;object-fit:cover;">
            <button onclick="deleteSlide(${s.id})" style="position:absolute;top:-6px;right:-6px;background:#8b0000;color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;">✕</button>
        </div>`).join('') || '<p>Слайдов пока нет.</p>';
}
async function addSlide() {
    const url = CURRENT_SLIDE_IMG || document.getElementById('slide-url').value.trim();
    if (!url) { toast('Добавьте фото или укажите URL', 'error'); return; }
    try {
        await api('/api/slides', { method: 'POST', body: JSON.stringify({ img: url }) });
        toast('Слайд добавлен', 'success');
        document.getElementById('slide-url').value = '';
        CURRENT_SLIDE_IMG = '';
        document.getElementById('slide-upload-preview').style.display = 'none';
        loadAdminSlides(); loadSlides();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteSlide(id) {
    if (!confirm('Удалить слайд?')) return;
    try { await api('/api/slides/' + id, { method: 'DELETE' }); loadAdminSlides(); loadSlides(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Заказы ---- */
async function loadAdminOrders() {
    let orders = [];
    try { orders = await api('/api/orders'); } catch (e) {}
    const statuses = ['new', 'processing', 'reserved', 'done', 'cancelled'];
    document.getElementById('admin-orders-body').innerHTML = orders.map(o => `
        <tr>
            <td>${o.id}</td>
            <td>${esc(o.customer_name || '—')}</td>
            <td>${esc(o.phone || '')}</td>
            <td>${esc(o.address || '')}</td>
            <td>${(o.items || []).map(it => esc(it.name) + (it.size ? ' (' + esc(it.size) + ')' : '') + ' ×' + esc(it.qty)).join('<br>')}</td>
            <td>${money(o.total)}</td>
            <td>
                <select onchange="setOrderPayment(${o.id}, this.value)">
                    ${['unpaid', 'paid', 'refund'].map(s => `<option value="${s}" ${o.payment_status === s ? 'selected' : ''}>${({unpaid:'Не оплачено', paid:'Оплачено', refund:'Возврат'})[s]}</option>`).join('')}
                </select>
            </td>
            <td>
                <select onchange="setOrderStatus(${o.id}, this.value)">
                    ${statuses.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${({new:'Новый', processing:'В обработке', reserved:'Резерв', done:'Выполнен', cancelled:'Отменён'})[s]}</option>`).join('')}
                </select>
            </td>
        </tr>`).join('') || '<tr><td colspan="8">Заказов пока нет.</td></tr>';
}
async function setOrderStatus(id, status) {
    try { await api('/api/orders/' + id, { method: 'PUT', body: JSON.stringify({ status }) }); toast('Статус обновлён', 'success'); }
    catch (e) { toast(e.message, 'error'); }
}
async function setOrderPayment(id, payment_status) {
    try { await api('/api/orders/' + id + '/payment', { method: 'PUT', body: JSON.stringify({ payment_status }) }); toast('Статус оплаты обновлён', 'success'); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Контакты (админ) ---- */
async function loadAdminContacts() {
    let c = {};
    try { c = await api('/api/contacts'); } catch (e) {}
    document.getElementById('c-phone').value = c.phone || '';
    document.getElementById('c-email').value = c.email || '';
    document.getElementById('c-address').value = c.address || '';
    document.getElementById('c-instagram').value = c.instagram || '';
    document.getElementById('c-telegram').value = c.telegram || '';
    document.getElementById('c-whatsapp').value = c.whatsapp || '';
    document.getElementById('c-hours').value = c.work_hours || '';
}
async function saveContacts() {
    const payload = {
        phone: document.getElementById('c-phone').value.trim(),
        email: document.getElementById('c-email').value.trim(),
        address: document.getElementById('c-address').value.trim(),
        instagram: document.getElementById('c-instagram').value.trim(),
        telegram: document.getElementById('c-telegram').value.trim(),
        whatsapp: document.getElementById('c-whatsapp').value.trim(),
        work_hours: document.getElementById('c-hours').value.trim()
    };
    try { await api('/api/contacts', { method: 'PUT', body: JSON.stringify(payload) }); toast('Контакты сохранены', 'success');
        loadFooterContacts(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Настройки (бронирование) ---- */
async function loadAdminSettings() {
    try {
        const r = await api('/api/settings/reserve');
        document.getElementById('reserve-toggle').checked = !!r.enabled;
        document.getElementById('reserve-status').textContent = r.enabled ? 'Бронирование включено' : 'Бронирование выключено';
        RESERVE_ENABLED = !!r.enabled;
    } catch (e) { document.getElementById('reserve-status').textContent = 'Не удалось загрузить настройки'; }
}
async function toggleReserve(enabled) {
    try {
        await api('/api/settings/reserve', { method: 'PUT', body: JSON.stringify({ enabled }) });
        RESERVE_ENABLED = enabled;
        document.getElementById('reserve-status').textContent = enabled ? 'Бронирование включено' : 'Бронирование выключено';
        toast('Настройки сохранены', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ---- Пользователи ---- */


/* ---- Чаты (админ) ---- */
let adminActiveChatId = null;
let adminChatES = null;
let adminChatMessageIds = new Set();
async function loadAdminChats() {
    let chats = [];
    try { chats = await api('/api/chats'); } catch (e) {}
    const totalUnread = chats.reduce((s, c) => s + (c.unread || 0), 0);
    const badge = document.getElementById('admin-chat-badge');
    if (totalUnread > 0) { badge.style.display = 'inline-block'; badge.textContent = totalUnread; } else { badge.style.display = 'none'; }
    document.getElementById('admin-chats-list-body').innerHTML = chats.map(c => `
        <div class="admin-chat-item${c.id === adminActiveChatId ? ' active' : ''}" data-chat-id="${c.id}" style="padding:10px;border-bottom:1px solid #eee;cursor:pointer;">
            <div class="admin-chat-item__name">${esc(c.user_name || 'Пользователь')}</div>
            <div class="admin-chat-item__preview" style="font-size:12px;color:#888;">${esc((c.last_text || '').slice(0, 40))}</div>
        </div>`).join('') || '<p style="padding:10px;color:#888;">Диалогов пока нет.</p>';
    document.querySelectorAll('#admin-chats-list-body [data-chat-id]').forEach(el => {
        el.addEventListener('click', () => {
            const chat = chats.find(c => String(c.id) === el.dataset.chatId);
            if (chat) openAdminChat(chat.id, chat.user_name || '');
        });
    });
}
async function openAdminChat(chatId, userName) {
    adminActiveChatId = chatId;
    adminChatMessageIds = new Set();
    if (adminChatES) { adminChatES.close(); adminChatES = null; }
    document.getElementById('admin-chats-empty').style.display = 'none';
    document.getElementById('admin-chats-active').style.display = 'flex';
    document.getElementById('admin-chat-name').textContent = userName || 'Пользователь';
    try {
        const msgs = await api('/api/chats/' + chatId + '/messages');
        adminChatMessageIds = new Set(msgs.map(m => m.id));
        document.getElementById('admin-chat-body').innerHTML = msgs.map(chatMessageHtml).join('');
        document.getElementById('admin-chat-body').scrollTop = 999999;
        adminChatES = authenticatedStream('/api/chats/' + chatId + '/stream');
        adminChatES.onmessage = (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                if (payload.type === 'message' && payload.message && !adminChatMessageIds.has(payload.message.id) && payload.message.chat_id === adminActiveChatId) {
                    adminChatMessageIds.add(payload.message.id);
                    document.getElementById('admin-chat-body').insertAdjacentHTML('beforeend', chatMessageHtml(payload.message));
                    document.getElementById('admin-chat-body').scrollTop = 999999;
                    loadAdminChats();
                }
            } catch (e) {}
        };
        // Polling fallback для админки
        if (window.__adminChatPollTimer) clearInterval(window.__adminChatPollTimer);
        window.__adminChatPollTimer = setInterval(async () => {
            if (!adminActiveChatId) return;
            try {
                const fresh = await api('/api/chats/' + adminActiveChatId + '/messages');
                const box = document.getElementById('admin-chat-body');
                if (!box) return;
                let changed = false;
                for (const m of fresh) {
                    if (!adminChatMessageIds.has(m.id)) {
                        adminChatMessageIds.add(m.id);
                        box.insertAdjacentHTML('beforeend', chatMessageHtml(m));
                        changed = true;
                    }
                }
                if (changed) { box.scrollTop = 999999; loadAdminChats(); }
            } catch (e) {}
        }, 3000);
    } catch (e) {}
    loadAdminChats();
}
async function sendAdminChatMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('admin-chat-input');
    const text = input.value.trim();
    if (!text || !adminActiveChatId) return;
    input.value = '';
    try {
        // Сообщение уже придёт в этот же интерфейс через SSE, поэтому
        // не добавляем его второй раз вручную.
        await api('/api/chats/' + adminActiveChatId + '/messages', { method: 'POST', body: JSON.stringify({ text }) });
    } catch (e) {
        input.value = text;
        toast(e.message, 'error');
    }
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
    const preloader = document.getElementById('preloader');

    await restoreSession();
    await loadCategories();
    await loadBrandsRef();
    await loadBadgesRef();
    await loadReserveSetting();
    await loadSlides();
    showCatalog();

    if (preloader && window.vampInkLoader) {
        window.vampInkLoader.complete();
    } else if (preloader) {
        setTimeout(() => { preloader.style.display = 'none'; }, 300);
    }
    updateCartCount();
    updateFavCount();

    /* Загрузка фото товара */
    const uploadZone = document.getElementById('upload-zone');
    const fFile = document.getElementById('f-file');
    if (uploadZone && fFile) {
        uploadZone.addEventListener('click', () => fFile.click());
        fFile.addEventListener('change', async () => {
            if (!fFile.files.length) return;
            try { CURRENT_PRODUCT_PHOTOS.push(...(await uploadFiles(fFile.files))); renderProductPhotos(); }
            catch (e) { toast(e.message, 'error'); }
            fFile.value = '';
        });
    }
    /* Размеры → генерация полей остатков по размеру */
    const fSizes = document.getElementById('f-sizes');
    if (fSizes) fSizes.addEventListener('input', () => renderStockBySizeInputs(fSizes.value, collectStockBySize()));

    /* Логотип бренда */
    const brandZone = document.getElementById('brand-upload-zone');
    const brandFile = document.getElementById('brand-file');
    if (brandZone && brandFile) {
        brandFile.addEventListener('change', async () => {
            if (!brandFile.files.length) return;
            try {
                const urls = await uploadFiles(brandFile.files);
                CURRENT_BRAND_LOGO = urls[0];
                const prev = document.getElementById('brand-upload-preview');
                prev.src = safeImageUrl(CURRENT_BRAND_LOGO); prev.style.display = 'block';
            } catch (e) { toast(e.message, 'error'); }
        });
    }
    /* Слайд */
    const slideZone = document.getElementById('slide-upload-zone');
    const slideFile = document.getElementById('slide-file');
    if (slideZone && slideFile) {
        slideZone.addEventListener('click', () => slideFile.click());
        slideFile.addEventListener('change', async () => {
            if (!slideFile.files.length) return;
            try {
                const urls = await uploadFiles(slideFile.files);
                CURRENT_SLIDE_IMG = urls[0];
                const prev = document.getElementById('slide-upload-preview');
                prev.src = safeImageUrl(CURRENT_SLIDE_IMG); prev.style.display = 'block';
            } catch (e) { toast(e.message, 'error'); }
        });
    }

    /* Бургер-фильтры (мобильные) */
    const burgerBtn = document.getElementById('burgerBtn');
    if (burgerBtn) burgerBtn.addEventListener('click', () => {
        if (burgerBtn.classList.contains('is-open')) closeFiltersPanel(); else openFiltersPanel();
    });
    const filtersClose = document.getElementById('filtersClose');
    if (filtersClose) filtersClose.addEventListener('click', closeFiltersPanel);
    const filtersBackdrop = document.getElementById('filtersBackdrop');
    if (filtersBackdrop) filtersBackdrop.addEventListener('click', closeFiltersPanel);
    const filterCategory = document.getElementById('filterCategory');
    if (filterCategory) filterCategory.addEventListener('change', () => onCategoryChange(filterCategory.value));
    const filterSort = document.getElementById('filterSort');
    if (filterSort) filterSort.addEventListener('change', () => onSortChange(mapBurgerToSort(filterSort.value)));
    const filtersReset = document.getElementById('filtersReset');
    if (filtersReset) filtersReset.addEventListener('click', () => { resetFilters(); closeFiltersPanel(); });

    /* Поиск */
    const searchToggle = document.getElementById('search-toggle');
    if (searchToggle) searchToggle.addEventListener('click', openSearch);
    const searchClose = document.getElementById('search-close');
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let searchTimer;
        searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(searchInput.value), 250); });
    }
    const searchClearHistory = document.getElementById('search-clear-history');
    if (searchClearHistory) searchClearHistory.addEventListener('click', clearSearchHistory);

    /* Поиск товаров в админке */
    const adminProductsSearchInput = document.getElementById('admin-products-search');
    const adminProductsSearchClear = document.getElementById('admin-products-search-clear');
    if (adminProductsSearchInput) {
        let adminSearchTimer;
        adminProductsSearchInput.addEventListener('input', () => {
            clearTimeout(adminSearchTimer);
            adminProductsSearch = adminProductsSearchInput.value;
            adminSearchTimer = setTimeout(loadAdminProducts, 180);
        });
    }
    if (adminProductsSearchClear) adminProductsSearchClear.addEventListener('click', () => {
        adminProductsSearch = '';
        if (adminProductsSearchInput) adminProductsSearchInput.value = '';
        loadAdminProducts();
        if (adminProductsSearchInput) adminProductsSearchInput.focus();
    });

    /* Чат */
    const chatForm = document.getElementById('chat-form');
    if (chatForm) chatForm.addEventListener('submit', sendChatMessage);
    const adminChatForm = document.getElementById('admin-chat-form');
    if (adminChatForm) adminChatForm.addEventListener('submit', sendAdminChatMessage);
});





// ===== Контакты в футере (динамические) =====
async function loadFooterContacts() {
    const box = document.getElementById('footer-contacts');
    if (!box) return;
    let c = {};
    try { c = await api('/api/contacts'); } catch (e) { return; }
    const parts = [];
    if (c.phone) parts.push('<a href="tel:' + esc(c.phone.replace(/\s/g, '')) + '">📞 ' + esc(c.phone) + '</a>');
    if (c.email) parts.push('<a href="mailto:' + esc(c.email) + '">✉️ ' + esc(c.email) + '</a>');
    if (c.telegram) parts.push('<a href="https://t.me/' + esc(c.telegram.replace('@', '')) + '" target="_blank" rel="noopener">✈️ ' + esc(c.telegram) + '</a>');
    if (c.instagram) parts.push('<a href="https://t.me/' + esc(c.instagram.replace('@', '')) + '" target="_blank" rel="noopener">✈️ ' + esc(c.instagram) + '</a>');
    if (c.whatsapp) parts.push('<a href="https://t.me/' + esc(c.whatsapp.replace('@', '')) + '" target="_blank" rel="noopener">✈️ ' + esc(c.whatsapp) + '</a>');
    if (c.address) parts.push('<span>📍 ' + esc(c.address) + '</span>');
    if (c.work_hours) parts.push('<span>🕐 ' + esc(c.work_hours) + '</span>');
    if (parts.length) box.innerHTML = parts.join('');
}

// Загружаем контакты в футер при старте
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFooterContacts);
} else {
    loadFooterContacts();
}





// ===== Регистрация на сайте =====
// ===== Переопределение switchAuthForm с проверкой регистрации =====

window.switchAuthForm = switchAuthForm;


// ===== Регистрация на сайте (финальная версия) =====
window.REGISTRATION_ENABLED = false; // по умолчанию — выключено, пока не загрузили

async function loadRegistrationStatus() {
    try {
        var r = await api('/api/settings/allow_registration');
        window.REGISTRATION_ENABLED = !!r.enabled;
        console.log('[reg] REGISTRATION_ENABLED =', window.REGISTRATION_ENABLED);
        var toggle = document.getElementById('registration-toggle');
        if (toggle) toggle.checked = r.enabled;
        var status = document.getElementById('registration-status');
        if (status) status.textContent = r.enabled ? 'Регистрация включена' : 'Регистрация выключена';
    } catch (e) {
        console.log('[reg] load error:', e.message);
        window.REGISTRATION_ENABLED = false;
    }
}

async function toggleRegistration(enabled) {
    try {
        await api('/api/settings/allow_registration', { method: 'PUT', body: JSON.stringify({ enabled: enabled }) });
        window.REGISTRATION_ENABLED = !!enabled;
        var status = document.getElementById('registration-status');
        if (status) status.textContent = enabled ? 'Регистрация включена' : 'Регистрация выключена';
        toast(enabled ? 'Регистрация включена' : 'Регистрация выключена', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

function switchAuthForm(mode) {
    console.log('[reg] switchAuthForm called, mode =', mode, 'ENABLED =', window.REGISTRATION_ENABLED);
    if (mode === 'register' && window.REGISTRATION_ENABLED === false) {
        if (typeof toast === 'function') {
            toast('Регистрация временно недоступна', 'info');
        } else {
            alert('Регистрация временно недоступна');
        }
        return;
    }
    var loginForm = document.getElementById('login-form');
    var registerForm = document.getElementById('register-form');
    var title = document.getElementById('auth-title');
    if (mode === 'register') {
        if (loginForm) loginForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'block';
        if (title) title.textContent = 'Регистрация';
    } else {
        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
        if (title) title.textContent = 'Вход';
    }
}
window.switchAuthForm = switchAuthForm;

// Загружаем статус при старте страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { loadRegistrationStatus(); });
} else {
    loadRegistrationStatus();
}


// ===== Методы оплаты =====
window.PAYMENT_CASH = true;
window.PAYMENT_ONLINE = true;











async function updatePaymentUI() {
    var cashBtn = document.querySelector('.payment-method[data-method="cash"]');
    var onlineBtn = document.querySelector('.payment-method[data-method="online"]');
    var cartContent = document.getElementById('cart-content');
    var checkoutBlock = cartContent ? cartContent.querySelector('.admin-form') : null;

    if (!checkoutBlock) return;

    if (cashBtn) cashBtn.style.display = window.PAYMENT_CASH ? '' : 'none';
    if (onlineBtn) onlineBtn.style.display = window.PAYMENT_ONLINE ? '' : 'none';

    if (!window.PAYMENT_CASH && !window.PAYMENT_ONLINE) {
        checkoutBlock.style.display = 'none';

        var contacts = {};
        try { contacts = await api('/api/contacts'); } catch (e) {}

        var contactLines = [];
        if (contacts.phone) {
            contactLines.push('<a href="tel:' + esc(contacts.phone.replace(/\s/g, '')) + '" class="contact-card" style="margin-bottom:10px;">' +
                '<div class="contact-card__icon">' + ICONS.phone + '</div>' +
                '<div class="contact-card__body"><div class="contact-card__title">Телефон</div><div class="contact-card__value">' + esc(contacts.phone) + '</div></div></a>');
        }
        if (contacts.telegram) {
            contactLines.push('<a href="https://t.me/' + esc(contacts.telegram.replace('@', '')) + '" target="_blank" rel="noopener" class="contact-card" style="margin-bottom:10px;">' +
                '<div class="contact-card__icon">' + ICONS.telegram + '</div>' +
                '<div class="contact-card__body"><div class="contact-card__title">Telegram основной</div><div class="contact-card__value">' + esc(contacts.telegram) + '</div></div></a>');
        }
        if (contacts.instagram) {
            contactLines.push('<a href="https://t.me/' + esc(contacts.instagram.replace('@', '')) + '" target="_blank" rel="noopener" class="contact-card" style="margin-bottom:10px;">' +
                '<div class="contact-card__icon">' + ICONS.telegram + '</div>' +
                '<div class="contact-card__body"><div class="contact-card__title">Telegram продавец 2</div><div class="contact-card__value">' + esc(contacts.instagram) + '</div></div></a>');
        }
        if (contacts.whatsapp) {
            contactLines.push('<a href="https://t.me/' + esc(contacts.whatsapp.replace('@', '')) + '" target="_blank" rel="noopener" class="contact-card" style="margin-bottom:10px;">' +
                '<div class="contact-card__icon">' + ICONS.telegram + '</div>' +
                '<div class="contact-card__body"><div class="contact-card__title">Telegram продавец 3</div><div class="contact-card__value">' + esc(contacts.whatsapp) + '</div></div></a>');
        }

        var msg = document.getElementById('checkout-disabled-msg');
        if (!msg) {
            msg = document.createElement('div');
            msg.id = 'checkout-disabled-msg';
            msg.style.cssText = 'max-width:520px;margin:40px auto;padding:50px 30px 30px;text-align:center;border:1px solid #e5e5e5;background:#fafafa;';
            checkoutBlock.parentNode.insertBefore(msg, checkoutBlock);
        }
        msg.innerHTML = '<div style="display:flex;justify-content:center;margin-bottom:16px;color:#111;">' + ICONS.pause + '</div>' +
            '<h3 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;color:#111;">Оформление заказов временно недоступно</h3>' +
            '<p style="color:#666;font-size:14px;margin:0 0 30px;">Свяжитесь с нами напрямую — мы поможем оформить заказ:</p>' +
            '<div style="text-align:left;max-width:100%;">' + contactLines.join('') + '</div>';
    } else {
        checkoutBlock.style.display = '';
        var msg = document.getElementById('checkout-disabled-msg');
        if (msg) msg.remove();

        if (!document.querySelector('.payment-method')) {
            if (typeof renderCart === 'function') {
                setTimeout(function() { renderCart(); }, 50);
            }
        }
    }

    if (window.selectedPayment === 'cash' && !window.PAYMENT_CASH && window.PAYMENT_ONLINE) window.selectedPayment = 'online';
    else if (window.selectedPayment === 'online' && !window.PAYMENT_ONLINE && window.PAYMENT_CASH) window.selectedPayment = 'cash';
    if (!window.PAYMENT_CASH && !window.PAYMENT_ONLINE) window.selectedPayment = null;
}

async function loadPaymentMethods() {
    try {
        var r = await api('/api/settings/payment_methods');
        window.PAYMENT_CASH = !!r.cash;
        window.PAYMENT_ONLINE = !!r.online;
        console.log('[payment] CASH =', window.PAYMENT_CASH, 'ONLINE =', window.PAYMENT_ONLINE);
        var t1 = document.getElementById('payment-cash-toggle');
        var t2 = document.getElementById('payment-online-toggle');
        var s1 = document.getElementById('payment-cash-status');
        var s2 = document.getElementById('payment-online-status');
        if (t1) t1.checked = window.PAYMENT_CASH;
        if (t2) t2.checked = window.PAYMENT_ONLINE;
        if (s1) s1.textContent = window.PAYMENT_CASH ? 'Оплата при получении включена' : 'Оплата при получении выключена';
        if (s2) s2.textContent = window.PAYMENT_ONLINE ? 'Онлайн-оплата включена' : 'Онлайн-оплата выключена';
        updatePaymentUI();
    } catch (e) { console.log('[payment] load error:', e.message); }
}

async function togglePaymentMethod(method, enabled) {
    try {
        var payload = { cash: window.PAYMENT_CASH, online: window.PAYMENT_ONLINE };
        payload[method] = !!enabled;
        await api('/api/settings/payment_methods', { method: 'PUT', body: JSON.stringify(payload) });
        if (method === 'cash') window.PAYMENT_CASH = !!enabled;
        if (method === 'online') window.PAYMENT_ONLINE = !!enabled;
        var s1 = document.getElementById('payment-cash-status');
        var s2 = document.getElementById('payment-online-status');
        if (s1) s1.textContent = window.PAYMENT_CASH ? 'Оплата при получении включена' : 'Оплата при получении выключена';
        if (s2) s2.textContent = window.PAYMENT_ONLINE ? 'Онлайн-оплата включена' : 'Онлайн-оплата выключена';
        toast('Способ оплаты обновлён', 'success');
        updatePaymentUI();
    } catch (e) { toast(e.message, 'error'); }
}



// Загружаем методы при старте
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { loadPaymentMethods(); });
} else {
    loadPaymentMethods();
}




async function loadOnlineCount() {
    try {
        var r = await api('/api/online/current');
        var el = document.getElementById('online-now');
        if (el) el.textContent = (r && r.online != null) ? r.online : 0;
    } catch(e) {}
}
window.loadOnlineCount = loadOnlineCount;

window.__onlineTimer = setInterval(function() {
    var s = document.getElementById('admin-users');
    if (s && s.classList.contains('active')) loadOnlineCount();
}, 15000);

function injectOnlineCounter() {
    var section = document.getElementById('admin-users');
    if (!section) return;
    if (document.getElementById('online-counter-block')) return;
    
    var counter = document.createElement('div');
    counter.id = 'online-counter-block';
    counter.style.cssText = 'display:flex;align-items:center;gap:16px;padding:22px 28px;background:#111;color:#fff;border-radius:12px;margin-bottom:24px;width:fit-content;min-width:260px;box-sizing:border-box;';
    counter.innerHTML = 
        '<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;flex-shrink:0;box-shadow:0 0 0 0 rgba(34,197,94,0.7);animation:onlinePulse 2s infinite;"></div>' +
        '<div style="font-size:44px;line-height:1;font-weight:700;font-family:Georgia,serif;color:#fff;"><span id="online-now">—</span></div>' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#bbb;">сейчас онлайн</div>';
    
    section.insertBefore(counter, section.firstChild);
    
    if (!document.getElementById('online-keyframes')) {
        var st = document.createElement('style');
        st.id = 'online-keyframes';
        st.textContent = '@keyframes onlinePulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,0.7)}70%{box-shadow:0 0 0 14px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}';
        document.head.appendChild(st);
    }
}
window.injectOnlineCounter = injectOnlineCounter;

function forceShowAdmin() {
    var ids = ['admin-view'];
    ids.forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.style.setProperty('display', 'block', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
        el.style.setProperty('opacity', '1', 'important');
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('position', 'relative', 'important');
    });
    // Родители admin-view
    var av = document.getElementById('admin-view');
    if (av) {
        var p = av.parentElement;
        while (p && p !== document.body) {
            p.style.setProperty('display', 'block', 'important');
            p.style.setProperty('visibility', 'visible', 'important');
            p.style.setProperty('height', 'auto', 'important');
            p.style.setProperty('max-height', 'none', 'important');
            p.style.setProperty('overflow', 'visible', 'important');
            p = p.parentElement;
        }
    }
}
window.forceShowAdmin = forceShowAdmin;



async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"?')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) { toast(e.message || 'Ошибка', 'error'); }
}
window.__counterTimer = setInterval(function() {
    var s = document.getElementById('admin-users');
    if (s && s.classList.contains('active')) {
        try {
            api('/api/online/current').then(function(r) {
                var el = document.getElementById('online-now');
                if (el) el.textContent = (r && r.online != null) ? r.online : 0;
            });
        } catch(e) {}
    }
}, 15000);




async function loadOnlineCount() {
    try {
        var r = await api('/api/online/current');
        var el = document.getElementById('online-now');
        if (el) el.textContent = (r && r.online != null) ? r.online : 0;
    } catch(e) {}
}
window.loadOnlineCount = loadOnlineCount;



async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"?')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) { toast(e.message || 'Ошибка', 'error'); }
}


async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"?')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) { toast(e.message || 'Ошибка', 'error'); }
}


async function loadAdminUsers() {
    var section = document.getElementById('admin-users');
    if (!section) return;
    
    // Удаляем старые счётчики
    var olds = document.querySelectorAll('#online-counter-block, .online-counter-block, [id^="online-counter"]');
    for (var k = 0; k < olds.length; k++) olds[k].remove();
    
    // Создаём счётчик
    var counter = document.createElement('div');
    counter.id = 'online-counter-block';
    counter.style.cssText = 'display:flex;align-items:center;gap:16px;padding:20px 26px;background:#111;color:#fff;border-radius:12px;margin-bottom:24px;width:fit-content;min-width:240px;box-sizing:border-box;';
    counter.innerHTML = 
        '<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;flex-shrink:0;animation:onlinePulse 2s infinite;"></div>' +
        '<div style="font-size:42px;line-height:1;font-weight:700;font-family:Georgia,serif;color:#fff;"><span class="online-value" id="online-value-active">—</span></div>' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#bbb;">сейчас онлайн</div>';
    
    // Единый блок: счётчик + график
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:0;margin-bottom:28px;background:#fff;border:1px solid #ececec;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.04);';
    
    // ЛЕВАЯ ЧАСТЬ — счётчик (тёмная)
    counter.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:28px 32px;background:#111;color:#fff;flex-shrink:0;min-width:200px;';
    counter.innerHTML = 
        '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:12px;height:12px;border-radius:50%;background:#22c55e;flex-shrink:0;animation:onlinePulse 2s infinite;"></div>' +
            '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1.8px;color:#bbb;">онлайн</div>' +
        '</div>' +
        '<div style="font-size:56px;line-height:1;font-weight:700;font-family:Georgia,serif;color:#fff;"><span class="online-value" id="online-value-active">—</span></div>' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#888;">сейчас</div>';
    wrapper.appendChild(counter);
    
    // ПРАВАЯ ЧАСТЬ — график
    var chartBox = document.createElement('div');
    chartBox.style.cssText = 'flex:1;padding:20px 24px 12px;box-sizing:border-box;min-width:0;background:#fafafa;';
    chartBox.innerHTML = 
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;">' +
            '<h3 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:15px;color:#111;letter-spacing:0.5px;">Активность за сутки</h3>' +
            '<select id="online-date-select" style="padding:7px 30px 7px 12px;border:1px solid #e0e0e0;background:#fff;font-size:12px;font-family:inherit;border-radius:8px;cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23111\' stroke-width=\'2\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e&quot;);background-repeat:no-repeat;background-position:right 10px center;"></select>' +
        '</div>' +
        '<canvas id="online-chart"></canvas>';
    wrapper.appendChild(chartBox);
    
    var table = section.querySelector('table');
    if (table) section.insertBefore(wrapper, table);
    else section.insertBefore(counter, section.firstChild);
    
    if (!document.getElementById('online-keyframes')) {
        var st = document.createElement('style');
        st.id = 'online-keyframes';
        st.textContent = '@keyframes onlinePulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,0.7)}70%{box-shadow:0 0 0 14px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}';
        document.head.appendChild(st);
    }
    
    // Сначала ping, потом запрос
    try {
        if (vampAnalyticsAllowed() && window.__sessionId) await fetch('/api/online/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: window.__sessionId || localStorage.getItem('vamp_session_id') })
        });
    } catch(e) {}
    
    // Запрашиваем и обновляем
    try {
        var r = await api('/api/online/current');
        var val = (r && r.online != null) ? r.online : 0;
        updateAllCounters(val);
    } catch(e) {}
    
    // Загружаем график
    try {
        await loadOnlineDates();
        setTimeout(drawOnlineChart, 100);
    } catch(e) {}
    
    // Заголовок таблицы
    var thead = section.querySelector('table thead tr');
    if (thead && thead.children.length === 5) {
        var th = document.createElement('th');
        th.textContent = 'Действия';
        thead.appendChild(th);
    }
    
    // Пользователи
    var tbody = document.getElementById('admin-users-body');
    if (!tbody) return;
    var users = [];
    try { users = await api('/api/users'); }
    catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">Ошибка: ' + esc(e.message || '') + '</td></tr>';
        return;
    }
    if (!users || !users.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">Пользователей нет</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(function(u) {
        var canDelete = u.role !== 'admin';
        var btn = canDelete
            ? '<button onclick="deleteUser(' + Number(u.id) + ', ' + jsArg(u.name || '') + ')" style="background:#8b0000;color:#fff;border:0;padding:8px 14px;font-size:11px;text-transform:uppercase;letter-spacing:1px;cursor:pointer;">Удалить</button>'
            : '<span style="color:#ccc;font-size:12px;">—</span>';
        return '<tr>' +
            '<td>' + u.id + '</td>' +
            '<td>' + esc(u.name || '—') + '</td>' +
            '<td>' + esc(u.email || u.login || '—') + '</td>' +
            '<td>' + esc(u.role || 'user') + '</td>' +
            '<td>' + (u.created_at ? esc(u.created_at.slice(0, 10)) : '—') + '</td>' +
            '<td>' + btn + '</td>' +
            '</tr>';
    }).join('');
}

async function deleteUser(id, name) {
    if (!confirm('Удалить пользователя "' + name + '"?')) return;
    try {
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (e) { toast(e.message || 'Ошибка', 'error'); }
}

async function drawOnlineChart(date) {
    var canvas = document.getElementById('online-chart');
    if (!canvas) { console.log('[chart] canvas НЕ найден, создаю...'); return; }
    var sel = document.getElementById('online-date-select');
    if (!date && sel) date = sel.value;
    var data = [];
    try {
        var r = await api('/api/online/history' + (date ? '?date=' + encodeURIComponent(date) : ''));
        data = r.data || [];
        console.log('[chart] точек:', data.length, '| дата:', date);
    } catch(e) { console.log('[chart] API error:', e.message); }
    
    var parent = canvas.parentNode;
    var W = parent ? parent.clientWidth - 20 : 600;
    if (W < 200) W = 600;
    var H = 220;
    console.log('[chart] размеры:', W, 'x', H);
    
    var dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    
    var padL = 38, padR = 15, padT = 20, padB = 30;
    var cw = W - padL - padR;
    var ch = H - padT - padB;
    var maxVal = 1;
    for (var i = 0; i < data.length; i++) if (data[i].max > maxVal) maxVal = data[i].max;
    maxVal = Math.ceil(maxVal * 1.2) || 5;
    
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    for (var g = 0; g <= 4; g++) {
        var y = padT + ch - (ch * g / 4);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + cw, y);
        ctx.stroke();
        ctx.fillStyle = '#bbb';
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.round(maxVal * g / 4)), padL - 5, y + 3);
    }
    ctx.fillStyle = '#bbb';
    ctx.textAlign = 'center';
    for (var h = 0; h <= 23; h += 4) {
        var x = padL + (cw * h / 23);
        ctx.fillText(h + ':00', x, padT + ch + 16);
    }
    if (!data.length) {
        ctx.fillStyle = '#999';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Данных пока нет', W / 2, H / 2);
        return;
    }
    function getY(v) { return padT + ch - (ch * v / maxVal); }
    function getX(i) { return padL + (cw * i / Math.max(1, data.length - 1)); }
    ctx.beginPath();
    ctx.moveTo(padL, padT + ch);
    for (var i = 0; i < data.length; i++) ctx.lineTo(getX(i), getY(data[i].max));
    ctx.lineTo(padL + cw, padT + ch);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
    grad.addColorStop(0, 'rgba(139,0,0,0.28)');
    grad.addColorStop(1, 'rgba(139,0,0,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
        if (i === 0) ctx.moveTo(getX(i), getY(data[i].max));
        else ctx.lineTo(getX(i), getY(data[i].max));
    }
    ctx.strokeStyle = '#8b0000';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (var i = 0; i < data.length; i++) {
        if (data[i].max > 0) {
            ctx.beginPath();
            ctx.arc(getX(i), getY(data[i].max), 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#8b0000';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }
}
window.drawOnlineChart = drawOnlineChart;

async function loadOnlineDates() {
    var sel = document.getElementById('online-date-select');
    if (!sel) return;
    try {
        var dates = await api('/api/online/dates');
        var today = new Date().toISOString().slice(0, 10);
        if (!dates || !dates.length) dates = [today];
        if (dates.indexOf(today) === -1) dates.unshift(today);
        sel.innerHTML = dates.map(function(d) {
            var p = d.split('-');
            return '<option value="' + esc(d) + '">' + esc(p[2]) + '.' + esc(p[1]) + '.' + esc(p[0]) + (d === today ? ' (сегодня)' : '') + '</option>';
        }).join('');
        sel.onchange = function() { drawOnlineChart(sel.value); };
    } catch(e) {}
}
window.loadOnlineDates = loadOnlineDates;

// ===== ADMIN TOGGLES: делегирование на document =====
(function() {
    console.log('[toggles] init');
    
    function handleChange(id, checked) {
        console.log('[toggles] change:', id, '=>', checked);
        try {
            if (id === 'reserve-toggle') {
                if (typeof toggleReserve === 'function') toggleReserve(checked);
                else console.error('[toggles] toggleReserve не найден');
            } else if (id === 'registration-toggle') {
                if (typeof toggleRegistration === 'function') toggleRegistration(checked);
                else console.error('[toggles] toggleRegistration не найден');
            } else if (id === 'payment-cash-toggle') {
                if (typeof togglePaymentMethod === 'function') togglePaymentMethod('cash', checked);
                else console.error('[toggles] togglePaymentMethod не найден');
            } else if (id === 'payment-online-toggle') {
                if (typeof togglePaymentMethod === 'function') togglePaymentMethod('online', checked);
                else console.error('[toggles] togglePaymentMethod не найден');
            }
        } catch(e) {
            console.error('[toggles] handler error:', e.message, e);
        }
    }
    
    // Capture phase — сработает раньше inline onchange
    document.addEventListener('change', function(e) {
        var id = e.target && e.target.id;
        if (!id) return;
        handleChange(id, e.target.checked);
    }, true);
    
    // Click — на случай, если change не срабатывает
    document.addEventListener('click', function(e) {
        var el = e.target;
        while (el && el !== document.body) {
            if (el.id && el.id.indexOf('toggle') > -1 && el.tagName === 'INPUT') {
                console.log('[toggles] clicked:', el.id);
                return;
            }
            el = el.parentElement;
        }
    }, true);
})();

// ===== SSE для админ-заказов (ТОЛЬКО АДМИН) =====
function initAdminOrdersSSE() {
    // Проверяем, админ ли текущий пользователь
    var isAdmin = window.__isAdmin === true;
    if (!isAdmin && window.CURRENT_USER) {
        isAdmin = window.CURRENT_USER.role === 'admin';
    }
    if (!isAdmin) {
        console.log('[sse-orders] не админ — не подключаюсь');
        return;
    }
    if (!window.EventSource) return;
    try {
        var es = authenticatedStream('/api/orders/stream');
        es.onmessage = function(e) {
            try {
                var data = JSON.parse(e.data);
                if (data.type === 'new_order') {
                    if (typeof toast === 'function') toast('🔔 Новый заказ №' + data.order_id, 'success');
                    if (typeof loadAdminOrders === 'function') loadAdminOrders();
                }
            } catch (err) {}
        };
        es.onerror = function() {};
        console.log('[sse-orders] подключён (админ)');
    } catch (e) {
        console.log('[sse-orders] error:', e.message);
    }
}

// Перезапускаем при логине/логауте
function restartAdminSSE() {
    if (window.__isAdmin === true || (window.CURRENT_USER && window.CURRENT_USER.role === 'admin')) {
        initAdminOrdersSSE();
    }
}
window.restartAdminSSE = restartAdminSSE;

// Запускаем только если админ уже залогинен при загрузке
if (window.__isAdmin === true || (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.role === 'admin')) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAdminOrdersSSE);
    } else {
        initAdminOrdersSSE();
    }
} else {
    console.log('[sse-orders] пользователь не админ, SSE не запускаем');
}

// ===== Закрытие страницы "Заказ оформлен" =====


// Показ страницы успеха


// ===== SUCCESS PAGE — жёсткий фикс =====

// ===== SUCCESS: удаляем блок success-view из DOM =====
function removeSuccessBlock() {
    var sv = document.getElementById('success-view');
    if (sv && sv.parentNode) {
        console.log('[success] удаляю success-view');
        sv.parentNode.removeChild(sv);
    }
    document.body.classList.remove('success-active');
    document.body.style.removeProperty('overflow');
}
window.removeSuccessBlock = removeSuccessBlock;

// Удаляем при загрузке
setTimeout(removeSuccessBlock, 100);
setTimeout(removeSuccessBlock, 1000);

// ===== ADMIN CHAT MOBILE =====
(function() {
    function isMobile() { return window.innerWidth <= 768; }
    
    function hasChat() {
        try { return typeof adminActiveChatId !== 'undefined' && adminActiveChatId; }
        catch(e) { return false; }
    }
    
    function openRoom() {
        if (!isMobile() || !hasChat()) return;
        var room = document.getElementById('admin-chats-room');
        if (room) room.classList.add('mobile-active');
    }
    
    function closeRoom() {
        var room = document.getElementById('admin-chats-room');
        if (room) room.classList.remove('mobile-active');
    }
    window.closeAdminChatRoom = closeRoom;
    
    // Клик по диалогу → открыть комнату
    document.addEventListener('click', function(e) {
        var el = e.target;
        while (el && el !== document.body) {
            if (el.parentNode && el.parentNode.id === 'admin-chats-list-body') {
                if (isMobile()) setTimeout(function(){ if (hasChat()) openRoom(); }, 200);
                return;
            }
            if (el.classList && el.classList.contains('admin-chats-room__back-btn')) {
                e.preventDefault();
                closeRoom();
                return;
            }
            el = el.parentElement;
        }
    }, true);
    
    // Кнопка Назад
    function ensureBack() {
        if (!isMobile()) return;
        var head = document.querySelector('.admin-chats-room__head');
        if (!head || head.querySelector('.admin-chats-room__back-btn')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-chats-room__back-btn';
        btn.innerHTML = '←';
        btn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); closeRoom(); };
        head.insertBefore(btn, head.firstChild);
    }
    
    var obs = new MutationObserver(ensureBack);
    obs.observe(document.body, { childList: true, subtree: true });
    
    // Закрываем при смене вкладки
    var orig = window.switchAdminTab;
    if (typeof orig === 'function') {
        window.switchAdminTab = function(name, btn) {
            orig(name, btn);
            if (name === 'chats') closeRoom();
        };
    }
})();

// Use an Authorization header so login tokens do not enter URLs and access logs.
function authenticatedStream(url) {
    let closed = false, controller, timer;
    const stream = { onmessage: null, onerror: null, close() {
        closed = true; clearTimeout(timer); if (controller) controller.abort();
    }};
    async function connect() {
        controller = new AbortController();
        try {
            const response = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN }, signal: controller.signal, cache: 'no-store' });
            if (!response.ok) {
                if ([401,403,404].includes(response.status)) closed = true;
                throw new Error('Stream unavailable');
            }
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let pending = '';
            while (!closed) {
                const chunk = await reader.read();
                if (chunk.done) break;
                pending += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
                let index;
                while ((index = pending.indexOf('\n\n')) !== -1) {
                    const frame = pending.slice(0,index); pending = pending.slice(index+2);
                    const lines = frame.split('\n');
                    if (lines.some(line => line.startsWith('event:'))) continue;
                    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /,'')).join('\n');
                    if (data && stream.onmessage) stream.onmessage({data});
                }
            }
        } catch (error) { if (!closed && stream.onerror) stream.onerror(error); }
        if (!closed) timer = setTimeout(connect,3000);
    }
    connect(); return stream;
}

(function initStorageNotice() {
    function mount() {
        if(document.getElementById('vamp-storage-banner')) return;
        const style=document.createElement('style');
        style.textContent=`
        #vamp-storage-banner[hidden]{display:none!important}
        #vamp-storage-banner{position:fixed;bottom:0;left:0;right:0;z-index:10020;background:#fff;border-top:1px solid #e3e3e3;box-shadow:0 -4px 24px #0000000d;padding:20px 28px;display:flex;gap:22px;align-items:center;font-family:Arial,sans-serif;color:#555;box-sizing:border-box}
        #vamp-storage-banner p{margin:0;flex:1;font-size:14px;line-height:1.6}
        .vamp-storage-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
        .vamp-storage-button{font:600 12px Arial,sans-serif;padding:14px 18px;cursor:pointer;border:1px solid #777;background:#fff;color:#333;border-radius:4px;white-space:nowrap}
        .vamp-storage-button.primary{background:#8b0000;border-color:#8b0000;color:#fff}
        .vamp-storage-link{font:13px Arial,sans-serif;color:inherit;background:transparent;border:0;text-decoration:underline;cursor:pointer;padding:8px}
        body.vamp-storage-visible{padding-bottom:var(--vamp-storage-height,150px)}
        body.vamp-storage-visible #chat-widget{bottom:calc(var(--vamp-storage-height,150px) + 20px)!important}
        #vamp-storage-dialog{max-width:580px;width:calc(100% - 36px);padding:26px;border:1px solid #ddd;border-radius:10px;color:#333;box-sizing:border-box;font:14px/1.65 Arial,sans-serif}
        #vamp-storage-dialog::backdrop{background:#0008}
        #vamp-storage-dialog h2{font:24px Georgia,serif;margin:0 0 18px}
        #vamp-storage-dialog .vamp-storage-close{float:right;border:0;background:none;font-size:22px;cursor:pointer}
        #vamp-storage-dialog label{display:flex;align-items:flex-start;gap:10px;padding:16px;background:#f6f6f6;margin:16px 0}
        #vamp-storage-dialog input{margin-top:6px}
        @media(max-width:760px){#vamp-storage-banner{padding:16px;flex-direction:column;align-items:stretch;gap:12px}.vamp-storage-actions{justify-content:flex-end}.vamp-storage-button{padding:12px;font-size:11px}}
        `;
        document.head.appendChild(style);
        const banner=document.createElement('section');banner.id='vamp-storage-banner';
        banner.setAttribute('aria-label','Хранение данных в браузере');
        banner.innerHTML='<p>Сохраняем корзину, избранное и доступ к вашему чату в браузере (localStorage). С вашего согласия также считаем посещаемость сайта. Вы можете разрешить аналитику или оставить только необходимое хранение.</p><div class="vamp-storage-actions"><button type="button" class="vamp-storage-link" data-storage-action="details">Подробнее</button><button type="button" class="vamp-storage-button" data-storage-action="necessary">Только необходимые</button><button type="button" class="vamp-storage-button primary" data-storage-action="accept">Принять</button></div>';
        const dialog=document.createElement('dialog');dialog.id='vamp-storage-dialog';dialog.setAttribute('aria-labelledby','vamp-storage-title');
        dialog.innerHTML='<button type="button" class="vamp-storage-close" aria-label="Закрыть">×</button><h2 id="vamp-storage-title">Хранение данных в браузере</h2><p><strong>Для функций, которыми вы пользуетесь:</strong> сохраняются корзина, избранное, история поиска, ключ доступа к гостевому чату и, при входе, сессия аккаунта. Эти данные хранятся в localStorage, а не в файлах cookie. Выбор настроек сохраняется на 180 дней.</p><p>Гостевая переписка удаляется из рабочей базы через 30 дней после последнего сообщения. Проверка выполняется каждую минуту при работающем сервере. Очистка браузера удаляет ключ доступа к диалогу, но не запускает немедленное удаление сообщений на сервере. Резервные копии имеют отдельный срок хранения.</p><label><input type="checkbox" id="vamp-storage-analytics"><span><strong>Необязательная аналитика посещаемости</strong><br>Использует отдельный идентификатор браузера и отправляет на наш сервер сигналы присутствия. До вашего согласия она отключена. Рекламная рассылка этим выбором не разрешается.</span></label><p>Отключение аналитики не мешает каталогу, корзине или чату. Настройки можно изменить по ссылке в подвале сайта. При переходе в Telegram действуют также правила этого сервиса.</p><button type="button" class="vamp-storage-button primary" id="vamp-storage-save">Сохранить выбор</button>';
        document.body.append(banner,dialog);
        function resize(){document.documentElement.style.setProperty('--vamp-storage-height',banner.hidden?'0px':banner.getBoundingClientRect().height+'px');}
        function refresh(){banner.hidden=!!vampStorageChoice();document.body.classList.toggle('vamp-storage-visible',!banner.hidden);resize();}
        function showDetails(){document.getElementById('vamp-storage-analytics').checked=vampAnalyticsAllowed();dialog.showModal();}
        function save(analytics){
            try{localStorage.setItem('vamp_storage_choice',JSON.stringify({version:1,analytics,at:Date.now()}));}
            catch(_){alert('Браузер запретил сохранение настроек. Аналитика останется отключённой.');return;}
            window.dispatchEvent(new Event('vamp-storage-choice'));refresh();if(dialog.open)dialog.close();
        }
        banner.querySelector('[data-storage-action="details"]').addEventListener('click',showDetails);
        banner.querySelector('[data-storage-action="necessary"]').addEventListener('click',()=>save(false));
        banner.querySelector('[data-storage-action="accept"]').addEventListener('click',()=>save(true));
        dialog.querySelector('.vamp-storage-close').addEventListener('click',()=>dialog.close());
        dialog.querySelector('#vamp-storage-save').addEventListener('click',()=>save(dialog.querySelector('input').checked));
        const footer=document.querySelector('.footer-bottom-links')||document.querySelector('footer');
        if(footer){const settings=document.createElement('button');settings.type='button';settings.className='vamp-storage-link';settings.textContent='Настройки хранения данных';settings.addEventListener('click',showDetails);footer.appendChild(settings);}
        if(window.ResizeObserver)new ResizeObserver(resize).observe(banner);
        window.addEventListener('resize',resize);
        window.addEventListener('storage',e=>{if(e.key==='vamp_storage_choice')refresh();});
        refresh();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
