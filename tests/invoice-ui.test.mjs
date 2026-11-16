import {test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import vm from'node:vm';import{JSDOM}from'jsdom';
const html=await readFile('public/invoice.html','utf8'),source=await readFile('public/invoice.js','utf8');
test('الفاتورة تعرض بيانات الخادم بأمان ولا تخزن رموزًا ولا تطبع نجاحًا عند الفشل',async()=>{
 const dom=new JSDOM(html,{url:'https://coffee.test/invoice.html?id=123',runScripts:'outside-only'}),w=dom.window,d=w.document;
 try{w.fetch=async()=>({ok:true,json:async()=>({invoice:{number:'INV-1042',order_label:'CR-1042',created_at:1700000000,name:'<img src=x>',items:[{name:'<script>alert(1)</script>',quantity:1,price:0}],customization:{size:'small'},total:0,fulfillment:'pickup',status:'new',branch:'الفرع الرئيسي'}})});vm.runInContext(source,dom.getInternalVMContext());await new Promise(r=>setTimeout(r,10));assert.equal(d.querySelector('#invoice-sheet').hidden,false);assert.equal(d.querySelector('#invoice-meta img'),null);assert.equal(d.querySelector('#invoice-items script'),null);assert.match(d.querySelector('#invoice-items').textContent,/<script>/);assert.equal(w.localStorage.length,0);
  w.fetch=async()=>({ok:false,json:async()=>({error:'بيانات غير صحيحة'})});d.querySelector('#invoice-auth').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));assert.equal(d.querySelector('#invoice-sheet').hidden,true);assert.equal(d.querySelector('#invoice-actions').hidden,true);assert.match(d.querySelector('#invoice-error').textContent,/غير صحيحة/);
 }finally{w.close();}
});
test('الخروج أثناء تحميل الفاتورة يمنع استجابة قديمة من إظهار بيانات العميل',async()=>{
 const dom=new JSDOM(html,{url:'https://coffee.test/invoice.html?id=123',runScripts:'outside-only'}),w=dom.window,d=w.document;let resolve;
 try{w.fetch=()=>new Promise(r=>resolve=r);vm.runInContext(source,dom.getInternalVMContext());w.dispatchEvent(new w.StorageEvent('storage',{key:'royal-auth-change',newValue:'{"type":"logout"}'}));resolve({ok:true,json:async()=>({invoice:{name:'private'}})});await new Promise(r=>setTimeout(r,10));assert.equal(d.querySelector('#invoice-sheet').hidden,true);assert.equal(d.querySelector('#invoice-meta').textContent,'');assert.equal(d.querySelector('#invoice-auth').hidden,false);}finally{w.close();}
});
