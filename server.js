const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Ytdl, chooseFormat } = require('@distube/ytdl-core');

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
const disconnectTimers = {};

// Função auxiliar para verificar se o socket é o DJ da vez
function isCurrentDj(socket) {
    if (!roomState.currentDj) return false;
    const socketUserName = socket.data?.user?.name;
    if (socketUserName && roomState.currentDj.name === socketUserName) return true;
    if (roomState.currentDj.id === socket.id) return true;
    return false;
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
    socket.on('set_user', (userData) => {
        if (!userData || !userData.name) return;
        const cleanName = String(userData.name).trim().slice(0, 30);
        if (!cleanName) return;

        socket.data.user = {
            id: socket.id,
            name: cleanName,
            avatar: userData.avatar || '🎧'
        };

        // Cancela eventual timer de desconexão para esse nome
        if (disconnectTimers[cleanName]) {
            clearTimeout(disconnectTimers[cleanName]);
            delete disconnectTimers[cleanName];
            console.log(`[Reconexão] Usuário ${cleanName} reconectou antes do timeout.`);
        }

        // Se o usuário já estava na fila de DJs, atualiza o socket ID
        const existingDj = roomState.djQueue.find(dj => dj.name === cleanName);
        if (existingDj) {
            existingDj.id = socket.id;
        }

        // Se o usuário é o DJ atual, atualiza o socket ID mantendo privilégios
        if (roomState.currentDj && roomState.currentDj.name === cleanName) {
            roomState.currentDj.id = socket.id;
        }

        socket.emit('user_registered', socket.data.user);
        io.emit('update_room', getPublicRoomState());
        console.log(`[Auth] Usuário registrado: ${cleanName} (${socket.id})`);
    });

    // Entrar ou sair da fila de DJs
    socket.on('toggle_queue', (playlist) => {
        const user = socket.data.user;
        if (!user || !user.name) {
            console.warn(`[Queue] toggle_queue ignorado: usuário não identificado (socket: ${socket.id})`);
            return;
        }

        const existingIndex = roomState.djQueue.findIndex(dj => dj.name === user.name || dj.id === socket.id);

        if (existingIndex !== -1) {
            roomState.djQueue.splice(existingIndex, 1);
            console.log(`[Queue] ${user.name} saiu da fila.`);
        } else {
            roomState.djQueue.push({
                id: socket.id,
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
        const user = socket.data.user;
        const dj = roomState.djQueue.find(d => (user && d.name === user.name) || d.id === socket.id);
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
        const elapsed = getRoomCurrentTime();
        const isDj = isCurrentDj(socket);
        
        const isDjPresent = roomState.currentDj?.name && Array.from(io.sockets.sockets.values()).some(
            s => s.data.user?.name === roomState.currentDj.name
        );

        if (isDj || (!isDjPresent && elapsed > 10)) {
            console.log(`[Track] Faixa finalizada (acionado por ${socket.data.user?.name || socket.id}). Próxima música.`);
            nextTrack();
        }
    });

    // Votação (Woot / Meh)
    socket.on('vote', (type) => {
        if (!roomState.currentTrack) return;
        const voterKey = socket.data.user?.name || socket.id;

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
        const text = typeof payload === 'string' ? payload : payload?.text;
        if (!text || !text.trim()) return;

        const userName = socket.data.user?.name || payload?.userName || 'Anônimo';
        const userAvatar = socket.data.user?.avatar || payload?.userAvatar || '🎧';

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
        const userName = socket.data.user?.name;

        if (!userName) return;

        disconnectTimers[userName] = setTimeout(() => {
            const isStillConnected = Array.from(io.sockets.sockets.values()).some(
                s => s.data.user?.name === userName
            );

            if (!isStillConnected) {
                console.log(`[Queue] Tempo limite de reconexão esgotado para ${userName}. Removendo.`);
                roomState.djQueue = roomState.djQueue.filter(dj => dj.name !== userName && dj.id !== socket.id);
                if (roomState.currentDj?.name === userName || roomState.currentDj?.id === socket.id) {
                    nextTrack();
                } else {
                    io.emit('update_room', getPublicRoomState());
                }
            }
            delete disconnectTimers[userName];
        }, 15000);
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
            Array.from(io.sockets.sockets.values())
                .filter(s => (s.data.user && s.data.user.name === dj.name) || s.id === dj.id)
                .forEach(s => s.emit('playlist_consumed', dj.playlist));

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
