import { bindings, defineConfig, triggers } from 'cf/config';
export default defineConfig({worker:{
 name:'mazaj-coffee',entrypoint:'./src/worker.js',compatibilityDate:'2026-11-13',
 assets:{runWorkerFirst:['/api/*'],notFoundHandling:'single-page-application'},
 env:{DB:bindings.d1({name:'mazaj-coffee',id:process.env.D1_DATABASE_ID||'170439f5-0c0c-4169-9d54-a2d4dbdf8740'}),ASSETS:bindings.assets(),TURNSTILE_SITE_KEY:bindings.text(process.env.TURNSTILE_SITE_KEY||''),TURNSTILE_SECRET:bindings.secret(),ADMIN_PASSWORD_HASH:bindings.secret(),RATE_SALT:bindings.secret(),RESEND_API_KEY:bindings.secret(),EMAIL_FROM:bindings.text(process.env.EMAIL_FROM||'')},
 observability:{enabled:true,redactQueryString:true,logs:{enabled:true,invocationLogs:false},traces:{enabled:true,headSamplingRate:0.1}},
 triggers:[triggers.scheduled({schedule:'*/10 * * * *'})]
}});
