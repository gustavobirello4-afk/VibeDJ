const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { io } = require('socket.io-client');

function waitFor(socket, event, predicate = () => true, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for ${event}`));
        }, timeout);
        function cleanup() {
            clearTimeout(timer);
            socket.off(event, handler);
        }
        function handler(payload) {
            try {
                if (!predicate(payload)) return;
                cleanup();
                resolve(payload);
            } catch (error) {
                cleanup();
                reject(error);
            }
        }
        socket.on(event, handler);
    });
}

async function startServer(t) {
    let output = '';
    const child = fork(path.join(__dirname, 'server-child.cjs'), [], {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    const sockets = [];
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    t.after(async () => {
        for (const socket of sockets) socket.disconnect();
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
    });
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Server startup timeout\n${output}`));
        }, 10000);
        const failed = code => {
            cleanup();
            reject(new Error(`Server exited (${code})\n${output}`));
        };
        const ready = data => { cleanup(); resolve(data.port); };
        function cleanup() {
            clearTimeout(timer);
            child.off('exit', failed);
            child.off('message', ready);
        }
        child.once('exit', failed);
        child.once('message', ready);
    });
    const url = `http://127.0.0.1:${port}`;
    return {
        child, url, output: () => output,
        async connect(transport = 'websocket') {
            const socket = io(url, {
                autoConnect: false, forceNew: true, reconnection: false,
                transports: [transport], timeout: 5000
            });
            sockets.push(socket);
            const initial = waitFor(socket, 'init_state');
            socket.connect();
            return { socket, initial: await initial };
        }
    };
}

async function command(socket, event, payload) {
    // request_sync follows the command on the same connection. Its reply is an
    // ordering barrier, avoiding arbitrary sleeps when testing rejected actions.
    socket.emit(event, payload);
    const response = waitFor(socket, 'sync_time');
    socket.emit('request_sync');
    return response;
}

async function register(socket, name) {
    const registered = waitFor(socket, 'user_registered');
    const updated = waitFor(socket, 'update_room');
    socket.emit('set_user', { name, avatar: '🎧' });
    const [user] = await Promise.all([registered, updated]);
    return user;
}

async function queue(socket, tracks) {
    await command(socket, 'request_sync');
    const updated = waitFor(socket, 'update_room');
    const [, state] = await Promise.all([command(socket, 'toggle_queue', tracks), updated]);
    return state;
}

module.exports = { startServer, waitFor, command, register, queue };
