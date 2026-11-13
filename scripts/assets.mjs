// Optional stock asset restoration. Does not overwrite final or original generated images.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const photos={hero:'photo-1442512595331-e89e73853f31',story:'photo-1447933601403-0c6688de566e',black:'photo-1514432324607-a09d9b4aefdd',secret:'photo-1461023058943-07fcbe16d735'};
for(const [name,id]of Object.entries(photos)){const path=`public/images/${name}.webp`;if(existsSync(path))continue;execFileSync('curl',['-fLsS','--max-time','40',`https://images.unsplash.com/${id}?auto=format&fit=crop&w=${name==='hero'?1920:900}&q=85&fm=webp`,'-o',path]);}
