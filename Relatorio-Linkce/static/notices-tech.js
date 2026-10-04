window.installNotices = (api, getUser) => {
  const box = document.createElement('dialog'); box.className = 'operation-notice';
  box.innerHTML = '<h2>Aviso importante</h2><p class="notice-body"></p><p class="notice-help"></p><button type="button">Entendi</button>';
  document.body.append(box);
  const form = document.getElementById('mainApp');
  let locked = false, seen = '', generation = 0, activeRequest;
  box.addEventListener('cancel', event => { if (locked) event.preventDefault(); });
  box.querySelector('button').onclick = () => box.close();
  async function check() {
    const user = getUser(), version = generation;
    if (!user) return;
    const controller = new AbortController(); activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await api('/api/avisos', {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Avisos indisponíveis');
      const notice = await response.json();
      if (getUser()?.id !== user.id || version !== generation) return;
      const wasLocked = locked;
      locked = notice.bloqueado === true; form.inert = locked;
      box.querySelector('.notice-body').textContent = notice.mensagem || '';
      box.querySelector('.notice-help').textContent = locked ? 'Aguarde a liberação do gestor ou apoio. Seu formulário está preservado.' : '';
      box.querySelector('button').hidden = locked;
      const key = user.id + ':' + notice.atualizado_em;
      if (locked || (notice.mensagem && seen !== key)) {
        if (!box.open) box.showModal();
        seen = key;
      } else if (wasLocked || !notice.mensagem) box.close();
      return true;
    } catch (_) {
      if (getUser()?.id !== user.id || version !== generation) return;
      // A falha de rede não libera um bloqueio já recebido da gestão.
      form.inert = locked;
      if (locked) box.querySelector('.notice-help').textContent = 'Aguardando conexão para verificar a liberação. Seu formulário está preservado.';
      return false;
    } finally { clearTimeout(timeout); }
  }
  const poller = CampoRefresh.create({run:check, interval:15000, enabled:()=>Boolean(getUser())});
  return {
    check() {
      if (!getUser()) return;
      form.inert = true;
      poller.start({immediate:false});
      return poller.refresh({force:true});
    },
    close() {
      generation++; activeRequest?.abort(); poller.stop();
      locked = false; form.inert = false; seen = ''; box.close();
    },
  };
};
