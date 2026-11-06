import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fixture} from './fixture.mjs';
import {Gateway} from '../gateway/gateway.mjs';

test('management relay stays available while its target disconnects and reconnects', {timeout:90000}, async t=>{
  const management=await fixture(), business=await fixture();
  t.after(()=>{management.close();business.close()});
  const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const root=resolve('.tmp/desktop-transport');await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,'control-'));const exe=join(dir,'local-api-websocket-proxy.exe');
  await copyFile(resolve('build/local-api-websocket-proxy.exe'),exe);
  for(const file of ['startup.ps1','supervise.ps1']) await copyFile(resolve(file),join(dir,file));
  const token=randomBytes(32).toString('hex');
  await writeFile(join(dir,'management.json'),JSON.stringify({port,token,controlUrl:management.configuration.controlUrl}));
  await writeFile(join(dir,'startup.json'),JSON.stringify({taskName:'Control test '+process.pid}));
  await writeFile(join(dir,'proxy.json'),JSON.stringify({proxies:[{id:1,name:'Local Test',...business.configuration,enabled:false}]}));
  const app=spawn(exe,[],{cwd:dir,windowsHide:true,stdio:'ignore'});t.after(()=>app.kill());
  const gateway=new Gateway(management.serverUrl);t.after(()=>gateway.close());await gateway.ready();
  const call=(method,path,auth=token)=>gateway.request({method,path,headers:[{name:'Authorization',value:'Bearer '+auth}],body:Buffer.alloc(0)});
  assert.equal((await call('GET','/v1/proxies','wrong')).status,401);
  async function state(){const r=await call('GET','/v1/proxies');assert.equal(r.status,200);return JSON.parse(r.body)[0];}
  assert.equal((await state()).enabled,false);
  for(const action of ['connect','reconnect','disconnect','connect']){
    assert.equal((await call('POST','/v1/proxies/1/'+action)).status,200);
    const enabled=action!=='disconnect';const deadline=Date.now()+12000;
    while(Date.now()<deadline && (await state()).enabled!==enabled) await new Promise(r=>setTimeout(r,100));
    assert.equal((await state()).enabled,enabled);
  }
  const data=new Gateway(business.serverUrl);t.after(()=>data.close());await data.ready();
  assert.equal((await data.request({method:'GET',path:'/echo',headers:[],body:Buffer.alloc(0)})).status,201);
});
