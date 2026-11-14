const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/session-client');

function harness(initial = null) {
    const records = new Map(initial ? [['vibedj_session', JSON.stringify(initial)]] : []);
    const users = [], notices = [], calls = [], confirmations = [];
    const storage = { getItem: k => records.get(k) || null,
        setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) };
    const socket = { connected: true, timeout() { return this; },
        emit(event, data, callback) {
            if (event === 'confirm_session') confirmations.push(data);
            else calls.push({ event, data, callback });
        }, connect() {} };
    let id = 0;
    const client = create({ socket, storage, randomId: () => `attempt-00000000-${++id}`,
        onUser: u => users.push(u), onInvalid: reason => notices.push(reason) });
    const reply = (call = calls.at(-1), token = 'rotated-token') => {
        const user = { id: 'participant', participantId: 'participant', name: 'DJ', avatar: '🎧',
            resumeToken: token, resumeRequestId: call.data.resumeRequestId };
        client.accept(user);
        call.callback(null, { ok: true, user });
        return user;
    };
    return { client, socket, records, users, notices, calls, confirmations, reply, storage };
}

test('browser: no nickname-only auto-resume; explicit login stores credential only in session storage', () => {
    const h = harness();
    h.client.connect();
    assert.equal(h.calls.length, 0);
    h.client.login('DJ');
    h.reply();
    assert.equal(h.users.length, 1); // private event + ACK deduplicated
    assert.equal(h.users[0].resumeToken, undefined);
    assert.equal(JSON.parse(h.records.get('vibedj_session')).token, 'rotated-token');
    assert.equal(h.client.playlistKey(), 'vibedj_playlist:participant');
    const secondTab = harness();
    secondTab.client.connect();
    assert.equal(secondTab.calls.length, 0);
});

test('browser: timeout retries same handshake; late/duplicate responses do not undo rotated credential', () => {
    const h = harness({ participantId: 'participant', token: 'old-token' });
    h.client.connect();
    const first = h.calls[0];
    const persisted = JSON.parse(h.records.get('vibedj_session'));
    assert.equal(persisted.resumeRequestId, first.data.resumeRequestId);
    first.callback(new Error('lost response'));
    assert.deepEqual(h.calls[1].data, first.data);
    const user = h.reply(h.calls[1], 'new-token');
    h.client.accept({ ...user, resumeToken: 'stale-token' });
    assert.equal(JSON.parse(h.records.get('vibedj_session')).token, 'new-token');
    assert.equal(h.users.length, 1);
});

test('browser: disconnected rotation attempt retains retry ID for the next socket', () => {
    const h = harness({ participantId: 'participant', token: 'old-token' });
    h.client.connect();
    const first = h.calls[0];
    h.client.disconnected();
    h.client.connect();
    assert.equal(h.calls[1].data.resumeRequestId, first.data.resumeRequestId);
    first.callback(null, { ok: false, code: 'invalid_session' });
    h.reply(h.calls[1]);
    assert.equal(h.users.at(-1).id, 'participant');
});

test('browser: offline logout persists revocation tombstone and never exposes resumed DJ', () => {
    const h = harness({ participantId: 'participant', token: 'old-token' });
    h.socket.connected = false;
    h.client.logout();
    assert.equal(h.calls.length, 0);
    assert.equal(JSON.parse(h.records.get('vibedj_session')).logoutPending, true);
    h.socket.connected = true;
    h.client.connect();
    h.reply(h.calls[0]);
    assert.equal(h.calls[1].event, 'logout');
    assert.ok(h.users.every(u => u === null));
    h.calls[1].callback(null, { ok: true, ...h.calls[1].data });
    assert.equal(h.records.has('vibedj_session'), false);
    assert.equal(h.client.playlistKey(), 'vibedj_playlist');
});

test('browser: logout while login is in flight revokes upon registration instead of displaying user', () => {
    const h = harness();
    h.client.login('DJ');
    h.client.logout();
    h.reply(h.calls[0]);
    assert.equal(h.calls[1].event, 'logout');
    assert.ok(h.users.every(u => u === null));
    h.client.loggedOut({ ok: true, ...h.calls[1].data });
    assert.equal(h.records.size, 0);
});

test('browser: invalid/replaced session returns to login; busy proof retained for explicit retry', () => {
    const h = harness({ participantId: 'participant', token: 'old-token' });
    h.client.connect();
    h.client.error({ code: 'session_busy', resumeRequestId: h.calls[0].data.resumeRequestId });
    assert.equal(JSON.parse(h.records.get('vibedj_session')).token, 'old-token');
    assert.equal(h.notices.at(-1), 'session_busy');
    h.client.login('DJ');
    h.client.error({ code: 'invalid_session', resumeRequestId: h.calls[1].data.resumeRequestId });
    assert.equal(h.records.size, 0);
    assert.equal(h.users.at(-1), null);
    h.client.invalid({ reason: 'replaced' });
    assert.equal(h.notices.at(-1), 'replaced');
});

test('browser: failed offline logout recovery after Render restart clears local session without a new login', () => {
    const h = harness({ participantId: 'participant', token: 'old-token', logoutPending: true });
    h.client.connect();
    h.calls[0].callback(null, { ok: false, code: 'invalid_session' });
    assert.equal(h.records.size, 0);
    assert.equal(h.calls.length, 1);
    assert.ok(h.users.every(u => u === null));
});

test('browser: logout is sent while initial registration responses are lost, before timeout retries', () => {
    const h = harness();
    h.client.login('DJ');
    const initial = h.calls[0];
    h.client.logout();
    assert.equal(h.calls[1].event, 'logout');
    assert.equal(h.calls[1].data.registrationRequestId, initial.data.resumeRequestId);
    initial.callback(new Error('lost response'));
    assert.equal(h.calls.length, 2);
    h.calls[1].callback(null, { ok: true, ...h.calls[1].data });
    assert.equal(h.records.size, 0);
    assert.ok(h.users.every(u => u === null));
});

test('browser: delayed logout event/ACK from A cannot clear the logout tombstone of B', () => {
    const h = harness();
    h.client.login('A');
    h.reply();
    h.client.logout();
    const logoutA = h.calls.at(-1);
    const resultA = { ok: true, ...logoutA.data };
    h.client.loggedOut(resultA); // event succeeds, its ACK remains in flight
    h.client.login('B');
    h.reply(h.calls.at(-1), 'B-token');
    h.client.logout();
    const logoutB = h.calls.at(-1);
    logoutA.callback(null, resultA);
    h.client.loggedOut(resultA);
    const saved = JSON.parse(h.records.get('vibedj_session'));
    assert.equal(saved.token, 'B-token');
    assert.equal(saved.logoutPending, true);
    assert.equal(saved.logoutRequestId, logoutB.data.requestId);
    h.client.loggedOut({ ok: true, ...logoutB.data });
    assert.equal(h.records.size, 0);
});
