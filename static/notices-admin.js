'use strict';
const noticeButton=document.createElement('button');
noticeButton.type='button'; noticeButton.textContent='Central de avisos';
document.querySelector('.management-cards').append(noticeButton);
const noticePanel=document.createElement('section'); noticePanel.id='noticePanel';noticePanel.hidden=true;
noticePanel.innerHTML='<button type="button" id="noticeBack">← Voltar</button><h3>Central de avisos</h3><p>Mensagem para todos que acessam a área técnica. O bloqueio impede novos envios até a liberação.</p><form id="noticeForm"><label>Mensagem<textarea id="noticeText" maxlength="3000" rows="5" style="width:100%;font:inherit"></textarea></label><label><input id="noticeLock" type="checkbox"> Bloquear área técnica</label><button id="noticeSave" class="primary">Publicar / atualizar</button><button type="button" id="noticeRelease">Liberar área técnica</button></form><p id="noticeStatus" role="status"></p>';
document.getElementById('managementDialog').append(noticePanel);
document.getElementById('noticeBack').onclick=()=>showManagement();
noticeButton.onclick=async()=>{
 showManagement();$('managementHome').hidden=true;noticePanel.hidden=false;$('noticeSave').disabled=true;$('noticeRelease').disabled=true;
 try{const d=await api('/api/avisos');$('noticeText').value=d.mensagem;$('noticeLock').checked=d.bloqueado;$('noticeStatus').textContent=d.bloqueado?'Área técnica bloqueada.':'Área técnica liberada.';$('noticeSave').disabled=false;$('noticeRelease').disabled=false;}
 catch(e){$('noticeStatus').textContent=e.message;}
};
async function publishNotice(release=false){
 $('noticeSave').disabled=true;$('noticeRelease').disabled=true;
 try{await api('/api/avisos',{method:'PUT',body:JSON.stringify({mensagem:$('noticeText').value,bloqueado:release?false:$('noticeLock').checked})});if(release)$('noticeLock').checked=false;$('noticeStatus').textContent='Publicado. A área técnica será atualizada em até 15 segundos quando estiver conectada.';}
 catch(e){$('noticeStatus').textContent=e.message;}
 finally{$('noticeSave').disabled=false;$('noticeRelease').disabled=false;}
}
$('noticeForm').onsubmit=e=>{e.preventDefault();publishNotice();};$('noticeRelease').onclick=()=>publishNotice(true);
