import { waitForBootReady } from "./boot-helpers.mjs";
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const directory='artifacts/settings';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const captures=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('crownfall.main-game.preferences',JSON.stringify({quality:'high',motion:false,volume:65})));
 await page.goto(process.env.CROWNFALL_TEST_URL||'http://localhost:5173');
 await page.locator('.creature-model--loaded').waitFor({timeout:90000});
 await waitForBootReady(page);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.creature-model')).opacity==='1');
 await page.evaluate(()=>document.fonts.ready);
 const shot=async(name)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const path=`${directory}/${name}.png`;await page.screenshot({path});captures.push({path,viewport:page.viewportSize()});console.log(path);};
 await shot('play-1280x720');
 await page.getByRole('tab',{name:'Home',exact:true}).click();await shot('home-1280x720');
 await page.getByRole('tab',{name:'Settings',exact:true}).click();await shot('grid-1280x720');
 for (const name of ['General','Controls','Input','Video','Audio','Credits']){
  await page.getByRole('button',{name,exact:true}).click();await shot(`${name.toLowerCase()}-1280x720`);
  await page.keyboard.press('Escape');
 }
 await page.setViewportSize({width:1920,height:1080});await shot('grid-1920x1080');
 await page.setViewportSize({width:844,height:390});await shot('grid-844x390');
 for (const name of ['General','Controls','Input','Video','Audio','Credits']){
  await page.getByRole('button',{name,exact:true}).click();await shot(`${name.toLowerCase()}-844x390`);
  await page.keyboard.press('Escape');
 }
 await writeFile(`${directory}/screenshots.json`,JSON.stringify({captures,errors,rendering:'Actual supplied GLB, static reduced-motion pose, high particles, default 100% render scale'},null,2)+'\n');
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
