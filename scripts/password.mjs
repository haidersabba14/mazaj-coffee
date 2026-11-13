import {pbkdf2Sync,randomBytes} from 'node:crypto';
import readline from 'node:readline';
if(!process.stdin.isTTY){let value='';for await(const c of process.stdin)value+=c;const password=value.trimEnd();if(password.length<14)throw Error('استخدم كلمة مرور لا تقل عن ١٤ حرفًا');const salt=randomBytes(24).toString('hex');console.log(salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'));}else{console.error('أدخل كلمة المرور عبر stdin دون حفظها في سجل الأوامر. راجع README.');process.exit(1);}
