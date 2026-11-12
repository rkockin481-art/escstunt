// --- 1. ИНИЦИАЛИЗАЦИЯ FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyDnbVzDKBQ6gOw2imljCdvT-0PeCg43Hyw",
    authDomain: "escstunt.firebaseapp.com",
    databaseURL: "https://escstunt-default-rtdb.firebaseio.com",
    projectId: "escstunt",
    storageBucket: "escstunt.firebasestorage.app",
    messagingSenderId: "534819026956",
    appId: "1:534819026956:web:3bed36d828375f655c9629"
};

let db = null;
let firebaseReady = false;

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        firebaseReady = true;
        console.log("Firebase подключен!");
    }
} catch (e) {
    console.warn("Firebase не загрузился. Офлайн-режим.");
}

// --- 2. TELEGRAM ---
let playerTgId = "offline_user";
let playerUsername = "Гонщик";

const tg = window.Telegram?.WebApp; // Объявлено ОДИН раз
if (tg) {
    tg.ready();
    tg.expand();
    if (tg.requestFullscreen) tg.requestFullscreen();
    if (tg.initDataUnsafe?.user) {
        playerTgId = tg.initDataUnsafe.user.id.toString();
        playerUsername = tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name || "Игрок";
    }
}

// --- 3. ЗАГРУЗКА КАРТИНОК ---
const imgBike = new Image(); imgBike.src = 'bike.png'; 
const imgWheel = new Image(); imgWheel.src = 'wheel.png'; 
const imgRider = new Image(); imgRider.src = 'rider.png'; 
const imgBg = new Image(); imgBg.src = 'bg.png'; 
const imgCaseHalloween = new Image(); imgCaseHalloween.src = 'case_halloween.png'; 

const canvas = document.getElementById('gameCanvas'), ctx = canvas.getContext('2d');
function resize() { 
    canvas.width = canvas.clientWidth; 
    canvas.height = canvas.clientHeight; 
    ctx.imageSmoothingEnabled = false; 
}
window.addEventListener('resize', resize); 
resize();

// --- 4. ПЕРЕМЕННЫЕ ---
let currentTab = 'stunt', 
    coins = parseInt(localStorage.getItem('stunt_coins')) || 0, 
    bestScore = parseInt(localStorage.getItem('stunt_best')) || 0,
    bikeColor = localStorage.getItem('stunt_bikeColor') || '#16a34a', // Текущий цвет (зеленый по умолчанию)
    angle = 0, angularVelocity = 0, liftInertia = 0, score = 0, 
    isPressing = false, isGameOver = false, backgroundX = 0, 
    smokeParticles = [], moneyTexts = [], topPlayers = [], lastTime = performance.now();

const ACCEL = 0.012, DECEL = 0.011, MAX_LIFT = 0.22, GRAV = 0.05, DAMP = 0.96, CRASH = 95;

// --- 5. ЗАГРУЗКА И СОХРАНЕНИЕ ИГРОКА (FIREBASE) ---
async function loadPlayer() {
    if (firebaseReady && playerTgId !== "offline_user") {
        try {
            const snapshot = await db.ref('players/' + playerTgId).once('value');
            const data = snapshot.val();
            if (data) {
                coins = data.coins || 0;
                bestScore = data.best_score || 0;
            } else {
                await db.ref('players/' + playerTgId).set({
                    username: playerUsername,
                    coins: coins,
                    best_score: bestScore
                });
            }
        } catch (e) {
            console.warn("Ошибка Firebase, играем локально:", e);
        }
    }
    document.getElementById('ui-money-balance').innerText = Math.floor(coins);
}

function savePlayer() {
    localStorage.setItem('stunt_coins', Math.floor(coins));
    localStorage.setItem('stunt_best', Math.floor(bestScore));
    
    if (firebaseReady && playerTgId !== "offline_user") {
        db.ref('players/' + playerTgId).update({
            coins: Math.floor(coins),
            best_score: Math.floor(bestScore)
        }).catch(e => console.warn("Не удалось сохранить в Firebase:", e));
    }
}

async function loadTop() {
    if (!firebaseReady) {
        topPlayers = [];
        return;
    }
    try {
        const snapshot = await db.ref('players').orderByChild('best_score').limitToLast(10).once('value');
        const data = snapshot.val();
        if (data) {
            topPlayers = Object.values(data).sort((a, b) => (b.best_score || 0) - (a.best_score || 0));
        } else {
            topPlayers = [];
        }
    } catch (e) {
        console.warn("Ошибка загрузки топа:", e);
        topPlayers = [];
    }
}

// --- 6. УПРАВЛЕНИЕ ---
const handle = (s) => { if (currentTab === 'stunt' && !isGameOver) isPressing = s; };

window.addEventListener('mousedown', () => handle(true));
window.addEventListener('mouseup', () => handle(false));
window.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // --- ЛОГИКА КЕЙСОВ (Клик по Хэллоуинскому кейсу) ---
    if (currentTab === 'cases') {
        const startX = 20, startY = 190;
        const boxWidth = (canvas.width - 60) / 2;
        const boxHeight = 160;

        // Попадание в первый кейс
        if (x >= startX && x <= startX + boxWidth && y >= startY && y <= startY + boxHeight) {
            if (typeof openHalloweenCase === 'function') {
                openHalloweenCase();
            }
        }
        return; // Не запускаем стант
    }

    // --- ЛОГИКА ОСТАЛЬНЫХ ВКЛАДОК (Стант) ---
    if (e.target.closest('.bottom-bar-container') || e.target.closest('.top-bar')) return;
    handle(true);
});
window.addEventListener('pointerup', () => handle(false));
window.addEventListener('pointercancel', () => handle(false));

document.body.addEventListener('touchmove', (e) => {
    if (currentTab === 'stunt') e.preventDefault();
}, { passive: false });

// --- 7. НАВИГАЦИЯ ---
const nav = document.querySelectorAll('.nav-item');
nav.forEach((item, idx) => {
    item.addEventListener('click', () => {
        nav.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        isPressing = false;
        currentTab = ['garage', 'cases', 'stunt', 'trade', 'top'][idx];

        const topBar = document.querySelector('.top-bar');
        const centerScore = document.getElementById('ui-center-score');
        const energyBar = document.getElementById('ui-balance-bar');

        if (currentTab === 'stunt') {
            if (topBar) topBar.style.display = 'flex';
            if (centerScore) centerScore.style.display = 'block';
            if (energyBar) energyBar.style.display = 'flex';
        } else {
            if (topBar) topBar.style.display = 'flex';
            if (centerScore) centerScore.style.display = 'none';
            if (energyBar) energyBar.style.display = 'none';
            if (currentTab === 'top') loadTop(); // Грузим топ при заходе
            reset(); 
        }
        savePlayer();
    });
});

function reset() {
    angle = 0; angularVelocity = 0; liftInertia = 0; score = 0; backgroundX = 0;
    isPressing = false; 
    smokeParticles = []; moneyTexts = [];
    document.getElementById('game-over-screen').style.display = 'none';
    isGameOver = false;
}

// --- 8. ОТРИСОВКА ---
function drawWheel(x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    
    // Крутим колесо ТОЛЬКО на вкладке игры (stunt)
    if (currentTab === 'stunt') {
        ctx.rotate(window.performance.now() * 0.002 * (angle > 10 ? 8 : 4));
    }
    
    if (imgWheel.complete && imgWheel.naturalWidth !== 0) {
        const aspectRatio = imgWheel.naturalWidth / imgWheel.naturalHeight;
        const w = size * aspectRatio; 
        const h = size;
        ctx.drawImage(imgWheel, -w / 2, -h / 2, w, h);
    } else {
        ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, size/2, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
}

function drawBike(angle) {
    ctx.save();
    // ВЫСОТА МОТИКА И СДВИГ ВЛЕВО (pX)
    const rY = canvas.height - 150; 
    const pX = canvas.width * 0.34; 
    const pY = rY + 42;             
    ctx.translate(pX, pY);
    
    ctx.rotate(-angle * Math.PI / 180);

    const wheelSize = 65; 
    const wb = 135;        
    const bikeWidth = 210;  
    const bikeHeight = 150; 
    const bikeOffsetX = -30; 
    const bikeOffsetY = -127; 
    const riderWidth = 120;  
    const riderHeight = 150;
    const riderOffsetX = -5; 
    const riderOffsetY = -150; 

    drawWheel(0, 0, wheelSize);
    drawWheel(wb, 0, wheelSize);

    if (imgBike.complete && imgBike.naturalWidth !== 0) {
        ctx.drawImage(imgBike, bikeOffsetX, bikeOffsetY, bikeWidth, bikeHeight);
    }
    if (imgRider.complete && imgRider.naturalWidth !== 0) {
        ctx.drawImage(imgRider, riderOffsetX, riderOffsetY, riderWidth, riderHeight);
    }

    // Дым (привязан к выхлопной трубе)
    if (angle > 10) {
        const exhaustX = -15; 
        const exhaustY = -45; 
        if (Math.random() < 0.8) {
            let r = -angle * Math.PI / 180;
            let startX = pX + (exhaustX * Math.cos(r) - exhaustY * Math.sin(r));
            let startY = pY + (exhaustX * Math.sin(r) + exhaustY * Math.cos(r));
            smokeParticles.push({ 
                x: startX, y: startY, 
                sz: Math.random() * 8 + 8, 
                vx: Math.random() * 4 + 4, 
                vy: -Math.random() * 1 - 0.5, 
                a: 0.8, 
                color: Math.random() > 0.5 ? '220,220,230' : '180,180,190' 
            });
        }
    }
    ctx.restore();
}

function drawTabs() {
    ctx.fillStyle = '#fff'; 
    ctx.font = "bold 18px 'Courier New', Courier, monospace";

    if (currentTab === 'garage') { 
        ctx.fillText("🏠 ГАРАЖ И ТЮНИНГ", 20, 160); 
        
        const startX = 20, startY = 190;
        const boxWidth = (canvas.width - 60) / 2, boxHeight = 160, gap = 20;

        // --- ПЕРВАЯ ПЛАШКА (Твой мотик) ---
        ctx.save();
        ctx.fillStyle = '#1a1a1a'; 
        ctx.beginPath(); ctx.roundRect(startX, startY, boxWidth, boxHeight, 16); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); 

        // Рисуем мотик без гонщика и сдвигаем его
        ctx.save();
        
        // ИЗМЕНЕНИЯ ЗДЕСЬ: подгоняем позицию (X и Y) и масштаб
        // startX + boxWidth/2 - 55 (центрируем по горизонтали)
        // startY + boxHeight/2 + 20 (опускаем ниже, чтобы колеса не висли)
        ctx.translate(startX + boxWidth / 2 - 50, startY + boxHeight / 2 + 10);
        ctx.scale(0.7, 0.7); // Масштаб
        
        // Рисуем колеса и раму (без гонщика!)
        drawWheel(0, 0, 65);
        drawWheel(135, 0, 65);
        
        if (imgBike.complete && imgBike.naturalWidth !== 0) {
            ctx.drawImage(imgBike, -30, -127, 210, 150);
        }
        
        ctx.restore();

        // Текст под мотиком
        ctx.textAlign = 'center'; 
        ctx.font = "bold 14px 'Courier New', Courier, monospace"; 
        ctx.fillStyle = '#fff';
        ctx.fillText("", startX + boxWidth / 2, startY + boxHeight - 35);
        ctx.fillStyle = '#fff';
        ctx.font = "bold 16px 'Courier New', Courier, monospace";
        ctx.fillText("Kawasaki KLX", startX + boxWidth / 2, startY + boxHeight - 20);
        ctx.restore();

        // --- ВТОРАЯ ПЛАШКА (Скоро...) ---
        ctx.save();
        ctx.fillStyle = '#121212'; 
        ctx.beginPath(); ctx.roundRect(startX + boxWidth + gap, startY, boxWidth, boxHeight, 16); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#262626'; ctx.stroke();
        
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4b5563';
        ctx.font = "bold 14px 'Courier New', Courier, monospace"; 
        ctx.fillText("СКОРО...", startX + boxWidth + gap + boxWidth / 2, startY + boxHeight / 2 + 5);
        ctx.restore();
    }

    else if (currentTab === 'cases') { 
        ctx.fillText("📦 СЕЗОННЫЕ КЕЙСЫ", 20, 160); 
        const startX = 20, startY = 190, boxWidth = (canvas.width - 60) / 2, boxHeight = 160, gap = 20;
        const cases = [
            { name: "ХЭЛЛОУИН", active: true, price: "500 ₽" },
            { name: "СКОРО...", active: false }, { name: "СКОРО...", active: false },
            { name: "СКОРО...", active: false }, { name: "СКОРО...", active: false }, { name: "СКОРО...", active: false }
        ];
        cases.forEach((box, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const x = startX + col * (boxWidth + gap), y = startY + row * (boxHeight + gap);
            ctx.save();
            ctx.fillStyle = box.active ? '#1a1a1a' : '#121212'; 
            ctx.beginPath(); ctx.roundRect(x, y, boxWidth, boxHeight, 16); ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = box.active ? '#f97316' : '#262626'; ctx.stroke();
            if (box.active && imgCaseHalloween.complete && imgCaseHalloween.naturalWidth !== 0) {
                ctx.drawImage(imgCaseHalloween, x + boxWidth/2 - 40, y + boxHeight/2 - 55, 80, 80);
            }
            ctx.textAlign = 'center'; ctx.font = "bold 14px 'Courier New', Courier, monospace"; 
            if (box.active) {
                ctx.fillStyle = '#f97316'; ctx.fillText(box.name, x + boxWidth / 2, y + boxHeight - 35);
                ctx.fillStyle = '#fff'; ctx.font = "bold 16px 'Courier New', Courier, monospace";
                ctx.fillText(box.price, x + boxWidth / 2, y + boxHeight - 10);
            } else {
                ctx.fillStyle = '#4b5563'; ctx.fillText(box.name, x + boxWidth / 2, y + boxHeight / 2 + 5);
            }
            ctx.restore();
        });
    }
    else if (currentTab === 'trade') { 
        ctx.fillText("🤝 ТРЕЙДЫ И ОБМЕН", 20, 160); 
    }
    else if (currentTab === 'top') { 
        ctx.fillText("🏆 ТОП СТАНТЕРОВ", 160, 160); 
        
        if (topPlayers.length === 0) {
            ctx.textAlign = 'center';
            ctx.fillStyle = '#888';
            ctx.font = "16px 'Courier New', Courier, monospace";
            ctx.fillText("Загрузка...", canvas.width / 2, 250);
            return;
        }

        const startY = 200, rowHeight = 60;

        topPlayers.forEach((player, index) => {
            const y = startY + index * rowHeight;
            const isMe = player.username === playerUsername;
            
            ctx.save();
            ctx.fillStyle = isMe ? 'rgba(249, 115, 22, 0.2)' : '#1a1a1a';
            ctx.beginPath(); ctx.roundRect(20, y, canvas.width - 40, 50, 12); ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = isMe ? '#f97316' : '#262626'; ctx.stroke();
            ctx.restore();

            ctx.textAlign = 'left';
            ctx.fillStyle = index === 0 ? '#fbbf24' : (index === 1 ? '#9ca3af' : (index === 2 ? '#b45309' : '#4b5563'));
            ctx.font = "bold 18px 'Courier New', Courier, monospace";
            ctx.fillText(`#${index + 1}`, 35, y + 31);

            ctx.fillStyle = isMe ? '#f97316' : '#ffffff';
            ctx.font = "bold 16px 'Courier New', Courier, monospace";
            let displayName = (player.username || "Игрок").slice(0, 12); 
            ctx.fillText(displayName, 80, y + 31);

            ctx.textAlign = 'right'; 
            ctx.fillStyle = '#a3e635';
            ctx.fillText(`${player.best_score || 0}м`, canvas.width - 35, y + 31);
        });
    }
}

// --- 9. ГЛАВНЫЙ ЦИКЛ ---
function loop(t) {
    let dt = (t - lastTime) / 16.666; lastTime = t; if (dt > 3) dt = 3;
    
    if (currentTab === 'stunt') {
        if (!isGameOver) {
            // ФИЗИКА
            if (isPressing) { liftInertia += ACCEL * dt; if (liftInertia > MAX_LIFT) liftInertia = MAX_LIFT; }
            else { liftInertia -= DECEL * dt; if (liftInertia < 0) liftInertia = 0; }
            angularVelocity += (liftInertia - GRAV) * dt; angularVelocity *= Math.pow(DAMP, dt); angle += angularVelocity * dt;
            
            if (angle < 0) { angle = 0; angularVelocity = 0; }
            if (angle >= CRASH) { 
                isGameOver = true; isPressing = false; 
                if (score > bestScore) bestScore = Math.floor(score);
                savePlayer(); // Сохраняем при краше
                document.getElementById('game-over-screen').style.display = 'flex'; 
                document.getElementById('final-score').innerText = Math.floor(score); 
            }

            // СКОРОСТЬ ФОНА
            let sp = 7; // Базовая скорость (на ровной дороге)
            if (angle > 30) {
                // В станте фон ускоряется: от 10 до 16 (в зависимости от угла)
                sp = 7 + (angle * 0.07); 
            }
            backgroundX += sp * dt;

            // НАЧИСЛЕНИЕ
            if (angle > 10) {
                let speedFactor = (angle - 10) / 50 + 0.01; 
                                // Уменьшаем скорость начисления в 5 раз (было просто * dt, стало / 5)
                score += (speedFactor / 5) * dt;  
                let progress = (angle - 10) / (CRASH - 10); 
                let rewardPerSecond = 50 + (150 * progress); 
                coins += (rewardPerSecond / 60) * dt;

                if (!window.lastMoneyTextTime) window.lastMoneyTextTime = 0;
                if (t - window.lastMoneyTextTime > 400) { 
                    window.lastMoneyTextTime = t;
                    let amt = Math.floor(rewardPerSecond / 2.5); 
                    moneyTexts.push({ 
                        x: canvas.width / 2 + (Math.random() - 0.5) * 60, 
                        y: 330 + (Math.random() - 0.5) * 40,
                        txt: `+${amt} ₽`, a: 1, c: progress > 0.6 ? '#4ade80' : '#facc15', v: Math.random() * 0.5 + 0.5 
                    });
                }
            } else {
                score = 0; 
            }
        }

        // Отрисовка фона
        ctx.fillStyle = '#a5b4fc'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (imgBg && imgBg.complete && imgBg.naturalWidth !== 0) {
            const scale = canvas.height / imgBg.naturalHeight;
            const bgWidth = imgBg.naturalWidth * scale;
            if (bgWidth > canvas.width) {
                let offset = backgroundX % bgWidth;
                ctx.drawImage(imgBg, -offset, 0, bgWidth, canvas.height);
                ctx.drawImage(imgBg, bgWidth - offset, 0, bgWidth, canvas.height);
            } else {
                let offset = (canvas.width - bgWidth) / 2;
                ctx.drawImage(imgBg, offset, 0, bgWidth, canvas.height);
            }
        }

        // Дым
        for (let i = smokeParticles.length - 1; i >= 0; i--) {
            let p = smokeParticles[i]; p.x -= p.vx * dt; p.y += p.vy * dt; p.a -= .015 * dt;
            if (p.a <= 0) smokeParticles.splice(i, 1);
            else { ctx.fillStyle = `rgba(${p.color || '240,240,245'},${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); }
        }

        drawBike(angle);

        // Текст
        for (let i = moneyTexts.length - 1; i >= 0; i--) {
            let m = moneyTexts[i]; m.y -= 2 * m.v * dt; m.a -= .02 * dt;
            if (m.a <= 0) moneyTexts.splice(i, 1);
            else {
                ctx.save(); ctx.fillStyle = m.c; ctx.font = "bold 22px 'Courier New'";
                ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.globalAlpha = m.a;
                ctx.fillText(m.txt, m.x - 30, m.y); ctx.restore();
            }
        }

        // UI
        document.getElementById('ui-center-score').innerHTML = `${Math.floor(score)}<span style="font-size: 28px; font-weight: normal; color: #e2e8f0; margin-left: 4px;">м</span>`;
        document.getElementById('ui-money-balance').innerText = Math.floor(coins).toLocaleString();
        let pPct = (angle / CRASH) * 100;
        document.getElementById('ui-energy').style.left = `calc(${pPct}% - 1px)`;

        // АВТОСОХРАНЕНИЕ РАЗ В 10 СЕК
        if (!window.lastDbSave) window.lastDbSave = 0;
        if (t - window.lastDbSave > 10000) { window.lastDbSave = t; savePlayer(); }

    } else {
        ctx.fillStyle = '#121212'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawTabs();
    }
    requestAnimationFrame(loop);
}

// --- 10. СТАРТ ---
document.getElementById('restart-btn').addEventListener('click', () => { 
    isPressing = false; 
    reset(); 
    lastTime = performance.now(); 
    loop(performance.now()); 
});

// Прячем интерфейс при старте (если не игра)
if (currentTab !== 'stunt') {
    document.getElementById('ui-center-score').style.display = 'none';
    document.getElementById('ui-balance-bar').style.display = 'none';
}

// ЗАПУСК
loadPlayer().then(() => {
    requestAnimationFrame((time) => { lastTime = time; loop(time); });
});