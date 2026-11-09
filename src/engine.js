import * as THREE from 'three';
import { MAP, Level } from './shared/sim/map.js';
import { canOccupy } from './shared/sim/collision.js';
import { createMotionDriver } from './shared/sim/motionDriver.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Small reusable rendering engine: lifecycle, lighting, resizing and collision-aware camera. */
export class ApartmentEngine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc4b2a2, .003);
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .06, 650);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(3, 1.72, 10.5);
    this.camera.lookAt(-2, 2.15, -5);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, .04);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = .27;
    room.dispose(); pmrem.dispose();
    this.hemi = new THREE.HemisphereLight(0xffeed5, 0x78836c, 1.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd5a0, 3.5);
    this.sun.position.set(-25, 17, 15);
    this.sun.target.position.set(0, 0, -3);
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left = -23; shadow.camera.right = 23;
    shadow.camera.top = 23; shadow.camera.bottom = -23;
    shadow.camera.near = .5; shadow.camera.far = 100;
    shadow.bias = -.0004; shadow.normalBias = .025;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xffe5c6, 1.1);
    this.fill.position.set(0, 5, 13); this.scene.add(this.fill);
    this.insideLight = new THREE.PointLight(0xffd4a0, 75, 28, 2);
    this.insideLight.position.set(0, 5.4, -4); this.scene.add(this.insideLight);
    this.controller = new FirstPersonController(this.camera, canvas);
    this.updaters = [];
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.resize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', this.resize);
    this.disposed = false;
  }
  setTime(mode) {
    const blue = mode === 'blue';
    this.scene.fog.color.set(blue ? 0x71829a : 0xc4b2a2);
    this.hemi.color.set(blue ? 0xabc8f2 : 0xffeed5);
    this.hemi.intensity = blue ? 1.05 : 1.75;
    this.sun.color.set(blue ? 0xabc7f4 : 0xffd5a0);
    this.sun.intensity = blue ? .45 : 3.5;
    this.fill.intensity = blue ? .5 : 1.1;
    this.insideLight.intensity = blue ? 125 : 75;
    this.scene.environmentIntensity = blue ? .2 : .27;
    this.renderer.toneMappingExposure = blue ? 1.15 : 1.05;
  }
  start(onFrame) {
    this.renderer.setAnimationLoop(() => {
      if (this.disposed) return;
      const dt = Math.min(this.clock.getDelta(), .05);
      this.elapsed += dt;
      this.controller.update(dt, this.elapsed);
      this.updaters.forEach(fn => fn(this.elapsed, dt));
      onFrame?.(dt, this.elapsed);
      this.renderer.render(this.scene, this.camera);
    });
  }
  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    removeEventListener('resize', this.resize);
    this.controller.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material?.dispose());
    });
    this.environmentTarget.dispose(); this.renderer.dispose();
  }
}

export class FirstPersonController {
  constructor(camera, canvas) {
    this.camera = camera; this.canvas = canvas;
    this.active = false; this.keys = new Set();
    this.level = MAP[Level.LOBBY];
    this.motion = createMotionDriver(this.level, camera.position);
    this.onTick = null; this.runWhileInactive = false;
    this.velocity = new THREE.Vector2(); this.moveInput = new THREE.Vector2();
    this.radius = .32; this.eyeHeight = 1.72;
    this.yaw = camera.rotation.y; this.pitch = camera.rotation.x;
    this.locked = false; this.dragging = false; this.touchLookId = null;
    this.onPause = null;
    this.onKeyDown = e => {
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code) && this.active) {
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault(); this.keys.add(e.code);
      }
      if (e.code === 'Escape' && this.active && !document.pointerLockElement) this.onPause?.();
    };
    this.onKeyUp = e => this.keys.delete(e.code);
    this.onBlur = () => { this.keys.clear(); this.moveInput.set(0,0); if (this.active) this.onPause?.(); };
    this.onLock = () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (wasLocked && !this.locked && this.active) this.onPause?.();
    };
    this.onMouseMove = e => {
      if (this.active && (this.locked || this.dragging)) this.look(e.movementX, e.movementY);
    };
    this.onPointerDown = e => {
      if (!this.active || e.pointerType === 'touch') return;
      this.dragging = true;
      if (!this.locked) this.requestLock();
    };
    this.onPointerUp = () => {this.dragging = false;};
    this.onTouchStart = e => {
      if (!this.active) return;
      const touch = [...e.changedTouches].find(t => t.clientX > innerWidth * .36);
      if (touch) { this.touchLookId = touch.identifier; this.lastTouch = {x:touch.clientX,y:touch.clientY}; }
    };
    this.onTouchMove = e => {
      if (!this.active || this.touchLookId === null) return;
      const touch = [...e.changedTouches].find(t => t.identifier === this.touchLookId);
      if (!touch) return; e.preventDefault();
      this.look((touch.clientX-this.lastTouch.x)*1.6,(touch.clientY-this.lastTouch.y)*1.6);
      this.lastTouch = {x:touch.clientX,y:touch.clientY};
    };
    this.onTouchEnd = e => {if ([...e.changedTouches].some(t=>t.identifier===this.touchLookId)) this.touchLookId=null;};
    addEventListener('keydown', this.onKeyDown); addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur); document.addEventListener('pointerlockchange', this.onLock);
    addEventListener('mousemove', this.onMouseMove); canvas.addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('touchstart', this.onTouchStart, {passive:true});
    canvas.addEventListener('touchmove', this.onTouchMove, {passive:false});
    canvas.addEventListener('touchend', this.onTouchEnd); canvas.addEventListener('touchcancel', this.onTouchEnd);
  }
  requestLock() {
    if (matchMedia('(pointer: coarse)').matches) return;
    try { this.canvas.requestPointerLock?.()?.catch?.(()=>{}); } catch { /* Drag look remains available. */ }
  }
  look(dx,dy) { this.yaw -= dx*.002; this.pitch = THREE.MathUtils.clamp(this.pitch-dy*.002,-1.35,1.35); }
  setActive(active) {
    this.active=active; this.keys.clear(); this.velocity.set(0,0); this.moveInput.set(0,0); this.motion.stop();
    if (!active && document.pointerLockElement) document.exitPointerLock();
  }
  canOccupy(x,z) { return canOccupy(this.level,x,z,this.radius); }
  teleport(position) {
    this.motion.reset(position);this.camera.position.set(position.x,this.eyeHeight,position.z);this.velocity.set(0,0);
  }
  update(dt,time) {
    if (!this.active && !this.runWhileInactive) return;
    let x=0,z=0;
    if(this.active){
      if(this.keys.has('KeyW')||this.keys.has('ArrowUp'))z-=1;
      if(this.keys.has('KeyS')||this.keys.has('ArrowDown'))z+=1;
      if(this.keys.has('KeyA')||this.keys.has('ArrowLeft'))x-=1;
      if(this.keys.has('KeyD')||this.keys.has('ArrowRight'))x+=1;
      x+=this.moveInput.x;z+=this.moveInput.y;
    }
    const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
    const sprint=this.active&&(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'));
    const input={mx:x,mz:z,sprint,yaw:this.yaw,pitch:this.pitch};
    const state=this.motion.advance(dt,input,(state,command)=>this.onTick?.(state,command));
    this.velocity.set(state.vx,state.vz);
    const speed=this.velocity.length();
    const bob=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.sin(time*(sprint?12:9))*.016*Math.min(speed,1);
    this.camera.position.set(state.x,this.eyeHeight+(speed>.15?bob:0),state.z);
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
  }
  reset() {
    this.teleport(this.level.spawn);this.camera.lookAt(-2,2.15,-5);
    this.yaw=this.camera.rotation.y;this.pitch=this.camera.rotation.x;
    this.keys.clear();this.moveInput.set(0,0);
  }
  dispose() {
    removeEventListener('keydown',this.onKeyDown);removeEventListener('keyup',this.onKeyUp);
    removeEventListener('blur',this.onBlur);document.removeEventListener('pointerlockchange',this.onLock);
    removeEventListener('mousemove',this.onMouseMove);this.canvas.removeEventListener('pointerdown',this.onPointerDown);
    removeEventListener('pointerup',this.onPointerUp);
    this.canvas.removeEventListener('touchstart',this.onTouchStart);this.canvas.removeEventListener('touchmove',this.onTouchMove);
    this.canvas.removeEventListener('touchend',this.onTouchEnd);this.canvas.removeEventListener('touchcancel',this.onTouchEnd);
  }
}
