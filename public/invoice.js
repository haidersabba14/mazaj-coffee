(()=>{
 const $=s=>document.querySelector(s),L=window.mazajI18n||{t:s=>s,get:()=> 'ar',number:String,date:t=>new Date(t*1000).toLocaleString('ar-BH',{timeZone:'Asia/Bahrain'})},statuses={new:'بانتظار القبول',accepted:'مقبول',preparing:'قيد التجهيز',ready:'جاهز للاستلام',delivered:'تم التسليم',cancelled:'ملغي'},e=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let generation=0,invoice=null;const requested=new URLSearchParams(location.search).get('id')||'';let credential={id:requested};
 try{const saved=JSON.parse(localStorage.getItem('mazaj-receipt')||sessionStorage.getItem('mazaj-receipt'));if(saved?.id===requested&&saved.token)credential.token=saved.token;}catch{}
 function clear(){invoice=null;for(const id of ['invoice-meta','invoice-items','invoice-customization','invoice-number','invoice-total','invoice-qr'])$('#'+id).textContent='';$('#invoice-sheet').hidden=true;$('#invoice-actions').hidden=true;}
 function draw(){
  if(!invoice)return;const i=invoice,money=n=>(n/1000).toFixed(3)+(L.get()==='en'?' BHD':' د.ب.');$('#invoice-number').textContent=i.number+' / '+i.order_label;
  $('#invoice-meta').innerHTML=[['الاسم',i.name,true],['التاريخ — البحرين',L.date(i.created_at),true],['الفرع',i.branch,true],['طريقة الاستلام',i.fulfillment==='delivery'?'توصيل للبيت — بدون رسوم':i.fulfillment==='curbside'?'استلام من السيارة':'استلام من المقهى'],...(i.scheduled_at?[['موعد الطلب — البحرين',L.date(i.scheduled_at),true]]:[]),['الحالة',statuses[i.status]||i.status]].map(([k,v,privateValue])=>'<div><small>'+e(L.t(k))+'</small><strong'+(privateValue?' data-no-translate':'')+'>'+e(privateValue?v:L.t(v))+'</strong></div>').join('');
  $('#invoice-items').innerHTML=i.items.map(item=>'<tr><td>'+e(L.t(item.name))+'</td><td>'+e(L.number(item.quantity))+'</td><td>'+e(money((item.price||0)*item.quantity))+'</td></tr>').join('');
  const labels={temperature:{hot:'حار',cold:'بارد'},milk:{whole:'حليب كامل الدسم'},size:{small:'حجم صغير',medium:'حجم وسط'},strength:{light:'قوة خفيفة',medium:'قوة متوسطة',strong:'قوة عالية'},sugar:{none:'بدون سكر',light:'سكر خفيف',normal:'سكر عادي',extra:'سكر زيادة'}};
  $('#invoice-customization').textContent=Object.entries(i.customization).map(([key,value])=>L.t(labels[key]?.[value]||value)).join(' · ');$('#invoice-customization').setAttribute('data-no-translate','');$('#invoice-total').textContent=money(i.total);
 }
 async function load(credentials){
  const current=++generation;clear();$('#invoice-error').hidden=true;$('#invoice-auth').hidden=true;$('#invoice-loading').hidden=false;
  try{
   const r=await fetch('/api/order/invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)}),b=await r.json();if(current!==generation)return;if(!r.ok)throw Error(b.error||'تعذر تحميل الفاتورة');invoice=b.invoice;credential={...credentials};draw();
   if(typeof window.qrcode==='function'){const qr=window.qrcode(0,'M');qr.addData(location.origin+'/invoice.html?id='+encodeURIComponent(credentials.id));qr.make();$('#invoice-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true});}
   $('#invoice-sheet').hidden=false;$('#invoice-actions').hidden=false;$('#invoice-auth').reset();
  }catch(err){if(current!==generation)return;$('#invoice-error').hidden=false;$('#invoice-error').textContent=err.message;$('#invoice-auth').hidden=false;$('#invoice-auth [name=id]').value=credentials.id||'';}finally{if(current===generation)$('#invoice-loading').hidden=true;}
 }
 $('#invoice-auth').onsubmit=ev=>{ev.preventDefault();void load(Object.fromEntries(new FormData(ev.target)));};$('#print-invoice').onclick=()=>window.print();$('#lang-toggle')?.addEventListener('click',()=>window.mazajI18n?.toggle());window.addEventListener('royal-language-change',draw);
 window.addEventListener('storage',ev=>{if(ev.key==='royal-auth-change'){generation++;clear();$('#invoice-auth').hidden=false;$('#invoice-error').textContent='تغيّرت جلسة الحساب. أعد فتح الفاتورة.';}});
 void load(credential);
})();
