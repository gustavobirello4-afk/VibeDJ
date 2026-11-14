const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { startServer, waitFor, command, register, queue } = require('./helpers/baseline.cjs');

const tracks = () => [
    { id: 'dQw4w9WgXcQ', title: 'Track A' },
    { id: '9bZkp7q19f0', title: 'Track B' },
    { id: 'kJQP7kiw5Fk', title: 'Track C' }
];

test('HTTP baseline: unchanged HTML, local client, CORS, invalid audio IDs; two transports', async t => {
    const app = await startServer(t);
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('access-control-allow-origin'), '*');
    assert.match(await page.text(), /text\/babel/);
    assert.equal((await fetch(`${app.url}/socket.io/socket.io.js`)).status, 200);
    assert.equal((await fetch(`${app.url}/api/audio/invalid`)).status, 400);
    assert.equal((await fetch(`${app.url}/api/stream/invalid`)).status, 400);
    assert.equal((await fetch(app.url, { method: 'OPTIONS' })).status, 200);
    for (const transport of ['websocket', 'polling']) {
        const { initial } = await app.connect(transport);
        assert.equal(initial.currentTrack, null);
        assert.equal(initial.isPlaying, false);
        assert.deepEqual(initial.djQueue, []);
    }
});

test('two clients: registration, queue/playlist rotation, snapshot, DJ controls and skip', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const user = await register(a, '  Alice  ');
    assert.equal(user.name, 'Alice');
    assert.notEqual(user.id, a.id);
    assert.equal(user.id, user.participantId);
    const bob = await register(b, 'Bob');
    const consumed = waitFor(a, 'playlist_consumed');
    const remote = waitFor(b, 'update_room', s => s.currentTrack?.id === tracks()[0].id);
    const state = await queue(a, tracks());
    assert.equal(state.currentDj.name, 'Alice');
    assert.deepEqual((await consumed).map(x => x.id), [tracks()[1].id, tracks()[2].id, tracks()[0].id]);
    assert.deepEqual(await remote, state);
    await queue(b, [{ id: 'BobTrack001', title: 'Bob' }]);

    const paused = waitFor(b, 'player_action', p => p.action === 'pause');
    assert.equal((await command(a, 'dj_pause')).isPlaying, false);
    assert.equal((await paused).isPlaying, false);
    const seek = waitFor(b, 'player_action', p => p.action === 'seek');
    assert.equal((await command(a, 'dj_seek', '42.5')).currentTime, 42.5);
    assert.equal((await seek).currentTime, 42.5);
    assert.equal((await command(a, 'dj_seek', -1)).currentTime, 42.5);
    assert.equal((await command(a, 'dj_seek', 'invalid')).currentTime, 42.5);
    const playing = waitFor(b, 'player_action', p => p.action === 'play');
    assert.equal((await command(a, 'dj_play')).isPlaying, true);
    assert.equal((await playing).isPlaying, true);

    // Legacy rotation pushes Alice to the tail when starting, before Bob joins.
    // Bob appends behind Alice, so Alice gets one more turn before Bob.
    const repeat = waitFor(b, 'update_room', s => s.currentTrack?.id === tracks()[1].id);
    await command(a, 'skip_track');
    assert.equal((await repeat).currentDj.name, 'Alice');
    const next = waitFor(b, 'update_room', s => s.currentDj?.name === 'Bob');
    await command(a, 'skip_track');
    assert.equal((await next).currentTrack.id, 'BobTrack001');
});

test('distinct-name listener cannot mutate DJ controls or end an active DJ track', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Alice');
    await register(b, 'Bob');
    await queue(a, tracks());
    for (const event of ['dj_pause', 'dj_seek', 'skip_track', 'track_ended']) {
        const state = await command(b, event, 120);
        assert.equal(state.isPlaying, true);
        assert.equal(state.currentTrackId, tracks()[0].id);
        assert.ok(state.currentTime < 10);
    }
    await command(a, 'dj_pause');
    assert.equal((await command(b, 'dj_play')).isPlaying, false);
});

test('playlist update while playing, leaving queue, empty playlists and idle transition', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    await register(a, 'Alice');
    await queue(a, tracks());
    const update = waitFor(a, 'update_room');
    await command(a, 'update_playlist', [tracks()[2]]);
    assert.equal((await update).currentTrack.id, tracks()[0].id);
    const left = await queue(a, []);
    assert.equal(left.djQueue.length, 0);
    // Existing behavior: leaving the queue does not interrupt the current track.
    assert.equal(left.currentDj.name, 'Alice');
    assert.equal(left.currentTrack.id, tracks()[0].id);
    const idle = waitFor(a, 'update_room', s => s.currentTrack === null);
    await command(a, 'skip_track');
    assert.equal((await idle).isPlaying, false);
    assert.equal((await queue(a, [])).currentTrack, null);
});

test('empty DJ is skipped; updating an idle queue starts playback', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Empty');
    await register(b, 'Bob');
    assert.equal((await queue(a, [])).currentTrack, null);
    assert.equal((await queue(b, tracks())).currentDj.name, 'Bob');
    await queue(b, []);
    await command(b, 'skip_track');
    const started = waitFor(a, 'update_room', s => s.currentTrack !== null);
    await command(a, 'update_playlist', [tracks()[1]]);
    assert.equal((await started).currentTrack.id, tracks()[1].id);
});

test('votes are replaceable, keyed by participant ID and reset on track transition', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Alice');
    const bob = await register(b, 'Bob');
    await queue(a, tracks());
    for (const type of ['woot', 'meh', 'unknown']) {
        const votes = waitFor(a, 'update_votes');
        await command(b, 'vote', type);
        const result = await votes;
        assert.equal(result.voters[bob.id], type);
        assert.equal(result.woot, type === 'woot' ? 1 : 0);
        assert.equal(result.meh, type === 'meh' ? 1 : 0);
    }
    const reset = waitFor(b, 'update_room', s => s.currentTrack?.id === tracks()[1].id);
    await command(a, 'skip_track');
    assert.deepEqual((await reset).votes, { woot: 0, meh: 0, voters: {} });
});

test('chat: session identity, trim/500 limit, strings and 100 history', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Alice');
    await register(b, 'Bob');
    let message = waitFor(b, 'new_message');
    await command(a, 'send_message', { text: ` ${'x'.repeat(600)} `, userName: 'Forged' });
    const msg = await message;
    assert.equal(msg.user, 'Alice');
    assert.equal(msg.text.length, 500);
    assert.equal(typeof msg.id, 'string');
    message = waitFor(a, 'new_message');
    await command(b, 'send_message', { text: ' anonymous ', userName: 'Client supplied' });
    assert.equal((await message).user, 'Bob');
    await command(a, 'send_message', '   ');
    for (let i = 0; i < 101; i++) a.emit('send_message', `message-${i}`);
    await command(a, 'request_sync');
    const { initial } = await app.connect();
    assert.equal(initial.messages.length, 100);
    assert.equal(initial.messages[0].text, 'message-1');
    assert.equal(initial.messages[99].text, 'message-100');
});

test('A01/A07 fixed: same nickname has independent identity and cannot take DJ', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const alice = await register(a, 'Alice');
    await queue(a, tracks());
    const other = await register(b, 'Alice');
    assert.notEqual(other.id, alice.id);
    assert.equal((await command(b, 'dj_pause')).isPlaying, true);
    const state = await queue(b, [tracks()[2]]);
    assert.equal(state.currentDj.id, alice.id);
    assert.equal(state.djQueue.length, 2);
    assert.notDeepEqual(state.djQueue[0].playlist, state.djQueue[1].playlist);
});

test('KNOWN BASELINE A06: two DJ ended notifications advance two tracks', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Alice');
    await queue(a, tracks());
    await command(b, 'request_sync');
    const seen = [];
    b.on('update_room', s => seen.push(s.currentTrack?.id));
    const third = waitFor(b, 'update_room', s => s.currentTrack?.id === tracks()[2].id);
    a.emit('track_ended');
    a.emit('track_ended');
    await third;
    assert.deepEqual(seen, [tracks()[1].id, tracks()[2].id]);
});

test('KNOWN BASELINE A04/A05: array items are not validated; full playlists are public', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Alice');
    const update = waitFor(b, 'update_room', s => s.currentTrack !== null);
    await queue(a, [{ id: 'invalid', title: 'x'.repeat(2000), extra: 'public' }]);
    const state = await update;
    assert.equal(state.currentTrack.id, 'invalid');
    assert.equal(state.djQueue[0].playlist[0].extra, 'public');
    assert.equal(state.currentTrack.title.length, 2000);
});

test('credentialed reconnect inside grace preserves identity, queue and playback', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: observer } = await app.connect();
    const alice = await register(a, 'Alice');
    await queue(a, tracks());
    await command(a, 'dj_seek', 30);
    const closed = waitFor(a, 'disconnect');
    a.disconnect();
    await closed;
    const { socket: resumed } = await app.connect();
    const updated = waitFor(observer, 'update_room', s => s.currentDj?.id === alice.id);
    const registered = await register(resumed, 'Alice', {
        resumeToken: alice.resumeToken, resumeRequestId: 'reconnect-request-001'
    });
    assert.equal(registered.id, alice.id);
    assert.notEqual(registered.resumeToken, alice.resumeToken);
    assert.equal((await updated).currentTrack.id, tracks()[0].id);
    assert.ok((await command(resumed, 'request_sync')).currentTime >= 30);
});

test('disconnect expiry after real 15s removes DJ and advances to next participant', { timeout: 25000 }, async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    const alice = await register(a, 'Alice');
    await register(b, 'Bob');
    await queue(a, tracks());
    await queue(b, [tracks()[1]]);
    const next = waitFor(b, 'update_room', s => s.currentDj?.name === 'Bob', 20000);
    a.disconnect();
    const state = await next;
    assert.equal(state.djQueue.some(dj => dj.name === 'Alice'), false);
    const { socket: returned } = await app.connect();
    const identity = await register(returned, 'Alice', {
        resumeToken: alice.resumeToken, resumeRequestId: 'reconnect-after-grace-001'
    });
    assert.equal(identity.id, alice.id);
    const { initial } = await app.connect();
    assert.equal(initial.currentDj.name, 'Bob');
    assert.equal(initial.djQueue.some(dj => dj.id === alice.id), false);
});

test('A06 authorization fixed: anonymous client cannot end with DJ absent after 10s', async t => {
    const app = await startServer(t);
    const { socket: a } = await app.connect();
    const { socket: b } = await app.connect();
    await register(a, 'Alice');
    await queue(a, tracks());
    await command(a, 'dj_seek', 11);
    a.disconnect();
    // Observe actual server-side disconnect, not just the local disconnect call.
    const deadline = Date.now() + 3000;
    while (!app.output().includes('Desconectado:')) {
        assert.ok(Date.now() < deadline, 'Server did not observe disconnect');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const state = await command(b, 'track_ended');
    assert.equal(state.currentTrackId, tracks()[0].id);
});

test('KNOWN BASELINE: numeric chat text crashes disposable server (not a passing safety check)', { timeout: 10000 }, async t => {
    const app = await startServer(t);
    const { socket } = await app.connect();
    await register(socket, 'Authenticated invalid payload');
    const exited = once(app.child, 'exit');
    socket.emit('send_message', { text: 42 });
    const [code] = await exited;
    assert.notEqual(code, 0);
    assert.match(app.output(), /text\.trim is not a function/);
});

test('restart loses room state by current volatile contract', async t => {
    const first = await startServer(t);
    const { socket } = await first.connect();
    await register(socket, 'Alice');
    await queue(socket, tracks());
    await command(socket, 'send_message', 'volatile');
    const exited = once(first.child, 'exit');
    first.child.kill();
    await exited;
    const second = await startServer(t);
    const { initial } = await second.connect();
    assert.equal(initial.currentTrack, null);
    assert.deepEqual(initial.djQueue, []);
    assert.deepEqual(initial.messages, []);
});
