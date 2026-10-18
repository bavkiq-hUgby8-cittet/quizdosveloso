export const defaultAvatar = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#4ECDC4" width="100" height="100"/><circle cx="50" cy="38" r="16" fill="#ffffff"/><ellipse cx="50" cy="82" rx="26" ry="18" fill="#ffffff"/></svg>'
);

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function safeUrl(url) {
    const value = String(url ?? '').trim();
    if (value.startsWith('data:image/') || value.startsWith('https://') || value.startsWith('http://')) {
        return value;
    }
    return '';
}

export function imgSrc(url) {
    return safeUrl(url) || defaultAvatar;
}

export function shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function asArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key])
        .filter(Boolean);
}

export function phaseOf(config) {
    if (!config) return 'lobby';
    if (config.phase) return config.phase;
    if (config.gameEnded) return 'ended';
    if (config.gameStarted) return 'question';
    return 'lobby';
}

export function explainFirebaseError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || error || '');
    if (code.includes('permission') || /permission/i.test(message)) {
        return 'O Firebase recusou o acesso. As regras de segurança do Realtime Database (e do Storage, para as fotos) estão fechadas — o modo de teste aberto no Natal de 2025 provavelmente expirou. Sem isso, os celulares não sincronizam com o painel.';
    }
    if (/network|offline|unavailable|failed to fetch/i.test(code + message)) {
        return 'Sem conexão com o Firebase. Confira a internet e atualize a página.';
    }
    if (/configuration-not-found/i.test(code + message)) {
        return 'O Firebase Auth deste projeto não está configurado. O quiz não depende de login, mas as regras do banco precisam permitir leitura e escrita.';
    }
    return 'Não foi possível falar com o Firebase. ' + message;
}

export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createConfetti(container) {
    if (!container) return;
    container.innerHTML = '';
    if (prefersReducedMotion()) return;
    const colors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A855F7', '#3B82F6', '#22C55E', '#F97316', '#EC4899'];
    const shapes = ['■', '●', '▲', '★', '♦'];
    for (let i = 0; i < 70; i += 1) {
        const piece = document.createElement('div');
        piece.className = 'confetti';
        piece.textContent = shapes[Math.floor(Math.random() * shapes.length)];
        piece.style.left = Math.random() * 100 + '%';
        piece.style.color = colors[Math.floor(Math.random() * colors.length)];
        piece.style.fontSize = (Math.random() * 16 + 8) + 'px';
        piece.style.animationDelay = Math.random() * 2 + 's';
        piece.style.animationDuration = (Math.random() * 2 + 3) + 's';
        container.appendChild(piece);
    }
    window.setTimeout(() => {
        container.innerHTML = '';
    }, 6000);
}

export async function compressImage(file, maxSize = 900, quality = 0.82) {
    if (!file || !file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) return file;
        return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
    } catch (error) {
        console.warn('Não foi possível comprimir a imagem', error);
        return file;
    }
}

export function emptyState(icon, text) {
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><p>${escapeHtml(text)}</p></div>`;
}

export function playerPageUrl(mode) {
    const url = new URL('mobile-jogador.html', window.location.href);
    url.search = '';
    if (mode === 'demo') url.searchParams.set('ensaio', '1');
    return url.href;
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.left = '-999px';
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        input.remove();
        return ok;
    }
}
