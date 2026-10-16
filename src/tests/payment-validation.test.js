const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidGatewayPayment } = require('../services/payment-validation');
const order = { order_number: 'SUN123ABC', total_paisa: '125050' };
test('accepts a verified BDT payment with exact order and amount', () => {
  assert.equal(isValidGatewayPayment({status:'VALID',tran_id:'SUN123ABC',currency:'BDT',amount:'1250.50'}, order), true);
});
test('rejects wrong transaction id', () => {
  assert.equal(isValidGatewayPayment({status:'VALID',tran_id:'OTHER',currency:'BDT',amount:'1250.50'}, order), false);
});
test('rejects wrong amount and currency', () => {
  assert.equal(isValidGatewayPayment({status:'VALID',tran_id:'SUN123ABC',currency:'BDT',amount:'1250.49'}, order), false);
  assert.equal(isValidGatewayPayment({status:'VALID',tran_id:'SUN123ABC',currency:'USD',amount:'1250.50'}, order), false);
});
test('rejects pending, malformed, and missing validation payloads', () => {
  assert.equal(isValidGatewayPayment({status:'PENDING',tran_id:'SUN123ABC',currency:'BDT',amount:'1250.50'}, order), false);
  assert.equal(isValidGatewayPayment({status:'VALID',tran_id:'SUN123ABC',currency:'BDT',amount:'not-a-number'}, order), false);
  assert.equal(isValidGatewayPayment(null, order), false);
});
