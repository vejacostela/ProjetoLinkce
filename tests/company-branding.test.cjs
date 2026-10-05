const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
class Element{
 constructor(){this.hidden=false;this.dataset={};this.events={};this.children=[];this.files=[];this.checked=false;this.draws=[];this.fills=[];}
 append(item){this.children.push(item);}
 addEventListener(name,fn){this.events[name]=fn;}
 removeAttribute(name){delete this[name];}
 reset(){}
 getContext(){return {fillRect:(...args)=>this.fills.push(args),drawImage:(...args)=>this.draws.push(args)};}
 toBlob(fn){fn(new Blob(['normalized'],{type:'image/png'}));}
}
function env(){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const head=new Element(),canvas=[];const document={head,getElementById:get,querySelector:selector=>head.children.find(el=>selector.includes(`"${el.rel}"`)),createElement:tag=>{const el=new Element();if(tag==='canvas')canvas.push(el);return el;}};
 const revoked=[];let sequence=0;const URL={createObjectURL:()=>`blob:preview-${++sequence}`,revokeObjectURL:value=>revoked.push(value)};
 class Image{constructor(){this.naturalWidth=800;this.naturalHeight=400;}set src(value){this.onload();}}
 const window={document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/company-branding.js'),'utf8'),{window,Image,URL,Blob,FormData});
 return {api:window.CampoBrand,get,head,canvas,revoked};
}
const brand={empresa_id:'A',nome:'Empresa A',icon192:'/marca/A/icon192?v=1',icon512:'/marca/A/icon512?v=1',banner:'/marca/A/banner?v=1',manifest:'/marca/A/manifest.webmanifest?v=1'};
test('ignores retired banners and applies company icon, favicon and PWA manifest; reset clears company assets',()=>{
 const h=env();const manifest=new Element();manifest.rel='manifest';h.head.append(manifest);h.api.apply(brand);
 assert.equal(h.get('companyIcon').src,brand.icon192);assert.equal(h.get('companyBanner').hidden,true);assert.equal(h.get('companyBanner').src,undefined);assert.equal(h.get('companyBrand').dataset.hasBanner,'false');
 assert.equal(h.head.children.find(el=>el.rel==='icon').href,brand.icon192);assert.equal(manifest.href,brand.manifest);
 h.api.apply(null);assert.equal(h.get('companyBanner').hidden,true);assert.equal(manifest.href,'/static/manifest.json');
});
test('icon conversion preserves transparency, proportions and exact sizes',async()=>{
 const h=env();const blob=await h.api.prepare({type:'image/png',size:500},{icon:true,size:192});
 assert.equal(h.canvas[0].fills.length,0);assert.equal(blob.type,'image/png');assert.equal(h.canvas[0].width,192);assert.equal(h.canvas[0].height,192);
 const draw=h.canvas[0].draws[0];assert.equal(draw[3]/draw[4],2);assert.equal(h.revoked.length,1);
});
test('image conversion keeps proportions and rejects SVG or oversized originals',async()=>{
 const h=env();await h.api.prepare({type:'image/jpeg',size:500});assert.equal(h.canvas[0].width/h.canvas[0].height,2);
 await assert.rejects(()=>h.api.prepare({type:'image/svg+xml',size:10}),/PNG/);
 await assert.rejects(()=>h.api.prepare({type:'image/png',size:13*1024*1024}),/12 MB/);
});
test('late branding reads from a previous company cannot replace the current header',async()=>{
 const h=env();let active={userId:'u1',empresaId:'A'},finish;
 const manager=h.api.manager({context:()=>active,api:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=manager.load();active={userId:'u1',empresaId:'B'};manager.reset();finish(brand);await pending;
 assert.equal(h.get('companyBanner').hidden,true);assert.equal(h.get('brandSave').disabled,false);
});

test('512 pixel PWA icon also keeps transparent padding',async()=>{const h=env();await h.api.prepare({type:'image/png',size:500},{icon:true,size:512});assert.equal(h.canvas[0].width,512);assert.equal(h.canvas[0].height,512);assert.equal(h.canvas[0].fills.length,0);});
