const { randomUUID, randomBytes, createHash } = require('node:crypto');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

// Private session objects never enter roomState. One owner socket per identity.
function createSessionStore({ now = Date.now, ttlMs = SESSION_TTL_MS,
    onRevoke = () => {} } = {}) {
    const sessions = new Map();
    const tokens = new Map();
    const retries = new Map();

    function clearRetry(session) {
        if (session.retry) retries.delete(session.retry.previousHash);
        session.retry = null;
    }

    function revoke(id, reason = 'revoked') {
        const session = sessions.get(id);
        if (!session) return false;
        sessions.delete(id);
        tokens.delete(digest(session.token));
        clearRetry(session);
        onRevoke(id, session.socketId, reason);
        return true;
    }

    function get(id) {
        const session = sessions.get(id);
        if (session && session.expiresAt <= now()) {
            revoke(id, 'expired');
            return null;
        }
        return session || null;
    }

    function touch(session, force = false) {
        // Renew at most once a minute on activity, not on every sync packet.
        if (force || now() - session.renewedAt >= 60000) {
            session.renewedAt = now();
            session.expiresAt = now() + ttlMs;
        }
    }

    function authorize(id, socketId) {
        const session = get(id);
        if (!session || session.socketId !== socketId) return null;
        touch(session);
        return session;
    }

    function register(socketId, data, boundId) {
        if (!data || typeof data !== 'object') return { error: 'invalid_user' };
        const hasToken = Object.hasOwn(data, 'resumeToken');
        const bound = authorize(boundId, socketId);
        if (!hasToken && bound) return { session: bound, resumed: false };
        if (!hasToken) {
            const name = data.name && String(data.name).trim().slice(0, 30);
            if (!name) return { error: 'invalid_user' };
            const id = randomUUID();
            const session = { id, name, avatar: data.avatar || '🎧',
                token: randomBytes(32).toString('hex'), socketId,
                expiresAt: now() + ttlMs, renewedAt: now(), retry: null };
            sessions.set(id, session);
            tokens.set(digest(session.token), id);
            return { session, resumed: false };
        }
        if (!validToken(data.resumeToken)) return { error: 'invalid_session' };
        const hash = digest(data.resumeToken);
        const id = tokens.get(hash) || retries.get(hash);
        const session = get(id);
        if (!session) return { error: 'invalid_session' };
        // An authenticated socket may only refresh its own session.
        if (bound && bound.id !== session.id) return { error: 'session_conflict' };
        const requestId = data.resumeRequestId;
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(requestId)) {
            return { error: 'invalid_request' };
        }
        const retry = session.retry;
        if (hash !== digest(session.token)) {
            if (!retry || retry.previousHash !== hash || retry.requestId !== requestId) {
                return { error: 'invalid_session' };
            }
            if (session.socketId && session.socketId !== socketId) return { error: 'session_busy' };
            session.socketId = socketId;
            touch(session, true);
            return { session, resumed: true };
        }
        // Repeated handshake on its owner socket returns the same response.
        if (bound && retry?.requestId === requestId) return { session, resumed: true };
        const replacedSocketId = session.socketId;
        tokens.delete(hash);
        clearRetry(session);
        session.token = randomBytes(32).toString('hex');
        tokens.set(digest(session.token), session.id);
        session.retry = { previousHash: hash, requestId };
        retries.set(hash, session.id);
        session.socketId = socketId;
        touch(session, true);
        return { session, resumed: true, replacedSocketId };
    }

    function disconnect(id, socketId) {
        const session = get(id);
        if (!session || session.socketId !== socketId) return false;
        session.socketId = null;
        return true;
    }

    function sweep() {
        for (const [id, session] of sessions) {
            if (session.expiresAt <= now()) revoke(id, 'expired');
        }
    }

    return { register, authorize, disconnect, revoke, get, sweep,
        confirm(id, socketId, token, requestId) {
            const session = authorize(id, socketId);
            if (!session || token !== session.token || session.retry?.requestId !== requestId) return false;
            clearRetry(session);
            return true;
        },
        currentSocketId: id => {
            const session = sessions.get(id);
            return session && session.expiresAt > now() ? session.socketId : null;
        },
        publicUser: session => ({ id: session.id, participantId: session.id,
            name: session.name, avatar: session.avatar }) };
}

module.exports = { createSessionStore, SESSION_TTL_MS };
