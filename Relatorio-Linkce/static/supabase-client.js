/* Linkce — cliente mínimo de autenticação Supabase servido pelo próprio domínio.
   Mantém a API usada pelo painel e pela área técnica sem depender de CDN externo. */
(function (root) {
  'use strict';

  function parseJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
  }

  function createAuthClient(supabaseUrl, publicKey, options) {
    const baseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    const key = String(publicKey || '');
    const authOptions = (options && options.auth) || {};
    const storageKey = authOptions.storageKey || 'linkce-management-auth';
    const listeners = new Set();
    let session = parseJson(localStorage.getItem(storageKey), null);
    let refreshPromise = null;

    const save = value => {
      session = value || null;
      if (session) localStorage.setItem(storageKey, JSON.stringify(session));
      else localStorage.removeItem(storageKey);
    };

    const normalizeSession = value => {
      if (!value || !value.access_token) return null;
      const expiresIn = Number(value.expires_in) || 3600;
      const expiresAt = Number(value.expires_at) || Math.floor(Date.now() / 1000) + expiresIn;
      return {...value, expires_in: expiresIn, expires_at: expiresAt, token_type: value.token_type || 'bearer'};
    };

    const emit = (event, value) => {
      for (const callback of [...listeners]) {
        try { callback(event, value || null); } catch (_) {}
      }
    };

    const makeError = (response, body) => {
      const raw = body?.error_code || body?.code || body?.error || '';
      const message = body?.msg || body?.message || body?.error_description || 'Falha na autenticação.';
      const error = new Error(message);
      error.status = response?.status;
      error.code = /invalid.*(credential|grant)|credential/i.test(String(raw) + ' ' + message)
        ? 'invalid_credentials' : raw;
      return error;
    };

    async function request(path, init = {}) {
      const headers = new Headers(init.headers || {});
      headers.set('apikey', key);
      if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const response = await fetch(baseUrl + '/auth/v1/' + path, {...init, headers, credentials: 'omit', cache: 'no-store'});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw makeError(response, body);
      return body;
    }

    async function refresh() {
      if (!session?.refresh_token) return null;
      if (refreshPromise) return refreshPromise;
      refreshPromise = request('token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({refresh_token: session.refresh_token})
      }).then(value => {
        const next = normalizeSession(value);
        if (!next) throw new Error('Sessão inválida.');
        save(next); emit('TOKEN_REFRESHED', next); return next;
      }).catch(error => {
        save(null); emit('SIGNED_OUT', null); throw error;
      }).finally(() => { refreshPromise = null; });
      return refreshPromise;
    }

    async function currentSession() {
      if (!session) return null;
      const expiresAt = Number(session.expires_at || 0);
      if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 30) {
        try { return await refresh(); } catch (_) { return null; }
      }
      return session;
    }

    async function getSession() {
      try { return {data: {session: await currentSession()}, error: null}; }
      catch (error) { return {data: {session: null}, error}; }
    }

    async function getUser() {
      try {
        const value = await currentSession();
        if (!value?.access_token) {
          const error = new Error('Sessão ausente.'); error.status = 401;
          return {data: {user: null}, error};
        }
        const user = await request('user', {headers: {Authorization: 'Bearer ' + value.access_token}});
        save({...session, user});
        return {data: {user}, error: null};
      } catch (error) { return {data: {user: null}, error}; }
    }

    async function signInWithPassword(credentials) {
      try {
        const value = normalizeSession(await request('token?grant_type=password', {
          method: 'POST',
          body: JSON.stringify({email: String(credentials?.email || '').trim(), password: String(credentials?.password || '')})
        }));
        if (!value?.user) throw new Error('Sessão de login inválida.');
        save(value); emit('SIGNED_IN', value);
        return {data: {user: value.user, session: value}, error: null};
      } catch (error) { return {data: {user: null, session: null}, error}; }
    }

    async function resetPasswordForEmail(email, config = {}) {
      try {
        await request('recover', {method: 'POST', body: JSON.stringify({
          email: String(email || '').trim(), redirect_to: config.redirectTo || undefined
        })});
        return {data: {}, error: null};
      } catch (error) { return {data: {}, error}; }
    }

    async function updateUser(attributes) {
      try {
        const value = await currentSession();
        if (!value?.access_token) {
          const error = new Error('Sessão ausente.'); error.status = 401;
          return {data: {user: null}, error};
        }
        const user = await request('user', {
          method: 'PUT',
          headers: {Authorization: 'Bearer ' + value.access_token},
          body: JSON.stringify(attributes || {})
        });
        save({...session, user}); emit('USER_UPDATED', session);
        return {data: {user}, error: null};
      } catch (error) { return {data: {user: null}, error}; }
    }

    async function signOut() {
      const token = session?.access_token;
      save(null); emit('SIGNED_OUT', null);
      if (token) {
        try { await request('logout', {method: 'POST', headers: {Authorization: 'Bearer ' + token}}); } catch (_) {}
      }
      return {error: null};
    }

    const auth = {
      getSession, getUser, signInWithPassword, resetPasswordForEmail, updateUser, signOut,
      onAuthStateChange(callback) {
        if (typeof callback !== 'function') return {data: {subscription: {unsubscribe() {}}}};
        listeners.add(callback);
        if (authOptions.detectSessionInUrl !== false) {
          const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
          const accessToken = hash.get('access_token'), refreshToken = hash.get('refresh_token');
          if (accessToken && refreshToken && !session) {
            const recovered = normalizeSession({
              access_token: accessToken, refresh_token: refreshToken,
              expires_in: hash.get('expires_in'), token_type: hash.get('token_type') || 'bearer'
            });
            save(recovered);
            setTimeout(() => emit(hash.get('type') === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', recovered), 0);
          }
        }
        return {data: {subscription: {unsubscribe() {listeners.delete(callback);}}}};
      }
    };

    return {auth};
  }

  root.supabase = {createClient: createAuthClient};
})(window);
