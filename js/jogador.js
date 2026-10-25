import { createBackend } from './backend.js';
import { defaultConfig } from './demo-data.js';
import {
    asArray,
    compressImage,
    createConfetti,
    escapeHtml,
    explainFirebaseError,
    imgSrc,
    phaseOf,
    prefersReducedMotion,
} from './utils.js';

const backend = await createBackend();
const storageKey = backend.mode === 'demo' ? 'quizPlayerId-ensaio' : 'quizPlayerId';

let playerId = localStorage.getItem(storageKey);
let playerData = null;
let questions = {};
let players = {};
let prizes = {};
let config = defaultConfig();
let currentRound = null;
let hasAnswered = false;
let myScore = 0;
let configHydrated = false;
let resultsShown = false;
let playersHydrated = false;
let localTimer = null;
let timeUp = false;

const $ = (id) => document.getElementById(id);

function init() {
    bindEvents();
    backend.onStatus(renderStatus);
    renderStatus();
    listen();
    checkExistingPlayer();
}

function bindEvents() {
    $('cameraInput').addEventListener('change', handlePhoto);
    $('galleryInput').addEventListener('change', handlePhoto);
    $('btnCamera').addEventListener('click', () => $('cameraInput').click());
    $('btnGallery').addEventListener('click', () => $('galleryInput').click());
    $('registerForm').addEventListener('submit', joinGame);
    $('btnLeave').addEventListener('click', leaveGame);
    $('btnLeaveResults').addEventListener('click', leaveGame);
    $('btnEnsaio').addEventListener('click', () => {
        window.location.href = 'mobile-jogador.html?ensaio=1';
    });
}

function listen() {
    backend.onValue(backend.ref('questions'), (snap) => {
        questions = snap.val() || {};
        if (phaseOf(config) === 'question' && playerHere() && !$('optionsGrid').children.length) {
            displayQuestion();
        }
    });
    backend.onValue(backend.ref('players'), (snap) => {
        const next = snap.val() || {};
        const hadData = !!playerData;
        players = next;
        playersHydrated = true;
        const count = Object.keys(players).length;
        $('waitingPlayerCount').textContent = String(count);
        if (playerId && players[playerId]) {
            playerData = players[playerId];
            myScore = Number(playerData.score) || 0;
            updateScoreDisplay();
        } else if (playerId && hadData) {
            kick('Você foi removido desta partida.');
        }
    });
    backend.onValue(backend.ref('prizes'), (snap) => {
        prizes = snap.val() || {};
    });
    backend.onValue(backend.ref('currentRound'), (snap) => {
        currentRound = snap.val() || null;
        reflectExistingAnswer();
    });
    backend.onValue(backend.ref('config'), (snap) => {
        const prev = configHydrated ? config : null;
        config = snap.val() || defaultConfig();
        if (!configHydrated) {
            configHydrated = true;
            if (playerHere()) syncToPhase(true);
            return;
        }
        if (playerHere()) applyConfig(prev || defaultConfig(), config);
    });
}

function renderStatus(status = { ok: false, pending: backend.mode !== 'demo', mode: backend.mode, message: '' }) {
    const banner = $('statusBanner');
    if (backend.mode === 'demo') {
        banner.className = 'status-banner visible info';
        banner.textContent = 'Modo ensaio neste navegador. Abra esta aba pelo botão do painel, no mesmo computador.';
        $('btnEnsaio').hidden = true;
        return;
    }
    $('btnEnsaio').hidden = false;
    if (status.pending) {
        banner.className = 'status-banner visible info';
        banner.textContent = 'Conectando ao Firebase...';
        return;
    }
    if (status.ok) {
        banner.className = 'status-banner';
        banner.textContent = '';
        return;
    }
    banner.className = 'status-banner visible';
    banner.textContent = (status.message || explainFirebaseError(status.error)) + ' Peça para quem está no painel liberar o Firebase ou usar o modo ensaio.';
}

async function checkExistingPlayer() {
    if (!playerId) return;
    try {
        const snap = await backend.get(backend.ref(`players/${playerId}`));
        if (!snap.exists()) {
            localStorage.removeItem(storageKey);
            playerId = null;
            return;
        }
        playerData = snap.val();
        myScore = Number(playerData.score) || 0;
        fillWaiting();
        if (configHydrated) syncToPhase(true);
    } catch (error) {
        console.error(error);
    }
}

function playerHere() {
    return !!(playerId && (playerData || players[playerId]));
}

function fillWaiting() {
    const data = players[playerId] || playerData || {};
    $('waitingAvatar').src = imgSrc(data.photo);
    $('waitingAvatar').alt = '';
    $('waitingName').textContent = data.name || 'Jogador';
}

async function joinGame(event) {
    event.preventDefault();
    const name = $('playerName').value.trim();
    const errorBox = $('joinError');
    errorBox.textContent = '';
    if (!name) {
        errorBox.textContent = 'Digite seu nome.';
        return;
    }
    const button = $('btnJoin');
    button.disabled = true;
    button.textContent = '⏳ Entrando...';
    try {
        const created = backend.push(backend.ref('players'));
        playerId = created.key;
        let photoUrl = '';
        const file = $('cameraInput').files[0] || $('galleryInput').files[0] || selectedFile;
        if (file) {
            try {
                const compact = await compressImage(file, 480, 0.8);
                photoUrl = await backend.uploadFile(`players/${playerId}`, compact);
            } catch (error) {
                console.error(error);
                errorBox.textContent = 'A foto não foi enviada. Você entrou sem foto.';
                photoUrl = '';
            }
        }
        playerData = { name, photo: photoUrl, score: 0, answeredQuestion: null, roundId: 0 };
        await backend.set(backend.ref(`players/${playerId}`), playerData);
        localStorage.setItem(storageKey, playerId);
        myScore = 0;
        fillWaiting();
        syncToPhase(true);
    } catch (error) {
        errorBox.textContent = explainFirebaseError(error);
        playerId = null;
        button.disabled = false;
        button.textContent = '🎮 Entrar no jogo';
    }
}

let selectedFile = null;

function handlePhoto(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = () => {
        $('photoPreview').src = reader.result;
        $('photoPreview').classList.add('visible');
        $('photoPlaceholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
}

async function leaveGame() {
    const id = playerId;
    localStorage.removeItem(storageKey);
    playerId = null;
    playerData = null;
    resultsShown = false;
    hasAnswered = false;
    try {
        if (id) {
            await backend.remove(backend.ref(`players/${id}`));
            try { await backend.deleteFile(`players/${id}`); } catch { /* sem foto */ }
        }
    } catch (error) {
        console.error(error);
    }
    window.location.reload();
}

function kick(message) {
    localStorage.removeItem(storageKey);
    playerId = null;
    playerData = null;
    showScreen('registerScreen');
    $('joinError').textContent = message;
}

function syncToPhase(initial) {
    if (!playerHere()) return;
    fillWaiting();
    const phase = phaseOf(config);
    if (phase === 'intro') {
        showIntro();
        showScreen('waitingScreen');
    } else if (phase === 'question') {
        hideOverlay();
        showScreen('gameScreen');
        displayQuestion();
        if (config.timerActive && config.timerEndsAt) followTimer(config.timerEndsAt);
        else if (config.answersLocked) {
            timeUp = true;
            lockIfNeeded();
        }
    } else if (phase === 'ended') {
        hideOverlay();
        if (initial) showResults();
        else playEnding();
    } else {
        hideOverlay();
        showScreen('waitingScreen');
    }
}

function applyConfig(prev, next) {
    const prevPhase = phaseOf(prev);
    const nextPhase = phaseOf(next);
    if (nextPhase === 'lobby' && prevPhase !== 'lobby') {
        resultsShown = false;
        hasAnswered = false;
        myScore = Number(players[playerId]?.score) || 0;
        hideOverlay();
        showScreen('waitingScreen');
        updateScoreDisplay();
    }
    if (nextPhase === 'intro' && prevPhase !== 'intro') showIntro();
    if (nextPhase === 'question' && (prevPhase !== 'question' || prev.currentQuestionKey !== next.currentQuestionKey)) {
        hideOverlay();
        hasAnswered = false;
        timeUp = false;
        stopLocalTimer();
        showScreen('gameScreen');
        displayQuestion();
    }
    if (next.timerActive && next.timerEndsAt && next.timerEndsAt !== prev.timerEndsAt) followTimer(next.timerEndsAt);
    if (!next.timerActive && prev.timerActive) {
        stopLocalTimer();
        hideTimer();
    }
    if (next.answersLocked && !prev.answersLocked) {
        timeUp = true;
        lockIfNeeded();
    }
    if (nextPhase === 'ended' && prevPhase !== 'ended') playEnding();
}

function showIntro() {
    const overlay = $('animationOverlay');
    const prizeKeys = Object.keys(prizes).sort((a, b) => Number(prizes[a].position) - Number(prizes[b].position));
    const firstPrize = prizeKeys.length ? prizes[prizeKeys[0]] : null;
    const prizeHtml = firstPrize ? `
        <div class="prize-display">
            <div class="prize-title">Prêmio do 1º lugar</div>
            ${firstPrize.image ? `<img class="prize-image" alt="" src="${escapeHtml(imgSrc(firstPrize.image))}">` : ''}
            <div class="prize-name">${escapeHtml(firstPrize.name || '')}</div>
        </div>` : '';
    const faces = Object.keys(players).map((id, index) => `
        <img class="intro-avatar" alt="" src="${escapeHtml(imgSrc(players[id].photo))}" style="animation-delay:${index * 0.08}s">
    `).join('');
    $('animationContent').innerHTML = `
        <div class="intro-animation">
            <h1 class="intro-title">🎮 QUIZ DOS VELOSO 🎮</h1>
            <p class="intro-message">Preparados?</p>
            <div class="intro-avatars">${faces}</div>
            ${prizeHtml}
        </div>
    `;
    overlay.classList.add('active');
}

function hideOverlay() {
    $('animationOverlay').classList.remove('active');
    $('animationContent').innerHTML = '';
}

function currentQuestion() {
    const key = config.currentQuestionKey || asArray(config.questionOrder)[Number(config.currentQuestion) || 0];
    if (!key || !questions[key]) return null;
    return { key, question: questions[key] };
}

function displayQuestion() {
    const current = currentQuestion();
    if (!current) return;
    const total = asArray(config.questionOrder).length || Number(config.totalQuestions) || 1;
    const number = (Number(config.currentQuestion) || 0) + 1;
    $('gameQuestionCounter').textContent = `Pergunta ${number}/${total}`;
    $('gameProgressBar').style.width = `${(number / total) * 100}%`;
    $('gameQuestionText').textContent = current.question.text || '';
    const image = $('gameQuestionImage');
    if (current.question.image) {
        image.src = imgSrc(current.question.image);
        image.alt = 'Imagem da pergunta';
        image.classList.add('visible');
    } else {
        image.classList.remove('visible');
        image.removeAttribute('src');
        image.alt = '';
    }
    updateScoreDisplay();
    const letters = ['A', 'B', 'C', 'D'];
    const grid = $('optionsGrid');
    grid.innerHTML = '';
    (current.question.options || []).forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option-btn';
        button.id = `option-${index}`;
        button.setAttribute('aria-label', `Opção ${letters[index]}: ${option}`);
        const letter = document.createElement('div');
        letter.className = 'option-letter';
        letter.textContent = letters[index];
        const text = document.createElement('div');
        text.className = 'option-text';
        text.textContent = option;
        button.append(letter, text);
        button.addEventListener('click', () => selectOption(index));
        grid.append(button);
    });
    $('feedbackArea').innerHTML = '';
    if (!config.timerActive) hideTimer();
    hasAnswered = false;
    if (!config.answersLocked) timeUp = false;
    reflectExistingAnswer();
    if (config.answersLocked) lockIfNeeded();
}

function reflectExistingAnswer() {
    const current = currentQuestion();
    if (!current || !playerId || !currentRound) return;
    if (currentRound.questionKey !== current.key) return;
    const chosen = currentRound.answers?.[playerId];
    if (chosen === undefined || chosen === null) return;
    hasAnswered = true;
    reveal(Number(chosen), Number(current.question.correct), false);
}

async function selectOption(index) {
    if (hasAnswered || config.answersLocked || timeUp) return;
    const current = currentQuestion();
    if (!current || !playerId) return;
    hasAnswered = true;
    const correctIndex = Number(current.question.correct);
    const correct = index === correctIndex;
    document.querySelectorAll('.option-btn').forEach((button) => button.classList.add('disabled'));
    $('option-' + index)?.classList.add('selected');
    window.setTimeout(() => reveal(index, correctIndex, true), 280);
    let recorded = false;
    try {
        await backend.set(backend.ref(`currentRound/answers/${playerId}`), index);
        recorded = true;
        await scoreAnswer(current.key, correct);
    } catch (error) {
        console.error(error);
        if (!recorded) {
            hasAnswered = false;
            document.querySelectorAll('.option-btn').forEach((button) => button.classList.remove('disabled', 'selected'));
            showFeedback('incorrect', 'Não foi possível enviar. Toque de novo.');
        } else {
            showFeedback(correct ? 'correct' : 'incorrect', explainFirebaseError(error));
        }
    }
}

async function scoreAnswer(questionKey, correct) {
    const roundId = config.roundId || 0;
    const result = await backend.runTransaction(backend.ref(`players/${playerId}`), (player) => {
        if (player == null) return player;
        if (player.answeredQuestion === questionKey && Number(player.roundId) === Number(roundId)) return undefined;
        return {
            ...player,
            score: (Number(player.score) || 0) + (correct ? 1 : 0),
            answeredQuestion: questionKey,
            roundId,
        };
    });
    if (result?.committed && result.snapshot?.val()?.score != null) {
        myScore = Number(result.snapshot.val().score) || 0;
        updateScoreDisplay();
    }
}

function reveal(selected, correctIndex, announce) {
    document.querySelectorAll('.option-btn').forEach((button, index) => {
        button.classList.add('disabled');
        if (index === correctIndex) button.classList.add('correct');
        else if (index === selected && selected !== correctIndex) button.classList.add('incorrect');
    });
    if (!announce) return;
    if (selected === correctIndex) showFeedback('correct', 'Correto!');
    else showFeedback('incorrect', 'Errado!');
    window.setTimeout(() => {
        if (hasAnswered && phaseOf(config) === 'question') showFeedback('waiting', 'Aguardando a próxima...');
    }, 1500);
}

function showFeedback(kind, text) {
    $('feedbackArea').innerHTML = `
        <div class="feedback-message ${kind}" role="status">
            <div class="feedback-icon">${kind === 'correct' ? '🎉' : kind === 'incorrect' ? '😅' : '⏳'}</div>
            <div class="feedback-text">${escapeHtml(text)}</div>
        </div>
    `;
}

function followTimer(endsAt) {
    stopLocalTimer();
    const finish = () => {
        stopLocalTimer();
        timeUp = true;
        hideTimer();
        lockIfNeeded();
    };
    const tick = () => {
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        if (left <= 0) finish();
        else showTimer(left);
    };
    tick();
    if (timeUp) return;
    const timers = [
        window.setInterval(tick, 250),
        window.setTimeout(finish, Math.max(0, endsAt - Date.now())),
    ];
    localTimer = timers;
}

function stopLocalTimer() {
    if (!localTimer) return;
    const timers = Array.isArray(localTimer) ? localTimer : [localTimer];
    timers.forEach((timer) => {
        window.clearInterval(timer);
        window.clearTimeout(timer);
    });
    localTimer = null;
}

function lockIfNeeded() {
    if (!(config.answersLocked || timeUp) || hasAnswered) return;
    document.querySelectorAll('.option-btn').forEach((button) => button.classList.add('disabled'));
    showFeedback('waiting', 'Tempo esgotado!');
}

function showTimer(seconds) {
    $('timerDisplay').classList.add('active');
    updateTimer(seconds);
}

function hideTimer() {
    $('timerDisplay').classList.remove('active');
}

function updateTimer(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const bar = $('timerBar');
    const text = $('timerText');
    bar.style.width = `${(value / 10) * 100}%`;
    text.textContent = `⏱️ ${value}`;
    bar.classList.toggle('urgent', value <= 3);
    text.classList.toggle('urgent', value <= 3);
}

function updateScoreDisplay() {
    const label = myScore === 1 ? 'acerto' : 'acertos';
    $('gameScore').textContent = `⭐ ${myScore} ${label}`;
}

async function playEnding() {
    if (resultsShown) return;
    resultsShown = true;
    hideOverlay();
    const sorted = ranking();
    const faces = sorted.map((player) => player.photo || '');
    if (!faces.length || prefersReducedMotion()) {
        showResults();
        return;
    }
    $('animationContent').innerHTML = `
        <div class="shuffle-animation">
            <h2 class="shuffle-title">🎲 QUEM GANHOU? 🎲</h2>
            <div class="shuffle-avatar-container">
                <img class="shuffle-avatar" id="shuffleAvatar" alt="" src="${escapeHtml(imgSrc(faces[0]))}">
            </div>
        </div>
    `;
    $('animationOverlay').classList.add('active');
    const image = $('shuffleAvatar');
    let index = 0;
    const interval = window.setInterval(() => {
        index = (index + 1) % faces.length;
        if (image) image.src = imgSrc(sorted[index].photo);
    }, 150);
    await wait(prefersReducedMotion() ? 600 : 4000);
    window.clearInterval(interval);
    if (image) {
        image.style.animation = 'none';
        image.src = imgSrc(sorted[0].photo);
    }
    await wait(prefersReducedMotion() ? 400 : 2000);
    hideOverlay();
    showResults();
}

function showResults() {
    resultsShown = true;
    showScreen('resultsScreen');
    const sorted = ranking();
    const mine = sorted.findIndex((player) => player.id === playerId);
    const position = mine + 1;
    const total = asArray(config.questionOrder).length || Number(config.totalQuestions) || 0;
    const percent = total > 0 ? Math.round((myScore / total) * 100) : 0;
    const badge = $('resultsBadge');
    const posEl = $('resultsPosition');
    const message = $('resultsMessage');
    badge.className = 'results-badge';
    posEl.className = 'results-position';
    if (mine < 0) {
        badge.classList.add('participant');
        badge.textContent = '⭐';
        posEl.textContent = 'Fora desta partida';
        message.textContent = 'Sua entrada não está mais no ranking.';
    } else if (position === 1) {
        badge.classList.add('gold');
        badge.textContent = '👑';
        posEl.classList.add('gold');
        posEl.textContent = '1º lugar!';
        message.textContent = 'Campeão! Você é incrível!';
        createConfetti($('confettiContainer'));
    } else if (position === 2) {
        badge.classList.add('silver');
        badge.textContent = '🥈';
        posEl.classList.add('silver');
        posEl.textContent = '2º lugar!';
        message.textContent = 'Quase lá! Excelente!';
        createConfetti($('confettiContainer'));
    } else if (position === 3) {
        badge.classList.add('bronze');
        badge.textContent = '🥉';
        posEl.classList.add('bronze');
        posEl.textContent = '3º lugar!';
        message.textContent = 'No pódio! Muito bom!';
        createConfetti($('confettiContainer'));
    } else {
        badge.classList.add('participant');
        badge.textContent = '⭐';
        posEl.textContent = `${position}º lugar`;
        message.textContent = 'Boa participação!';
    }
    $('resultsScore').textContent = String(myScore);
    $('resultsPercent').textContent = `${percent}%`;
    const classes = ['gold', 'silver', 'bronze'];
    $('miniRanking').innerHTML = `
        <div class="mini-ranking-title">🏆 Ranking</div>
        ${sorted.slice(0, 5).map((player, index) => `
            <div class="mini-ranking-item ${player.id === playerId ? 'highlight' : ''}">
                <span class="mini-ranking-pos ${classes[index] || ''}">${index + 1}º</span>
                <img class="mini-ranking-avatar" alt="" src="${escapeHtml(imgSrc(player.photo))}">
                <span class="mini-ranking-name">${escapeHtml(player.name)}</span>
                <span class="mini-ranking-score">${player.score}</span>
            </div>
        `).join('') || '<p>Ninguém no ranking.</p>'}
    `;
}

function ranking() {
    return Object.entries(players).map(([id, player]) => ({
        id,
        name: player?.name || 'Jogador',
        photo: player?.photo || '',
        score: Number(player?.score) || 0,
    })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach((screen) => {
        const active = screen.id === id;
        screen.classList.toggle('active', active);
        screen.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
}

function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
});

init();
