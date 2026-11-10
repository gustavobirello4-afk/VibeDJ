const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
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

io.on('connection', (socket) => {
    console.log(`Usuário conectado: ${socket.id}`);

    socket.emit('init_state', roomState);

    socket.on('set_user', (userData) => {
        socket.data.user = { id: socket.id, name: userData.name, avatar: userData.avatar };
        socket.emit('user_registered', socket.data.user);
    });

    socket.on('toggle_queue', (playlist) => {
        if (!socket.data.user) return;
        const existingIndex = roomState.djQueue.findIndex(dj => dj.id === socket.id);

        if (existingIndex !== -1) {
            roomState.djQueue.splice(existingIndex, 1);
        } else {
            roomState.djQueue.push({
                id: socket.id,
                name: socket.data.user.name,
                avatar: socket.data.user.avatar,
                playlist: playlist || []
            });
        }

        checkNextDj();
        io.emit('update_room', roomState);
    });

    socket.on('update_playlist', (playlist) => {
        const dj = roomState.djQueue.find(d => d.id === socket.id);
        if (dj) {
            dj.playlist = playlist;
        }
    });

    socket.on('vote', (type) => {
        if (!socket.data.user || !roomState.currentTrack) return;

        roomState.votes.voters[socket.id] = type;

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

    socket.on('send_message', (text) => {
        if (!socket.data.user) return;
        const msg = {
            id: Date.now(),
            user: socket.data.user.name,
            avatar: socket.data.user.avatar,
            text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        roomState.messages.push(msg);
        if (roomState.messages.length > 100) roomState.messages.shift();
        io.emit('new_message', msg);
    });

    socket.on('skip_track', () => {
        if (roomState.currentDj?.id === socket.id) {
            nextTrack();
        }
    });

    socket.on('track_ended', () => {
        if (roomState.currentDj?.id === socket.id) {
            nextTrack();
        }
    });

    socket.on('disconnect', () => {
        roomState.djQueue = roomState.djQueue.filter(dj => dj.id !== socket.id);
        if (roomState.currentDj?.id === socket.id) {
            nextTrack();
        } else {
            io.emit('update_room', roomState);
        }
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

    const dj = roomState.djQueue.shift();
    roomState.djQueue.push(dj);

    if (dj.playlist && dj.playlist.length > 0) {
        const track = dj.playlist.shift();
        dj.playlist.push(track);

        roomState.currentDj = dj;
        roomState.currentTrack = track;
        roomState.startTime = Date.now();
        roomState.votes = { woot: 0, meh: 0, voters: {} };
    } else {
        nextTrack();
        return;
    }

    io.emit('update_room', roomState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));