/** Offline deployment contracts. No Docker daemon, network, application startup or real URLs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const frontend=read('../Dockerfile'),backend=read('../../backend/Dockerfile');
const guard=frontend.match(/^RUN node -e '(.*)'$/m)?.[1];

test('frontend production guard rejects missing, empty, local and malformed backend origins',()=>{
 assert.ok(guard);
 assert.match(frontend,/^ARG NEXT_PUBLIC_API_URL(=.*)?$/m);
 assert.ok(frontend.indexOf('RUN test -n "$NEXT_PUBLIC_API_URL"')<frontend.indexOf('RUN npm run build'));
 for(const url of [undefined,'','  ','http://example.invalid','https://localhost','https://127.0.0.2','https://[::1]','https://app.localhost','https://example.invalid/api','https://user:private@example.invalid','https://example.invalid?key=private','https://example.invalid/#fragment']){
  const env={};if(url!==undefined)env.NEXT_PUBLIC_API_URL=url;
  const result=spawnSync(process.execPath,['-e',guard],{env,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/HTTPS backend service origin/);
  assert.ok(!result.stderr.includes('private'));
 }
 for(const url of ['https://example.invalid','https://example.invalid/'])assert.equal(spawnSync(process.execPath,['-e',guard],{env:{NEXT_PUBLIC_API_URL:url}}).status,0);
});

test('Next proxy rewrites follow the configured backend and preserve local development default',async()=>{
 const source=ts.transpileModule(read('../next.config.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 for(const target of [undefined,'https://example.invalid/']){
  const exports={};vm.runInNewContext(source,{exports,process:{env:target?{NEXT_PUBLIC_API_URL:target}:{}}});
  const rewrites=await exports.default.rewrites();
  const base=target?'https://example.invalid':'http://127.0.0.1:8000';
  assert.equal(rewrites[0].destination,`${base}/api/:path*`);
  assert.equal(rewrites[1].destination,`${base}/health`);
  assert.equal(exports.default.output,'standalone');
 }
});

test('separate contexts contain every local COPY source and respect the existing Cloud Run commands',()=>{
 for(const path of ['requirements.txt','app','migrations','scripts'])assert.ok(fs.existsSync(new URL(`../../backend/${path}`,import.meta.url)));
 for(const path of ['package.json','package-lock.json','public'])assert.ok(fs.existsSync(new URL(`../${path}`,import.meta.url)));
 assert.match(backend,/uvicorn app\.main:app --host 0\.0\.0\.0 --port \$\{PORT:-8080\}/);
 assert.match(backend,/ffmpeg/);assert.match(backend,/libgl1/);assert.match(backend,/libglib2\.0-0/);
 assert.match(backend,/download\.pytorch\.org\/whl\/cpu/);
 assert.match(frontend,/ENV PORT=8080/);assert.match(frontend,/ENV HOSTNAME="0\.0\.0\.0"/);
 assert.match(frontend,/CMD \["node", "server\.js"\]/);
 assert.match(frontend,/\.next\/standalone/);
 const instructions=new Set(['FROM','RUN','ENV','WORKDIR','COPY','EXPOSE','CMD','USER','ARG']);
 for(const dockerfile of [backend,frontend]){
  const lines=dockerfile.replace(/\\\n/g,' ').split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#'));
  for(const line of lines){assert.ok(instructions.has(line.split(/\s/)[0]));if(line.startsWith('CMD '))assert.ok(Array.isArray(JSON.parse(line.slice(4))));}
 }
});

test('contexts exclude environment, signing keys, caches and local backend storage',()=>{
 for(const file of ['../.dockerignore','../../backend/.dockerignore']){
  const lines=read(file).split('\n').map(l=>l.trim());
  for(const pattern of ['.env*','.git','*.log','*.pem','*.key'])assert.ok(lines.includes(pattern));
 }
 const backendIgnore=read('../../backend/.dockerignore');
 for(const pattern of ['storage/','.venv','__pycache__','*.db','*.sqlite*','*.mp4','*.wav'])assert.ok(backendIgnore.split('\n').includes(pattern));
});
