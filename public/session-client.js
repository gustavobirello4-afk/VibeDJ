(function (root) {
    function create({ socket, storage, onUser, onInvalid, randomId = () => crypto.randomUUID() }) {
        const key = 'vibedj_session';
        let memory = null;
        let pending = null;
        let loggingOut = false;
        let logoutAttempt = null;
        function read() {
            try { memory = JSON.parse(storage.getItem(key)) || memory; } catch (_) {}
            return memory;
        }
        function save(record) {
            memory = record;
            try {
                if (record) storage.setItem(key, JSON.stringify(record));
                else storage.removeItem(key);
            } catch (_) {} // Current connection works even if tab storage is unavailable.
        }
        function clear(reason) {
            pending = null;
            loggingOut = false;
            logoutAttempt = null;
            save(null);
            onUser(null);
            if (reason) onInvalid(reason);
        }
        function loggedOut(result) {
            if (!result?.ok || !logoutAttempt) return;
            const data = logoutAttempt.data;
            if (result.requestId === data.requestId &&
                result.registrationRequestId === data.registrationRequestId &&
                result.participantId === data.participantId) clear();
        }
        function sendLogout() {
            if (!socket.connected) return;
            const record = read();
            if (!record?.logoutPending) return;
            const attempt = { data: { requestId: record.logoutRequestId,
                participantId: record.participantId || null,
                registrationRequestId: record.registrationRequestId || null } };
            logoutAttempt = attempt;
            socket.timeout(5000).emit('logout', attempt.data, (error, result) => {
                if (logoutAttempt === attempt && !error) loggedOut(result);
                // If the response was lost, retain the private logout tombstone.
                // Reconnect must revoke before exposing a resumed user.
            });
        }
        function accept(user) {
            if (!pending || user.resumeRequestId !== pending.data.resumeRequestId) return;
            const logoutPending = loggingOut || read()?.logoutPending || false;
            const previous = read();
            save({ participantId: user.participantId, token: user.resumeToken,
                logoutPending, logoutRequestId: previous?.logoutRequestId || null,
                registrationRequestId: pending.data.resumeRequestId, resumeRequestId: null });
            pending = null;
            socket.emit('confirm_session', { resumeToken: user.resumeToken,
                resumeRequestId: user.resumeRequestId });
            if (logoutPending) { loggingOut = true; sendLogout(); return; }
            onUser({ id: user.participantId, participantId: user.participantId,
                name: user.name, avatar: user.avatar });
        }
        function fail(code) {
            if (code === 'session_busy') {
                pending = null;
                onUser(null);
                onInvalid(code);
                return; // Keep proof for an explicit retry, never create another identity silently.
            }
            clear(loggingOut || read()?.logoutPending ? null : code);
        }
        function send(attempt) {
            socket.timeout(5000).emit('set_user', attempt.data, (error, result) => {
                if (pending !== attempt) return;
                if (error) {
                    if (socket.connected && attempt.retries++ < 2) send(attempt);
                    else { pending = null; onInvalid('connection'); }
                } else if (result?.ok) accept(result.user);
                else fail(result?.code || 'invalid_session');
            });
        }
        function authenticate(name) {
            const record = read();
            const data = { name, avatar: '🎧',
                resumeRequestId: record?.resumeRequestId || randomId() };
            if (record?.token) {
                data.resumeToken = record.token;
                save({ ...record, resumeRequestId: data.resumeRequestId });
            }
            pending = { data, retries: 0 };
            send(pending);
        }
        return {
            connect() {
                const record = read();
                if (record?.token) authenticate('');
                else if (loggingOut || record?.logoutPending) sendLogout();
            },
            disconnected() { pending = null; },
            login(name) {
                if (loggingOut || read()?.logoutPending) {
                    onInvalid('logout_pending');
                    if (socket.connected) this.connect();
                    else socket.connect();
                    return;
                }
                if (!socket.connected) {
                    // Explicit login only: do not buffer mutations before authentication.
                    onInvalid('connection');
                    socket.connect();
                    return;
                }
                authenticate(name);
            },
            logout() {
                loggingOut = true;
                const record = read();
                save({ ...record, logoutPending: true,
                    logoutRequestId: record?.logoutRequestId || randomId(),
                    registrationRequestId: pending?.data.resumeRequestId || record?.registrationRequestId || null });
                pending = null;
                onUser(null);
                sendLogout();
            },
            accept, loggedOut,
            error(error) {
                if (pending && error.resumeRequestId === pending.data.resumeRequestId) fail(error.code);
            },
            invalid({ reason }) {
                if (reason !== 'logout') clear(reason);
            },
            playlistKey() {
                const id = read()?.participantId;
                return id ? `vibedj_playlist:${id}` : 'vibedj_playlist';
            }
        };
    }
    if (typeof module !== 'undefined') module.exports = { create };
    else root.VibeSession = { create };
})(typeof window !== 'undefined' ? window : globalThis);
