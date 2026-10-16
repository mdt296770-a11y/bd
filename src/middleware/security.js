const crypto = require('node:crypto');
const pool = require('../db/pool');

// Upload routes parse multipart bodies with multer, so the token can only be read AFTER multer ran.
// Those routes call verifyCsrfStrict(); the global verifyCsrf defers only for exactly these paths.
const MULTIPART_ROUTES = /^\/admin\/(products(\/\d+)?|banners(\/\d+)?)$/;

function csrfToken(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  next();
}
function tokenMatches(req) {
  const expected = String(req.session?.csrfToken || '');
  const supplied = String((req.body && req.body._csrf) || '');
  return Boolean(expected) && supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
const csrfFail = res => res.status(403).send('নিরাপত্তা যাচাই ব্যর্থ হয়েছে। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।');
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/payments/sslcommerz/')) return next(); // server-to-server/gateway callbacks, validated with the gateway API
  const isMultipart = String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
  if (isMultipart) return MULTIPART_ROUTES.test(req.path) ? next() : csrfFail(res);
  return tokenMatches(req) ? next() : csrfFail(res);
}
function verifyCsrfStrict(req, res, next) { return tokenMatches(req) ? next() : csrfFail(res); }

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  res.locals.admin = req.session.admin;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.session.admin?.role) ? next()
    : res.status(403).render('error', { title: 'অনুমতি নেই', message: 'এই কাজের জন্য আপনার অ্যাকাউন্টের অনুমতি নেই।' });
}
function money(paisa) {
  return new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format(Number(paisa || 0) / 100);
}
// Direct helper: await logAudit(req, 'product.update', 'product', id, {details})
async function logAudit(req, action, type, id, details = {}) {
  try {
    await pool.query('INSERT INTO admin_audit_logs(admin_id,action,entity_type,entity_id,ip_address,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [req.session.admin?.id || null, action, type, String(id ?? ''), req.ip, JSON.stringify(details)]);
  } catch (e) { console.error('Audit log error:', e.message); }
}
// Only same-site paths or https URLs are accepted for admin-entered links/images.
function safeUrl(value, fallback = '') {
  const v = String(value || '').trim();
  if (/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%\/?#]*$/.test(v) || /^https:\/\/[^\s"'<>]+$/i.test(v)) return v.slice(0, 500);
  return fallback;
}
module.exports = { csrfToken, verifyCsrf, verifyCsrfStrict, requireAdmin, requireRole, money, logAudit, safeUrl };
