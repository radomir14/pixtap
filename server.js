const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Вот здесь мы объявляем переменную io!

let db;
const cooldowns = {}; // Объект для хранения кулдаунов

// 1. Настройка базы данных
(async () => {
    db = await open({
        filename: './pixtap.db',
        driver: sqlite3.Database
    });
    await db.exec(`CREATE TABLE IF NOT EXISTS canvas (x INTEGER, y INTEGER, color TEXT)`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coords ON canvas (x, y)`);
    console.log("База данных готова.");
})();

// 2. Раздача статики (чтобы открывался index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Логика WebSockets
io.on('connection', async (socket) => {
    console.log('Новый игрок подключился:', socket.id);
    cooldowns[socket.id] = 0;

    // Отправляем текущую доску при входе
    const board = await db.all("SELECT x, y, color FROM canvas");
    const boardObject = {};
    board.forEach(row => boardObject[`${row.x},${row.y}`] = row.color);
    socket.emit('init_board', boardObject);

    // Обработка постановки пикселя
    socket.on('place_pixel', async (data) => {
        const userCooldown = cooldowns[socket.id] || 0;

        // Если лимит (180 сек) превышен
        if (userCooldown >= 180) {
            return socket.emit('cooldown_error', { message: 'Лимит превышен! Подожди.' });
        }

        // Добавляем 1 секунду к кулдауну
        cooldowns[socket.id] = userCooldown + 1;

        const { x, y, color } = data;
        try {
            await db.run("INSERT OR REPLACE INTO canvas (x, y, color) VALUES (?, ?, ?)", [x, y, color]);
            io.emit('update_pixel', { x, y, color }); // Рассылаем всем
            socket.emit('cooldown_update', { current: cooldowns[socket.id] });
        } catch (e) {
            console.error("Ошибка БД", e);
        }
    });

    socket.on('disconnect', () => {
        delete cooldowns[socket.id];
    });
});

// 4. Таймер уменьшения кулдауна (раз в секунду)
setInterval(() => {
    for (let id in cooldowns) {
        if (cooldowns[id] > 0) {
            cooldowns[id] -= 1;
            // Отправляем обновленное значение конкретному игроку
            if (io.sockets.sockets.get(id)) {
                io.sockets.sockets.get(id).emit('cooldown_update', { current: cooldowns[id] });
            }
        }
    }
}, 1000);

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pixtap запущен на http://localhost:${PORT}`);
});