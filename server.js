const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

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
    // WebSocket nativo é prioritário (evita bloqueios de proxy HTTP no Render e redes 4G/5G)
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true
});

app.use(express.static('public'));

let roomState = {
    currentDj: null,
    currentTrack: null,
    startTime: null,
    djQueue: [],
    messages: [],
    votes: { woot: 0, meh: 0, voters: {} }
};

// Dicionário de timers para tolerância de desconexão em redes móveis
const disconnectTimers = {};

io.on('connection', (socket) => {
    console.log(`[Socket] Usuário conectado: ${socket.id} (transporte: ${socket.conn.transport.name})`);

    socket.conn.on('upgrade', () => {
        console.log(`[Socket] Conexão ${socket.id} promovida para ${socket.conn.transport.name}`);
    });

    // Envia o estado atual da sala imediatamente na conexão
    socket.emit('init_state', roomState);

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

        // Se o usuário é o DJ atual, atualiza o socket ID
        if (roomState.currentDj && roomState.currentDj.name === cleanName) {
            roomState.currentDj.id = socket.id;
        }

        socket.emit('user_registered', socket.data.user);
        io.emit('update_room', roomState);
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
        io.emit('update_room', roomState);
    });

    // Atualização da playlist do DJ
    socket.on('update_playlist', (playlist) => {
        const user = socket.data.user;
        const dj = roomState.djQueue.find(d => (user && d.name === user.name) || d.id === socket.id);
        if (dj) {
            dj.playlist = Array.isArray(playlist) ? playlist : [];
            checkNextDj();
            io.emit('update_room', roomState);
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

    // Pular música manualmente pelo DJ atual
    socket.on('skip_track', () => {
        const isCurrentDj = (socket.data.user && roomState.currentDj?.name === socket.data.user.name) ||
                            roomState.currentDj?.id === socket.id;
        if (isCurrentDj) {
            console.log(`[Track] DJ pulou a música atual.`);
            nextTrack();
        }
    });

    // Notificação de fim da música
    socket.on('track_ended', () => {
        const isCurrentDj = (socket.data.user && roomState.currentDj?.name === socket.data.user.name) ||
                            roomState.currentDj?.id === socket.id;
        if (isCurrentDj) {
            console.log(`[Track] Música finalizada.`);
            nextTrack();
        }
    });

    // Desconexão com tolerância para redes móveis instáveis
    socket.on('disconnect', (reason) => {
        console.log(`[Socket] Desconectado: ${socket.id} (motivo: ${reason})`);
        const userName = socket.data.user?.name;

        if (!userName) return;

        // Aguarda 15 segundos antes de remover da fila/tocar próximo DJ
        // Isso impede que oscilações de 4G derrubem a pessoa instantaneamente
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
                    io.emit('update_room', roomState);
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
        roomState.votes = { woot: 0, meh: 0, voters: {} };
        io.emit('update_room', roomState);
        return;
    }

    let foundTrack = false;
    let attempts = roomState.djQueue.length;

    while (attempts > 0) {
        const dj = roomState.djQueue.shift();
        roomState.djQueue.push(dj);

        if (dj.playlist && dj.playlist.length > 0) {
            const track = dj.playlist.shift();
            dj.playlist.push(track);

            roomState.currentDj = dj;
            roomState.currentTrack = track;
            roomState.startTime = Date.now();
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
        roomState.votes = { woot: 0, meh: 0, voters: {} };
    }

    io.emit('update_room', roomState);
}

// 0.0.0.0 é obrigatório na Render e serviços em nuvem para aceitar conexões externas
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor VibeDJ rodando em http://0.0.0.0:${PORT}`);
});
