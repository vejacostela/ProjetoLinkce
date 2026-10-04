(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && iso(date) === value ? date : null;
  }
  const format = value => parse(value) ? value.split('-').reverse().join('/') : 'Selecionar';
  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function monthOf(value) { const d = parse(value) || parse(today()); d.setUTCDate(1); return d; }
  function shiftMonth(date, amount) { const d = new Date(date); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+amount); return d; }
  function select(range, value) {
    if (!parse(value)) return range;
    if (!range.start || range.end) return {start:value,end:''};
    return value < range.start ? {start:value,end:range.start} : {start:range.start,end:value};
  }
  function monthDays(month) {
    const first = new Date(month); first.setUTCDate(1);
    first.setUTCDate(1-first.getUTCDay());
    return Array.from({length:42}, (_, i) => { const d = new Date(first); d.setUTCDate(d.getUTCDate()+i); return {value:iso(d),day:d.getUTCDate(),outside:d.getUTCMonth()!==month.getUTCMonth(),weekend:d.getUTCDay()===0 || d.getUTCDay()===6}; });
  }
  function install(doc) {
    const $ = id => doc.getElementById(id);
    const trigger = $('dateRangeButton'), dialog = $('dateRangeDialog');
    if (!trigger || !dialog) return null;
    let draft = {start:'',end:''}, month = monthOf(today());
    const sync = () => {
      $('dateRangeStart').textContent = format($('start').value);
      $('dateRangeEnd').textContent = format($('end').value);
      trigger.setAttribute('aria-label', `Selecionar período: de ${format($('start').value)} até ${format($('end').value)}`);
    };
    function render(focusDate) {
      const container = $('dateRangeMonths'); container.replaceChildren();
      const currentDay = today();
      for (let index=0; index<2; index++) {
        const displayed = shiftMonth(month,index);
        const section = doc.createElement('section'); section.className='range-month';
        const heading = doc.createElement('h3');
        heading.textContent = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(displayed);
        section.append(heading);
        const grid = doc.createElement('div'); grid.className='range-grid';
        ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(day=>{const label=doc.createElement('span');label.className='range-weekday';label.textContent=day;grid.append(label);});
        monthDays(displayed).forEach(({value,day,outside,weekend})=>{
          const button=doc.createElement('button'); button.type='button'; button.textContent=day; button.dataset.date=value;
          button.className='range-day';
          if(outside)button.classList.add('outside');
          if(weekend)button.classList.add('weekend');
          if(value===draft.start || value===draft.end)button.classList.add('selected');
          if(draft.start && draft.end && value>draft.start && value<draft.end)button.classList.add('in-range');
          button.setAttribute('aria-label',new Intl.DateTimeFormat('pt-BR',{dateStyle:'full',timeZone:'UTC'}).format(parse(value)));
          button.setAttribute('aria-pressed',String(value===draft.start || value===draft.end));
          if(value===currentDay)button.setAttribute('aria-current','date');
          button.addEventListener('click',()=>{draft=select(draft,value);render(value);});
          button.addEventListener('keydown',event=>{
            const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
            if(!(event.key in moves))return;
            event.preventDefault();const next=parse(value);next.setUTCDate(next.getUTCDate()+moves[event.key]);
            const target=iso(next);
            if(target<iso(month) || target>=iso(shiftMonth(month,2)))month=monthOf(target);
            render(target);
          });
          grid.append(button);
        });
        section.append(grid);container.append(section);
      }
      $('dateRangeHint').textContent = !draft.start ? 'Selecione a data inicial.' : !draft.end ? `Início: ${format(draft.start)}. Agora selecione a data final.` : `${format(draft.start)} até ${format(draft.end)}`;
      $('dateRangeConfirm').disabled=!(draft.start && draft.end);
      if(focusDate)container.querySelector(`button[data-date="${focusDate}"]:not(.outside)`)?.focus();
    }
    trigger.addEventListener('click',()=>{
      draft={start:parse($('start').value)?$('start').value:'',end:parse($('end').value)?$('end').value:''};
      month=monthOf(draft.start);render();dialog.showModal();trigger.setAttribute('aria-expanded','true');
    });
    $('dateRangePrevious').addEventListener('click',()=>{month=shiftMonth(month,-1);render();});
    $('dateRangeNext').addEventListener('click',()=>{month=shiftMonth(month,1);render();});
    $('dateRangeToday').addEventListener('click',()=>{const value=today();draft={start:value,end:value};month=monthOf(value);render();});
    $('dateRangeClear').addEventListener('click',()=>{draft={start:'',end:''};render();});
    $('dateRangeCancel').addEventListener('click',()=>dialog.close());
    $('dateRangeConfirm').addEventListener('click',()=>{
      if(!parse(draft.start)||!parse(draft.end)||draft.start>draft.end)return;
      $('start').value=draft.start;$('end').value=draft.end;sync();dialog.close();
    });
    dialog.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');trigger.focus();});
    ['start','end'].forEach(id=>$(id).addEventListener('change',sync));
    sync();return {sync,close:()=>dialog.close()};
  }
  root.CampoDateRange={parse,format,today,monthOf,shiftMonth,select,monthDays,install};
})(window);
