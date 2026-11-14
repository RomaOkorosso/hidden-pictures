import process from 'node:process';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { getDatabase, ref, get, update, set } from 'firebase/database';
if (process.env.RELEASE_SMOKE_PROJECT !== 'hidden-pictures-11613') throw new Error('Explicit authorized release target required: RELEASE_SMOKE_PROJECT=hidden-pictures-11613');
const values = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(x=>/^VITE_FIREBASE_[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const config = { apiKey:values.VITE_FIREBASE_API_KEY, authDomain:values.VITE_FIREBASE_AUTH_DOMAIN, databaseURL:values.VITE_FIREBASE_DATABASE_URL, projectId:values.VITE_FIREBASE_PROJECT_ID, appId:values.VITE_FIREBASE_APP_ID };
assert.equal(config.projectId,'hidden-pictures-11613');
assert.equal(new URL(config.databaseURL).hostname,'hidden-pictures-11613-default-rtdb.firebaseio.com');
const url='https://romaokorosso.github.io/hidden-pictures/';
const browser=await chromium.launch();
const players=[];
const read=async(p,path)=>(await get(ref(p.db,path))).val();
const denied=async promise=>assert.rejects(promise,/permission[ _]denied/i);
let roomId,code;
try {
 for(let i=0;i<4;i++){
  console.log('Registering synthetic release player', i+1);
  const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(25000);
  await page.goto(`${url}#/register`);
  await page.getByLabel('Имя за столом').fill(`Release QA ${i}`);
  const email=`release-${Date.now()}-${i}@example.test`,password=`QA-${randomUUID()}`;
  await page.getByLabel('Почта').fill(email);await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.getByRole('button',{name:'Создать комнату',exact:true}).waitFor();
  const app=initializeApp(config,`release-${i}-${Date.now()}`),auth=getAuth(app);await signInWithEmailAndPassword(auth,email,password);
  players.push({page,context,app,auth,db:getDatabase(app),uid:auth.currentUser.uid});
 }
 const host=players[0];await host.page.getByRole('button',{name:'Создать комнату',exact:true}).click();
 await host.page.locator('h1.code').waitFor();code=(await host.page.locator('h1.code').innerText()).trim();
 roomId=(await read(host,`roomCodes/${code}`)).roomId;
 assert.equal((await read(host,`rooms/${roomId}/meta`)).hostId,host.uid);
 for(const p of players.slice(1)){await p.page.getByLabel('Код',{exact:true}).fill(code);await p.page.getByRole('button',{name:'Войти по коду',exact:true}).click();await p.page.locator('h1.code').waitFor();}
 assert.deepEqual(Object.keys(await read(host,`rooms/${roomId}/members`)).sort(),players.map(p=>p.uid).sort());
 for(let i=0;i<4;i++){console.log('Assigning release team and role', i+1);const row=host.page.locator('.teams li').filter({hasText:`Release QA ${i}`});await row.locator('select').nth(0).selectOption(i%2?'blue':'red');if(i<2)await row.locator('select').nth(1).selectOption('captain');}
 async function deal(){await host.page.getByRole('button',{name:'Начать партию',exact:true}).click();let pending;for(let i=0;i<50;i++){pending=await read(host,`rooms/${roomId}/dealRequests/pending`);if(pending)break;await new Promise(r=>setTimeout(r,100));}const dealer=players.find(p=>p.uid===pending.initializer);await dealer.page.getByRole('button',{name:'Раздать ключ',exact:true}).click();for(const p of players)await p.page.locator('.board .tile').nth(19).waitFor();return read(host,`rooms/${roomId}/public`);}
 async function clue(team){const p=players[team==='red'?0:1].page;await p.getByLabel('Слово',{exact:true}).fill('релиз');await p.getByLabel('Число').selectOption('8');await p.getByRole('button',{name:'Подсказка',exact:true}).click();await p.locator('.clue-banner').waitFor();}
 async function reveal(team,pos){const p=players[team==='red'?2:3].page;await p.locator('.clue-banner').waitFor();await p.getByRole('listitem',{name:`Card ${pos+1}`,exact:true}).click();await p.getByRole('button',{name:'Открыть',exact:true}).click();for(const other of players)await other.page.getByRole('listitem',{name:`Card ${pos+1}`,exact:true}).locator('.veil').waitFor();}
 console.log('Starting four-player release match');
 let pub=await deal();const firstMatch=pub.matchId;
 const key=await read(host,`rooms/${roomId}/secret/${pub.matchId}`);assert.deepEqual(await read(players[1],`rooms/${roomId}/secret/${pub.matchId}`),key);
 await denied(read(players[2],`rooms/${roomId}/secret/${pub.matchId}`));
 await denied(update(ref(players[2].db,`rooms/${roomId}/members/${players[2].uid}`),{role:'captain'}));
 await denied(update(ref(players[2].db,`rooms/${roomId}/meta`),{status:'finished'}));
 await clue(pub.currentTeam);
 for(const [pos,role]of Object.entries(key.roles))if(role===pub.currentTeam)await reveal(pub.currentTeam,Number(pos));
 for(const p of players)await p.page.getByRole('heading',{name:/Победили/}).waitFor();
 assert.equal((await read(host,`rooms/${roomId}/public`)).winReason,'agents');console.log('Agent victory synchronized across four players');
 mkdirSync('.qa/release-evidence',{recursive:true});await host.page.evaluate(() => globalThis.scrollTo(0,0));await host.page.screenshot({path:'.qa/release-evidence/four-player-victory.png',fullPage:true});
 await host.page.getByRole('button',{name:'Новая партия',exact:true}).click();await host.page.locator('h1.code').waitFor();
 await denied(read(players[2],`rooms/${roomId}/secret/${firstMatch}`));
 pub=await deal();assert.notEqual(pub.matchId,firstMatch);const nextKey=await read(host,`rooms/${roomId}/secret/${pub.matchId}`);await clue(pub.currentTeam);const assassin=Number(Object.entries(nextKey.roles).find(([,r])=>r==='assassin')[0]);await reveal(pub.currentTeam,assassin);
 for(const p of players)await p.page.getByRole('heading',{name:/Победили/}).waitFor();assert.equal((await read(host,`rooms/${roomId}/public`)).winReason,'assassin');
 await host.page.evaluate(() => globalThis.scrollTo(0,0));await host.page.screenshot({path:'.qa/release-evidence/rematch-assassin.png',fullPage:true});
 await host.page.getByRole('button',{name:'Новая партия',exact:true}).click();await host.page.locator('h1.code').waitFor();
 for(const p of [...players.slice(1),host]){await p.page.locator('section').filter({has:p.page.locator('h1.code')}).getByRole('button',{name:'Выйти',exact:true}).click();await p.page.getByRole('button',{name:'Создать комнату',exact:true}).waitFor();}
 assert.equal(await read(host,`roomCodes/${code}`),null);
 for(const p of players){await set(ref(p.db,`profiles/${p.uid}`),null);await deleteUser(p.auth.currentUser);}
 const result={date:new Date().toISOString(),url,project:config.projectId,players:4,completed:['agents victory','rematch','assassin victory'],security:['guesser key denied','role escalation denied','forced finish denied','old key denied'],syntheticRoomRemoved:true,syntheticAccountsRemoved:true};
 writeFileSync('.qa/release-evidence/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} catch(error){console.error('Production smoke failed:',error.message);process.exitCode=1;}
finally{for(const p of players){await p.context.close();await deleteApp(p.app);}await browser.close();}
