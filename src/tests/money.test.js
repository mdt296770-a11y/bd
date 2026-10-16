const test=require('node:test');const assert=require('node:assert/strict');
function priceToPaisa(value){return Math.round(Number(value)*100)}
test('price input converts BDT to integer paisa',()=>{assert.equal(priceToPaisa('799.50'),79950);assert.equal(priceToPaisa('0'),0)});
test('invalid price is not a finite amount',()=>{assert.equal(Number.isFinite(priceToPaisa('abc')),false)});
