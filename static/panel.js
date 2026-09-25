'use strict';
const $ = id => document.getElementById(id);
let client, currentUser, map, markers, offset = 0, requestVersion = 0, detailVersion = 0, activeReportId = null;
let healthTimer = null;
let currentReports = [];
let activeFilters = {}, reportText = '';
let activeIncidentId = null, activeIncident = null;
const PAGE_SIZE = 50;
const AUDIT_PAGE_SIZE = 100;
let auditOffset = 0, auditRows = [];
const dateFormat = new Intl.DateTimeFormat('pt-BR', {dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo'});
const dateLabel = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Data indisponível' : dateFormat.format(d); };
const hasLocation = r => typeof r.latitude === 'number' && typeof r.longitude === 'number' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180;
function authMessage(error) {
  const messages = {invalid_credentials:'Email ou senha incorretos.',email_not_confirmed:'Confirme o email dessa conta no Supabase.',email_provider_disabled:'O login por email está desativado. Contate o gestor.',weak_password:'A senha não atende às regras de segurança.'};
  return messages[error?.code] || (error?.status === 429 ? 'Muitas tentativas. Aguarde e tente novamente.' : 'Não foi possível autenticar. Confira a conexão e a configuração do sistema.');
}
const LOGIN_MAX_ATTEMPTS = 5, LOGIN_LOCK_MS = 15 * 60 * 1000, SESSION_IDLE_MS = 30 * 60 * 1000;
let sessionIdleTimer;
function loginGuard() {
  const item = JSON.parse(localStorage.getItem('linkce-login-attempts') || '{"count":0,"until":0}');
  if (item.until && item.until > Date.now()) return Math.ceil((item.until - Date.now()) / 60000);
  if (item.until) localStorage.removeItem('linkce-login-attempts');
  return 0;
}
function recordLoginFailure() {
  const item = JSON.parse(localStorage.getItem('linkce-login-attempts') || '{"count":0,"until":0}');
  item.count = (item.count || 0) + 1;
  if (item.count >= LOGIN_MAX_ATTEMPTS) { item.until = Date.now() + LOGIN_LOCK_MS; item.count = 0; }
  localStorage.setItem('linkce-login-attempts', JSON.stringify(item));
}
function clearLoginFailures() { localStorage.removeItem('linkce-login-attempts'); }
function startSessionGuard() {
  clearTimeout(sessionIdleTimer);
  const reset = () => { clearTimeout(sessionIdleTimer); sessionIdleTimer = setTimeout(async () => { try { await client?.auth.signOut({scope:'local'}); } finally { signedOut('Sessão encerrada por inatividade. Entre novamente.'); } }, SESSION_IDLE_MS); };
  ['click','keydown','pointerdown','touchstart'].forEach(event => window.addEventListener(event, reset, {passive:true}));
  reset();
}
function defaultDates() {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part = t => parts.find(p => p.type === t).value;
  $('end').value = `${part('year')}-${part('month')}-${part('day')}`;
  $('start').value = `${part('year')}-${part('month')}-01`;
  $('technician').value = '';
}
function clearResults() {
  $('rows').replaceChildren(); markers?.clearLayers();
  if ($('centerMap')) $('centerMap').disabled = true;
  for (const id of ['total','technicians']) { const node=$(id); if(node) node.textContent = '—'; }
  $('empty').hidden = true; $('pageLabel').textContent = '';
  $('previous').disabled = true; $('next').disabled = true;
  $('mapStatus').textContent = '';
}
function applyBrand(empresa) {
  const name = String(empresa?.nome || 'Sistema de Campo').trim() || 'Sistema de Campo';
  const title = `${name} · Gestão operacional`;
  const brand = $('brandName');
  if (brand) brand.textContent = name;
  const tagline = $('brandTagline');
  if (tagline) tagline.textContent = 'Gestão operacional';
  document.title = title;
}
function signedOut(message = '') {
  currentUser = null; requestVersion++; detailVersion++;
  currentReports = [];
  clearInterval(healthTimer); healthTimer = null;
  $('workspace').hidden = true; $('login').hidden = false;
  $('logout').hidden = true; $('managementButton').hidden = true;
  $('managementDialog').close(); clearBankPreview();
  $('detail').close(); $('imagesDialog').close(); $('detailText').textContent = ''; activeReportId = null;
  $('detailMeta').replaceChildren(); $('userForm').reset(); reportText = '';
  clearResults(); if ($('operationSummary')) $('operationSummary').hidden = true; $('loginStatus').textContent = message;
}
async function api(path, options = {}) {
  const {data, error} = await client.auth.getSession();
  if (error || !data.session) { signedOut('Sua sessão expirou. Entre novamente.'); throw new Error('Sua sessão expirou.'); }
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  headers.set('Authorization',`Bearer ${data.session.access_token}`);
  const empresa = localStorage.getItem('linkce-empresa-id');
  if (empresa) headers.set('X-Empresa-ID', empresa);
  const maxAttempts = options.method && options.method !== 'GET' ? 1 : 3;
  let response, body, lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      response = await fetch(path,{...options,cache:'no-store',headers});
      body = await response.json().catch(() => null);
      if (response.ok || ![502,503,504].includes(response.status) || attempt === maxAttempts - 1) break;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw new Error('Serviço indisponível. Verifique sua conexão.');
    }
    await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
  }
  if (lastError && !response) throw lastError;
  if (response.status === 428) { location.replace('/primeiro-acesso'); throw new Error('Conclua seu primeiro acesso.'); }
  if (response.status === 401) signedOut('Sua sessão expirou. Entre novamente.');
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Não foi possível concluir a operação. Tente novamente.');
  return body;
}
function initMap() {
  if (map || !window.L) return;
  map = L.map('map').setView([-14,-52],4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
  markers = L.featureGroup().addTo(map);
}
function mapMarkerStyle(status) {
  const colors = {
    'Cabeado': {color:'#24c79a', fillColor:'#24c79a'},
    'Não Cabeado': {color:'#6eb6ff', fillColor:'#6eb6ff'},
    'Rejeitado': {color:'#ff687d', fillColor:'#ff687d'}
  };
  return {radius:8, ...(colors[status] || {color:'#ffb547', fillColor:'#ffb547'}), fillOpacity:.88, weight:2};
}
function centerMap() {
  if (!map || !markers?.getLayers().length) return;
  map.invalidateSize();
  map.fitBounds(markers.getBounds(), {padding:[35,35], maxZoom:15, animate:true});
}
function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; }
function reportComplete(report) {
  return Boolean(report.equipamento_status && report.maior_sinal && hasLocation(report) && Number(report.imagens_count) > 0);
}
function statusEnvioLabel(value) {
  const status = String(value || 'sincronizado').toLowerCase();
  return status === 'erro' ? 'Falha' : status === 'pendente' || status === 'pendente_fotos' ? 'Pendente' : status === 'processando' ? 'Processando' : 'Sincronizado';
}
function filteredReports(reports) {
  const location = $('locationFilter')?.value || '';
  const photos = $('photosFilter')?.value || '';
  return reports.filter(report => {
    const hasLocationValue = hasLocation(report);
    const hasPhotos = Number(report.imagens_count) > 0;
    return (!location || (location === 'com' ? hasLocationValue : !hasLocationValue))
      && (!photos || (photos === 'com' ? hasPhotos : !hasPhotos));
  });
}
function render(data) {
  const reports = data.relatorios;
  if (!Array.isArray(reports) || !Number.isInteger(data.total) || typeof data.has_more !== 'boolean') throw new Error('Integração pendente: atualize a API de relatórios antes de usar este painel.');
  currentReports = reports;
  const visibleReports = filteredReports(reports);
  clearResults();
  $('total').textContent = visibleReports.length + (visibleReports.length !== reports.length ? ` de ${data.total}` : '');
  $('technicians').textContent = new Set(visibleReports.map(r => r.user_id || r.tecnico)).size;
  $('empty').hidden = visibleReports.length !== 0;
  $('pageLabel').textContent = visibleReports.length ? `${offset + 1}–${offset + visibleReports.length} de ${data.total}` : '0 resultados';
  $('previous').disabled = offset === 0; $('next').disabled = !data.has_more;
  const fragment = document.createDocumentFragment();
  for (const r of visibleReports) {
    const tr = document.createElement('tr');
    cell(tr,dateLabel(r.criado_em)); cell(tr,r.tecnico); cell(tr,r.equipamento_status || 'Não informado');
    cell(tr,hasLocation(r) ? 'Disponível' : 'Não informada');
    cell(tr,Number(r.imagens_count) > 0 ? `${r.imagens_count} imagem(ns)` : 'Nenhuma');
    const status = String(r.status_envio || 'sincronizado').toLowerCase();
    const statusCell = cell(tr, status === 'erro' ? 'Falha' : status === 'pendente' || status === 'pendente_fotos' ? 'Pendente' : status === 'processando' ? 'Processando' : 'Sincronizado');
    statusCell.className = 'status-cell status-' + status.replace(/[^a-z_]/g, '');
    const completeness = cell(tr,reportComplete(r) ? 'Completo' : 'Revisar');
    completeness.className = reportComplete(r) ? 'complete-cell' : 'incomplete-cell';
    const actions = document.createElement('td');
    const button = document.createElement('button'); button.textContent = 'Abrir';
    button.setAttribute('aria-label',`Abrir relatório de ${r.tecnico}`);
    button.addEventListener('click',() => openReport(r.id)); actions.append(button);
    if (status === 'erro' || status === 'pendente' || status === 'pendente_fotos') {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'compact-action'; retry.textContent = 'Tentar de novo';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try { await api('/api/relatorios/' + encodeURIComponent(r.id) + '/reprocessar', {method:'POST'}); await loadReports(); }
        catch (error) { mostrarAlertaOperacao(error.message); retry.disabled = false; }
      });
      actions.append(document.createTextNode(' '), retry);
    }
    tr.append(actions); fragment.append(tr);
    if (map && hasLocation(r)) {
      const popup = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = r.tecnico;
      const time = document.createElement('p'); time.textContent = `${dateLabel(r.criado_em)} · ${r.equipamento_status || 'Status não informado'}`;
      const open = document.createElement('button'); open.textContent = 'Ver relatório'; open.addEventListener('click',()=>openReport(r.id));
      popup.append(name,time,open);
      L.circleMarker([r.latitude,r.longitude],mapMarkerStyle(r.equipamento_status)).bindPopup(popup).addTo(markers);
    }
  }
  $('rows').append(fragment);
  if (map) {
    map.invalidateSize();
    if (markers.getLayers().length) centerMap();
    else map.setView([-14,-52],4);
  }
  if ($('centerMap')) $('centerMap').disabled = !markers?.getLayers().length;
  $('mapStatus').textContent = !window.L ? 'Mapa indisponível. As coordenadas continuam acessíveis nos detalhes.' : reports.some(hasLocation) ? 'Selecione um ponto para abrir o relatório.' : 'Nenhuma localização informada nesta página.';
}
function mostrarAlertaOperacao(mensagem, tipo = 'error') {
  const alerta = $('operationAlert'); if (!alerta) return;
  alerta.textContent = mensagem; alerta.className = 'operation-alert' + (tipo === 'success' ? ' success' : ''); alerta.hidden = false;
}
function ocultarAlertaOperacao() { const alerta = $('operationAlert'); if (alerta) alerta.hidden = true; }
function renderResumoOperacao(data) {
  const total = Number(data?.total) || 0, fotos = Number(data?.com_fotos) || 0, local = Number(data?.com_localizacao) || 0, pendentes = Number(data?.pendentes) || 0;
  $('total').textContent = total; $('summaryPhotos').textContent = fotos; $('summaryLocated').textContent = local; $('summaryPending').textContent = pendentes;
  $('technicians').textContent = Number(data?.tecnicos) || 0;
  if ($('summaryFailed')) $('summaryFailed').textContent = Number(data?.falhas) || 0;
  if ($('summaryPendingSend')) $('summaryPendingSend').textContent = Number(data?.pendentes_envio) || 0;
  if ($('summaryCompletion')) $('summaryCompletion').textContent = (Number(data?.taxa_completude) || 0).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%';
  $('summaryPeriod').textContent = total + ' relatório' + (total === 1 ? '' : 's') + ' no período';
  const list = $('technicianSummary'); list.replaceChildren();
  const items = Array.isArray(data?.por_tecnico) ? data.por_tecnico : [];
  $('summaryEmpty').hidden = items.length !== 0;
  for (const item of items) {
    const card=document.createElement('article'); card.className='technician-card';
    const name=document.createElement('strong'); name.textContent=item.tecnico || 'Não informado';
    const count=document.createElement('span'); count.textContent=(item.total || 0) + ' relatório' + (Number(item.total) === 1 ? '' : 's') + ' · ' + (item.completos || 0) + ' completo' + (Number(item.completos) === 1 ? '' : 's');
    const pending=document.createElement('span'); pending.className='pending'; pending.textContent=(item.pendentes || 0) + ' pendente' + (Number(item.pendentes) === 1 ? '' : 's');
    const quality=document.createElement('span'); quality.textContent=(item.com_fotos || 0)+' com fotos · '+(item.com_localizacao || 0)+' localizados';
    const delivery=document.createElement('span'); delivery.className=Number(item.falhas)>0?'failure':'queue'; delivery.textContent=Number(item.falhas)>0?(item.falhas+' falha(s) de envio'):(item.na_fila || 0)+' na fila';
    const filter=document.createElement('button'); filter.type='button'; filter.className='technician-filter'; filter.textContent='Ver relatórios';
    filter.addEventListener('click',()=>{$('technician').value=item.tecnico || ''; applyFilters(); window.scrollTo({top:0,behavior:'smooth'});});
    card.append(name,count,quality,pending,delivery,filter); list.append(card);
  }
  const daily = $('dailySummary'); daily.replaceChildren();
  const dailyItems = Array.isArray(data?.por_dia) ? data.por_dia : [];
  $('dailyEmpty').hidden = dailyItems.length !== 0;
  const maxDaily = Math.max(1, ...dailyItems.map(item => Number(item.total) || 0));
  for (const item of dailyItems) {
    const row=document.createElement('div'); row.className='daily-row';
    const label=document.createElement('span'); label.textContent=item.dia || '—';
    const bar=document.createElement('i'); bar.style.width=Math.max(4, Math.round(((Number(item.total)||0)/maxDaily)*100))+'%'; bar.setAttribute('aria-label',(item.total||0)+' relatórios');
    const count=document.createElement('strong'); count.textContent=String(item.total||0);
    row.append(label,bar,count); daily.append(row);
  }
  const alerts = Array.isArray(data?.alertas) ? data.alertas : [];
  const failures = Array.isArray(data?.falhas_recentes) ? data.falhas_recentes : [];
  const alertPanel=$('operationActionAlerts'), alertList=$('operationAlertsList'), recent=$('recentFailures');
  alertList.replaceChildren(); recent.replaceChildren();
  for(const item of alerts){
    const row=document.createElement('p'); row.className='operation-action '+(item.nivel==='critico'?'critical':'warning'); row.textContent=item.mensagem; alertList.append(row);
  }
  if(failures.length){
    const title=document.createElement('h4'); title.textContent='Falhas recentes'; recent.append(title);
    for(const item of failures){
      const row=document.createElement('div'); row.className='failure-row';
      const text=document.createElement('span'); text.textContent=(item.tecnico || 'Não informado')+' · '+dateLabel(item.criado_em)+' · '+(item.erro || 'Falha de envio');
      const open=document.createElement('button'); open.type='button'; open.textContent='Abrir'; open.addEventListener('click',()=>openReport(item.id));
      row.append(text,open); recent.append(row);
    }
  }
  alertPanel.hidden = alerts.length===0 && failures.length===0;
  if(alerts.length) mostrarAlertaOperacao(alerts.map(item=>item.mensagem).join(' ')); else ocultarAlertaOperacao();
  $('operationSummary').hidden = false;
}
async function loadResumoOperacao() {
  const query = new URLSearchParams(activeFilters);
  try {
    const data = await api('/api/operacao/resumo?' + query);
    if (!currentUser) return;
    renderResumoOperacao(data);
  } catch (error) {
    mostrarAlertaOperacao('Falha ao atualizar o resumo no Supabase. Os dados da tabela podem estar desatualizados. ' + error.message);
  }
}
async function loadReports() {
  const version = ++requestVersion;
  clearResults(); $('status').textContent = 'Carregando relatórios...';
  $('apply').disabled = true; $('refresh').disabled = true;
  try {
    const query = new URLSearchParams({...activeFilters,limite:PAGE_SIZE,offset});
    const data = await api('/api/relatorios?' + query);
    if (version !== requestVersion || !currentUser) return;
    render(data); $('status').textContent = 'Atualizado às ' + dateFormat.format(new Date()) + ' · horário de Brasília'; ocultarAlertaOperacao(); loadResumoOperacao();
  } catch (error) {
    if (version === requestVersion) { clearResults(); $('status').textContent = error.message; mostrarAlertaOperacao('Falha ao carregar relatórios do Supabase. Tente atualizar novamente. ' + error.message); }
  } finally {
    if (version === requestVersion) { $('apply').disabled = false; $('refresh').disabled = false; }
  }
}
async function loadHealth() {
  const node = $('healthStatus');
  if (!node) return;
  try {
    const response = await fetch('/health', {cache:'no-store'});
    const data = await response.json().catch(() => ({}));
    const ok = response.ok && data.status === 'ok' && data.checks?.supabase;
    node.dataset.state = ok ? 'ok' : 'warn';
    node.textContent = ok
      ? 'Supabase conectado · ' + (Number(data.latencia_ms) || 0) + ' ms'
      : 'Supabase indisponível · dados podem estar desatualizados';
    node.title = ok ? 'Serviço e banco respondendo normalmente.' : 'Verifique a conexão e as variáveis do Supabase.';
  } catch (_) {
    node.dataset.state = 'warn';
    node.textContent = 'Serviço indisponível · tentando novamente';
    node.title = 'A API de saúde não respondeu.';
  }
}
function startHealthMonitor() {
  clearInterval(healthTimer);
  loadHealth();
  healthTimer = setInterval(loadHealth, 60000);
}
async function baixarArquivoAutenticado(path, nome) {
  try {
    const {data, error} = await client.auth.getSession();
    if (error || !data.session) throw new Error('Sua sessão expirou.');
    const headers = new Headers({'Authorization': 'Bearer ' + data.session.access_token});
    const empresa = localStorage.getItem('linkce-empresa-id');
    if (empresa) headers.set('X-Empresa-ID', empresa);
    const response = await fetch(path, {headers, cache:'no-store'});
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || 'Não foi possível gerar o arquivo.');
    }
    const blob = await response.blob();
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = nome; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) {
    mostrarAlertaOperacao(error.message || 'Falha ao gerar o arquivo.');
  }
}
async function loadEmpresas() {
  const select = $('companySelect');
  if (!select) return;
  try {
    const data = await api('/api/empresas');
    const empresas = Array.isArray(data.empresas) ? data.empresas : [];
    const list = $('companyList');
    if (list) {
      list.replaceChildren();
      for (const empresa of empresas) {
        const row = document.createElement('p');
        row.textContent = `${empresa.nome} · ${empresa.modo_hospedagem === 'servidor_proprio' ? 'Servidor próprio' : 'Cloud'}${empresa.bloqueada ? ' · Bloqueada' : ''}`;
        if (currentUser?.app_metadata?.platform_admin) {
          const invite = document.createElement('button'); invite.type='button'; invite.textContent='Enviar / reenviar convite';
          invite.addEventListener('click', async () => {
            const nome=prompt('Nome do administrador de '+empresa.nome); if(!nome) return;
            const email=prompt('Email do administrador de '+empresa.nome); if(!email) return;
            if(!confirm('Enviar convite de administrador para '+email+' na empresa '+empresa.nome+'?')) return;
            invite.disabled=true;
            try { const out=await api('/api/empresas/'+encodeURIComponent(empresa.id)+'/convite',{method:'POST',body:JSON.stringify({nome,email})}); $('companyStatus').textContent=out.mensagem; }
            catch(error){$('companyStatus').textContent=error.message;}
            finally{invite.disabled=false;}
          });
          row.append(' ',invite);
          const action = document.createElement('button'); action.type='button';
          action.textContent = empresa.bloqueada ? 'Liberar 7 dias' : 'Bloquear empresa';
          action.addEventListener('click', async () => {
            if (!confirm(`${action.textContent}: ${empresa.nome}?`)) return;
            try { const out=await api('/api/empresas/'+encodeURIComponent(empresa.id)+'/acesso',{method:'POST',body:JSON.stringify({acao:empresa.bloqueada?'liberar_7_dias':'bloquear'})}); $('companyStatus').textContent=out.mensagem; await loadEmpresas(); }
            catch(error){ $('companyStatus').textContent=error.message; }
          });
          row.append(' ', action);
          if (empresa.bloqueada) {
            const unlock = document.createElement('button'); unlock.type='button'; unlock.textContent='Desbloquear';
            unlock.addEventListener('click', async () => {
              if (!confirm('Desbloquear definitivamente '+empresa.nome+'?')) return;
              try { const out=await api('/api/empresas/'+encodeURIComponent(empresa.id)+'/acesso',{method:'POST',body:JSON.stringify({acao:'desbloquear'})}); $('companyStatus').textContent=out.mensagem; await loadEmpresas(); }
              catch(error){ $('companyStatus').textContent=error.message; }
            });
            row.append(' ', unlock);
          }
        }
        list.append(row);
      }
    }
    select.replaceChildren();
    for (const empresa of empresas) {
      const option = document.createElement('option');
      option.value = empresa.id; option.textContent = empresa.nome || empresa.slug || empresa.id;
      select.append(option);
    }
    if (!empresas.length) { select.hidden = true; return; }
    const saved = localStorage.getItem('linkce-empresa-id');
    const active = empresas.find(item => item.id === saved) || empresas[0];
    select.value = active.id;
    if (saved !== active.id) localStorage.setItem('linkce-empresa-id', active.id);
    applyBrand(active);
    // Uma conta de cliente com uma só empresa entra diretamente no seu ambiente.
    select.hidden = empresas.length <= 1;
    if (select.dataset.ready !== '1') {
      select.dataset.ready = '1';
      select.addEventListener('change', () => {
        localStorage.setItem('linkce-empresa-id', select.value);
        location.reload();
      });
    }
  } catch (error) {
    select.hidden = true;
    mostrarAlertaOperacao('Não foi possível carregar as empresas: ' + error.message);
  }
}
if ($('downloadInstaller')) $('downloadInstaller').addEventListener('click', () => baixarArquivoAutenticado('/api/empresas/pacote-instalacao', 'sistema-instalacao.zip'));
async function abrirSaudeDetalhada() {
  const dialog = $('healthDialog');
  if (!dialog) return;
  const body = $('healthDetailsBody'); const status = $('healthDetailsStatus');
  body.textContent = 'Consultando...'; status.textContent = '';
  if (!dialog.open) dialog.showModal();
  try {
    const data = await api('/api/saude');
    body.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    status.textContent = error.message;
    body.textContent = 'Não foi possível consultar a saúde do sistema.';
  }
}
function auditParams({offsetValue = auditOffset, limit = AUDIT_PAGE_SIZE} = {}) {
  const params = new URLSearchParams({limite:String(limit), offset:String(offsetValue)});
  const fields = [
    ['auditStart','inicio'], ['auditEnd','fim'], ['auditUser','usuario_email'],
    ['auditCategory','categoria'], ['auditAction','acao'], ['auditEntity','entidade_tipo'],
    ['auditResult','resultado'], ['auditRoute','rota'], ['auditRequestId','request_id']
  ];
  for (const [id, key] of fields) {
    const value = $(id)?.value?.trim();
    if (value) params.set(key, value);
  }
  return params;
}
function auditEntityLabel(item) {
  if (item.entidade_tipo && item.entidade_id) return `${item.entidade_tipo} · ${item.entidade_id}`;
  return item.entidade_tipo || item.entidade_id || '—';
}
async function loadAudit() {
  const body = $('auditHistory');
  if (!body) return;
  if ($('auditStart').value && $('auditEnd').value && $('auditStart').value > $('auditEnd').value) {
    $('auditStatus').textContent = 'A data inicial deve ser anterior ou igual à final.';
    return;
  }
  $('auditStatus').textContent = 'Consultando auditoria...';
  try {
    const data = await api('/api/seguranca/auditoria?' + auditParams());
    const rows = Array.isArray(data.auditoria) ? data.auditoria : [];
    auditRows = rows;
    const fragment = document.createDocumentFragment();
    for (const item of rows) {
      const tr = document.createElement('tr');
      for (const value of [dateLabel(item.criado_em), item.usuario_email, item.categoria || 'gestao', item.acao, auditEntityLabel(item), item.resultado, item.status_code, item.request_id]) cell(tr, value || '—');
      tr.dataset.result = item.resultado || '';
      fragment.append(tr);
    }
    body.replaceChildren(fragment);
    if ($('auditHistoryEmpty')) $('auditHistoryEmpty').hidden = rows.length !== 0;
    $('auditPrevious').disabled = auditOffset === 0;
    $('auditNext').disabled = rows.length < AUDIT_PAGE_SIZE;
    const first = rows.length ? auditOffset + 1 : 0;
    $('auditPageLabel').textContent = `${first}–${auditOffset + rows.length}`;
    $('auditStatus').textContent = rows.length ? `${rows.length} evento(s) carregado(s).` : 'Nenhum evento corresponde aos filtros.';
  } catch (error) {
    auditRows = [];
    body.replaceChildren();
    if ($('auditHistoryEmpty')) { $('auditHistoryEmpty').hidden = false; $('auditHistoryEmpty').textContent = 'Não foi possível carregar a auditoria.'; }
    $('auditStatus').textContent = error.message;
  }
}
async function exportAudit() {
  const button = $('auditExport'); button.disabled = true; $('auditStatus').textContent = 'Preparando arquivo...';
  try {
    const data = await api('/api/seguranca/auditoria?' + auditParams({offsetValue:0, limit:500}));
    const rows = Array.isArray(data.auditoria) ? data.auditoria : auditRows;
    if (!rows.length) throw new Error('Nenhum evento disponível para exportar.');
    const columns = ['Data','Responsável','Categoria','Ação','Entidade','ID da entidade','Rota','Resultado','HTTP','ID da requisição'];
    const lines = [columns.map(csvValue).join(';'), ...rows.map(item => [item.criado_em,item.usuario_email,item.categoria || 'gestao',item.acao,item.entidade_tipo,item.entidade_id,item.rota,item.resultado,item.status_code,item.request_id].map(csvValue).join(';'))];
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `auditoria-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
    $('auditStatus').textContent = `${rows.length} evento(s) exportado(s).`;
  } catch (error) { $('auditStatus').textContent = error.message; }
  finally { button.disabled = false; }
}
function lgpdSet(id, value) { const node=$(id); if(node) node.value=value ?? ''; }
function lgpdActionCell(row, select, button) { const td=document.createElement('td'); const box=document.createElement('div'); box.className='lgpd-row-action'; box.append(select,button); td.append(box); row.append(td); }
async function loadLgpd() {
  $('lgpdStatus').textContent='Carregando central LGPD...';
  try {
    const data=await api('/api/lgpd'); const config=data.configuracao || {};
    const mapping={lgpdController:'controlador_nome',lgpdOperator:'operador_nome',lgpdOfficer:'encarregado_nome',lgpdOfficerEmail:'encarregado_email',lgpdChannel:'canal_titular',lgpdRetention:'retencao_dias',lgpdPolicyUrl:'politica_url',lgpdPolicyVersion:'politica_versao',lgpdTermsUrl:'termos_url',lgpdTermsVersion:'termos_versao',lgpdPurposes:'finalidades'};
    for(const [id,key] of Object.entries(mapping)) lgpdSet(id,config[key]);
    const requests=Array.isArray(data.solicitacoes)?data.solicitacoes:[], incidents=Array.isArray(data.incidentes)?data.incidentes:[], acceptances=Array.isArray(data.aceites)?data.aceites:[];
    const openRequests=requests.filter(item=>!['concluida','negada','cancelada'].includes(item.status)).length;
    const openIncidents=incidents.filter(item=>item.status!=='encerrado').length;
    $('lgpdMetrics').replaceChildren();
    for(const [label,value] of [['Solicitações abertas',openRequests],['Incidentes abertos',openIncidents],['Aceites registrados',acceptances.length],['Retenção',`${config.retencao_dias || 365} dias`]]) { const card=document.createElement('article'); const span=document.createElement('span'); span.textContent=label; const strong=document.createElement('strong'); strong.textContent=value; card.append(span,strong); $('lgpdMetrics').append(card); }
    const canManage=currentUser?.app_metadata?.role==='gestor';
    $('lgpdConfigForm').querySelectorAll('input,textarea,button').forEach(node=>node.disabled=!canManage);
    const requestBody=$('lgpdRequests'); requestBody.replaceChildren();
    for(const item of requests){ const tr=document.createElement('tr'); for(const value of [item.protocolo,item.tipo,item.titular_nome,dateLabel(item.prazo_em),item.status]) cell(tr,value||'—'); const select=document.createElement('select'); for(const status of ['aberta','em_analise','aguardando_titular','concluida','negada','cancelada']) select.add(new Option(status.replaceAll('_',' '),status)); select.value=item.status; select.disabled=!canManage; const button=document.createElement('button'); button.type='button'; button.textContent='Atualizar'; button.disabled=!canManage; button.addEventListener('click',async()=>{ const resposta=window.prompt('Resposta ou justificativa registrada para o titular:',item.resposta||''); if(resposta===null)return; button.disabled=true; try{await api('/api/lgpd/solicitacoes/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({status:select.value,resposta})});await loadLgpd();}catch(error){$('lgpdStatus').textContent=error.message;}finally{button.disabled=false;} }); lgpdActionCell(tr,select,button); requestBody.append(tr); }
    const incidentBody=$('lgpdIncidents'); incidentBody.replaceChildren();
    for(const item of incidents){ const tr=document.createElement('tr'); for(const value of [item.codigo,item.titulo,item.severidade,item.status,(item.comunicar_anpd?'ANPD ':'')+(item.comunicar_titulares?'Titulares':'')||'Não definida']) cell(tr,value||'—'); const select=document.createElement('select'); for(const status of ['aberto','investigando','contido','encerrado']) select.add(new Option(status,status)); select.value=item.status; select.disabled=!canManage; const button=document.createElement('button'); button.type='button'; button.textContent='Atualizar'; button.disabled=!canManage; button.addEventListener('click',async()=>{const medidas=window.prompt('Medidas adotadas:',item.medidas||'');if(medidas===null)return;button.disabled=true;try{await api('/api/lgpd/incidentes/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({status:select.value,medidas,comunicar_anpd:item.comunicar_anpd,comunicar_titulares:item.comunicar_titulares})});await loadLgpd();}catch(error){$('lgpdStatus').textContent=error.message;}finally{button.disabled=false;}}); lgpdActionCell(tr,select,button); incidentBody.append(tr); }
    const acceptanceBody=$('lgpdAcceptances'); acceptanceBody.replaceChildren(); for(const item of acceptances){const tr=document.createElement('tr');for(const value of [dateLabel(item.aceito_em),item.usuario_email,item.politica_versao,item.termos_versao,item.finalidade])cell(tr,value||'—');acceptanceBody.append(tr);}
    $('lgpdStatus').textContent='Central LGPD atualizada.';
  } catch(error) { $('lgpdStatus').textContent=error.message; }
}
function renderIncidentSignals(signals={}) {
  const root=$('incidentSignals'); root.replaceChildren();
  for(const [label,value] of [['Nível',signals.nivel||'—'],['Acessos negados (1h)',signals.negadas_ultima_hora||0],['Erros (1h)',signals.erros_ultima_hora||0],['Sessões ativas',signals.sessoes_ativas||0]]) { const card=document.createElement('article'); const span=document.createElement('span'); span.textContent=label; const strong=document.createElement('strong'); strong.textContent=value; card.append(span,strong); root.append(card); }
  root.dataset.level=signals.nivel||'normal';
}
async function loadIncidents() {
  $('incidentStatus').textContent='Consultando sinais e incidentes...';
  try {
    const data=await api('/api/incidentes'); renderIncidentSignals(data.sinais);
    const body=$('incidentRows'); body.replaceChildren();
    for(const item of (data.incidentes||[])){const tr=document.createElement('tr');for(const value of [item.codigo,item.titulo,item.severidade,item.status,item.avaliacao_risco,dateLabel(item.detectado_em)])cell(tr,value||'—');const td=document.createElement('td');const button=document.createElement('button');button.type='button';button.textContent='Responder';button.addEventListener('click',()=>openIncident(item.id));td.append(button);tr.append(td);body.append(tr);}
    $('incidentStatus').textContent=(data.incidentes||[]).length+' incidente(s) registrado(s).';
  } catch(error){$('incidentStatus').textContent=error.message;}
}
function renderIncidentChecklist(item) {
  const checks=[['Logs preservados',item.logs_preservados],['Sessões revogadas',item.sessoes_revogadas_em],['Causa identificada',item.causa_raiz],['Correção registrada',item.correcao],['Risco avaliado',item.avaliacao_risco&&item.avaliacao_risco!=='nao_avaliado'],['Chaves rotacionadas',item.chaves_rotacionadas_em]];
  const root=$('incidentChecklist');root.replaceChildren();for(const [label,done] of checks){const tag=document.createElement('span');tag.className=done?'done':'pending';tag.textContent=(done?'✓ ':'○ ')+label;root.append(tag);}
}
async function openIncident(id) {
  activeIncidentId=id; $('incidentStatus').textContent='Carregando incidente...';
  try {const data=await api('/api/incidentes/'+encodeURIComponent(id));if(activeIncidentId!==id)return;activeIncident=data.incidente;$('incidentDetail').hidden=false;$('incidentDetailTitle').textContent=(activeIncident.codigo||'Incidente')+' · '+(activeIncident.titulo||'');renderIncidentChecklist(activeIncident);lgpdSet('incidentContainment',activeIncident.medidas);lgpdSet('incidentRootCause',activeIncident.causa_raiz);lgpdSet('incidentCorrection',activeIncident.correcao);lgpdSet('incidentRisk',activeIncident.avaliacao_risco==='risco_relevante'?'risco_relevante':'sem_risco_relevante');$('incidentNotifyOwners').checked=Boolean(activeIncident.comunicado_responsaveis);$('incidentNotifyAnpd').checked=Boolean(activeIncident.comunicar_anpd);$('incidentNotifyHolders').checked=Boolean(activeIncident.comunicar_titulares);const timeline=$('incidentTimeline');timeline.replaceChildren();for(const event of (data.eventos||[])){const card=document.createElement('article');const title=document.createElement('strong');title.textContent=event.tipo.replaceAll('_',' ')+' · '+dateLabel(event.criado_em);const text=document.createElement('p');text.textContent=event.descricao;const author=document.createElement('span');author.textContent=event.usuario_email||'Sistema';card.append(title,text,author);timeline.append(card);}const canManage=currentUser?.app_metadata?.role==='gestor';$('incidentDetail').querySelectorAll('form input,form textarea,form select,form button,#preserveIncidentLogs,#revokeIncidentUser,#revokeIncidentCompany,#confirmKeyRotation,#finishIncident').forEach(node=>node.disabled=!canManage);$('blockIncidentCompany').hidden=!currentUser?.app_metadata?.platform_admin;$('incidentStatus').textContent='';}catch(error){$('incidentStatus').textContent=error.message;}
}
async function incidentAction(acao,payload={}) {if(!activeIncidentId)return;try{const data=await api('/api/incidentes/'+encodeURIComponent(activeIncidentId)+'/acao',{method:'POST',body:JSON.stringify({acao,...payload})});$('incidentStatus').textContent=data.mensagem||'Ação registrada.';await openIncident(activeIncidentId);await loadIncidents();}catch(error){$('incidentStatus').textContent=error.message;}}
async function enter(user) {
  await loadEmpresas();
  const permissions = await api('/api/permissoes');
  const role = permissions.role;
  if (role === 'tecnico') { window.location.assign('/tecnico'); return; }
  if (!['gestor','apoio'].includes(role)) { signedOut('Seu perfil é técnico. Acesse a Área do técnico no topo da página.'); return; }
  currentUser = {...user, app_metadata:{...user.app_metadata, role, platform_admin: Boolean(permissions.admin_plataforma)}}; startSessionGuard(); startHealthMonitor(); $('login').hidden = true; $('workspace').hidden = false;
  $('logout').hidden = false; $('managementButton').hidden = false;
  document.querySelectorAll('[data-management-target]').forEach(b => {
    const target = b.dataset.managementTarget;
    b.hidden = ['audit','lgpd','incidents'].includes(target)
      ? !['gestor','apoio'].includes(role)
      : role !== 'gestor' || (target === 'companies' && !permissions.gerenciar_empresas);
  });
  $('identity').textContent = `${user.user_metadata?.nome || user.email} · ${role === 'gestor' ? 'Gestor' : 'Apoio'}`;
  $('apply').disabled = false; $('refresh').disabled = false;
  initMap(); defaultDates(); applyFilters();
}
function applyFilters() {
  if ($('start').value > $('end').value) { $('status').textContent = 'A data inicial deve ser anterior ou igual à final.'; return; }
  activeFilters = {inicio:$('start').value,fim:$('end').value};
  if ($('technician').value.trim()) activeFilters.tecnico = $('technician').value.trim();
  offset = 0; loadReports();
}
async function openReport(id) {
  const version = ++detailVersion;
  activeReportId = id;
  reportText = ''; $('detailText').textContent = ''; $('detailMeta').replaceChildren();
  $('copy').disabled = true; $('images').disabled = true; $('mapLink').hidden = true;
  $('detailStatus').textContent = 'Carregando...'; if (!$('detail').open) $('detail').showModal();
  try {
    const r = await api('/api/relatorios/' + encodeURIComponent(id));
    if (version !== detailVersion || !currentUser || !$('detail').open) return;
    for (const [name,value] of [['Técnico',r.tecnico],['Data',dateLabel(r.criado_em)],['Cabeamento',r.equipamento_status],['RSSI',r.maior_sinal],['Observações das fotos',r.obs_fotos || 'Nenhuma'],['Localização',hasLocation(r) ? `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}` : 'Não informada']]) {
      const dt=document.createElement('dt'), dd=document.createElement('dd'); dt.textContent=name; dd.textContent=value || 'Não informado'; $('detailMeta').append(dt,dd);
    }
    reportText = r.relatorio_completo || '';
    $('detailText').textContent = reportText || 'Texto completo não disponível neste registro.';
    $('copy').disabled = !reportText;
    $('images').disabled = false;
    if (hasLocation(r)) { $('mapLink').href = `https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=17/${r.latitude}/${r.longitude}`; $('mapLink').hidden = false; }
    $('detailStatus').textContent = '';
  } catch(error) { if(version === detailVersion) $('detailStatus').textContent = error.message; }
}
async function openImages() {
  if (!activeReportId) return;
  const reportId = activeReportId; $('imagesGallery').replaceChildren(); $('imagesEmpty').hidden = true; $('imagesStatus').textContent = 'Carregando imagens...'; $('imagesInput').value = '';
  if (!$('imagesDialog').open) $('imagesDialog').showModal();
  try {
    const data = await api('/api/relatorios/' + encodeURIComponent(reportId) + '/imagens');
    if(reportId !== activeReportId || !Array.isArray(data.imagens)) return;
    const fragment = document.createDocumentFragment();
    for(const image of data.imagens) {
      const card=document.createElement('article'); card.className='report-image';
      const link=document.createElement('a'); link.href=image.url; link.target='_blank'; link.rel='noopener noreferrer'; link.download=image.nome || 'evidencia';
      const photo=document.createElement('img'); photo.src=image.url; photo.alt=image.nome || 'Evidência do relatório'; photo.loading='lazy';
      link.append(photo); card.append(link);
      const footer=document.createElement('div'); footer.className='report-image-footer';
      const label=document.createElement('span'); label.textContent=image.nome || 'Imagem';
      const actions=document.createElement('div'); actions.className='report-image-actions';
      const replaceInput=document.createElement('input'); replaceInput.type='file'; replaceInput.accept='image/jpeg,image/png,image/webp,image/avif'; replaceInput.hidden=true;
      const replace=document.createElement('button'); replace.type='button'; replace.textContent='Substituir'; replace.addEventListener('click',()=>replaceInput.click());
      replaceInput.addEventListener('change',async()=>{ const file=replaceInput.files?.[0]; if(!file)return; const reportId=activeReportId; replace.disabled=true; $('imagesStatus').textContent='Comprimindo e substituindo imagem...'; try { const compressed=await compressImage(file); const form=new FormData(); form.append('arquivo',compressed,compressed.name); await api('/api/relatorios/'+encodeURIComponent(reportId)+'/imagens/'+encodeURIComponent(image.id),{method:'PUT',body:form}); $('imagesStatus').textContent='Imagem substituída com sucesso.'; await openImages(); } catch(error){$('imagesStatus').textContent=error.message;} finally{replace.disabled=false;replaceInput.value='';} });
      const remove=document.createElement('button'); remove.type='button'; remove.textContent='Excluir'; remove.addEventListener('click',async()=>{if(!confirm('Excluir esta imagem?'))return; const reportId=activeReportId; remove.disabled=true; try { await api('/api/relatorios/'+encodeURIComponent(reportId)+'/imagens/'+encodeURIComponent(image.id),{method:'DELETE'}); $('imagesStatus').textContent='Imagem excluída com sucesso.'; await openImages(); } catch(error){$('imagesStatus').textContent=error.message;remove.disabled=false;}});
      actions.append(replace,remove,replaceInput); footer.append(label,actions); card.append(footer); fragment.append(card);
    }
    $('imagesGallery').append(fragment); $('imagesEmpty').hidden = data.imagens.length !== 0; $('imagesStatus').textContent = data.imagens.length ? 'Clique em uma imagem para salvar.' : '';
  } catch(error) { if(reportId === activeReportId) $('imagesStatus').textContent = error.message; }
}
$('filters').addEventListener('submit',e=>{e.preventDefault();applyFilters();});
$('locationFilter').addEventListener('change',()=>{if(currentReports.length) render({relatorios:currentReports,total:currentReports.length,has_more:false});});
$('photosFilter').addEventListener('change',()=>{if(currentReports.length) render({relatorios:currentReports,total:currentReports.length,has_more:false});});

const SAVED_FILTER_KEY = 'linkce-dashboard-filter';
function filtroAtual() {
  return {inicio:$('start').value, fim:$('end').value, tecnico:$('technician').value.trim()};
}
$('saveFilters').addEventListener('click',()=>{
  localStorage.setItem(SAVED_FILTER_KEY, JSON.stringify(filtroAtual()));
  $('status').textContent='Filtro salvo neste navegador.';
});
$('restoreFilters').addEventListener('click',()=>{
  try {
    const saved=JSON.parse(localStorage.getItem(SAVED_FILTER_KEY)||'null');
    if(!saved) { $('status').textContent='Nenhum filtro salvo neste navegador.'; return; }
    $('start').value=saved.inicio||$('start').value; $('end').value=saved.fim||$('end').value; $('technician').value=saved.tecnico||'';
    applyFilters();
  } catch (_) { $('status').textContent='Não foi possível restaurar o filtro salvo.'; }
});

$('reset').addEventListener('click',()=>{defaultDates();applyFilters();});
$('refresh').addEventListener('click',loadReports);
$('centerMap')?.addEventListener('click', centerMap);
function csvValue(value) { return `"${String(value ?? '').replaceAll('"','""')}"`; }
function exportReports() {
  const reports = filteredReports(currentReports);
  if (!reports.length) { $('status').textContent = 'Nenhum relatório disponível para exportar.'; return; }
  const lines = [
    ['Data e hora','Técnico','Cabeamento','Localização','Fotos','Status','Completude'].map(csvValue).join(';'),
    ...reports.map(r => [dateLabel(r.criado_em),r.tecnico,r.equipamento_status || 'Não informado',hasLocation(r) ? `${r.latitude}, ${r.longitude}` : 'Não informada',Number(r.imagens_count) || 0,statusEnvioLabel(r.status_envio),reportComplete(r) ? 'Completo' : 'Revisar'].map(csvValue).join(';'))
  ];
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `relatorios-campo-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
$('exportCsv').addEventListener('click', exportReports);
$('exportFullCsv')?.addEventListener('click', () => baixarArquivoAutenticado('/api/backup?formato=csv', 'relatorios-campo.csv'));
$('downloadBackup')?.addEventListener('click', () => baixarArquivoAutenticado('/api/backup?formato=zip&incluir_imagens=true', 'backup-campo.zip'));
$('healthDetails')?.addEventListener('click', abrirSaudeDetalhada);
$('auditFilters')?.addEventListener('submit', event => { event.preventDefault(); auditOffset = 0; loadAudit(); });
$('auditClear')?.addEventListener('click', () => { $('auditFilters').reset(); auditOffset = 0; loadAudit(); });
$('auditPrevious')?.addEventListener('click', () => { auditOffset = Math.max(0, auditOffset - AUDIT_PAGE_SIZE); loadAudit(); });
$('auditNext')?.addEventListener('click', () => { auditOffset += AUDIT_PAGE_SIZE; loadAudit(); });
$('auditExport')?.addEventListener('click', exportAudit);
$('lgpdConfigForm')?.addEventListener('submit',async event=>{event.preventDefault();const button=$('saveLgpdConfig');button.disabled=true;$('lgpdStatus').textContent='Salvando governança...';try{const payload={controlador_nome:$('lgpdController').value.trim(),operador_nome:$('lgpdOperator').value.trim(),encarregado_nome:$('lgpdOfficer').value.trim(),encarregado_email:$('lgpdOfficerEmail').value.trim(),canal_titular:$('lgpdChannel').value.trim(),retencao_dias:Number($('lgpdRetention').value),politica_url:$('lgpdPolicyUrl').value.trim(),politica_versao:$('lgpdPolicyVersion').value.trim(),termos_url:$('lgpdTermsUrl').value.trim(),termos_versao:$('lgpdTermsVersion').value.trim(),finalidades:$('lgpdPurposes').value.trim()};await api('/api/lgpd/configuracao',{method:'PUT',body:JSON.stringify(payload)});await loadLgpd();}catch(error){$('lgpdStatus').textContent=error.message;}finally{button.disabled=false;}});
$('lgpdRequestForm')?.addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/lgpd/solicitacoes',{method:'POST',body:JSON.stringify({tipo:$('lgpdRequestType').value,titular_nome:$('lgpdHolderName').value.trim(),titular_email:$('lgpdHolderEmail').value.trim(),descricao:$('lgpdRequestDescription').value.trim()})});event.target.reset();await loadLgpd();}catch(error){$('lgpdStatus').textContent=error.message;}finally{button.disabled=false;}});
$('lgpdIncidentForm')?.addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/lgpd/incidentes',{method:'POST',body:JSON.stringify({titulo:$('lgpdIncidentTitle').value.trim(),severidade:$('lgpdIncidentSeverity').value,resumo:$('lgpdIncidentSummary').value.trim(),dados_afetados:$('lgpdAffectedData').value.trim(),medidas:$('lgpdMeasures').value.trim()})});event.target.reset();await loadLgpd();}catch(error){$('lgpdStatus').textContent=error.message;}finally{button.disabled=false;}});
$('exportLgpdData')?.addEventListener('click',()=>baixarArquivoAutenticado('/api/backup?formato=json','exportacao-lgpd.json'));
$('detectIncidents')?.addEventListener('click',async()=>{const button=$('detectIncidents');button.disabled=true;$('incidentStatus').textContent='Analisando eventos da última hora...';try{const data=await api('/api/incidentes/detectar',{method:'POST',body:'{}'});renderIncidentSignals(data.sinais);$('incidentStatus').textContent=data.mensagem;}catch(error){$('incidentStatus').textContent=error.message;}finally{button.disabled=false;}});
$('incidentForm')?.addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const data=await api('/api/incidentes',{method:'POST',body:JSON.stringify({titulo:$('incidentTitle').value.trim(),severidade:$('incidentSeverity').value,resumo:$('incidentSummary').value.trim(),dados_afetados:$('incidentAffected').value.trim(),origem_deteccao:$('incidentSource').value.trim(),responsavel_email:$('incidentOwner').value.trim()})});event.target.reset();await loadIncidents();await openIncident(data.incidente.id);}catch(error){$('incidentStatus').textContent=error.message;}finally{button.disabled=false;}});
$('closeIncidentDetail')?.addEventListener('click',()=>{activeIncidentId=null;activeIncident=null;$('incidentDetail').hidden=true;});
$('preserveIncidentLogs')?.addEventListener('click',()=>incidentAction('preservar_logs'));
$('revokeIncidentUser')?.addEventListener('click',()=>{const email=$('incidentUserEmail').value.trim();if(!email){$('incidentStatus').textContent='Informe o email do usuário afetado.';return;}if(confirm('Revogar todas as sessões deste usuário?'))incidentAction('revogar_usuario',{email});});
$('revokeIncidentCompany')?.addEventListener('click',()=>{if(confirm('Isto encerrará todas as sessões da empresa, inclusive a sua. Continuar?'))incidentAction('revogar_empresa',{confirmacao:'REVOGAR SESSOES'});});
$('blockIncidentCompany')?.addEventListener('click',()=>{if(confirm('Bloquear preventivamente o acesso de toda a empresa?'))incidentAction('bloquear_empresa',{confirmacao:'BLOQUEAR EMPRESA'});});
$('confirmKeyRotation')?.addEventListener('click',()=>{if(confirm('Confirme somente depois de substituir as chaves no Supabase/Vercel ou no servidor próprio.'))incidentAction('confirmar_rotacao_chaves',{confirmacao:'CHAVES ROTACIONADAS'});});
$('incidentContainmentForm')?.addEventListener('submit',event=>{event.preventDefault();incidentAction('contencao',{descricao:$('incidentContainment').value.trim()});});
$('incidentCorrectionForm')?.addEventListener('submit',event=>{event.preventDefault();incidentAction('correcao',{causa_raiz:$('incidentRootCause').value.trim(),correcao:$('incidentCorrection').value.trim()});});
$('incidentCommunicationForm')?.addEventListener('submit',event=>{event.preventDefault();incidentAction('comunicacao',{avaliacao_risco:$('incidentRisk').value,comunicar_responsaveis:$('incidentNotifyOwners').checked,comunicar_anpd:$('incidentNotifyAnpd').checked,comunicar_titulares:$('incidentNotifyHolders').checked});});
$('finishIncident')?.addEventListener('click',()=>{if(confirm('Encerrar este incidente após verificar todas as etapas obrigatórias?'))incidentAction('encerrar');});
$('companyForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser?.app_metadata?.platform_admin) return;
  const button = $('saveCompany'); button.disabled = true; $('companyStatus').textContent = 'Criando empresa...';
  try {
    const data = await api('/api/empresas', {method:'POST', body:JSON.stringify({nome:$('companyName').value.trim(), slug:$('companySlug').value.trim(), modo_hospedagem:$('companyHosting').value, dominio:$('companyDomain').value.trim(), admin_nome:$('companyAdminName').value.trim(), admin_email:$('companyAdminEmail').value.trim()})});
    $('companyStatus').textContent = data.convite_enviado ? 'Empresa criada. Convite encaminhado ao serviço de email; o cliente definirá a senha no primeiro acesso.' : data.aviso;
    event.target.reset(); await loadEmpresas();
  } catch(error) { $('companyStatus').textContent = error.message; }
  finally { button.disabled = false; }
});
$('printReports').addEventListener('click',()=>window.print());
$('previous').addEventListener('click',()=>{offset=Math.max(0,offset-PAGE_SIZE);loadReports();});
$('next').addEventListener('click',()=>{offset+=PAGE_SIZE;loadReports();});
$('logout').addEventListener('click',async()=>{signedOut();try{await client.auth.signOut({scope:'local'});}catch(_){$('loginStatus').textContent='Sessão local encerrada.';}});
const SERVER_CONTROL_FIELDS = ['firewall_ativo','https_valido','banco_nao_exposto','administracao_restrita','usuario_sem_admin','atualizacoes_controladas','monitoramento_ativo','backup_local','backup_externo','restauracao_testada'];
const serverBytes = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('pt-BR',{style:'unit',unit:'megabyte',maximumFractionDigits:1}).format(Number(value)/1048576) : '—';
function serverPill(label, ok, detail='') {
  const item=document.createElement('article'); item.className='server-pill'; item.dataset.state=ok===true?'ok':ok===false?'warn':'unknown';
  const title=document.createElement('strong'); title.textContent=label; const text=document.createElement('span'); text.textContent=detail || (ok===true?'Conforme':ok===false?'Requer atenção':'Não verificado');
  item.append(title,text); return item;
}
async function loadServerSecurity() {
  const form=$('serverSecurityForm'), rows=$('serverBackupRows'), summary=$('serverSummary'), hostBox=$('serverHostChecks');
  if(!form || !rows || !summary || !hostBox) return;
  $('serverStatus').textContent='Consultando controles...'; rows.replaceChildren(); summary.replaceChildren(); hostBox.replaceChildren();
  try {
    const data=await api('/api/servidor/seguranca'), controls=data.controles||{}, resources=data.recursos||{}, host=data.host||{};
    summary.append(serverPill('Conformidade',data.conformidade?.percentual===100,`${data.conformidade?.concluidos||0} de ${data.conformidade?.total||10} controles`));
    summary.append(serverPill('Disco',Number(resources.disco_percentual)<85,`${resources.disco_percentual??'—'}% · ${serverBytes(resources.disco_usado_bytes)} usados`));
    summary.append(serverPill('Memória',Number(resources.memoria_percentual)<90,`${resources.memoria_percentual??'—'}% · ${serverBytes(resources.memoria_usada_bytes)} usados`));
    summary.append(serverPill('Modo',data.modo==='servidor_proprio',data.modo==='servidor_proprio'?'Servidor próprio':'Cloud — controles do host não se aplicam a esta implantação'));
    hostBox.append(serverPill('Diagnóstico do host',host.disponivel&&host.atualizado,host.disponivel?`${host.hostname||'host'} · ${Math.round((host.idade_segundos||0)/60)} min atrás`:host.motivo));
    hostBox.append(serverPill('Firewall detectado',host.firewall_active,host.firewall_provider));
    hostBox.append(serverPill('Certificado HTTPS',host.https_valid,host.certificate_expires_at||''));
    hostBox.append(serverPill('Banco sem porta pública',host.database_not_public,host.database_not_public===null?'Não foi possível verificar':''));
    hostBox.append(serverPill('Diagnóstico sem root',host.non_root_user,'O container da aplicação usa o usuário restrito linkce.'));
    for(const field of SERVER_CONTROL_FIELDS) if(form.elements[field]) form.elements[field].checked=controls[field]===true;
    form.elements.observacoes.value=controls.observacoes||''; form.elements.confirmacao.value='';
    const canManage=currentUser?.app_metadata?.role==='gestor'; form.querySelectorAll('input,textarea,button').forEach(node=>node.disabled=!canManage); $('serverBackupForm').querySelectorAll('input,textarea,select,button').forEach(node=>node.disabled=!canManage);
    for(const item of (data.backups||[])){const tr=document.createElement('tr');for(const value of [dateLabel(item.executado_em),item.tipo,item.status,item.referencia||'—',item.executado_email||'—'])cell(tr,value);rows.append(tr);}
    $('serverStatus').textContent=(data.backups||[]).length?'Histórico carregado.':'Nenhum backup registrado ainda.';
  } catch(error) {$('serverStatus').textContent=error.message;}
}
function showManagement(section = '') {
  document.getElementById('noticePanel')?.setAttribute('hidden','');
  const sections = {user:'managementUser', password:'managementPassword', audit:'managementAudit', lgpd:'managementLgpd', incidents:'managementIncidents', server:'managementServer', bank:'managementBank', companies:'managementCompanies'};
  $('managementHome').hidden = Boolean(section);
  Object.values(sections).forEach(id => $(id).hidden = sections[section] !== id);
}
$('managementButton').addEventListener('click',()=>{
  if(!['gestor','apoio'].includes(currentUser?.app_metadata?.role)) return;
  showManagement(); $('managementDialog').showModal();
});
document.querySelectorAll('[data-management-target]').forEach(button=>button.addEventListener('click',async()=>{
  const target=button.dataset.managementTarget;
  if (target === 'companies' && !currentUser?.app_metadata?.platform_admin) return;
  showManagement(target);
  if(target === 'user') $('userStatus').textContent='';
  if(target === 'password') { $('passwordManagerForm').reset(); $('resetLinkForm')?.reset(); $('resetLinkResult').hidden=true; $('passwordStatus').textContent=''; await loadPasswordHistory(); }
  if(target === 'audit') { auditOffset = 0; $('auditStatus').textContent=''; await loadAudit(); }
  if(target === 'lgpd') { $('lgpdStatus').textContent=''; await loadLgpd(); }
  if(target === 'incidents') { activeIncidentId=null; activeIncident=null; $('incidentDetail').hidden=true; $('incidentStatus').textContent=''; await loadIncidents(); }
  if(target === 'server') { $('serverStatus').textContent=''; await loadServerSecurity(); }
  if(target === 'bank') { clearBankPreview(); $('bankStatus').textContent=''; await loadBankStats(); }
  if(target === 'companies') { $('companyStatus').textContent=''; await loadEmpresas(); }
}));
document.querySelectorAll('[data-management-back]').forEach(button=>button.addEventListener('click',()=>showManagement()));
$('managementDialog').addEventListener('close',()=>{showManagement(); clearBankPreview();});
$('serverSecurityForm')?.addEventListener('submit',async event=>{
  event.preventDefault(); const button=event.submitter; button.disabled=true;
  try {const form=new FormData(event.target), payload={observacoes:String(form.get('observacoes')||''),confirmacao:String(form.get('confirmacao')||'')};for(const field of SERVER_CONTROL_FIELDS)payload[field]=form.get(field)==='on';const out=await api('/api/servidor/seguranca',{method:'PUT',body:JSON.stringify(payload)});$('serverStatus').textContent=out.mensagem;await loadServerSecurity();}
  catch(error){$('serverStatus').textContent=error.message;}finally{button.disabled=false;}
});
$('serverBackupForm')?.addEventListener('submit',async event=>{
  event.preventDefault(); const button=event.submitter; button.disabled=true;
  try {const form=new FormData(event.target), raw=String(form.get('tamanho_bytes')||'').trim(), payload={tipo:form.get('tipo'),status:form.get('status'),referencia:String(form.get('referencia')||''),checksum_sha256:String(form.get('checksum_sha256')||''),detalhes:String(form.get('detalhes')||'')};if(raw)payload.tamanho_bytes=Number(raw);const out=await api('/api/servidor/backups',{method:'POST',body:JSON.stringify(payload)});$('serverStatus').textContent=out.mensagem;event.target.reset();await loadServerSecurity();}
  catch(error){$('serverStatus').textContent=error.message;}finally{button.disabled=false;}
});
async function loadPasswordHistory() {
  const userId = currentUser?.id; $('passwordHistory').replaceChildren(); $('passwordHistoryEmpty').hidden = true;
  try {
    const data = await api('/api/seguranca/historico-senhas?limite=30');
    const scope=$('resetLinkCompany');
    if(scope && currentUser?.app_metadata?.platform_admin) {
      $('resetLinkCompanyLabel').hidden=false;
      const companies=await api('/api/seguranca/empresas-redefinicao');
      scope.replaceChildren(new Option('Selecione a empresa do gestor',''));
      for(const empresa of (companies.empresas||[])) scope.add(new Option(empresa.nome,empresa.id));
      scope.hidden=false; scope.required=true;
    } else if(scope) { $('resetLinkCompanyLabel').hidden=true; scope.hidden=true; scope.required=false; }
    if(userId !== currentUser?.id || !Array.isArray(data.historico)) return;
    const fragment = document.createDocumentFragment();
    for(const item of data.historico) { const tr=document.createElement('tr'); for(const value of [dateLabel(item.criado_em),item.gestor_email,item.usuario_email,item.motivo || '—']) cell(tr,value || '—'); fragment.append(tr); }
    $('passwordHistory').append(fragment); $('passwordHistoryEmpty').hidden = data.historico.length !== 0;
  } catch(error) { if(userId === currentUser?.id) $('passwordStatus').textContent = error.message; }
}
$('passwordManagerForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(currentUser?.app_metadata?.role !== 'gestor') return;
  const userId=currentUser.id; const button=$('savePassword'); button.disabled=true; $('passwordStatus').textContent='Redefinindo senha...';
  try {
    const result=await api('/api/seguranca/redefinir-senha',{method:'POST',body:JSON.stringify({email:$('resetEmail').value.trim(),senha:$('resetPassword').value,motivo:$('resetReason').value.trim()})});
    if(userId !== currentUser?.id) return;
    $('resetPassword').value=''; $('passwordStatus').textContent=result.mensagem || 'Senha redefinida e registrada.'; await loadPasswordHistory();
  } catch(error) {if(userId===currentUser?.id)$('passwordStatus').textContent=error.message;}
  finally {button.disabled=false;}
});
$('resetLinkForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('generateResetLink'); button.disabled=true; $('resetLinkResult').hidden=true; $('passwordStatus').textContent='Gerando link temporário...';
  try {
    const payload={email:$('resetLinkEmail').value.trim(),motivo:$('resetLinkReason').value.trim()};
    if(currentUser?.app_metadata?.platform_admin) payload.empresa_id=$('resetLinkCompany').value;
    const result=await api('/api/seguranca/gerar-link-redefinicao',{method:'POST',body:JSON.stringify(payload)});
    $('resetLinkValue').value=result.link; $('resetLinkResult').hidden=false; $('passwordStatus').textContent=result.mensagem+' Expira em '+dateLabel(result.expira_em)+'.';
  } catch(error) { $('passwordStatus').textContent=error.message; }
  finally { button.disabled=false; }
});
$('copyResetLink')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('resetLinkValue').value);$('passwordStatus').textContent='Link copiado. Entregue-o ao usuário por um canal confirmado.';}catch(_){$('passwordStatus').textContent='Não foi possível copiar automaticamente. Selecione o link e copie manualmente.';}});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(reportText);$('detailStatus').textContent='Relatório copiado.';}catch(_){$('detailStatus').textContent='Não foi possível copiar. Selecione o texto e copie manualmente.';}});
$('images').addEventListener('click',openImages);
async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  if (file.size <= 700 * 1024 && file.type !== 'image/avif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
  if (!blob) throw new Error('Não foi possível compactar a imagem.');
  const base = (file.name || 'evidencia').replace(/\.[^.]+$/, '');
  return new File([blob], base + '.jpg', {type:'image/jpeg'});
}
$('imagesForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(!activeReportId) return;
  const files=Array.from($('imagesInput').files || []); if(!files.length){$('imagesStatus').textContent='Escolha ao menos uma imagem.';return;}
  const reportId=activeReportId; const button=$('saveImages'); button.disabled=true; $('imagesStatus').textContent='Salvando imagens...';
  try { let salvas=0; for(const file of files) { if(file.size > 8*1024*1024) throw new Error('Escolha imagens de até 8 MB.'); $('imagesStatus').textContent='Comprimindo imagem '+(salvas+1)+' de '+files.length+'...'; const compressed=await compressImage(file); const form=new FormData(); form.append('arquivos',compressed,compressed.name); const result=await api('/api/relatorios/'+encodeURIComponent(reportId)+'/imagens',{method:'POST',body:form}); salvas+=result.salvas||1; } if(reportId===activeReportId){$('imagesStatus').textContent=salvas+' imagem(ns) enviada(s) com sucesso.';await openImages();} }
  catch(error){if(reportId===activeReportId)$('imagesStatus').textContent=error.message;}
  finally{button.disabled=false;}
});
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const wait=loginGuard(); if(wait){$('loginStatus').textContent='Muitas tentativas. Aguarde '+wait+' minuto(s) e tente novamente.'; return;} $('loginButton').disabled=true; $('loginStatus').textContent='Entrando...';
  try {
    if(!client) throw new Error('config');
    const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
    if(error) throw error; if(!data.user) throw new Error('session');
    clearLoginFailures(); $('password').value=''; await enter(data.user);
  }catch(error){recordLoginFailure();$('loginStatus').textContent=authMessage(error);}finally{$('loginButton').disabled=false;}
});
$('userForm').addEventListener('submit',async e=>{
  e.preventDefault(); const userId=currentUser?.id; $('saveUser').disabled=true; $('userStatus').textContent='Criando conta...';
  try {
    const body=Object.fromEntries(new FormData(e.target));
    const result=await api('/api/criar-usuario',{method:'POST',body:JSON.stringify(body)});
    if(currentUser?.id!==userId) return;
    e.target.reset(); $('userStatus').textContent=result.mensagem || 'Conta criada.';
  }catch(error){if(currentUser?.id===userId)$('userStatus').textContent=error.message;}finally{$('saveUser').disabled=false;}
});
(async()=>{
  $('loginButton').disabled=true;
  try {
    const response=await fetch('/api/config',{cache:'no-store'}); if(!response.ok) throw new Error('config');
    const config=await response.json();
    const createClient=window.supabase?.createClient;
    if(typeof createClient!=='function') throw new Error('auth-client');
    client=createClient(config.supabase_url,config.supabase_key,{auth:{storageKey:'linkce-management-auth'}});
    client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')signedOut('Sessão encerrada.');});
    const {data,error}=await client.auth.getUser();
    if(data?.user && !error) await enter(data.user); else $('loginStatus').textContent='';
  }catch(error){
    console.error('[Sistema de Campo] falha ao iniciar autenticação',error);
    // Se o cliente já foi criado, o login continua disponível mesmo que a
    // consulta inicial da sessão falhe ou seja interrompida pelo navegador.
    $('loginStatus').textContent=client
      ? ''
      : 'Não foi possível conectar ao serviço. Recarregue a página e tente novamente.';
  }finally{$('loginButton').disabled=false;}
})();

let bankPreview = null, bankVersion = 0, deletingBank = false;
async function loadBankStats() {
  const metrics = $('bankMetrics'), chart = $('bankChart');
  if (!metrics || !chart) return;
  metrics.textContent = 'Carregando ocupação…'; chart.replaceChildren();
  try {
    const data = await api('/api/banco/stats');
    const kb = Math.max(0, Number(data.size_bytes) || 0);
    const size = kb >= 1048576 ? (kb / 1048576).toFixed(2) + ' GB' : kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' B';
    metrics.textContent = `${Number(data.total_rows)||0} relatórios · ${size} estimados · de ${data.oldest_date || '—'} até ${data.newest_date || '—'}`;
    const days = (data.por_dia || []).slice(-14), max = Math.max(1, ...days.map(x => Number(x.total)||0));
    for (const row of days) { const bar=document.createElement('span'); bar.title=`${row.dia}: ${row.total}`; bar.style.height=`${Math.max(8, (Number(row.total)||0)/max*100)}%`; chart.append(bar); }
  } catch (error) { metrics.textContent = error.message; }
}
function clearBankPreview() {
  bankVersion++; bankPreview = null;
  $('bankConfirm').value = ''; $('bankDeleteForm').hidden = true;
}
$('keepDays').addEventListener('input',()=>{clearBankPreview();$('bankStatus').textContent='Calcule novamente após alterar o período.';});
$('cleanupMode')?.addEventListener('change', () => {
  localStorage.setItem('campo-limpeza-modo', $('cleanupMode').value);
  $('bankStatus').textContent = $('cleanupMode').value === 'automatico'
    ? 'Regra automática selecionada. Confirme a prévia para executar a limpeza.'
    : 'Modo manual selecionado.';
});
if ($('cleanupMode')) $('cleanupMode').value = localStorage.getItem('campo-limpeza-modo') || 'manual';
$('bankPreviewForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(deletingBank) return;
  clearBankPreview(); const version=bankVersion, userId=currentUser?.id;
  $('previewBank').disabled=true; $('bankStatus').textContent='Calculando...';
  try {
    const preview=await api('/api/banco/previa?manter_dias='+encodeURIComponent($('keepDays').value));
    if(version!==bankVersion || userId!==currentUser?.id) return;
    if(!Number.isInteger(preview.candidatos) || !preview.limite) throw new Error('Prévia inválida. Tente novamente.');
    bankPreview=preview;
    $('bankStatus').textContent=`Total no banco: ${preview.total}. Relatórios anteriores a ${dateLabel(preview.limite)} (Brasília): ${preview.candidatos}.`;
    $('bankDeleteForm').hidden=preview.candidatos===0;
  } catch(error) {if(version===bankVersion)$('bankStatus').textContent=error.message;}
  finally {$('previewBank').disabled=false;}
});
$('bankDeleteForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(deletingBank || !bankPreview || $('bankConfirm').value !== 'EXCLUIR') return;
  const limite=bankPreview.limite, userId=currentUser?.id;
  deletingBank=true; $('deleteBank').disabled=true; $('previewBank').disabled=true; $('keepDays').disabled=true;
  clearBankPreview(); $('bankStatus').textContent='Executando limpeza...';
  try {
    const result=await api('/api/banco/limpeza',{method:'POST',body:JSON.stringify({limite,confirmacao:'EXCLUIR'})});
    if(userId!==currentUser?.id) return;
    $('bankStatus').textContent=Number.isInteger(result.deletados) ? `Limpeza concluída: ${result.deletados} relatório(s) excluído(s).` : 'Limpeza concluída. Calcule uma nova prévia para conferir o banco.';
    offset=0; await loadReports();
  } catch(error) {if(userId===currentUser?.id)$('bankStatus').textContent=error.message+' Calcule uma nova prévia antes de repetir.';}
  finally {deletingBank=false;$('deleteBank').disabled=false;$('previewBank').disabled=false;$('keepDays').disabled=false;}
});
