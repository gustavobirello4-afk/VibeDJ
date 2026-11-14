const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Ytdl, chooseFormat } = require('@distube/ytdl-core');
const { createSessionStore } = require('./session-store');

const app = express();
const server = http.createServer(app);
const ytdl = new Ytdl();

// Cache em memória para URLs de áudio extraídas (válido por 30 minutos)
const audioStreamCache = new Map();

// Habilita CORS para requisições HTTP e polling de clientes externos
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Configuração robusta do Socket.IO para nuvem (Render, Railway) e redes móveis
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true
});

app.use(express.static('public'));

// =========================================================================
// ROTAS DE EXTRAÇÃO E TRANSMISSÃO DIRETA DE ÁUDIO NATIVO (SISTEMA HÍBRIDO)
// =========================================================================

// Retorna metadados e URL direta de áudio (formato m4a / AAC nativo do iOS e Android)
app.get('/api/audio/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: 'ID de vídeo inválido' });
    }

    const cached = audioStreamCache.get(videoId);
    if (cached && (Date.now() - cached.timestamp < 30 * 60 * 1000)) {
        return res.json(cached.data);
    }

    try {
        const info = await ytdl.getInfo(videoId);
        const format = chooseFormat(info.formats, {
            filter: { hasAudio: true, hasVideo: false },
            quality: 'highestaudio'
        });

        if (!format || !format.url) {
            throw new Error('Nenhum formato de áudio puro encontrado');
        }

        const data = {
            success: true,
            videoId,
            audioUrl: format.url,
            mimeType: format.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
            container: format.container || 'mp4',
            bitrate: format.audioBitrate || 128,
            duration: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
            title: info.videoDetails.title
        };

        audioStreamCache.set(videoId, { timestamp: Date.now(), data });
        console.log(`[AudioEngine] Áudio nativo extraído para ${videoId}: ${data.title} (${data.mimeType})`);
        return res.json(data);
    } catch (err) {
        console.warn(`[AudioEngine] Falha ao extrair áudio de ${videoId}:`, err.message);
        return res.status(500).json({
            error: 'Falha ao extrair fluxo de áudio nativo',
            details: err.message,
            fallbackToIFrame: true
        });
    }
});

// Redirecionamento direto com suporte nativo a HTTP 206 (Range requests)
app.get('/api/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
        return res.status(400).send('ID de vídeo inválido');
    }

    try {
        let audioUrl = audioStreamCache.get(videoId)?.data?.audioUrl;

        if (!audioUrl) {
            const info = await ytdl.getInfo(videoId);
            const format = chooseFormat(info.formats, {
                filter: { hasAudio: true, hasVideo: false },
                quality: 'highestaudio'
            });
            audioUrl = format?.url;
        }

        if (audioUrl) {
            return res.redirect(audioUrl);
        }
        return res.status(404).send('Fluxo de áudio não encontrado');
    } catch (err) {
        return res.status(500).send('Erro ao buscar fluxo');
    }
});

let roomState = {
    currentDj: null,
    currentTrack: null,
    startTime: null,
    isPlaying: false,
    pausedAt: null,
    djQueue: [],
    messages: [],
    votes: { woot: 0, meh: 0, voters: {} }
};

// Dicionário de timers para tolerância de desconexão em redes móveis
const disconnectTimers = new Map();
const sessions = createSessionStore({ onRevoke: (id, socketId, reason) => {
    cancelDisconnect(id);
    const owner = io.sockets.sockets.get(socketId);
    if (owner) {
        delete owner.data.participantId;
        delete owner.data.user;
        if (reason !== 'logout') owner.emit('session_invalid', { reason });
    }
    removeParticipant(id);
} });
// One bounded-frequency cleanup for private sessions; no per-session TTL timers.
setInterval(() => sessions.sweep(), 60000).unref();

function cancelDisconnect(id) {
    const pending = disconnectTimers.get(id);
    if (pending) clearTimeout(pending.timer);
    disconnectTimers.delete(id);
}

function removeParticipant(id) {
    const previousLength = roomState.djQueue.length;
    roomState.djQueue = roomState.djQueue.filter(dj => dj.id !== id);
    if (roomState.currentDj?.id === id) nextTrack();
    else if (previousLength !== roomState.djQueue.length) io.emit('update_room', getPublicRoomState());
}

function socketSession(socket) {
    return sessions.authorize(socket.data.participantId, socket.id);
}

function socketUser(socket) {
    const session = socketSession(socket);
    return session && sessions.publicUser(session);
}

// Função auxiliar para verificar se o socket é o DJ da vez
function isCurrentDj(socket) {
    const session = socketSession(socket);
    return Boolean(session && roomState.currentDj?.id === session.id);
}

// Calcula o tempo exato decorrido da música atual
function getRoomCurrentTime() {
    if (!roomState.currentTrack || !roomState.startTime) return 0;
    if (!roomState.isPlaying && roomState.pausedAt !== null) {
        return Math.max(0, (roomState.pausedAt - roomState.startTime) / 1000);
    }
    return Math.max(0, (Date.now() - roomState.startTime) / 1000);
}

// Retorna o estado público da sala com currentTime calculado
function getPublicRoomState() {
    return {
        ...roomState,
        currentTime: getRoomCurrentTime()
    };
}

io.on('connection', (socket) => {
    console.log(`[Socket] Usuário conectado: ${socket.id} (transporte: ${socket.conn.transport.name})`);

    socket.conn.on('upgrade', () => {
        console.log(`[Socket] Conexão ${socket.id} promovida para ${socket.conn.transport.name}`);
    });

    // Envia o estado atual da sala imediatamente na conexão com currentTime preciso
    socket.emit('init_state', getPublicRoomState());

    // Registro ou reconexão do usuário
    socket.on('set_user', (userData, ack) => {
        const result = sessions.register(socket.id, userData, socket.data.participantId);
        if (result.error) {
            socket.emit('session_error', { code: result.error,
                resumeRequestId: userData?.resumeRequestId || null });
            if (typeof ack === 'function') ack({ ok: false, code: result.error });
            return;
        }
        const { session, replacedSocketId } = result;
        socket.data.participantId = session.id;
        socket.data.user = sessions.publicUser(session);
        socket.data.registrationRequestId = userData.resumeRequestId || null;
        cancelDisconnect(session.id);
        if (replacedSocketId && replacedSocketId !== socket.id) {
            const oldSocket = io.sockets.sockets.get(replacedSocketId);
            if (oldSocket) {
                delete oldSocket.data.participantId;
                delete oldSocket.data.user;
                oldSocket.emit('session_invalid', { reason: 'replaced' });
                oldSocket.disconnect(true);
            }
        }
        // Credentials go only to the authenticated socket (event + optional ACK).
        const registered = { ...socket.data.user, resumeToken: session.token,
            expiresAt: session.expiresAt, resumeRequestId: userData.resumeRequestId || null };
        socket.emit('user_registered', registered);
        if (typeof ack === 'function') ack({ ok: true, user: registered });
        const queued = roomState.djQueue.find(dj => dj.id === session.id);
        if (result.resumed && queued) socket.emit('playlist_consumed', queued.playlist);
        io.emit('update_room', getPublicRoomState());
    });

    socket.on('confirm_session', (payload) => {
        sessions.confirm(socket.data.participantId, socket.id, payload?.resumeToken, payload?.resumeRequestId);
    });

    socket.on('logout', (payload, ack) => {
        const session = socketSession(socket);
        // Correlated requests cannot revoke a newer login on this connection.
        const matching = !payload?.requestId || (payload.participantId
            ? payload.participantId === session?.id
            : payload.registrationRequestId === socket.data.registrationRequestId);
        if (session && !matching) {
            if (typeof ack === 'function') ack({ ok: false, code: 'session_conflict' });
            return;
        }
        if (session) sessions.revoke(session.id, 'logout');
        const result = { ok: true, requestId: payload?.requestId || null,
            participantId: payload?.participantId || null,
            registrationRequestId: payload?.registrationRequestId || null };
        socket.emit('logged_out', result);
        if (typeof ack === 'function') ack(result);
    });

    // Entrar ou sair da fila de DJs
    socket.on('toggle_queue', (playlist) => {
        const user = socketUser(socket);
        if (!user || !user.name) {
            console.warn(`[Queue] toggle_queue ignorado: usuário não identificado (socket: ${socket.id})`);
            return;
        }

        const existingIndex = roomState.djQueue.findIndex(dj => dj.id === user.id);

        if (existingIndex !== -1) {
            roomState.djQueue.splice(existingIndex, 1);
            console.log(`[Queue] ${user.name} saiu da fila.`);
        } else {
            roomState.djQueue.push({
                id: user.id,
                participantId: user.id,
                name: user.name,
                avatar: user.avatar,
                playlist: Array.isArray(playlist) ? playlist : []
            });
            console.log(`[Queue] ${user.name} entrou na fila com ${(playlist || []).length} músicas.`);
        }

        checkNextDj();
        io.emit('update_room', getPublicRoomState());
    });

    // Atualização da playlist do DJ
    socket.on('update_playlist', (playlist) => {
        const user = socketUser(socket);
        if (!user) return;
        const dj = roomState.djQueue.find(d => d.id === user.id);
        if (dj) {
            dj.playlist = Array.isArray(playlist) ? playlist : [];
            checkNextDj();
            io.emit('update_room', getPublicRoomState());
        }
    });

    // ==========================================
    // CONTROLES EXCLUSIVOS DO DJ (PLAYER)
    // ==========================================

    // DJ dá play na faixa
    socket.on('dj_play', () => {
        if (!isCurrentDj(socket)) {
            console.warn(`[Permissão Negada] ${socket.data.user?.name || socket.id} tentou dar play sem ser o DJ.`);
            return;
        }
        if (roomState.isPlaying || !roomState.currentTrack) return;

        if (roomState.pausedAt) {
            const pausedDuration = Date.now() - roomState.pausedAt;
            roomState.startTime = (roomState.startTime || Date.now()) + pausedDuration;
        } else {
            roomState.startTime = Date.now();
        }
        roomState.isPlaying = true;
        roomState.pausedAt = null;

        const currentTime = getRoomCurrentTime();
        console.log(`[Player] DJ ${socket.data.user?.name} deu play em ${currentTime.toFixed(1)}s`);
        io.emit('player_action', { action: 'play', currentTime, isPlaying: true });
        io.emit('update_room', getPublicRoomState());
    });

    // DJ pausa a faixa
    socket.on('dj_pause', () => {
        if (!isCurrentDj(socket)) {
            console.warn(`[Permissão Negada] ${socket.data.user?.name || socket.id} tentou pausar sem ser o DJ.`);
            return;
        }
        if (!roomState.isPlaying || !roomState.currentTrack) return;

        roomState.isPlaying = false;
        roomState.pausedAt = Date.now();

        const currentTime = getRoomCurrentTime();
        console.log(`[Player] DJ ${socket.data.user?.name} pausou em ${currentTime.toFixed(1)}s`);
        io.emit('player_action', { action: 'pause', currentTime, isPlaying: false });
        io.emit('update_room', getPublicRoomState());
    });

    // DJ avança ou retrocede a faixa (seek)
    socket.on('dj_seek', (targetTime) => {
        if (!isCurrentDj(socket)) {
            console.warn(`[Permissão Negada] ${socket.data.user?.name || socket.id} tentou alterar a posição sem ser o DJ.`);
            return;
        }
        const timeInSeconds = parseFloat(targetTime);
        if (isNaN(timeInSeconds) || timeInSeconds < 0 || !roomState.currentTrack) return;

        roomState.startTime = Date.now() - (timeInSeconds * 1000);
        if (!roomState.isPlaying) {
            roomState.pausedAt = Date.now();
        }

        console.log(`[Player] DJ ${socket.data.user?.name} avançou faixa para ${timeInSeconds.toFixed(1)}s`);
        io.emit('player_action', { action: 'seek', currentTime: timeInSeconds, isPlaying: roomState.isPlaying });
        io.emit('update_room', getPublicRoomState());
    });

    // Pular música manualmente (Exclusivo do DJ)
    socket.on('skip_track', () => {
        if (isCurrentDj(socket)) {
            console.log(`[Track] DJ ${socket.data.user?.name} pulou a música atual.`);
            nextTrack();
        } else {
            console.warn(`[Permissão Negada] ${socket.data.user?.name || socket.id} tentou pular a música sem ser o DJ.`);
        }
    });

    // ==========================================
    // RESSINCRONIZAÇÃO EM TEMPO REAL (RESYNC)
    // ==========================================

    // Qualquer cliente solicita a posição exata (ao entrar, focar aba, trocar de app no celular)
    socket.on('request_sync', () => {
        socketSession(socket);
        const currentTime = getRoomCurrentTime();
        socket.emit('sync_time', {
            currentTime,
            isPlaying: roomState.isPlaying,
            currentTrackId: roomState.currentTrack?.id || null,
            serverTime: Date.now()
        });
    });

    // Notificação de fim da música (acionada prioritariamente pelo DJ, com fallback)
    socket.on('track_ended', () => {
        if (isCurrentDj(socket)) {
            console.log(`[Track] Faixa finalizada (acionado por ${socket.data.user?.name || socket.id}). Próxima música.`);
            nextTrack();
        }
    });

    // Votação (Woot / Meh)
    socket.on('vote', (type) => {
        const user = socketUser(socket);
        if (!user) return;
        if (!roomState.currentTrack) return;
        const voterKey = user.id;

        roomState.votes.voters[voterKey] = type;

        let wootCount = 0;
        let mehCount = 0;
        Object.values(roomState.votes.voters).forEach(v => {
            if (v === 'woot') wootCount++;
            if (v === 'meh') mehCount++;
        });

        roomState.votes.woot = wootCount;
        roomState.votes.meh = mehCount;

        io.emit('update_votes', roomState.votes);
    });

    // Mensagens de Chat
    socket.on('send_message', (payload) => {
        const user = socketUser(socket);
        if (!user) return;
        const text = typeof payload === 'string' ? payload : payload?.text;
        if (!text || !text.trim()) return;

        const userName = user.name;
        const userAvatar = user.avatar;

        const msg = {
            id: Date.now() + Math.random().toString(36).substr(2, 5),
            user: userName,
            avatar: userAvatar,
            text: text.trim().slice(0, 500),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        roomState.messages.push(msg);
        if (roomState.messages.length > 100) roomState.messages.shift();
        io.emit('new_message', msg);
    });

    // Desconexão com tolerância para redes móveis instáveis
    socket.on('disconnect', (reason) => {
        console.log(`[Socket] Desconectado: ${socket.id} (motivo: ${reason})`);
        const id = socket.data.participantId;
        if (!sessions.disconnect(id, socket.id)) return;
        cancelDisconnect(id);
        const pending = { timer: null };
        pending.timer = setTimeout(() => {
            if (disconnectTimers.get(id) !== pending) return;
            disconnectTimers.delete(id);
            const session = sessions.get(id);
            if (session && !session.socketId) removeParticipant(id);
        }, 15000);
        disconnectTimers.set(id, pending);
    });
});

function checkNextDj() {
    if (!roomState.currentTrack && roomState.djQueue.length > 0) {
        nextTrack();
    }
}

function nextTrack() {
    if (roomState.djQueue.length === 0) {
        roomState.currentDj = null;
        roomState.currentTrack = null;
        roomState.startTime = null;
        roomState.isPlaying = false;
        roomState.pausedAt = null;
        roomState.votes = { woot: 0, meh: 0, voters: {} };
        io.emit('update_room', getPublicRoomState());
        return;
    }

    let foundTrack = false;
    let attempts = roomState.djQueue.length;

    while (attempts > 0) {
        const dj = roomState.djQueue.shift();
        roomState.djQueue.push(dj);

        if (dj.playlist && dj.playlist.length > 0) {
            // Pega a PRIMEIRA faixa (topo) e move para o final da playlist pessoal do DJ (rotação circular)
            const track = dj.playlist.shift();
            dj.playlist.push(track);

            // Notifica o socket do DJ para sincronizar a rotação circular no front-end em tempo real
            const owner = io.sockets.sockets.get(sessions.currentSocketId(dj.id));
            if (owner) owner.emit('playlist_consumed', dj.playlist);

            roomState.currentDj = dj;
            roomState.currentTrack = track;
            roomState.startTime = Date.now();
            roomState.isPlaying = true;
            roomState.pausedAt = null;
            roomState.votes = { woot: 0, meh: 0, voters: {} };
            foundTrack = true;
            break;
        }
        attempts--;
    }

    if (!foundTrack) {
        roomState.currentDj = null;
        roomState.currentTrack = null;
        roomState.startTime = null;
        roomState.isPlaying = false;
        roomState.pausedAt = null;
        roomState.votes = { woot: 0, meh: 0, voters: {} };
    }

    io.emit('update_room', getPublicRoomState());
}

// 0.0.0.0 é obrigatório na Render e serviços em nuvem para aceitar conexões externas
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor VibeDJ rodando em http://0.0.0.0:${PORT}`);
});
