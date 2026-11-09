import { startServer } from '../server/main.js';
import { parseConfig } from '../server/config.js';
import { createNetClient } from '../src/net/netClient.js';
import { connectWebSocket } from '../src/net/wsConnect.js';
import { stepMotion } from '../src/shared/sim/motion.js';
import { MAP } from '../src/shared/sim/map.js';
const samples=[];
const server=await startServer(parseConfig({PORT:'0'}),{host:'127.0.0.1',log:{info(event,data){if(event==='room_stats')samples.push(data);},warn(){},error(event,data){console.error(event,data);}}});
const bots=[];let timer;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let room=null;
  for(let i=0;i<5;i++){
    const client=createNetClient({name:`Bench ${i}`,room,nowMs:()=>performance.now(),open:()=>connectWebSocket(`ws://127.0.0.1:${server.port}/ws`)});
    const started=performance.now();
    while(client.status()==='connecting'){if(performance.now()-started>3000)throw new Error('Join timeout');await pause(10);}
    if(client.status()!=='joined')throw new Error(client.reason());room=client.self().room;
    bots.push({client,state:{...client.frame(performance.now()).selfJump,vx:0,vz:0},frameTimes:[]});
  }
  timer=setInterval(()=>{
    for(const [i,bot] of bots.entries()){
      const input={mx:0,mz:-1,yaw:Math.sin(performance.now()/2000+i)*Math.PI,pitch:.123456,sprint:false};
      bot.state=stepMotion(bot.state,input,MAP[0]).state;bot.client.recordMotion(input,bot.state.x,bot.state.z);
      const start=performance.now(),frame=bot.client.frame(start);bot.frameTimes.push(performance.now()-start);
      if(frame.selfJump)bot.state={...frame.selfJump,vx:0,vz:0};
    }
  },1000/60);
  await pause(21000);
  console.log(JSON.stringify({roomSamples:samples,clients:bots.map(b=>{b.frameTimes.sort((a,c)=>a-c);return {...b.client.stats(),frameP99Ms:b.frameTimes[Math.floor(b.frameTimes.length*.99)]};})},null,2));
}finally{clearInterval(timer);bots.forEach(b=>b.client.close());await server.close();}
