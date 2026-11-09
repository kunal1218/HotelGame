import * as THREE from 'three';
import { ApartmentEngine } from './engine.js';
import { createCity } from './city.js';
import { createLobby } from './lobby.js';
import './style.css';
import { createSessionUi } from './net/sessionUi.js';
let session;

const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
let engine, lobby, city, mode = 'golden', started = false, paused = false, closest = null;
const discovered = new Set();
const touchDevice = matchMedia('(pointer: coarse)').matches;
let detailTimeout, toastTimeout;
let audioContext, masterGain, audioEnabled = false;

function toast(message) {
  $('toast').textContent=message;show('toast');clearTimeout(toastTimeout);
  toastTimeout=setTimeout(()=>hide('toast'),4200);
}

function createAudio() {
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context) return false;
  audioContext=new Context();
  masterGain=audioContext.createGain();masterGain.gain.value=0;masterGain.connect(audioContext.destination);
  const buffer=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate);
  const samples=buffer.getChannelData(0);let last=0;
  for(let i=0;i<samples.length;i++){last=(last+(Math.random()*2-1)*.02)/1.02;samples[i]=last*3;}
  const noise=audioContext.createBufferSource();noise.buffer=buffer;noise.loop=true;
  const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=320;
  const noiseGain=audioContext.createGain();noiseGain.gain.value=.12;
  noise.connect(filter).connect(noiseGain).connect(masterGain);noise.start();
  // A soft, original ambient chord, synthesized locally.
  [130.81,196,261.63,329.63].forEach((frequency,index)=>{
    const oscillator=audioContext.createOscillator();oscillator.type='sine';oscillator.frequency.value=frequency;
    const gain=audioContext.createGain();gain.gain.value=.009/(1+index*.2);
    oscillator.connect(gain).connect(masterGain);oscillator.start();
  });
  return true;
}

async function toggleAudio() {
  if(!audioContext&&!createAudio()){toast('Ambient sound is unavailable in this browser.');return;}
  try{await audioContext.resume();audioEnabled=!audioEnabled;
    masterGain.gain.setTargetAtTime(audioEnabled?.7:0,audioContext.currentTime,.3);
    $('audio-slash').style.display=audioEnabled?'none':'';
    $('audio-toggle').setAttribute('aria-label',audioEnabled?'Mute ambient sound':'Enable ambient sound');
    $('audio-toggle').setAttribute('aria-pressed',String(audioEnabled));
    toast(audioEnabled?'The quiet hum of home. Sound on.':'Ambient sound off.');
  }catch{toast('Tap again to enable ambient sound.');}
}

function startExploring() {
  if(!engine)return;
  started=true;paused=false;
  document.body.classList.add('playing');hide('welcome');hide('pause-panel');
  show('crosshair');show('explore-hud');
  if(touchDevice)show('mobile-controls');
  engine.controller.setActive(true);engine.controller.requestLock();
  $('scene-status').textContent='Find the details that make it home.';
  updateProgress();
}

function pause() {
  if(!started||paused)return;
  paused=true;engine.controller.setActive(false);
  show('pause-panel');hide('crosshair');hide('interaction');hide('mobile-controls');hide('detail-card');
}

function updateProgress(){
  const total=lobby?.interactables.length||5;
  $('discovery-count').textContent=`${discovered.size} / ${total} DETAILS DISCOVERED ✳`;
  $('detail-progress').textContent=discovered.size===total?'YOU’VE MADE YOURSELF AT HOME.':`${discovered.size} OF ${total} DETAILS DISCOVERED`;
}

function interact(){
  if(!closest||paused||!started)return;
  const first=!discovered.has(closest.id);discovered.add(closest.id);
  $('detail-title').textContent=closest.label;
  $('detail-description').textContent=closest.description;
  $('detail-kicker').textContent=first?'A NEW MERIDIAN DISCOVERY':'A FAVOURITE CORNER';
  updateProgress();show('detail-card');clearTimeout(detailTimeout);
  detailTimeout=setTimeout(()=>hide('detail-card'),11000);
  if(['fireplace','elevators'].includes(closest.id))session.request('toggle',closest.id==='fireplace'?1:2).then(result=>{if(!result.ok)toast(result.reason==='too_far'?'Move a little closer.':'Could not change that right now.');});
  if(first&&discovered.size===lobby.interactables.length)setTimeout(()=>toast('Five details. One place to call home. Keep exploring.'),900);
}

function updateMap(){
  const {x,z}=engine.camera.position;
  const px=20+(x+14)/28*160,py=17+(z+14)/28*102;
  $('map-player').setAttribute('transform',`translate(${px.toFixed(2)} ${py.toFixed(2)}) rotate(${-engine.controller.yaw*180/Math.PI})`);
}

function updateProximity(){
  if(!started||paused){closest=null;hide('interaction');return;}
  let distance=Infinity;closest=null;
  for(const item of lobby.interactables){
    const p=item.position;
    const d=Math.hypot(engine.camera.position.x-p.x,engine.camera.position.z-p.z);
    if(d<(item.radius||2.6)&&d<distance){closest=item;distance=d;}
  }
  if(closest){
    $('interaction-label').textContent=(discovered.has(closest.id)?'Revisit ':'Discover ')+closest.label;
    show('interaction');
  }else hide('interaction');
}

function bindControls(){
  $('resume-button').addEventListener('click',startExploring);
  $('reset-button').addEventListener('click',async()=>{const result=await session.request('return_to_entrance');if(result.ok){hide('detail-card');startExploring();}else toast('The entrance is occupied. Try again shortly.');});
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();if(started)pause();});
  $('audio-toggle').addEventListener('click',toggleAudio);
  $('time-toggle').addEventListener('click',()=>{
    mode=mode==='golden'?'blue':'golden';engine.setTime(mode);city.setTime(mode);
    $('time-name').textContent=mode==='golden'?'Golden hour':'Blue hour';
    $('time-toggle').setAttribute('aria-label',`Switch to ${mode==='golden'?'blue':'golden'} hour`);
    $('time-toggle').setAttribute('aria-pressed',String(mode==='blue'));
    toast(mode==='golden'?'The city, in a softer light.':'Evening settles over Meridian.');
  });
  const help=$('help-dialog');let resumeAfterHelp=false;
  $('help-button').addEventListener('click',()=>{
    resumeAfterHelp=started&&!paused;if(resumeAfterHelp)pause();help.showModal();
  });
  help.querySelector('.dialog-close').addEventListener('click',()=>help.close());
  help.addEventListener('click',e=>{if(e.target===help&&e.clientX<help.getBoundingClientRect().left)help.close();});
  help.addEventListener('close',()=>{if(resumeAfterHelp){paused=true;show('pause-panel');}resumeAfterHelp=false;});
  $('close-detail').addEventListener('click',()=>hide('detail-card'));
  $('interaction').addEventListener('click',interact);
  $('mobile-interact').addEventListener('click',interact);
  $('mobile-pause').addEventListener('click',pause);
  addEventListener('keydown',e=>{if(e.code==='KeyE'&&!e.repeat&&!help.open)interact();});
  engine.controller.onPause=pause;
  const joystick=$('joystick'),knob=$('joystick-knob');let stickId=null;
  const stickMove=e=>{
    if(e.pointerId!==stickId)return;
    const r=joystick.getBoundingClientRect();let x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;
    const length=Math.hypot(x,y),max=32;if(length>max){x=x/length*max;y=y/length*max;}
    knob.style.transform=`translate(${x}px,${y}px)`;engine.controller.moveInput.set(x/max,y/max);
  };
  joystick.addEventListener('pointerdown',e=>{stickId=e.pointerId;joystick.setPointerCapture(stickId);stickMove(e);});
  joystick.addEventListener('pointermove',stickMove);
  const resetStick=()=>{stickId=null;knob.style.transform='';engine.controller.moveInput.set(0,0);};
  joystick.addEventListener('pointerup',resetStick);joystick.addEventListener('pointercancel',resetStick);
  if(touchDevice)document.querySelector('.intro-controls').innerHTML='<span>Touch controls available · Move with the stick, drag to look</span>';
}

async function init(){
  try {
    engine=new ApartmentEngine($('scene'));
    city=createCity(THREE,engine.scene);lobby=createLobby(THREE,engine.scene);
    if(city.update)engine.updaters.push(city.update);if(lobby.update)engine.updaters.push(lobby.update);
    bindControls();
    session=createSessionUi({engine,lobby,toast,onJoined:startExploring,onLeft:()=>{
      started=false;paused=false;engine.controller.setActive(false);
      document.body.classList.remove('playing');show('welcome');hide('pause-panel');hide('crosshair');hide('explore-hud');hide('interaction');hide('mobile-controls');hide('detail-card');
    }});
    let frameCount=0,fpsTimer=0,uiTimer=0,baseYaw=engine.camera.rotation.y;
    let qualitySamples=0,qualityTime=0,adapted=false;
    engine.start((dt,time)=>{
      session.frame();
      frameCount++;fpsTimer+=dt;uiTimer+=dt;
      if(!started&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        engine.camera.rotation.y=baseYaw+Math.sin(time*.085)*.028;
        engine.controller.yaw=engine.camera.rotation.y;
      }
      if(uiTimer>.1){updateMap();updateProximity();uiTimer=0;}
      if(fpsTimer>1){$('fps').textContent=`${Math.round(frameCount/fpsTimer)} FPS`;frameCount=0;fpsTimer=0;}
      if(!adapted&&time>3){qualitySamples++;qualityTime+=dt;
        if(qualitySamples>90){
          if(qualitySamples/qualityTime<34){engine.renderer.setPixelRatio(1);engine.sun.shadow.mapSize.set(1024,1024);engine.sun.shadow.map?.dispose();engine.sun.shadow.map=null;}
          adapted=true;
        }
      }
    });
    // Wait until the first rendered frames before dismissing the loading cover.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      $('loader').style.opacity='0';setTimeout(()=>hide('loader'),700);
    }));
    addEventListener('pagehide',event=>{if(!event.persisted){session.dispose();engine.dispose();}});
  } catch(error) {
    console.error('Meridian initialization failed:',error);hide('loader');show('error');
  }
}

init();
