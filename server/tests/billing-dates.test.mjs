import test from 'node:test';
import assert from 'node:assert/strict';
import {installment} from '../dist/billing-dates.js';
const schedule={firstPeriodOn:new Date('2028-01-01'),lastPeriodOn:new Date('2028-03-01'),firstDueOn:new Date('2027-12-20'),dueDay:31,leadDays:10,amountCents:100001,firstAmountCents:50001,lastAmountCents:30001};
test('billing separates service month, posting, due date and explicit partial amounts',()=>{
 const first=installment(schedule,new Date('2028-01-01'));assert.equal(first.dueOn.toISOString().slice(0,10),'2027-12-20');assert.equal(first.postOn.toISOString().slice(0,10),'2027-12-10');assert.equal(first.amountCents,50001);
 const second=installment(schedule,new Date('2028-02-01'));assert.equal(second.dueOn.toISOString().slice(0,10),'2028-02-29');assert.equal(second.postOn.toISOString().slice(0,10),'2028-02-19');assert.equal(second.amountCents,100001);
 assert.equal(installment(schedule,new Date('2028-03-01')).amountCents,30001);
});
