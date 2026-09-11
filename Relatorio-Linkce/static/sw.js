const CACHE = 'linkce-photos-v3';
const SHELL = ['/tecnico', '/static/style.css', '/static/technical-minimal.css', '/static/auth-ui.js', '/static/manifest.json', '/api/config', '/api/materiais', '/static/icon-192.png', '/static/icon-512.png'];

// ── Instalação: pré-cache do shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Ativação: limpa caches antigos ──────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: estratégia por rota ───────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  // Recovery pages and their scripts must never be served from stale offline cache.
  if (['/recuperar-senha', '/nova-senha', '/static/account.js', '/static/auth-ui.js'].includes(url.pathname)) {
    e.respondWith(fetch(request));
    return;
  }

  // POST /gerar_relatorio → fila offline se sem rede
  // Requests vindos da própria sincronização (X-Sync-Queue) vão direto à rede
  // sem passar pelo handler que re-enfileira — evita duplicatas em rede instável
  if (url.pathname === '/gerar_relatorio' && request.method === 'POST') {
    if (request.headers.get('X-Sync-Queue')) {
      e.respondWith(fetch(request));
      return;
    }
    e.respondWith(handleGerarRelatorio(request));
    return;
  }

  // Refresh the capture page online; preserve the offline fallback.
  if (url.pathname === '/tecnico' && request.method === 'GET') {
    e.respondWith(fetch(request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put('/tecnico', copy)).catch(() => {}));
      }
      return res;
    }).catch(() => caches.match('/tecnico')));
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(
      caches.match(request).then(hit => hit || fetchECachear(request))
    );
    return;
  }

  // /api/* GET → network first com fallback para cache
  if (['/api/config', '/api/materiais'].includes(url.pathname) && request.method === 'GET') {
    e.respondWith(
      fetch(request.clone())
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {}));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
});

async function fetchECachear(request) {
  const res = await fetch(request);
  const cache = await caches.open(CACHE);
  cache.put(request, res.clone());
  return res;
}

// ── Geração de relatório offline ─────────────────────────────────────────────
async function handleGerarRelatorio(request) {
  try {
    return await fetch(request.clone());
  } catch (_) {
    const data = await request.json();
    const relatorio = gerarRelatorioJS(data);
    const id = await salvarNaFila({ ...data, _pendente: true, _savedAt: new Date().toISOString() });

    try { await self.registration.sync.register('sync-relatorios'); } catch (_) {}

    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'PENDENTE_ATUALIZADO' }));

    return new Response(JSON.stringify({ relatorio, offline: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Replica exata da lógica Python do main.py
function gerarRelatorioJS(data) {
  const agora = new Date();
  const dataStr = agora.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).replace(',', '');

  const t = k => (data[k] || '').trim();
  const matUtil = t('materiais_utilizados');
  const matRec  = t('materiais_recolhidos');
  const check   = t('checklist_fotos');
  const tecnico = t('tecnico');

  let r = `-------------------------------------\nRelatório Técnico - ${dataStr}\n-------------------------------------`;
  if (tecnico) r += `\n\n> Técnico: ${tecnico}`;
  r += `\n\nSituação encontrado:\n${t('relatorio_texto')}`;
  r += `\n\nResolução do Problema:\n${t('problema_tecnico')}`;
  r += `\n\nCabeou o(s) Equipamento(s): ${t('equipamento_status')}\nOBS: ${t('equipamento_obs')}`;
  r += `\n\nMaior sinal de RSSI: ${t('maior_sinal')}`;
  r += `\n\nMateriais Utilizados:\n${matUtil || 'Nenhum'}`;
  r += `\n\nMateriais Recolhidos:\n${matRec || 'Nenhum'}`;
  if (check) r += `\n\n${check}`;
  r += '\n-------------------------------------';
  return r.trim();
}

// ── IndexedDB ────────────────────────────────────────────────────────────────
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('linkce-offline', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('fotos')) {
        const fotos = db.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
        fotos.createIndex('request_id', 'request_id', { unique: false });
      }
    };
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

async function salvarNaFila(dados) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fila', 'readwrite');
    const store = tx.objectStore('fila');
    const req = store.getAll();
    req.onsuccess = () => {
      if ((req.result || []).some(item => item.request_id && item.request_id === dados.request_id)) {
        resolve(dados.request_id); return;
      }
      const add = store.add(dados);
      add.onsuccess = e => resolve(e.target.result);
      add.onerror = e => reject(e.target.error);
    };
    req.onerror = e => reject(e.target.error);
  });
}

async function buscarFila() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('fila', 'readonly');
    const req = tx.objectStore('fila').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function removerDaFila(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fila', 'readwrite');
    tx.objectStore('fila').delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}


async function salvarFotosOffline(requestId, files) {
  if (!files?.length) return;
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fotos', 'readwrite');
    const store = tx.objectStore('fotos');
    files.forEach(file => store.add({request_id: requestId, nome: file.name || 'evidencia.jpg', tipo: file.type || file.blob?.type || 'image/jpeg', blob: file.blob || file}));
    tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
  });
}
async function buscarFotosOffline(requestId) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fotos', 'readonly');
    const req = tx.objectStore('fotos').index('request_id').getAll(requestId);
    req.onsuccess = e => resolve(e.target.result || []); req.onerror = e => reject(e.target.error);
  });
}
async function removerFotosOffline(requestId) {
  const db = await abrirDB();
  const fotos = await buscarFotosOffline(requestId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fotos', 'readwrite');
    const store = tx.objectStore('fotos');
    fotos.forEach(foto => store.delete(foto.id));
    tx.oncomplete = resolve; tx.onerror = e => reject(e.target.error);
  });
}
async function sincronizarFotosOffline(requestId, relatorioId, token) {
  const fotos = await buscarFotosOffline(requestId);
  for (const foto of fotos) {
    const payload = new FormData();
    payload.append('arquivos', foto.blob, foto.nome || 'evidencia.jpg');
    const res = await fetch('/api/relatorios/' + encodeURIComponent(relatorioId) + '/imagens', {
      method: 'POST', headers: {'X-Sync-Queue':'1', 'Authorization':'Bearer ' + token}, body: payload
    });
    if (!res.ok) return false;
  }
  await removerFotosOffline(requestId);
  return true;
}

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-relatorios') e.waitUntil(sincronizarFila());
});

// Mutex: impede que SYNC_NOW e o evento 'sync' rodem em paralelo e dupliquem envios
let sincronizando = false;
let authSession = null;

async function sincronizarFila() {
  if (sincronizando || !authSession) return;
  sincronizando = true;
  try {
    const fila = await buscarFila();
    let enviados = 0;
    for (const item of fila) {
      try {
        const { id, _pendente, _savedAt, ...dados } = item;
        if (dados.user_id !== authSession.userId) continue;
        if (!dados.request_id) {
          dados.request_id = crypto.randomUUID();
          const db = await abrirDB();
          await new Promise((resolve, reject) => {
            const tx = db.transaction('fila', 'readwrite');
            tx.objectStore('fila').put({ ...item, request_id: dados.request_id });
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
          });
        }
        const res = await fetch('/gerar_relatorio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sync-Queue': '1', 'Authorization': 'Bearer ' + authSession.token },
          body: JSON.stringify(dados)
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.salvo === true) {
          if (!(await sincronizarFotosOffline(dados.request_id, payload.id || dados.request_id, authSession.token))) continue;
          await removerDaFila(id);
          enviados++;
        }
      } catch (_) { /* sem rede ainda — tentará no próximo sync */ }
    }
    if (enviados > 0) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'SYNC_CONCLUIDO', enviados }));
    }
  } finally {
    sincronizando = false;
  }
}

// ── Mensagens do cliente ──────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'AUTH_SESSION') {
    authSession = { token: e.data.token, userId: e.data.userId };
  }
  if (e.data?.type === 'CLEAR_SESSION') authSession = null;
  if (e.data?.type === 'SALVAR_FOTOS_OFFLINE') {
    e.waitUntil(salvarFotosOffline(e.data.requestId, e.data.files || []).then(() => e.ports?.[0]?.postMessage({ok:true})).catch(() => e.ports?.[0]?.postMessage({ok:false})));
  }
  if (e.data?.type === 'REMOVER_FOTOS_OFFLINE') {
    e.waitUntil(removerFotosOffline(e.data.requestId).catch(() => {}));
  }
  if (e.data?.type === 'SYNC_NOW') {
    e.waitUntil(sincronizarFila());
  }
  if (e.data?.type === 'CONTAR_FILA') {
    buscarFila().then(fila => {
      e.source?.postMessage({ type: 'CONTAGEM_FILA', total: fila.length });
    });
  }
});
