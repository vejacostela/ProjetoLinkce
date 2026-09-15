'use strict';
(async () => {
  const el = id => document.getElementById(id);
  let client, version;
  async function api(path, data) {
    const session = (await client.auth.getSession()).data.session;
    if (!session) throw new Error('Link inválido ou expirado. Solicite recuperação de acesso.');
    const response = await fetch(path, {method: data ? 'POST' : 'GET', cache:'no-store',
      headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
      ...(data ? {body:JSON.stringify(data)} : {})});
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível concluir esta etapa.');
    return body;
  }
  async function render() {
    const state = await api('/api/primeiro-acesso');
    if (!state.pendente) { location.replace('/'); return; }
    version = state.versao;
    el('passwordForm').hidden = state.senha_definida;
    el('privacyForm').hidden = !state.senha_definida;
    el('title').textContent = state.senha_definida ? 'Sua privacidade' : 'Defina sua senha';
    el('notice').href = state.aviso_url; el('version').textContent = 'Versão do aviso: '+version;
    el('status').textContent = '';
  }
  try {
    const response = await fetch('/api/config',{cache:'no-store'});
    if (!response.ok) throw new Error('Serviço indisponível. Tente novamente.');
    const cfg = await response.json();
    client = supabase.createClient(cfg.supabase_url,cfg.supabase_key,{auth:{storageKey:'linkce-management-auth'}});
    client.auth.onAuthStateChange(() => {});
    history.replaceState(null,'','/primeiro-acesso');
    const {data,error} = await client.auth.getUser();
    if(error || !data.user) throw new Error('Link inválido ou expirado. Solicite recuperação de acesso.');
    el('identity').textContent = data.user.email;
    await render();
  } catch(error) { el('status').textContent = error.message; }
  el('passwordForm').addEventListener('submit', async event => {
    event.preventDefault(); const button=event.submitter; button.disabled=true;
    try {
      if(el('password').value !== el('repeat').value) throw new Error('As senhas precisam ser iguais.');
      await api('/api/primeiro-acesso/senha',{senha:el('password').value});
      event.target.reset(); await render();
    } catch(error) {el('status').textContent=error.message;} finally {button.disabled=false;}
  });
  el('privacyForm').addEventListener('submit', async event => {
    event.preventDefault(); const button=event.submitter; button.disabled=true;
    try {
      await api('/api/primeiro-acesso/privacidade',{ciencia:el('ack').checked,versao:version});
      await client.auth.getUser(); location.replace('/');
    } catch(error) {el('status').textContent=error.message;} finally {button.disabled=false;}
  });
})();
