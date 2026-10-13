import assert from 'node:assert/strict';
import test from 'node:test';
import { mapUsers, listAdminUsers, createManagementTokenCache, createManagementReader, readError } from '../dist/admin-users.js';

test('role lookups have at most two active calls and preserve user order', async () => {
  let active = 0, maximum = 0;
  const result = await mapUsers([1, 2, 3, 4, 5], async value => {
    active++; maximum = Math.max(active, maximum);
    await new Promise(resolve => setTimeout(resolve, value === 1 ? 10 : 1));
    active--; return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});
test('a failed lookup stops scheduling new users and drains started work', async () => {
  const started = [];
  let finished = false;
  await assert.rejects(mapUsers([1, 2, 3, 4], async value => {
    started.push(value);
    if (value === 1) throw Error('upstream unavailable');
    await new Promise(resolve => setTimeout(resolve, 5));
    finished = true;
  }), /upstream unavailable/);
  assert.deepEqual(started, [1, 2]);
  // The second already-started lookup finishes; no third lookup is scheduled.
  assert.equal(finished, true);
});
test('company filter runs before Auth0 role calls and remote roles do not depend on database defaults', async () => {
  const calls = [];
  const result = await listAdminUsers([
    { user_id: 'a', email: 'a@test.invalid' }, { user_id: 'b', email: 'b@test.invalid' },
  ], [{ id: 'a', companyId: 'one', company: { id: 'one' } }, { id: 'b', companyId: 'two' }],
  async id => { calls.push(id); return [{ name: 'tenant' }, { name: 'admin' }]; }, 'one');
  assert.deepEqual(calls, ['a']);
  assert.equal(result[0].role, 'admin');
  assert.equal(result[0].company.id, 'one');
});
test('a real user with no Auth0 role is shown as unassigned', async () => {
  const result = await listAdminUsers([{ user_id: 'a' }], [], async () => []);
  assert.equal(result[0].role, 'unassigned');
});
test('management token requests are coalesced and expire based on expires_in', async () => {
  let now = 0, count = 0;
  const cache = createManagementTokenCache(async () => {
    count++; await new Promise(resolve => setTimeout(resolve, 2));
    return { access_token: 'token-' + count, expires_in: 10 };
  }, () => now);
  const tokens = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.deepEqual(tokens, ['token-1', 'token-1', 'token-1']);
  assert.equal(count, 1);
  now = 8000; assert.equal(await cache.get(), 'token-1');
  now = 9500; assert.equal(await cache.get(), 'token-2');
});
test('rejected tokens are invalidated without invalidating a newer cached token', async () => {
  let count = 0;
  const cache = createManagementTokenCache(async () => ({ access_token: 'token-' + ++count, expires_in: 100 }));
  const old = await cache.get();
  cache.invalidate(old);
  assert.equal(await cache.get(), 'token-2');
  cache.invalidate(old);
  assert.equal(await cache.get(), 'token-2');
});
test('a failed token fetch can be retried and no invalid token is cached', async () => {
  let count = 0;
  const cache = createManagementTokenCache(async () => {
    if (++count === 1) throw Error('failed');
    return { access_token: 'good', expires_in: 100 };
  });
  await assert.rejects(cache.get());
  assert.equal(await cache.get(), 'good');
  const invalid = createManagementTokenCache(async () => ({ access_token: '', expires_in: 0 }));
  await assert.rejects(invalid.get(), /Auth0 user lookup/);
});
test('Auth0 failures provide safe stage/status/retry metadata without Axios credentials', () => {
  const error = { response: { status: 429, headers: { 'retry-after': '7' } },
    config: { headers: { Authorization: 'Bearer private-token' }, data: 'private-secret' } };
  const converted = readError('roles', error);
  assert.equal(converted.stage, 'roles');
  assert.equal(converted.code, 'AUTH0_RATE_LIMITED');
  assert.equal(converted.retryAfter, 7);
  assert.doesNotMatch(JSON.stringify(converted), /private-token|private-secret/);
  assert.equal(readError('users', { response: { status: 403 } }).code, 'AUTH0_ACCESS_DENIED');
  assert.equal(readError('token', new Error('timeout')).code, 'AUTH0_UNAVAILABLE');
});

test('a rejected management token is renewed once and the same GET is retried', async () => {
  const calls = [], invalidated = [];
  let tokens = 0;
  const read = createManagementReader({
    get: async () => 'token-' + ++tokens, invalidate: token => invalidated.push(token),
  }, async (path, token) => {
    calls.push([path, token]);
    if (token === 'token-1') throw { response: { status: 401 } };
    return ['real-user'];
  });
  assert.deepEqual(await read('users', 'users'), ['real-user']);
  assert.deepEqual(invalidated, ['token-1']);
  assert.deepEqual(calls, [['users', 'token-1'], ['users', 'token-2']]);
});
test('a persistent 401, a permissions failure and rate limiting are never retried indefinitely', async () => {
  for (const [status, expected] of [[401, 2], [403, 1], [429, 1]]) {
    let requests = 0;
    const read = createManagementReader({ get: async () => 'token', invalidate() {} },
      async () => { requests++; throw { response: { status } }; });
    await assert.rejects(read('users', 'users'), error => error.upstreamStatus === status && error.stage === 'users');
    assert.equal(requests, expected);
  }
});
test('token request failures retain safe token-stage diagnostics', async () => {
  const read = createManagementReader({ get: async () => { throw { response: { status: 403 }, config: { secret: 'private-secret' } }; }, invalidate() {} },
    async () => { throw Error('must not be called'); });
  await assert.rejects(read('users', 'users'), error => {
    assert.equal(error.stage, 'token');
    assert.doesNotMatch(JSON.stringify(error), /private-secret/);
    return true;
  });
});
