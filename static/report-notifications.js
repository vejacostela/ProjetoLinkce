(function(root){
  'use strict';
  const dateFormat=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Fortaleza'});
  const dateLabel=value=>{const date=new Date(value);return value && !Number.isNaN(date.getTime())?dateFormat.format(date):'Horário indisponível';};
  function create({document:doc,api,context,openReport,storage=root.localStorage,scheduler=root.CampoRefresh}){
    const $=id=>doc.getElementById(id);
    if(!$('notificationsButton') || !$('notificationsDialog') || !scheduler)return null;
    let scope='',generation=0,items=[],seen=new Set(),read=new Set(),ready=false,abort=null,toastTimer=null,renderKey='';
    const keyFor=ctx=>ctx.userId && ctx.empresaId?`campo-report-notifications:v1:${ctx.empresaId}:${ctx.userId}`:'';
    const current=()=>scope && keyFor(context())===scope;
    function persist(){try{storage.setItem(scope,JSON.stringify([...read].slice(-500)));}catch(_){$('notificationsStatus').textContent='Leituras mantidas apenas nesta sessão: armazenamento do navegador indisponível.';}}
    function hideToast(){clearTimeout(toastTimer);$('notificationToast').hidden=true;}
    function render(){
      const unread=items.filter(item=>!read.has(item.id)).length;
      $('notificationsBadge').textContent=String(unread);$('notificationsBadge').hidden=!unread;
      $('notificationsButton').setAttribute('aria-label',`Notificações${unread?`: ${unread} não lidas`:': nenhuma não lida'}`);
      $('notificationsReadAll').disabled=!unread;
      $('notificationsEmpty').hidden=Boolean(items.length) || !ready;
      const signature=JSON.stringify(items.map(item=>[item.id,item.tecnico,item.criado_em,read.has(item.id)]));
      if(signature===renderKey)return;
      renderKey=signature;
      const list=$('notificationsList');list.replaceChildren();
      for(const item of items){
        const row=doc.createElement('article');row.className='report-notification';row.dataset.unread=String(!read.has(item.id));
        const text=doc.createElement('div');const title=doc.createElement('strong');title.textContent=item.tecnico;
        const action=doc.createElement('p');action.textContent='Enviou um relatório técnico';
        const time=doc.createElement('time');time.textContent=dateLabel(item.criado_em);if(item.criado_em)time.setAttribute('datetime',item.criado_em);
        const tag=doc.createElement('span');tag.className='notification-read-state';tag.textContent=read.has(item.id)?'Lida':'Nova';
        text.append(title,action,time,tag);
        const button=doc.createElement('button');button.type='button';button.textContent='Abrir relatório';
        button.addEventListener('click',()=>{
          if(!current())return;
          read.delete(item.id);read.add(item.id);persist();render();hideToast();$('notificationsDialog').close();
          openReport(item.relatorio_id);
        });
        row.append(text,button);list.append(row);
      }
    }
    function toast(fresh){
      if(!fresh.length)return;
      const text=fresh.length===1?`${fresh[0].tecnico} enviou um relatório · ${dateLabel(fresh[0].criado_em)}`:`${fresh.length} novos relatórios recebidos. Mais recente: ${fresh[0].tecnico} · ${dateLabel(fresh[0].criado_em)}`;
      $('notificationToastText').textContent=text;$('notificationToast').hidden=false;
      clearTimeout(toastTimer);toastTimer=setTimeout(hideToast,9000);
    }
    async function load(){
      if(!current())return false;
      const version=generation,empresaId=context().empresaId;
      abort?.abort();const controller=new AbortController();abort=controller;
      const timeout=setTimeout(()=>controller.abort(),15000);
      try{
        const data=await api('/api/operacao/notificacoes?limite=100',{signal:controller.signal});
        if(version!==generation || !current() || data.empresa_id!==empresaId)return false;
        const unique=new Map();
        for(const item of data.notificacoes||[]){if(item?.id && item.relatorio_id)unique.set(String(item.id),{...item,id:String(item.id)});}
        const next=[...unique.values()];const fresh=ready?next.filter(item=>!seen.has(item.id) && !read.has(item.id)):[];
        next.forEach(item=>seen.add(item.id));
        // Only IDs are retained; old reports and names never enter local storage.
        if(seen.size>500)seen=new Set([...seen].slice(-500));
        items=next;ready=true;render();
        $('notificationsStatus').textContent=`Atualizado às ${dateLabel(new Date())} · horário de Fortaleza`;
        $('notificationsLimit').hidden=!data.has_more;
        toast(fresh);return true;
      }catch(error){
        if(version===generation && current() && !controller.signal.aborted){
          $('notificationsStatus').textContent='Não foi possível atualizar os avisos. Os últimos recebidos foram preservados.';
        }else if(version===generation && current()){
          $('notificationsStatus').textContent='A atualização demorou. Tentaremos novamente automaticamente.';
        }
        return false;
      }finally{clearTimeout(timeout);if(abort===controller)abort=null;}
    }
    let polling=null;
    function stop(){
      generation++;scope='';polling?.dispose();polling=null;abort?.abort();abort=null;
      items=[];seen=new Set();read=new Set();ready=false;renderKey='';hideToast();
      $('notificationsDialog').close();$('notificationsButton').hidden=true;
      $('notificationsBadge').hidden=true;$('notificationsList').replaceChildren();$('notificationsStatus').textContent='';
    }
    function start(){
      stop();scope=keyFor(context());if(!scope)return;
      try{const saved=JSON.parse(storage.getItem(scope)||'[]');read=new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string').slice(-500):[]);}catch(_){read=new Set();}
      $('notificationsButton').hidden=false;$('notificationsEmpty').hidden=true;
      $('notificationsStatus').textContent='Carregando notificações…';$('notificationsLimit').hidden=true;render();
      polling=scheduler.create({run:load,interval:()=>root.navigator.connection?.saveData?60000:20000,enabled:()=>Boolean(current())});polling.start();
    }
    function show(){if(!current())return;hideToast();$('notificationsDialog').showModal();$('notificationsButton').setAttribute('aria-expanded','true');polling?.refresh({force:true});}
    $('notificationsButton').addEventListener('click',show);$('notificationToastOpen').addEventListener('click',show);
    $('notificationToastClose').addEventListener('click',hideToast);
    $('notificationsClose').addEventListener('click',()=>$('notificationsDialog').close());
    $('notificationsDialog').addEventListener('close',()=>{$('notificationsButton').setAttribute('aria-expanded','false');});
    $('notificationsRefresh').addEventListener('click',()=>polling?.refresh({force:true}));
    $('notificationsReadAll').addEventListener('click',()=>{if(!current())return;items.forEach(item=>{read.delete(item.id);read.add(item.id);});persist();render();hideToast();});
    return {start,stop,refresh:()=>polling?.refresh({force:true})};
  }
  root.CampoReportNotifications={create,dateLabel};
})(window);
