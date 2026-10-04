const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

// A minimal DOM for executing the real panel/notices scripts without external services.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.open = false; this.parts = new Map(); }
  append(...items) { for (const item of items) { if (item?.tagName === 'fragment') this.children.push(...item.children); else this.children.push(item); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener() {}
  setAttribute(name, value) { this[name] = value; }
  querySelectorAll() { return []; }
  querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
  close() { this.open = false; }
  showModal() { this.open = true; }
  reset() {}
}
function environment(fetchImpl) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const storage = new Map();
  const document = {body:new Element(), hidden:false, addEventListener(){}, removeEventListener(){},
    getElementById:get, querySelector:()=>null,
    querySelectorAll:selector=>selector === '.results thead th' ? ['Data','Técnico','Cabeamento','Localização','Fotos','Status','Completude','Ações'].map(text=>Object.assign(new Element('th'),{textContent:text})) : [],
    createElement:tag=>new Element(tag), createTextNode:text=>({textContent:text}), createDocumentFragment:()=>new Element('fragment'),
  };
  const window = {document,navigator:{onLine:true}, addEventListener(){}, removeEventListener(){}, matchMedia:()=>({matches:false})};
  const context = vm.createContext({window,document,navigator:window.navigator, console,
    localStorage:{getItem:key=>storage.get(key) || null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Headers,FormData,URLSearchParams,Intl,Date,Promise,
    location:{replace(){},reload(){}},
    fetch:fetchImpl || (()=>new Promise(()=>{})), // Hold the login initializer; tests set an authorized fixture.
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT,'Relatorio-Linkce/static/adaptive-refresh.js'),'utf8'), context);
  context.CampoRefresh = window.CampoRefresh;
  return {get,document,context,window};
}
function panel(fetchImpl) {
  const h = environment(fetchImpl);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'static/panel.js'),'utf8'), h.context);
  vm.runInContext("currentUser={id:'fixture-user',email:'fixture@example.invalid'}", h.context);
  return h;
}
const data = id => ({relatorios:[{id,tecnico:'Técnico de teste',criado_em:'2026-10-04T12:00:00Z',equipamento_status:'Cabeado',imagens_count:2}],total:1,has_more:false});
const summary = {total:12,tecnicos:3,por_tecnico:[],por_dia:[],alertas:[]};
function setApi(h, fn) { h.context.testApi = fn; vm.runInContext('api=testApi',h.context); }

test('reload keeps login hidden while restoring the saved session and opening the workspace',async()=>{
  let configReady,sessionReady,environmentReady;
  const h=panel(()=>new Promise(resolve=>{configReady=resolve;}));
  vm.runInContext('currentUser=null',h.context);
  h.window.supabase={createClient:()=>({auth:{onAuthStateChange(){},getSession:()=>new Promise(resolve=>{sessionReady=resolve;})}})};
  h.context.enterFixture=()=>new Promise(resolve=>{environmentReady=()=>{vm.runInContext("currentUser={id:'restored'}",h.context);h.get('workspace').hidden=false;resolve();};});
  vm.runInContext('enter=enterFixture',h.context);
  assert.equal(h.get('login').hidden,true);assert.equal(h.get('authStartup').hidden,false);
  configReady({ok:true,json:async()=>({supabase_url:'https://example.invalid',supabase_key:'test'})});
  await new Promise(resolve=>setImmediate(resolve));
  sessionReady({data:{session:{user:{id:'restored'}}},error:null});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.get('login').hidden,true);assert.equal(h.get('authStartup').hidden,false);
  environmentReady();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.get('login').hidden,true);assert.equal(h.get('authStartup').hidden,true);assert.equal(h.get('workspace').hidden,false);
});

test('without a saved session the startup finishes and presents the login form',async()=>{
  let configReady;const h=panel(()=>new Promise(resolve=>{configReady=resolve;}));
  vm.runInContext('currentUser=null',h.context);
  h.window.supabase={createClient:()=>({auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null},error:null})}})};
  assert.equal(h.get('login').hidden,true);
  configReady({ok:true,json:async()=>({})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.get('authStartup').hidden,true);assert.equal(h.get('login').hidden,false);assert.equal(h.get('loginButton').disabled,false);
});

test('updating and failed reads preserve rows; unchanged reads do not rebuild them', async () => {
  const h = panel();
  setApi(h, async url=>url.includes('/resumo?') ? summary : data('first'));
  await vm.runInContext('loadReports()',h.context);
  const row = h.get('rows').children[0]; assert.ok(row);
  let finish;
  setApi(h, url=>url.includes('/resumo?') ? Promise.resolve(summary) : new Promise(resolve=>{finish=resolve;}));
  const pending = vm.runInContext('loadReports({background:true})',h.context);
  assert.equal(h.get('rows').children[0],row);
  finish(data('first')); await pending;
  assert.equal(h.get('rows').children[0],row);
  assert.equal(h.get('total').textContent,12);
  setApi(h, async()=>{throw new Error('Serviço indisponível');});
  const success = await vm.runInContext('loadReports({background:true})',h.context);
  assert.equal(success,false); assert.equal(h.get('rows').children[0],row);
  assert.match(h.get('status').textContent,/preservados/);
});

test('late results from an older filter cannot overwrite the newer reports or totals', async () => {
  const h = panel(); let oldRows, oldSummary;
  setApi(h, url=>new Promise(resolve=>{if(url.includes('/resumo?')) oldSummary=resolve; else oldRows=resolve;}));
  const old = vm.runInContext('loadReports()',h.context);
  setApi(h, async url=>url.includes('/resumo?') ? {...summary,total:99} : data('newer'));
  await vm.runInContext('loadReports()',h.context);
  const row = h.get('rows').children[0];
  oldRows(data('older')); oldSummary({...summary,total:1}); await old;
  assert.equal(h.get('rows').children[0],row); assert.equal(h.get('total').textContent,99);
});

test('summary failure leaves the successfully updated report list usable', async () => {
  const h = panel();
  setApi(h, async url=>{if(url.includes('/resumo?')) throw new Error('Resumo indisponível'); return data('available');});
  await vm.runInContext('loadReports()',h.context);
  assert.equal(h.get('rows').children.length,1);
  assert.equal(h.get('refresh').disabled,false);
  assert.match(h.get('operationAlert').textContent,/Resumo pendente/);
});

test('automatic cadence adapts to mobile/data saving and obeys the explicit choice', () => {
  const h = panel(); h.get('refreshInterval').value='auto';
  assert.equal(vm.runInContext('refreshCadence()',h.context),30000);
  h.window.matchMedia=()=>({matches:true});
  assert.equal(vm.runInContext('refreshCadence()',h.context),60000);
  h.window.navigator.connection={saveData:true};
  assert.equal(vm.runInContext('refreshCadence()',h.context),120000);
  h.get('refreshInterval').value='30000';
  assert.equal(vm.runInContext('refreshCadence()',h.context),30000);
  h.get('refreshInterval').value='0';
  assert.equal(vm.runInContext('refreshCadence()',h.context),0);
});

test('a notice network failure cannot release a known lock, and logout clears it', async () => {
  const h = environment();
  vm.runInContext(fs.readFileSync(path.join(ROOT,'Relatorio-Linkce/static/notices-tech.js'),'utf8'),h.context);
  let fail = false;
  const api = async()=>{if(fail) throw new Error('offline'); return {ok:true,json:async()=>({bloqueado:true,mensagem:'Bloqueado',atualizado_em:'1'})};};
  const notices=h.window.installNotices(api,()=>({id:'fixture-user'}));
  try {
    await notices.check(); assert.equal(h.get('mainApp').inert,true);
    const dialog = h.document.body.children[0]; assert.equal(dialog.open,true);
    fail=true; await notices.check();
    assert.equal(h.get('mainApp').inert,true); assert.equal(dialog.open,true);
    notices.close(); assert.equal(h.get('mainApp').inert,false); assert.equal(dialog.open,false);
  } finally { notices.close(); }
});

test('empty notices do not open a dialog and an explicit release unlocks the form', async () => {
  const h = environment();
  vm.runInContext(fs.readFileSync(path.join(ROOT,'Relatorio-Linkce/static/notices-tech.js'),'utf8'),h.context);
  let notice = {bloqueado:false,mensagem:'',atualizado_em:'1'};
  const notices = h.window.installNotices(async()=>({ok:true,json:async()=>notice}),()=>({id:'fixture-user'}));
  try {
    await notices.check();
    const dialog = h.document.body.children[0];
    assert.equal(dialog.open,false); assert.equal(h.get('mainApp').inert,false);
    notice={bloqueado:true,mensagem:'Aguarde',atualizado_em:'2'};
    await notices.check(); assert.equal(dialog.open,true); assert.equal(h.get('mainApp').inert,true);
    notice={bloqueado:false,mensagem:'',atualizado_em:'3'};
    await notices.check(); assert.equal(dialog.open,false); assert.equal(h.get('mainApp').inert,false);
  } finally { notices.close(); }
});

test('safe PWA update tolerates browser activation during the offline queue check', async () => {
  const html = fs.readFileSync(path.join(ROOT,'Relatorio-Linkce/index.html'),'utf8');
  const start = html.indexOf('  async function applySafeUpdate(reg)');
  const end = html.indexOf('  navigator.serviceWorker.register',start);
  assert.ok(start > 0 && end > start);
  const h = environment();
  h.get('formRelatorio').querySelector=()=>null;
  let finish, messages=0;
  const reg = {waiting:{postMessage:()=>{messages++;}}};
  Object.assign(h.context,{evidenceFiles:[],materiaisUtilizados:[],materiaisRecolhidos:[],
    pendingOfflineItems:()=>new Promise(resolve=>{finish=resolve;}),mostrarToastSistema(){},reg});
  vm.runInContext('let updateApplied=false;\n' + html.slice(start,end),h.context);
  const pending = vm.runInContext('applySafeUpdate(reg)',h.context);
  reg.waiting=null; finish(0);
  await pending; assert.equal(messages,0);
  assert.equal(vm.runInContext('updateApplied',h.context),false);
});
