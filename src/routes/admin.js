const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAdmin, requireRole, verifyCsrfStrict, logAudit, safeUrl } = require('../middleware/security');
const { saveImage, removeUpload } = require('../services/uploads');

const router = express.Router();
const PLACEHOLDER = '/images/products/placeholder.svg';
const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'failed', 'refunded'];
const adminOnly = requireRole('admin');
const imageUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 7 },
  fileFilter: (req, file, cb) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype) ? cb(null, true)
    : cb(Object.assign(new Error('শুধু PNG, JPEG, WebP বা GIF ইমেজ আপলোড করুন।'), { status: 400 })),
});
const productUpload = imageUpload.fields([{ name: 'image_file', maxCount: 1 }, { name: 'gallery_files', maxCount: 5 }]);
const bannerUpload = imageUpload.single('image_file');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pageOf = req => Math.max(1, parseInt(req.query.page, 10) || 1);
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
const toPaisa = v => Math.round(Number(v) * 100);
async function deleteUploadIfUnused(url) {
  if (!/^\/uploads\//.test(url || '')) return;
  const used = await pool.query('SELECT 1 FROM products WHERE image_url=$1 OR gallery ? $1 UNION ALL SELECT 1 FROM banners WHERE image_url=$1 UNION ALL SELECT 1 FROM order_items WHERE image_url=$1 LIMIT 1', [url]);
  if (!used.rowCount) await removeUpload(url);
}

// ---------- auth ----------
router.get('/login', (req, res) => res.render('admin/login', { title: 'Admin login', error: req.query.retry ? 'সেশনের মেয়াদ শেষ হয়েছিল। আবার ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করুন।' : null }));
router.post('/login', wrap(async (req, res, next) => {
  const email = String(req.body.email || '').toLowerCase().trim(), password = String(req.body.password || '');
  const r = await pool.query('SELECT id,name,email,password_hash,role FROM admins WHERE email=$1', [email]);
  if (!r.rowCount || !(await bcrypt.compare(password, r.rows[0].password_hash)))
    return res.status(401).render('admin/login', { title: 'Admin login', error: 'ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।' });
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.admin = { id: r.rows[0].id, name: r.rows[0].name, email: r.rows[0].email, role: r.rows[0].role };
    logAudit(req, 'admin.login', 'admin', r.rows[0].id).finally(() => res.redirect('/admin'));
  });
}));
router.post('/logout', requireAdmin, (req, res) => req.session.destroy(() => res.redirect('/admin/login')));
router.use(requireAdmin);
router.use((req, res, next) => { res.locals.noindex = true; next(); });

// ---------- dashboard ----------
router.get('/', wrap(async (req, res) => {
  const [o, p, s, low, recent, byStatus] = await Promise.all([
    pool.query('SELECT COUNT(*)::int n FROM orders'),
    pool.query('SELECT COUNT(*)::int n FROM products WHERE is_active'),
    pool.query("SELECT COALESCE(SUM(total_paisa),0)::bigint n FROM orders WHERE order_status='delivered'"),
    pool.query('SELECT id,name,sku,stock FROM products WHERE is_active AND stock<5 ORDER BY stock,name LIMIT 8'),
    pool.query('SELECT id,order_number,customer_name,total_paisa,order_status,created_at FROM orders ORDER BY created_at DESC LIMIT 6'),
    pool.query('SELECT order_status s,COUNT(*)::int n FROM orders GROUP BY order_status'),
  ]);
  res.render('admin/dashboard', { title: 'Admin dashboard', stats: { orders: o.rows[0].n, products: p.rows[0].n, low: low.rowCount, sales: s.rows[0].n }, lowStock: low.rows, recent: recent.rows, byStatus: byStatus.rows });
}));

// ---------- products ----------
const PER = 30;
router.get('/products', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80), filter = String(req.query.filter || ''), page = pageOf(req);
  const where = [], args = [];
  if (q) { args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(p.name ILIKE $${args.length} OR p.sku ILIKE $${args.length})`); }
  if (filter === 'low') where.push('p.stock<5 AND p.is_active'); if (filter === 'hidden') where.push('NOT p.is_active');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await pool.query(`SELECT COUNT(*)::int n FROM products p ${w}`, args)).rows[0].n;
  const r = await pool.query(`SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ${w} ORDER BY p.created_at DESC,p.id DESC LIMIT ${PER} OFFSET ${(page - 1) * PER}`, args);
  res.render('admin/products', { title: 'Products', products: r.rows, q, filter, page, pages: Math.max(1, Math.ceil(total / PER)), total });
}));
const categoriesList = async () => (await pool.query('SELECT * FROM categories ORDER BY name')).rows;
router.get('/products/new', wrap(async (req, res) => res.render('admin/product-form', { title: 'Add product', product: null, categories: await categoriesList(), error: null })));
function readProduct(req) {
  const b = req.body, price = toPaisa(b.price), qty = Number(b.stock), cmp = b.compare_at_price ? toPaisa(b.compare_at_price) : null;
  if (!String(b.sku || '').trim() || !String(b.name || '').trim() || String(b.name).length > 160 || !Number.isFinite(price) || price < 0 || !Number.isInteger(qty) || qty < 0 || qty > 100000)
    throw Object.assign(new Error('সঠিক SKU, নাম (সর্বোচ্চ ১৬০ অক্ষর), মূল্য ও শূন্য বা তার বেশি পূর্ণসংখ্যার স্টক দিন।'), { status: 400 });
  if (cmp !== null && (!Number.isFinite(cmp) || cmp < price)) throw Object.assign(new Error('Compare-at মূল্য বিক্রয় মূল্যের সমান বা বেশি হতে হবে।'), { status: 400 });
  return { sku: String(b.sku).trim().toUpperCase().slice(0, 60), name: String(b.name).trim(), description: String(b.description || '').slice(0, 5000), category_id: b.category_id ? Number(b.category_id) : null, price, cmp, qty, active: b.is_active === 'on', featured: b.is_featured === 'on' };
}
async function renderProductError(req, res, e, existing) {
  const product = { ...(existing || {}), ...req.body, id: existing?.id, price_paisa: toPaisa(req.body.price || 0), compare_at_paisa: req.body.compare_at_price ? toPaisa(req.body.compare_at_price) : null, is_active: req.body.is_active === 'on', is_featured: req.body.is_featured === 'on', gallery: existing?.gallery || [] };
  res.status(400).render('admin/product-form', { title: existing ? 'Edit product' : 'Add product', product: existing ? product : { ...product, id: undefined, _new: true }, categories: await categoriesList(), error: e.code === '23505' ? 'এই SKU আগে থেকেই আছে।' : e.message });
}
router.post('/products', productUpload, verifyCsrfStrict, wrap(async (req, res) => {
  try {
    const d = readProduct(req), main = await saveImage(req.files?.image_file?.[0]);
    const gallery = []; for (const f of req.files?.gallery_files || []) gallery.push(await saveImage(f));
    const slug = slugify(d.name) + '-' + Date.now().toString(36);
    const r = await pool.query('INSERT INTO products(sku,name,slug,description,category_id,price_paisa,compare_at_paisa,image_url,gallery,stock,is_active,is_featured) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) RETURNING id',
      [d.sku, d.name, slug, d.description, d.category_id, d.price, d.cmp, main || safeUrl(req.body.image_url, PLACEHOLDER), JSON.stringify(gallery), d.qty, d.active, d.featured]);
    await logAudit(req, 'product.create', 'product', r.rows[0].id, { sku: d.sku, price: d.price, stock: d.qty });
    res.redirect('/admin/products');
  } catch (e) { if (e.code === '23505' || e.status === 400) return renderProductError(req, res, e, null); throw e; }
}));
router.get('/products/:id(\\d+)/edit', wrap(async (req, res) => {
  const p = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
  if (!p.rowCount) return res.status(404).render('error', { title: 'Not found', message: 'পণ্য পাওয়া যায়নি।' });
  res.render('admin/product-form', { title: 'Edit product', product: p.rows[0], categories: await categoriesList(), error: null });
}));
router.post('/products/:id(\\d+)', productUpload, verifyCsrfStrict, wrap(async (req, res) => {
  const old = (await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!old) return res.status(404).render('error', { title: 'Not found', message: 'পণ্য পাওয়া যায়নি।' });
  try {
    const d = readProduct(req), uploaded = await saveImage(req.files?.image_file?.[0]);
    const remove = [].concat(req.body.remove_gallery || []).map(String);
    let gallery = (old.gallery || []).filter(u => !remove.includes(u));
    for (const f of req.files?.gallery_files || []) gallery.push(await saveImage(f));
    gallery = gallery.slice(0, 6);
    const image = uploaded || safeUrl(req.body.image_url, old.image_url);
    await pool.query('UPDATE products SET sku=$1,name=$2,description=$3,category_id=$4,price_paisa=$5,compare_at_paisa=$6,image_url=$7,gallery=$8::jsonb,stock=$9,is_active=$10,is_featured=$11,updated_at=NOW() WHERE id=$12',
      [d.sku, d.name, d.description, d.category_id, d.price, d.cmp, image, JSON.stringify(gallery), d.qty, d.active, d.featured, old.id]);
    const changes = {};
    if (Number(old.price_paisa) !== d.price) changes.price = [Number(old.price_paisa), d.price];
    if (old.stock !== d.qty) changes.stock = [old.stock, d.qty];
    if (old.is_active !== d.active) changes.active = [old.is_active, d.active];
    await logAudit(req, 'product.update', 'product', old.id, changes);
    if (image !== old.image_url) await deleteUploadIfUnused(old.image_url);
    for (const u of (old.gallery || [])) if (!gallery.includes(u)) await deleteUploadIfUnused(u);
    res.redirect('/admin/products');
  } catch (e) { if (e.code === '23505' || e.status === 400) return renderProductError(req, res, e, old); throw e; }
}));
router.post('/products/:id(\\d+)/toggle', wrap(async (req, res) => {
  const r = await pool.query('UPDATE products SET is_active=NOT is_active,updated_at=NOW() WHERE id=$1 RETURNING is_active', [req.params.id]);
  if (r.rowCount) await logAudit(req, r.rows[0].is_active ? 'product.show' : 'product.hide', 'product', req.params.id);
  res.redirect(req.get('referer') && /^https?:\/\/[^/]+\/admin\//.test(req.get('referer')) ? req.get('referer') : '/admin/products');
}));
router.post('/products/:id(\\d+)/delete', wrap(async (req, res) => { // kept for backward compatibility: hides the product
  await pool.query('UPDATE products SET is_active=false,updated_at=NOW() WHERE id=$1', [req.params.id]);
  await logAudit(req, 'product.hide', 'product', req.params.id); res.redirect('/admin/products');
}));
router.post('/products/:id(\\d+)/stock', wrap(async (req, res) => {
  const qty = Number(req.body.stock);
  if (!Number.isInteger(qty) || qty < 0 || qty > 100000) return res.status(400).render('error', { title: 'Invalid', message: 'স্টক শূন্য বা তার বেশি পূর্ণসংখ্যা হতে হবে।' });
  const old = await pool.query('SELECT stock FROM products WHERE id=$1', [req.params.id]);
  const r = await pool.query('UPDATE products SET stock=$1,updated_at=NOW() WHERE id=$2 RETURNING id', [qty, req.params.id]);
  if (r.rowCount) await logAudit(req, 'product.stock', 'product', req.params.id, { stock: [old.rows[0]?.stock, qty] });
  res.redirect(req.get('referer') && /^https?:\/\/[^/]+\/admin\//.test(req.get('referer')) ? req.get('referer') : '/admin/products');
}));

// ---------- categories (admin only) ----------
router.get('/categories', adminOnly, wrap(async (req, res) => {
  const r = await pool.query('SELECT c.*,COUNT(p.id)::int n FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.name');
  res.render('admin/categories', { title: 'Categories', categories: r.rows, error: req.query.error || null });
}));
router.post('/categories', adminOnly, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.redirect('/admin/categories?error=' + encodeURIComponent('নাম দিন।'));
  try { const r = await pool.query('INSERT INTO categories(name,slug) VALUES($1,$2) RETURNING id', [name, slugify(name)]); await logAudit(req, 'category.create', 'category', r.rows[0].id, { name }); }
  catch (e) { if (e.code === '23505') return res.redirect('/admin/categories?error=' + encodeURIComponent('এই নামের ক্যাটাগরি আগে থেকেই আছে।')); throw e; }
  res.redirect('/admin/categories');
}));
router.post('/categories/:id(\\d+)', adminOnly, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60); if (!name) return res.redirect('/admin/categories');
  try { await pool.query('UPDATE categories SET name=$1 WHERE id=$2', [name, req.params.id]); await logAudit(req, 'category.rename', 'category', req.params.id, { name }); }
  catch (e) { if (e.code === '23505') return res.redirect('/admin/categories?error=' + encodeURIComponent('এই নামের ক্যাটাগরি আগে থেকেই আছে।')); throw e; }
  res.redirect('/admin/categories');
}));
router.post('/categories/:id(\\d+)/delete', adminOnly, wrap(async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]); await logAudit(req, 'category.delete', 'category', req.params.id); res.redirect('/admin/categories');
}));

// ---------- orders ----------
function orderFilter(req) {
  const q = String(req.query.q || '').trim().slice(0, 60), status = STATUSES.includes(req.query.status) ? req.query.status : '', pay = PAYMENT_STATUSES.includes(req.query.payment) ? req.query.payment : '';
  const where = [], args = [];
  if (q) { args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(order_number ILIKE $${args.length} OR phone ILIKE $${args.length} OR customer_name ILIKE $${args.length})`); }
  if (status) { args.push(status); where.push(`order_status=$${args.length}`); }
  if (pay) { args.push(pay); where.push(`payment_status=$${args.length}`); }
  return { q, status, pay, w: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}
router.get('/orders', wrap(async (req, res) => {
  const f = orderFilter(req), page = pageOf(req);
  const total = (await pool.query(`SELECT COUNT(*)::int n FROM orders ${f.w}`, f.args)).rows[0].n;
  const r = await pool.query(`SELECT * FROM orders ${f.w} ORDER BY created_at DESC LIMIT ${PER} OFFSET ${(page - 1) * PER}`, f.args);
  res.render('admin/orders', { title: 'Orders', orders: r.rows, q: f.q, status: f.status, payment: f.pay, page, pages: Math.max(1, Math.ceil(total / PER)), total, STATUSES, PAYMENT_STATUSES });
}));
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
router.get('/orders.csv', wrap(async (req, res) => {
  const f = orderFilter(req);
  const r = await pool.query(`SELECT * FROM orders ${f.w} ORDER BY created_at DESC LIMIT 5000`, f.args);
  const head = ['order_number', 'created_at', 'customer', 'phone', 'district', 'area', 'address', 'subtotal_bdt', 'delivery_bdt', 'total_bdt', 'payment_method', 'payment_status', 'order_status'];
  const lines = [head.join(',')].concat(r.rows.map(o => [o.order_number, o.created_at.toISOString(), o.customer_name, o.phone, o.district, o.area, o.address, o.subtotal_paisa / 100, o.delivery_paisa / 100, o.total_paisa / 100, o.payment_method, o.payment_status, o.order_status].map(csvCell).join(',')));
  await logAudit(req, 'orders.export', 'order', '', { rows: r.rowCount });
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="orders.csv"').send('\ufeff' + lines.join('\r\n'));
}));
router.get('/orders/:id(\\d+)', wrap(async (req, res) => {
  const o = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
  if (!o.rowCount) return res.status(404).render('error', { title: 'Not found', message: 'অর্ডার পাওয়া যায়নি।' });
  const [items, events] = await Promise.all([pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [req.params.id]), pool.query('SELECT event_type,processed_at FROM payment_events WHERE order_id=$1 ORDER BY id', [req.params.id])]);
  res.render('admin/order-detail', { title: 'Order ' + o.rows[0].order_number, order: o.rows[0], items: items.rows, events: events.rows, STATUSES, PAYMENT_STATUSES, error: req.query.error || null });
}));
router.post('/orders/:id(\\d+)/status', wrap(async (req, res) => {
  const next = req.body.order_status, restockOnReturn = req.body.restock === 'on';
  const back = id => `/admin/orders/${id}`;
  if (!STATUSES.includes(next)) return res.status(400).send('Invalid order status');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const old = await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!old.rowCount) throw Object.assign(new Error('অর্ডার পাওয়া যায়নি।'), { status: 400 });
    const o = old.rows[0];
    if (o.order_status === next) { await c.query('COMMIT'); return res.redirect(back(o.id)); }
    if (o.order_status === 'cancelled') throw Object.assign(new Error('বাতিল অর্ডার পুনরায় চালু করা যাবে না; নতুন অর্ডার তৈরি করুন।'), { status: 400 });
    if (o.order_status === 'returned') throw Object.assign(new Error('Returned অর্ডারের স্ট্যাটাস আর বদলানো যাবে না।'), { status: 400 });
    if (next === 'cancelled' && o.order_status === 'delivered') throw Object.assign(new Error('ডেলিভারি সম্পন্ন অর্ডার বাতিল না করে Returned ব্যবহার করুন।'), { status: 400 });
    if (next === 'returned' && !['shipped', 'delivered'].includes(o.order_status)) throw Object.assign(new Error('শুধু Shipped বা Delivered অর্ডার Returned করা যায়।'), { status: 400 });
    if (next === 'delivered' && o.payment_method === 'online' && o.payment_status !== 'paid') throw Object.assign(new Error('অনলাইন পেমেন্ট নিশ্চিত না হওয়া পর্যন্ত অর্ডার Delivered করা যাবে না।'), { status: 400 });
    if (o.payment_method === 'online' && o.payment_status === 'pending' && next !== 'cancelled') throw Object.assign(new Error('অনলাইন পেমেন্ট এখনো pending; পেমেন্ট নিশ্চিত হওয়ার পর স্ট্যাটাস বদলান।'), { status: 400 });
    const restock = next === 'cancelled' || (next === 'returned' && restockOnReturn);
    if (restock) {
      const items = await c.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id', [o.id]);
      for (const i of items.rows) if (i.product_id) await c.query('UPDATE products SET stock=stock+$1,updated_at=NOW() WHERE id=$2', [i.quantity, i.product_id]);
    }
    await c.query(`UPDATE orders SET order_status=$1::text,
      payment_status=CASE WHEN $1::text='cancelled' AND payment_method='online' AND payment_status='pending' THEN 'failed'
                          WHEN $1::text='delivered' AND payment_method='cod' AND payment_status='unpaid' THEN 'paid' ELSE payment_status END,updated_at=NOW() WHERE id=$2`, [next, o.id]);
    await c.query('COMMIT');
    await logAudit(req, 'order.status', 'order', o.id, { from: o.order_status, to: next, restock });
    res.redirect(back(o.id));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.status === 400) return res.redirect(`/admin/orders/${req.params.id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  } finally { c.release(); }
}));
router.post('/orders/:id(\\d+)/payment', adminOnly, wrap(async (req, res) => {
  const next = req.body.payment_status; if (!PAYMENT_STATUSES.includes(next)) return res.status(400).send('Invalid payment status');
  const o = (await pool.query('SELECT payment_method,payment_status FROM orders WHERE id=$1', [req.params.id])).rows[0];
  if (!o) return res.status(404).send('Not found');
  if (o.payment_method === 'online' && next === 'paid' && o.payment_status !== 'paid') return res.redirect(`/admin/orders/${req.params.id}?error=${encodeURIComponent('অনলাইন অর্ডারকে হাতে paid করা যাবে না; গেটওয়ে যাচাইয়ের মাধ্যমেই হবে।')}`);
  await pool.query('UPDATE orders SET payment_status=$1,updated_at=NOW() WHERE id=$2', [next, req.params.id]);
  await logAudit(req, 'order.payment', 'order', req.params.id, { from: o.payment_status, to: next });
  res.redirect(`/admin/orders/${req.params.id}`);
}));

// ---------- banners (admin only) ----------
router.get('/banners', adminOnly, wrap(async (req, res) => res.render('admin/banners', { title: 'Banners', banners: (await pool.query('SELECT * FROM banners ORDER BY sort_order,id')).rows, error: req.query.error || null })));
router.post('/banners', adminOnly, bannerUpload, verifyCsrfStrict, wrap(async (req, res) => {
  const img = (await saveImage(req.file)) || safeUrl(req.body.image_url), title = String(req.body.title || '').trim().slice(0, 120);
  if (!img || !title) return res.redirect('/admin/banners?error=' + encodeURIComponent('শিরোনাম ও ছবি দিন।'));
  const r = await pool.query('INSERT INTO banners(title,subtitle,image_url,cta_label,cta_url,sort_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [title, String(req.body.subtitle || '').slice(0, 200), img, String(req.body.cta_label || 'Shop Now').slice(0, 40), safeUrl(req.body.cta_url, '/shop'), Number(req.body.sort_order) || 0, req.body.is_active === 'on']);
  await logAudit(req, 'banner.create', 'banner', r.rows[0].id); res.redirect('/admin/banners');
}));
router.post('/banners/:id(\\d+)', adminOnly, bannerUpload, verifyCsrfStrict, wrap(async (req, res) => {
  const old = (await pool.query('SELECT image_url FROM banners WHERE id=$1', [req.params.id])).rows[0]; if (!old) return res.status(404).send('Not found');
  const img = (await saveImage(req.file)) || safeUrl(req.body.image_url, old.image_url), title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) return res.redirect('/admin/banners?error=' + encodeURIComponent('শিরোনাম দিন।'));
  await pool.query('UPDATE banners SET title=$1,subtitle=$2,image_url=$3,cta_label=$4,cta_url=$5,sort_order=$6,is_active=$7 WHERE id=$8', [title, String(req.body.subtitle || '').slice(0, 200), img, String(req.body.cta_label || 'Shop Now').slice(0, 40), safeUrl(req.body.cta_url, '/shop'), Number(req.body.sort_order) || 0, req.body.is_active === 'on', req.params.id]);
  await logAudit(req, 'banner.update', 'banner', req.params.id); if (img !== old.image_url) await deleteUploadIfUnused(old.image_url);
  res.redirect('/admin/banners');
}));
router.post('/banners/:id(\\d+)/delete', adminOnly, wrap(async (req, res) => {
  const old = (await pool.query('DELETE FROM banners WHERE id=$1 RETURNING image_url', [req.params.id])).rows[0];
  await logAudit(req, 'banner.delete', 'banner', req.params.id); if (old) await deleteUploadIfUnused(old.image_url); res.redirect('/admin/banners');
}));

// ---------- reports (admin only) ----------
router.get('/reports', adminOnly, wrap(async (req, res) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/, today = new Date().toISOString().slice(0, 10), ago = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const from = iso.test(req.query.from || '') ? req.query.from : ago, to = iso.test(req.query.to || '') ? req.query.to : today;
  const range = "created_at >= $1::date AND created_at < ($2::date + 1)";
  const [daily, summary, top, status] = await Promise.all([
    pool.query(`SELECT DATE(created_at) AS day,COUNT(*)::int AS orders,COALESCE(SUM(total_paisa),0)::bigint AS gross FROM orders WHERE order_status='delivered' AND ${range} GROUP BY 1 ORDER BY 1 DESC`, [from, to]),
    pool.query(`SELECT COUNT(*) FILTER(WHERE order_status='delivered')::int delivered,COALESCE(SUM(total_paisa) FILTER(WHERE order_status='delivered'),0)::bigint gross,COUNT(*)::int placed,COUNT(*) FILTER(WHERE order_status IN('cancelled','returned'))::int lost FROM orders WHERE ${range}`, [from, to]),
    pool.query(`SELECT i.product_name,i.sku,SUM(i.quantity)::int qty,SUM(i.line_total_paisa)::bigint revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.order_status='delivered' AND o.${range} GROUP BY 1,2 ORDER BY revenue DESC LIMIT 10`, [from, to]),
    pool.query(`SELECT order_status s,COUNT(*)::int n FROM orders WHERE ${range} GROUP BY 1 ORDER BY 2 DESC`, [from, to]),
  ]);
  res.render('admin/reports', { title: 'Reports', rows: daily.rows, summary: summary.rows[0], top: top.rows, status: status.rows, from, to });
}));

// ---------- audit log, account, admin users ----------
router.get('/audit', adminOnly, wrap(async (req, res) => {
  const page = pageOf(req);
  const r = await pool.query(`SELECT l.*,a.email FROM admin_audit_logs l LEFT JOIN admins a ON a.id=l.admin_id ORDER BY l.created_at DESC,l.id DESC LIMIT ${PER} OFFSET ${(page - 1) * PER}`);
  const total = (await pool.query('SELECT COUNT(*)::int n FROM admin_audit_logs')).rows[0].n;
  res.render('admin/audit', { title: 'Activity log', logs: r.rows, page, pages: Math.max(1, Math.ceil(total / PER)) });
}));
const strongPassword = p => typeof p === 'string' && p.length >= 10 && p.length <= 100 && /[a-z]/i.test(p) && /\d/.test(p);
router.get('/account', (req, res) => res.render('admin/account', { title: 'My account', error: null, ok: req.query.ok === '1' }));
router.post('/account/password', wrap(async (req, res) => {
  const { current, next, confirm } = req.body, fail = m => res.status(400).render('admin/account', { title: 'My account', error: m, ok: false });
  const r = await pool.query('SELECT password_hash FROM admins WHERE id=$1', [req.session.admin.id]);
  if (!r.rowCount || !(await bcrypt.compare(String(current || ''), r.rows[0].password_hash))) return fail('বর্তমান পাসওয়ার্ড সঠিক নয়।');
  if (next !== confirm) return fail('নতুন পাসওয়ার্ড দুটি মেলেনি।');
  if (!strongPassword(next)) return fail('পাসওয়ার্ড কমপক্ষে ১০ অক্ষরের হতে হবে এবং অক্ষর ও সংখ্যা থাকতে হবে।');
  await pool.query('UPDATE admins SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(next, 12), req.session.admin.id]);
  await logAudit(req, 'admin.password', 'admin', req.session.admin.id); res.redirect('/admin/account?ok=1');
}));
router.get('/users', adminOnly, wrap(async (req, res) => res.render('admin/users', { title: 'Team', users: (await pool.query('SELECT id,name,email,role,created_at FROM admins ORDER BY id')).rows, error: req.query.error || null })));
router.post('/users', adminOnly, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80), email = String(req.body.email || '').trim().toLowerCase().slice(0, 120), role = req.body.role === 'admin' ? 'admin' : 'manager';
  const bad = m => res.redirect('/admin/users?error=' + encodeURIComponent(m));
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('সঠিক নাম ও ইমেইল দিন।');
  if (!strongPassword(req.body.password)) return bad('পাসওয়ার্ড কমপক্ষে ১০ অক্ষরের হতে হবে এবং অক্ষর ও সংখ্যা থাকতে হবে।');
  try { const r = await pool.query('INSERT INTO admins(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id', [name, email, await bcrypt.hash(req.body.password, 12), role]); await logAudit(req, 'admin.create', 'admin', r.rows[0].id, { email, role }); }
  catch (e) { if (e.code === '23505') return bad('এই ইমেইল আগে থেকেই আছে।'); throw e; }
  res.redirect('/admin/users');
}));
router.post('/users/:id(\\d+)/delete', adminOnly, wrap(async (req, res) => {
  if (Number(req.params.id) === req.session.admin.id) return res.redirect('/admin/users?error=' + encodeURIComponent('নিজের অ্যাকাউন্ট মোছা যাবে না।'));
  await pool.query('DELETE FROM admins WHERE id=$1', [req.params.id]); await logAudit(req, 'admin.delete', 'admin', req.params.id); res.redirect('/admin/users');
}));
module.exports = router;
