/* Shared user-facing errors. Never render raw provider responses or credentials. */
window.LinkceAuth = {
  message(error) {
    if (error?.code === 'email_not_confirmed') return 'Confirme seu email antes de entrar.';
    if (error?.code === 'invalid_credentials') return 'Email ou senha incorretos.';
    if (error?.status === 429 || error?.code === 'over_email_send_rate_limit')
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    if (error?.code === 'weak_password') return 'A senha não atende às regras de segurança. Escolha outra.';
    if (error?.code === 'same_password') return 'Escolha uma senha diferente da atual.';
    if (error?.status === 401) return 'Autenticação recusada. O administrador deve conferir a chave pública e o projeto Supabase; verifique também sua conta e senha.';
    if (error?.status >= 500) return 'Serviço de autenticação indisponível. Tente novamente mais tarde.';
    return 'Não foi possível concluir. Verifique sua conexão e tente novamente.';
  },
  validPassword(password, repeated) {
    return typeof password === 'string' && password.length >= 12 &&
      password.length <= 128 && password === repeated;
  }
};
