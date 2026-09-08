'use strict';
const $ = id => document.getElementById(id);
let client, currentUser, map, markers, offset = 0, requestVersion = 0, detailVersion = 0;
let activeFilters = {}, reportText = '';
const PAGE_SIZE = 50;
const dateFormat = new Intl.DateTimeFormat('pt-BR', {dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo'});
const dateLabel = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Data indisponível' : dateFormat.format(d); };
const hasLocation = r => typeof r.latitude === 'number' && typeof r.longitude === 'number' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180;
function authMessage(error) {
  const messages = {invalid_credentials:'Email ou senha incorretos.',email_not_confirmed:'Confirme o email dessa conta no Supabase.',email_provider_disabled:'O login por email está desativado. Contate o gestor.',weak_password:'A senha não atende às regras de segurança.'};
  return messages[error?.code] || (error?.status === 429 ? 'Muitas tentativas. Aguarde e tente novamente.' : 'Não foi possível autenticar. Confira a conexão e a configuração do sistema.');
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
  for (const id of ['total','located','technicians']) $(id).textContent = '—';
  $('empty').hidden = true; $('pageLabel').textContent = '';
  $('previous').disabled = true; $('next').disabled = true;
  $('mapStatus').textContent = '';
}
function signedOut(message = '') {
  currentUser = null; requestVersion++; detailVersion++;
  $('workspace').hidden = true; $('login').hidden = false;
  $('logout').hidden = true; $('newUser').hidden = true;
  $('bankButton').hidden = true; $('bankDialog').close(); clearBankPreview();
  $('detail').close(); $('userDialog').close(); $('detailText').textContent = '';
  $('detailMeta').replaceChildren(); $('userForm').reset(); reportText = '';
  clearResults(); $('loginStatus').textContent = message;
}
async function api(path, options = {}) {
  const {data, error} = await client.auth.getSession();
  if (error || !data.session) { signedOut('Sua sessão expirou. Entre novamente.'); throw new Error('Sua sessão expirou.'); }
  const response = await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`}});
  const body = await response.json().catch(() => null);
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
function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; }
function render(data) {
  const reports = data.relatorios;
  if (!Array.isArray(reports) || !Number.isInteger(data.total) || typeof data.has_more !== 'boolean') throw new Error('Integração pendente: atualize a API de relatórios antes de usar este painel.');
  clearResults();
  $('total').textContent = data.total;
  $('located').textContent = reports.filter(hasLocation).length;
  $('technicians').textContent = new Set(reports.map(r => r.user_id || r.tecnico)).size;
  $('empty').hidden = reports.length !== 0;
  $('pageLabel').textContent = reports.length ? `${offset + 1}–${offset + reports.length} de ${data.total}` : '0 resultados';
  $('previous').disabled = offset === 0; $('next').disabled = !data.has_more;
  const fragment = document.createDocumentFragment();
  for (const r of reports) {
    const tr = document.createElement('tr');
    cell(tr,dateLabel(r.criado_em)); cell(tr,r.tecnico); cell(tr,r.equipamento_status || 'Não informado');
    cell(tr,hasLocation(r) ? 'Disponível' : 'Não informada');
    const button = document.createElement('button'); button.textContent = 'Abrir';
    button.setAttribute('aria-label',`Abrir relatório de ${r.tecnico}`);
    button.addEventListener('click',() => openReport(r.id)); cell(tr,'').append(button); fragment.append(tr);
    if (map && hasLocation(r)) {
      const popup = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = r.tecnico;
      const time = document.createElement('p'); time.textContent = dateLabel(r.criado_em);
      const open = document.createElement('button'); open.textContent = 'Ver relatório'; open.addEventListener('click',()=>openReport(r.id));
      popup.append(name,time,open);
      L.circleMarker([r.latitude,r.longitude],{radius:8,color:'#ffb547',fillColor:'#ffb547',fillOpacity:.8}).bindPopup(popup).addTo(markers);
    }
  }
  $('rows').append(fragment);
  if (map) {
    map.invalidateSize();
    if (markers.getLayers().length) map.fitBounds(markers.getBounds(),{padding:[35,35],maxZoom:15});
    else map.setView([-14,-52],4);
  }
  $('mapStatus').textContent = !window.L ? 'Mapa indisponível. As coordenadas continuam acessíveis nos detalhes.' : reports.some(hasLocation) ? 'Selecione um ponto para abrir o relatório.' : 'Nenhuma localização informada nesta página.';
}
async function loadReports() {
  const version = ++requestVersion;
  clearResults(); $('status').textContent = 'Carregando relatórios...';
  $('apply').disabled = true; $('refresh').disabled = true;
  try {
    const query = new URLSearchParams({...activeFilters,limite:PAGE_SIZE,offset});
    const data = await api('/api/relatorios?' + query);
    if (version !== requestVersion || !currentUser) return;
    render(data); $('status').textContent = 'Atualizado às ' + dateFormat.format(new Date()) + ' · horário de Brasília';
  } catch (error) {
    if (version === requestVersion) { clearResults(); $('status').textContent = error.message; }
  } finally {
    if (version === requestVersion) { $('apply').disabled = false; $('refresh').disabled = false; }
  }
}
async function enter(user) {
  const role = user.app_metadata?.role;
  if (!['gestor','apoio'].includes(role)) { signedOut('Seu perfil é técnico. Acesse a Área do técnico no topo da página.'); return; }
  currentUser = user; $('login').hidden = true; $('workspace').hidden = false;
  $('logout').hidden = false; $('newUser').hidden = role !== 'gestor';
  $('bankButton').hidden = role !== 'gestor';
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
  reportText = ''; $('detailText').textContent = ''; $('detailMeta').replaceChildren();
  $('copy').disabled = true; $('mapLink').hidden = true;
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
    if (hasLocation(r)) { $('mapLink').href = `https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=17/${r.latitude}/${r.longitude}`; $('mapLink').hidden = false; }
    $('detailStatus').textContent = '';
  } catch(error) { if(version === detailVersion) $('detailStatus').textContent = error.message; }
}
$('filters').addEventListener('submit',e=>{e.preventDefault();applyFilters();});
$('reset').addEventListener('click',()=>{defaultDates();applyFilters();});
$('refresh').addEventListener('click',loadReports);
$('previous').addEventListener('click',()=>{offset=Math.max(0,offset-PAGE_SIZE);loadReports();});
$('next').addEventListener('click',()=>{offset+=PAGE_SIZE;loadReports();});
$('logout').addEventListener('click',async()=>{signedOut();try{await client.auth.signOut({scope:'local'});}catch(_){$('loginStatus').textContent='Sessão local encerrada.';}});
$('newUser').addEventListener('click',()=>{if(currentUser?.app_metadata?.role==='gestor'){$('userStatus').textContent='';$('userDialog').showModal();}});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(reportText);$('detailStatus').textContent='Relatório copiado.';}catch(_){$('detailStatus').textContent='Não foi possível copiar. Selecione o texto e copie manualmente.';}});
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); $('loginButton').disabled=true; $('loginStatus').textContent='Entrando...';
  try {
    if(!client) throw new Error('config');
    const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
    if(error) throw error; if(!data.user) throw new Error('session');
    $('password').value=''; await enter(data.user);
  }catch(error){$('loginStatus').textContent=authMessage(error);}finally{$('loginButton').disabled=false;}
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
    client=supabase.createClient(config.supabase_url,config.supabase_key,{auth:{storageKey:'linkce-management-auth'}});
    client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')signedOut('Sessão encerrada.');});
    const {data,error}=await client.auth.getUser();
    if(data?.user && !error) await enter(data.user); else $('loginStatus').textContent='';
  }catch(_){$('loginStatus').textContent='Não foi possível iniciar o acesso. Recarregue a página ou contate o responsável.';}
  finally{$('loginButton').disabled=false;}
})();

let bankPreview = null, bankVersion = 0, deletingBank = false;
function clearBankPreview() {
  bankVersion++; bankPreview = null;
  $('bankConfirm').value = ''; $('bankDeleteForm').hidden = true;
}
$('bankButton').addEventListener('click',()=>{
  if(currentUser?.app_metadata?.role !== 'gestor') return;
  clearBankPreview(); $('bankStatus').textContent = ''; $('bankDialog').showModal();
});
$('bankDialog').addEventListener('close',clearBankPreview);
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
