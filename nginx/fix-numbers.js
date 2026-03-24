(function(){
  function clamp(n, min, max){ n=Number(n); if(Number.isNaN(n)) n=min??0;
    if(min!=null&&n<min)n=min; if(max!=null&&n>max)n=max; return n; }
  function attach(el){
    const nm=(el.getAttribute('name')||'').toLowerCase();
    const isQty=/quantity|qty|sasi/.test(nm);
    const isPerc=/percent|percentage|perqind/.test(nm);
    if(!(isQty||isPerc)) return;
    el.addEventListener('focus', ()=>{ if(isQty&&el.value==='1')el.value=''; if(isPerc&&el.value==='0')el.value=''; });
    el.addEventListener('input', ()=>{
      let v=el.value.replace(/[^\d]/g,'').replace(/^0+(?=\d)/,'');
      el.value=v;
    });
    el.addEventListener('blur', ()=>{
      if(el.value===''){ el.value=isQty?'1':'0'; return; }
      let n=parseInt(el.value,10);
      el.value=String(isQty?clamp(n,1,999999):clamp(n,0,100));
    });
    el.setAttribute('inputmode','numeric'); el.setAttribute('pattern','[0-9]*');
    if(isQty){ el.setAttribute('min','1'); el.setAttribute('step','1'); }
    if(isPerc){ el.setAttribute('min','0'); el.setAttribute('max','100'); el.setAttribute('step','1'); }
  }
  function scan(){ document.querySelectorAll('input[type=number],input').forEach(attach); }
  document.addEventListener('DOMContentLoaded', scan);
  let tries=0,t=setInterval(()=>{scan(); if(++tries>20) clearInterval(t);},500);
})();
