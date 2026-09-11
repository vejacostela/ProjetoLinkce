'use strict';

const noticeButton = document.createElement('button');
noticeButton.type = 'button';
noticeButton.textContent = 'Central de avisos';
document.querySelector('.management-cards').append(noticeButton);

const noticePanel = document.createElement('section');
noticePanel.id = 'noticePanel';
noticePanel.hidden = true;
noticePanel.innerHTML = `
  <div class="notice-panel-head">
    <div>
      <p class="eyebrow">GESTÃO</p>
      <h3>Central de avisos</h3>
    </div>
    <button type="button" id="noticeBack" class="back-link">← Voltar</button>
  </div>
  <p class="notice-intro">Escolha uma mensagem salva, edite o conteúdo ou crie um novo aviso personalizado.</p>
  <form id="noticeForm" class="notice-form">
    <div class="notice-field">
      <label for="noticePreset">Mensagens salvas</label>
      <select id="noticePreset">
        <option value="">Nova mensagem personalizada</option>
      </select>
    </div>
    <div class="notice-field">
      <label for="noticeTitle">Nome da mensagem</label>
      <input id="noticeTitle" type="text" maxlength="120" placeholder="Ex.: Bom dia de trabalho" required>
      <small>Use um nome curto para encontrar esta mensagem depois.</small>
    </div>
    <div class="notice-field">
      <label for="noticeText">Mensagem</label>
      <textarea id="noticeText" maxlength="3000" rows="5" placeholder="Digite o aviso que será exibido para os técnicos..." required></textarea>
    </div>
    <label class="notice-check" for="noticeLock">
      <input id="noticeLock" type="checkbox">
      <span>Bloquear a área técnica enquanto este aviso estiver publicado</span>
    </label>
    <div class="notice-actions">
      <button id="noticeSave" class="primary" type="submit">Salvar e publicar</button>
      <button type="button" id="noticeRelease">Liberar área técnica</button>
      <button type="button" id="noticeDelete" disabled>Excluir mensagem</button>
    </div>
    <p id="noticeStatus" role="status" aria-live="polite"></p>
  </form>
  <section class="notice-history" aria-labelledby="noticeHistoryTitle">
    <div class="notice-history-head"><h4 id="noticeHistoryTitle">Histórico recente</h4><button type="button" id="noticeHistoryRefresh">Atualizar</button></div>
    <div id="noticeHistoryList" class="notice-history-list"></div>
    <p id="noticeHistoryEmpty" class="muted">Nenhuma ação registrada ainda.</p>
  </section>`;

document.getElementById('managementDialog').append(noticePanel);
const n = id => document.getElementById(id);
let presets = [];

function renderPresets() {
  const select = n('noticePreset');
  select.replaceChildren(new Option('Nova mensagem personalizada', ''));
  presets.forEach(item => select.append(new Option(item.titulo, item.id)));
}

function selectPreset(item) {
  n('noticeTitle').value = item?.titulo || '';
  n('noticeText').value = item?.mensagem || '';
  n('noticeDelete').disabled = !item;
}

const historyLabels = {
  mensagem_criada: 'Mensagem criada',
  mensagem_atualizada: 'Mensagem editada',
  mensagem_excluida: 'Mensagem excluída',
  publicado: 'Aviso publicado',
  bloqueado: 'Área técnica bloqueada',
  liberado: 'Área técnica liberada'
};

function renderHistory(items) {
  const list = n('noticeHistoryList');
  const empty = n('noticeHistoryEmpty');
  list.replaceChildren();
  empty.hidden = items.length !== 0;
  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const entry = document.createElement('article');
    entry.className = 'notice-history-item';
    const title = document.createElement('strong');
    title.textContent = historyLabels[item.acao] || 'Ação realizada';
    const details = document.createElement('span');
    const when = item.criado_em ? new Date(item.criado_em).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'}) : 'Data indisponível';
    details.textContent = `${item.titulo || 'Aviso atual'} · ${item.usuario_email || 'Usuário da gestão'} · ${when}`;
    entry.append(title, details);
    fragment.append(entry);
  });
  list.append(fragment);
}

async function loadNoticeHistory() {
  try {
    const data = await api('/api/avisos/historico?limite=30');
    renderHistory(Array.isArray(data.historico) ? data.historico : []);
  } catch (_) {
    renderHistory([]);
  }
}

async function loadNoticePanel() {
  try {
    const [active, list] = await Promise.all([api('/api/avisos'), api('/api/avisos/modelos')]);
    presets = Array.isArray(list.modelos) ? list.modelos : [];
    renderPresets();
    const activePreset = presets.find(item => item.mensagem === active.mensagem);
    n('noticePreset').value = activePreset ? String(activePreset.id) : '';
    selectPreset(activePreset);
    if (!activePreset) n('noticeText').value = active.mensagem || '';
    n('noticeLock').checked = Boolean(active.bloqueado);
    n('noticeStatus').textContent = active.bloqueado ? 'Área técnica bloqueada.' : 'Área técnica liberada.';
    await loadNoticeHistory();
  } catch (error) {
    n('noticeStatus').textContent = error.message;
  }
}

noticeButton.addEventListener('click', async () => {
  showManagement();
  $('managementHome').hidden = true;
  noticePanel.hidden = false;
  await loadNoticePanel();
});

n('noticeBack').addEventListener('click', () => {
  noticePanel.hidden = true;
  showManagement();
});

n('noticePreset').addEventListener('change', () => {
  const item = presets.find(value => String(value.id) === n('noticePreset').value);
  selectPreset(item);
});

n('noticeHistoryRefresh').addEventListener('click', loadNoticeHistory);

async function publishNotice(release = false) {
  try {
    await api('/api/avisos', {
      method: 'PUT',
      body: JSON.stringify({
        mensagem: n('noticeText').value.trim(),
        bloqueado: release ? false : n('noticeLock').checked,
        acao: release ? 'liberado' : (n('noticeLock').checked ? 'bloqueado' : 'publicado')
      })
    });
    n('noticeStatus').textContent = release ? 'Área técnica liberada.' : 'Aviso publicado.';
  } catch (error) {
    n('noticeStatus').textContent = error.message;
    throw error;
  }
}

n('noticeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const title = n('noticeTitle').value.trim();
  const message = n('noticeText').value.trim();
  if (!title || !message) {
    n('noticeStatus').textContent = 'Informe o nome e o conteúdo da mensagem.';
    return;
  }
  const selectedId = n('noticePreset').value;
  const saveButton = n('noticeSave');
  saveButton.disabled = true;
  n('noticeStatus').textContent = 'Salvando mensagem...';
  try {
    await api('/api/avisos/modelos', {
      method: 'POST',
      body: JSON.stringify({ id: selectedId || null, titulo: title, mensagem: message })
    });
    await publishNotice();
    await loadNoticePanel();
  } catch (error) {
    n('noticeStatus').textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

n('noticeRelease').addEventListener('click', async () => {
  n('noticeRelease').disabled = true;
  await publishNotice(true).catch(() => {});
  n('noticeRelease').disabled = false;
  n('noticeLock').checked = false;
});

n('noticeDelete').addEventListener('click', async () => {
  const id = n('noticePreset').value;
  if (!id) return;
  const item = presets.find(value => String(value.id) === id);
  const label = item?.titulo || 'esta mensagem';
  if (!window.confirm(`Excluir "${label}"? Esta ação não pode ser desfeita.`)) return;
  n('noticeDelete').disabled = true;
  try {
    await api('/api/avisos/modelos/' + encodeURIComponent(id), { method: 'DELETE' });
    n('noticeStatus').textContent = 'Mensagem excluída.';
    await loadNoticePanel();
  } catch (error) {
    n('noticeStatus').textContent = error.message;
    n('noticeDelete').disabled = false;
  }
});
