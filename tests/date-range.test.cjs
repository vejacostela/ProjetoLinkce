const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const window={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/date-range.js'),'utf8'),{window,Intl,Date});
const calendar=window.CampoDateRange;
const plain=value=>JSON.parse(JSON.stringify(value));
test('selects October to November without losing the start while navigating',()=>{
 let range=calendar.select({start:'',end:''},'2026-10-04');
 const november=calendar.shiftMonth(calendar.monthOf(range.start),1);
 assert.equal(november.getUTCMonth(),10);
 range=calendar.select(range,'2026-11-06');
 assert.deepEqual(plain(range),{start:'2026-10-04',end:'2026-11-06'});
});
test('normalizes reverse clicks and starts a new range on the third click',()=>{
 let range=calendar.select({start:'2026-11-06',end:''},'2026-10-04');
 assert.deepEqual(plain(range),{start:'2026-10-04',end:'2026-11-06'});
 assert.deepEqual(plain(calendar.select(range,'2026-12-02')),{start:'2026-12-02',end:''});
});
test('same day range, leap days and invalid days are handled correctly',()=>{
 assert.equal(calendar.parse('2026-11-60'),null);
 assert.equal(calendar.parse('2026-02-29'),null);
 assert.ok(calendar.parse('2028-02-29'));
 assert.equal(calendar.format('2026-10-04'),'04/10/2026');
 assert.deepEqual(plain(calendar.select({start:'2026-10-04',end:''},'2026-10-04')),{start:'2026-10-04',end:'2026-10-04'});
});
test('navigation crosses December and renders all actual days on Sunday based grids',()=>{
 const january=calendar.shiftMonth(calendar.monthOf('2026-12-31'),1);
 assert.equal(january.getUTCFullYear(),2027);assert.equal(january.getUTCMonth(),0);
 const days=calendar.monthDays(calendar.monthOf('2026-11-06'));
 assert.equal(days.length,42);assert.equal(days[0].value,'2026-11-01');
 assert.equal(days.filter(day=>!day.outside).length,30);
});
class Element{
 constructor(){this.children=[];this.events={};this.value='';this.dataset={};this.attributes={};this.classes=new Set();this.classList={add:name=>this.classes.add(name)};}
 append(...children){this.children.push(...children);}
 replaceChildren(){this.children=[];}
 addEventListener(name,handler){this.events[name]=handler;}
 setAttribute(name,value){this.attributes[name]=value;}
 fire(name){this.events[name]?.({});}
 focus(){this.focused=true;}
 showModal(){this.open=true;}
 close(){this.open=false;this.fire('close');}
 querySelector(){return null;}
}
function ui(){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 get('start').value='2026-10-01';get('end').value='2026-10-04';
 const controller=calendar.install({getElementById:get,createElement:()=>new Element()});
 const day=value=>get('dateRangeMonths').children.flatMap(month=>month.children[1].children).find(node=>node.dataset.date===value&&!node.classes.has('outside'));
 return {get,day,controller};
}
test('real dialog confirms a cross month draft only after OK',()=>{
 const {get,day}=ui();get('dateRangeButton').fire('click');day('2026-10-04').fire('click');
 get('dateRangeNext').fire('click');day('2026-11-06').fire('click');
 assert.equal(get('start').value,'2026-10-01');assert.equal(get('end').value,'2026-10-04');
 assert.ok(day('2026-11-03').classes.has('in-range'));
 get('dateRangeConfirm').fire('click');
 assert.equal(get('start').value,'2026-10-04');assert.equal(get('end').value,'2026-11-06');
 assert.equal(get('dateRangeEnd').textContent,'06/11/2026');assert.equal(get('dateRangeDialog').open,false);
});
test('cancel preserves applied dates and an incomplete or cleared range cannot confirm',()=>{
 const {get,day}=ui();get('dateRangeButton').fire('click');day('2026-10-08').fire('click');
 assert.equal(get('dateRangeConfirm').disabled,true);get('dateRangeConfirm').fire('click');
 assert.equal(get('end').value,'2026-10-04');get('dateRangeCancel').fire('click');
 get('dateRangeButton').fire('click');get('dateRangeClear').fire('click');
 assert.equal(get('dateRangeConfirm').disabled,true);get('dateRangeConfirm').fire('click');
 assert.equal(get('start').value,'2026-10-01');
});
test('today and filter restoration synchronize both visible labels',()=>{
 const {get,controller}=ui();get('dateRangeButton').fire('click');get('dateRangeToday').fire('click');get('dateRangeConfirm').fire('click');
 assert.equal(get('start').value,calendar.today());assert.equal(get('end').value,calendar.today());
 get('start').value='2027-01-01';get('end').value='2027-02-02';controller.sync();
 assert.equal(get('dateRangeStart').textContent,'01/01/2027');assert.equal(get('dateRangeEnd').textContent,'02/02/2027');
});
