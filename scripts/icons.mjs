import {Resvg} from '@resvg/resvg-js';
import {readFileSync,writeFileSync} from 'node:fs';
for(const width of [192,512])writeFileSync(`public/images/icon-${width}.png`,new Resvg(readFileSync('public/icon.svg'),{fitTo:{mode:'width',value:width}}).render().asPng());
