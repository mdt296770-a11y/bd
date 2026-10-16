// Integration tests: real Express app + real PostgreSQL (database "sunglasses_test" — it is WIPED on every run).
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs'), path = require('node:path');
const H = require('./helpers');
const { pool } = H;
let base, server;

test.before(async () => {
  await H.resetDb();
  const hash = await bcrypt.hash('TestPassword123!', 4);
  await pool.query("INSERT INTO admins(name,email,password_hash,role) VALUES('Boss','admin@test.local',$1,'admin'),('Mgr','mgr@test.local',$1,'manager')", [hash]);
  await pool.query("INSERT INTO categories(name,slug) VALUES('Aviator','aviator')");
  await pool.query("INSERT INTO banners(title,image_url) VALUES('Hello','/images/banners/banner-1.svg')");
  ({ server, base } = await H.startApp());
});
test.after(async () => { server.close(); await pool.end(); });

test('public pages, SEO files and health check work', async () => {
  const id = await H.addProduct('SEO Test Frame', 5);
  const c = new H.Client(base);
  for (const u of ['/', '/shop', '/shop?category=aviator', '/page/returns', '/page/privacy', '/page/contact', '/cart', '/health']) assert.equal((await c.get(u)).status, 200, u);
  const slug = (await pool.query('SELECT slug FROM products WHERE id=$1', [id])).rows[0].slug;
  const prod = await c.get('/product/' + slug);
  assert.equal(prod.status, 200); assert.match(prod.text, /application\/ld\+json/); assert.match(prod.text, /rel="canonical"/);
  assert.match((await c.get('/sitemap.xml')).text, new RegExp(slug));
  assert.match((await c.get('/robots.txt')).text, /Disallow: \/admin/);
  assert.equal((await c.get('/product/does-not-exist')).status, 404);
  const hdr = (await c.get('/')).headers.get('content-security-policy');
  assert.match(hdr, /form-action 'self' https:\/\/securepay\.sslcommerz\.com/);
});

test('CSRF is enforced, including multipart admin forms', async () => {
  const c = new H.Client(base); await c.csrf();
  assert.equal((await c.post('/cart/add', { product_id: 1, quantity: 1 })).status, 403);
  const mp = H.multipartBody({ x: '1' });
  assert.equal((await c.req('POST', '/admin/products/1/delete', { multipart: mp.body, headers: mp.headers })).status, 403);
  const { client, ok } = await H.adminLogin(base); assert.ok(ok);
  const mp2 = H.multipartBody({ sku: 'X1', name: 'No token', price: '10', stock: '1' });
  assert.equal((await client.req('POST', '/admin/products', { multipart: mp2.body, headers: mp2.headers })).status, 403, 'multipart upload without token must be rejected');
});

test('10 simultaneous orders for 3 units sell exactly 3 and never oversell', async () => {
  const id = await H.addProduct('Scarce Frame', 3);
  const results = await Promise.all(Array.from({ length: 10 }, () => H.placeOrder(base, [[id, 1]])));
  assert.equal(results.filter(r => r.ok).length, 3);
  assert.equal(await H.stockOf(id), 0);
  const n = (await pool.query('SELECT COALESCE(SUM(quantity),0)::int n FROM order_items WHERE product_id=$1', [id])).rows[0].n;
  assert.equal(n, 3);
});

test('concurrent multi-product orders complete without deadlock or negative stock', async () => {
  const a = await H.addProduct('Multi A', 20), b = await H.addProduct('Multi B', 20);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => H.placeOrder(base, i % 2 ? [[a, 1], [b, 1]] : [[b, 1], [a, 1]])));
  assert.equal(results.filter(r => r.ok).length, 20, 'all 20 should succeed: ' + results.filter(r => !r.ok).map(r => r.res.status).join(','));
  assert.equal(await H.stockOf(a), 0); assert.equal(await H.stockOf(b), 0);
});

test('same customer phone reuses one customer row; delivery charge follows config', async () => {
  const id = await H.addProduct('Customer Frame', 10, 100000);
  const r1 = await H.placeOrder(base, [[id, 1]]), r2 = await H.placeOrder(base, [[id, 1]], { district: 'Sylhet' });
  assert.ok(r1.ok && r2.ok);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM customers WHERE phone='01712345678'")).rows[0].n, 1);
  const d = await pool.query('SELECT order_number,delivery_paisa FROM orders WHERE order_number=ANY($1)', [[r1.orderNumber, r2.orderNumber]]);
  const byNo = Object.fromEntries(d.rows.map(x => [x.order_number, Number(x.delivery_paisa)]));
  assert.equal(byNo[r1.orderNumber], 6000); assert.equal(byNo[r2.orderNumber], 12000);
});

test('checkout rejects bad phone numbers and re-using a finished checkout key', async () => {
  const id = await H.addProduct('Validation Frame', 5);
  const bad = await H.placeOrder(base, [[id, 1]], { phone: '12345' });
  assert.equal(bad.res.status, 400); assert.equal(await H.stockOf(id), 5);
  const c = new H.Client(base); let t = await c.csrf('/cart'); await c.post('/cart/add', { _csrf: t, product_id: id, quantity: 1 });
  const page = await c.get('/checkout'); t = /(?:name="_csrf" value|name="csrf-token" content)="([a-f0-9]+)"/.exec(page.text)[1]; const key = /name="checkout_key" value="([a-f0-9]+)"/.exec(page.text)[1];
  assert.equal((await c.post('/checkout', { _csrf: t, checkout_key: key, ...H.ADDR })).status, 200);
  assert.equal((await c.post('/checkout', { _csrf: t, checkout_key: key, ...H.ADDR })).status, 400, 'replayed key must not create a second order');
  assert.equal(await H.stockOf(id), 4);
});

test('order tracking needs the matching phone number', async () => {
  const id = await H.addProduct('Track Frame', 5); const o = await H.placeOrder(base, [[id, 1]]);
  const c = new H.Client(base); const t = await c.csrf('/cart');
  assert.equal((await c.post(`/order/${o.orderNumber}/track`, { _csrf: t, phone: '01999999999' })).status, 404);
  const good = await c.post(`/order/${o.orderNumber}/track`, { _csrf: t, phone: '01712345678' });
  assert.equal(good.status, 200); assert.match(good.text, new RegExp(o.orderNumber));
  assert.doesNotMatch(good.text, /House 1, Road 2/, 'tracking must not reveal the address');
});

test('admin: upload image, gallery, audit log, stock log and file serving', async () => {
  const { client, ok } = await H.adminLogin(base); assert.ok(ok);
  const t = await client.csrf('/admin/products/new');
  const mp = H.multipartBody({ _csrf: t, sku: 'UP-1', name: 'Uploaded Frame', price: '1250.50', stock: '7', is_active: 'on', category_id: '' },
    [{ name: 'image_file', filename: 'a.png', type: 'image/png', data: H.PNG }, { name: 'gallery_files', filename: 'b.png', type: 'image/png', data: H.PNG }]);
  const res = await client.req('POST', '/admin/products', { multipart: mp.body, headers: mp.headers });
  assert.equal(res.status, 302, res.text.slice(0, 200));
  const p = (await pool.query("SELECT * FROM products WHERE sku='UP-1'")).rows[0];
  assert.match(p.image_url, /^\/uploads\/[a-f0-9]{32}\.png$/); assert.equal(p.gallery.length, 1); assert.equal(Number(p.price_paisa), 125050);
  const img = await fetch(base + p.image_url); assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/png/);
  // fake image: text pretending to be PNG
  const bad = H.multipartBody({ _csrf: t, sku: 'UP-2', name: 'Bad', price: '1', stock: '1' }, [{ name: 'image_file', filename: 'x.png', type: 'image/png', data: Buffer.from('<script>alert(1)</script>') }]);
  assert.equal((await client.req('POST', '/admin/products', { multipart: bad.body, headers: bad.headers })).status, 400);
  assert.equal((await pool.query("SELECT 1 FROM products WHERE sku='UP-2'")).rowCount, 0);
  // wrong mimetype
  const svg = H.multipartBody({ _csrf: t, sku: 'UP-3', name: 'Svg', price: '1', stock: '1' }, [{ name: 'image_file', filename: 'x.svg', type: 'image/svg+xml', data: Buffer.from('<svg/>') }]);
  assert.equal((await client.req('POST', '/admin/products', { multipart: svg.body, headers: svg.headers })).status, 400);
  // edit: replace image, remove gallery, change stock -> old files deleted + audit written
  const mp2 = H.multipartBody({ _csrf: t, sku: 'UP-1', name: 'Uploaded Frame', price: '1250.50', stock: '9', is_active: 'on', remove_gallery: p.gallery[0] }, [{ name: 'image_file', filename: 'c.png', type: 'image/png', data: H.PNG }]);
  assert.equal((await client.req('POST', `/admin/products/${p.id}`, { multipart: mp2.body, headers: mp2.headers })).status, 302);
  const p2 = (await pool.query('SELECT * FROM products WHERE id=$1', [p.id])).rows[0];
  assert.notEqual(p2.image_url, p.image_url); assert.equal(p2.gallery.length, 0); assert.equal(p2.stock, 9);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../uploads', path.basename(p.image_url))), false, 'replaced file should be deleted');
  const log = await pool.query("SELECT details FROM admin_audit_logs WHERE action='product.update' AND entity_id=$1", [String(p.id)]);
  assert.deepEqual(log.rows[0].details.stock, [7, 9]);
  // javascript: URL is ignored
  const mp3 = H.multipartBody({ _csrf: t, sku: 'UP-1', name: 'Uploaded Frame', price: '10', stock: '1', image_url: 'javascript:alert(1)' });
  await client.req('POST', `/admin/products/${p.id}`, { multipart: mp3.body, headers: mp3.headers });
  assert.equal((await pool.query('SELECT image_url FROM products WHERE id=$1', [p.id])).rows[0].image_url, p2.image_url);
});

test('manager role cannot reach admin-only pages; unauthenticated users are redirected', async () => {
  assert.equal((await new H.Client(base).get('/admin/products')).location, '/admin/login');
  const { client, ok } = await H.adminLogin(base, 'mgr@test.local'); assert.ok(ok);
  for (const u of ['/admin/banners', '/admin/reports', '/admin/users', '/admin/categories', '/admin/audit']) assert.equal((await client.get(u)).status, 403, u);
  for (const u of ['/admin', '/admin/products', '/admin/orders']) assert.equal((await client.get(u)).status, 200, u);
  assert.equal((await new H.Client(base).post('/admin/login', { email: 'x', password: 'y' })).status, 403, 'login without CSRF token is rejected');
});

test('admin order flow: cancel restores stock, COD delivered becomes paid, returned can restock', async () => {
  const id = await H.addProduct('Flow Frame', 10); const { client } = await H.adminLogin(base);
  const a = await H.placeOrder(base, [[id, 2]]), b = await H.placeOrder(base, [[id, 3]]); assert.equal(await H.stockOf(id), 5);
  const oa = (await pool.query('SELECT id FROM orders WHERE order_number=$1', [a.orderNumber])).rows[0].id, ob = (await pool.query('SELECT id FROM orders WHERE order_number=$1', [b.orderNumber])).rows[0].id;
  const t = await client.csrf('/admin/orders');
  await client.post(`/admin/orders/${oa}/status`, { _csrf: t, order_status: 'cancelled' }); assert.equal(await H.stockOf(id), 7);
  await client.post(`/admin/orders/${oa}/status`, { _csrf: t, order_status: 'pending' });
  assert.equal((await pool.query('SELECT order_status FROM orders WHERE id=$1', [oa])).rows[0].order_status, 'cancelled', 'cancelled orders cannot be reopened');
  for (const s of ['confirmed', 'shipped', 'delivered']) await client.post(`/admin/orders/${ob}/status`, { _csrf: t, order_status: s });
  const o = (await pool.query('SELECT order_status,payment_status FROM orders WHERE id=$1', [ob])).rows[0]; assert.deepEqual(o, { order_status: 'delivered', payment_status: 'paid' });
  await client.post(`/admin/orders/${ob}/status`, { _csrf: t, order_status: 'returned', restock: 'on' }); assert.equal(await H.stockOf(id), 10);
  const csv = await client.get('/admin/orders.csv'); assert.equal(csv.status, 200); assert.match(csv.text, /order_number/);
  assert.equal((await client.get('/admin/reports?from=2020-01-01&to=2099-01-01')).status, 200);
});

test('online payment (mock SSLCommerz): initiate, verified success, duplicate IPN, wrong amount, fail and expiry release stock', async () => {
  const gateway = await new Promise(r => { const s = require('node:http').createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
    if (u.pathname.includes('gwprocess')) { let b = ''; req.on('data', d => b += d); req.on('end', () => { gateway.lastInit = new URLSearchParams(b); res.end(JSON.stringify({ status: 'SUCCESS', GatewayPageURL: 'https://mock.gateway/pay/1' })); }); }
    else { const v = gateway.validations[u.searchParams.get('val_id')]; res.end(JSON.stringify(v || { status: 'INVALID_TRANSACTION' })); }
  }).listen(0, () => r(s)); });
  gateway.validations = {}; Object.assign(process.env, { SSLCOMMERZ_STORE_ID: 'teststore', SSLCOMMERZ_STORE_PASSWORD: 'secret', SSLCOMMERZ_BASE_URL: `http://127.0.0.1:${gateway.address().port}` });
  const id = await H.addProduct('Online Frame 2', 10, 200000);
  const o = await H.placeOrder(base, [[id, 2]], { payment_method: 'online' });
  assert.equal(o.res.status, 303); assert.equal(await H.stockOf(id), 8);
  const no = gateway.lastInit.get('tran_id'), total = gateway.lastInit.get('total_amount');
  assert.equal(total, '4060.00'); assert.equal(gateway.lastInit.get('currency'), 'BDT');
  const cb = new H.Client(base);
  // wrong amount -> not verified, order stays pending
  gateway.validations.V1 = { status: 'VALID', tran_id: no, currency: 'BDT', amount: '1.00' };
  assert.equal((await cb.post('/payments/sslcommerz/ipn', { val_id: 'V1', tran_id: no })).status, 400);
  assert.equal((await pool.query('SELECT payment_status FROM orders WHERE order_number=$1', [no])).rows[0].payment_status, 'pending');
  // forged success: unknown val_id
  assert.equal((await cb.post('/payments/sslcommerz/success', { val_id: 'FAKE', tran_id: no })).status, 400);
  // genuine
  gateway.validations.V2 = { status: 'VALID', tran_id: no, currency: 'BDT', amount: '4060.00' };
  const ok = await cb.post('/payments/sslcommerz/success', { val_id: 'V2', tran_id: no }); assert.equal(ok.status, 200);
  let row = (await pool.query('SELECT payment_status,gateway_reference FROM orders WHERE order_number=$1', [no])).rows[0]; assert.deepEqual(row, { payment_status: 'paid', gateway_reference: 'V2' });
  assert.equal((await cb.post('/payments/sslcommerz/ipn', { val_id: 'V2', tran_id: no })).status, 200, 'duplicate IPN is accepted idempotently');
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM payment_events WHERE event_id='V2'")).rows[0].n, 1);
  // paid order is not cancelled by a late "fail" callback
  await cb.post('/payments/sslcommerz/fail', { tran_id: no }); assert.equal((await pool.query('SELECT order_status FROM orders WHERE order_number=$1', [no])).rows[0].order_status, 'pending');
  assert.equal(await H.stockOf(id), 8);
  // failed payment releases stock
  const f = await H.placeOrder(base, [[id, 3]], { payment_method: 'online' }); const fno = gateway.lastInit.get('tran_id'); assert.equal(await H.stockOf(id), 5);
  assert.equal((await cb.post('/payments/sslcommerz/fail', { tran_id: fno })).status, 400);
  assert.equal(await H.stockOf(id), 8); assert.equal((await pool.query('SELECT order_status,payment_status FROM orders WHERE order_number=$1', [fno])).rows[0].order_status, 'cancelled');
  // abandoned payment expires and releases stock
  await H.placeOrder(base, [[id, 4]], { payment_method: 'online' }); const eno = gateway.lastInit.get('tran_id'); assert.equal(await H.stockOf(id), 4);
  await pool.query("UPDATE orders SET created_at=NOW()-INTERVAL '2 hours' WHERE order_number=$1", [eno]);
  assert.equal(await require('../services/payments').expirePending(30), 1); assert.equal(await H.stockOf(id), 8);
  // cancel callback behaves the same
  await H.placeOrder(base, [[id, 1]], { payment_method: 'online' }); const cno = gateway.lastInit.get('tran_id'); await cb.post('/payments/sslcommerz/cancel', { tran_id: cno });
  assert.equal(await H.stockOf(id), 8);
  gateway.close(); delete process.env.SSLCOMMERZ_STORE_ID; delete process.env.SSLCOMMERZ_STORE_PASSWORD; delete process.env.SSLCOMMERZ_BASE_URL;
});
