/* ============================================================
   VAMP SHMOT — Telegram-магазин
   ------------------------------------------------------------
   Отдельный процесс (запускать: node shop-bot.js).

   Как это устроено:
   - Каталог (товары, категории, бренды, контакты) читается
     НАПРЯМУЮ из database.db сайта в режиме read-only — это
     безопасно для конкурентного доступа (сайт продолжает писать
     в свою базу, бот только читает).
   - Заказы, регистрация и авторизация идут через REST API
     самого сайта (server.js) — там уже есть вся валидация,
     проверка остатков на складе и списание товара. Дублировать
     эту логику в боте было бы рискованно (легко разойтись с
     сайтом и получить рассинхронизацию склада).
   - Собственные данные бота (привязка chat_id к аккаунту сайта,
     корзины, список подписчиков для рассылки) хранятся в
     ОТДЕЛЬНОМ файле bot-data.db, чтобы не писать в базу сайта
     из второго процесса.
   ============================================================ */

const { TelegramBot } = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

/* ---- Загрузчик .env (как в server.js) ---- */
(function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const i = s.indexOf('=');
        if (i === -1) continue;
        const key = s.slice(0, i).trim();
        let val = s.slice(i + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
    }
})();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
function isAdmin(userId) {
    return ADMIN_IDS.includes(String(userId));
}
const SITE_URL = (process.env.SITE_BASE_URL || ('http://localhost:' + (process.env.PORT || 3000))).replace(/\/$/, '');
const DB_PATH = process.env.SITE_DB_PATH || path.join(__dirname, 'database.db');

if (!TOKEN) {
    console.error('[shop-bot] TELEGRAM_BOT_TOKEN не задан в .env — бот не запущен');
    process.exit(1);
}

/* ============================================================
   API САЙТА
   ------------------------------------------------------------
   Бот не открывает database.db напрямую. Весь каталог, остатки
   и бизнес-логика читаются через REST API сайта.
   ============================================================ */
async function apiFetch(pathName, opts = {}) {
    const r = await fetch(SITE_URL + pathName, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Ошибка сайта'), { status: r.status, data });
    return data;
}

async function listCategories() {
    return apiFetch('/api/categories');
}

function enrichLite(p) {
    p = { ...p };
    if (typeof p.images === 'string') {
        try { p.images = JSON.parse(p.images || '[]'); } catch (e) { p.images = []; }
    }
    if (!Array.isArray(p.images)) p.images = [];
    if (typeof p.sizes === 'string') {
        try { p.sizes = JSON.parse(p.sizes || '[]'); } catch (e) { p.sizes = []; }
    }
    if (!Array.isArray(p.sizes)) p.sizes = [];
    p.discount = p.discount || 0;
    p.final_price = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
    return p;
}

async function listProducts(categoryId) {
    const rows = await apiFetch('/api/products' + (categoryId ? '?category=' + encodeURIComponent(categoryId) : ''));
    return rows.map(enrichLite);
}

async function getProduct(id) {
    try { return enrichLite(await apiFetch('/api/products/' + id)); }
    catch (e) { if (e.status === 404) return null; throw e; }
}

/* ============================================================
   СОБСТВЕННАЯ БД БОТА
   ============================================================ */
const botDb = new DatabaseSync(path.join(__dirname, 'bot-data.db'));
botDb.exec(`
    CREATE TABLE IF NOT EXISTS bot_users (
        chat_id TEXT PRIMARY KEY,
        first_name TEXT,
        username TEXT,
        site_user_id INTEGER,
        site_email TEXT,
        site_password TEXT,
        token TEXT,
        phone TEXT,
        address TEXT,
        joined_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bot_carts (
        chat_id TEXT PRIMARY KEY,
        items TEXT DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now'))
    );
`);

function getBotUser(chatId) {
    return botDb.prepare('SELECT * FROM bot_users WHERE chat_id = ?').get(String(chatId));
}
function upsertBotUser(chatId, fields) {
    const existing = getBotUser(chatId);
    if (!existing) {
        botDb.prepare('INSERT INTO bot_users (chat_id, first_name, username) VALUES (?, ?, ?)')
             .run(String(chatId), fields.first_name || '', fields.username || '');
    }
    const keys = Object.keys(fields);
    if (keys.length) {
        const sql = 'UPDATE bot_users SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE chat_id = ?';
        botDb.prepare(sql).run(...keys.map(k => fields[k]), String(chatId));
    }
}

function getCart(chatId) {
    const row = botDb.prepare('SELECT items FROM bot_carts WHERE chat_id = ?').get(String(chatId));
    if (!row) return [];
    try { return JSON.parse(row.items || '[]'); } catch (e) { return []; }
}
function saveCart(chatId, items) {
    botDb.prepare(`INSERT INTO bot_carts (chat_id, items, updated_at) VALUES (?, ?, datetime('now'))
                   ON CONFLICT(chat_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`)
         .run(String(chatId), JSON.stringify(items));
}
function cartTotal(items) {
    return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}

/* ============================================================
   API САЙТА
   ============================================================ */

function genPassword() {
    const letters = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    let pass = '';
    for (let i = 0; i < 5; i++) pass += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i++) pass += digits[Math.floor(Math.random() * digits.length)];
    return pass;
}
function safeName(rawName) {
    let n = (rawName || '').replace(/[^А-Яа-яЁёA-Za-z\s\-]/g, '').trim();
    if (n.length < 2) n = 'Гость Telegram';
    return n.slice(0, 50);
}

/* Гарантирует, что у пользователя Telegram есть аккаунт на сайте + свежий JWT */
async function ensureSiteAccount(from) {
    const chatId = from.id;
    let u = getBotUser(chatId);
    if (u && u.token) return u;

    const name = safeName([from.first_name, from.last_name].filter(Boolean).join(' '));
    const email = 'tg' + chatId + '@vampshmot.bot';
    const password = genPassword();

    let auth;
    try {
        auth = await apiFetch('/api/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    } catch (e) {
        // email уже занят (например, бот раньше регистрировал этого пользователя,
        // а bot-data.db потеряли) — заводим новый email с уникальным суффиксом
        const email2 = 'tg' + chatId + '_' + Date.now() + '@vampshmot.bot';
        auth = await apiFetch('/api/register', { method: 'POST', body: JSON.stringify({ name, email: email2, password }) });
    }

    upsertBotUser(chatId, {
        first_name: from.first_name || '',
        username: from.username || '',
        site_user_id: auth.user.id,
        site_email: auth.user.email,
        site_password: password,
        token: auth.token
    });
    return getBotUser(chatId);
}

async function authHeader(from) {
    const u = await ensureSiteAccount(from);
    return { Authorization: 'Bearer ' + u.token };
}

/* ============================================================
   БОТ
   ============================================================ */
const bot = new TelegramBot(TOKEN, { polling: true });
console.log('[shop-bot] Запущен. API сайта: ' + SITE_URL + ', БД: ' + DB_PATH);

bot.on('polling_error', (e) => console.error('[shop-bot] polling_error:', e.message));

const PRIVACY_TEXT = `*Политика конфиденциальности*\n\n` +
    `Мы собираем минимальный объём данных:\n` +
    `• Имя и email — для оформления заказа.\n` +
    `• Телефон и адрес — для доставки.\n` +
    `• Данные не передаются третьим лицам, кроме службы доставки.\n\n` +
    `По вопросам удаления данных: напишите администратору.`;

function money(n) { return Math.round(n || 0).toLocaleString('ru-RU') + ' ₽'; }

function mainMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🛍 Каталог', callback_data: 'menu:catalog' }],
                [{ text: '🛒 Корзина', callback_data: 'menu:cart' }, { text: '📦 Мои заказы', callback_data: 'menu:orders' }],
                [{ text: '📞 Контакты', callback_data: 'menu:contacts' }, { text: '🔒 Политика', callback_data: 'menu:privacy' }]
            ]
        }
    };
}

/* ---- Состояние диалога оформления заказа (в памяти процесса) ---- */
const sessions = new Map();
const setSession = (chatId, s) => sessions.set(String(chatId), s);
const getSession = (chatId) => sessions.get(String(chatId));
const clearSession = (chatId) => sessions.delete(String(chatId));

/* ================= /start ================= */
bot.onText(/^\/start/, async (msg) => {
    const chatId = msg.chat.id;
    upsertBotUser(chatId, { first_name: msg.from.first_name || '', username: msg.from.username || '' });
    const name = msg.from.first_name || 'друг';

    const SITE = (process.env.SITE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const PUBLIC = 'http://94.198.216.213';

    // Берём первую (самую свежую) картинку со слайдера
    let photoUrl = SITE + '/img/vamp.png';
    try {
        const res = await fetch(SITE + '/api/slides?_=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
        const slides = await res.json();
        if (Array.isArray(slides) && slides.length && slides[0] && slides[0].img) {
            let img = slides[0].img;
            // Относительный путь (/uploads/x.jpg) → публичный http://94.198.216.213/uploads/x.jpg
            if (img.startsWith('/')) img = PUBLIC + img;
            // Если img с localhost — заменяем хост на публичный
            img = img.replace(/^https?:\/\/localhost(:\d+)?/i, PUBLIC);
            // Если это внешний http (не https) — Telegram может не скачать, но пробуем
            if (!/^https?:\/\//.test(img)) img = PUBLIC + '/img/vamp.png';
            const sep = img.includes('?') ? '&' : '?';
            photoUrl = img + sep + 't=' + Date.now();
        }
    } catch (e) { console.error('[bot] slides fetch error:', e.message); }

    const NL = String.fromCharCode(10);
    const caption = [
        '<b>◆ VAMP SHMOT</b>',
        '━━━━━━━━━━━━━━━━',
        '• Одежда от независимых дизайнеров',
        '➤ Доставка по Мариуполю',
        '',
        'Привет, ' + name + '! Выбирайте товары и оформляйте заказ прямо здесь, в Telegram.'
    ].join(NL);

    try {
        const cleanUrl = String(photoUrl).split('?')[0];
        const fileName = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
        const filePath = '/root/vampshmot/uploads/' + fileName;
        const source = fs.existsSync(filePath) ? fs.createReadStream(filePath) : photoUrl;
        await bot.sendPhoto(chatId, source, { caption, parse_mode: 'HTML', ...mainMenuKeyboard() }, { filename: 'banner.jpg', contentType: 'image/jpeg' });
    } catch (err) {
        console.error('[bot] sendPhoto error:', err.message, '| URL:', photoUrl);
        await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', ...mainMenuKeyboard() })
            .catch(e2 => console.error('[bot] fallback error:', e2.message));
    }
});


/* ================= Каталог ================= */

function catalogImagePath(image) {
    if (!image) return null;

    let rel = String(image).trim();
    if (!rel) return null;

    if (/^https?:\/\//i.test(rel)) {
        try {
            rel = new URL(rel).pathname;
        } catch (_) {
            return null;
        }
    }

    rel = rel.replace(/^\/+/, '');
    return path.join(__dirname, rel);
}

function productHasBadge(p, code) {
    return Array.isArray(p.badges) && p.badges.some(b => b && b.code === code);
}

function catalogProductCaption(p) {
    const category = p.category && p.category.name ? p.category.name : 'Без категории';
    const price = p.final_price != null ? p.final_price : p.price;
    return String(p.name || 'Товар') + '\nКатегория: ' + category + '\nЦена: ' + money(price);
}

async function sendCatalogProduct(chatId, p) {
    const hasSizes = Array.isArray(p.sizes) && p.sizes.length > 0;
    const buttons = [[{ text: '📋 Подробнее', callback_data: 'prod:' + p.id }]];
    buttons.push([{ text: hasSizes ? '📏 Выбрать размер' : '🛒 В корзину',
        callback_data: hasSizes ? 'prod:' + p.id : 'addcart:' + p.id + ':-' }]);
    // Photos are requested only when a customer opens the product details.
    return bot.sendMessage(chatId, catalogProductCaption(p), {
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: buttons }
    });
}

async function sendCatalog(chatId, messageId) {
    return sendProductList(chatId, null, 1, messageId);
}

async function sendCatalogCategories(chatId, messageId) {
    let cats;

    try {
        cats = await listCategories();
    } catch (e) {
        return bot.sendMessage(chatId, '⚠️ ' + e.message);
    }

    const buttons = [];

    for (let i = 0; i < cats.length; i += 2) {
        const row = [{
            text: cats[i].name,
            callback_data: 'cat:' + cats[i].id
        }];

        if (cats[i + 1]) {
            row.push({
                text: cats[i + 1].name,
                callback_data: 'cat:' + cats[i + 1].id
            });
        }

        buttons.push(row);
    }

    buttons.push([{ text: '🛍 Все товары', callback_data: 'menu:catalog' }]);
    buttons.push([{ text: '🔎 Поиск', callback_data: 'catalog:search' }]);
    buttons.push([{ text: '⬅️ Меню', callback_data: 'menu:main' }]);

    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    };

    const text = '📂 *КАТЕГОРИИ*';

    if (messageId) {
        try {
            return await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                ...opts
            });
        } catch (_) {}
    }

    return bot.sendMessage(chatId, text, opts);
}

const PAGE_SIZE = 10;
function compactCatalogText(value, limit) {
    const text = String(value == null ? '' : value).replace(/\s+/g,' ').trim();
    return text.length > limit ? text.slice(0,limit-1)+'…' : text;
}
async function sendProductList(chatId, categoryId, page, messageId) {
    let all;
    try { all = await listProducts(categoryId || null); }
    catch (e) { return bot.sendMessage(chatId,'Не удалось загрузить каталог. Попробуйте ещё раз.'); }
    const totalPages = Math.max(1,Math.ceil(all.length/PAGE_SIZE));
    page = Math.min(Math.max(1,Number.isSafeInteger(page) ? page : 1),totalPages);
    const slice = all.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    const heading = categoryId ? 'Товары категории' : 'Каталог — все товары';
    let text = heading + '\nВсего позиций: ' + all.length + ' · Страница ' + page + '/' + totalPages;
    const buttons = [];
    if (!slice.length) text += '\n\nПока нет товаров.';
    slice.forEach(p=>{
        const name=compactCatalogText(p.name || 'Товар',36);
        const category=compactCatalogText(p.category && p.category.name || 'Без категории',20);
        const price=money(p.final_price != null ? p.final_price : p.price);
        buttons.push([{text:name+' · '+category+' · '+price,callback_data:'prod:'+p.id}]);
    });
    const nav=[];
    if(page>1) nav.push({text:'⬅️',callback_data:'catpage:'+(categoryId||0)+':'+(page-1)});
    if(totalPages>1) nav.push({text:page+'/'+totalPages,callback_data:'noop'});
    if(page<totalPages) nav.push({text:'➡️',callback_data:'catpage:'+(categoryId||0)+':'+(page+1)});
    if(nav.length) buttons.push(nav);
    buttons.push([{text:'📂 Категории',callback_data:'catalog:categories'},{text:'🔎 Поиск',callback_data:'catalog:search'}]);
    buttons.push([{text:'🛒 Корзина',callback_data:'menu:cart'},{text:'⬅️ Меню',callback_data:'menu:main'}]);
    const opts={link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:buttons}};
    if(messageId) {
        try { return await bot.editMessageText(text,{chat_id:chatId,message_id:messageId,...opts}); }
        catch(e) { if(String(e.message||'').includes('message is not modified')) return; }
    }
    return bot.sendMessage(chatId,text,opts);
}

async function sendCatalogSearchResults(chatId, query) {
    let all;

    try {
        all = await listProducts(null);
    } catch (e) {
        return bot.sendMessage(chatId, '⚠️ ' + e.message);
    }

    const q = query.trim().toLowerCase();

    const found = all.filter(p => {
        const name = String(p.name || '').toLowerCase();
        const brand = p.brand && p.brand.name
            ? String(p.brand.name).toLowerCase()
            : '';
        const sku = String(p.sku || '').toLowerCase();

        return name.includes(q) || brand.includes(q) || sku.includes(q);
    });

    if (!found.length) {
        return bot.sendMessage(chatId,
            `🔎 По запросу «${query}» ничего не найдено.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔎 Новый поиск', callback_data: 'catalog:search' }],
                        [{ text: '🛍 В каталог', callback_data: 'menu:catalog' }]
                    ]
                }
            }
        );
    }

    await bot.sendMessage(chatId,
        `🔎 *Результаты поиска*\n\nЗапрос: \`${query}\`\nНайдено: ${found.length}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔎 Новый поиск', callback_data: 'catalog:search' }],
                    [{ text: '🛍 В каталог', callback_data: 'menu:catalog' }]
                ]
            }
        }
    );

    for (const p of found.slice(0, 10)) {
        await sendCatalogProduct(chatId, p);
    }
}

function productCaption(p) {
    const lines = [];
    lines.push('*' + (p.name || 'Товар') + '*');
    if (p.brand_name) lines.push('Бренд: ' + p.brand_name);
    if (p.price) {
        let priceLine = 'Цена: ' + p.price + ' ₽';
        if (p.old_price && p.old_price > p.price) priceLine += ' ~~' + p.old_price + ' ₽~~';
        if (p.discount) priceLine += ' (-' + p.discount + '%)';
        lines.push(priceLine);
    }
    if (p.description) {
        lines.push('');
        lines.push('📝 *Описание:*');
        lines.push(String(p.description).slice(0, 600));
    }
    try {
        const specs = typeof p.specs === 'string' ? JSON.parse(p.specs) : (p.specs || []);
        if (Array.isArray(specs) && specs.length) {
            lines.push('');
            lines.push('📋 *Характеристики:*');
            specs.forEach(s => {
                if (typeof s === 'string') lines.push('• ' + s);
                else if (s && s.name) lines.push('• ' + s.name + ': ' + (s.value || ''));
            });
        }
    } catch (e) {}
    if (p.sizes && p.sizes.length) {
        lines.push('');
        lines.push('📏 *Размеры:* ' + p.sizes.join(', '));
    }
    return lines.join('\n');
}

async function sendProductCard(chatId, productId) {
    const p = await getProduct(productId);
        if (!p) return bot.sendMessage(chatId, 'Товар не найден.');

    const sizeButtons = (p.sizes || []).map(s => ({ text: s, callback_data: `size:${p.id}:${s}` }));
    const rows = [];
    for (let i = 0; i < sizeButtons.length; i += 3) rows.push(sizeButtons.slice(i, i + 3));
    if (!rows.length) rows.push([{ text: '➕ В корзину', callback_data: `addcart:${p.id}:-` }]);
    rows.push([{ text: '🛒 Корзина', callback_data: 'menu:cart' }, { text: '⬅️ Назад', callback_data: 'menu:catalog' }]);

    const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
    const caption = productCaption(p);
    const images = (p.images || []).filter(Boolean);

    if (images.length > 1) {
        // Несколько фото: sendMediaGroup, потом отдельным сообщением кнопки
        const media = images.slice(0, 10).map((url, idx) => {
            const rel = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/^\//, '');
            const filePath = path.join(__dirname, rel);
            const mediaItem = { type: 'photo', caption: idx === 0 ? caption : undefined, parse_mode: idx === 0 ? 'Markdown' : undefined };
            if (fs.existsSync(filePath)) {
                mediaItem.media = fs.createReadStream(filePath);
                mediaItem.filename = 'photo' + idx + '.jpg';
            } else {
                mediaItem.media = url;
            }
            return mediaItem;
        });
        try {
            await bot.sendMediaGroup(chatId, media);
            await bot.sendMessage(chatId, 'Выберите размер или добавьте в корзину:', opts);
            return;
        } catch (e) {
            console.error('[bot] sendMediaGroup error:', e.message);
        }
    }

    const img = images[0];
    if (img) {
        const rel = img.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/^\//, '');
        const filePath = path.join(__dirname, rel);
        const photoSource = fs.existsSync(filePath) ? fs.createReadStream(filePath) : img;
        bot.sendPhoto(chatId, photoSource, { caption, ...opts }, { filename: 'photo.jpg', contentType: 'image/jpeg' })
            .catch(() => bot.sendMessage(chatId, caption, opts));
    } else {
        bot.sendMessage(chatId, caption, opts);
    }
}

/* ================= Корзина ================= */
async function addToCart(chatId, productId, size, qty) {
    const p = await getProduct(productId);
    if (!p) return bot.sendMessage(chatId, 'Товар не найден.');
    const cart = getCart(chatId);
    const existing = cart.find(it => it.id === productId && it.size === size);
    if (existing) existing.qty += qty;
    else cart.push({ id: p.id, name: p.name, price: p.final_price, size: size || null, qty, img: (p.images && p.images[0]) || '' });
    saveCart(chatId, cart);
    bot.sendMessage(chatId, `✅ Добавлено в корзину: ${p.name}${size ? ' (' + size + ')' : ''}`, {
        reply_markup: { inline_keyboard: [[{ text: '🛒 Перейти в корзину', callback_data: 'menu:cart' }, { text: '🛍 Продолжить покупки', callback_data: 'menu:catalog' }]] }
    });
}

function sendCart(chatId) {
    const cart = getCart(chatId);
    if (!cart.length) {
        return bot.sendMessage(chatId, 'Ваша корзина пуста.', { reply_markup: { inline_keyboard: [[{ text: '🛍 В каталог', callback_data: 'menu:catalog' }]] } });
    }
    let text = '🛒 *Ваша корзина:*\n\n';
    const rows = [];
    cart.forEach((it, i) => {
        text += `${i + 1}. ${it.name}${it.size ? ' (' + it.size + ')' : ''} — ${it.qty} × ${money(it.price)} = *${money(it.qty * it.price)}*\n`;
        rows.push([
            { text: '➖', callback_data: `cartqty:${i}:-1` },
            { text: String(it.qty), callback_data: 'noop' },
            { text: '➕', callback_data: `cartqty:${i}:1` },
            { text: '🗑', callback_data: `cartdel:${i}` }
        ]);
    });
    text += `\n*Итого: ${money(cartTotal(cart))}*`;
    const checkoutLink = telegramCartLink(cart);
    rows.push([{ text: '✅ Оформить заказ', ...(checkoutLink ? { url: checkoutLink } : { callback_data: 'checkout:start' }) }]);
    rows.push([{ text: '🛍 Продолжить покупки', callback_data: 'menu:catalog' }]);
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
}

function changeCartQty(chatId, idx, delta) {
    const cart = getCart(chatId);
    if (!cart[idx]) return;
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    saveCart(chatId, cart);
    sendCart(chatId);
}
function removeCartItem(chatId, idx) {
    const cart = getCart(chatId);
    cart.splice(idx, 1);
    saveCart(chatId, cart);
    sendCart(chatId);
}

/* ================= Оформление заказа ================= */
function telegramCartMessage(cart) {
    return 'Здравствуйте, хочу купить:\n\n' + cart.map(it =>
        '• ' + String(it.name || 'Товар') + (it.size ? ' — размер ' + String(it.size) : '') + ' — ' + String(it.qty) + ' шт.'
    ).join('\n');
}
function telegramCartLink(cart) {
    const text = telegramCartMessage(cart);
    const url = 'https://t.me/yulya_Lavrinenko?text=' + encodeURIComponent(text);
    return Array.from(text).length <= 3500 && url.length <= 8000 ? url : null;
}
async function startCheckout(chatId) {
    const cart = getCart(chatId);
    if (!cart.length) return bot.sendMessage(chatId,'Корзина пуста.');
    const session = getSession(chatId);
    if (session && ['phone','address','comment','confirm'].includes(session.step)) clearSession(chatId);
    const url = telegramCartLink(cart);
    if (url) return bot.sendMessage(chatId,'Нажмите кнопку, чтобы открыть чат продавца с готовым списком товаров. В Telegram останется нажать «Отправить».',{
        reply_markup:{inline_keyboard:[[{text:'Оформить заказ в Telegram',url}]]}
    });
    // Long baskets must not be silently cut off by Telegram's link/message limits.
    const text = telegramCartMessage(cart), chunks=[];
    let chunk='';
    for (const char of text) { chunk+=char; if(chunk.length>=3000){chunks.push(chunk);chunk='';} }
    if(chunk) chunks.push(chunk);
    await bot.sendMessage(chatId,'Список слишком длинный для ссылки. Перешлите продавцу следующие сообщения со списком товаров.');
    for(const part of chunks) await bot.sendMessage(chatId,part);
    return bot.sendMessage(chatId,'Чат продавца:',{reply_markup:{inline_keyboard:[[{text:'Открыть продавца',url:'https://t.me/yulya_Lavrinenko'}]]}});
}
async function chooseCheckoutMethod(chatId) { return startCheckout(chatId); }

/* ================= Мои заказы / Контакты ================= */
async function sendMyOrders(chatId, from) {
    try {
        const headers = await authHeader(from);
        const orders = await apiFetch('/api/orders/my', { headers });
        if (!orders.length) return bot.sendMessage(chatId, 'У вас пока нет заказов.', mainMenuKeyboard());
        const statusLabels = { new: 'Новый', processing: 'В обработке', reserved: 'Резерв', done: 'Выполнен', cancelled: 'Отменён' };
        let text = '📦 *Ваши последние заказы:*\n\n';
        orders.slice(0, 10).forEach(o => {
            text += `№${o.id} от ${(o.created_at || '').replace('T', ' ').slice(0, 16)}\n`;
            text += `Статус: ${statusLabels[o.status] || o.status} · Сумма: ${money(o.total)}\n\n`;
        });
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, '⚠️ Не удалось загрузить заказы: ' + e.message);
    }
}

async function sendContacts(chatId) {
    try {
        const c = await apiFetch('/api/contacts');
        let text = '📞 *Контакты VAMP SHMOT*\n\n';
        if (c.phone) text += `Телефон: ${c.phone}\n`;
        if (c.email) text += `Email: ${c.email}\n`;
        if (c.address) text += `Адрес: ${c.address}\n`;
        if (c.work_hours) text += `Часы работы: ${c.work_hours}\n`;
        if (c.instagram) text += `Instagram: ${c.instagram}\n`;
        if (c.telegram) text += `Telegram: ${c.telegram}\n`;
        if (c.whatsapp) text += `WhatsApp: ${c.whatsapp}\n`;
        bot.sendMessage(chatId, text || 'Контакты пока не заполнены.', { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, 'Не удалось загрузить контакты.');
    }
}

/* ================= Callback-кнопки ================= */
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data || '';
    bot.answerCallbackQuery(query.id).catch(() => {});

    try {
        if (data === 'noop') return;
        if (data === 'menu:main') return bot.sendMessage(chatId, 'Главное меню:', mainMenuKeyboard());
        if (data === 'menu:catalog') return sendCatalog(chatId, messageId);
        if (data === 'catalog:categories') return sendCatalogCategories(chatId, messageId);
        if (data === 'catalog:search') {
            setSession(chatId, { type: 'catalog_search', step: 'query' });
            return bot.sendMessage(chatId, '🔎 Введите название товара, бренд или артикул:');
        }
        if (data === 'menu:privacy') return bot.sendMessage(chatId, PRIVACY_TEXT, { parse_mode: 'Markdown' });
        if (data === 'menu:contacts') return sendContacts(chatId);
        if (data === 'menu:orders') return sendMyOrders(chatId, query.from);
        if (data === 'menu:cart') return sendCart(chatId);

        if (data.startsWith('cat:')) return sendProductList(chatId, parseInt(data.split(':')[1], 10) || null, 1, messageId);
        if (data.startsWith('catpage:')) {
            const [, catId, page] = data.split(':');
            return sendProductList(chatId, parseInt(catId, 10) || null, parseInt(page, 10), messageId);
        }
        if (data.startsWith('prod:')) return sendProductCard(chatId, parseInt(data.split(':')[1], 10));
        if (data.startsWith('size:')) {
            const [, id, size] = data.split(':');
            return addToCart(chatId, parseInt(id, 10), size, 1);
        }
        if (data.startsWith('addcart:')) {
            const [, id, size] = data.split(':');
            return addToCart(chatId, parseInt(id, 10), size === '-' ? null : size, 1);
        }
        if (data.startsWith('cartqty:')) {
            const [, idx, delta] = data.split(':');
            return changeCartQty(chatId, parseInt(idx, 10), parseInt(delta, 10));
        }
        if (data.startsWith('cartdel:')) return removeCartItem(chatId, parseInt(data.split(':')[1], 10));

        if (data === 'checkout:start') return startCheckout(chatId);
        if (data === 'cart:clear') { saveCart(chatId, []); return bot.sendMessage(chatId, '🗑 Корзина очищена.', mainMenuKeyboard()); }
        if (data === 'checkout:cash') return chooseCheckoutMethod(chatId, query.from, 'cash');
        if (data === 'checkout:online') return chooseCheckoutMethod(chatId, query.from, 'online');
        if (data === 'checkout:cancel') {
            clearSession(chatId);
            return bot.sendMessage(chatId, 'Оформление отменено.', mainMenuKeyboard());
        }
    } catch (e) {
        console.error('[shop-bot] callback error:', e.message);
        bot.sendMessage(chatId, '⚠️ Произошла ошибка: ' + e.message);
    }
});

/* ================= Текстовые сообщения (диалог оформления заказа) ================= */
bot.on('message', (msg) => {
    if (!msg.text) return;
    const chatId = msg.chat.id;
    upsertBotUser(chatId, { first_name: msg.from.first_name || '', username: msg.from.username || '' });

    if (msg.text.startsWith('/')) return; // команды — отдельно

    const session = getSession(chatId);

    if (session && session.type === 'catalog_search' && session.step === 'query') {
        clearSession(chatId);
        return sendCatalogSearchResults(chatId, msg.text);
    }

    if (!session) return;

    if (['phone','address','comment','confirm'].includes(session.step)) return startCheckout(chatId);

});

/* ================= /broadcast (только для админа) ================= */
bot.onText(/^\/broadcast(?:\s+(.+))?$/, (msg, match) => {
    if (!isAdmin(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, '❌ У вас нет прав для рассылки.');
    }
    const inlineText = match[1];
    if (inlineText) {
        // Быстрый режим: /broadcast текст — без фото
        clearSession(msg.chat.id);
        const users = botDb.prepare('SELECT chat_id FROM bot_users').all();
        users.forEach((u, i) => {
            setTimeout(() => { bot.sendMessage(u.chat_id, inlineText, { parse_mode: 'Markdown' }).catch(() => {}); }, i * 60);
        });
        return bot.sendMessage(msg.chat.id, '✅ Рассылка запущена для ' + users.length + ' пользователей (без фото).');
    }
    // Пошаговый режим: ждём фото
    setSession(msg.chat.id, { type: 'broadcast', step: 'photo' });
    bot.sendMessage(msg.chat.id, '📢 Отправьте фото для рассылки (или /skip, чтобы без фото).');
});

// Обработка фото для рассылки
bot.on('photo', (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(msg.from.id)) return;
    const session = getSession(chatId);
    if (!session || session.type !== 'broadcast' || session.step !== 'photo') return;
    const photo = msg.photo[msg.photo.length - 1];
    session.photo = photo.file_id;
    session.step = 'text';
    setSession(chatId, session);
    bot.sendMessage(chatId, '✅ Фото сохранено. Теперь отправьте текст рассылки (или /skip для рассылки без текста).');
});


/* ===== Обработка текста рассылки ===== */
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (!msg.text) return;
    if (!isAdmin(msg.from.id)) return;
    const session = getSession(chatId);
    if (!session || session.type !== 'broadcast' || session.step !== 'text') return;

    const text = msg.text === '/skip' ? '' : msg.text;
    const photoId = session.photo || null;
    clearSession(chatId);

    const users = botDb.prepare('SELECT chat_id FROM bot_users').all();
    users.forEach((u, i) => {
        setTimeout(() => {
            if (photoId) {
                bot.sendPhoto(u.chat_id, photoId, { caption: text || undefined, parse_mode: 'Markdown' }).catch(() => {});
            } else if (text) {
                bot.sendMessage(u.chat_id, text, { parse_mode: 'Markdown' }).catch(() => {});
            }
        }, i * 60);
    });
    bot.sendMessage(chatId, '✅ Рассылка запущена для ' + users.length + ' пользователей' + (photoId ? ' (с фото)' : '') + '.');
});

module.exports = bot;
