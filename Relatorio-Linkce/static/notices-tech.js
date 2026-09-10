window.installNotices=(api,getUser)=>{
 const box=document.createElement('dialog');box.className='operation-notice';
 box.innerHTML='<h2>Aviso importante</h2><p class="notice-body"></p><p class="notice-help"></p><button type="button">Entendi</button>';
 document.body.append(box);
 // Move the legacy toast out of the card stacking context.
 let locked=true,busy=false,seen='';const form=document.getElementById('mainApp');
 box.addEventListener('cancel',e=>{if(locked)e.preventDefault();});box.querySelector('button').onclick=()=>box.close();
 async function check(){
  const user=getUser();if(!user||busy)return;busy=true;
  try{
   const r=await api('/api/avisos',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();
   if(getUser()?.id!==user.id)return;
   const wasLocked=locked;locked=d.bloqueado;form.inert=locked;
   box.querySelector('.notice-body').textContent=d.mensagem;
   box.querySelector('.notice-help').textContent=locked?'Aguarde a liberação do gestor ou apoio. Seu formulário está preservado.':'';
   box.querySelector('button').hidden=locked;
   const key=user.id+':'+d.atualizado_em;
   if(locked||(d.mensagem&&seen!==key)){if(!box.open)box.showModal();seen=key;}
   else if(wasLocked||!d.mensagem)box.close();
  }catch(e){locked=false;form.inert=false;if(box.open)box.close();}
  finally{busy=false;}
 }
 setInterval(check,15000);window.addEventListener('online',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
 return {check:()=>{form.inert=true;check();},close:()=>{seen='';box.close();}};
};
