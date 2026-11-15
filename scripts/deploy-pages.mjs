import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {createHash} from 'node:crypto';
const account=process.env.CLOUDFLARE_ACCOUNT_ID||'ba74814ba7d8c1f67239ea195089ff2c',project=process.env.PAGES_PROJECT_NAME||'mazaj-cafe',token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw Error('Set CLOUDFLARE_API_TOKEN as a GitHub Actions secret');
const root=resolve('.cloudflare/output/v0/workers/default/assets');
async function api(path,{body,method='GET',jwt=token}={}){const form=body instanceof FormData;const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+jwt,...(body&&!form?{'Content-Type':'application/json'}:{})},body:body?(form?body:JSON.stringify(body)):undefined});const data=await r.json();if(!r.ok||data.success===false)throw Error('Cloudflare '+r.status+': '+JSON.stringify(data.errors));return data.result;}
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.webmanifest':'application/manifest+json','.txt':'text/plain'};
const files=[];for(const path of await walk(root)){if(['_headers','_redirects','_routes.json','.assetsignore'].includes(path.split('/').at(-1)))continue;const data=await readFile(path);files.push({key:createHash('sha256').update(data).digest('hex').slice(0,32),path:'/'+relative(root,path).replaceAll('\\','/'),value:data.toString('base64'),metadata:{contentType:types[extname(path)]||'application/octet-stream'},base64:true});}
const {jwt}=await api(`/accounts/${account}/pages/projects/${project}/upload-token`);
const missing=new Set(await api('/pages/assets/check-missing',{method:'POST',jwt,body:{hashes:files.map(f=>f.key)}}));const pending=files.filter(f=>missing.has(f.key));
for(let i=0;i<pending.length;i+=3)await api('/pages/assets/upload',{method:'POST',jwt,body:pending.slice(i,i+3).map(({path,...asset})=>asset)});
await api('/pages/assets/upsert-hashes',{method:'POST',jwt,body:{hashes:files.map(f=>f.key)}});
const f=new FormData();f.append('branch','main');f.append('commit_hash',process.env.GITHUB_SHA||'');f.append('manifest',JSON.stringify(Object.fromEntries(files.map(f=>[f.path,f.key]))));f.append('_worker.js',new Blob([await readFile('.cloudflare/output/v0/workers/default/bundle/index.js')],{type:'application/javascript+module'}),'_worker.js');f.append('_headers',new Blob([await readFile('public/_headers')],{type:'text/plain'}),'_headers');f.append('_routes.json',new Blob([JSON.stringify({version:1,include:['/api/*','/admin*'],exclude:[]})],{type:'application/json'}),'_routes.json');
const deployment=await api(`/accounts/${account}/pages/projects/${project}/deployments`,{method:'POST',body:f});console.log('Deployment created:',deployment.url);
