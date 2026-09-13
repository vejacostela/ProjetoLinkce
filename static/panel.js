'use strict';
const $ = id => document.getElementById(id);
let client, currentUser, map, markers, offset = 0, requestVersion = 0, detailVersion = 0, activeReportId = null;
let currentReports = [];
let activeFilters = {}, reportText = '';
const PAGE_SIZE = 50;
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
  if (response.status === 401) signedOut('Sua sessão expirou. Entre novamente.');
  if (response.status === 403) signedOut('Seu perfil não permite esta operação.');
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
    const completeness = cell(tr,reportComplete(r) ? 'Completo' : 'Revisar');
    completeness.className = reportComplete(r) ? 'complete-cell' : 'incomplete-cell';
    const button = document.createElement('button'); button.textContent = 'Abrir';
    button.setAttribute('aria-label',`Abrir relatório de ${r.tecnico}`);
    button.addEventListener('click',() => openReport(r.id)); cell(tr,'').append(button); fragment.append(tr);
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
  $('summaryPeriod').textContent = total + ' relatório' + (total === 1 ? '' : 's') + ' no período';
  const list = $('technicianSummary'); list.replaceChildren();
  const items = Array.isArray(data?.por_tecnico) ? data.por_tecnico : [];
  $('summaryEmpty').hidden = items.length !== 0;
  for (const item of items) {
    const card=document.createElement('article'); card.className='technician-card';
    const name=document.createElement('strong'); name.textContent=item.tecnico || 'Não informado';
    const count=document.createElement('span'); count.textContent=(item.total || 0) + ' relatório' + (Number(item.total) === 1 ? '' : 's') + ' · ' + (item.completos || 0) + ' completo' + (Number(item.completos) === 1 ? '' : 's');
    const pending=document.createElement('span'); pending.className='pending'; pending.textContent=(item.pendentes || 0) + ' pendente' + (Number(item.pendentes) === 1 ? '' : 's');
    card.append(name,count,pending); list.append(card);
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
  $('operationSummary').hidden = false;
}
async function loadResumoOperacao() {
  const query = new URLSearchParams(activeFilters);
  try {
    const data = await api('/api/operacao/resumo?' + query);
    if (!currentUser) return;
    renderResumoOperacao(data); ocultarAlertaOperacao();
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
async function enter(user) {
  const role = user.app_metadata?.role;
  if (role === 'tecnico') { window.location.assign('/tecnico'); return; }
  if (!['gestor','apoio'].includes(role)) { signedOut('Seu perfil é técnico. Acesse a Área do técnico no topo da página.'); return; }
  currentUser = user; startSessionGuard(); startHealthMonitor(); $('login').hidden = true; $('workspace').hidden = false;
  $('logout').hidden = false; $('managementButton').hidden = false;
  document.querySelectorAll('[data-management-target]').forEach(b => b.hidden = role !== 'gestor');
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
    ['Data e hora','Técnico','Cabeamento','Localização','Fotos','Completude'].map(csvValue).join(';'),
    ...reports.map(r => [dateLabel(r.criado_em),r.tecnico,r.equipamento_status || 'Não informado',hasLocation(r) ? `${r.latitude}, ${r.longitude}` : 'Não informada',Number(r.imagens_count) || 0,reportComplete(r) ? 'Completo' : 'Revisar'].map(csvValue).join(';'))
  ];
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `relatorios-linkce-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
$('exportCsv').addEventListener('click', exportReports);
$('printReports').addEventListener('click',()=>window.print());
$('previous').addEventListener('click',()=>{offset=Math.max(0,offset-PAGE_SIZE);loadReports();});
$('next').addEventListener('click',()=>{offset+=PAGE_SIZE;loadReports();});
$('logout').addEventListener('click',async()=>{signedOut();try{await client.auth.signOut({scope:'local'});}catch(_){$('loginStatus').textContent='Sessão local encerrada.';}});
function showManagement(section = '') {
  document.getElementById('noticePanel')?.setAttribute('hidden','');
  const sections = {user:'managementUser', password:'managementPassword', bank:'managementBank'};
  $('managementHome').hidden = Boolean(section);
  Object.values(sections).forEach(id => $(id).hidden = sections[section] !== id);
}
$('managementButton').addEventListener('click',()=>{
  if(!['gestor','apoio'].includes(currentUser?.app_metadata?.role)) return;
  showManagement(); $('managementDialog').showModal();
});
document.querySelectorAll('[data-management-target]').forEach(button=>button.addEventListener('click',async()=>{
  const target=button.dataset.managementTarget; showManagement(target);
  if(target === 'user') $('userStatus').textContent='';
  if(target === 'password') { $('passwordManagerForm').reset(); $('passwordStatus').textContent=''; await loadPasswordHistory(); }
  if(target === 'bank') { clearBankPreview(); $('bankStatus').textContent=''; }
}));
document.querySelectorAll('[data-management-back]').forEach(button=>button.addEventListener('click',()=>showManagement()));
$('managementDialog').addEventListener('close',()=>{showManagement(); clearBankPreview();});
async function loadPasswordHistory() {
  const userId = currentUser?.id; $('passwordHistory').replaceChildren(); $('passwordHistoryEmpty').hidden = true;
  try {
    const data = await api('/api/seguranca/historico-senhas?limite=30');
    const auditData = await api('/api/seguranca/auditoria?limite=100');
    if(userId !== currentUser?.id || !Array.isArray(data.historico)) return;
    const fragment = document.createDocumentFragment();
    for(const item of data.historico) { const tr=document.createElement('tr'); for(const value of [dateLabel(item.criado_em),item.gestor_email,item.usuario_email,item.motivo || '—']) cell(tr,value || '—'); fragment.append(tr); }
    $('passwordHistory').append(fragment); $('passwordHistoryEmpty').hidden = data.historico.length !== 0;
    const auditFragment = document.createDocumentFragment();
    for(const item of (auditData.auditoria || [])) { const tr=document.createElement('tr'); for(const value of [dateLabel(item.criado_em),item.acao,item.rota,item.resultado]) cell(tr,value || '—'); auditFragment.append(tr); }
    $('auditHistory').replaceChildren(auditFragment); $('auditHistoryEmpty').hidden = (auditData.auditoria || []).length !== 0;
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
    console.error('[Linkce] falha ao iniciar autenticação',error);
    // Se o cliente já foi criado, o login continua disponível mesmo que a
    // consulta inicial da sessão falhe ou seja interrompida pelo navegador.
    $('loginStatus').textContent=client
      ? ''
      : 'Não foi possível conectar ao serviço. Recarregue a página e tente novamente.';
  }finally{$('loginButton').disabled=false;}
})();

let bankPreview = null, bankVersion = 0, deletingBank = false;
function clearBankPreview() {
  bankVersion++; bankPreview = null;
  $('bankConfirm').value = ''; $('bankDeleteForm').hidden = true;
}
$('keepDays').addEventListener('input',()=>{clearBankPreview();$('bankStatus').textContent='Calcule novamente após alterar o período.';});
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
