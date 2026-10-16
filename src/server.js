require('dotenv').config();
const express = require('express');
const path = require('node:path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const pool = require('./db/pool');
const payments = require('./services/payments');
const { csrfToken, verifyCsrf, money } = require('./middleware/security');

const isProd = process.env.NODE_ENV === 'production';
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
// Behind Nginx/Cloudflare/PaaS set TRUST_PROXY=1 so req.ip, rate limits and secure cookies work.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

const gatewayHosts = ['https://securepay.sslcommerz.com', 'https://sandbox.sslcommerz.com'];
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"],
      // The checkout POST redirects to the payment gateway; Chrome enforces form-action on redirects.
      formAction: ["'self'", ...gatewayHosts],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
}));
app.use(morgan(isProd ? 'combined' : 'dev', { skip: (req) => req.path === '/health' }));
app.use(express.urlencoded({ extended: true, limit: '30kb' }));
app.use(express.json({ limit: '30kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { maxAge: isProd ? '30d' : 0, immutable: isProd, index: false, dotfiles: 'deny' }));

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || /replace-with/i.test(process.env.SESSION_SECRET)))
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production');
if (isProd && /ChangeThisPassword/i.test(process.env.ADMIN_PASSWORD || ''))
  console.warn('WARNING: ADMIN_PASSWORD still has the default value. Change it and re-seed or change the password in the admin panel.');

app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-before-use-000000',
  resave: false, saveUninitialized: false, name: 'sunpop.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 8 },
}));
app.use(csrfToken);
app.use(verifyCsrf);

const SITE = {
  name: process.env.STORE_NAME || 'SUNPOP',
  base: String(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  phone: process.env.STORE_PHONE || '',
  email: process.env.STORE_EMAIL || '',
  address: process.env.STORE_ADDRESS || '',
  whatsapp: process.env.STORE_WHATSAPP || '',
  announcement: process.env.STORE_ANNOUNCEMENT || 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি · ঢাকায় দ্রুত ডেলিভারি',
};
app.locals.SITE = SITE;
app.use((req, res, next) => {
  res.locals.money = money;
  res.locals.storeName = SITE.name;
  res.locals.site = SITE;
  res.locals.cart = req.session.cart || {};
  res.locals.cartCount = Object.values(req.session.cart || {}).reduce((n, p) => n + p.quantity, 0);
  res.locals.currentPath = req.path;
  res.locals.onlinePaymentConfigured = payments.configured();
  // SEO defaults; routes override via res.locals
  res.locals.metaDescription = 'বাংলাদেশে স্টাইলিশ সানগ্লাস কিনুন — Aviator, Wayfarer, Round ও আরও অনেক ডিজাইন। ক্যাশ অন ডেলিভারি, সারা দেশে ডেলিভারি।';
  res.locals.canonical = SITE.base + req.path;
  res.locals.ogImage = SITE.base + '/images/banners/banner-1.svg';
  res.locals.ogType = 'website';
  res.locals.jsonLd = null;
  res.locals.noindex = false;
  next();
});

app.use('/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: 'অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।' }));
app.use('/order', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' }));
app.use('/checkout', rateLimit({ windowMs: 10 * 60 * 1000, limit: Number(process.env.CHECKOUT_RATE_LIMIT) || 15, standardHeaders: true, legacyHeaders: false }));

app.use('/', require('./routes/pages'));
app.use('/', require('./routes/shop'));
app.use('/admin', require('./routes/admin'));
app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (e) { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});
app.use((req, res) => res.status(404).render('error', { title: 'Page not found', message: 'এই পেজটি পাওয়া যায়নি।' }));
app.use((err, req, res, next) => {
  console.error({ message: err.message, path: req.path });
  if (res.headersSent) return next(err);
  const client = (err.status && err.status >= 400 && err.status < 500) || String(err.code || '').startsWith('LIMIT_');
  res.status(client ? 400 : 500).render('error', { title: 'Something went wrong', message: isProd && !client ? 'দুঃখিত, একটি সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।' : err.message });
});

// Release stock held by online orders that were never paid (customer closed the gateway page).
function startMaintenance() {
  const minutes = Number(process.env.PENDING_PAYMENT_MINUTES) || 30;
  const tick = () => payments.expirePending(minutes).then(n => n && console.log(`Expired ${n} unpaid online order(s)`)).catch(e => console.error('Expiry job failed:', e.message));
  const t = setInterval(tick, 5 * 60 * 1000); t.unref(); tick();
}
const port = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(port, () => console.log(`${SITE.name} running at http://localhost:${port}`));
  startMaintenance();
}
module.exports = app;
