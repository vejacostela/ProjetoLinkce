(function(root){
  'use strict';
  const doc=root.document;
  function image(id,url,alt){const node=doc.getElementById(id);if(!node)return;node.hidden=!url;if(url){node.src=url;node.alt=alt;}else node.removeAttribute('src');}
  function apply(brand){
    const name=brand?.nome||'Sistema de Campo';
    image('companyIcon',brand?.icon192,name);image('companyBanner',brand?.banner,name);
    const wrapper=doc.getElementById('companyBrand');if(wrapper)wrapper.dataset.hasBanner=String(Boolean(brand?.banner));
    let icon=doc.querySelector('link[rel="icon"]');
    if(!icon){icon=doc.createElement('link');icon.rel='icon';doc.head.append(icon);}icon.href=brand?.icon192||'/static/icon-192.png';
    let apple=doc.querySelector('link[rel="apple-touch-icon"]');
    if(!apple){apple=doc.createElement('link');apple.rel='apple-touch-icon';doc.head.append(apple);}apple.href=brand?.icon192||'/static/icon-192.png';
    const manifest=doc.querySelector('link[rel="manifest"]');if(manifest)manifest.href=brand?.manifest||'/static/manifest.json';
  }
  async function prepare(file,{icon=false,size=512}={}){
    if(!file || !['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Use uma imagem PNG, JPEG ou WebP.');
    if(file.size>12*1024*1024)throw new Error('A imagem original deve ter até 12 MB.');
    const url=URL.createObjectURL(file);const img=new Image();
    try{
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'));img.src=url;});
      if(!img.naturalWidth || !img.naturalHeight || img.naturalWidth*img.naturalHeight>50000000)throw new Error('Use uma imagem de resolução menor.');
      const canvas=doc.createElement('canvas');const context=canvas.getContext('2d');
      if(icon){
        canvas.width=size;canvas.height=size;context.fillStyle='#ffffff';context.fillRect(0,0,size,size);
        const scale=(size*.78)/Math.max(img.naturalWidth,img.naturalHeight);
        const width=img.naturalWidth*scale,height=img.naturalHeight*scale;context.drawImage(img,(size-width)/2,(size-height)/2,width,height);
      }else{
        const scale=Math.min(1,1600/img.naturalWidth,600/img.naturalHeight);
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        context.drawImage(img,0,0,canvas.width,canvas.height);
      }
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob||blob.size>(icon?1024*1024:3*1024*1024))throw new Error('Imagem muito grande após o ajuste. Use uma versão mais simples.');
      return blob;
    }finally{URL.revokeObjectURL(url);}
  }
  function manager({api,context}){
    const $=id=>doc.getElementById(id);if(!$('brandForm'))return null;
    let generation=0,brand=null,previews=[],scope='';
    const identity=()=>JSON.stringify(context());
    const busy=value=>['brandIconFile','brandBannerFile','brandRemoveIcon','brandRemoveBanner','brandSave'].forEach(id=>$(id).disabled=value);
    function cleanup(){previews.forEach(url=>URL.revokeObjectURL(url));previews=[];}
    function preview(){
      cleanup();
      for(const [field,node,existing,remove] of [['brandIconFile','brandIconPreview',brand?.icon512,'brandRemoveIcon'],['brandBannerFile','brandBannerPreview',brand?.banner,'brandRemoveBanner']]){
        const file=$(field).files?.[0];const url=file?URL.createObjectURL(file):existing;
        if(file)previews.push(url);image(node,$(remove).checked?null:url,'Prévia da marca');
      }
    }
    function reset(){generation++;scope='';brand=null;cleanup();$('brandForm').reset();busy(false);apply(null);$('brandStatus').textContent='';image('brandIconPreview',null,'');image('brandBannerPreview',null,'');}
    async function load(){
      const version=++generation;scope=identity();const expected=scope;
      busy(true);
      try{const value=await api('/api/identidade-visual');if(version!==generation||expected!==identity())return;
        brand=value;apply(value);$('brandForm').reset();preview();$('brandStatus').textContent='';
      }catch(error){if(version===generation&&expected===identity())$('brandStatus').textContent='Não foi possível carregar a marca. '+error.message;}
      finally{if(version===generation)busy(false);}
    }
    ['brandIconFile','brandBannerFile','brandRemoveIcon','brandRemoveBanner'].forEach(id=>$(id).addEventListener('change',()=>{
      if(id==='brandIconFile')$('brandRemoveIcon').checked=false;if(id==='brandBannerFile')$('brandRemoveBanner').checked=false;preview();
    }));
    $('brandForm').addEventListener('submit',async event=>{
      event.preventDefault();const version=generation,expected=identity();
      if(expected!==scope)return;
      busy(true);$('brandStatus').textContent='Preparando e enviando a marca…';
      try{
        const form=new FormData();const icon=$('brandIconFile').files?.[0],banner=$('brandBannerFile').files?.[0];
        if(icon&&!$('brandRemoveIcon').checked){form.append('icon512',await prepare(icon,{icon:true,size:512}),'icon-512.png');form.append('icon192',await prepare(icon,{icon:true,size:192}),'icon-192.png');}
        if(banner&&!$('brandRemoveBanner').checked)form.append('banner',await prepare(banner),'banner.png');
        form.append('remover_icone',String($('brandRemoveIcon').checked));form.append('remover_banner',String($('brandRemoveBanner').checked));
        if(version!==generation || expected!==identity())return;
        const value=await api('/api/identidade-visual',{method:'POST',body:form});
        if(version!==generation || expected!==identity())return;
        brand=value;apply(value);$('brandForm').reset();preview();$('brandStatus').textContent=value.mensagem;
      }catch(error){if(version===generation&&expected===identity())$('brandStatus').textContent=error.message;}
      finally{if(version===generation)busy(false);}
    });
    return {load,reset};
  }
  root.CampoBrand={apply,prepare,manager};
})(window);
