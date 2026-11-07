/** A complete, locally generated city. No image or model downloads are needed. */
export function createCity(THREE, scene) {
  const group = new THREE.Group();
  group.name = 'Meridian · surrounding city';
  scene.add(group);
  let seed = 71;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .83, ...extra });
  const concrete = material('#b7afa0');
  const lightStone = material('#d2c9b6');
  const darkStone = material('#535f60');
  const brick = material('#927568');
  const road = material('#575b59');
  const pavement = material('#afa99b');
  const trim = material('#d2c9b9');
  const metal = material('#344442', { metalness: .55, roughness: .45 });
  const windows = material('#7d999b', { roughness: .27, metalness: .42, emissive: '#2d474b', emissiveIntensity: .12 });
  const litWindows = material('#e1c28b', { emissive: '#ffc36e', emissiveIntensity: .24, roughness: .42 });
  const leaves = material('#52624a');
  const trunk = material('#71604a');
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const batches = new Map();
  const box = (mat, x, y, z, w, h, d, ry = 0) => {
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push({ x, y, z, w, h, d, ry });
  };

  // A city block around the lobby; the actual apartment remains unobstructed.
  box(road, 0, -.43, 0, 580, .45, 580);
  box(pavement, 0, -.13, 0, 43, .18, 43);
  box(concrete, 0, -.19, 22, 43, .3, .22);
  box(concrete, -22, -.19, 0, .22, .3, 43);
  box(concrete, 22, -.19, 0, .22, .3, 43);
  const stripe = material('#c1b99b');
  for (let i = -12; i <= 12; i++) {
    box(stripe, -28, -.195, i * 7, .15, .012, 3);
    box(stripe, 28, -.195, i * 7, .15, .012, 3);
    box(stripe, i * 7, -.195, 29, 3, .012, .15);
  }
  for (let i = 0; i < 7; i++) {
    box(lightStone, -28, -.19, 18 + i * .9, 7, .015, .42);
    box(lightStone, 18 + i * .9, -.19, 29, .42, .015, 7);
  }
  // Tactile pavement grid, visible through the floor-to-ceiling glazing.
  for (let i = -10; i <= 10; i++) {
    box(concrete, i * 2, -.032, 19.1, .022, .005, 3.8);
    box(concrete, -19.1, -.032, i * 2, 3.8, .005, .022);
  }

  function building(x, z, w, d, h, style = 0) {
    const facade = [lightStone, concrete, brick, darkStone][style % 4];
    box(facade, x, h / 2, z, w, h, d);
    box(metal, x, h + .15, z, w + .3, .3, d + .3);
    box(concrete, x + w * .12, h + 1, z - d * .17, w * .5, 1.8, d * .4);
    box(metal, x - w * .24, h + .65, z + d * .18, w * .18, 1.1, d * .2);
    const floorH = style === 3 ? 4 : 3.3;
    const floors = Math.floor((h - 2) / floorH);
    const columns = Math.max(2, Math.floor(w / 3.1));
    const sideColumns = Math.max(2, Math.floor(d / 3.1));
    for (let f = 0; f < floors; f++) {
      const y = 2 + f * floorH;
      // Thin slabs divide floors, making surrounding apartment buildings legible.
      box(trim, x, y - 1.15, z, w + .14, .12, d + .14);
      for (let c = 0; c < columns; c++) {
        const xx = x - w / 2 + (c + .5) * w / columns;
        for (const sign of [-1, 1]) {
          const mat = random() > .76 ? litWindows : windows;
          box(mat, xx, y, z + sign * (d / 2 + .025), w / columns * .64, floorH * .62, .045);
          box(metal, xx, y, z + sign * (d / 2 + .055), .045, floorH * .64, .04);
          if (style === 0 && c % 2 === 0 && f > 0) {
            const bz = z + sign * (d / 2 + .58);
            box(trim, xx, y - 1.1, bz, w / columns * .87, .16, 1.15);
            box(metal, xx, y - .5, bz + sign * .5, w / columns * .87, .055, .055);
            for (let r = -1; r <= 1; r++) box(metal, xx + r * .74, y - .8, bz + sign * .5, .035, .6, .035);
          }
        }
      }
      for (let c = 0; c < sideColumns; c++) {
        const zz = z - d / 2 + (c + .5) * d / sideColumns;
        for (const sign of [-1, 1]) {
          box(random() > .8 ? litWindows : windows, x + sign * (w / 2 + .025), y, zz, .045, floorH * .62, d / sideColumns * .64);
          box(metal, x + sign * (w / 2 + .055), y, zz, .04, floorH * .64, .045);
        }
      }
    }
    // Street level storefronts, awnings and planted roof terraces.
    for (let c = 0; c < columns; c++) {
      const xx = x - w / 2 + (c + .5) * w / columns;
      box(windows, xx, 1.5, z + d / 2 + .06, w / columns * .83, 2.6, .05);
      box(metal, xx, 3.02, z + d / 2 + .65, w / columns * .98, .13, 1.2);
    }
    if (style === 0 || style === 2) {
      for (let c = -1; c <= 1; c++) {
        box(lightStone, x + c * w * .25, h + .45, z + d * .34, w * .18, .6, .9);
        box(leaves, x + c * w * .25, h + 1, z + d * .34, w * .17, .75, .85);
      }
    }
  }

  building(-46, -8, 22, 26, 43, 0);
  building(-48, 35, 25, 22, 57, 2);
  building(-49, -53, 25, 24, 73, 3);
  building(47, 2, 22, 26, 48, 0);
  building(43, 48, 24, 23, 68, 1);
  building(5, 55, 24, 22, 39, 0);
  building(-9, -52, 25, 24, 62, 2);
  building(45, -47, 21, 24, 85, 3);
  // Layered skyline: much cheaper windows in the distance.
  for (let ring = 0; ring < 2; ring++) {
    const count = ring === 0 ? 18 : 24;
    const radius = ring === 0 ? 135 : 230;
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + .1;
      const x = Math.cos(a) * (radius + random() * 18);
      const z = Math.sin(a) * (radius + random() * 18);
      const w = 13 + random() * 21;
      const d = 13 + random() * 20;
      const h = 30 + random() * (ring ? 100 : 75);
      const mat = i % 3 === 0 ? concrete : darkStone;
      box(mat, x, h / 2, z, w, h, d);
      box(metal, x, h + .5, z, w * .6, 1, d * .6);
      for (let y = 4; y < h - 1; y += 4) {
        box(windows, x, y, z + d / 2 + .03, w * .87, 1.6, .05);
        box(windows, x, y, z - d / 2 - .03, w * .87, 1.6, .05);
        box(windows, x + w / 2 + .03, y, z, .05, 1.6, d * .87);
        box(windows, x - w / 2 - .03, y, z, .05, 1.6, d * .87);
      }
      if (i % 7 === 0) box(metal, x, h + 5, z, .2, 10, .2);
    }
  }

  const treeGeometry = new THREE.IcosahedronGeometry(1, 1);
  const treeMatrices = [];
  const tree = (x, z, scale = 1) => {
    box(trunk, x, 1.8 * scale, z, .22 * scale, 3.6 * scale, .22 * scale);
    box(lightStone, x, .2, z, 2.2, .45, 2.2);
    box(darkStone, x, .44, z, 2, .03, 2);
    treeMatrices.push([x, 4.2 * scale, z, 1.8 * scale, 2.1 * scale, 1.65 * scale]);
    treeMatrices.push([x - .8 * scale, 3.9 * scale, z + .2, 1.4 * scale, 1.5 * scale, 1.3 * scale]);
    treeMatrices.push([x + .7 * scale, 4.6 * scale, z - .2, 1.2 * scale, 1.5 * scale, 1.3 * scale]);
  };
  for (const z of [-15, -5, 7, 18]) { tree(-19.5, z, .85); tree(19.5, z, .85); }
  tree(-9, 19.5, .9); tree(9, 19.5, .9);
  const dummy = new THREE.Object3D();
  const trees = new THREE.InstancedMesh(treeGeometry, leaves, treeMatrices.length);
  treeMatrices.forEach((v, i) => { dummy.position.set(...v.slice(0, 3)); dummy.scale.set(...v.slice(3)); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix); });
  trees.castShadow = false;
  group.add(trees);
  // A few quiet details at human scale outside.
  for (const x of [-18, 18]) {
    box(metal, x, 2.8, 12, .1, 5.6, .1);
    box(metal, x, 5.55, 12.35, .12, .12, .8);
    box(litWindows, x, 5.48, 12.68, .35, .06, .45);
    box(metal, x, .55, -9, 1.9, .1, .7);
    box(trunk, x, .63, -9, 1.9, .13, .7);
    box(metal, x - .65, .25, -9, .12, .5, .62);
    box(metal, x + .65, .25, -9, .12, .5, .62);
  }
  // Flush material instances turn thousands of details into a dozen draw calls.
  for (const [mat, instances] of batches) {
    const mesh = new THREE.InstancedMesh(boxGeometry, mat, instances.length);
    mesh.name = 'City architecture';
    instances.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.scale.set(item.w, item.h, item.d);
      dummy.rotation.set(0, item.ry, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  const skyUniforms = {
    topColor: { value: new THREE.Color('#728d9b') },
    horizonColor: { value: new THREE.Color('#e6b998') },
    lowerColor: { value: new THREE.Color('#c4b2a2') },
    sunColor: { value: new THREE.Color('#ffe7b6') },
    sunDirection: { value: new THREE.Vector3(-.84, .21, .5).normalize() },
    time: { value: 0 },
    sunStrength: { value: 1 },
  };
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: `varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 topColor, horizonColor, lowerColor, sunColor, sunDirection;
      uniform float time, sunStrength;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
      void main() {
        vec3 d = normalize(vDirection);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizonColor, topColor, pow(clamp(h * 1.6,0.,1.),.65));
        col = mix(col, lowerColor, 1.-smoothstep(-.2,0.,d.y));
        float sun = dot(d, sunDirection);
        col += sunColor * pow(max(sun,0.),9.) * .14 * sunStrength;
        col = mix(col, sunColor, smoothstep(.9993,.99965,sun) * .88 * sunStrength);
        vec2 uv = d.xz / max(d.y+.15,.12) * 2.;
        float n = noise(uv*.6+vec2(time*.0004,0.))*.6+noise(uv*1.7)*.28+noise(uv*4.)*.12;
        float cloud = smoothstep(.57,.76,n) * smoothstep(.05,.25,d.y) * (1.-smoothstep(.6,.85,d.y));
        col = mix(col, mix(horizonColor,vec3(1.),.35),cloud*.32);
        gl_FragColor = vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(490, 32, 16), skyMaterial);
  sky.name = 'Procedural city skybox';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);

  function setTime(mode = 'golden') {
    const blue = mode === 'blue';
    skyUniforms.topColor.value.set(blue ? '#263e68' : '#728d9b');
    skyUniforms.horizonColor.value.set(blue ? '#bf9ea6' : '#e6b998');
    skyUniforms.lowerColor.value.set(blue ? '#6d7e95' : '#c4b2a2');
    skyUniforms.sunStrength.value = blue ? .1 : 1;
    litWindows.emissiveIntensity = blue ? 1.2 : .24;
    windows.emissiveIntensity = blue ? .18 : .12;
  }
  return {
    group,
    setTime,
    update(time) { skyUniforms.time.value = time; },
  };
}
