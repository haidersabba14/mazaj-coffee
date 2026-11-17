// Original procedural geometry. No external model, texture or tracking service.
(()=>{
 const button=document.querySelector('#cup-3d-open'),dialog=document.querySelector('#cup-3d-dialog'),canvas=document.querySelector('#cup-3d-canvas'),message=document.querySelector('#cup-3d-status');
 if(!button||!dialog)return;
 let gl,program,buffer,count=0,angle=-.45,tilt=.25,drag=null,frame=0,last=0,rotate=true,lost=false;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function mesh(){
  const data=[],cream=[.82,.74,.62],gold=[.67,.39,.20],coffee=[.13,.055,.025];
  function tri(a,b,c,color){const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;for(const p of [a,b,c])data.push(...p,...n.map(x=>x/length),...color);}
  const profile=[[0,-.8],[.48,-.8],[.54,-.7],[.69,.63],[.70,.72],[.68,.77],[.62,.77],[.61,.7],[.48,-.62],[0,-.62]],point=(p,t)=>[p[0]*Math.cos(t),p[1],p[0]*Math.sin(t)];
  for(let j=0;j<profile.length-1;j++)for(let i=0;i<64;i++){const t=i*Math.PI/32,u=(i+1)*Math.PI/32,a=point(profile[j],t),b=point(profile[j+1],t),c=point(profile[j+1],u),d=point(profile[j],u);tri(a,b,c,cream);tri(a,c,d,cream);}
  // Coffee surface and a thin gold rim around the lip.
  for(let i=0;i<64;i++){const t=i*Math.PI/32,u=(i+1)*Math.PI/32;tri([0,.64,0],[.615*Math.cos(u),.64,.615*Math.sin(u)],[.615*Math.cos(t),.64,.615*Math.sin(t)],coffee);const a=[.70*Math.cos(t),.735,.70*Math.sin(t)],b=[.70*Math.cos(u),.735,.70*Math.sin(u)],c=[.70*Math.cos(u),.765,.70*Math.sin(u)],d=[.70*Math.cos(t),.765,.70*Math.sin(t)];tri(a,c,b,gold);tri(a,d,c,gold);}
  // Curved handle: tube mesh in the XY plane.
  const handle=(t,p)=>[.65+(.37+.105*Math.cos(p))*Math.cos(t),(.48+.105*Math.cos(p))*Math.sin(t),.105*Math.sin(p)];
  for(let i=0;i<40;i++)for(let j=0;j<12;j++){const t=-Math.PI/2+i*Math.PI/40,u=t+Math.PI/40,p=j*Math.PI/6,q=p+Math.PI/6,a=handle(t,p),b=handle(u,p),c=handle(u,q),d=handle(t,q);tri(a,b,c,cream);tri(a,c,d,cream);}
  return new Float32Array(data);
 }
 function init(){
  gl=canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:false});if(!gl)return false;
  const vertex='attribute vec3 position; attribute vec3 normal; attribute vec3 color; uniform float angle; uniform float tilt; uniform float aspect; varying vec3 shade; void main(){float c=cos(angle),s=sin(angle),a=cos(tilt),b=sin(tilt); vec3 p=vec3(c*position.x+s*position.z,position.y,-s*position.x+c*position.z); vec3 n=vec3(c*normal.x+s*normal.z,normal.y,-s*normal.x+c*normal.z);p=vec3(p.x,a*p.y-b*p.z,b*p.y+a*p.z);n=vec3(n.x,a*n.y-b*n.z,b*n.y+a*n.z);float depth=4.0-p.z;gl_Position=vec4(p.x*2.7/aspect,p.y*2.7,depth-1.5,depth);float light=.32+.68*max(0.0,dot(normalize(n),normalize(vec3(-.5,1.0,1.8))));shade=color*light;}',fragment='precision mediump float; varying vec3 shade; void main(){gl_FragColor=vec4(shade,1.0);}';
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('shader');return s;}
  program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('program');gl.useProgram(program);
  const vertices=mesh();count=vertices.length/9;buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
  for(const[name,offset]of [['position',0],['normal',12],['color',24]]){const location=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,gl.FLOAT,false,36,offset);}
  gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);return true;
 }
 function draw(time=0){frame=0;if(!dialog.open||document.hidden||lost||!gl)return;const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),scale=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(width*scale)||canvas.height!==Math.round(height*scale)){canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);}if(rotate&&!reduced&&!drag)angle+=Math.min(.05,(time-last)/1000||0)*.22;last=time;gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1f(gl.getUniformLocation(program,'angle'),angle);gl.uniform1f(gl.getUniformLocation(program,'tilt'),tilt);gl.uniform1f(gl.getUniformLocation(program,'aspect'),width/height);gl.drawArrays(gl.TRIANGLES,0,count);if(rotate&&!reduced&&!drag)frame=requestAnimationFrame(draw);}
 function repaint(){if(!frame&&dialog.open)frame=requestAnimationFrame(draw);}
 button.onclick=()=>{dialog.showModal();try{if(!gl&&!init())throw Error('unavailable');message.textContent=window.mazajI18n?.get()==='en'?'Drag to rotate. A generic cup model; refer to the product photo for your drink.':'اسحب لتدوير الكوب. نموذج توضيحي عام؛ صورة المشروب هي المرجع للشكل الفعلي.';canvas.hidden=false;repaint();}catch{canvas.hidden=true;message.textContent=window.mazajI18n?.get()==='en'?'3D is unavailable on this device. Your drink photo is available in the preview.':'العرض الثلاثي غير متاح على هذا الجهاز. صورة مشروبك متاحة في المعاينة.';}};
 canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;angle+=(e.clientX-drag.x)*.012;tilt=Math.max(-.6,Math.min(.8,tilt+(e.clientY-drag.y)*.008));drag={x:e.clientX,y:e.clientY};repaint();});canvas.addEventListener('pointerup',()=>{drag=null;repaint();});canvas.addEventListener('pointercancel',()=>{drag=null;repaint();});
 canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')angle-=.15;if(e.key==='ArrowRight')angle+=.15;if(e.key==='ArrowUp')tilt=Math.min(.8,tilt+.1);if(e.key==='ArrowDown')tilt=Math.max(-.6,tilt-.1);repaint();});
 document.querySelector('#cup-3d-rotate').onclick=()=>{rotate=!rotate;document.querySelector('#cup-3d-rotate').setAttribute('aria-pressed',String(rotate));repaint();};
 dialog.addEventListener('close',()=>{cancelAnimationFrame(frame);frame=0;drag=null;last=0;});document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else repaint();});canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;message.textContent='توقف العرض الثلاثي. أغلق الصفحة وافتحها لاستعادته.';});
})();
