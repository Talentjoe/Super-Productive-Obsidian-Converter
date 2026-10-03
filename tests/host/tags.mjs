/** Real tagged-child regression in an already configured, isolated 19.1.0 host. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.tmp/host'), vault=path.join(root,'vault');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);
assert.ok(page.url().toLowerCase().startsWith('file:///'+root.replaceAll('\\','/').toLowerCase()+'/'),'Only the isolated host is allowed');
try {
  if(!await page.locator('iframe').count())await page.getByText('Obsidian 同步',{exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  const frame=page.frames().find(frame=>frame.parentFrame());
  const rpc=(command,data={})=>frame.evaluate(({command,data})=>new Promise((resolve,reject)=>{
    const messageId=crypto.randomUUID(),timeout=setTimeout(()=>{removeEventListener('message',handler);reject(Error('RPC timeout'));},120000);
    function handler(event){if(event.source!==parent||event.data?.messageId!==messageId)return;clearTimeout(timeout);removeEventListener('message',handler);event.data.type==='PLUGIN_MESSAGE_ERROR'?reject(Error(event.data.error)):resolve(event.data.result);}
    addEventListener('message',handler);parent.postMessage({type:'PLUGIN_MESSAGE',messageId,message:{command,...data}},'*');
  }),{command,data});
  const host=(method,...args)=>frame.evaluate(({method,args})=>PluginAPI[method](...args),{method,args});
  let status=await rpc('status');assert.equal(path.resolve(status.config.vaultPath),vault);
  await rpc('save-config',{config:{...status.config,paused:true}});
  const sync=async()=>{await rpc('save-config',{config:{...status.config,paused:false}});try{return await rpc('sync');}finally{await rpc('save-config',{config:{...status.config,paused:true}});}};
  const fixturePath=path.join(root,'tags-fixture.json');
  let fixture=await fs.readFile(fixturePath,'utf8').then(JSON.parse,()=>null);
  const existing=await host('getTasks');
  if(!fixture||!fixture.doneChild||!fixture.openChild||fixture.ids.some(id=>!existing.some(task=>task.id===id))){
    const projectId=status.config.projectIds.includes('INBOX_PROJECT')?'INBOX_PROJECT':status.config.projectIds[0];assert.ok(projectId);
    const tagList=await host('getAllTags'), tags={};
    for(const title of ['Explore','Grad','Task'])tags[title]=tagList.find(tag=>tag.title===title)?.id||await host('addTag',{title});
    const parent=await host('addTask',{projectId,title:'尝试联系导师 · 标签回归'});
    const doneChild=await host('addTask',{parentId:parent,title:'已完成子任务 · 标签回归',notes:'已完成任务正文'});
    const openChild=await host('addTask',{parentId:parent,title:'未完成子任务 · 标签回归',notes:'原始正文'});
    const gpu=await host('addTask',{projectId,title:'开发父任务 · 标签回归'});
    const barrier=await host('addTask',{parentId:gpu,title:'耗时子任务 · 标签回归',timeEstimate:3600000});
    await host('updateTask',parent,{tagIds:[tags.Explore,tags.Grad]});await host('updateTask',gpu,{tagIds:[tags.Task]});
    await host('updateTask',doneChild,{tagIds:[tags.Grad],isDone:true});await host('updateTask',openChild,{tagIds:[tags.Grad],isDone:false});await host('updateTask',barrier,{tagIds:[tags.Task]});
    fixture={projectId,tags,parent,doneChild,openChild,gpu,barrier,ids:[parent,doneChild,openChild,gpu,barrier]};await fs.writeFile(fixturePath,JSON.stringify(fixture,null,2));
  }
  const result=await sync();
  if(process.env.SP_EXPECT_TAG_REJECTION==='1'){
    for(const id of [fixture.doneChild,fixture.openChild,fixture.barrier])assert.ok(result.issues.some(issue=>issue.taskId===id&&issue.message.includes('差异字段：tags')));
    console.log('Old installed ZIP reproduced all three native child tags readback failures');
  }else{
    assert.deepEqual(result.issues,[]);
    const readState=async()=>JSON.parse(await fs.readFile(path.join(vault,'Super Productivity/.sp-sync/state.json'),'utf8'));
    const state=await readState(),taskFile=path.join(vault,state.projects[fixture.projectId].directory,'tasks.md');
    let markdown=await fs.readFile(taskFile,'utf8');assert.ok(!markdown.includes('[sp-notes::'));
    for(const id of fixture.ids)assert.ok(markdown.includes(`[[${state.notesPaths[id].slice(0,-3)}|笔记]]`));
    const checkTags=async()=>{const tasks=await host('getTasks');for(const [id,tag] of [[fixture.doneChild,'Grad'],[fixture.openChild,'Grad'],[fixture.barrier,'Task']])assert.deepEqual(tasks.find(task=>task.id===id).tagIds,[fixture.tags[tag]]);};
    await checkTags();
    const note=state.notesPaths[fixture.openChild],notePath=path.join(vault,note);
    const target=`[[${note.slice(0,-3)}|笔记]]`;
    markdown=markdown.replace(target,`[sp-notes:: [[${note.slice(0,-3)}]]]`);
    const title=(await host('getTasks')).find(task=>task.id===fixture.openChild).title;
    markdown=markdown.replace(`- [ ] ${title} `,`- [x] ${title} `);
    await fs.writeFile(taskFile,markdown);await fs.writeFile(notePath,'---\ncustom: true\n---\n多段正文\n\n第二段 notes\n');
    assert.deepEqual((await sync()).issues,[]);await checkTags();
    const latest=(await host('getTasks')).find(task=>task.id===fixture.openChild);assert.equal(latest.isDone,true);assert.equal(latest.notes,'多段正文\n\n第二段 notes\n');
    assert.equal((await readState()).notesPaths[fixture.openChild],note);assert.equal(await fs.readFile(notePath,'utf8'),'---\ncustom: true\n---\n多段正文\n\n第二段 notes\n');
    markdown=await fs.readFile(taskFile,'utf8');assert.ok(markdown.includes(target));assert.ok(!markdown.includes('[sp-notes::'));
    const childLine=markdown.split('\n').find(line=>line.includes(`sp:task:${fixture.openChild} `));
    await fs.writeFile(taskFile,markdown.split('\n').filter(line=>line!==childLine).join('\n')+'\n'+childLine.trimStart()+'\n');
    assert.deepEqual((await sync()).issues,[]);await checkTags();assert.ok(!(await host('getTasks')).find(task=>task.id===fixture.openChild).parentId);
    const lines=(await fs.readFile(taskFile,'utf8')).split('\n'),rootLine=lines.find(line=>line.includes(`sp:task:${fixture.openChild} `));
    const remaining=lines.filter(line=>line!==rootLine),parentIndex=remaining.findIndex(line=>line.includes(`sp:task:${fixture.parent} `));
    remaining.splice(parentIndex+1,0,'  '+rootLine);await fs.writeFile(taskFile,remaining.join('\n'));
    assert.deepEqual((await sync()).issues,[]);await checkTags();assert.equal((await host('getTasks')).find(task=>task.id===fixture.openChild).parentId,fixture.parent);
    const manifest=JSON.parse(await fs.readFile('manifest.json','utf8'));
    const results=['原生已完成／未完成子任务独立标签保留，读回验证通过','笔记链接简写、旧字段迁移、ID／路径／YAML／多段正文保持通过','子任务完成及提升／重新关联后标签保留通过'];
    await fs.writeFile(path.join(root,'tags-acceptance.json'),JSON.stringify({version:manifest.version,host:'19.1.0',at:new Date().toISOString(),results},null,2));
    console.log(results.join('\n'));
  }
}finally{await browser.close();}
