import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const desk=fileURLToPath(new URL('../',import.meta.url));
const core=path.resolve(process.argv[2]??process.env.HARA_SIDECAR_CORE_DIR??path.join(desk,'../hara'));
const normalized=text=>text.replace(/\r\n/g,'\n');
const hash=text=>createHash('sha256').update(normalized(text)).digest('hex');
const files=['registry.json','registry.generated.ts','errors.json','messages.generated.ts','en/core.json','en/errors.json','zh-Hans/core.json','zh-Hans/errors.json','zh-Hant/core.json'];
const manifest={schemaVersion:1,coreCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:core,encoding:'utf8'}).trim(),files:{}};
for(const name of files){const text=normalized(fs.readFileSync(path.join(core,'src/i18n',name),'utf8'));const dest=path.join(desk,'src/locales',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);manifest.files[name]=hash(text);}
const runtime=normalized(fs.readFileSync(path.join(core,'src/i18n/messages.ts'),'utf8')).replaceAll('./messages.generated.js','./messages.generated.ts').replaceAll('./locale.js','./core-locale.ts');
fs.writeFileSync(path.join(desk,'src/locales/core-messages.ts'),runtime);manifest.files['core-messages.ts']=hash(runtime);
fs.writeFileSync(path.join(desk,'src/locales/CORE_I18N_SOURCE.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({coreCommit:manifest.coreCommit,registrySha256:manifest.files['registry.json'],copied:files.length+1}));
