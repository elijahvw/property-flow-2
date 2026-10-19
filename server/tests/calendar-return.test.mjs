import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnTo} from '../dist/access.js';
test('sign-in retains dated work and calendar source return filters',()=>{
 for(const path of [
  '/company/work-calendar?month=2026-10&day=2026-10-18&kind=request&propertyId=home&page=2',
  '/company/preventive/plan?calendarMonth=2026-10&calendarDay=2026-10-18&calendarProperty=home&calendarKind=schedule&calendarPage=2',
  '/company/maintenance/request?calendarMonth=2026-10&calendarDay=2026-10-18&calendarKind=request&planId=plan',
  '/company/preventive?q=safety+check&status=active&due=overdue&page=2',
  '/company/vendors?q=Plumbing&page=2',
 ])assert.equal(safeReturnTo(path),path);
 assert.equal(safeReturnTo('/company/work-calendar?month=2026-10&redirect=https://evil.invalid&token=secret'),'/company/work-calendar?month=2026-10');
 assert.equal(safeReturnTo('/company/work-calendar?calendarDay=2026-10-18%0aLocation%3aevil&page=2'),'/company/work-calendar?page=2');
 assert.equal(safeReturnTo('/company/preventive?q='+ 'x'.repeat(201)), '/company/preventive');
});
