// Test helpers: isolated test database, tiny cookie-jar HTTP client, fixtures.
const http = require('node:http');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sunglasses_test';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.CHECKOUT_RATE_LIMIT = '10000';
process.env.APP_BASE_URL = 'http://localhost:3000';
const fs = require('node:fs'), path = require('node:path');
const pool = require('../db/pool');

async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
}
async function startApp() {
  const app = require('../server');
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(method, url, { form, multipart, headers = {} } = {}) {
    const h = { ...headers, cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (multipart) body = multipart;
    const res = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await res.text();
    return { status: res.status, text, headers: res.headers, location: res.headers.get('location') };
  }
  get(url) { return this.req('GET', url); }
  post(url, form) { return this.req('POST', url, { form }); }
  async csrf(url = '/cart') { const r = await this.get(url); const m = /(?:name="_csrf" value|name="csrf-token" content)="([a-f0-9]+)"/.exec(r.text); if (!m) throw new Error('no csrf on ' + url); return m[1]; }
}
const ADDR = { full_name: 'Test Buyer', phone: '01712345678', email: '', district: 'Dhaka', area: 'Dhanmondi', address: 'House 1, Road 2', payment_method: 'cod' };
// Adds products to a fresh session's cart and places an order. items: [[productId, qty], ...]
async function placeOrder(base, items, overrides = {}) {
  const c = new Client(base);
  let token = await c.csrf('/cart');
  for (const [id, qty] of items) { const r = await c.post('/cart/add', { _csrf: token, product_id: id, quantity: qty }); if (r.status !== 302) return { client: c, res: r, added: false }; }
  const page = await c.get('/checkout');
  token = /(?:name="_csrf" value|name="csrf-token" content)="([a-f0-9]+)"/.exec(page.text)[1];
  const key = /name="checkout_key" value="([a-f0-9]+)"/.exec(page.text)[1];
  const res = await c.post('/checkout', { _csrf: token, checkout_key: key, ...ADDR, ...overrides });
  const no = /(SUN[0-9A-F]{15})/.exec(res.text)?.[1] || /(SUN[0-9A-F]{15})/.exec(res.location || '')?.[1];
  return { client: c, res, added: true, orderNumber: no, ok: res.status === 200 && !!no };
}
async function addProduct(name, stock, price = 100000) {
  const r = await pool.query("INSERT INTO products(sku,name,slug,price_paisa,stock,is_active) VALUES($1,$2,$3,$4,$5,true) RETURNING id", ['T-' + Math.random().toString(36).slice(2, 8).toUpperCase(), name, name.toLowerCase().replace(/\W+/g, '-') + '-' + Math.random().toString(36).slice(2, 6), price, stock]);
  return r.rows[0].id;
}
const stockOf = async id => (await pool.query('SELECT stock FROM products WHERE id=$1', [id])).rows[0].stock;
async function adminLogin(base, email = 'admin@test.local', password = 'TestPassword123!') {
  const c = new Client(base); const t = await c.csrf('/admin/login');
  const r = await c.post('/admin/login', { _csrf: t, email, password }); return { client: c, ok: r.status === 302 && r.location === '/admin' };
}
function multipartBody(fields, files = []) {
  const boundary = '----t' + Math.random().toString(16).slice(2); const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) { parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`)); parts.push(f.data); parts.push(Buffer.from('\r\n')); }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } };
}
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
module.exports = { pool, resetDb, startApp, Client, placeOrder, addProduct, stockOf, adminLogin, multipartBody, PNG, ADDR, http };
