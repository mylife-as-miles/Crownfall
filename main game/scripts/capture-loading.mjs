import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { waitForBootReady } from './boot-helpers.mjs';
const directory='artifacts/loading'; await mkdir(directory,{recursive:true});
const bytes=await readFile('public/models/crownfall-sorcerer.glb');
const plans=new Map();const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const server=createServer(async(req,res)=>{
 const plan=plans.get(req.url);
 if(!plan){res.writeHead(404,{'Access-Control-Allow-Origin':'*'});res.end('Unavailable character fixture');return;}
 res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':'model/gltf-binary','Cache-Control':'no-store',...(plan.known?{'Content-Length':bytes.length}:{})});
 res.write(bytes.subarray(0,1048576));plan.started.resolve();await plan.release.promise;
 if(!res.destroyed)res.end(bytes.subarray(1048576));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const fixture=`http://127.0.0.1:${server.address().port}`;
const makePlan=(name,known=true)=>{const plan={known,started:deferred(),release:deferred()};plans.set(`/${name}.glb`,plan);return{...plan,source:`${fixture}/${name}.glb`}};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const target=model=>{const u=new URL(process.env.CROWNFALL_TEST_URL||'http://localhost:4173');u.searchParams.set('model',model);return u.href};
const captures=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('crownfall.main-game.preferences',JSON.stringify({quality:'high',motion:false,volume:65})));
 const known=makePlan('known');await page.goto(target(known.source));await known.started.promise;
 await page.waitForFunction(()=>document.querySelector('.loading-status-line')?.textContent.includes('MB'));
 await page.evaluate(()=>document.fonts.ready);
 const shot=async(name,viewport)=>{await page.setViewportSize(viewport);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const path=`${directory}/${name}-${viewport.width}x${viewport.height}.png`;await page.screenshot({path});captures.push({path,viewport});console.log(path)};
 for(const viewport of[{width:1280,height:720},{width:1920,height:1080},{width:844,height:390}])await shot('loading',viewport);
 known.release.resolve();await waitForBootReady(page);await shot('menu-ready',{width:1280,height:720});
 const unknown=makePlan('unknown',false);await page.goto(target(unknown.source));await unknown.started.promise;
 await page.waitForFunction(()=>document.querySelector('.loading-progress--indeterminate')&&document.fonts.status==='loaded');
 await shot('unknown-length',{width:1280,height:720});unknown.release.resolve();
 await page.goto(target(`${fixture}/missing.glb`));await page.getByRole('button',{name:'Continue to menu',exact:true}).waitFor();
 for(const viewport of[{width:1280,height:720},{width:844,height:390}])await shot('recovery',viewport);
 await page.getByRole('button',{name:'Continue to menu',exact:true}).click();await waitForBootReady(page);
 await page.close();
 const context=await browser.newContext({viewport:{width:960,height:540},reducedMotion:'no-preference',recordVideo:{dir:'/tmp/crownfall-loading-recording',size:{width:960,height:540}}});
 const recording=await context.newPage();recording.on('pageerror',e=>errors.push(e.message));
 await recording.addInitScript(()=>localStorage.setItem('crownfall.main-game.preferences',JSON.stringify({quality:'low',motion:true,renderScale:50,frameLimit:30,volume:65})));
 const handoff=makePlan('handoff');await recording.goto(target(handoff.source));await handoff.started.promise;
 await recording.getByRole('region',{name:'Crownfall loading screen',exact:true}).waitFor();
 await recording.waitForTimeout(1800);handoff.release.resolve();await waitForBootReady(recording);
 await recording.screenshot({path:`${directory}/recording-final-frame.png`});await recording.waitForTimeout(2500);
 const video=recording.video();await context.close();const raw=await video.path();
 const encoded=spawnSync('ffmpeg',['-y','-loglevel','error','-i',raw,'-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-crf','34','-b:v','0','-an',`${directory}/loading-handoff.webm`],{encoding:'utf8'});if(encoded.status!==0)throw Error(encoded.stderr);
 await writeFile(`${directory}/captures.json`,JSON.stringify({captures,errors,modelBytes:bytes.length,progress:'Actual supplied GLB streamed at a real 1MiB boundary before completion; no synthetic percentage. Unknown-length and missing-model states use actual corresponding responses.',recording:{file:`${directory}/loading-handoff.webm`,viewport:{width:960,height:540},renderer:'Actual supplied GLB, Low particles, 50% scene resolution,30fps cap for software capture. Full untrimmed video; physical GPU performance is unbenchmarked.'},artDirectionReference:'https://carleaf.artstation.com/ (composition inspiration only; no external artwork imported)'},null,2)+'\n');
 if(errors.length)throw Error(errors.join('\n'));
}finally{for(const p of plans.values())p.release.resolve();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
