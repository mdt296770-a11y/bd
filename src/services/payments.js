const pool = require('../db/pool');
const { isValidGatewayPayment } = require('./payment-validation');

function configured() {
  return Boolean(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASSWORD);
}
function baseUrl() {
  const url = String(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return url;
}
function gatewayBase() {
  if (process.env.SSLCOMMERZ_BASE_URL && process.env.NODE_ENV !== 'production') return process.env.SSLCOMMERZ_BASE_URL; // test mock only
  return process.env.SSLCOMMERZ_LIVE === 'true'
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';
}
async function initiate({ order, customer, items }) {
  if (!configured()) throw new Error('অনলাইন পেমেন্ট চালু করতে .env-এ SSLCommerz merchant credentials দিতে হবে।');
  const payload = new URLSearchParams({
    store_id: process.env.SSLCOMMERZ_STORE_ID,
    store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
    total_amount: (Number(order.total_paisa) / 100).toFixed(2),
    currency: 'BDT',
    tran_id: order.order_number,
    success_url: `${baseUrl()}/payments/sslcommerz/success`,
    fail_url: `${baseUrl()}/payments/sslcommerz/fail`,
    cancel_url: `${baseUrl()}/payments/sslcommerz/cancel`,
    ipn_url: `${baseUrl()}/payments/sslcommerz/ipn`,
    shipping_method: 'NO',
    product_name: items.slice(0, 5).map(i => i.product_name).join(', ').slice(0, 200) || 'Sunglasses',
    product_category: 'Fashion accessories',
    product_profile: 'general',
    cus_name: customer.full_name,
    cus_email: customer.email || 'customer@example.com',
    cus_add1: customer.address,
    cus_add2: customer.area,
    cus_city: customer.district,
    cus_state: customer.district,
    cus_postcode: '0000',
    cus_country: 'Bangladesh',
    cus_phone: customer.phone,
    ship_name: customer.full_name,
    ship_add1: customer.address,
    ship_city: customer.district,
    ship_state: customer.district,
    ship_postcode: '0000',
    ship_country: 'Bangladesh',
  });
  const response = await fetch(`${gatewayBase()}/gwprocess/v4/api.php`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: payload,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Payment gateway returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) throw new Error('পেমেন্ট গেটওয়ে সেশন তৈরি করতে পারেনি।');
  return data.GatewayPageURL;
}
async function validateTransaction(valId) {
  if (!configured()) throw new Error('Payment gateway credentials are not configured');
  const url = new URL(`${gatewayBase()}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', process.env.SSLCOMMERZ_STORE_ID);
  url.searchParams.set('store_passwd', process.env.SSLCOMMERZ_STORE_PASSWORD);
  url.searchParams.set('format', 'json');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Payment validation returned HTTP ${response.status}`);
  return response.json();
}
async function processVerifiedPayment({ gateway = 'sslcommerz', eventId, orderNumber, validation }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM orders WHERE order_number=$1 FOR UPDATE', [orderNumber]);
    if (!found.rowCount) throw new Error('Order not found');
    const order = found.rows[0];
    const duplicate = await client.query('SELECT 1 FROM payment_events WHERE gateway=$1 AND event_id=$2', [gateway, String(eventId)]);
    if (duplicate.rowCount) { await client.query('COMMIT'); return { duplicate: true, order }; }
    const verified = isValidGatewayPayment(validation, order) && order.order_status !== 'cancelled';
    if (!verified) { await client.query('COMMIT'); return { duplicate: false, verified: false, order }; }
    await client.query('INSERT INTO payment_events(gateway,event_id,order_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb)', [gateway, String(eventId), order.id, 'payment.verified', JSON.stringify({ status: validation.status, tran_id: validation.tran_id, amount: validation.amount, currency: validation.currency })]);
    if (order.payment_status !== 'paid') await client.query("UPDATE orders SET payment_status='paid',gateway_reference=$1,updated_at=NOW() WHERE id=$2", [String(eventId), order.id]);
    await client.query('COMMIT');
    return { duplicate: false, verified: true, order };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function failOrder(orderNumber, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM orders WHERE order_number=$1 FOR UPDATE', [orderNumber]);
    if (!found.rowCount) { await client.query('COMMIT'); return false; }
    const order = found.rows[0];
    if (order.payment_method === 'online' && order.payment_status !== 'paid' && order.order_status !== 'cancelled') {
      const items = await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1', [order.id]);
      for (const item of items.rows) if (item.product_id) await client.query('UPDATE products SET stock=stock+$1,updated_at=NOW() WHERE id=$2', [item.quantity, item.product_id]);
      await client.query("UPDATE orders SET payment_status='failed',order_status='cancelled',updated_at=NOW() WHERE id=$1", [order.id]);
    }
    await client.query('INSERT INTO payment_events(gateway,event_id,order_id,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(gateway,event_id) DO NOTHING', ['sslcommerz', `${orderNumber}:${reason}`, order.id, `payment.${reason}`, JSON.stringify({ reason })]);
    await client.query('COMMIT'); return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function expirePending(minutes = 30) {
  const r = await pool.query("SELECT order_number FROM orders WHERE payment_method='online' AND payment_status='pending' AND order_status='pending' AND created_at < NOW() - ($1::int * INTERVAL '1 minute') LIMIT 100", [minutes]);
  let n = 0;
  for (const row of r.rows) { if (await failOrder(row.order_number, 'expired')) n++; }
  return n;
}
module.exports = { expirePending, configured, initiate, validateTransaction, processVerifiedPayment, failOrder };
