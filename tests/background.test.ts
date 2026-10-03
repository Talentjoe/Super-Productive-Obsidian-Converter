import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeHost } from './fakes';
import { defaultConfig, type SyncConfig, type HostAPI } from '../src/types';

const fixture=vi.hoisted(()=>({ scans:0, syncs:0 }));
vi.mock('../src/adapters/vault',()=>({ NodeVault:class { async fingerprint(){fixture.scans++;return 'unchanged';} } }));
vi.mock('../src/core/engine',()=>({ SyncEngine:class {
  running=false; issues=[]; state={metadata:{},removed:{},lastSync:null as string|null};
  constructor(public api:unknown, public io:{fingerprint():Promise<string>},public config:SyncConfig){}
  async initialize(){} dispose(){}
  async sync(){fixture.syncs++;this.state.lastSync=new Date().toISOString();}
} }));
let unload:()=>void, ready:()=>void|Promise<void>, message:(data:unknown)=>Promise<any>, hooks:Record<string,()=>void>;
beforeEach(()=>{
  vi.useFakeTimers();vi.resetModules();fixture.scans=0;fixture.syncs=0;hooks={};
  const host:HostAPI=new FakeHost();
  host.onReady=(fn)=>{ready=fn;};host.onUnload=(fn)=>{unload=fn;};host.onMessage=(fn)=>{message=fn;};host.registerHook=(name,fn)=>{hooks[name]=fn;};
  vi.stubGlobal('PluginAPI',host);
});
afterEach(()=>{unload?.();vi.useRealTimers();vi.unstubAllGlobals();});
async function start(extra:Partial<SyncConfig>={}){
  const config={...defaultConfig(),vaultPath:'vault',projectIds:['p1'],...extra};
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify(config),setItem:()=>{}});
  await import('../src/background');await ready();
}
it('coalesces rapid task changes until the configured delay and allows immediate sync',async()=>{
  await start({syncDelaySeconds:60});
  await vi.advanceTimersByTimeAsync(9000);hooks.anyTaskUpdate();
  await vi.advanceTimersByTimeAsync(9000);hooks.anyTaskUpdate();
  expect(fixture.syncs).toBe(0);
  await message({command:'sync'});expect(fixture.syncs).toBe(1);
  await vi.advanceTimersByTimeAsync(61000);expect(fixture.syncs).toBe(1);
});
it('checks files at the configured interval instead of launching a process every 2 seconds',async()=>{
  await start();await vi.advanceTimersByTimeAsync(10000);expect(fixture.syncs).toBe(1);
  const scans=fixture.scans;
  await vi.advanceTimersByTimeAsync(29000);expect(fixture.scans).toBe(scans);
  await vi.advanceTimersByTimeAsync(1000);expect(fixture.scans).toBe(scans+1);
  await vi.advanceTimersByTimeAsync(20000);expect(fixture.scans).toBe(scans+1);expect(fixture.syncs).toBe(1);
});
it('migrates old settings and stops pending work when paused',async()=>{
  await start({syncDelaySeconds:undefined,fileCheckSeconds:undefined});
  const status=await message({command:'status'});
  expect(status.config).toMatchObject({syncDelaySeconds:10,fileCheckSeconds:30});
  await message({command:'save-config',config:{...status.config,paused:true,fileCheckSeconds:120}});
  await vi.advanceTimersByTimeAsync(150000);expect(fixture.syncs).toBe(0);expect(fixture.scans).toBe(0);
});
