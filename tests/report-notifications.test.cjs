const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
class Element{
 constructor(){this.children=[];this.events={};this.attributes={};this.dataset={};this.hidden=false;this.textContent='';}
 append(...items){this.children.push(...items);}
 replaceChildren(){this.children=[];}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,handler){this.events[name]=handler;}
 fire(name){this.events[name]?.();}
 showModal(){this.open=true;}
 close(){this.open=false;this.fire('close');}
}
function setup(){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const values=new Map();const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 let active={userId:'u1',empresaId:'A'},reply={empresa_id:'A',notificacoes:[]},calls=0;const opened=[];
 const scheduler={create:({run})=>({start(){},dispose(){},refresh:()=>run()})};
 const window={navigator:{connection:{}},CampoRefresh:scheduler};
 const timers=new Set();const timer=(fn)=>{const id=setTimeout(fn,100000);id.unref();timers.add(id);return id;};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/report-notifications.js'),'utf8'),{window,Intl,Date,AbortController,setTimeout:timer,clearTimeout});
 const controller=window.CampoReportNotifications.create({document:{getElementById:get,createElement:()=>new Element()},storage,scheduler,context:()=>active,
   api:async()=>{calls++;if(reply instanceof Error)throw reply;return typeof reply==='function'?reply():reply;},openReport:id=>opened.push(id)});
 controller.start();
 return {get,controller,values,opened,setReply:value=>{reply=value;},setContext:value=>{active=value;},calls:()=>calls};
}
const item=(id,tecnico='Ana')=>({id,relatorio_id:id,tecnico,criado_em:'2026-10-05T20:09:35Z'});
test('saved reports appear with technician and Fortaleza time; initial history has no toast',async()=>{
 const h=setup();h.setReply({empresa_id:'A',notificacoes:[item('r1')]});await h.controller.refresh();
 assert.equal(h.get('notificationsBadge').textContent,'1');
 const text=h.get('notificationsList').children[0].children[0].children;
 assert.equal(text[0].textContent,'Ana');assert.match(text[2].textContent,/17:09:35/);
 assert.equal(h.get('notificationToast').hidden,true);h.controller.stop();
});
test('a new report shows one toast and repeated polling or duplicate records do not repeat it',async()=>{
 const h=setup();h.setReply({empresa_id:'A',notificacoes:[item('r1')]});await h.controller.refresh();
 h.setReply({empresa_id:'A',notificacoes:[item('r2','Bruno'),item('r2','Bruno'),item('r1')]});await h.controller.refresh();
 assert.equal(h.get('notificationsList').children.length,2);assert.match(h.get('notificationToastText').textContent,/Bruno/);
 const row=h.get('notificationsList').children[0];
 h.get('notificationToastClose').fire('click');await h.controller.refresh();
 assert.equal(h.get('notificationsList').children[0],row);
 assert.equal(h.get('notificationToast').hidden,true);h.controller.stop();
});
test('opening a report marks it read and opening the central alone does not mark all read',async()=>{
 const h=setup();h.setReply({empresa_id:'A',notificacoes:[item('r1')]});await h.controller.refresh();
 h.get('notificationsButton').fire('click');assert.equal(h.get('notificationsBadge').textContent,'1');
 h.get('notificationsList').children[0].children[1].fire('click');
 assert.deepEqual(h.opened,['r1']);assert.equal(h.get('notificationsBadge').hidden,true);
 assert.ok(h.values.has('campo-report-notifications:v1:A:u1'));h.controller.stop();
});
test('read state survives reload and is isolated by user and company',async()=>{
 const h=setup();h.setReply({empresa_id:'A',notificacoes:[item('r1')]});await h.controller.refresh();h.get('notificationsReadAll').fire('click');
 h.controller.start();await h.controller.refresh();assert.equal(h.get('notificationsBadge').hidden,true);
 h.setContext({userId:'u2',empresaId:'A'});h.controller.start();await h.controller.refresh();assert.equal(h.get('notificationsBadge').textContent,'1');
 h.setContext({userId:'u2',empresaId:'B'});h.controller.start();h.setReply({empresa_id:'B',notificacoes:[item('r2')]});await h.controller.refresh();
 assert.equal(h.get('notificationsList').children.length,1);assert.equal(h.get('notificationsBadge').textContent,'1');h.controller.stop();
});
test('late responses after switching company and mismatched server scope cannot leak data',async()=>{
 const h=setup();let finish;h.setReply(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.controller.refresh();
 h.setContext({userId:'u1',empresaId:'B'});h.controller.start();
 finish({empresa_id:'A',notificacoes:[item('secret-A')]});await pending;assert.equal(h.get('notificationsList').children.length,0);
 h.setReply({empresa_id:'A',notificacoes:[item('secret-A')]});await h.controller.refresh();assert.equal(h.get('notificationsList').children.length,0);h.controller.stop();
});
test('failed reads preserve existing notifications and logout clears all displayed data',async()=>{
 const h=setup();h.setReply({empresa_id:'A',notificacoes:[item('r1')]});await h.controller.refresh();h.setReply(new Error('offline'));await h.controller.refresh();
 assert.equal(h.get('notificationsList').children.length,1);assert.match(h.get('notificationsStatus').textContent,/preservados/);
 h.controller.stop();assert.equal(h.get('notificationsList').children.length,0);assert.equal(h.get('notificationsButton').hidden,true);assert.equal(h.get('notificationToast').hidden,true);
});
