const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore, SESSION_TTL_MS } = require('../session-store');
const { startServer, waitFor, command, register, queue } = require('./helpers/baseline.cjs');

function auth(socket, data) {
    return new Promise((resolve, reject) => socket.timeout(5000).emit('set_user', data,
        (error, result) => error ? reject(error) : resolve(result)));
}
const song = id => ({ id, title: id });
const resume = (token, requestId = 'resume-attempt-0001') => ({ resumeToken: token, resumeRequestId: requestId });

test('session store: cryptographic opaque IDs/tokens; no credentials in public user', () => {
    const store = createSessionStore();
    const a = store.register('socket-a', { name: 'Same' }).session;
    const b = store.register('socket-b', { name: 'Same' }).session;
    assert.match(a.id, /^[a-f0-9-]{36}$/);
    assert.match(a.token, /^[a-f0-9]{64}$/);
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.token, b.token);
    assert.deepEqual(Object.keys(store.publicUser(a)).sort(), ['avatar', 'id', 'name', 'participantId']);
    assert.equal(store.authorize(a.id, 'socket-b'), null);
    assert.equal(store.register('socket-a', { name: 'Another' }, a.id).session.id, a.id);
});

test('session store: rotation, same-request duplicate, simultaneous replay and old socket invalidation', () => {
    const store = createSessionStore();
    const a = store.register('a', { name: 'DJ' }).session;
    const oldToken = a.token;
    const moved = store.register('b', resume(oldToken));
    const newToken = moved.session.token;
    assert.equal(moved.replacedSocketId, 'a');
    assert.notEqual(oldToken, newToken);
    assert.equal(store.authorize(a.id, 'a'), null);
    assert.equal(store.authorize(a.id, 'b').id, a.id);
    assert.equal(store.register('b', resume(oldToken), a.id).session.token, newToken);
    assert.equal(store.register('c', resume(oldToken)).error, 'session_busy');
    assert.equal(store.register('c', resume(oldToken, 'different-attempt-0001')).error, 'invalid_session');
    const duplicate = store.register('b', resume(newToken), a.id);
    assert.equal(duplicate.session.token, newToken);
});

test('session store: lost rotated response recoverable until confirmation or session expiry', () => {
    let time = 100;
    const store = createSessionStore({ now: () => time });
    const a = store.register('a', { name: 'DJ' }).session;
    const oldToken = a.token;
    const b = store.register('b', resume(oldToken)).session;
    const tokenAfterRotation = b.token;
    assert.equal(store.disconnect(a.id, 'a'), false); // old disconnect cannot detach new owner
    store.disconnect(a.id, 'b');
    const recovered = store.register('c', resume(oldToken));
    assert.equal(recovered.session.token, tokenAfterRotation);
    store.disconnect(a.id, 'c');
    time += 5 * 60 * 1000;
    store.sweep();
    assert.equal(store.register('d', resume(oldToken)).session.token, tokenAfterRotation);
    assert.equal(store.confirm(a.id, 'd', 'wrong', 'resume-attempt-0001'), false);
    assert.equal(store.confirm(a.id, 'd', tokenAfterRotation, 'resume-attempt-0001'), true);
    assert.equal(store.register('e', resume(oldToken)).error, 'invalid_session');
    store.disconnect(a.id, 'd');
    assert.equal(store.register('e', resume(tokenAfterRotation, 'next-attempt-0001')).session.id, a.id);
});

test('session store: invalid, expired, revoked tokens; one cleanup callback; controlled renewal', () => {
    let time = 1;
    const expired = [];
    const store = createSessionStore({ now: () => time, onRevoke: (...args) => expired.push(args) });
    const a = store.register('a', { name: 'A' }).session;
    const token = a.token;
    const deadline = a.expiresAt;
    time += 1000;
    store.authorize(a.id, 'a');
    assert.equal(a.expiresAt, deadline);
    time += 60000;
    store.authorize(a.id, 'a');
    assert.equal(a.expiresAt, time + SESSION_TTL_MS);
    assert.equal(store.register('x', resume('invalid')).error, 'invalid_session');
    time = a.expiresAt;
    assert.equal(store.register('b', resume(token)).error, 'invalid_session');
    store.sweep();
    assert.deepEqual(expired, [[a.id, 'a', 'expired']]);
    const b = store.register('b', { name: 'B' }).session;
    const bToken = b.token;
    assert.equal(store.revoke(b.id), true);
    assert.equal(store.revoke(b.id), false);
    assert.equal(store.register('c', resume(bToken)).error, 'invalid_session');
    assert.equal(store.get(b.id), null);
});

test('server: same-name playlist ownership, votes and playlist notifications are independent', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const ua = await register(a, 'Same');
    const ub = await register(b, 'Same');
    const receivedB = [];
    b.on('playlist_consumed', p => receivedB.push(p));
    await queue(a, [song('AAAAAAAAAAA'), song('BBBBBBBBBBB')]);
    await command(b, 'request_sync');
    assert.equal(receivedB.length, 0);
    await command(b, 'update_playlist', [song('ATTACKER001')]);
    let snapshot = (await app.connect()).initial;
    assert.equal(snapshot.djQueue[0].id, ua.id);
    assert.equal(snapshot.djQueue[0].playlist[0].id, 'BBBBBBBBBBB');
    await queue(b, [song('CCCCCCCCCCC')]);
    await command(b, 'update_playlist', [song('DDDDDDDDDDD')]);
    const voteA = waitFor(a, 'update_votes');
    await command(a, 'vote', 'woot');
    await voteA;
    const voteB = waitFor(a, 'update_votes');
    await command(b, 'vote', 'meh');
    const votes = await voteB;
    assert.equal(votes.voters[ua.id], 'woot');
    assert.equal(votes.voters[ub.id], 'meh');
    snapshot = (await app.connect()).initial;
    assert.equal(snapshot.djQueue.find(d => d.id === ub.id).playlist[0].id, 'DDDDDDDDDDD');
    assert.equal(snapshot.djQueue.find(d => d.id === ua.id).playlist[0].id, 'BBBBBBBBBBB');
});

test('server: replacement disconnects old owner, rejects replay and keeps only one queue entry', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const { socket: attacker } = await app.connect();
    const u = await register(a, 'DJ');
    await queue(a, [song('AAAAAAAAAAA')]);
    const invalidated = waitFor(a, 'session_invalid');
    const disconnected = waitFor(a, 'disconnect');
    const moved = await auth(b, resume(u.resumeToken));
    assert.equal(moved.ok, true);
    assert.equal((await invalidated).reason, 'replaced');
    await disconnected;
    assert.equal(a.connected, false);
    assert.equal((await auth(attacker, resume(u.resumeToken, 'replay-different-001'))).ok, false);
    assert.equal((await command(attacker, 'dj_pause')).isPlaying, true);
    assert.equal((await command(b, 'dj_pause')).isPlaying, false);
    const snapshot = (await app.connect()).initial;
    assert.equal(snapshot.djQueue.length, 1);
    assert.equal(snapshot.currentDj.id, u.id);
});

test('server: simultaneous old-token attempts select one owner; no name takeover fallback', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const { socket: c } = await app.connect();
    const u = await register(a, 'DJ');
    await queue(a, [song('AAAAAAAAAAA')]);
    const result = await Promise.all([
        auth(b, resume(u.resumeToken, 'simultaneous-request-b')),
        auth(c, resume(u.resumeToken, 'simultaneous-request-c'))
    ]);
    assert.equal(result.filter(r => r.ok).length, 1);
    const loser = result[0].ok ? c : b;
    assert.equal((await command(loser, 'dj_pause')).isPlaying, true);
    const snapshot = (await app.connect()).initial;
    assert.equal(snapshot.djQueue.length, 1);
});

test('server: logout revokes token, removes DJ and advances once, repeated logout is harmless', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const ua = await register(a, 'DJ');
    await register(b, 'Next');
    await queue(a, [song('AAAAAAAAAAA')]);
    await queue(b, [song('BBBBBBBBBBB'), song('CCCCCCCCCCC')]);
    const state = waitFor(b, 'update_room', s => s.currentDj?.name === 'Next');
    await command(a, 'logout', {});
    const advanced = await state;
    assert.equal(advanced.currentTrack.id, 'BBBBBBBBBBB');
    assert.equal(advanced.djQueue.length, 1);
    for (const [event, payload] of [['dj_pause'], ['dj_play'], ['dj_seek', 100],
        ['skip_track'], ['track_ended'], ['toggle_queue', [song('ATTACKER001')]],
        ['update_playlist', []], ['vote', 'woot'], ['send_message', 'unauthorized'], ['logout', {}]]) {
        const sync = await command(a, event, payload);
        assert.equal(sync.currentTrackId, 'BBBBBBBBBBB');
        assert.equal(sync.isPlaying, true);
        assert.ok(sync.currentTime < 10);
    }
    const attempted = await auth(a, resume(ua.resumeToken));
    assert.equal(attempted.ok, false);
    const snapshot = (await app.connect()).initial;
    assert.deepEqual(snapshot.messages, []);
    assert.deepEqual(snapshot.votes.voters, {});
    assert.equal(snapshot.djQueue.length, 1);
});

test('server: no token in public events, logs, playlists or other-client registration stream', async t => {
    const app = await startServer(t);
    const { socket: observer } = await app.connect();
    const packets = [];
    observer.onAny((event, payload) => packets.push({ event, payload }));
    const { socket: a } = await app.connect();
    const ua = await register(a, 'DJ');
    await queue(a, [song('AAAAAAAAAAA')]);
    await command(a, 'dj_pause');
    await command(a, 'vote', 'woot');
    await command(a, 'send_message', 'Hello');
    await command(observer, 'request_sync');
    const snapshot = (await app.connect()).initial;
    const serialized = JSON.stringify({ packets, snapshot });
    assert.equal(serialized.includes(ua.resumeToken), false);
    assert.equal(serialized.includes('resumeToken'), false);
    assert.equal(packets.some(p => p.event === 'user_registered'), false);
    assert.equal(app.output().includes(ua.resumeToken), false);
});

test('server: stale credentials after restart are rejected and explicit new login gets new identity', async t => {
    const first = await startServer(t);
    const { socket: a } = await first.connect();
    const ua = await register(a, 'DJ');
    const second = await startServer(t);
    const { socket: b } = await second.connect();
    assert.equal((await auth(b, resume(ua.resumeToken))).code, 'invalid_session');
    const ub = await register(b, 'DJ');
    assert.notEqual(ub.id, ua.id);
});

test('server: correlated logout during first registration revokes even before client knows participant ID', async t => {
    const app = await startServer(t);
    const { socket } = await app.connect();
    const registered = waitFor(socket, 'user_registered');
    socket.emit('set_user', { name: 'Pending', resumeRequestId: 'first-registration-001' });
    const loggedOut = waitFor(socket, 'logged_out');
    socket.emit('logout', { requestId: 'logout-request-001', participantId: null,
        registrationRequestId: 'first-registration-001' });
    const user = await registered;
    assert.equal((await loggedOut).requestId, 'logout-request-001');
    assert.equal((await auth(socket, resume(user.resumeToken))).ok, false);
});

test('server: delayed logout targeting old identity cannot revoke a newer login on the same socket', async t => {
    const app = await startServer(t);
    const { socket } = await app.connect();
    const a = await register(socket, 'A');
    const oldLogout = { requestId: 'logout-request-A', participantId: a.id,
        registrationRequestId: a.resumeRequestId };
    await command(socket, 'logout', oldLogout);
    const b = await register(socket, 'B');
    assert.notEqual(b.id, a.id);
    await queue(socket, [song('BBBBBBBBBBB')]);
    await command(socket, 'logout', oldLogout);
    assert.equal((await command(socket, 'dj_pause')).isPlaying, false, app.output());
    const snapshot = (await app.connect()).initial;
    assert.equal(snapshot.currentDj.id, b.id);
});

test('server: reconnect timer cannot remove resumed DJ after old 15s grace expires', { timeout: 25000 }, async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const ua = await register(a, 'Same');
    const ub = await register(b, 'Same');
    await queue(a, [song('AAAAAAAAAAA')]);
    await queue(b, [song('BBBBBBBBBBB')]);
    a.disconnect();
    const { socket: returned } = await app.connect();
    const result = await auth(returned, resume(ua.resumeToken));
    assert.equal(result.user.id, ua.id);
    const cleared = waitFor(returned, 'update_room', s => !s.djQueue.some(d => d.id === ub.id), 20000);
    b.disconnect();
    const snapshot = await cleared;
    assert.equal(snapshot.currentDj.id, ua.id);
    assert.equal(snapshot.currentTrack.id, 'AAAAAAAAAAA');
    assert.equal(snapshot.djQueue.length, 1);
    assert.equal((await command(returned, 'dj_pause')).isPlaying, false);
});
