import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, statSync, symlinkSync, linkSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readUpdaterKey, withUpdaterFile } from "../scripts/with-updater-file.mjs";
const unix = process.platform !== "win32", secret = "synthetic-updater-key-only-0123456789";
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "hara-updater-file-test-")), directory = join(home,".tauri"), key = join(directory,"hara-desktop.key");
  mkdirSync(directory,{mode:0o700});writeFileSync(key, secret+"\n",{mode:0o600});
  return {home,directory,key,close(){rmSync(home,{recursive:true,force:true});}};
}
test("file reader opens the existing private key without replacing or changing it", {skip: !unix}, () => {
  const f=fixture();try{const before=statSync(f.key), bytes=readUpdaterKey(f.home);assert.equal(bytes.toString(),secret+"\n");bytes.fill(0);const after=statSync(f.key);
    assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.mode,before.mode);assert.equal(readFileSync(f.key,"utf8"),secret+"\n");
  }finally{f.close();}
});
test("unsafe modes, empty and oversized files fail closed", {skip: !unix}, () => {
  const f=fixture();try{for(const mode of [0o644,0o640,0o666]){chmodSync(f.key,mode);assert.throws(()=>readUpdaterKey(f.home));}chmodSync(f.key,0o600);
    for(const value of ["", "x".repeat(16385)]){writeFileSync(f.key,value);assert.throws(()=>readUpdaterKey(f.home));}
  }finally{f.close();}
});
test("symlink and hardlink key files are rejected, without modifying their targets", {skip: !unix}, () => {
  const f=fixture();try{const original=join(f.home,"original");writeFileSync(original,secret,{mode:0o600});unlinkSync(f.key);symlinkSync(original,f.key);assert.throws(()=>readUpdaterKey(f.home));unlinkSync(f.key);
    linkSync(original,f.key);assert.throws(()=>readUpdaterKey(f.home));assert.equal(readFileSync(original,"utf8"),secret);
  }finally{f.close();}
});
test("symlink/foreign/writable directories and foreign file owners are rejected", {skip: !unix}, () => {
  const f=fixture();try{assert.throws(()=>readUpdaterKey(f.home,(process.getuid?.()??0)+1));chmodSync(f.directory,0o777);assert.throws(()=>readUpdaterKey(f.home));chmodSync(f.directory,0o700);
    const alias=join(f.home,"alias");mkdirSync(alias);symlinkSync(f.directory,join(alias,".tauri"));assert.throws(()=>readUpdaterKey(alias));
  }finally{f.close();}
});
async function runChild(f, code, env = {}) {
  let output="",error="";const parentKey=process.env.TAURI_SIGNING_PRIVATE_KEY;
  const exit=await withUpdaterFile(process.execPath,["-e",code],{env:{PATH:process.env.PATH,HOME:f.home,...env},stdout:{write(value){output+=value;}},stderr:{write(value){error+=value;}}});
  assert.equal(process.env.TAURI_SIGNING_PRIVATE_KEY,parentKey);return {exit,output,error};
}
test("child receives only approved key in environment, never argv or inherited password/path", {skip: !unix}, async () => {
  const f=fixture();try{const r=await runChild(f,`const e=process.env; if(process.argv.some(a=>a.includes(e.TAURI_SIGNING_PRIVATE_KEY.trim()))||e.TAURI_SIGNING_PRIVATE_KEY_PASSWORD!==''||e.TAURI_SIGNING_PRIVATE_KEY_PATH||e.HARA_TAURI_SIGNING_PRIVATE_KEY)process.exit(9);console.log('signed child ran');`,
    {TAURI_SIGNING_PRIVATE_KEY:"foreign",TAURI_SIGNING_PRIVATE_KEY_PASSWORD:"foreign",TAURI_SIGNING_PRIVATE_KEY_PATH:"foreign",HARA_TAURI_SIGNING_PRIVATE_KEY:"foreign"});
    assert.equal(r.exit,0);assert.match(r.output,/signed child ran/);assert.equal(r.error,"");
  }finally{f.close();}
});
test("raw/trimmed/chunk-split key and encoded key output are redacted before delivery", {skip: !unix}, async () => {
  const f=fixture();try{const r=await runChild(f,`const k=process.env.TAURI_SIGNING_PRIVATE_KEY;process.stdout.write(k.slice(0,7));setTimeout(()=>{process.stdout.write(k.slice(7));console.error(k.trim());console.log(Buffer.from(k).toString('base64'));console.log(Buffer.from(k).toString('hex'));},10);`);
    assert.equal(r.exit,0);assert.doesNotMatch(r.output,new RegExp(secret));assert(!r.output.includes(Buffer.from(secret+"\n").toString("base64")));assert.equal((r.output.match(/\[REDACTED\]/g)??[]).length,4);
  }finally{f.close();}
});
test("failed and terminated children cannot be mistaken for successful signing", {skip: !unix}, async () => {
  const f=fixture();try{assert.equal((await runChild(f,"console.error(process.env.TAURI_SIGNING_PRIVATE_KEY);process.exit(17)")).exit,17);
    const r=await runChild(f,"process.kill(process.pid,'SIGTERM')");assert.equal(r.exit,1);assert.match(r.error,/terminated/);
  }finally{f.close();}
});
test("missing/blank/NUL keys never execute the child and disclose no key", {skip: !unix}, async () => {
  const f=fixture();try{for(const value of ["  \n",secret+"\0"]){writeFileSync(f.key,value);const r=await runChild(f,"console.log('MUST NOT RUN')");assert.equal(r.exit,1);assert.equal(r.output,"");assert(!r.error.includes(secret));}
    unlinkSync(f.key);assert.equal((await runChild(f,"process.exit(0)")).exit,1);
  }finally{f.close();}
});
test("output-bound failure suppresses raw output and refuses unsigned success", {skip: !unix}, async () => {
  const f=fixture();try{const r=await runChild(f,"process.stdout.write(process.env.TAURI_SIGNING_PRIVATE_KEY);process.stdout.write(Buffer.alloc(33*1024*1024,120));");assert.equal(r.exit,1);assert.equal(r.output,"");assert.match(r.error,/bounds/);}finally{f.close();}
});
test("CLI and historical helper preserve child exit status without Keychain access", {skip: !unix}, () => {
  const f=fixture();try{for(const cmd of [[process.execPath,["scripts/with-updater-file.mjs"]],["/bin/bash",["scripts/with-updater-keychain.sh"]]]){
    const r=spawnSync(cmd[0],[...cmd[1],process.execPath,"-e","console.log(process.env.TAURI_SIGNING_PRIVATE_KEY);process.exit(23)"],{encoding:"utf8",env:{PATH:process.env.PATH,HOME:f.home}});
    assert.equal(r.status,23);assert(!r.stdout.includes(secret));assert.match(r.stdout,/REDACTED/);
  }}finally{f.close();}
});
test("missing command has an explicit non-success result before key lookup", async () => {
  let error="";assert.equal(await withUpdaterFile(undefined,[],{env:{HOME:"/nonexistent"},stderr:{write(value){error+=value;}}}),2);assert.match(error,/missing updater build command/);
});
test("file preflight has fixed non-secret output, and formal CI/source guards still precede credentials", {skip: !unix}, () => {
  const f=fixture();try{const r=spawnSync(process.execPath,["scripts/with-updater-file.mjs","--check"],{env:{PATH:process.env.PATH,HOME:f.home},encoding:"utf8"});assert.equal(r.status,0);assert(!r.stdout.includes(secret));assert.match(r.stdout,/no Keychain access/);
    const source=readFileSync(new URL("../scripts/build-mac-signed.sh",import.meta.url),"utf8"), workflow=readFileSync(new URL("../.github/workflows/build.yml",import.meta.url),"utf8");
    const check=source.indexOf("node scripts/with-updater-file.mjs --check");assert(check>source.indexOf("REMOTE_DESKTOP_COMMIT="));assert(check<source.indexOf("security unlock-keychain"));
    assert(workflow.includes("Preflight approved updater file without Keychain authorization"));
    assert(source.includes('node scripts/with-updater-file.mjs node scripts/macos-dmg-detach.mjs run npm run tauri build -- --target "$TARGET"'));
  }finally{f.close();}
});
test("the shared DMG adapter preserves outer updater redaction, memory-only key and failure status", {skip: !unix}, async () => {
  const f=fixture();let output="",error="";
  try {
    const check="const k=process.env.TAURI_SIGNING_PRIVATE_KEY;if(!k||process.argv.some(x=>x.includes(k.trim())))process.exit(99);console.log(k);process.exit(23)";
    const exit=await withUpdaterFile(process.execPath,["scripts/macos-dmg-detach.mjs","run",process.execPath,"-e",check],
      {env:{PATH:process.env.PATH,HOME:f.home},stdout:{write(s){output+=s;}},stderr:{write(s){error+=s;}}});
    assert.equal(exit,23);assert.match(output,/\[REDACTED\]/);assert(!output.includes(secret));assert(!error.includes(secret));
    assert.equal(readFileSync(f.key,"utf8"),secret+"\n");
  }finally{f.close();}
});
