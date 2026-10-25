import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle, waitForDialogClosed } from './motion-helpers.mjs';
const directory='artifacts/chapters';await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const captures=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('crownfall.main-game.preferences',JSON.stringify({quality:'high',motion:false,volume:65})));
 await page.goto(process.env.CROWNFALL_TEST_URL||'http://localhost:4173');await waitForBootReady(page);
 const shot=async(name,viewport)=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const path=`${directory}/${name}-${viewport.width}x${viewport.height}.png`;await page.screenshot({path});captures.push({path,viewport});console.log(path)};
 await shot('play-before',{width:1280,height:720});
 await page.getByRole('button',{name:'Chapters',exact:true}).click();await waitForMenuIdle(page);
 await page.locator('.chapters-grid').evaluate(grid=>Promise.all([...grid.querySelectorAll('img')].map(img=>img.decode())));
 for(const viewport of[{width:1280,height:720},{width:1920,height:1080},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.keyboard.press('Home');await shot('grid',viewport);
  await page.keyboard.press('End');await page.keyboard.press('Enter');await shot('locked-selected',viewport);
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Chapter 02',exact:true}).waitFor();await shot('chapter02-preview',viewport);
  await page.getByRole('button',{name:/Back to Chapters/}).click();await waitForDialogClosed(page);
 }
 await page.getByRole('button',{name:'Back',exact:true}).click();await waitForMenuIdle(page);await shot('play-after',{width:844,height:390});await page.close();
 const context=await browser.newContext({viewport:{width:960,height:540},reducedMotion:'no-preference',recordVideo:{dir:'/tmp/crownfall-chapters-recording',size:{width:960,height:540}}});
 const motion=await context.newPage();motion.on('pageerror',e=>errors.push(e.message));
 await motion.addInitScript(()=>localStorage.setItem('crownfall.main-game.preferences',JSON.stringify({quality:'low',motion:true,renderScale:50,frameLimit:30,volume:65})));
 await motion.goto(process.env.CROWNFALL_TEST_URL||'http://localhost:4173');await waitForBootReady(motion);
 await motion.getByRole('button',{name:'Chapters',exact:true}).click();await waitForMenuIdle(motion);await motion.waitForTimeout(650);
 for(const key of['ArrowRight','ArrowDown','ArrowDown','ArrowRight','Enter']){await motion.keyboard.press(key);await motion.waitForTimeout(300);}
 await motion.keyboard.press('Home');await motion.keyboard.press('ArrowRight');await motion.keyboard.press('Enter');await motion.waitForTimeout(700);
 await motion.getByRole('button',{name:/Back to Chapters/}).click();await waitForDialogClosed(motion);await motion.waitForTimeout(400);
 await motion.keyboard.press('Escape');await waitForMenuIdle(motion);
 await motion.screenshot({path:`${directory}/recording-final-frame.png`});await motion.waitForTimeout(2200);
 const video=motion.video();await context.close();const raw=await video.path();
 const encoded=spawnSync('ffmpeg',['-y','-loglevel','error','-i',raw,'-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-crf','34','-b:v','0','-an',`${directory}/chapters-flow.webm`],{encoding:'utf8'});if(encoded.status!==0)throw Error(encoded.stderr);
 await writeFile(`${directory}/captures.json`,JSON.stringify({captures,errors,reference:'279178.jpg — user-supplied 5+5+4 chapter layout (reference not bundled)',rendering:'Actual supplied GLB. Static captures use high particles and reduced motion. Full untrimmed960x540 flow recording uses Low particles,50% scene resolution and30fps scene cap for software capture; target-device frame performance is unbenchmarked.',recording:`${directory}/chapters-flow.webm`},null,2)+'\n');
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close()}
