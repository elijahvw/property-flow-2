// Uses the installed Prisma 7 / PrismaPg adapter and an in-process pg transport.
// No socket, PostgreSQL server, schema reset, or database URL is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { serializable } from '../dist/application.js';

function transport(sqlstate, failures) {
  let attempts = 0;
  class FakePool extends pg.Pool {
    async connect() {
      const connection = new EventEmitter();
      connection.release = () => {};
      connection.query = async query => {
        if (query.text.startsWith('UPDATE')) {
          if (++attempts <= failures)
            throw Object.assign(new Error('injected transport failure'), {code:sqlstate,severity:'ERROR'});
        }
        return {fields:[],rows:[],rowCount:0};
      };
      return connection;
    }
  }
  const db = new PrismaClient({adapter:new PrismaPg(new FakePool())});
  return {db, attempts:()=>attempts};
}
const lock = tx => tx.$queryRaw`UPDATE "User" SET "updatedAt" = "updatedAt" WHERE id = ${'test'} RETURNING id`;
for (const sqlstate of ['40001','40P01']) {
  test(`actual PrismaPg nested ${sqlstate} retries transient failures and succeeds on attempt three`, async t => {
    const f=transport(sqlstate,2);t.after(()=>f.db.$disconnect());
    assert.deepEqual(await serializable(f.db,lock),[]);assert.equal(f.attempts(),3);
  });
  test(`actual PrismaPg nested ${sqlstate} exhausts exactly five attempts with ACCESS_CONFLICT`, async t => {
    const f=transport(sqlstate,Infinity);t.after(()=>f.db.$disconnect());
    await assert.rejects(serializable(f.db,lock),e=>e.statusCode===409&&e.code==='ACCESS_CONFLICT');assert.equal(f.attempts(),5);
  });
}
test('actual PrismaPg unrelated raw SQL errors propagate without retry', async t => {
  const f=transport('23503',Infinity);t.after(()=>f.db.$disconnect());
  await assert.rejects(serializable(f.db,lock),e=>e.code==='P2010'&&e.meta.driverAdapterError.cause.originalCode==='23503');assert.equal(f.attempts(),1);
});
test('unapplied assignment migration sorts after runtime role creation without baseline edits',()=>{
  const root=new URL('../prisma/migrations/',import.meta.url);
  const migrations=readdirSync(root).filter(n=>/^\d/.test(n)).sort();
  const assignments=migrations.filter(n=>n.endsWith('_resident_assignments'));
  assert.deepEqual(assignments,['202610140003_resident_assignments']);
  assert.ok(migrations.indexOf(assignments[0])>migrations.indexOf('202610140002_property_isolation'));
  assert.match(readFileSync(new URL('202610140002_property_isolation/migration.sql',root),'utf8'),/CREATE ROLE propertyflow_runtime/);
});
