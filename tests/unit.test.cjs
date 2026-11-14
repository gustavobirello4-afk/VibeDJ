const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

// Extract actual legacy functions into a test-only VM, without copying their
// implementation or changing production scripts/HTML. Fail if boundaries move.
function extract(source, declaration, indent) {
    const start = source.indexOf(declaration);
    assert.ok(start >= 0, `Missing declaration: ${declaration}`);
    const end = source.indexOf(`\n${indent}}`, start);
    assert.ok(end > start, `Missing end: ${declaration}`);
    return source.slice(start, end + indent.length + 2).replace(/\r/g, '');
}

const extractId = vm.runInNewContext(`(${extract(html, 'function extractVideoId(url)', '        ')})`);
const format = vm.runInNewContext(`(${extract(html, 'function formatTime(seconds)', '        ')})`);

test('URL baseline: IDs, watch, short URLs, Shorts, live, embed and invalid input', () => {
    const id = 'dQw4w9WgXcQ';
    for (const input of [id, ` https://youtu.be/${id} `,
        `https://www.youtube.com/watch?v=${id}&list=abc`,
        `https://www.youtube.com/watch?list=abc&v=${id}`,
        `https://www.youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`,
        `https://www.youtube-nocookie.com/embed/${id}`, `https://youtube.com/v/${id}`]) {
        assert.equal(extractId(input), id);
    }
    for (const input of ['', null, 'invalid', 'https://youtube.com/watch?v=short']) {
        assert.equal(extractId(input), '');
    }
    // Known baseline: this regex searches for a substring, not a trusted host.
    assert.equal(extractId(`https://evil.invalid/youtube.com/watch?v=${id}`), id);
});

test('time formatting preserves legacy rounding and invalid-value fallback', () => {
    for (const [input, expected] of [[0, '00:00'], [65.9, '01:05'], [3600, '60:00'], [-1, '00:00'], [NaN, '00:00']]) {
        assert.equal(format(input), expected);
    }
});

test('room clock: idle, playing, paused, negative elapsed, legacy falsy startTime', () => {
    const calculate = state => vm.runInNewContext(
        `${extract(server, 'function getRoomCurrentTime()', '')}; getRoomCurrentTime()`,
        { roomState: state, Date: { now: () => 10000 } }
    );
    assert.equal(calculate({}), 0);
    assert.equal(calculate({ currentTrack: {}, startTime: 5000, isPlaying: true }), 5);
    assert.equal(calculate({ currentTrack: {}, startTime: 5000, isPlaying: false, pausedAt: 7500 }), 2.5);
    assert.equal(calculate({ currentTrack: {}, startTime: 12000, isPlaying: true }), 0);
    assert.equal(calculate({ currentTrack: {}, startTime: 0, isPlaying: true }), 0);
});

test('logout UI delegates revocation to session client without deleting playlist/name/volume', () => {
    let revoked = 0;
    const logout = vm.runInNewContext(
        `${extract(html, 'const handleLogout = () =>', '            ')}; handleLogout`,
        { sessionClientRef: { current: { logout() { revoked++; } } } }
    );
    logout();
    assert.equal(revoked, 1);
});

test('KNOWN BASELINE A10: actual sync handler applies an obsolete track response', () => {
    const applied = [];
    const sync = vm.runInNewContext(
        `${extract(html, 'const onSyncTime = (data) =>', '                ')}; onSyncTime`,
        { console: { log() {} }, syncPlayerFnRef: { current: (...args) => applied.push(args) } }
    );
    sync({ currentTime: 42, isPlaying: false, currentTrackId: 'obsolete' });
    assert.deepEqual(applied, [[42, false]]);
});

function playlistHarness(initial, extra = {}) {
    const saved = new Map(), emitted = [];
    let playlist = initial;
    const context = vm.createContext({
        playlist: initial, draggedIndex: 0,
        setPlaylist(value) { playlist = value; context.playlist = value; },
        localStorage: { setItem: (key, value) => saved.set(key, value) },
        socket: { emit: (...args) => emitted.push(args) },
        sessionClientRef: { current: { playlistKey: () => 'vibedj_playlist' } },
        setDraggedIndex() {}, setDragOverIndex() {}, ...extra
    });
    return {
        saved, emitted, playlist: () => JSON.parse(JSON.stringify(playlist)),
        handler(name, declaration) {
            return vm.runInContext(`${extract(html, declaration, '            ')}; ${name}`, context);
        }
    };
}

test('actual playlist handlers: arrows, boundary, drag/drop, removal and persistence', () => {
    const h = playlistHarness([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    const move = h.handler('handleMoveSong', 'const handleMoveSong = (index, direction) =>');
    move(0, -1);
    assert.equal(h.emitted.length, 0);
    move(0, 1);
    assert.deepEqual(h.playlist().map(x => x.id), ['B', 'A', 'C']);
    const drop = h.handler('handleDrop', 'const handleDrop = (e, targetIndex) =>');
    drop({ preventDefault() {} }, 2);
    assert.deepEqual(h.playlist().map(x => x.id), ['A', 'C', 'B']);
    const remove = h.handler('handleRemoveSong', 'const handleRemoveSong = (indexToRemove) =>');
    remove(1);
    assert.deepEqual(h.playlist().map(x => x.id), ['A', 'B']);
    assert.deepEqual(JSON.parse(h.saved.get('vibedj_playlist')), h.playlist());
    assert.equal(h.emitted.length, 3);
    assert.ok(h.emitted.every(([event]) => event === 'update_playlist'));
});

for (const titleAvailable of [true, false]) {
    test(`actual add-song handler: insert at top, noembed ${titleAvailable ? 'title' : 'failure fallback'}`, async () => {
        const requests = [];
        const h = playlistHarness([{ id: 'old' }], {
            videoUrl: 'https://youtu.be/dQw4w9WgXcQ', isAddingTrack: false,
            extractVideoId: extractId, setIsAddingTrack() {}, setVideoUrl() {},
            console: { warn() {} }, alert() { assert.fail('Unexpected invalid URL'); },
            fetch: async url => {
                requests.push(url);
                if (!titleAvailable) throw new Error('Offline fixture');
                return { ok: true, json: async () => ({ title: 'Fixture title' }) };
            }
        });
        await h.handler('handleAddSong', 'const handleAddSong = async (e) =>')({ preventDefault() {} });
        assert.deepEqual(h.playlist(), [
            { id: 'dQw4w9WgXcQ', title: titleAvailable ? 'Fixture title' : 'Vídeo (dQw4w9WgXcQ)' },
            { id: 'old' }
        ]);
        assert.equal(requests.length, 1);
        assert.match(requests[0], /^https:\/\/noembed.com\/embed\?/);
        assert.deepEqual(JSON.parse(h.saved.get('vibedj_playlist')), h.playlist());
        assert.equal(h.emitted[0][0], 'update_playlist');
    });
}
