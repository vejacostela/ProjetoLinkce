const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../Relatorio-Linkce/static/adaptive-refresh.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  let now = 0, nextId = 0;
  const timers = new Map(), listeners = new Map();
  const eventTarget = name => ({
    addEventListener(type, listener) { const key = name + ':' + type; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(listener); },
    removeEventListener(type, listener) { listeners.get(name + ':' + type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(name + ':' + type) || []) listener({type}); },
  });
  const window = {...eventTarget('window'), navigator:{onLine:true}, document:{...eventTarget('document'), hidden:false}};
  vm.runInNewContext(source, {window, Promise, Date:{now:()=>now},
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, {fn, at:now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {window, timers, listeners, create:window.CampoRefresh.create, async advance(ms) {
    const end = now + ms;
    for (let guard = 0; guard < 1000; guard++) {
      const next = [...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = end; await flush();
  }};
}

test('waits for a request to finish and deduplicates simultaneous refreshes', async () => {
  const h = harness(); let finish, calls = 0;
  const job = h.create({interval:1000, run:()=>{ calls++; return new Promise(resolve=>{ finish=resolve; }); }});
  job.start(); await h.advance(0);
  const a = job.refresh({force:true}), b = job.refresh({force:true});
  assert.equal(a,b); assert.equal(calls,1);
  await h.advance(5000); assert.equal(calls,1);
  finish(true); await a; await h.advance(999); assert.equal(calls,1);
  await h.advance(1); assert.equal(calls,2);
  job.stop(); finish(true); await flush(); assert.equal(h.timers.size,0);
});

test('hidden and offline pages stop polling and reconnect once', async () => {
  const h = harness(); let calls = 0;
  const job = h.create({interval:1000,run:()=>{calls++;}});
  job.start(); await h.advance(0); assert.equal(calls,1);
  h.window.document.hidden=true; h.window.document.emit('visibilitychange');
  await h.advance(10000); assert.equal(calls,1); assert.equal(h.timers.size,0);
  h.window.document.hidden=false; h.window.document.emit('visibilitychange');
  await h.advance(0); assert.equal(calls,2);
  h.window.navigator.onLine=false; h.window.emit('offline');
  await h.advance(10000); assert.equal(calls,2); assert.equal(h.timers.size,0);
  h.window.navigator.onLine=true; h.window.emit('online'); h.window.emit('online');
  await h.advance(0); assert.equal(calls,3);
  job.dispose(); assert.equal(h.timers.size,0);
  assert.equal([...h.listeners.values()].reduce((n,v)=>n+v.size,0),0);
});

test('failed responses back off and success restores the normal interval', async () => {
  const h = harness(); let calls = 0;
  const job = h.create({interval:1000,run:()=>++calls > 2});
  job.start(); await h.advance(0); assert.equal(calls,1);
  await h.advance(1999); assert.equal(calls,1);
  await h.advance(1); assert.equal(calls,2);
  await h.advance(3999); assert.equal(calls,2);
  await h.advance(1); assert.equal(calls,3);
  await h.advance(1000); assert.equal(calls,4);
  job.dispose();
});

test('manual mode and editing pause automatic calls while allowing explicit refresh', async () => {
  const h = harness(); let cadence = 0, editing = false, calls = 0;
  const job = h.create({interval:()=>cadence,enabled:()=>!editing,run:()=>{calls++;}});
  job.start(); await h.advance(10000); assert.equal(calls,0);
  await job.refresh({force:true}); assert.equal(calls,1); assert.equal(h.timers.size,0);
  cadence=1000; editing=true; job.reschedule();
  await h.advance(10000); assert.equal(calls,1);
  editing=false; await h.advance(5000); assert.equal(calls,2);
  job.stop(); await h.advance(10000); assert.equal(calls,2);
});
