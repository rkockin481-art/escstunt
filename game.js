// --- 1. FIREBASE ---
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
} catch (e) { console.warn("Firebase не загрузился."); }

// --- 2. TELEGRAM ---
let playerTgId = "offline_user";
let playerUsername = "Гонщик";

const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    if (tg.requestFullscreen) tg.requestFullscreen();
    
    // ВЫВОДИМ ВСЁ, ЧТО ПРИХОДИТ ОТ ТЕЛЕГРАМА
    alert("initData: " + tg.initData + "\n\nUser: " + JSON.stringify(tg.initDataUnsafe?.user));
    
    if (tg.initDataUnsafe?.user) {
        playerTgId = tg.initDataUnsafe.user.id.toString();
        playerUsername = tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name || "Игрок";
    }
} else {
    alert("Telegram WebApp НЕ НАЙДЕН (игра открыта в браузере)");
}

// --- 3. КАРТИНКИ ---
const imgBike = new Image(); imgBike.src = 'bike.png'; 
const imgWheel = new Image(); imgWheel.src = 'wheel.png'; 
const imgRider = new Image(); imgRider.src = 'rider.png'; 
const imgBg = new Image(); imgBg.src = 'bg.png'; 
const imgCaseHalloween = new Image(); imgCaseHalloween.src = 'case_halloween.png'; 

const canvas = document.getElementById('gameCanvas'), ctx = canvas.getContext('2d');
function resize() { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; ctx.imageSmoothingEnabled = false; }
window.addEventListener('resize', resize); resize();

// --- 4. ПЕРЕМЕННЫЕ ---
let currentTab = 'stunt', 
    coins = parseInt(localStorage.getItem('stunt_coins')) || 0, 
    bestScore = parseInt(localStorage.getItem('stunt_best')) || 0,
    score = 0, angle = 0, angularVelocity = 0, liftInertia = 0, 
    isPressing = false, isGameOver = false, backgroundX = 0, 
    smokeParticles = [], moneyTexts = [], topPlayers = [], lastTime = performance.now();
const ACCEL = 0.012, DECEL = 0.011, MAX_LIFT = 0.22, GRAV = 0.05, DAMP = 0.96, CRASH = 95;

// --- 5. БАЗА ДАННЫХ ---
async function loadPlayer() {
    // ВРЕМЕННАЯ ПРОВЕРКА: Показывает ID при запуске
    alert("Твой ID: " + playerTgId); 
    
    if (firebaseReady && playerTgId !== "offline_user") {
        try {
            const snapshot = await db.ref('players/' + playerTgId).once('value');
            const data = snapshot.val();
            if (data) {
                coins = data.coins || 0;
                bestScore = data.best_score || 0;
                score = data.last_distance || 0;
            } else {
                await db.ref('players/' + playerTgId).set({ username: playerUsername, coins: coins, best_score: bestScore, last_distance: score });
            }
        } catch (e) { console.warn(e); }
    }
    document.getElementById('ui-money-balance').innerText = Math.floor(coins);
}

function savePlayer() {
    localStorage.setItem('stunt_coins', Math.floor(coins));
    if (score > bestScore) bestScore = Math.floor(score);
    localStorage.setItem('stunt_best', Math.floor(bestScore));
    if (firebaseReady && playerTgId !== "offline_user") {
        db.ref('players/' + playerTgId).update({ coins: Math.floor(coins), best_score: Math.floor(bestScore), last_distance: Math.floor(score) }).catch(e => console.warn(e));
    }
}

async function loadTop() {
    if (!firebaseReady) { topPlayers = []; return; }
    try {
        const snapshot = await db.ref('players').orderByChild('best_score').limitToLast(10).once('value');
        const data = snapshot.val();
        if (data) topPlayers = Object.values(data).sort((a, b) => (b.best_score || 0) - (a.best_score || 0));
        else topPlayers = [];
    } catch (e) { topPlayers = []; }
}

// --- 6. УПРАВЛЕНИЕ ---
const handle = (s) => { if (currentTab === 'stunt' && !isGameOver) isPressing = s; };
window.addEventListener('mousedown', () => handle(true));
window.addEventListener('mouseup', () => handle(false));
window.addEventListener('pointerdown', (e) => {
    if (currentTab === 'cases') {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left; const y = e.clientY - rect.top;
        if (x >= 20 && x <= 20 + (canvas.width - 60) / 2 && y >= 190 && y <= 190 + 160) openHalloweenCase();
        return;
    }
    if (e.target.closest('.bottom-bar-container') || e.target.closest('.top-bar')) return;
    handle(true);
});
window.addEventListener('pointerup', () => { handle(false); savePlayer(); });
window.addEventListener('pointercancel', () => handle(false));
document.body.addEventListener('touchmove', (e) => { if (currentTab === 'stunt') e.preventDefault(); }, { passive: false });

// --- 7. НАВИГАЦИЯ ---
const nav = document.querySelectorAll('.nav-item');
nav.forEach((item, idx) => {
    item.addEventListener('click', () => {
        nav.forEach(i => i.classList.remove('active')); item.classList.add('active'); isPressing = false;
        currentTab = ['garage', 'cases', 'stunt', 'trade', 'top'][idx];
        const topBar = document.querySelector('.top-bar'), centerScore = document.getElementById('ui-center-score'), energyBar = document.getElementById('ui-balance-bar');
        if (currentTab === 'stunt') {
            if (topBar) topBar.style.display = 'flex';
            if (centerScore) centerScore.style.display = 'block';
            if (energyBar) energyBar.style.display = 'flex';
        } else {
            if (topBar) topBar.style.display = 'flex';
            if (centerScore) centerScore.style.display = 'none';
            if (energyBar) energyBar.style.display = 'none';
            if (currentTab === 'top') loadTop();
            reset(); 
        }
        savePlayer();
    });
});

function reset() {
    angle = 0; angularVelocity = 0; liftInertia = 0; score = 0; backgroundX = 0;
    isPressing = false; smokeParticles = []; moneyTexts = [];
    document.getElementById('game-over-screen').style.display = 'none'; isGameOver = false;
}

// --- 8. ОТРИСОВКА ---
function drawWheel(x, y, size) {
    ctx.save(); ctx.translate(x, y);
    if (currentTab === 'stunt') ctx.rotate(window.performance.now() * 0.002 * (angle > 10 ? 8 : 4));
    if (imgWheel.complete && imgWheel.naturalWidth !== 0) {
        const ar = imgWheel.naturalWidth / imgWheel.naturalHeight;
        ctx.drawImage(imgWheel, -(size * ar) / 2, -size / 2, size * ar, size);
    } else { ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, size/2, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();
}

function drawBike(angle) {
    ctx.save();
    const rY = canvas.height - 150, pX = canvas.width * 0.34, pY = rY + 42;
    ctx.translate(pX, pY); ctx.rotate(-angle * Math.PI / 180);
    drawWheel(0, 0, 65); drawWheel(135, 0, 65);
    if (imgBike.complete) ctx.drawImage(imgBike, -30, -127, 210, 150);
    if (imgRider.complete) ctx.drawImage(imgRider, -5, -150, 120, 150);
    if (angle > 10 && Math.random() < 0.8) {
        let r = -angle * Math.PI / 180, exX = -15, exY = -45;
        smokeParticles.push({ x: pX + (exX * Math.cos(r) - exY * Math.sin(r)), y: pY + (exX * Math.sin(r) + exY * Math.cos(r)), sz: Math.random() * 8 + 8, vx: Math.random() * 4 + 4, vy: -Math.random() * 1 - 0.5, a: 0.8, color: '220,220,230' });
    }
    ctx.restore();
}

function drawTabs() {
    ctx.fillStyle = '#fff'; ctx.font = "bold 18px 'Courier New', Courier, monospace";
    if (currentTab === 'garage') { 
        ctx.fillText("🏠 ГАРАЖ И ТЮНИНГ", 20, 160); 
        // Тут твой код гаража
    } else if (currentTab === 'cases') { 
        ctx.fillText("📦 СЕЗОННЫЕ КЕЙСЫ", 20, 160); 
        // Тут твой код кейсов
    } else if (currentTab === 'trade') { 
        ctx.fillText("🤝 ТРЕЙДЫ И ОБМЕН", 20, 160); 
    } else if (currentTab === 'top') { 
        ctx.fillText("🏆 ТОП СТАНТЕРОВ", 160, 160); 
        if (topPlayers.length === 0) { ctx.textAlign = 'center'; ctx.fillStyle = '#888'; ctx.font = "16px 'Courier New', Courier, monospace"; ctx.fillText("Загрузка...", canvas.width / 2, 250); return; }
        topPlayers.forEach((player, index) => {
            const y = 200 + index * 60; const isMe = player.username === playerUsername;
            ctx.fillStyle = isMe ? 'rgba(249, 115, 22, 0.2)' : '#1a1a1a'; ctx.beginPath(); ctx.roundRect(20, y, canvas.width - 40, 50, 12); ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = isMe ? '#f97316' : '#262626'; ctx.stroke();
            ctx.textAlign = 'left'; ctx.fillStyle = index === 0 ? '#fbbf24' : (index === 1 ? '#9ca3af' : (index === 2 ? '#b45309' : '#4b5563')); ctx.font = "bold 18px 'Courier New', Courier, monospace"; ctx.fillText(`#${index + 1}`, 35, y + 31);
            ctx.fillStyle = isMe ? '#f97316' : '#ffffff'; ctx.font = "bold 16px 'Courier New', Courier, monospace"; ctx.fillText((player.username || "Игрок").slice(0, 12), 80, y + 31);
            ctx.textAlign = 'right'; ctx.fillStyle = '#a3e635'; ctx.fillText(`${player.best_score || 0}м`, canvas.width - 35, y + 31);
        });
    }
}

// --- 9. ЦИКЛ ---
function loop(t) {
    let dt = (t - lastTime) / 16.666; lastTime = t; if (dt > 3) dt = 3;
    if (currentTab === 'stunt') {
        if (!isGameOver) {
            if (isPressing) { liftInertia += ACCEL * dt; if (liftInertia > MAX_LIFT) liftInertia = MAX_LIFT; }
            else { liftInertia -= DECEL * dt; if (liftInertia < 0) liftInertia = 0; }
            angularVelocity += (liftInertia - GRAV) * dt; angularVelocity *= Math.pow(DAMP, dt); angle += angularVelocity * dt;
            if (angle < 0) { angle = 0; angularVelocity = 0; }
            if (angle >= CRASH) { isGameOver = true; isPressing = false; if (score > bestScore) bestScore = Math.floor(score); savePlayer(); document.getElementById('game-over-screen').style.display = 'flex'; document.getElementById('final-score').innerText = Math.floor(score); }
            let sp = 7; if (angle > 30) sp = 7 + (angle * 0.07); backgroundX += sp * dt;
            if (angle > 10) {
                let speedFactor = (angle - 10) / 50 + 0.01; score += (speedFactor / 3) * dt;
                let progress = (angle - 10) / (CRASH - 10); let rewardPerSecond = 50 + (150 * progress); coins += (rewardPerSecond / 60) * dt;
                if (!window.lastMoneyTextTime) window.lastMoneyTextTime = 0;
                if (t - window.lastMoneyTextTime > 400) { window.lastMoneyTextTime = t; let amt = Math.floor(rewardPerSecond / 2.5); moneyTexts.push({ x: canvas.width / 2 + (Math.random() - 0.5) * 60, y: 330 + (Math.random() - 0.5) * 40, txt: `+${amt} ₽`, a: 1, c: progress > 0.6 ? '#4ade80' : '#facc15', v: Math.random() * 0.5 + 0.5 }); }
                if (!window.lastStuntSave) window.lastStuntSave = 0;
                if (t - window.lastStuntSave > 1000) { window.lastStuntSave = t; savePlayer(); }
            } else { score = 0; }
        }
        ctx.fillStyle = '#a5b4fc'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (imgBg && imgBg.complete && imgBg.naturalWidth !== 0) {
            const scale = canvas.height / imgBg.naturalHeight; const bgWidth = imgBg.naturalWidth * scale;
            if (bgWidth > canvas.width) { let offset = backgroundX % bgWidth; ctx.drawImage(imgBg, -offset, 0, bgWidth, canvas.height); ctx.drawImage(imgBg, bgWidth - offset, 0, bgWidth, canvas.height); } else { let offset = (canvas.width - bgWidth) / 2; ctx.drawImage(imgBg, offset, 0, bgWidth, canvas.height); }
        }
        for (let i = smokeParticles.length - 1; i >= 0; i--) { let p = smokeParticles[i]; p.x -= p.vx * dt; p.y += p.vy * dt; p.a -= .015 * dt; if (p.a <= 0) smokeParticles.splice(i, 1); else { ctx.fillStyle = `rgba(${p.color || '240,240,245'},${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); } }
        drawBike(angle);
        for (let i = moneyTexts.length - 1; i >= 0; i--) { let m = moneyTexts[i]; m.y -= 2 * m.v * dt; m.a -= .02 * dt; if (m.a <= 0) moneyTexts.splice(i, 1); else { ctx.save(); ctx.fillStyle = m.c; ctx.font = "bold 22px 'Courier New'"; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.globalAlpha = m.a; ctx.fillText(m.txt, m.x - 30, m.y); ctx.restore(); } }
        document.getElementById('ui-center-score').innerHTML = `${Math.floor(score)}<span style="font-size: 28px; font-weight: normal; color: #e2e8f0; margin-left: 4px;">м</span>`;
        document.getElementById('ui-money-balance').innerText = Math.floor(coins).toLocaleString();
        document.getElementById('ui-energy').style.left = `calc(${(angle / CRASH) * 100}% - 1px)`;
        if (!window.lastDbSave) window.lastDbSave = 0;
        if (t - window.lastDbSave > 10000) { window.lastDbSave = t; savePlayer(); }
    } else { ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, canvas.width, canvas.height); drawTabs(); }
    requestAnimationFrame(loop);
}

// --- 10. СТАРТ ---
document.getElementById('restart-btn').addEventListener('click', () => { isPressing = false; reset(); lastTime = performance.now(); loop(performance.now()); });
if (currentTab !== 'stunt') { document.getElementById('ui-center-score').style.display = 'none'; document.getElementById('ui-balance-bar').style.display = 'none'; }
loadPlayer().then(() => { requestAnimationFrame((time) => { lastTime = time; loop(time); }); });