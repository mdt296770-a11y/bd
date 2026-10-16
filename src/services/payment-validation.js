function isValidGatewayPayment(validation, order) {
  if (!validation || !order) return false;
  const amount = Number(validation.amount);
  return ['VALID', 'VALIDATED'].includes(String(validation.status || '').toUpperCase()) &&
    String(validation.tran_id || '') === String(order.order_number || '') &&
    String(validation.currency || '').toUpperCase() === 'BDT' &&
    Number.isFinite(amount) && amount >= 0 &&
    Math.round(amount * 100) === Number(order.total_paisa);
}
module.exports = { isValidGatewayPayment };
