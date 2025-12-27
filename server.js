const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let db;
const cooldowns = {};

(async () => {
    db = await open({
        filename: './pixtap.db',
        driver: sqlite3.Database
    });
    await db.exec(`CREATE TABLE IF NOT EXISTS canvas (x INTEGER, y INTEGER, color TEXT)`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coords ON canvas (x, y)`);
    console.log("База данных готова.");
})();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
    cooldowns[socket.id] = 0;
    io.emit('online_count', io.engine.clientsCount);

    const board = await db.all("SELECT x, y, color FROM canvas");
    const boardObject = {};
    board.forEach(row => boardObject[`${row.x},${row.y}`] = row.color);
    socket.emit('init_board', boardObject);

    socket.on('place_pixel', async (data) => {
        const userCooldown = cooldowns[socket.id] || 0;
        if (userCooldown >= 180) return;
        cooldowns[socket.id] = userCooldown + 1;
        const { x, y, color } = data;
        try {
            await db.run("INSERT OR REPLACE INTO canvas (x, y, color) VALUES (?, ?, ?)", [x, y, color]);
            io.emit('update_pixel', { x, y, color });
            socket.emit('cooldown_update', { current: cooldowns[socket.id] });
        } catch (e) { console.error(e); }
    });

    // Обновленная логика чата с именами
    socket.on('chat_message', (data) => {
        const room = data.room;
        const msg = {
            text: data.text.substring(0, 100),
            name: data.name.substring(0, 15) // Принимаем имя от игрока
        };
        io.emit('chat_receive_' + room, msg);
    });

    socket.on('disconnect', () => {
        delete cooldowns[socket.id];
        io.emit('online_count', io.engine.clientsCount);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pixtap запущен на порту ${PORT}`);
});