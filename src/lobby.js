import { MAP, Level } from './shared/sim/map.js';
/** A procedural apartment lobby. Dimensions are metres; +Y is up. */
export function createLobby(THREE, scene) {
  const root = new THREE.Group(); root.name = 'Meridian · lobby'; scene.add(root);
  const colliders = MAP[Level.LOBBY].colliders, interactables = [], flames = [], elevatorDoors = [];
  let fireOn = true, elevatorOpen = false, elevatorProgress = 0;
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 24);
  const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
  const materials = {};
  const mat = (name, color, roughness = .7, extra = {}) => materials[name] ||= new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const cream = mat('limestone', '#d5cdb8', .84);
  const plaster = mat('plaster', '#e4dfce', .95);
  const warm = mat('ivory', '#c3b69e', .85);
  const oak = mat('walnut', '#5c3e2b', .62);
  const oakEdge = mat('oak edge', '#986d44', .6);
  const bronze = mat('brass', '#9a7950', .32, { metalness: .76 });
  const black = mat('charcoal', '#242a26', .55);
  const leaf = mat('leaves', '#36563a', .85, { side: THREE.DoubleSide });
  const leafLight = mat('leaves light', '#5b7444', .86, { side: THREE.DoubleSide });
  const fabric = mat('olive upholstery', '#72775b', .93);
  const ivoryFabric = mat('ivory upholstery', '#c7bda5', .96);
  const terracotta = mat('terracotta', '#9b573b', .83);
  const ceramic = mat('ceramic', '#d6c7a7', .45);
  const darkCeramic = mat('green ceramic', '#32463c', .35);
  const glow = mat('warm light', '#ffe6ba', .35, { emissive: '#ffd6a0', emissiveIntensity: 2.0 });
  const coolGlass = new THREE.MeshPhysicalMaterial({ color: '#bdcfc4', roughness: .06, metalness: .08, transparent: true, opacity: .075, depthWrite: false });
  function box(x, y, z, w, h, d, material, cast = true, parent = root) {
    const mesh = new THREE.Mesh(boxGeometry, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function cylinder(x, y, z, radius, height, material, parent = root, topRadius = radius) {
    let mesh;
    if (topRadius === radius) { mesh = new THREE.Mesh(cylinderGeometry, material); mesh.scale.set(radius, height, radius); }
    else mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, radius, height, 24), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const marker = (id, label, description, x, y, z, radius = 3) => interactables.push({ id, label, description, position: new THREE.Vector3(x, y, z), radius });
  let seed = 1973;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function canvasTexture(size, paint) {
    const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  const floorTexture = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#c8c3ad'; ctx.fillRect(0, 0, s, s);
    for (let i=0; i<8000; i++) { const v = Math.floor(165+random()*60); ctx.fillStyle = `rgba(${v},${v-7},${v-20},${random()*.09})`; ctx.fillRect(random()*s, random()*s, 2+random()*12, .7+random()*1.8); }
    for(let i=0; i<9; i++) { ctx.strokeStyle = 'rgba(132,122,98,.045)'; ctx.lineWidth = 2+random()*5; ctx.beginPath(); const x=random()*s; ctx.moveTo(x,0); ctx.bezierCurveTo(x+100,s*.3,x-60,s*.7,x+40,s); ctx.stroke(); }
    ctx.strokeStyle = '#ada791'; ctx.lineWidth = 1.5; ctx.strokeRect(0,0,s,s);
  });
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping; floorTexture.repeat.set(14,14);
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: .33, metalness: .035 });
  const darkStoneTexture = canvasTexture(512, (ctx,s) => {
    ctx.fillStyle='#34463e'; ctx.fillRect(0,0,s,s);
    for(let i=0;i<28;i++){const x=random()*s;ctx.strokeStyle=`rgba(183,186,149,${.08+random()*.15})`;ctx.lineWidth=.4+random()*2;ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x-60,180,x+180,300,x+80,s);ctx.stroke();}
  });
  const darkStone = new THREE.MeshStandardMaterial({ map: darkStoneTexture, roughness: .34, metalness: .05 });
  function sign(text, x, y, z, width, height, options = {}) {
    const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=Math.max(128, Math.round(1024*height/width));
    const ctx=canvas.getContext('2d'); ctx.fillStyle=options.background || '#e2ddcb'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle=options.color || '#494f40'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=`${options.weight || 400} ${options.fontSize || Math.round(canvas.height*.58)}px ${options.font || 'Georgia'}`;
    if(options.spacing){ const chars=[...text], size=ctx.measureText(text).width+(chars.length-1)*options.spacing; let px=(canvas.width-size)/2;ctx.textAlign='left';for(const ch of chars){ctx.fillText(ch,px,canvas.height/2);px+=ctx.measureText(ch).width+options.spacing;} }
    else ctx.fillText(text,canvas.width/2,canvas.height/2);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:texture,roughness:.7})); mesh.position.set(x,y,z); root.add(mesh); return mesh;
  }
  function roundedGeometry(w,h,d,r=.13) {
    r=Math.min(r,w/2,h/2); const shape=new THREE.Shape(); const x=-w/2,y=-h/2;
    shape.moveTo(x+r,y); shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
    const g=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:2,steps:1,curveSegments:5});g.translate(0,0,-d/2);return g;
  }
  function rounded(x,y,z,w,h,d,material,r=.13,parent=root) { const m=new THREE.Mesh(roundedGeometry(w,h,d,r),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m; }
  function orb(x,y,z,sx,sy,sz,material,parent=root) { const m=new THREE.Mesh(sphereGeometry,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m; }
  function stemBetween(a,b,r,material,parent=root) { const direction=new THREE.Vector3().subVectors(b,a);const m=cylinder(0,0,0,r,direction.length(),material,parent);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return m; }

  // Architecture: a travertine plinth, generous glazing, and a timber coffered ceiling.
  box(0,-.12,0,28,.24,28,floorMaterial,false);
  box(0,7.24,0,28,.25,28,plaster,false);
  box(0,3.6,-14,28,7.2,.28,plaster,false);
  box(14,3.6,0,.28,7.2,28,warm,false);
  box(-14,.17,0,.3,.34,28,cream,false);
  box(0,.16,14,28,.32,.28,cream,false);
  // Window posts are intentionally slender so the skyline remains visible.
  for (let z=-14;z<=14;z+=4) {
    box(-13.88,3.55,z,.11,7.1,.1,bronze,false);
    if(z<14) box(-13.94,3.55,z+2,.035,6.7,3.9,coolGlass,false);
  }
  for (let x=-14;x<=14;x+=3.5) {
    box(x,3.55,13.88,.1,7.1,.11,bronze,false);
    if(x<14) box(x+1.75,3.55,13.94,3.4,6.7,.035,coolGlass,false);
  }
  box(-13.88,3.8,0,.14,.12,28,bronze,false); box(0,3.8,13.88,28,.12,.14,bronze,false);
  for (const x of [-12,-3,4,12]) {
    box(x,7.04,0,.23,.34,28,oak,false);
    box(x+.16,6.91,0,.045,.025,27.8,glow,false);
  }
  for(let z=-12;z<=12;z+=3) box(0,7.03,z,27.7,.3,.14,oak,false);
  // Structural piers with refined brass skirting.
  for(const [x,z] of [[-12,-9],[-12,7],[11.5,-10],[11.5,8]]) {
    box(x,3.6,z,.65,7.2,.65,cream);box(x,.12,z,.7,.24,.7,bronze);
  }
  box(0,.06,-10.9,27.5,.015,.025,bronze,false);
  box(-2.5,.06,0,.025,.015,28,bronze,false);
  box(3,.06,0,.025,.015,28,bronze,false);

  // Elevator core, recessed bronze portals, and engraved identity.
  box(0,3.05,-13.74,7.7,6.1,.35,oak);
  for(let x=-3.7;x<3.8;x+=.25) box(x,3.05,-13.51,.055,6.1,.12,oakEdge,false);
  for(const x of [-1.85,1.85]) {
    box(x,2.1,-13.36,2.98,4.2,.26,black);
    box(x,2.1,-13.18,2.7,4.02,.08,mat('elevator interior','#b8ab8d',.6,{emissive:'#b6a17b',emissiveIntensity:.15}));
    box(x,1.1,-13.11,2.52,.04,.04,bronze,false);
    for(const direction of [-1,1]) {
      const door=box(x+direction*.675,2.05,-13.08,1.335,3.92,.04,mat('elevator metal','#716b59',.34,{metalness:.78}));
      elevatorDoors.push({mesh:door,center:x,direction});
    }
    sign(x<0?'↑  01':'02  ↓',x,4.55,-13.38,1.1,.28,{background:'#5c3e2b',color:'#e5c58e',font:'Arial',fontSize:105});
    box(x,4.15,-13.07,2.5,.035,.03,glow,false);
  }
  cylinder(.01,1.25,-13.04,.035,.08,glow).rotation.x=Math.PI/2;
  sign('M E R I D I A N',0,5.6,-13.39,5.3,.6,{background:'#5c3e2b',color:'#decaa3',fontSize:80});
  marker('elevators','The residences','Above the lobby, 24 floors of city living. Our bronze elevator portals are framed by fluted walnut and warm limestone.',0,1.6,-12.8,3.2);

  // The lounge: tailored olive sofas and a low sculptural table.
  const rugTexture=canvasTexture(512,(ctx,s)=>{
    ctx.fillStyle='#9c947b';ctx.fillRect(0,0,s,s);
    for(let i=0;i<9000;i++){ctx.fillStyle=random()>.5?'rgba(238,227,193,.11)':'rgba(69,70,52,.08)';ctx.fillRect(random()*s,random()*s,1,5);}
    ctx.strokeStyle='#bcb39a';ctx.lineWidth=3;ctx.strokeRect(28,28,s-56,s-56);ctx.strokeRect(36,36,s-72,s-72);
    ctx.beginPath();ctx.moveTo(130,0);ctx.lineTo(130,s);ctx.moveTo(142,0);ctx.lineTo(142,s);ctx.stroke();
  });
  const rug = new THREE.MeshStandardMaterial({map:rugTexture,roughness:1});box(-7.4,.025,-2.9,9,.025,8.8,rug,false);
  function sofa(x,z,rotation=0,material=fabric,w=4.0) {
    const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;root.add(g);
    rounded(0,.42,0,w,.32,1.55,oak,.1,g);
    rounded(0,.66,-.06,w-.16,.3,1.38,material,.13,g);
    rounded(0,1.03,.61,w,.93,.27,material,.15,g);
    rounded(-w/2+.1,.84,0,.25,.67,1.5,material,.1,g);rounded(w/2-.1,.84,0,.25,.67,1.5,material,.1,g);
    for(const xx of [-w/2+.3,w/2-.3]) for(const zz of [-.5,.5]) cylinder(xx,.17,zz,.045,.32,bronze,g);
    for(const xx of [-w*.28,w*.27]){ const c=rounded(xx,1.0,.25,.66,.59,.19,ivoryFabric,.14,g);c.rotation.z=xx<0?.12:-.1;c.rotation.x=-.12; }
  }
  sofa(-7.3,.3,0);sofa(-11,-3.3,-Math.PI/2,fabric,3.6);
  sofa(-4.35,-4.8,Math.PI/2,ivoryFabric,1.2);
  sofa(-5.1,-6.3,Math.PI*.8,ivoryFabric,1.2);
  const coffee=rounded(-7.5,.48,-3.1,3.55,.12,1.75,cream,.8);coffee.rotation.y=.1;
  cylinder(-8.35,.24,-3.1,.4,.45,oak);cylinder(-6.7,.24,-3.1,.4,.45,oak);
  // Books, a shallow bowl, and a hand-thrown ceramic vase.
  box(-8.2,.575,-3.3,.8,.075,.58,terracotta);const book=box(-8.1,.65,-3.24,.76,.065,.52,cream);book.rotation.y=.13;
  box(-8.1,.688,-3.24,.64,.008,.49,oak,false);
  cylinder(-6.7,.59,-3.0,.28,.065,darkCeramic);cylinder(-6.7,.63,-3.0,.25,.02,black);
  vase(-7.4,.56,-3.45,.32,ceramic);
  marker('lounge','The residents’ lounge','A place for slow mornings and good conversation. Olive upholstery, hand-thrown ceramics, and a collection of art and architecture books.',-7.4,1,-2,3.5);
  // Side tables and a linen-shaded reading lamp.
  cylinder(-4.55,.4,-.15,.54,.08,oak);cylinder(-4.55,.2,-.15,.18,.4,black);
  vase(-4.55,.46,-.15,.42,terracotta);
  cylinder(-10.1,.05,.6,.35,.09,bronze);cylinder(-10.1,1.2,.6,.03,2.3,bronze);
  cylinder(-10.1,2.35,.6,.49,.5,ivoryFabric,root,.32);cylinder(-10.1,2.08,.6,.34,.015,glow);

  // Reception: green stone, fine timber fins, and an illuminated welcome.
  rounded(7.15,.69,-8.9,6.4,1.35,1.65,oak,.15);
  for(let x=4.1;x<10.3;x+=.16) box(x,.7,-7.99,.055,1.26,.07,oakEdge,false);
  rounded(7.15,1.41,-8.9,6.65,.12,1.83,darkStone,.16);
  box(7.15,.13,-7.98,6.2,.045,.03,glow,false);
  box(6.5,1.67,-8.95,.7,.42,.06,black);box(6.5,1.44,-8.88,.35,.03,.3,black);
  const monitor=box(6.5,1.67,-8.91,.62,.34,.015,mat('screen','#afc0ab',.5,{emissive:'#afc0ab',emissiveIntensity:.22}));
  box(5.65,1.51,-8.55,.42,.08,.3,bronze);vase(8.8,1.48,-8.9,.6,ceramic);
  sign('WELCOME HOME',7.3,4.5,-13.8,4.6,.58,{background:'#e4dfce',color:'#5a634e',font:'Georgia',fontSize:73});
  sign('THE CITY OUTSIDE. YOUR WORLD WITHIN.',7.3,3.93,-13.8,4.7,.24,{background:'#e4dfce',color:'#767960',font:'Arial',fontSize:40});
  marker('reception','Welcome to Meridian','Your home in the heart of the city. Take a look around the lobby, discover the art collection, and settle into the residents’ lounge.',7,1.6,-7.7,3.3);

  // Abstract original artwork, layered against the limestone gallery wall.
  const artTexture=canvasTexture(1024,(ctx,s)=>{
    ctx.fillStyle='#c9bea0';ctx.fillRect(0,0,s,s);ctx.fillStyle='#354b40';ctx.beginPath();ctx.arc(s*.52,s*.46,s*.31,Math.PI,0);ctx.lineTo(s*.83,s*.91);ctx.lineTo(s*.21,s*.91);ctx.fill();
    ctx.fillStyle='#a1583f';ctx.beginPath();ctx.arc(s*.29,s*.38,s*.24,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d7bd85';ctx.fillRect(s*.47,s*.1,s*.14,s*.7);
    ctx.strokeStyle='#efe1bc';ctx.lineWidth=8;for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(s*.62,s*.65,s*(.11+i*.055),Math.PI,Math.PI*2);ctx.stroke();}
    for(let i=0;i<18000;i++){ctx.fillStyle=random()>.5?'rgba(255,244,204,.035)':'rgba(24,37,24,.025)';ctx.fillRect(random()*s,random()*s,2,2);}
  });
  box(-8,3.7,-13.65,5.55,4.6,.15,oak);box(-8,3.7,-13.53,5.37,4.42,.05,cream);
  const artMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.12,4.18),new THREE.MeshStandardMaterial({map:artTexture,roughness:.93}));artMesh.position.set(-8,3.7,-13.48);root.add(artMesh);
  sign('S O L S T I C E   /   1 9 7 3',-8,1.02,-13.8,3.4,.21,{background:'#e4dfce',color:'#5c6353',font:'Arial',fontSize:48});
  marker('art','Solstice, 1973','An original study in balance: terracotta, forest green, and sun-washed gold. The lobby’s palette takes its cue from this abstract composition.',-8,1.7,-12.5,3.3);

  // A full-height library wall and a fireplace framed in honed stone.
  box(13.72,3.45,0,.35,6.9,19,oak);
  box(13.42,1.42,-.3,.36,2.85,4.9,cream);box(13.18,1.48,-.3,.12,1.76,3.75,black);
  box(13.05,.57,-.3,.42,.18,4.0,darkStone);
  // Ember bed and individually moving flame ribbons face into the room.
  const ember = mat('embers','#d77b30',.65,{emissive:'#e65f12',emissiveIntensity:1.5});
  for(let i=0;i<14;i++) {
    const z=-1.9+i*.245;const f=orb(13.02,.77,z,.04,.1+random()*.17,.08,ember);flames.push({mesh:f,phase:random()*Math.PI*2,scale:f.scale.y});
    if(i%2===0){const log=cylinder(13.02,.67,z,.065,.45,oak);log.rotation.x=Math.PI/2;log.rotation.z=.2;}
  }
  const fireplaceLight = new THREE.PointLight('#ffb864', 4, 5, 2);fireplaceLight.position.set(12.6,1,-.3);root.add(fireplaceLight);
  marker('fireplace','Fireside','A warm welcome, all year round. An intimate fireside corner with a curated library of design, photography, and the city’s stories.',11.6,1.4,-.3,3.1);
  // Floating shelves above and beside the stone fireplace.
  for(const z of [-6.6,6.0]) {
    box(13.35,3.35,z,.72,6.4,3.35,black);
    for(const y of [1,2.5,4,5.5]) {
      box(13.0,y,z,1,.1,3.4,oakEdge);
      let bz=z-1.35;
      for(let j=0;j<7;j++) {
        const h=.38+random()*.48,w=.12+random()*.12;
        const color=[cream,terracotta,darkCeramic,ivoryFabric,oakEdge][j%5];
        if(j<5)box(12.98,y+.07+h/2,bz,.42,h,w,color);bz+=w+.055;
      }
      if(y===2.5||y===5.5) vase(12.95,y+.05,z+.75,.52,y===2.5?ceramic:terracotta);
    }
  }
  // Fireplace mantel sculpture: a soft stone loop.
  const loop=new THREE.Mesh(new THREE.TorusGeometry(.42,.12,12,40),ceramic);loop.rotation.y=Math.PI/2;loop.position.set(13,3.25,-.3);root.add(loop);
  box(13,2.85,-.3,.42,.08,1.15,bronze);
  // Two accent chairs create a second, smaller conversation nook.
  sofa(8.3,1.7,-Math.PI/2,ivoryFabric,1.35);sofa(8.3,-2.3,-Math.PI/2,ivoryFabric,1.35);
  cylinder(10.15,.54,-.35,.7,.1,darkStone);cylinder(10.15,.27,-.35,.25,.52,bronze);
  box(10.15,.635,-.35,.55,.065,.4,terracotta);

  // Pendant group: floating brass halos with a warm luminous underside.
  for(const [x,z,r,drop] of [[0,-3.3,1.9,1.6],[.3,-3.1,1.2,2.25],[-.15,-3.3,.62,2.85]]) {
    const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.044,8,64),bronze);ring.rotation.x=Math.PI/2;ring.position.set(x,7.1-drop,z);root.add(ring);
    const under=new THREE.Mesh(new THREE.TorusGeometry(r,.025,8,64),glow);under.rotation.x=Math.PI/2;under.position.set(x,7.065-drop,z);root.add(under);
    for(let n=0;n<3;n++){const a=n*Math.PI*2/3;cylinder(x+Math.cos(a)*r,7.1-drop/2,z+Math.sin(a)*r,.008,drop,bronze);}
  }
  const pendantLight=new THREE.PointLight('#ffdda1',8,16,2);pendantLight.position.set(0,4.8,-3.3);root.add(pendantLight);
  for(const [x,z] of [[7,-9],[-8,-11],[9,4]]) {
    cylinder(x,6.9,z,.32,.05,bronze);cylinder(x,6.86,z,.25,.04,glow);
  }

  // Sculptural greenery breaks up the straight architectural lines.
  function vase(x,base,z,h,material) {
    cylinder(x,base+h*.37,z,h*.22,h*.74,material,root,h*.17);
    cylinder(x,base+h*.84,z,h*.10,h*.22,material,root,h*.12);
    cylinder(x,base+h*.955,z,h*.11,.015,black);
    return h;
  }
  const leafGeometry=new THREE.SphereGeometry(1,10,6);
  function plant(x,z,height=2.8,radius=.48) {
    cylinder(x,.35,z,radius,.7,ceramic,root,radius*.82);cylinder(x,.7,z,radius*.77,.015,mat('soil','#333226',1));
    const positions=[], scales=[], rotations=[];
    for(let branch=0;branch<6;branch++) {
      const a=branch*Math.PI*2/6+random()*.5, spread=.35+random()*.55, y=.7+(height-.7)*(.65+random()*.35);
      const tip=new THREE.Vector3(x+Math.cos(a)*spread,y,z+Math.sin(a)*spread);
      stemBetween(new THREE.Vector3(x,.65,z),tip,.018,oak);
      for(let j=0;j<6;j++) {
        const side=j%2?1:-1, t=.35+j*.105, px=x+(tip.x-x)*t, py=.65+(tip.y-.65)*t, pz=z+(tip.z-z)*t;
        const angle=a+side*1.1, length=.35+random()*.28;
        positions.push(new THREE.Vector3(px+Math.cos(angle)*length*.4,py+.1,pz+Math.sin(angle)*length*.4));
        scales.push(new THREE.Vector3(length,.055,.16+random()*.08)); rotations.push(new THREE.Euler(0,-angle,.25*side));
      }
    }
    const leaves = new THREE.InstancedMesh(leafGeometry,leaf,positions.length);const dummy=new THREE.Object3D();
    positions.forEach((pos,i)=>{dummy.position.copy(pos);dummy.scale.copy(scales[i]);dummy.rotation.copy(rotations[i]);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);leaves.setColorAt(i,new THREE.Color(i%3?'#456143':'#6c7e48'));});leaves.castShadow=true;root.add(leaves);
  }
  plant(-11.5,-11.6,3.6,.55);plant(-12,4.8,3.15,.58);plant(10.9,-11.9,3.25,.58);plant(11.4,5.5,2.8,.5);plant(-3.8,-10.8,2.5,.43);
  // Flower stems at reception and coffee table.
  for(const [x,y,z,h] of [[8.8,2.02,-8.9,1.0],[-7.4,.88,-3.45,.4]]) {
    for(let i=0;i<6;i++){const a=i*2.4,tx=x+Math.sin(a)*h*.25,tz=z+Math.cos(a)*h*.25,ty=y+h*(.6+random()*.4);stemBetween(new THREE.Vector3(x,y,z),new THREE.Vector3(tx,ty,tz),.007,leafLight);orb(tx,ty,tz,.09*h,.055*h,.08*h,ivoryFabric);}
  }

  // The entry mat, mailboxes, and small wayfinding details complete the building.
  box(0,.02,10.8,4.2,.025,2.7,mat('entry rug','#646957',1),false);
  sign('M',0,.04,10.8,1,1,{background:'#646957',color:'#bfc2a7',font:'Georgia',fontSize:620}).rotation.x=-Math.PI/2;
  box(13.65,1.7,10.6,.4,2.4,3.45,bronze);
  for(let row=0;row<4;row++)for(let col=0;col<5;col++) {
    box(13.4,.85+row*.52,9.3+col*.63,.08,.48,.59,mat('mail bronze','#80714e',.42,{metalness:.6}),false);
    box(13.34,.9+row*.52,9.3+col*.63,.025,.03,.22,black,false);
  }
  // Interior perimeter colliders include the glazed entry and protect the city shell.
  root.traverse(object => { if(object.isMesh && !object.name) object.name='Lobby detail'; });
  return {
    group: root, colliders, interactables,
    setSharedState(state) {
      fireOn=state.fireOn;elevatorOpen=state.elevatorOpen;
      for(const f of flames)f.mesh.visible=fireOn;
    },
    interact(id) {
      if(id==='fireplace') {
        fireOn=!fireOn;for(const f of flames)f.mesh.visible=fireOn;
        return fireOn?'The fire is now lit.':'The fire is now off.';
      }
      if(id==='elevators') { elevatorOpen=!elevatorOpen;return elevatorOpen?'The elevator doors are opening.':'The elevator doors are closing.'; }
      return null;
    },
    update(time,dt=.016) {
      for(const f of flames) f.mesh.scale.y=f.scale*(.78+.22*Math.sin(time*5+f.phase)+.07*Math.sin(time*11+f.phase));
      fireplaceLight.intensity=fireOn?3.7+Math.sin(time*6)*.25:0;
      elevatorProgress=THREE.MathUtils.damp(elevatorProgress,elevatorOpen?1:0,3,dt);
      for(const door of elevatorDoors) {
        door.mesh.position.x=door.center+door.direction*(.675+.58*elevatorProgress);
        door.mesh.scale.x=1.335*(1-.88*elevatorProgress);
      }
    }
  };
}
