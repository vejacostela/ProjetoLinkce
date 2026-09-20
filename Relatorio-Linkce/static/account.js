(async () => {
  const el = id => document.getElementById(id);
  const status = text => { el('status').textContent = text; };
  const recovering = location.pathname === '/nova-senha';
  const resetToken = new URLSearchParams(location.search).get('token') || '';
  const tokenMode = recovering && Boolean(resetToken);
  let client, recoveryReady = false, recoveryChecking = false;
  if (recovering) {
    el('title').textContent = 'Definir nova senha';
    el('intro').textContent = 'Validando seu link de recuperação...';
    el('again').hidden = false;
    if (tokenMode) { el('title').textContent = 'Definir nova senha'; el('intro').textContent = 'Use este link temporário para escolher sua nova senha.'; }
  }
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('config');
    const config = await response.json();
    if (!config.supabase_url || !config.supabase_key) throw new Error('config');
    client = supabase.createClient(config.supabase_url, config.supabase_key, {
      auth: { storageKey: 'linkce-management-auth', flowType: 'implicit', detectSessionInUrl: true }
    });
    // Subscribe before initialization finishes; don't await SDK calls inside the callback.
    client.auth.onAuthStateChange((event, session) => {
      if (recovering && event === 'PASSWORD_RECOVERY' && session && !recoveryChecking) {
        recoveryChecking = true;
        setTimeout(async () => {
          try {
            const { data, error } = await client.auth.getUser();
            if (error || !data.user) throw new Error('invalid_link');
            recoveryReady = true;
            history.replaceState(null, '', '/nova-senha');
            el('passwordForm').hidden = false;
            el('saveButton').disabled = false;
            el('intro').textContent = 'Escolha sua nova senha.';
            status('Link validado. Você já pode definir a nova senha.');
          } catch (_) {
            status('Link inválido ou expirado. Solicite outro link.');
          }
        }, 0);
      }
    });
    if (tokenMode) {
      const check = await fetch('/api/seguranca/redefinicao/status?token=' + encodeURIComponent(resetToken), {cache:'no-store'});
      const body = await check.json().catch(() => ({}));
      if (!check.ok) throw new Error(body.detail || 'Link inválido ou expirado.');
      recoveryReady = true;
      el('requestForm').hidden = true;
      el('passwordForm').hidden = false;
      el('saveButton').disabled = false;
      status('Link válido para ' + (body.usuario_email || 'esta conta') + '.');
      history.replaceState(null, '', '/nova-senha?token=' + encodeURIComponent(resetToken));
    } else {
      await client.auth.getSession();
      if (!recovering) {
        el('requestForm').hidden = false;
        status('');
      } else if (!recoveryChecking) {
      history.replaceState(null, '', '/nova-senha');
      status('Abra o link recebido por email. Se ele expirou ou já foi usado, solicite outro.');
      }
    }
  } catch (_) {
    status('Não foi possível iniciar a autenticação. Tente recarregar ou contate o responsável pelo sistema.');
    return;
  }

  el('requestForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = el('requestButton');
    button.disabled = true;
    status('Solicitando recuperação...');
    try {
      const { error } = await client.auth.resetPasswordForEmail(el('email').value.trim(), {
        redirectTo: location.origin + '/nova-senha'
      });
      if (error) {
        status(CampoAuth.message(error));
      } else {
        status('Se houver uma conta elegível para esse email, você receberá as instruções. Confira também o spam.');
      }
    } catch (error) {
      status(CampoAuth.message(error));
    } finally {
      button.disabled = false;
    }
  });

  el('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoveryReady) {
      status('Abra um link válido de recuperação.');
      return;
    }
    const password = el('password').value;
    if (!CampoAuth.validPassword(password, el('repeat').value)) {
      status('As senhas devem ser iguais e conter de 12 a 128 caracteres.');
      return;
    }
    const button = el('saveButton');
    button.disabled = true;
    try {
      if (tokenMode) {
        const response = await fetch('/api/seguranca/redefinicao/concluir', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:resetToken, senha:password}), cache:'no-store'});
        const body = await response.json().catch(() => ({}));
        if (!response.ok) { status(body.detail || 'Não foi possível salvar a nova senha.'); return; }
        recoveryReady = false;
        el('passwordForm').reset();
        el('passwordForm').hidden = true;
        status(body.mensagem || 'Senha alterada com sucesso.');
        return;
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        status(CampoAuth.message(error));
        return;
      }
      recoveryReady = false;
      el('passwordForm').reset();
      el('passwordForm').hidden = true;
      localStorage.removeItem('linkce_user');
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_SESSION' });
      // A failed logout must not hide a successful password update.
      try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
      status('Senha alterada. Volte ao login e entre com a nova senha.');
    } catch (error) {
      status(CampoAuth.message(error));
    } finally {
      button.disabled = !recoveryReady;
    }
  });
})();
