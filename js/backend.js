import { DEMO_QUESTIONS, defaultConfig } from './demo-data.js';
import { explainFirebaseError } from './utils.js';

const DEMO_KEY = 'quiz-veloso-ensaio-v1';
const DEMO_CHANNEL = 'quiz-veloso-ensaio-v1';

const firebaseConfig = {
    apiKey: 'AIzaSyBWAF9DYI8IFuKSG2tMhFYhDtXcyQI_QoQ',
    authDomain: 'quiz-dos-veloso.firebaseapp.com',
    databaseURL: 'https://quiz-dos-veloso-default-rtdb.firebaseio.com',
    projectId: 'quiz-dos-veloso',
    storageBucket: 'quiz-dos-veloso.firebasestorage.app',
    messagingSenderId: '374643522848',
    appId: '1:374643522848:web:221c5f84de4c6bec1a6b45',
};

export function isDemoRequest() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ensaio') === '1' || params.get('demo') === '1';
}

export async function createBackend() {
    if (isDemoRequest()) return createDemoBackend();
    return createFirebaseBackend();
}

function splitPath(path) {
    return String(path || '').split('/').filter(Boolean);
}

function snapshot(value) {
    const empty = value === null || value === undefined;
    const cloned = empty ? null : JSON.parse(JSON.stringify(value));
    return {
        exists: () => !empty,
        val: () => cloned,
    };
}

function createDemoBackend() {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(DEMO_CHANNEL) : null;
    let db = load();
    const listeners = new Set();
    const statusHandlers = new Set();

    function load() {
        try {
            const raw = localStorage.getItem(DEMO_KEY);
            if (!raw) return seed();
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return seed();
            if (!parsed.config) parsed.config = defaultConfig();
            if (!parsed.__files) parsed.__files = {};
            return parsed;
        } catch {
            return seed();
        }
    }

    function seed() {
        const questions = {};
        DEMO_QUESTIONS.forEach((question, index) => {
            questions['exemplo' + (index + 1)] = { ...question, image: '' };
        });
        const data = {
            config: defaultConfig(),
            questions,
            __files: {},
        };
        localStorage.setItem(DEMO_KEY, JSON.stringify(data));
        return data;
    }

    function read(path) {
        let current = db;
        for (const part of splitPath(path)) {
            if (current == null || typeof current !== 'object') return null;
            current = current[part];
        }
        return current === undefined ? null : current;
    }

    function write(path, value) {
        const parts = splitPath(path);
        if (parts.length === 0) {
            db = value && typeof value === 'object' ? value : {};
            if (!db.__files) db.__files = {};
            return;
        }
        let current = db;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const key = parts[i];
            if (current[key] == null || typeof current[key] !== 'object' || Array.isArray(current[key])) {
                current[key] = {};
            }
            current = current[key];
        }
        const last = parts[parts.length - 1];
        if (value === null || value === undefined) delete current[last];
        else current[last] = value;
    }

    function related(listenPath, changePath) {
        if (!changePath || !listenPath) return true;
        return listenPath === changePath
            || listenPath.startsWith(changePath + '/')
            || changePath.startsWith(listenPath + '/');
    }

    function notify(changePath) {
        for (const listener of listeners) {
            if (!related(listener.path, changePath)) continue;
            listener.cb(snapshot(read(listener.path)));
        }
    }

    function persist(changePath) {
        localStorage.setItem(DEMO_KEY, JSON.stringify(db));
        notify(changePath);
        channel?.postMessage({ path: changePath || '' });
    }

    channel?.addEventListener('message', () => {
        db = load();
        notify('');
    });
    window.addEventListener('storage', (event) => {
        if (event.key !== DEMO_KEY) return;
        db = load();
        notify('');
    });

    queueMicrotask(() => {
        statusHandlers.forEach((cb) => cb({
            ok: true,
            mode: 'demo',
            message: 'Modo ensaio neste navegador. Nada aqui é gravado no Firebase.',
        }));
    });

    return {
        mode: 'demo',
        ref(path) { return { path: String(path || '').replace(/^\/+|\/+$/g, '') }; },
        onValue(reference, cb, cancel) {
            const listener = { path: reference.path, cb, cancel };
            listeners.add(listener);
            try {
                cb(snapshot(read(reference.path)));
            } catch (error) {
                cancel?.(error);
            }
            return () => listeners.delete(listener);
        },
        async get(reference) {
            return snapshot(read(reference.path));
        },
        async set(reference, value) {
            write(reference.path, value === undefined ? null : JSON.parse(JSON.stringify(value)));
            persist(reference.path);
        },
        async update(reference, values) {
            let target = read(reference.path);
            if (target == null || typeof target !== 'object' || Array.isArray(target)) {
                write(reference.path, {});
                target = read(reference.path);
            }
            Object.entries(values || {}).forEach(([key, value]) => {
                if (value === null || value === undefined) delete target[key];
                else target[key] = JSON.parse(JSON.stringify(value));
            });
            persist(reference.path);
        },
        async remove(reference) {
            write(reference.path, null);
            persist(reference.path);
        },
        push(reference) {
            const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            const path = reference.path ? reference.path + '/' + key : key;
            return { key, path };
        },
        async runTransaction(reference, updater) {
            const current = snapshot(read(reference.path)).val();
            const next = updater(current);
            if (next === undefined) return { committed: false, snapshot: snapshot(current) };
            write(reference.path, next);
            persist(reference.path);
            return { committed: true, snapshot: snapshot(next) };
        },
        async uploadFile(path, file) {
            const dataUrl = await readFile(file);
            if (!db.__files || typeof db.__files !== 'object') db.__files = {};
            db.__files[path] = dataUrl;
            persist('__files');
            return dataUrl;
        },
        async deleteFile(path) {
            if (db.__files) delete db.__files[path];
            persist('__files');
        },
        async listFiles(prefix) {
            return Object.keys(db.__files || {}).filter((path) => path === prefix || path.startsWith(prefix + '/'));
        },
        onStatus(cb) {
            statusHandlers.add(cb);
            return () => statusHandlers.delete(cb);
        },
        helpText() {
            return 'O modo ensaio sincroniza o painel e o jogador só entre abas deste navegador. As perguntas de exemplo não são as da família e não vão para o Firebase.';
        },
    };
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo'));
        reader.readAsDataURL(file);
    });
}

async function createFirebaseBackend() {
    const statusHandlers = new Set();
    let failureLogged = false;
    const emit = (status) => statusHandlers.forEach((cb) => cb(status));
    const fail = (error) => {
        if (!failureLogged) {
            failureLogged = true;
            console.error(error);
        }
        emit({ ok: false, mode: 'firebase', message: explainFirebaseError(error), error });
    };

    let appMod;
    let dbMod;
    let storageMod;
    try {
        [appMod, dbMod, storageMod] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js'),
            import('https://www.gstatic.com/firebasejs/13.0.0/firebase-storage.js'),
        ]);
    } catch (error) {
        const backend = disconnectedBackend(emit, 'Não foi possível carregar o Firebase. Confira a internet. O modo ensaio continua disponível neste computador.');
        queueMicrotask(() => emit({ ok: false, mode: 'firebase', message: backend.message }));
        return backend;
    }

    const app = appMod.initializeApp(firebaseConfig);
    const db = dbMod.getDatabase(app);
    const storage = storageMod.getStorage(app);

    const wrap = (reference) => dbMod.ref(db, reference.path || '/');

    async function probe() {
        try {
            await dbMod.get(dbMod.ref(db, 'config'));
            emit({ ok: true, mode: 'firebase', message: 'Conectado ao Firebase' });
        } catch (error) {
            fail(error);
        }
    }

    queueMicrotask(probe);

    return {
        mode: 'firebase',
        ref(path) { return { path: String(path || '').replace(/^\/+|\/+$/g, '') }; },
        onValue(reference, cb, cancel) {
            return dbMod.onValue(wrap(reference), cb, (error) => {
                fail(error);
                cancel?.(error);
            });
        },
        get: (reference) => dbMod.get(wrap(reference)),
        set: (reference, value) => dbMod.set(wrap(reference), value),
        update: (reference, values) => dbMod.update(wrap(reference), values),
        remove: (reference) => dbMod.remove(wrap(reference)),
        push(reference) {
            const pushed = dbMod.push(wrap(reference));
            return { key: pushed.key, path: reference.path ? reference.path + '/' + pushed.key : pushed.key };
        },
        runTransaction: (reference, updater) => dbMod.runTransaction(wrap(reference), updater),
        async uploadFile(path, file) {
            const stored = storageMod.ref(storage, path);
            await storageMod.uploadBytes(stored, file, { contentType: file.type || 'image/jpeg' });
            return storageMod.getDownloadURL(stored);
        },
        async deleteFile(path) {
            await storageMod.deleteObject(storageMod.ref(storage, path));
        },
        async listFiles(prefix) {
            const listed = await storageMod.listAll(storageMod.ref(storage, prefix));
            return listed.items.map((item) => item.fullPath);
        },
        onStatus(cb) {
            statusHandlers.add(cb);
            return () => statusHandlers.delete(cb);
        },
        helpText() {
            return 'Para a festa, publique no console do projeto quiz-dos-veloso as regras de database.rules.json (Realtime Database) e storage.rules (Storage). Depois do Natal, feche as regras de novo.';
        },
    };
}

function disconnectedBackend(emit, message) {
    const fail = () => Promise.reject(new Error(message));
    return {
        mode: 'firebase',
        message,
        ref(path) { return { path: String(path || '') }; },
        onValue(_reference, _cb, cancel) {
            const error = new Error(message);
            cancel?.(error);
            return () => {};
        },
        get: fail,
        set: fail,
        update: fail,
        remove: fail,
        push() { return { key: 'offline', path: 'offline' }; },
        runTransaction: fail,
        uploadFile: fail,
        deleteFile: fail,
        listFiles: async () => [],
        onStatus(cb) {
            cb({ ok: false, mode: 'firebase', message });
            return () => {};
        },
        helpText() { return message; },
    };
}
