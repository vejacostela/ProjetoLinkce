(function(root){
  'use strict';
  const doc=root.document;
  const defaults={page_bg:[243,245,247],top_bg:[24,43,58],text_color:[24,43,58],top_text_color:[255,255,255],font_size:15,top_font_size:13};
  const colors={PageBg:'page_bg',TopBg:'top_bg',TextColor:'text_color',TopTextColor:'top_text_color'};
  const rgb=value=>'rgb('+value.join(', ')+')';
  function validTheme(value){
    return value&&Object.values(colors).every(key=>Array.isArray(value[key])&&value[key].length===3&&value[key].every(n=>Number.isInteger(n)&&n>=0&&n<=255))&&['font_size','top_font_size'].every(key=>Number.isInteger(value[key])&&value[key]>=12&&value[key]<=22);
  }
  function themeStyle(node,value){
    if(!node?.style)return;
    for(const key of Object.values(colors))node.style.setProperty('--company-'+key.replaceAll('_','-'),rgb(value[key]));
    node.style.setProperty('--company-font-size',value.font_size+'px');
    node.style.setProperty('--company-top-font-size',value.top_font_size+'px');
    node.style.setProperty('--company-font-scale',String(value.font_size/15));
    const dark=value.page_bg.reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0)<128;
    node.style.setProperty('--company-surface',dark?rgb(value.page_bg):'#ffffff');
    node.style.setProperty('--company-field',dark?rgb(value.page_bg):'#fbfcfd');
  }
  function applyTheme(value){
    const node=doc.documentElement;if(!node?.style)return;
    if(!validTheme(value)){
      delete node.dataset.companyTheme;
      for(const key of [...Object.values(colors),'font_size','top_font_size','font_scale','surface','field'])node.style.removeProperty('--company-'+key.replaceAll('_','-'));
      return;
    }
    node.dataset.companyTheme='true';themeStyle(node,value);
  }
  function contrast(a,b){
    const luminance=color=>color.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  }
  function image(id,url,alt){const node=doc.getElementById(id);if(!node)return;node.hidden=!url;if(url){node.src=url;node.alt=alt;}else node.removeAttribute('src');}
  function apply(brand){
    const name=brand?.nome||'Sistema de Campo';
    applyTheme(brand?.tema);
    image('companyIcon',brand?.icon192,name);image('companyBanner',null,'');
    const wrapper=doc.getElementById('companyBrand');if(wrapper)wrapper.dataset.hasBanner='false';
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
        canvas.width=size;canvas.height=size; // Keep the canvas alpha channel; never flatten transparent PNGs.
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
    const themeIds=[...Object.keys(colors).flatMap(key=>['brand'+key+'Picker',...'RGB'.split('').map(c=>'brand'+key+c)]),'brandFontSize','brandTopFontSize','brandThemeDefaults'];
    const busy=value=>['brandIconFile','brandRemoveIcon','brandSave',...themeIds].forEach(id=>{if($(id))$(id).disabled=value;});
    function readTheme(){
      const value={};for(const [field,key] of Object.entries(colors))value[key]=[...'RGB'].map(c=>{const raw=$('brand'+field+c).value;if(!/^\d{1,3}$/.test(raw))throw new Error('Preencha cada canal RGB com um número de 0 a 255.');return Number(raw);});
      value.font_size=Number($('brandFontSize').value);value.top_font_size=Number($('brandTopFontSize').value);
      if(!validTheme(value))throw new Error('Use valores RGB inteiros de 0 a 255 e fontes de 12 a 22 pixels.');
      return value;
    }
    function themePreview(){
      try{const value=readTheme();themeStyle($('brandThemePreview'),value);
        const low=contrast(value.page_bg,value.text_color)<4.5||contrast(value.top_bg,value.top_text_color)<4.5;
        $('brandThemeContrast').textContent=low?'Contraste baixo: considere ajustar as cores para facilitar a leitura.':'Boa combinação de contraste para leitura.';
      }catch(error){$('brandThemeContrast').textContent=error.message;}
    }
    function fillTheme(value){
      const theme=validTheme(value)?value:defaults;
      for(const [field,key] of Object.entries(colors)){theme[key].forEach((n,i)=>$('brand'+field+'RGB'[i]).value=String(n));$('brand'+field+'Picker').value='#'+theme[key].map(n=>n.toString(16).padStart(2,'0')).join('');}
      $('brandFontSize').value=String(theme.font_size);$('brandTopFontSize').value=String(theme.top_font_size);themePreview();
    }
    for(const [field] of Object.entries(colors)){
      $('brand'+field+'Picker').addEventListener('input',()=>{const hex=$('brand'+field+'Picker').value;[...'RGB'].forEach((c,i)=>$('brand'+field+c).value=String(parseInt(hex.slice(1+i*2,3+i*2),16)));themePreview();});
      for(const channel of 'RGB')$('brand'+field+channel).addEventListener('input',()=>{try{const theme=readTheme();$('brand'+field+'Picker').value='#'+theme[colors[field]].map(n=>n.toString(16).padStart(2,'0')).join('');}catch(error){}themePreview();});
    }
    ['brandFontSize','brandTopFontSize'].forEach(id=>$(id).addEventListener('input',themePreview));
    $('brandThemeDefaults').addEventListener('click',()=>fillTheme(defaults));
    function cleanup(){previews.forEach(url=>URL.revokeObjectURL(url));previews=[];}
    function preview(){
      cleanup();
      for(const [field,node,existing,remove] of [['brandIconFile','brandIconPreview',brand?.icon512,'brandRemoveIcon']]){
        const file=$(field).files?.[0];const url=file?URL.createObjectURL(file):existing;
        if(file)previews.push(url);image(node,$(remove).checked?null:url,'Prévia da marca');
      }
    }
    function reset(){generation++;scope='';brand=null;cleanup();$('brandForm').reset();fillTheme(defaults);busy(false);apply(null);$('brandStatus').textContent='';image('brandIconPreview',null,'');}
    async function load(){
      const version=++generation;scope=identity();const expected=scope;
      busy(true);
      try{const value=await api('/api/identidade-visual');if(version!==generation||expected!==identity())return;
        brand=value;apply(value);$('brandForm').reset();fillTheme(value.tema);preview();$('brandStatus').textContent='';
      }catch(error){if(version===generation&&expected===identity())$('brandStatus').textContent='Não foi possível carregar a marca. '+error.message;}
      finally{if(version===generation)busy(false);}
    }
    ['brandIconFile','brandRemoveIcon'].forEach(id=>$(id).addEventListener('change',()=>{
      if(id==='brandIconFile')$('brandRemoveIcon').checked=false;preview();
    }));
    $('brandForm').addEventListener('submit',async event=>{
      event.preventDefault();const version=generation,expected=identity();
      if(expected!==scope)return;
      busy(true);$('brandStatus').textContent='Preparando e enviando a marca…';
      try{
        const form=new FormData();const icon=$('brandIconFile').files?.[0];
        if(icon&&!$('brandRemoveIcon').checked){form.append('icon512',await prepare(icon,{icon:true,size:512}),'icon-512.png');form.append('icon192',await prepare(icon,{icon:true,size:192}),'icon-192.png');}
        form.append('remover_icone',String($('brandRemoveIcon').checked));
        form.append('tema',JSON.stringify(readTheme()));
        if(version!==generation || expected!==identity())return;
        const value=await api('/api/identidade-visual',{method:'POST',body:form});
        if(version!==generation || expected!==identity())return;
        brand=value;apply(value);$('brandForm').reset();fillTheme(value.tema);preview();$('brandStatus').textContent=value.mensagem;
      }catch(error){if(version===generation&&expected===identity())$('brandStatus').textContent=error.message;}
      finally{if(version===generation)busy(false);}
    });
    return {load,reset};
  }
  root.CampoBrand={apply,prepare,manager};
})(window);
