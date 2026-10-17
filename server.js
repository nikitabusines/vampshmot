require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('node:crypto');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

/* Загрузчик .env */
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

/* Telegram-бот теперь отдельный процесс — см. shop-bot.js (запускать: node shop-bot.js).
   Раньше здесь был require('./bot'), но старый bot.js оставлен только для истории —
   если запустить его вместе с shop-bot.js на одном TELEGRAM_BOT_TOKEN, Telegram
   вернёт ошибку конфликта поллинга (409). */

const app = express();
function generateSku(name, categoryId) {
    // префикс: 2-4 буквы из категории или из названия
    let prefix = 'VAMP';
    try {
        if (categoryId) {
            const c = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId);
            if (c && c.name) {
                prefix = c.name.replace(/[^A-Za-zА-Яа-я]/g, '').slice(0,3).toUpperCase();
                if (!prefix) prefix = 'VAMP';
            }
        }
    } catch(e){}
    // номер: последний sku с таким префиксом + 1
    let n = 1;
    try {
        const last = db.prepare("SELECT sku FROM products WHERE sku LIKE ? ORDER BY id DESC LIMIT 1").get(prefix + '-%');
        if (last && last.sku) {
            const m = last.sku.match(/-(\d+)$/);
            if (m) n = parseInt(m[1], 10) + 1;
        } else {
            n = db.prepare('SELECT COUNT(*) as c FROM products').get().c + 1;
        }
    } catch(e){}
    return prefix + '-' + String(n).padStart(4, '0');
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'vamp-shmot-secret-change-me' || Buffer.byteLength(JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET must be a private random secret of at least 32 bytes');
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || '1276689';
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
if (!process.env.JWT_SECRET) {
    console.warn('ВНИМАНИЕ: используется секрет по умолчанию. Задайте JWT_SECRET в .env для продакшена.');
}

const db = new DatabaseSync(path.join(__dirname, 'database.db'));
// WAL — нужен, чтобы shop-bot.js мог параллельно читать database.db, пока сайт в неё пишет
try { db.exec('PRAGMA journal_mode = WAL'); } catch (e) { console.error('WAL:', e.message); }

/* ============================================================
   Валидация полей (бэкенд)
   ============================================================ */
function isValidEmail(v) {
    if (!v || typeof v !== 'string') return false;
    v = v.trim();
    if (v.length < 5 || v.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function isValidPhoneRU(v) {
    if (!v || typeof v !== 'string') return false;
    const digits = v.replace(/\D/g, '');
    // 11 цифр: 7XXXXXXXXXX или 8XXXXXXXXXX, либо 10 цифр (без 7/8)
    if (digits.length === 11) {
        return (digits[0] === '7' || digits[0] === '8') && /^[78]\d{10}$/.test(digits);
    }
    if (digits.length === 10) {
        return /^\d{10}$/.test(digits);
    }
    return false;
}

function isValidName(v) {
    if (!v || typeof v !== 'string') return false;
    v = v.trim();
    if (v.length < 2 || v.length > 50) return false;
    return /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s\-]{1,49}$/.test(v);
}

function isValidPassword(v) {
    if (!v || typeof v !== 'string') return false;
    if (v.length < 6) return false;
    const latin = (v.match(/[A-Za-z]/g) || []).length;
    const digits = (v.match(/\d/g) || []).length;
    return latin >= 4 && digits >= 2;
}

function isValidAddress(v) {
    if (!v || typeof v !== 'string') return false;
    return v.trim().length >= 1;
}

// === MIGRATIONS: sku + specs (auto) ===
try { db.exec('ALTER TABLE products ADD COLUMN sku TEXT'); } catch(e){}
try { db.exec("ALTER TABLE products ADD COLUMN specs TEXT DEFAULT '[]'"); } catch(e){}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku)'); } catch(e){}

/* ============================================================
   ТАБЛИЦЫ
   ============================================================ */
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        logo TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        description TEXT,
        sizes TEXT DEFAULT '[]',
        images TEXT DEFAULT '[]',
        brand_id INTEGER,
        category_id INTEGER,
        discount INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        icon TEXT DEFAULT '',
        color TEXT DEFAULT '#111111',
        text_color TEXT DEFAULT '#ffffff',
        auto INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_badges (
        product_id INTEGER NOT NULL,
        badge_id INTEGER NOT NULL,
        PRIMARY KEY (product_id, badge_id)
    );
    CREATE TABLE IF NOT EXISTS slides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        img TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        customer_name TEXT,
        phone TEXT,
        address TEXT,
        comment TEXT,
        items TEXT,
        total INTEGER,
        status TEXT DEFAULT 'new',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT NOT NULL,
        rating INTEGER DEFAULT 5,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        user_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_message_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        sender_role TEXT DEFAULT 'user',
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        phone TEXT,
        email TEXT,
        address TEXT,
        instagram TEXT,
        telegram TEXT,
        whatsapp TEXT,
        work_hours TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

/* ============================================================
   МИГРАЦИИ
   ============================================================ */
try {
    const cols = db.prepare("PRAGMA table_info(products)").all();
    const names = cols.map(c => c.name);
    if (!names.includes('brand_id')) {
        db.exec('ALTER TABLE products ADD COLUMN brand_id INTEGER');
        console.log('Миграция: +brand_id');
    }
    if (!names.includes('category_id')) {
        db.exec('ALTER TABLE products ADD COLUMN category_id INTEGER');
        console.log('Миграция: +category_id');
    }
    if (!names.includes('discount')) {
        db.exec('ALTER TABLE products ADD COLUMN discount INTEGER DEFAULT 0');
        console.log('Миграция: +discount');
    }
    if (!names.includes('stock')) {
        db.exec('ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0');
        console.log('Миграция: +stock');
    }
    if (!names.includes('stock_status')) {
        db.exec("ALTER TABLE products ADD COLUMN stock_status TEXT DEFAULT 'in_stock'");
        console.log('Миграция: +stock_status');
    }
    if (!names.includes('stock_by_size')) {
        db.exec("ALTER TABLE products ADD COLUMN stock_by_size TEXT DEFAULT '{}'");
        console.log('Миграция: +stock_by_size');
    }
} catch (e) { console.error(e); }

try {
    const ocols = db.prepare("PRAGMA table_info(orders)").all();
    const onames = ocols.map(c => c.name);
    const orderMigrations = [
        ['payment_method', "ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cash'"],
        ['payment_status', "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid'"],
        ['payment_id', "ALTER TABLE orders ADD COLUMN payment_id TEXT"],
        ['is_reserved', "ALTER TABLE orders ADD COLUMN is_reserved INTEGER DEFAULT 0"],
        ['stock_eta', "ALTER TABLE orders ADD COLUMN stock_eta TEXT"],
        ['paid', "ALTER TABLE orders ADD COLUMN paid INTEGER DEFAULT 0"],
        ['stock_decremented', "ALTER TABLE orders ADD COLUMN stock_decremented INTEGER DEFAULT 0"]
    ];
    for (const [col, sql] of orderMigrations) {
        if (!onames.includes(col)) {
            db.exec(sql);
            console.log('Миграция: orders +' + col);
        }
    }
} catch (e) { console.error(e); }

/* ============================================================
   НАЧАЛЬНЫЕ ДАННЫЕ
   ============================================================ */
{
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin');
    if (!admin) {
        const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
        db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
          .run('Администратор', 'admin', hash, 'admin');
        console.log('Админ: admin / ' + ADMIN_PASSWORD);
    }
}

/* Категории */
{
    const count = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
    if (count === 0) {
        const insert = db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)');
        const cats = [
            ['Верхняя одежда', 'verhnyaya-odezhda', 1],
            ['Толстовки', 'tolstovki', 2],
            ['Кофты', 'kofty', 3],
            ['Рубашки', 'rubashki', 4],
            ['Футболки', 'futbolki', 5],
            ['Топы', 'topy', 6],
            ['Костюмы', 'kostyumy', 7],
            ['Штаны', 'shtany', 8],
            ['Шорты', 'shorty', 9],
            ['Аксессуары', 'aksessuary', 10]
        ];
        for (const c of cats) insert.run(c[0], c[1], c[2]);
        console.log('Добавлены категории');
    }
}

/* Бренды */
{
    const count = db.prepare('SELECT COUNT(*) as c FROM brands').get().c;
    if (count === 0) {
        const insert = db.prepare('INSERT INTO brands (name, description, logo) VALUES (?, ?, ?)');
        insert.run('Vamp Shmot', 'Собственный бренд магазина', '');
        insert.run('Noir Atelier', 'Петербургский бренд кожаных изделий', '');
        insert.run('Moscow Dark', 'Московский бренд альтернативной одежды', '');
        console.log('Добавлены бренды');
    }
}

/* Товары */
{
    const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    if (count === 0) {
        const insert = db.prepare('INSERT INTO products (name, price, description, sizes, images, brand_id, category_id, discount, stock, stock_status, stock_by_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const defaults = [
            { name: "Кожаный плащ Ночная тень", price: 25000, description: "Длинный кожаный плащ.", sizes: ["S","M","L","XL"], images: ["https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200"], brand: 1, cat: 1, disc: 0 },
            { name: "Чокер с шипами", price: 3500, description: "Кожаный чокер.", sizes: ["ONE SIZE"], images: ["https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1200"], brand: 1, cat: 10, disc: 10 },
            { name: "Структурный корсет", price: 12000, description: "Корсет с вышивкой.", sizes: ["XS","S","M","L"], images: ["https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?w=1200"], brand: 2, cat: 6, disc: 0 },
            { name: "Длинные перчатки", price: 4500, description: "Кожаные перчатки.", sizes: ["S","M","L"], images: ["https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1200"], brand: 2, cat: 10, disc: 15 },
            { name: "Юбка-макси", price: 8900, description: "Юбка в пол.", sizes: ["XS","S","M","L","XL"], images: ["https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=1200"], brand: 3, cat: 7, disc: 0 },
            { name: "Ботинки на платформе", price: 18000, description: "Высокие ботинки.", sizes: ["36","37","38","39","40","41"], images: ["https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=1200"], brand: 3, cat: 10, disc: 0 }
        ];
        for (const p of defaults) {
            insert.run(p.name, p.price, p.description, JSON.stringify(p.sizes), JSON.stringify(p.images), p.brand, p.cat, p.disc, 20, 'in_stock', '{}');
        }
        console.log('Добавлены товары');
    }
}

/* Слайды */
{
    const count = db.prepare('SELECT COUNT(*) as c FROM slides').get().c;
    if (count === 0) {
        const insert = db.prepare('INSERT INTO slides (img) VALUES (?)');
        [
            "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1600",
            "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1600",
            "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600"
        ].forEach(img => insert.run(img));
        console.log('Добавлены слайды');
    }
}

/* Бейджи по умолчанию */
{
    const cnt = db.prepare('SELECT COUNT(*) as c FROM badges').get().c;
    if (cnt === 0) {
        const insert = db.prepare('INSERT INTO badges (code, label, icon, color, text_color, auto, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
        insert.run('new_badge', 'Новинка', 'sparkles', '#111111', '#ffffff', 1, 1);
        insert.run('hit', 'Хит продаж', 'flame', '#8b0000', '#ffffff', 0, 2);
        insert.run('sale', 'Скидка', 'tag', '#c0392b', '#ffffff', 1, 3);
        insert.run('recommended', 'Рекомендуем', 'star', '#2d7a2d', '#ffffff', 0, 4);
        insert.run('coming_soon', 'Скоро в наличии', 'hourglass', '#b8860b', '#ffffff', 1, 5);
        insert.run('out_of_stock', 'Нет в наличии', 'xcircle', '#555555', '#ffffff', 1, 6);
        console.log('Добавлены бейджи по умолчанию');
    }
}

/* Контакты */
{
    const c = db.prepare('SELECT id FROM contacts WHERE id = 1').get();
    if (!c) {
        db.prepare(`INSERT INTO contacts (id, phone, email, address, instagram, telegram, whatsapp, work_hours)
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?)`)
          .run('+7 (999) 123-45-67', 'info@vampshmot.ru', 'Москва, ул. Тверская, 1',
               '@vampshmot', '@vampshmot', '+79991234567', 'Пн–Вс: 10:00–22:00');
        console.log('Добавлены контакты');
    }
}

/* ============================================================
   ФАЙЛЫ
   ============================================================ */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
        cb(null, 'img_' + Date.now() + '_' + Math.round(Math.random() * 1e9) + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Разрешены JPEG, PNG, WebP и GIF')); 
    }
});

/* ============================================================
   MIDDLEWARE
   ============================================================ */
app.use(cors());
app.set('query parser', 'simple');
app.use(express.json({ limit: '256kb', strict: true }));
app.use('/api', (req, res, next) => {
    const keys = Object.keys(req.query);
    if (keys.length > 30 || keys.some(k => k.length > 100 || typeof req.query[k] !== 'string' || req.query[k].length > 4096)) {
        return res.status(400).json({ error: 'Некорректные параметры запроса' });
    }
    next();
});
app.param('id', (req, res, next, id) => {
    if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) return res.status(400).json({ error: 'Некорректный идентификатор' });
    next();
});

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (/\.(?:bak|backup|save)(?:[.\-_]|$)/i.test(req.path)) return res.sendStatus(404);
    next();
});
app.use('/uploads', express.static(uploadsDir, {
    setHeaders(res) {
        // Old uploads may predate file validation. Prevent active documents from running scripts.
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'Нет токена' });
    try {
        const claims = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] });
        req.user = db.prepare('SELECT id, email, role, name FROM users WHERE id = ?').get(claims.id);
        if (!req.user) return res.status(401).json({ error: 'Пользователь не найден' });
        next();
    } catch {
        res.status(401).json({ error: 'Неверный токен' });
    }
}
function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для админа' });
    next();
}

/* ============================================================
   АВТОРИЗАЦИЯ
   ============================================================ */
app.post('/api/register', (req, res) => {
    if (!req.body || typeof req.body.email !== 'string' || req.body.email.length > 254
        || typeof req.body.password !== 'string' || req.body.password.length > 256) {
        return res.status(400).json({ error: 'Некорректный логин или пароль' });
    }
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
        if (row && row.value === '0') {
            return res.status(403).json({ error: 'Регистрация временно отключена' });
        }
    } catch(e) {}
    const { name, email, password } = req.body;
    // ===== Валидация =====
    if (!isValidName(name)) return res.status(400).json({ error: 'Имя должно содержать только буквы, пробел или дефис (2-50 символов)' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Некорректный email' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Пароль должен содержать минимум 4 латинские буквы и 2 цифры (не короче 6 символов)' });
    // ======================
    if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Email уже занят' });
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
                     .run(name, email, hash, 'user');
    const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user, token });
});

app.post('/api/login', (req, res) => {
    if (!req.body || typeof req.body.email !== 'string' || req.body.email.length > 254
        || typeof req.body.password !== 'string' || req.body.password.length > 256) {
        return res.status(400).json({ error: 'Некорректный логин или пароль' });
    }
    const { email, password } = req.body;
    // ===== Валидация =====
    if (!email || typeof email !== 'string' || email.trim().length < 1) return res.status(400).json({ error: 'Укажите email или логин' });
    // ======================
    if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(400).json({ error: 'Неверный email или пароль' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at }, token });
});

app.get('/api/me', authMiddleware, (req, res) => {
    const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    res.json(user);
});

app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
    res.json(db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id DESC').all());
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Нельзя удалить себя' });
        }
        const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        if (user.role === 'admin') {
            const adminsCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get();
            if (adminsCount.cnt <= 1) {
                return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
            }
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



/* ============================================================
   БРЕНДЫ
   ============================================================ */
app.get('/api/brands', (req, res) => {
    res.json(db.prepare('SELECT * FROM brands ORDER BY name ASC').all());
});
app.get('/api/brands/:id', (req, res) => {
    const b = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Бренд не найден' });
    res.json(b);
});
app.post('/api/brands', authMiddleware, adminMiddleware, (req, res) => {
    const { name, description, logo } = req.body;
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    const r = db.prepare('INSERT INTO brands (name, description, logo) VALUES (?, ?, ?)')
                .run(name, description || '', logo || '');
    res.json(db.prepare('SELECT * FROM brands WHERE id = ?').get(r.lastInsertRowid));
});
app.put('/api/brands/:id', authMiddleware, adminMiddleware, (req, res) => {
    const { name, description, logo } = req.body;
    const existing = db.prepare('SELECT id FROM brands WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Бренд не найден' });
    db.prepare('UPDATE brands SET name = ?, description = ?, logo = ? WHERE id = ?')
      .run(name, description || '', logo || '', req.params.id);
    res.json(db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id));
});
app.delete('/api/brands/:id', authMiddleware, adminMiddleware, (req, res) => {
    const r = db.prepare('DELETE FROM brands WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найден' });
    res.json({ ok: true });
});

/* ============================================================
   КАТЕГОРИИ
   ============================================================ */
app.get('/api/categories', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all());
});

// Создание категории
app.post('/api/categories', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        let sortOrder = parseInt(req.body.sort_order, 10);

        if (!name) {
            return res.status(400).json({ error: 'Введите название категории' });
        }

        if (!Number.isFinite(sortOrder)) sortOrder = 0;

        // slug поддерживает как латиницу, так и кириллицу
        let slug = name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-zа-яё0-9_-]/gi, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!slug) slug = 'category-' + Date.now();

        // Если такой slug уже существует — добавляем суффикс
        const baseSlug = slug;
        let n = 2;

        while (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug)) {
            slug = baseSlug + '-' + n++;
        }

        const result = db.prepare(
            'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)'
        ).run(name, slug, sortOrder);

        const category = db.prepare(
            'SELECT * FROM categories WHERE id = ?'
        ).get(result.lastInsertRowid);

        res.json(category);
    } catch (e) {
        console.error('category create:', e);

        if (String(e.message || '').includes('UNIQUE')) {
            return res.status(409).json({
                error: 'Категория с таким названием уже существует'
            });
        }

        res.status(500).json({ error: 'Не удалось создать категорию' });
    }
});

// Удаление категории
app.delete('/api/categories/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        if (!id) {
            return res.status(400).json({ error: 'Некорректная категория' });
        }

        const category = db.prepare(
            'SELECT * FROM categories WHERE id = ?'
        ).get(id);

        if (!category) {
            return res.status(404).json({ error: 'Категория не найдена' });
        }

        const productsCount = db.prepare(
            'SELECT COUNT(*) AS c FROM products WHERE category_id = ?'
        ).get(id).c;

        if (productsCount > 0) {
            return res.status(409).json({
                error: 'Нельзя удалить категорию: в ней находится товаров: ' + productsCount
            });
        }

        db.prepare('DELETE FROM categories WHERE id = ?').run(id);

        res.json({ ok: true });
    } catch (e) {
        console.error('category delete:', e);
        res.status(500).json({ error: 'Не удалось удалить категорию' });
    }
});


/* ============================================================
   БЕЙДЖИ
   ============================================================ */
app.get('/api/badges', (req, res) => {
    const rows = db.prepare('SELECT * FROM badges ORDER BY sort_order ASC, id ASC').all();
    res.json(rows);
});

app.post('/api/badges', authMiddleware, adminMiddleware, (req, res) => {
    const { code, label, icon, color, text_color, auto, sort_order } = req.body;
    if (!code || !label) return res.status(400).json({ error: 'Код и название обязательны' });
    try {
        const r = db.prepare('INSERT INTO badges (code, label, icon, color, text_color, auto, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(code, label, icon || '', color || '#111111', text_color || '#ffffff', auto ? 1 : 0, sort_order || 0);
        res.json(db.prepare('SELECT * FROM badges WHERE id = ?').get(r.lastInsertRowid));
    } catch (e) {
        res.status(400).json({ error: 'Код уже существует или ошибка БД' });
    }
});

app.put('/api/badges/:id', authMiddleware, adminMiddleware, (req, res) => {
    const { code, label, icon, color, text_color, auto, sort_order } = req.body;
    const existing = db.prepare('SELECT id FROM badges WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    db.prepare('UPDATE badges SET code = ?, label = ?, icon = ?, color = ?, text_color = ?, auto = ?, sort_order = ? WHERE id = ?')
      .run(code, label, icon || '', color || '#111111', text_color || '#ffffff', auto ? 1 : 0, sort_order || 0, req.params.id);
    res.json(db.prepare('SELECT * FROM badges WHERE id = ?').get(req.params.id));
});

app.delete('/api/badges/:id', authMiddleware, adminMiddleware, (req, res) => {
    const r = db.prepare('DELETE FROM badges WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найден' });
    db.prepare('DELETE FROM product_badges WHERE badge_id = ?').run(req.params.id);
    res.json({ ok: true });
});
/* ============================================================
   ТОВАРЫ
   ============================================================ */
function enrichProduct(p) {
    try {
        p.images = JSON.parse(p.images || '[]');
        p.sizes = JSON.parse(p.sizes || '[]');
        p.stock_by_size = JSON.parse(p.stock_by_size || '{}');
        p.specs = JSON.parse(p.specs || '[]');
    } catch { p.images = []; p.sizes = []; }
    p.img = p.images[0] || '';
    if (p.brand_id) {
        const b = db.prepare('SELECT id, name FROM brands WHERE id = ?').get(p.brand_id);
        p.brand = b || null;
    } else {
        p.brand = null;
    }
    if (p.category_id) {
        const c = db.prepare('SELECT id, name, slug FROM categories WHERE id = ?').get(p.category_id);
        p.category = c || null;
    } else {
        p.category = null;
    }
    p.discount = p.discount || 0;
    // Итоговая цена со скидкой
    if (p.discount > 0) {
        p.final_price = Math.round(p.price * (1 - p.discount / 100));
    } else {
        p.final_price = p.price;
    }
    // Новинка — младше 30 дней
    const created = new Date(p.created_at + ' UTC');
    const days = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    p.is_new = days < 30;
    p.badges = [];
    try {
        const rows = db.prepare('SELECT b.* FROM badges b INNER JOIN product_badges pb ON pb.badge_id = b.id WHERE pb.product_id = ? ORDER BY b.sort_order ASC').all(p.id);
        p.badges = rows;
    } catch (e) {}
    if (p.is_new) {
        const nb = db.prepare("SELECT * FROM badges WHERE code = 'new_badge'").get();
        if (nb && !p.badges.find(x => x.code === 'new_badge')) p.badges.push(nb);
    }
    if (p.discount > 0) {
        const sb = db.prepare("SELECT * FROM badges WHERE code = 'sale'").get();
        if (sb && !p.badges.find(x => x.code === 'sale')) p.badges.push(sb);
    }
    if (p.stock_status === 'coming_soon') {
        const cb = db.prepare("SELECT * FROM badges WHERE code = 'coming_soon'").get();
        if (cb && !p.badges.find(x => x.code === 'coming_soon')) p.badges.push(cb);
    }
    if (p.stock_status === 'out_of_stock' || (p.stock === 0 && p.stock_status !== 'coming_soon')) {
        const ob = db.prepare("SELECT * FROM badges WHERE code = 'out_of_stock'").get();
        if (ob && !p.badges.find(x => x.code === 'out_of_stock')) p.badges.push(ob);
    }
    return p;
}

app.get('/api/products', (req, res) => {
    const { brand, category, sort, q } = req.query;
    if ([brand, category].some(v => v !== undefined && v !== '' && !/^[1-9]\d{0,14}$/.test(v))) return res.status(400).json({ error: 'Некорректный фильтр' });
    if (q !== undefined && q.length > 150) return res.status(400).json({ error: 'Поиск не длиннее 150 символов' });
    if (sort !== undefined && !['', 'cheap', 'expensive', 'new', 'discount', 'recommended'].includes(sort)) return res.status(400).json({ error: 'Некорректная сортировка' });
    let sql = 'SELECT * FROM products';
    const conditions = [];
    const params = [];
    if (brand) {
        conditions.push('brand_id = ?');
        params.push(brand);
    }
    if (category) {
        conditions.push('category_id = ?');
        params.push(category);
    }
    if (q && String(q).trim()) {
        const term = '%' + String(q).trim() + '%';
        conditions.push('(name LIKE ? OR sku LIKE ? OR description LIKE ?)');
        params.push(term, term, term);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

    // Сортировка
    switch (sort) {
        case 'cheap':
            sql += ' ORDER BY (price * (100 - COALESCE(discount,0)) / 100) ASC';
            break;
        case 'expensive':
            sql += ' ORDER BY (price * (100 - COALESCE(discount,0)) / 100) DESC';
            break;
        case 'new':
            sql += ' ORDER BY id DESC';
            break;
        case 'discount':
            sql += ' ORDER BY COALESCE(discount,0) DESC, id DESC';
            break;
        case 'recommended':
        default:
            // Простая рекомендация: сначала скидки, потом новые
            sql += ' ORDER BY COALESCE(discount,0) DESC, id DESC';
            break;
    }

    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(enrichProduct));
});

app.get('/api/products/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Не найден' });
    res.json(enrichProduct(p));
});

app.post('/api/products', authMiddleware, adminMiddleware, (req, res) => {
    const { name, price, description, sizes, images, brand_id, category_id, discount, stock, stock_status, badge_ids, stock_by_size } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Название и цена обязательны' });
    if (!images || !images.length) return res.status(400).json({ error: 'Добавьте фото' });
    const r = db.prepare('INSERT INTO products (name, price, description, sizes, images, brand_id, category_id, discount, stock, stock_status, stock_by_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(name, price, description || '', JSON.stringify(sizes || ['ONE SIZE']), JSON.stringify(images), brand_id || null, category_id || null, discount || 0, stock || 0, stock_status || 'in_stock', JSON.stringify(stock_by_size || {}));
    const newId = r.lastInsertRowid;
    try { if (badge_ids && badge_ids.length) { const stmt = db.prepare('INSERT OR IGNORE INTO product_badges (product_id, badge_id) VALUES (?, ?)'); for (const bid of badge_ids) stmt.run(newId, bid); } } catch (e) { console.error('badges insert:', e.message); }
    res.json(enrichProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(newId)));
});

app.put('/api/products/:id', authMiddleware, adminMiddleware, (req, res) => {
    const { name, price, description, sizes, images, brand_id, category_id, discount, stock, stock_status, badge_ids, sku, specs, stock_by_size } = req.body;
    const existing = db.prepare('SELECT id, sku FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    let finalSku = (sku || '').trim();

    if (!finalSku) {
        finalSku = existing.sku || generateSku(name, category_id);
    }

    // Защита от UNIQUE constraint failed: products.sku
    // При редактировании допускаем SKU текущего товара,
    // но не SKU другого товара.
    let conflict = db.prepare(
        'SELECT id FROM products WHERE sku = ? AND id != ?'
    ).get(finalSku, req.params.id);

    if (conflict) {
        const baseSku = finalSku;
        let n = 2;

        while (conflict) {
            finalSku = baseSku + '-' + n++;

            conflict = db.prepare(
                'SELECT id FROM products WHERE sku = ? AND id != ?'
            ).get(finalSku, req.params.id);
        }
    }

    db.prepare('UPDATE products SET name = ?, price = ?, description = ?, sizes = ?, images = ?, brand_id = ?, category_id = ?, discount = ?, stock = ?, stock_status = ?, sku = ?, specs = ?, stock_by_size = ? WHERE id = ?')
      .run(name, price, description || '', JSON.stringify(sizes || ['ONE SIZE']), JSON.stringify(images || []), brand_id || null, category_id || null, discount || 0, stock || 0, stock_status || 'in_stock', finalSku, JSON.stringify(specs || []), JSON.stringify(stock_by_size || {}), req.params.id);
    try { db.prepare('DELETE FROM product_badges WHERE product_id = ?').run(req.params.id); if (badge_ids && badge_ids.length) { const stmt = db.prepare('INSERT OR IGNORE INTO product_badges (product_id, badge_id) VALUES (?, ?)'); for (const bid of badge_ids) stmt.run(req.params.id, bid); } } catch (e) { console.error('badges update:', e.message); }
    res.json(enrichProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)));
});

/* === REVIEWS (start) === */
app.get('/api/products/:id/reviews', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC').all(req.params.id);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products/:id/reviews', authMiddleware, (req, res) => {
    const { rating, text } = req.body;
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) return res.status(400).json({ error: 'Отзыв должен содержать от 1 до 5000 символов' });
    const r = Number(rating);
    if (!Number.isInteger(r)) return res.status(400).json({ error: 'Оценка должна быть целым числом' });
    if (!db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Товар не найден' });
    if (r < 1 || r > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });
    const userName = req.user.name || req.user.email || 'Пользователь';
    try {
        const ins = db.prepare('INSERT INTO reviews (product_id, user_id, user_name, rating, text) VALUES (?, ?, ?, ?, ?)')
          .run(req.params.id, req.user.id, userName, r, text.trim());
        res.json(db.prepare('SELECT * FROM reviews WHERE id = ?').get(ins.lastInsertRowid));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reviews/:id', authMiddleware, (req, res) => {
    try {
        const rv = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
        if (!rv) return res.status(404).json({ error: 'Отзыв не найден' });
        const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
        const isAdmin = u && u.role === 'admin';
        if (!isAdmin && rv.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Нет прав для удаления' });
        }
        db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

/* === RELATED (start) === */
app.get('/api/products/:id/related', (req, res) => {
    const id = req.params.id;
    const me = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!me) return res.status(404).json({ error: 'Не найден' });
    const LIMIT = 8;
    let out = [];

    // 1) та же категория
    if (me.category_id) {
        out = db.prepare('SELECT * FROM products WHERE category_id = ? AND id != ? ORDER BY RANDOM() LIMIT ?')
                .all(me.category_id, id, LIMIT);
    }
    // 2) дополнить брендом
    if (out.length < LIMIT && me.brand_id) {
        const need = LIMIT - out.length;
        const have = new Set(out.map(x => x.id));
        const more = db.prepare('SELECT * FROM products WHERE brand_id = ? AND id != ? ORDER BY RANDOM() LIMIT ?')
                       .all(me.brand_id, id, need + have.size);
        for (const x of more) {
            if (!have.has(x.id) && out.length < LIMIT) { out.push(x); have.add(x.id); }
        }
    }
    // 3) дополнить любыми другими
    if (out.length < LIMIT) {
        const need = LIMIT - out.length;
        const have = new Set(out.map(x => x.id));
        have.add(parseInt(id, 10));
        const more = db.prepare('SELECT * FROM products ORDER BY RANDOM() LIMIT ?').all(LIMIT * 2);
        for (const x of more) {
            if (!have.has(x.id) && out.length < LIMIT) { out.push(x); have.add(x.id); }
        }
    }
    res.json(out.map(enrichProduct));
});
/* === RELATED (end) === */
/* === REVIEWS (end) === */
/* === CHAT (SSE) (start) === */
// Хранилище SSE-клиентов: Map<chatId, Set<res>>
const sseClients = new Map();

function sseSend(chatId, payload) {
    const set = sseClients.get(Number(chatId));
    console.log('[sseSend] chat=' + chatId + ' clients=' + (set ? set.size : 0) + ' type=' + (payload.type || '?'));
    if (!set) return;
    const data = 'data: ' + JSON.stringify(payload) + '\n\n';
    for (const res of set) {
        try { res.write(data); } catch (e) { set.delete(res); }
    }
}

// Найти или создать чат текущего пользователя
function getOrCreateChat(user) {
    let chat = db.prepare('SELECT * FROM chats WHERE user_id = ?').get(user.id);
    if (!chat) {
        const r = db.prepare('INSERT INTO chats (user_id, user_name) VALUES (?, ?)')
                    .run(user.id, user.name || user.email || 'Пользователь');
        chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(r.lastInsertRowid);
    }
    return chat;
}


// Guests have no users-table account and can access only their own conversation.
db.exec(`CREATE TABLE IF NOT EXISTS guest_chat_sessions (
    token_hash TEXT PRIMARY KEY, chat_id INTEGER UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL
)`);
const GUEST_CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function purgeOldGuestChats(now = Date.now()) {
    const cutoff = Math.floor((now-GUEST_CHAT_RETENTION_MS)/1000);
    const ids=withStockTransaction(()=>{
        const rows=db.prepare(`SELECT c.id FROM chats c JOIN guest_chat_sessions g ON g.chat_id=c.id
            WHERE datetime(COALESCE(NULLIF(c.last_message_at,''),c.created_at)) <= datetime(?,'unixepoch')
            ORDER BY c.id LIMIT 500`).all(cutoff);
        const ids=rows.map(r=>r.id);
        if (!ids.length) return ids;
        const slots=ids.map(()=>'?').join(',');
        db.prepare('DELETE FROM messages WHERE chat_id IN ('+slots+')').run(...ids);
        db.prepare('DELETE FROM guest_chat_sessions WHERE chat_id IN ('+slots+')').run(...ids);
        db.prepare('DELETE FROM chats WHERE id IN ('+slots+')').run(...ids);
        return ids;
    });
    for (const id of ids) {
        const streams=sseClients.get(Number(id));
        if(streams) { for(const res of streams) {try{res.end();}catch(_){}} sseClients.delete(Number(id)); }
    }
    return ids.length;
}
// Match guest access expiry to the last message, including existing conversations.
db.prepare(`UPDATE guest_chat_sessions SET expires_at = (
    SELECT CAST(strftime('%s',COALESCE(NULLIF(c.last_message_at,''),c.created_at)) AS INTEGER)*1000+?
    FROM chats c WHERE c.id=guest_chat_sessions.chat_id
) WHERE EXISTS (SELECT 1 FROM chats c WHERE c.id=guest_chat_sessions.chat_id
    AND strftime('%s',COALESCE(NULLIF(c.last_message_at,''),c.created_at)) IS NOT NULL)`).run(GUEST_CHAT_RETENTION_MS);
db.exec('PRAGMA secure_delete = ON');
function runGuestRetention() {
    try { const count=purgeOldGuestChats();if(count)console.log('[guest-retention] Deleted inactive conversations:',count); }
    catch(e) { console.error('[guest-retention] Cleanup failed'); }
}
runGuestRetention();
setInterval(runGuestRetention,60*1000).unref();

const guestRateBuckets = new Map();
function guestClientIp(req) {
    const peer = req.socket.remoteAddress || '';
    if (['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) && net.isIP(req.headers['x-real-ip'] || '')) return req.headers['x-real-ip'];
    return peer;
}
function guestRate(req, res, kind, key, limit, windowMs) {
    const now = Date.now(), id = kind + ':' + key;
    let bucket = guestRateBuckets.get(id);
    if (!bucket || bucket.until <= now) {
        if (guestRateBuckets.size >= 10000) {
            for (const [k,v] of guestRateBuckets) if (v.until <= now) guestRateBuckets.delete(k);
            if (guestRateBuckets.size >= 10000) { res.status(429).json({error:'Попробуйте позже'}); return false; }
        }
        bucket = { count: 0, until: now + windowMs }; guestRateBuckets.set(id,bucket);
    }
    if (++bucket.count > limit) { res.setHeader('Retry-After',Math.ceil((bucket.until-now)/1000)); res.status(429).json({error:'Слишком часто. Попробуйте позже'}); return false; }
    return true;
}
function guestChatAuth(req,res,next) {
    const token=req.headers['x-guest-chat-token'];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(401).json({error:'Откройте чат заново'});
    const hash=crypto.createHash('sha256').update(token).digest('hex');
    const session=db.prepare('SELECT chat_id, expires_at FROM guest_chat_sessions WHERE token_hash = ?').get(hash);
    if (!session || session.expires_at <= Date.now()) return res.status(401).json({error:'Откройте чат заново'});
    const chat=db.prepare('SELECT * FROM chats WHERE id = ?').get(session.chat_id);
    if (!chat) return res.status(401).json({error:'Диалог недоступен'});
    req.guestChat=chat;
    res.setHeader('Cache-Control','no-store');
    next();
}
app.post('/api/guest-chat/session', (req,res) => {
    if (!guestRate(req,res,'create',guestClientIp(req),5,10*60*1000)) return;
    const token=crypto.randomBytes(32).toString('base64url');
    const hash=crypto.createHash('sha256').update(token).digest('hex');
    try {
        const chat=withStockTransaction(() => {
            // Negative synthetic owner IDs cannot collide with registered users.
            const owner=-crypto.randomInt(1,281474976710655);
            const r=db.prepare('INSERT INTO chats (user_id,user_name) VALUES (?,?)').run(owner,'Гость');
            db.prepare('INSERT INTO guest_chat_sessions(token_hash,chat_id,expires_at) VALUES (?,?,?)').run(hash,r.lastInsertRowid,Date.now()+30*24*60*60*1000);
            return db.prepare('SELECT * FROM chats WHERE id = ?').get(r.lastInsertRowid);
        });
        res.setHeader('Cache-Control','no-store');res.json({token,chat});
    } catch(e) { res.status(503).json({error:'Не удалось открыть чат. Попробуйте позже'}); }
});
app.get('/api/guest-chat/me',guestChatAuth,(req,res)=>res.json({chat:req.guestChat}));
app.get('/api/guest-chat/messages',guestChatAuth,(req,res)=>{
    if (!guestRate(req,res,'read',req.guestChat.id,60,60000)) return;
    const rows=db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 500').all(req.guestChat.id).reverse();
    db.prepare("UPDATE messages SET read_at = datetime('now') WHERE chat_id = ? AND sender_role = 'admin' AND read_at IS NULL").run(req.guestChat.id);
    res.json(rows);
});
app.post('/api/guest-chat/messages',guestChatAuth,(req,res)=>{
    if (!guestRate(req,res,'send-ip',guestClientIp(req),30,60000) || !guestRate(req,res,'send-chat',req.guestChat.id,10,60000)) return;
    if (!req.body || typeof req.body.text !== 'string' || !req.body.text.trim() || req.body.text.length>5000) return res.status(400).json({error:'Сообщение должно содержать от 1 до 5000 символов'});
    try {
        const msg=withStockTransaction(()=>{
            const r=db.prepare('INSERT INTO messages(chat_id,sender_id,sender_role,text) VALUES (?,?,?,?)').run(req.guestChat.id,req.guestChat.user_id,'user',req.body.text.trim());
            db.prepare("UPDATE chats SET last_message_at = datetime('now') WHERE id = ?").run(req.guestChat.id);
            db.prepare('UPDATE guest_chat_sessions SET expires_at = ? WHERE chat_id = ?').run(Date.now()+GUEST_CHAT_RETENTION_MS,req.guestChat.id);
            return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
        });
        sseSend(Number(req.guestChat.id),{type:'message',message:msg});res.json(msg);
    } catch(e) { res.status(503).json({error:'Сообщение не отправлено. Попробуйте позже'}); }
});

// Мой чат
app.get('/api/chats/me', authMiddleware, (req, res) => {
    const chat = getOrCreateChat(req.user);
    const unread = db.prepare('SELECT COUNT(*) as c FROM messages WHERE chat_id = ? AND sender_role != ? AND (read_at IS NULL)')
                     .get(chat.id, req.user.role === 'admin' ? 'admin' : 'user').c;
    res.json({ chat, unread });
});

// Все чаты (только админ)
app.get('/api/chats', authMiddleware, adminMiddleware, (req, res) => {
    const rows = db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.sender_role = 'user' AND m.read_at IS NULL) as unread,
          (SELECT text FROM messages m WHERE m.chat_id = c.id ORDER BY id DESC LIMIT 1) as last_text
        FROM chats c
        ORDER BY c.last_message_at DESC
    `).all();
    res.json(rows);
});

// Сообщения чата
app.get('/api/chats/:id/messages', authMiddleware, (req, res) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (req.user.role !== 'admin' && chat.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }
    const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC').all(req.params.id);
    // отметить прочитанными чужие
    const myRole = req.user.role === 'admin' ? 'admin' : 'user';
    db.prepare("UPDATE messages SET read_at = datetime('now') WHERE chat_id = ? AND sender_role != ? AND read_at IS NULL")
      .run(req.params.id, myRole);
    res.json(rows);
});

// Отправить сообщение
app.post('/api/chats/:id/messages', authMiddleware, (req, res) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (req.user.role !== 'admin' && chat.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!req.body || typeof req.body.text !== 'string' || req.body.text.length > 5000) return res.status(400).json({ error: 'Сообщение должно содержать от 1 до 5000 символов' });
    const text = req.body.text.trim();
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
    const myRole = req.user.role === 'admin' ? 'admin' : 'user';
    const r = db.prepare('INSERT INTO messages (chat_id, sender_id, sender_role, text) VALUES (?, ?, ?, ?)')
                .run(req.params.id, req.user.id, myRole, text);
    db.prepare("UPDATE chats SET last_message_at = datetime('now') WHERE id = ?").run(req.params.id);
    db.prepare('UPDATE guest_chat_sessions SET expires_at = ? WHERE chat_id = ?').run(Date.now()+GUEST_CHAT_RETENTION_MS,req.params.id);
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
    // Разослать всем подписчикам чата
    sseSend(req.params.id, { type: 'message', message: msg });
    res.json(msg);
});

// SSE-поток
app.get('/api/chats/:id/stream', (req, res) => {
    // EventSource не умеет отправлять Authorization header, поэтому для SSE
    // разрешаем короткоживущий JWT через query string. Токен всё равно
    // проверяется тем же JWT_SECRET и доступ ограничен конкретным чатом.
    const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : (typeof req.query.token === 'string' ? req.query.token : '');
    if (!token) return res.status(401).end();
    let user;
    try {
        const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(claims.id);
        if (!user) return res.status(401).end();
        user.tokenExpiresAt = claims.exp * 1000;
    } catch (e) { return res.status(401).end(); }
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);
    if (!chat) return res.status(404).end();
    if (user.role !== 'admin' && chat.user_id !== user.id) return res.status(403).end();

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders && res.flushHeaders();
    res.write('retry: 3000\n\n');
    res.write('event: connected\ndata: {"ok":true}\n\n');

    const chatId = parseInt(req.params.id, 10);
    if (!sseClients.has(chatId)) sseClients.set(chatId, new Set());
    sseClients.get(chatId).add(res);

    // heartbeat каждые 15 сек, чтобы соединение не рвалось
    const hb = setInterval(() => {
        try {
            const current = db.prepare('SELECT id, role FROM users WHERE id = ?').get(user.id);
            const owner = db.prepare('SELECT user_id FROM chats WHERE id = ?').get(chatId);
            if (!current || !owner || Date.now() >= user.tokenExpiresAt || (current.role !== 'admin' && owner.user_id !== current.id)) return res.end();
            res.write(': ping\n\n');
        } catch (e) { res.end(); }
    }, 15000);

    req.on('close', () => {
        clearInterval(hb);
        const set = sseClients.get(Number(chatId));
        if (set) { set.delete(res); if (!set.size) sseClients.delete(chatId); }
    });
});

// Плавающая кнопка чата — количество непрочитанных
app.get('/api/chats/me/unread', authMiddleware, (req, res) => {
    const chat = db.prepare('SELECT * FROM chats WHERE user_id = ?').get(req.user.id);
    if (!chat) return res.json({ unread: 0 });
    const unread = db.prepare("SELECT COUNT(*) as c FROM messages WHERE chat_id = ? AND sender_role = 'admin' AND read_at IS NULL")
                     .get(chat.id).c;
    res.json({ unread });
});
/* === CHAT (SSE) (end) === */
app.delete('/api/products/:id', authMiddleware, adminMiddleware, (req, res) => {
    const r = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найден' });
    res.json({ ok: true });
});

/* ============================================================
   ЗАГРУЗКА
   ============================================================ */
app.post('/api/upload', authMiddleware, adminMiddleware, upload.array('photos', 20), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Файлы не загружены' });
    try {
        for (const f of req.files) {
            const fd = fs.openSync(f.path, 'r');
            const header = Buffer.alloc(16);
            let length;
            try { length = fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
            const valid = length >= 12 && (
                (f.mimetype === 'image/png' && header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
                (f.mimetype === 'image/jpeg' && header[0] === 255 && header[1] === 216 && header[2] === 255) ||
                (f.mimetype === 'image/webp' && header.toString('ascii',0,4) === 'RIFF' && header.toString('ascii',8,12) === 'WEBP') ||
                (f.mimetype === 'image/gif' && ['GIF87a','GIF89a'].includes(header.toString('ascii',0,6)))
            );
            if (!valid) throw new Error('Содержимое файла не соответствует изображению');
        }
    } catch (e) {
        for (const f of req.files) { try { fs.unlinkSync(f.path); } catch (_) {} }
        return res.status(400).json({ error: 'Файл не является разрешённым изображением' });
    }
    res.json({ urls: req.files.map(f => '/uploads/' + f.filename) });
});

/* ============================================================
   СЛАЙДЫ
   ============================================================ */
app.get('/api/slides', (req, res) => {
    res.json(db.prepare('SELECT * FROM slides ORDER BY id DESC').all());
});
app.post('/api/slides', authMiddleware, adminMiddleware, (req, res) => {
    const { img } = req.body;
    if (!img) return res.status(400).json({ error: 'URL обязателен' });
    const r = db.prepare('INSERT INTO slides (img) VALUES (?)').run(img);
    res.json(db.prepare('SELECT * FROM slides WHERE id = ?').get(r.lastInsertRowid));
});
app.delete('/api/slides/:id', authMiddleware, adminMiddleware, (req, res) => {
    const r = db.prepare('DELETE FROM slides WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найден' });
    res.json({ ok: true });
});

/* ============================================================
   ЗАКАЗЫ
   ============================================================ */

// Prices and order contents always come from the database, never from the browser.
function quoteCart(input) {
    if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Некорректная корзина');
    const grouped = new Map();
    for (const it of input) {
        if (!it || typeof it !== 'object') throw new Error('Некорректный товар');
        const id = Number(it.id), qty = Number(it.qty === undefined ? 1 : it.qty);
        if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000) throw new Error('Некорректное количество или товар');
        if (it.size != null && typeof it.size !== 'string') throw new Error('Некорректный размер');
        const size = it.size || '';
        if (size.length > 100) throw new Error('Некорректный размер');
        const key = JSON.stringify([id, size]);
        const old = grouped.get(key);
        if (old) { old.qty += qty; if (old.qty > 1000) throw new Error('Слишком большое количество'); }
        else grouped.set(key, { id, size, qty });
    }
    const items = []; let total = 0;
    for (const it of grouped.values()) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.id);
        if (!p) throw new Error('Товар не найден');
        const price = Number(p.price), discount = Number(p.discount || 0);
        if (!Number.isSafeInteger(price) || price < 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Некорректная цена товара');
        const sizes = JSON.parse(p.sizes || '[]');
        if (!Array.isArray(sizes) || (sizes.length && !sizes.includes(it.size))) throw new Error('Выберите допустимый размер');
        const finalPrice = Math.round(price * (1 - discount / 100));
        const images = JSON.parse(p.images || '[]');
        items.push({ id: p.id, size: it.size, qty: it.qty, name: p.name, price: finalPrice, img: images[0] || '', images });
        total += finalPrice * it.qty;
        if (!Number.isSafeInteger(total) || total > 100000000) throw new Error('Сумма заказа слишком велика');
    }
    if (total <= 0) throw new Error('Сумма заказа должна быть положительной');
    return { items, total };
}

async function yooGet(resource, id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid payment identifier');
    if (!YOOKASSA_SECRET_KEY || !YOOKASSA_SHOP_ID) throw new Error('Payment credentials unavailable');
    const authorization = 'Basic ' + Buffer.from(YOOKASSA_SHOP_ID + ':' + YOOKASSA_SECRET_KEY).toString('base64');
    const response = await fetch('https://api.yookassa.ru/v3/' + resource + '/' + encodeURIComponent(id), {
        headers: { Authorization: authorization }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Payment verification failed');
    const result = await response.json();
    if (result.id !== id) throw new Error('Payment identifier mismatch');
    return result;
}

function paymentMatchesOrder(payment, order) {
    return payment.id === order.payment_id && payment.amount && payment.amount.currency === 'RUB'
        && /^\d+\.\d{2}$/.test(payment.amount.value)
        && Number(payment.amount.value) === Number(order.total)
        && (payment.test !== true || process.env.YOOKASSA_ALLOW_TEST === '1');
}

app.post('/api/orders', authMiddleware, (req, res) => {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'allow_payment_cash'").get();
        if (row && row.value === '0') {
            const pm = (req.body && req.body.payment_method) || 'cash';
            if (pm === 'cash') {
                return res.status(403).json({ error: 'Оплата при получении временно недоступна' });
            }
        }
    } catch(e) {}
    const { customer_name, phone, address, comment, stock_eta } = req.body;
    const is_reserved = false;
    if (req.body.payment_method && req.body.payment_method !== 'cash') return res.status(400).json({ error: 'Для онлайн-оплаты используйте создание платежа' });
    const payment_method = 'cash', payment_status = 'unpaid';
    let cart;
    try { cart = quoteCart(req.body.items); } catch (e) { return res.status(400).json({ error: e.message }); }
    const { items, total } = cart;
    // ===== Валидация =====
    if (phone && !isValidPhoneRU(phone)) return res.status(400).json({ error: 'Некорректный номер телефона. Формат: +7 (900) 123-45-67' });
    if (!address || !isValidAddress(address)) return res.status(400).json({ error: 'Укажите адрес доставки' });
    // ======================
    if (!customer_name || !phone || !address) return res.status(400).json({ error: 'Заполните имя, телефон и адрес' });
    if (!items || !items.length) return res.status(400).json({ error: 'Корзина пуста' });
    // Обогащаем каждый item картинкой и брендом из products
    const enrichedItems = items.map(function(it){
        try {
            const prod = db.prepare('SELECT images, brand_id, name, price FROM products WHERE id = ?').get(it.id);
            if (prod) {
                let imgs = [];
                try { imgs = JSON.parse(prod.images || '[]'); } catch(e){}
                let brandName = null;
                if (prod.brand_id) {
                    const b = db.prepare('SELECT name FROM brands WHERE id = ?').get(prod.brand_id);
                    if (b) brandName = b.name;
                }
                return Object.assign({}, it, {
                    img: it.img || imgs[0] || '',
                    images: imgs,
                    brand: brandName,
                    name: it.name || prod.name
                });
            }
        } catch(e){}
        return it;
    });
    let r;
    try {
        r = withStockTransaction(() => {
        const r = db.prepare(`INSERT INTO orders (user_id, customer_name, phone, address, comment, items, total, status, payment_method, payment_status, is_reserved, stock_eta)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(req.user.id, customer_name, phone, address, comment || '', JSON.stringify(enrichedItems), total || 0, is_reserved ? 'reserved' : 'new', payment_method || 'cash', payment_status || 'unpaid', is_reserved ? 1 : 0, stock_eta || null);
        decrementStock(r.lastInsertRowid);
        return r;
        });
    } catch (e) { return res.status(400).json({ error: e.message }); }
    sseSendToAdmins({ type: 'new_order', order_id: r.lastInsertRowid });
    res.json({ id: r.lastInsertRowid, ok: true });
});
app.get('/api/orders/my', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    rows.forEach(o => {
        try { o.items = JSON.parse(o.items || '[]'); } catch { o.items = []; }
        // Для старых заказов — подтянуть картинку, если её нет
        o.items = (o.items || []).map(function(it){
            if (!it.img && it.id) {
                try {
                    const prod = db.prepare('SELECT images, brand_id FROM products WHERE id = ?').get(it.id);
                    if (prod) {
                        let imgs = [];
                        try { imgs = JSON.parse(prod.images || '[]'); } catch(e){}
                        it.img = imgs[0] || '';
                        it.images = imgs;
                        if (prod.brand_id) {
                            const b = db.prepare('SELECT name FROM brands WHERE id = ?').get(prod.brand_id);
                            if (b) it.brand = b.name;
                        }
                    }
                } catch(e){}
            }
            return it;
        });
    });
    res.json(rows);
});
app.get('/api/orders', authMiddleware, adminMiddleware, (req, res) => {
    const rows = db.prepare(`SELECT o.*, COALESCE(NULLIF(o.customer_name,''), u.name) as customer_name
                              FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC`).all();
    rows.forEach(o => { try { o.items = JSON.parse(o.items || '[]'); } catch { o.items = []; } });
    res.json(rows);
});
app.put('/api/orders/:id', authMiddleware, adminMiddleware, (req, res) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Статус обязателен' });
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
    notifyBot(req.params.id, 'status', status).catch(()=>{});
    res.json({ ok: true });
});


app.put('/api/orders/:id/payment', authMiddleware, adminMiddleware, (req, res) => {
    const { payment_status } = req.body;
    if (!payment_status) return res.status(400).json({ error: 'Статус оплаты обязателен' });
    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(payment_status, req.params.id);
    notifyBot(req.params.id, 'payment_status', payment_status).catch(()=>{});
    res.json({ ok: true });
});


/* ============================================================
   НАСТРОЙКИ: БРОНИРОВАНИЕ
   ============================================================ */
app.get('/api/settings/payment_methods', (req, res) => {
    try {
        const cash = db.prepare("SELECT value FROM settings WHERE key = 'allow_payment_cash'").get();
        const online = db.prepare("SELECT value FROM settings WHERE key = 'allow_payment_online'").get();
        res.json({
            cash: cash ? cash.value === '1' : true,
            online: online ? online.value === '1' : true
        });
    } catch(e) { res.json({ cash: true, online: true }); }
});

app.put('/api/settings/payment_methods', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const cash = req.body.cash ? 1 : 0;
        const online = req.body.online ? 1 : 0;
        db.prepare("INSERT INTO settings (key, value) VALUES ('allow_payment_cash', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(String(cash), String(cash));
        db.prepare("INSERT INTO settings (key, value) VALUES ('allow_payment_online', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(String(online), String(online));
        res.json({ ok: true, cash: !!cash, online: !!online });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/settings/allow_registration', (req, res) => {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
        res.json({ enabled: row ? row.value === '1' : true });
    } catch(e) { res.json({ enabled: true }); }
});

app.put('/api/settings/allow_registration', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const enabled = req.body.enabled ? 1 : 0;
        db.prepare("INSERT INTO settings (key, value) VALUES ('allow_registration', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(String(enabled), String(enabled));
        res.json({ ok: true, enabled: !!enabled });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/settings/reserve', (req, res) => {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'reserve_enabled'").get();
        res.json({ enabled: row && row.value === '1' });
    } catch (e) { res.json({ enabled: false }); }
});

app.put('/api/settings/reserve', authMiddleware, adminMiddleware, (req, res) => {
    const { enabled } = req.body;
    try {
        db.prepare("INSERT INTO settings (key, value) VALUES ('reserve_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(enabled ? '1' : '0', enabled ? '1' : '0');
        res.json({ ok: true, enabled: !!enabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ============================================================
   КОНТАКТЫ
   ============================================================ */

/* ЮKASSA */
app.post('/api/payment/create', authMiddleware, async (req, res) => {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'allow_payment_online'").get();
        if (row && row.value === '0') {
            return res.status(403).json({ error: 'Онлайн-оплата временно недоступна' });
        }
    } catch(e) {}
  const { payment_method, phone, address, comment } = req.body;
  if (!['cash', 'online'].includes(payment_method)) return res.status(400).json({ error: 'Некорректный способ оплаты' });
  if (payment_method === 'cash') {
    const cashSetting = db.prepare("SELECT value FROM settings WHERE key = 'allow_payment_cash'").get();
    if (cashSetting && cashSetting.value === '0') return res.status(403).json({ error: 'Оплата при получении отключена' });
  }
  let cart;
  try { cart = quoteCart(req.body.items); } catch (e) { return res.status(400).json({ error: e.message }); }
  const { items, total } = cart;
  if (!items || !items.length) return res.status(400).json({ error: "Корзина пуста" });
  if (!phone || !address) return res.status(400).json({ error: "Заполните телефон и адрес" });
  if (!isValidPhoneRU(phone)) return res.status(400).json({ error: "Некорректный номер телефона. Формат: +7 (900) 123-45-67" });
  if (!isValidAddress(address)) return res.status(400).json({ error: "Некорректный адрес доставки" });

  if (payment_method === "cash") {
    let r;
    try { r = withStockTransaction(() => {
        const result = db.prepare("INSERT INTO orders (user_id, customer_name, phone, address, comment, items, total, status, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(req.user.id, req.user.name || '', phone, address, comment || "", JSON.stringify(items), total, "new", "cash");
        decrementStock(result.lastInsertRowid); return result;
    }); } catch (e) { return res.status(400).json({ error: e.message }); }
    sseSendToAdmins({ type: 'new_order', order_id: r.lastInsertRowid });
    return res.json({ order_id: r.lastInsertRowid, paid: false, method: "cash" });
  }
  if (!YOOKASSA_SECRET_KEY) return res.status(400).json({ error: "ЮKassa не настроена" });
  try {
    const r = withStockTransaction(() => {
        const result = db.prepare("INSERT INTO orders (user_id, customer_name, phone, address, comment, items, total, status, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(req.user.id, req.user.name || '', phone, address, comment || "", JSON.stringify(items), total, "new", "online");
        decrementStock(result.lastInsertRowid); return result;
    });
    const auth = Buffer.from(YOOKASSA_SHOP_ID + ":" + YOOKASSA_SECRET_KEY).toString("base64");
    const body = { amount: { value: (total || 0).toFixed(2), currency: "RUB" }, capture: true, confirmation: { type: "redirect", return_url: "https://vampshmot.ru/#order_" + r.lastInsertRowid }, description: "Заказ №" + r.lastInsertRowid, metadata: { order_id: String(r.lastInsertRowid) } };
    const yoo = await fetch("https://api.yookassa.ru/v3/payments", { method: "POST", headers: { "Authorization": "Basic " + auth, "Idempotence-Key": "order_" + r.lastInsertRowid + "", "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const d = await yoo.json();
    if (!yoo.ok) {
        // Release only a definitive rejection. A network timeout is ambiguous.
        if (yoo.status >= 400 && yoo.status < 500 && yoo.status !== 429) {
            withStockTransaction(() => {
                releaseStock(r.lastInsertRowid);
                db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(r.lastInsertRowid);
            });
        }
        return res.status(400).json({ error: 'Не удалось создать платёж. Обратитесь в магазин.' });
    }
    db.prepare("UPDATE orders SET payment_id = ? WHERE id = ?").run(d.id, r.lastInsertRowid);
    res.json({ order_id: r.lastInsertRowid, confirmation_url: d.confirmation.confirmation_url, method: "online" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/contacts', (req, res) => {
    const c = db.prepare('SELECT * FROM contacts WHERE id = 1').get();
    res.json(c || {});
});
app.put('/api/contacts', authMiddleware, adminMiddleware, (req, res) => {
    const { phone, email, address, instagram, telegram, whatsapp, work_hours } = req.body;
    db.prepare(`UPDATE contacts SET phone = ?, email = ?, address = ?, instagram = ?, telegram = ?, whatsapp = ?, work_hours = ?
                WHERE id = 1`)
      .run(phone || '', email || '', address || '', instagram || '', telegram || '', whatsapp || '', work_hours || '');
    res.json(db.prepare('SELECT * FROM contacts WHERE id = 1').get());
});

/* ============================================================
   ОШИБКИ
   ============================================================ */
app.use((err, req, res, next) => {
    if (err) {
        console.error(err);
        const status = err.type === 'entity.too.large' ? 413 : 400;
        return res.status(status).json({ error: status === 413 ? 'Запрос слишком большой' : 'Некорректный запрос' });
    }
    next();
});


/* * ============================================================
   SPA
   ============================================================ */

/* ============================================================
   ЮKASSA: ВЕБХУК (автоматическая смена статуса оплаты)
   ============================================================ */

/* ============================================================
   decrementStock(orderId) — уменьшает сток товаров из заказа
   ============================================================ */
// Run only inside withStockTransaction, shared by all checkout paths.
function withStockTransaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
}
function decrementStock(orderId) {
    const order = db.prepare('SELECT items, stock_decremented FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('Заказ не найден');
    if (order.stock_decremented) return;
    const items = JSON.parse(order.items || '[]');
    if (!Array.isArray(items) || !items.length) throw new Error('Корзина пуста');
    for (const it of items) {
        if (!Number.isSafeInteger(it.qty) || it.qty < 1) throw new Error('Некорректное количество');
        const prod = db.prepare('SELECT id, stock, stock_by_size FROM products WHERE id = ?').get(it.id);
        if (!prod) throw new Error('Товар не найден');
        const sizes = JSON.parse(prod.stock_by_size || '{}');
        const stock = Number(prod.stock);
        if (!Number.isSafeInteger(stock) || stock < it.qty) throw new Error('Недостаточно товара на складе');
        if (Object.keys(sizes).length) {
            if (!Object.hasOwn(sizes, it.size) || !Number.isSafeInteger(Number(sizes[it.size])) || Number(sizes[it.size]) < it.qty) throw new Error('Недостаточно товара выбранного размера');
            sizes[it.size] = Number(sizes[it.size]) - it.qty;
        }
        db.prepare('UPDATE products SET stock = ?, stock_by_size = ? WHERE id = ?').run(stock - it.qty, JSON.stringify(sizes), it.id);
    }
    db.prepare('UPDATE orders SET stock_decremented = 1 WHERE id = ?').run(orderId);
}
function releaseStock(orderId) {
    const order = db.prepare('SELECT items, stock_decremented FROM orders WHERE id = ?').get(orderId);
    if (!order || !order.stock_decremented) return;
    for (const it of JSON.parse(order.items)) {
        const prod = db.prepare('SELECT id, stock, stock_by_size FROM products WHERE id = ?').get(it.id);
        if (!prod) continue;
        const sizes = JSON.parse(prod.stock_by_size || '{}');
        if (Object.hasOwn(sizes, it.size)) sizes[it.size] = Number(sizes[it.size]) + it.qty;
        db.prepare('UPDATE products SET stock = ?, stock_by_size = ? WHERE id = ?').run(Number(prod.stock) + it.qty, JSON.stringify(sizes), it.id);
    }
    db.prepare('UPDATE orders SET stock_decremented = 0 WHERE id = ?').run(orderId);
}

app.post('/api/payment/webhook', async (req, res) => {
    const event = req.body || {};
    if (!['payment.succeeded', 'payment.canceled', 'refund.succeeded'].includes(event.event)) return res.json({ ok: true });
    if (!event.object || typeof event.object.id !== 'string') return res.status(400).json({ error: 'Invalid notification' });
    try {
        // Only authoritative API data may change a payment status. Ignore incoming metadata.
        const isRefund = event.event === 'refund.succeeded';
        const object = await yooGet(isRefund ? 'refunds' : 'payments', event.object.id);
        const payment = isRefund ? await yooGet('payments', object.payment_id) : object;
        const order = db.prepare('SELECT * FROM orders WHERE payment_id = ?').get(payment.id);
        if (!order) return res.json({ ok: true });
        if (!paymentMatchesOrder(payment, order)) return res.status(400).json({ error: 'Payment does not match order' });
        if (isRefund) {
            // A partial refund is not a full-order refund; leave it for manual reconciliation.
            if (object.status === 'succeeded' && object.amount && object.amount.currency === 'RUB'
                && Number(object.amount.value) === Number(order.total)) {
                db.prepare("UPDATE orders SET payment_status = 'refund', paid = 0 WHERE id = ?").run(order.id);
            }
        } else if (payment.status === 'succeeded' && payment.paid === true) {
            // Repeated notifications must not reset fulfillment or overwrite a recorded refund.
            db.prepare("UPDATE orders SET payment_status = 'paid_card', status = CASE WHEN status = 'new' THEN 'processing' ELSE status END, paid = 1 WHERE id = ? AND paid = 0 AND payment_status != 'refund'").run(order.id);
        } else if (payment.status === 'canceled') {
            withStockTransaction(() => {
                const current = db.prepare('SELECT paid, payment_status FROM orders WHERE id = ?').get(order.id);
                if (current && !current.paid && current.payment_status !== 'refund') {
                    releaseStock(order.id);
                    db.prepare("UPDATE orders SET payment_status = 'unpaid', status = 'cancelled' WHERE id = ?").run(order.id);
                }
            });
        }
        return res.json({ ok: true });
    } catch (e) {
        console.error('[webhook] verification unavailable');
        // Ask YooKassa to retry when verification is temporarily unavailable.
        return res.status(503).json({ error: 'Payment verification temporarily unavailable' });
    }
});

/* === ORDERS SSE (admin) === */
const orderClients = new Set();

function streamAuth(req, res, next) {
    if (!req.headers.authorization && typeof req.query.token === 'string') req.headers.authorization = 'Bearer ' + req.query.token;
    authMiddleware(req, res, next);
}
app.get('/api/orders/stream', streamAuth, adminMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    orderClients.add(res);
    res.write('data: {"type":"connected"}\n\n');
    const claims = jwt.decode(req.headers.authorization.replace('Bearer ', ''));
    const hb = setInterval(() => {
        try {
            const current = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
            if (!current || current.role !== 'admin' || !claims.exp || Date.now() >= claims.exp * 1000) return res.end();
            res.write(': ping\n\n');
        } catch (e) { res.end(); }
    }, 15000);
    req.on('close', () => { clearInterval(hb); orderClients.delete(res); });
});

function sseSendToAdmins(payload) {
    const data = 'data: ' + JSON.stringify(payload) + '\n\n';
    orderClients.forEach(res => { try { res.write(data); } catch (e) {} });
}


app.get('/api/online/history', (req, res) => {
    try {
        var date = req.query.date || new Date().toISOString().slice(0, 10);
        var rows = db.prepare('SELECT hour, max_count, sum_count, samples FROM online_log WHERE date = ? ORDER BY hour').all(date);
        var result = [];
        for (var h = 0; h < 24; h++) {
            var found = null;
            for (var i = 0; i < rows.length; i++) if (rows[i].hour === h) { found = rows[i]; break; }
            result.push({
                hour: h,
                max: found ? found.max_count : 0,
                avg: found && found.samples > 0 ? Math.round(found.sum_count / found.samples) : 0
            });
        }
        res.json({ date: date, data: result });
    } catch(e) { res.json({ date: '', data: [], error: e.message }); }
});

app.get('/api/online/dates', (req, res) => {
    try {
        var rows = db.prepare('SELECT DISTINCT date FROM online_log ORDER BY date DESC LIMIT 30').all();
        res.json(rows.map(function(r) { return r.date; }));
    } catch(e) { res.json([]); }
});

app.post('/api/online/ping', (req, res) => {
    try {
        const sid = (req.body && req.body.session_id) || '';
        if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sid)) return res.status(400).json({ error: 'Некорректная сессия' });
        db.prepare('INSERT INTO online_sessions (session_id, last_seen) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen').run(sid, Date.now());
        res.json({ ok: true, online: getOnlineCount() });
    } catch(e) { res.json({ ok: false }); }
});

app.post('/api/online/leave', (req, res) => {
    try {
        const sid = (req.body && req.body.session_id) || '';
        if (sid) db.prepare('DELETE FROM online_sessions WHERE session_id = ?').run(sid);
        res.json({ ok: true });
    } catch(e) { res.json({ ok: false }); }
});

app.get('/api/online/current', (req, res) => {
    res.json({ online: getOnlineCount() });
});

setInterval(function() {
    try { db.prepare('DELETE FROM online_sessions WHERE last_seen < ?').run(Date.now() - 60 * 60 * 1000); } catch(e) {}
}, 10 * 60 * 1000);


app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



try { db.prepare("INSERT INTO settings (key, value) VALUES ('allow_registration', '1') ON CONFLICT(key) DO NOTHING").run(); } catch(e){}
try { db.prepare("INSERT INTO settings (key, value) VALUES ('allow_payment_cash', '1') ON CONFLICT(key) DO NOTHING").run(); } catch(e){}
try { db.prepare("INSERT INTO settings (key, value) VALUES ('allow_payment_online', '1') ON CONFLICT(key) DO NOTHING").run(); } catch(e){}

/* ===== ONLINE COUNTER ===== */
try {
    db.exec('CREATE TABLE IF NOT EXISTS online_sessions (session_id TEXT PRIMARY KEY, last_seen INTEGER)');
} catch(e) {}

function getOnlineCount() {
    try {
        const cutoff = Date.now() - 2 * 60 * 1000;
        const row = db.prepare('SELECT COUNT(*) as cnt FROM online_sessions WHERE last_seen > ?').get(cutoff);
        return row ? row.cnt : 0;
    } catch(e) { return 0; }
}

/* ===== ONLINE LOG (график) ===== */
try {
    db.exec('CREATE TABLE IF NOT EXISTS online_log (date TEXT, hour INTEGER, max_count INTEGER DEFAULT 0, sum_count INTEGER DEFAULT 0, samples INTEGER DEFAULT 0, PRIMARY KEY (date, hour))');
    console.log('[online] таблица online_log готова');
} catch(e) { console.error('[online] online_log:', e.message); }

// Логируем онлайн каждую минуту
setInterval(function() {
    try {
        var cutoff = Date.now() - 2 * 60 * 1000;
        var row = db.prepare('SELECT COUNT(*) as cnt FROM online_sessions WHERE last_seen > ?').get(cutoff);
        var count = row ? row.cnt : 0;
        var now = new Date();
        var date = now.toISOString().slice(0, 10);
        var hour = now.getUTCHours();
        db.prepare('INSERT INTO online_log (date, hour, max_count, sum_count, samples) VALUES (?, ?, ?, ?, 1) ON CONFLICT(date, hour) DO UPDATE SET max_count = MAX(max_count, excluded.max_count), sum_count = sum_count + excluded.sum_count, samples = samples + 1').run(date, hour, count, count);
    } catch(e) {}
}, 60 * 1000);

app.listen(PORT, '127.0.0.1', () => {
    console.log('\nСервер запущен: http://localhost:' + PORT + '\n');
});


// ===== Telegram notifications on order status/payment change =====
function getOrderChatId(orderId) {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) return null;
        // Основной источник: users.email = "tg<CHAT_ID>@vampshmot.bot"
        if (order.user_id) {
            try {
                const u = db.prepare('SELECT email FROM users WHERE id = ?').get(order.user_id);
                if (u && u.email) {
                    const m = /^tg(\d+)@/i.exec(u.email);
                    if (m) return m[1];
                }
            } catch(e) {}
        }
        // Резерв: если в orders появится поле с chat_id
        const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
        for (const f of ['telegram_chat_id','telegram_id','chat_id','tg_chat_id']) {
            if (cols.includes(f) && order[f]) return order[f];
        }
        return null;
    } catch (e) { console.error('[notify] getChatId:', e.message); }
    return null;
}
async function notifyBot(orderId, type, value) {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) { console.log('[notify] no TELEGRAM_BOT_TOKEN'); return; }
        const chatId = getOrderChatId(orderId);
        if (!chatId) { console.log('[notify] no chatId for order', orderId); return; }
        const labels = {
            status: { new: 'Новый', processing: 'В обработке', reserved: 'Резерв', done: 'Выполнен', cancelled: 'Отменён' },
            payment_status: { unpaid: 'Не оплачено', paid: 'Оплачено', refund: 'Возврат', paid_card: 'Оплачено картой' }
        };
        const label = (labels[type] || {})[value] || value;
        const title = type === 'status' ? '📦 Статус вашего заказа изменён' : '💳 Статус оплаты изменён';
        const text = title + '\n' + 'Заказ №' + orderId + '\n' + 'Новое значение: ' + label;
        const resp = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        const j = await resp.json().catch(() => ({}));
        if (!j.ok) console.error('[notify] TG error:', JSON.stringify(j));
        else console.log('[notify] sent to', chatId, 'order', orderId, type, value);
    } catch (e) { console.error('[notify] error:', e.message); }
}
