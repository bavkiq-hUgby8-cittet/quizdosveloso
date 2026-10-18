import { createBackend } from './backend.js';
import { defaultConfig } from './demo-data.js';
import {
    asArray,
    compressImage,
    copyText,
    createConfetti,
    emptyState,
    escapeHtml,
    explainFirebaseError,
    imgSrc,
    phaseOf,
    playerPageUrl,
    prefersReducedMotion,
    shuffle,
} from './utils.js';

const backend = await createBackend();
const TIMER_SECONDS = 10;

let questions = {};
let players = {};
let prizes = {};
let currentRound = null;
let config = defaultConfig();
let totalQuestions = 10;
let currentQuestionIndex = 0;
let questionKeys = [];
let timerInterval = null;
let timerRunning = false;
let ending = false;
let questionsReady = false;
let configReady = false;
let restored = false;
let statusState = { ok: false, pending: backend.mode !== 'demo', mode: backend.mode, message: '' };

const $ = (id) => document.getElementById(id);

function init() {
    createStars();
    bindEvents();
    renderLink();
    backend.onStatus((status) => {
        statusState = status;
        renderStatus();
    });
    renderStatus();
    listen();
    ensureConfig();
}

function createStars() {
    const container = $('starsContainer');
    const symbols = ['⭐', '✨', '🌟', '💫'];
    for (let i = 0; i < 15; i += 1) {
        const star = document.createElement('div');
        star.className = 'star';
        star.setAttribute('aria-hidden', 'true');
        star.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDelay = Math.random() * 8 + 's';
        star.style.fontSize = (Math.random() * 12 + 12) + 'px';
        container.appendChild(star);
    }
}

function bindEvents() {
    document.querySelectorAll('.count-btn').forEach((button) => {
        button.addEventListener('click', () => selectCount(button));
    });
    $('btnAddQuestion').addEventListener('click', () => openQuestionModal());
    $('btnAddPrize').addEventListener('click', () => openPrizeModal());
    $('btnStartGame').addEventListener('click', startGame);
    $('btnTimer').addEventListener('click', startTimer);
    $('btnNext').addEventListener('click', nextQuestion);
    $('btnShare').addEventListener('click', shareResults);
    $('btnNewGame').addEventListener('click', newGame);
    $('btnReset').addEventListener('click', openResetModal);
    $('btnCancelQuestion').addEventListener('click', closeQuestionModal);
    $('btnCancelPrize').addEventListener('click', closePrizeModal);
    $('btnCancelReset').addEventListener('click', closeResetModal);
    $('btnConfirmReset').addEventListener('click', confirmReset);
    $('btnWaitMore').addEventListener('click', closeWaitingModal);
    $('btnForceNext').addEventListener('click', forceNextQuestion);
    $('btnCopyLink').addEventListener('click', copyLink);
    $('btnOpenPlayer').addEventListener('click', () => window.open(playerPageUrl(backend.mode), '_blank', 'noopener'));
    $('btnEnsaio').addEventListener('click', () => {
        window.location.href = 'index.html?ensaio=1';
    });
    $('questionForm').addEventListener('submit', saveQuestion);
    $('prizeForm').addEventListener('submit', savePrize);
    $('questionImage').addEventListener('change', (event) => previewImage(event.target, 'questionImagePreview', 'questionUploadPlaceholder'));
    $('prizeImage').addEventListener('change', (event) => previewImage(event.target, 'prizeImagePreview', 'prizeUploadPlaceholder'));
    $('questionsList').addEventListener('click', onQuestionsClick);
    $('prizesList').addEventListener('click', onPrizesClick);
    $('playersGrid').addEventListener('click', onPlayersClick);
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) overlay.classList.remove('active');
        });
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay.active').forEach((overlay) => overlay.classList.remove('active'));
    });
    $('confirmResetInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmReset();
        }
    });
}

function listen() {
    backend.onValue(backend.ref('questions'), (snap) => {
        questions = snap.val() || {};
        questionsReady = true;
        renderQuestions();
        updateStartButton();
        updateCountHint();
        tryRestore();
    });
    backend.onValue(backend.ref('players'), (snap) => {
        players = snap.val() || {};
        renderPlayers();
        renderGamePlayers();
        updateAnswerStatuses();
        updateStartButton();
        if (restored && phaseOf(config) === 'ended' && $('resultsScreen').classList.contains('active')) {
            showResults(ranking(), { celebrate: false });
        }
    });
    backend.onValue(backend.ref('prizes'), (snap) => {
        prizes = snap.val() || {};
        renderPrizes();
    });
    backend.onValue(backend.ref('currentRound'), (snap) => {
        currentRound = snap.val() || null;
        updateAnswerStatuses();
    });
    backend.onValue(backend.ref('config'), (snap) => {
        config = snap.val() || defaultConfig();
        configReady = true;
        if (!restored) {
            if (config.totalQuestions) totalQuestions = Number(config.totalQuestions) || 10;
            syncCountButtons();
            tryRestore();
        } else if (phaseOf(config) === 'ended' && $('gameScreen').classList.contains('active')) {
            showFinalAnimation();
        }
    });
    backend.onValue(backend.ref('lastChampion'), (snap) => {
        const champion = snap.val();
        const box = $('lastChampion');
        if (!champion) {
            box.classList.remove('visible');
            return;
        }
        $('lastChampionAvatar').src = imgSrc(champion.photo);
        $('lastChampionAvatar').alt = '';
        $('lastChampionName').textContent = champion.name || 'Campeão';
        box.classList.add('visible');
    });
}

async function ensureConfig() {
    try {
        const snap = await backend.get(backend.ref('config'));
        if (!snap.exists()) await backend.set(backend.ref('config'), defaultConfig());
    } catch (error) {
        console.error(error);
    }
}

function tryRestore() {
    if (restored || !questionsReady || !configReady) return;
    restored = true;
    const phase = phaseOf(config);
    questionKeys = asArray(config.questionOrder);
    currentQuestionIndex = Number(config.currentQuestion) || 0;
    if (phase === 'intro') {
        showScreen('gameScreen');
        displayCurrentQuestion();
    } else if (phase === 'question' && questionKeys.length) {
        showScreen('gameScreen');
        paintQuestion();
    } else if (phase === 'ended') {
        showScreen('resultsScreen');
        showResults(ranking(), { celebrate: false });
    }
}

function renderStatus() {
    const banner = $('statusBanner');
    const pill = $('connectionPill');
    const ensaio = $('btnEnsaio');
    if (backend.mode === 'demo') {
        pill.textContent = 'Ensaio neste navegador';
        pill.className = 'connection-pill demo';
        banner.className = 'status-banner visible info';
        banner.textContent = 'Modo ensaio: o painel e o celular só se encontram em abas deste navegador. As 5 perguntas de exemplo são genéricas (não são as da família) e não vão para o Firebase. ' + backend.helpText();
        ensaio.hidden = true;
        return;
    }
    ensaio.hidden = false;
    if (statusState.pending) {
        pill.textContent = 'Conectando...';
        pill.className = 'connection-pill';
        banner.className = 'status-banner visible info';
        banner.textContent = 'Conectando ao Firebase...';
        return;
    }
    if (statusState.ok) {
        pill.textContent = 'Conectado ao Firebase';
        pill.className = 'connection-pill ok';
        banner.className = 'status-banner';
        banner.textContent = '';
        return;
    }
    pill.textContent = 'Firebase bloqueado';
    pill.className = 'connection-pill bad';
    banner.className = 'status-banner visible';
    banner.textContent = (statusState.message || 'Sem acesso ao Firebase.') + '\n\n' + backend.helpText() + '\n\nEnquanto isso, use o modo ensaio para treinar a festa neste computador.';
}

function renderLink() {
    const url = playerPageUrl(backend.mode);
    const link = $('playerLink');
    link.textContent = url;
    link.href = url;
    generateQr(url);
}

function generateQr(url) {
    const box = $('qrcode');
    box.innerHTML = '';
    if (typeof QRCode === 'undefined') {
        box.textContent = 'QR indisponível. Use o link abaixo.';
        return;
    }
    try {
        new QRCode(box, {
            text: url,
            width: 180,
            height: 180,
            colorDark: '#1E1B4B',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });
    } catch (error) {
        console.error(error);
        box.textContent = 'Não foi possível gerar o QR. Use o link abaixo.';
    }
}

async function copyLink() {
    const ok = await copyText(playerPageUrl(backend.mode));
    $('btnCopyLink').textContent = ok ? 'Link copiado' : 'Copie o link abaixo';
    window.setTimeout(() => {
        $('btnCopyLink').textContent = 'Copiar link';
    }, 1800);
}

async function selectCount(button) {
    document.querySelectorAll('.count-btn').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
    button.setAttribute('aria-pressed', 'true');
    document.querySelectorAll('.count-btn').forEach((item) => {
        if (item !== button) item.setAttribute('aria-pressed', 'false');
    });
    totalQuestions = Number(button.dataset.count);
    updateCountHint();
    try {
        await backend.update(backend.ref('config'), { totalQuestions });
    } catch (error) {
        reportError(error);
    }
}

function syncCountButtons() {
    document.querySelectorAll('.count-btn').forEach((button) => {
        const selected = Number(button.dataset.count) === Number(totalQuestions);
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    updateCountHint();
}

function updateCountHint() {
    const available = Object.keys(questions).length;
    const hint = $('countHint');
    if (!available) {
        hint.textContent = 'Cadastre as perguntas da família antes de começar.';
        return;
    }
    const used = Math.min(totalQuestions, available);
    hint.textContent = available < totalQuestions
        ? `Há ${available} pergunta(s). O jogo vai usar ${used}.`
        : `O jogo sorteia ${used} de ${available} perguntas.`;
}

function renderQuestions() {
    const list = $('questionsList');
    const keys = Object.keys(questions);
    $('questionsCount').textContent = String(keys.length);
    if (!keys.length) {
        list.innerHTML = emptyState('📋', 'Nenhuma pergunta');
        return;
    }
    list.innerHTML = keys.map((key, index) => `
        <div class="question-item">
            <div class="question-number">${index + 1}</div>
            <div class="question-text">${escapeHtml(questions[key].text || '')}</div>
            <div class="question-actions">
                <button type="button" class="btn-edit" data-edit-question="${escapeHtml(key)}" aria-label="Editar pergunta ${index + 1}">✏️</button>
                <button type="button" class="btn-delete" data-delete-question="${escapeHtml(key)}" aria-label="Excluir pergunta ${index + 1}">🗑️</button>
            </div>
        </div>
    `).join('');
}

function onQuestionsClick(event) {
    const edit = event.target.closest('[data-edit-question]');
    const remove = event.target.closest('[data-delete-question]');
    if (edit) openQuestionModal(edit.dataset.editQuestion);
    if (remove) deleteQuestion(remove.dataset.deleteQuestion);
}

function openQuestionModal(id = null) {
    $('questionModal').classList.add('active');
    $('questionForm').reset();
    $('editingQuestionId').value = '';
    $('questionFormError').textContent = '';
    resetPreview('questionImagePreview', 'questionUploadPlaceholder');
    if (!id || !questions[id]) {
        $('questionText').focus();
        return;
    }
    const question = questions[id];
    $('editingQuestionId').value = id;
    $('questionText').value = question.text || '';
    ['optionA', 'optionB', 'optionC', 'optionD'].forEach((field, index) => {
        $(field).value = question.options?.[index] || '';
    });
    const correct = document.querySelector(`input[name="correct"][value="${question.correct}"]`);
    if (correct) correct.checked = true;
    if (question.image) showPreview('questionImagePreview', 'questionUploadPlaceholder', question.image);
    $('questionText').focus();
}

function closeQuestionModal() {
    $('questionModal').classList.remove('active');
}

async function saveQuestion(event) {
    event.preventDefault();
    const errorBox = $('questionFormError');
    errorBox.textContent = '';
    const text = $('questionText').value.trim();
    const options = ['optionA', 'optionB', 'optionC', 'optionD'].map((id) => $(id).value.trim());
    const correctInput = document.querySelector('input[name="correct"]:checked');
    if (!text || options.some((option) => !option) || !correctInput) {
        errorBox.textContent = 'Preencha a pergunta, as quatro opções e marque a correta.';
        return;
    }
    const button = $('btnSaveQuestion');
    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
        const existingId = $('editingQuestionId').value;
        const id = existingId || backend.push(backend.ref('questions')).key;
        const file = $('questionImage').files[0];
        let url = questions[id]?.image || '';
        if (file) {
            const compact = await compressImage(file, 1000, 0.82);
            url = await backend.uploadFile(`questions/${id}`, compact);
        }
        await backend.set(backend.ref(`questions/${id}`), {
            text,
            options,
            correct: Number(correctInput.value),
            image: url,
        });
        closeQuestionModal();
    } catch (error) {
        errorBox.textContent = explainFirebaseError(error);
    } finally {
        button.disabled = false;
        button.textContent = '💾 Salvar';
    }
}

async function deleteQuestion(id) {
    const label = questions[id]?.text || 'esta pergunta';
    if (!window.confirm(`Excluir "${label}"?`)) return;
    try {
        if (questions[id]?.image) {
            try { await backend.deleteFile(`questions/${id}`); } catch { /* arquivo já ausente */ }
        }
        await backend.remove(backend.ref(`questions/${id}`));
    } catch (error) {
        reportError(error);
    }
}

function renderPrizes() {
    const list = $('prizesList');
    const keys = Object.keys(prizes).sort((a, b) => Number(prizes[a].position) - Number(prizes[b].position));
    if (!keys.length) {
        list.innerHTML = emptyState('🎁', 'Nenhum prêmio (opcional)');
        return;
    }
    const classes = ['', 'gold', 'silver', 'bronze'];
    list.innerHTML = keys.map((key) => {
        const prize = prizes[key];
        const position = Number(prize.position) || 0;
        const image = prize.image
            ? `<img class="prize-image" alt="" src="${escapeHtml(imgSrc(prize.image))}">`
            : '';
        return `
            <div class="prize-item">
                <div class="prize-position ${classes[position] || ''}">${position}º</div>
                ${image}
                <div class="prize-name">${escapeHtml(prize.name || '')}</div>
                <div class="prize-actions">
                    <button type="button" class="btn-edit" data-edit-prize="${escapeHtml(key)}" aria-label="Editar prêmio">✏️</button>
                    <button type="button" class="btn-delete" data-delete-prize="${escapeHtml(key)}" aria-label="Excluir prêmio">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

function onPrizesClick(event) {
    const edit = event.target.closest('[data-edit-prize]');
    const remove = event.target.closest('[data-delete-prize]');
    if (edit) openPrizeModal(edit.dataset.editPrize);
    if (remove) deletePrize(remove.dataset.deletePrize);
}

function openPrizeModal(id = null) {
    $('prizeModal').classList.add('active');
    $('prizeForm').reset();
    $('editingPrizeId').value = '';
    $('prizeFormError').textContent = '';
    resetPreview('prizeImagePreview', 'prizeUploadPlaceholder');
    if (id && prizes[id]) {
        const prize = prizes[id];
        $('editingPrizeId').value = id;
        $('prizePosition').value = String(prize.position || 1);
        $('prizeName').value = prize.name || '';
        if (prize.image) showPreview('prizeImagePreview', 'prizeUploadPlaceholder', prize.image);
    }
    $('prizeName').focus();
}

function closePrizeModal() {
    $('prizeModal').classList.remove('active');
}

async function savePrize(event) {
    event.preventDefault();
    const errorBox = $('prizeFormError');
    errorBox.textContent = '';
    const position = Number($('prizePosition').value);
    const name = $('prizeName').value.trim();
    const editingId = $('editingPrizeId').value;
    if (!name) {
        errorBox.textContent = 'Dê um nome ao prêmio.';
        return;
    }
    const duplicate = Object.entries(prizes).find(([id, prize]) => Number(prize.position) === position && id !== editingId);
    if (duplicate) {
        errorBox.textContent = 'Já existe um prêmio para este lugar. Edite o prêmio existente.';
        return;
    }
    const button = $('btnSavePrize');
    button.disabled = true;
    try {
        const id = editingId || backend.push(backend.ref('prizes')).key;
        const file = $('prizeImage').files[0];
        let url = prizes[id]?.image || '';
        if (file) {
            const compact = await compressImage(file, 800, 0.82);
            url = await backend.uploadFile(`prizes/${id}`, compact);
        }
        await backend.set(backend.ref(`prizes/${id}`), { position, name, image: url });
        closePrizeModal();
    } catch (error) {
        errorBox.textContent = explainFirebaseError(error);
    } finally {
        button.disabled = false;
    }
}

async function deletePrize(id) {
    if (!window.confirm('Excluir este prêmio?')) return;
    try {
        if (prizes[id]?.image) {
            try { await backend.deleteFile(`prizes/${id}`); } catch { /* arquivo já ausente */ }
        }
        await backend.remove(backend.ref(`prizes/${id}`));
    } catch (error) {
        reportError(error);
    }
}

function renderPlayers() {
    const grid = $('playersGrid');
    const keys = Object.keys(players);
    $('playerCountNumber').textContent = String(keys.length);
    if (!keys.length) {
        grid.innerHTML = emptyState('🎮', 'Aguardando...');
        return;
    }
    grid.innerHTML = keys.map((id) => `
        <div class="player-card">
            <button type="button" class="btn-remove-player" data-remove-player="${escapeHtml(id)}" aria-label="Remover ${escapeHtml(players[id].name || 'jogador')}">✕</button>
            <img class="player-avatar" alt="" src="${escapeHtml(imgSrc(players[id].photo))}">
            <div class="player-name">${escapeHtml(players[id].name || 'Jogador')}</div>
        </div>
    `).join('');
}

function onPlayersClick(event) {
    const button = event.target.closest('[data-remove-player]');
    if (button) removePlayer(button.dataset.removePlayer);
}

async function removePlayer(id) {
    const name = players[id]?.name || 'este jogador';
    if (!window.confirm(`Remover ${name}?`)) return;
    try {
        if (players[id]?.photo) {
            try { await backend.deleteFile(`players/${id}`); } catch { /* foto já ausente */ }
        }
        await backend.remove(backend.ref(`players/${id}`));
        await backend.remove(backend.ref(`currentRound/answers/${id}`));
    } catch (error) {
        reportError(error);
    }
}

function renderGamePlayers() {
    const list = $('gamePlayersList');
    const keys = Object.keys(players);
    list.innerHTML = keys.map((id) => `
        <div class="game-player-item" id="player-${escapeHtml(id)}">
            <img class="game-player-avatar" alt="" src="${escapeHtml(imgSrc(players[id].photo))}">
            <div class="game-player-info">
                <div class="game-player-name">${escapeHtml(players[id].name || 'Jogador')}</div>
                <div class="game-player-status">Aguardando...</div>
            </div>
            <div class="status-indicator" id="status-${escapeHtml(id)}"></div>
        </div>
    `).join('');
    updateAnswerStatuses();
}

function answersNow() {
    if (!currentRound || currentRound.questionKey !== questionKeys[currentQuestionIndex]) return {};
    return currentRound.answers || {};
}

function updateAnswerStatuses() {
    const answers = answersNow();
    Object.keys(players).forEach((id) => {
        const status = $('status-' + id);
        const row = $('player-' + id);
        if (!status || !row) return;
        const answered = answers[id] !== undefined;
        status.classList.toggle('answered', answered);
        const label = row.querySelector('.game-player-status');
        if (label) label.textContent = answered ? 'Respondeu ✓' : 'Aguardando...';
    });
}

function updateStartButton() {
    const button = $('btnStartGame');
    const questionCount = Object.keys(questions).length;
    const playerCount = Object.keys(players).length;
    button.disabled = questionCount === 0 || playerCount === 0 || !canWrite();
    if (backend.mode !== 'demo' && statusState.pending) button.textContent = 'Conectando...';
    else if (!canWrite() && backend.mode !== 'demo') button.textContent = 'Firebase bloqueado';
    else if (questionCount === 0) button.textContent = '📝 Adicione perguntas';
    else if (playerCount === 0) button.textContent = '👥 Aguardando jogadores...';
    else button.textContent = `🚀 Iniciar (${playerCount} ${playerCount === 1 ? 'jogador' : 'jogadores'})`;
}

function canWrite() {
    return backend.mode === 'demo' || statusState.ok;
}

async function startGame() {
    if ($('btnStartGame').disabled) return;
    const allKeys = Object.keys(questions);
    const playerIds = Object.keys(players);
    if (!allKeys.length || !playerIds.length) return;
    $('btnStartGame').disabled = true;
    try {
        questionKeys = shuffle(allKeys).slice(0, Math.min(totalQuestions, allKeys.length));
        currentQuestionIndex = 0;
        ending = false;
        const roundId = Date.now();
        for (const id of playerIds) {
            await backend.update(backend.ref(`players/${id}`), {
                score: 0,
                answeredQuestion: null,
                roundId,
            });
        }
        await backend.set(backend.ref('currentRound'), null);
        await backend.update(backend.ref('config'), {
            gameStarted: true,
            gameEnded: false,
            phase: 'intro',
            currentQuestion: 0,
            currentQuestionKey: null,
            totalQuestions: questionKeys.length,
            questionOrder: questionKeys,
            timerActive: false,
            timerSeconds: TIMER_SECONDS,
            answersLocked: false,
            roundId,
        });
        config = { ...config, phase: 'intro', roundId, questionOrder: questionKeys, gameStarted: true, gameEnded: false };
        showScreen('gameScreen');
        await showIntroAnimation();
        await displayCurrentQuestion();
    } catch (error) {
        reportError(error);
        showScreen('setupScreen');
        updateStartButton();
    }
}

function showIntroAnimation() {
    const overlay = $('animationOverlay');
    const container = $('animationContainer');
    const playerKeys = Object.keys(players);
    const prizeKeys = Object.keys(prizes).sort((a, b) => Number(prizes[a].position) - Number(prizes[b].position));
    const type = Math.floor(Math.random() * 4);
    const builders = [circularAnimation, gridAnimation, waveAnimation, zoomAnimation];
    container.innerHTML = builders[type](playerKeys, prizeKeys);
    overlay.classList.add('active');
    $('btnSkipAnimation').textContent = 'Pular abertura';
    const wait = prefersReducedMotion() ? 1200 : 10000;
    return waitForSkip(overlay, container, wait);
}

function avatarTag(id, style) {
    return `<img class="floating-avatar" alt="" src="${escapeHtml(imgSrc(players[id]?.photo))}" style="${style}">`;
}

function circularAnimation(playerKeys, prizeKeys) {
    let html = '<h1 class="intro-title">🎮 QUIZ DOS VELOSO 🎮</h1>';
    playerKeys.forEach((id, index) => {
        const angle = (index / Math.max(playerKeys.length, 1)) * Math.PI * 2;
        const x = 50 + 28 * Math.cos(angle);
        const y = 42 + 28 * Math.sin(angle);
        const size = 55 + (index % 3) * 6;
        html += avatarTag(id, `width:${size}px;height:${size}px;left:${x}%;top:${y}%;animation:orbit${index} 8s linear infinite;`);
    });
    html += `<style>${playerKeys.map((_, index) => `@keyframes orbit${index}{from{transform:rotate(0) translateX(18px) rotate(0);}to{transform:rotate(360deg) translateX(18px) rotate(-360deg);}}`).join('')}</style>`;
    html += prizeShowcase(prizeKeys);
    return html;
}

function gridAnimation(playerKeys, prizeKeys) {
    let html = '<h1 class="intro-title">🎮 QUIZ DOS VELOSO 🎮</h1>';
    const cols = Math.max(1, Math.ceil(Math.sqrt(playerKeys.length)));
    playerKeys.forEach((id, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const x = 12 + (col / cols) * 76;
        const y = 18 + (row / Math.max(1, Math.ceil(playerKeys.length / cols))) * 48;
        html += avatarTag(id, `width:60px;height:60px;left:${x}%;top:${y}%;animation:gridB 1s ease-in-out infinite;animation-delay:${index * 0.12}s;`);
    });
    html += '<style>@keyframes gridB{0%,100%{transform:scale(1) rotate(0);}50%{transform:scale(1.15) rotate(8deg);}}</style>';
    html += prizeShowcase(prizeKeys);
    return html;
}

function waveAnimation(playerKeys, prizeKeys) {
    let html = '<h1 class="intro-title">🎮 QUIZ DOS VELOSO 🎮</h1>';
    playerKeys.forEach((id, index) => {
        const x = 5 + (index / Math.max(playerKeys.length, 1)) * 85;
        html += avatarTag(id, `width:55px;height:55px;left:${x}%;top:38%;animation:waveM 2s ease-in-out infinite;animation-delay:${index * 0.18}s;`);
    });
    html += '<style>@keyframes waveM{0%,100%{transform:translateY(0) rotate(-5deg);}50%{transform:translateY(-70px) rotate(5deg);}}</style>';
    html += prizeShowcase(prizeKeys);
    return html;
}

function zoomAnimation(playerKeys, prizeKeys) {
    let html = '<h1 class="intro-title">🎮 QUIZ DOS VELOSO 🎮</h1>';
    playerKeys.forEach((id, index) => {
        const x = 8 + ((index * 37) % 80);
        const y = 18 + ((index * 23) % 45);
        html += avatarTag(id, `width:55px;height:55px;left:${x}%;top:${y}%;animation:zoomP 2.4s ease-in-out infinite;animation-delay:${index * 0.2}s;`);
    });
    html += '<style>@keyframes zoomP{0%,100%{transform:scale(0.6);opacity:0.7;}50%{transform:scale(1.3);opacity:1;}}</style>';
    html += prizeShowcase(prizeKeys);
    return html;
}

function prizeShowcase(prizeKeys) {
    if (!prizeKeys.length) return '';
    const medals = ['🥇', '🥈', '🥉'];
    const items = prizeKeys.slice(0, 3).map((key, index) => {
        const prize = prizes[key];
        const image = prize.image
            ? `<img class="prize-showcase-image" alt="" src="${escapeHtml(imgSrc(prize.image))}">`
            : '<div class="prize-showcase-fallback"></div>';
        return `<div class="prize-showcase-item"><div class="prize-medal">${medals[index] || '🎁'}</div>${image}<div class="prize-showcase-name">${escapeHtml(prize.name || '')}</div></div>`;
    }).join('');
    return `<div class="prize-showcase"><div class="prize-showcase-title">🎁 PRÊMIOS 🎁</div><div class="prize-showcase-items">${items}</div></div>`;
}

function waitForSkip(overlay, container, ms) {
    return new Promise((resolve) => {
        const button = $('btnSkipAnimation');
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            button.removeEventListener('click', finish);
            overlay.classList.remove('active');
            container.innerHTML = '';
            resolve();
        };
        button.addEventListener('click', finish);
        const timer = window.setTimeout(finish, ms);
    });
}

async function displayCurrentQuestion() {
    clearTimer();
    if (currentQuestionIndex >= questionKeys.length) {
        await endGame();
        return;
    }
    const key = questionKeys[currentQuestionIndex];
    if (!questions[key]) {
        currentQuestionIndex += 1;
        await displayCurrentQuestion();
        return;
    }
    try {
        await backend.update(backend.ref('config'), {
            phase: 'question',
            currentQuestion: currentQuestionIndex,
            currentQuestionKey: key,
            timerActive: false,
            timerSeconds: TIMER_SECONDS,
            answersLocked: false,
        });
        await backend.set(backend.ref('currentRound'), { questionKey: key });
        config = { ...config, phase: 'question', currentQuestion: currentQuestionIndex, currentQuestionKey: key, answersLocked: false, timerActive: false };
        currentRound = { questionKey: key };
    } catch (error) {
        reportError(error);
        return;
    }
    paintQuestion();
}

function paintQuestion() {
    const key = questionKeys[currentQuestionIndex];
    const question = questions[key];
    if (!question) return;
    const total = questionKeys.length;
    $('questionCounter').textContent = `Pergunta ${currentQuestionIndex + 1} de ${total}`;
    $('progressBar').style.width = `${((currentQuestionIndex + 1) / total) * 100}%`;
    $('currentQuestionText').textContent = question.text || '';
    const image = $('currentQuestionImage');
    if (question.image) {
        image.src = imgSrc(question.image);
        image.alt = 'Imagem da pergunta';
        image.classList.add('visible');
    } else {
        image.removeAttribute('src');
        image.alt = '';
        image.classList.remove('visible');
    }
    $('timerContainer').classList.remove('active');
    $('timerNumber').textContent = String(TIMER_SECONDS);
    $('btnTimer').disabled = false;
    $('btnNext').textContent = currentQuestionIndex >= total - 1 ? 'Ver resultado 🏆' : 'Próxima ➡️';
    renderGamePlayers();
}

function startTimer() {
    if (timerRunning) return;
    timerRunning = true;
    $('btnTimer').disabled = true;
    $('timerContainer').classList.add('active');
    const endsAt = Date.now() + TIMER_SECONDS * 1000;
    const tick = () => {
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        paintTimer(left);
        if (left <= 0) {
            clearTimer();
            config = { ...config, answersLocked: true, timerActive: false, timerSeconds: 0, timerEndsAt: endsAt };
            backend.update(backend.ref('config'), {
                timerActive: false,
                timerSeconds: 0,
                answersLocked: true,
                timerEndsAt: endsAt,
            }).catch(reportError);
        }
    };
    tick();
    backend.update(backend.ref('config'), {
        timerActive: true,
        timerSeconds: TIMER_SECONDS,
        answersLocked: false,
        timerEndsAt: endsAt,
    }).catch(reportError);
    timerInterval = window.setInterval(tick, 250);
}

function paintTimer(seconds) {
    const safe = Math.max(0, seconds);
    $('timerNumber').textContent = String(safe);
    const degrees = (safe / TIMER_SECONDS) * 360;
    $('timerCircle').style.background = `conic-gradient(var(--primary) ${degrees}deg, rgba(255,255,255,0.1) ${degrees}deg)`;
}

function clearTimer(resetRunning = true) {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
    if (resetRunning) timerRunning = false;
    else timerRunning = false;
}

function nextQuestion() {
    clearTimer();
    const totalPlayers = Object.keys(players).length;
    const answered = Object.keys(answersNow()).length;
    if (answered < totalPlayers) {
        showWaitingModal();
        return;
    }
    proceedToNextQuestion();
}

function showWaitingModal() {
    const pending = Object.keys(players).filter((id) => answersNow()[id] === undefined);
    $('waitingPlayersList').innerHTML = pending.map((id) => `
        <div class="waiting-player">
            <img alt="" src="${escapeHtml(imgSrc(players[id].photo))}">
            <span>${escapeHtml(players[id].name || 'Jogador')}</span>
        </div>
    `).join('');
    $('waitingModal').classList.add('active');
}

function closeWaitingModal() {
    $('waitingModal').classList.remove('active');
}

function forceNextQuestion() {
    closeWaitingModal();
    proceedToNextQuestion();
}

function proceedToNextQuestion() {
    currentQuestionIndex += 1;
    if (currentQuestionIndex >= questionKeys.length) endGame();
    else displayCurrentQuestion();
}

async function endGame() {
    clearTimer();
    try {
        const snap = await backend.get(backend.ref('players'));
        if (snap.exists()) players = snap.val() || players;
        await backend.update(backend.ref('config'), {
            gameStarted: false,
            gameEnded: true,
            phase: 'ended',
            timerActive: false,
            answersLocked: true,
        });
        config = { ...config, phase: 'ended', gameEnded: true, gameStarted: false };
    } catch (error) {
        reportError(error);
    }
    await showFinalAnimation();
}

async function showFinalAnimation() {
    if (ending) return;
    ending = true;
    const sorted = ranking();
    const overlay = $('animationOverlay');
    const container = $('animationContainer');
    const winner = sorted[0];
    if (!winner) {
        showScreen('resultsScreen');
        showResults(sorted, { celebrate: false });
        return;
    }
    container.innerHTML = `
        <div class="final-shuffle-container">
            <div class="shuffle-title">🎲 QUEM SERÁ O CAMPEÃO? 🎲</div>
            <div class="shuffle-avatars" id="shuffleAvatars">${sorted.map((player) => `<img class="shuffle-avatar" alt="" src="${escapeHtml(imgSrc(player.photo))}">`).join('')}</div>
            <div class="winner-reveal" id="winnerReveal">
                <div class="winner-crown">👑</div>
                <img class="winner-avatar" alt="" src="${escapeHtml(imgSrc(winner.photo))}">
                <div class="winner-name">${escapeHtml(winner.name)}</div>
                <div class="winner-score">${winner.score} ${winner.score === 1 ? 'acerto' : 'acertos'}!</div>
            </div>
        </div>
    `;
    overlay.classList.add('active');
    $('btnSkipAnimation').textContent = 'Pular para o resultado';
    const firstWait = prefersReducedMotion() ? 700 : 5000;
    await new Promise((resolve) => {
        const button = $('btnSkipAnimation');
        const reveal = () => {
            window.clearTimeout(timer);
            button.removeEventListener('click', reveal);
            const avatars = $('shuffleAvatars');
            if (avatars) avatars.style.display = 'none';
            $('winnerReveal')?.classList.add('active');
            createConfetti($('confettiContainer'));
            resolve();
        };
        button.addEventListener('click', reveal);
        const timer = window.setTimeout(reveal, firstWait);
    });
    try {
        await backend.set(backend.ref('lastChampion'), { name: winner.name, photo: winner.photo || '' });
    } catch (error) {
        console.error(error);
    }
    const secondWait = prefersReducedMotion() ? 700 : 5000;
    await new Promise((resolve) => {
        const button = $('btnSkipAnimation');
        const done = () => {
            window.clearTimeout(timer);
            button.removeEventListener('click', done);
            resolve();
        };
        button.addEventListener('click', done);
        const timer = window.setTimeout(done, secondWait);
    });
    overlay.classList.remove('active');
    container.innerHTML = '';
    showScreen('resultsScreen');
    showResults(sorted, { celebrate: true });
}

function ranking() {
    return Object.entries(players).map(([id, player]) => ({
        id,
        name: player?.name || 'Jogador',
        photo: player?.photo || '',
        score: Number(player?.score) || 0,
    })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
}

function showResults(sorted, { celebrate }) {
    const max = questionKeys.length || asArray(config.questionOrder).length || Number(config.totalQuestions) || 0;
    const slots = [
        { pos: 2, player: sorted[1] },
        { pos: 1, player: sorted[0] },
        { pos: 3, player: sorted[2] },
    ].filter((slot) => slot.player);
    const prizeByPos = {};
    Object.values(prizes).forEach((prize) => {
        prizeByPos[Number(prize.position)] = prize;
    });
    $('podiumContainer').innerHTML = slots.map((slot) => {
        const prize = prizeByPos[slot.pos];
        const prizeHtml = prize
            ? `<div class="podium-prize">${escapeHtml(prize.name || '')}</div>${prize.image ? `<img class="podium-prize-image" alt="" src="${escapeHtml(imgSrc(prize.image))}">` : ''}`
            : '';
        return `
            <div class="podium-place place-${slot.pos}">
                ${slot.pos === 1 ? '<div class="podium-crown">👑</div>' : ''}
                <img class="podium-avatar" alt="" src="${escapeHtml(imgSrc(slot.player.photo))}">
                <div class="podium-name">${escapeHtml(slot.player.name)}</div>
                <div class="podium-score">${slot.player.score} ${slot.player.score === 1 ? 'acerto' : 'acertos'}</div>
                ${prizeHtml}
                <div class="podium-stand">${slot.pos}º</div>
            </div>
        `;
    }).join('') || '<p class="empty-state">Nenhum jogador nesta partida.</p>';

    $('rankingTableBody').innerHTML = sorted.map((player, index) => {
        const cls = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
        const percent = max > 0 ? Math.round((player.score / max) * 100) : 0;
        return `
            <tr>
                <td><span class="ranking-position ${cls}">${index + 1}º</span></td>
                <td><div class="ranking-player"><img class="ranking-avatar" alt="" src="${escapeHtml(imgSrc(player.photo))}"><span>${escapeHtml(player.name)}</span></div></td>
                <td>${player.score}/${max}</td>
                <td>${percent}%</td>
            </tr>
        `;
    }).join('');
    if (celebrate) createConfetti($('confettiContainer'));
}

async function shareResults() {
    const canvas = $('shareCanvas');
    const ctx = canvas.getContext('2d');
    await document.fonts?.ready?.catch?.(() => {});
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#1E1B4B');
    gradient.addColorStop(1, '#0F0D24');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.font = '700 52px Fredoka, Nunito, sans-serif';
    ctx.fillStyle = '#FFE66D';
    ctx.fillText('QUIZ DOS VELOSO', canvas.width / 2, 80);
    const top = ranking().slice(0, 3);
    const positions = [
        { x: 600, y: 190, label: '1º lugar', player: top[0] },
        { x: 300, y: 270, label: '2º lugar', player: top[1] },
        { x: 900, y: 270, label: '3º lugar', player: top[2] },
    ];
    positions.forEach((pos) => {
        if (!pos.player) return;
        ctx.font = '700 22px Nunito, sans-serif';
        ctx.fillStyle = '#FFE66D';
        ctx.fillText(pos.label, pos.x, pos.y);
        ctx.font = '700 32px Fredoka, Nunito, sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(pos.player.name, pos.x, pos.y + 46);
        ctx.font = '26px Nunito, sans-serif';
        ctx.fillStyle = '#4ECDC4';
        ctx.fillText(`${pos.player.score} acertos`, pos.x, pos.y + 86);
    });
    ctx.font = '18px Nunito, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Família Veloso', canvas.width / 2, canvas.height - 28);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'quiz-veloso.png', { type: 'image/png' });
    const champ = top[0]?.name || 'a família';
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ title: 'Quiz dos Veloso', text: `${champ} venceu o Quiz dos Veloso!`, files: [file] });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'quiz-veloso.png';
    link.click();
    URL.revokeObjectURL(url);
}

async function newGame() {
    clearTimer();
    ending = false;
    currentQuestionIndex = 0;
    try {
        await backend.update(backend.ref('config'), {
            ...defaultConfig(),
            totalQuestions,
        });
        await backend.set(backend.ref('currentRound'), null);
        for (const id of Object.keys(players)) {
            await backend.update(backend.ref(`players/${id}`), { score: 0, answeredQuestion: null });
        }
        config = { ...defaultConfig(), totalQuestions };
        showScreen('setupScreen');
        updateStartButton();
    } catch (error) {
        reportError(error);
    }
}

function openResetModal() {
    $('resetModal').classList.add('active');
    $('confirmResetInput').value = '';
    $('resetHelp').textContent = backend.mode === 'demo'
        ? 'Isso apaga só o ensaio deste navegador: perguntas de exemplo, jogadores e prêmios locais. O Firebase da família não é alterado.'
        : 'Isso apaga perguntas, jogadores, prêmios, fotos e o último campeão salvos no Firebase.';
    $('confirmResetInput').focus();
}

function closeResetModal() {
    $('resetModal').classList.remove('active');
}

async function confirmReset() {
    if ($('confirmResetInput').value.trim().toUpperCase() !== 'CONFIRMAR') {
        $('resetHelp').textContent = 'Digite CONFIRMAR para apagar.';
        return;
    }
    try {
        for (const folder of ['questions', 'players', 'prizes']) {
            try {
                const files = await backend.listFiles(folder);
                for (const path of files) {
                    try { await backend.deleteFile(path); } catch { /* segue o reset */ }
                }
            } catch { /* pasta vazia ou sem permissão */ }
        }
        await backend.set(backend.ref('/'), { config: defaultConfig() });
        if (backend.mode === 'demo') {
            localStorage.removeItem('quiz-veloso-ensaio-v1');
            window.location.reload();
            return;
        }
        closeResetModal();
        ending = false;
        questions = {};
        players = {};
        prizes = {};
        showScreen('setupScreen');
        $('resetDone').textContent = 'Tudo apagado. Pode montar o quiz de novo.';
    } catch (error) {
        $('resetHelp').textContent = explainFirebaseError(error);
    }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach((screen) => {
        const active = screen.id === id;
        screen.classList.toggle('active', active);
        screen.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
}

function previewImage(input, previewId, placeholderId) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => showPreview(previewId, placeholderId, reader.result);
    reader.readAsDataURL(file);
}

function showPreview(previewId, placeholderId, src) {
    const preview = $(previewId);
    preview.src = src;
    preview.classList.add('visible');
    $(placeholderId).style.display = 'none';
}

function resetPreview(previewId, placeholderId) {
    const preview = $(previewId);
    preview.removeAttribute('src');
    preview.classList.remove('visible');
    $(placeholderId).style.display = 'block';
}

function reportError(error) {
    console.error(error);
    if (backend.mode === 'demo') return;
    statusState = { ok: false, mode: 'firebase', message: explainFirebaseError(error) };
    renderStatus();
}

window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
    reportError(event.reason);
});

init();
