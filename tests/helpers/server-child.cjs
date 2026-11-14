// Test-only bootstrap: the production entrypoint stays unchanged. PORT=0 asks
// the OS for an available port; report it through IPC instead of guessing one.
const http = require('node:http');
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
    this.once('listening', () => process.send({ port: this.address().port }));
    return listen.apply(this, args);
};
require('../../server.js');
