import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { advanceRainSurface, createPrecipitation } from '../src/precipitation.js';
import { cloudNoiseData } from '../src/cloud-noise.js';
import { cloudTransmission, cloudDensity, volumeNoise } from '../src/cloud-transmission.js';

test('rain wetting persists, film drains faster, and pause does not simulate elapsed weather', () => {
  const surface = { wetness: 0, film: 0 };
  for(let i=0;i<2000;i++) advanceRainSurface(surface,.1,8);
  assert.ok(surface.wetness > .99 && surface.film > .98);
  const paused = {...surface}; advanceRainSurface(surface,3600,0,1,true);
  assert.deepEqual(surface,paused);
  for(let i=0;i<300;i++) advanceRainSurface(surface,.1,0);
  assert.ok(surface.wetness > .85 && surface.film < .1);
  advanceRainSurface(surface,NaN,100);
  assert.ok(Number.isFinite(surface.wetness));
});

test('camera-near rain respects actual canopy shelter and reduced motion', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); camera.position.set(0,4,0);
  const habitat = { crowns:new Map([['0,0',[{x:0,z:0,y:5,r:4}]]]) };
  const rain = createPrecipitation(scene,1847,{light:true,habitat});
  assert.ok(rain.sampleShelter(0,0,1) < .4);
  assert.equal(rain.sampleShelter(0,0,10),1);
  rain.update({dt:.1,rain:8,wind:[3,2],camera,reducedMotion:true});
  assert.equal(scene.children[0].visible,false);
  assert.ok(rain.surface.wetness > 0);
  assert.equal(rain.surface.impacts.length,0);
  rain.update({dt:.1,rain:8,wind:[3,2],camera});
  assert.ok(scene.children[0].geometry.getAttribute('position').array.every(Number.isFinite));
  assert.ok(scene.children[0].material.depthTest && !scene.children[0].material.depthWrite);
  rain.dispose(); assert.equal(scene.children.length,0);
});

test('cloud CPU field uses seeded volume, periodic filtering and matching visible density', () => {
  const data=cloudNoiseData(1847);
  assert.equal(data,cloudNoiseData(1847));
  assert.notDeepEqual(data,cloudNoiseData(1848));
  assert.equal(volumeNoise(data,[1,2,3]),data[3*4096+2*64+1]/255);
  assert.ok(Math.abs(volumeNoise(data,[1.3,2.2,3.4])-volumeNoise(data,[65.3,2.2,3.4]))<1e-12);
  assert.equal(cloudTransmission(1847,{low:0,mid:0,high:0}),1);
  const transmission=cloudTransmission(1847,{low:1,mid:1,high:1,time:4,wind:[3,-2]});
  assert.ok(transmission>=0 && transmission<1);
  assert.equal(transmission,cloudTransmission(1847,{low:1,mid:1,high:1,time:4,wind:[3,-2]}));
  assert.ok(cloudDensity(new Uint8Array(64**3).fill(128),[0,1.6,0],{low:1,mid:1})>0, "overcast density reaches the camera-altitude horizon");
});

test('CPU density and noise filtering track shipping WGSL deck and threshold equations', async () => {
  const { readFile } = await import('node:fs/promises');
  const shader = await readFile(new URL('../src/shaders/clouds.wgsl',import.meta.url),'utf8');
  const noiseShader = await readFile(new URL('../src/shaders/skyview.wgsl',import.meta.url),'utf8');
  assert.match(noiseShader,/let blend = f \* f \* \(3\.0 - 2\.0 \* f\)/);
  assert.match(noiseShader,/\(cell \+ blend \+ 0\.5\) \/ 64\.0/);
  assert.match(shader,/-vec3f\(atmosphere.wind.x, 0.0, -atmosphere.wind.y\) \* atmosphere.time \* 0.012/);
  const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  const profile = name => {
    const match=shader.match(new RegExp(`let ${name} = smoothstep\\(([-\\d.]+), ([-\\d.]+), p.y\\) \\* \\(1.0 - smoothstep\\(([-\\d.]+), ([-\\d.]+), p.y\\)\\)`));
    assert.ok(match,`shipping ${name} deck must remain readable by twin fixture`);
    return match.slice(1).map(Number);
  };
  const lower=profile('lower'),middle=profile('middle'),upper=profile('upper');
  const threshold=shader.match(/let threshold = mix\(([\d.]+), ([\d.]+), pow\(coverage, ([\d.]+)\)\)/).slice(1).map(Number);
  const weights=shader.match(/let body = noise3\(q\) \* ([\d.]+) \+ noise3\(q \* ([\d.]+) \+ ([\d.]+)\) \* ([\d.]+) \+ noise3\(q \* ([\d.]+) \+ ([\d.]+)\) \* ([\d.]+)/).slice(1).map(Number);
  const erosion=Number(shader.match(/let erosion = noise3\(q \* [\d.]+\) \* ([\d.]+)/)[1]);
  const gain=Number(shader.match(/threshold - erosion\) \* ([\d.]+)/)[1]);
  const data=new Uint8Array(64**3).fill(128), n=128/255;
  for(const y of [-4,-2,0,1.6,2.5,3.5,5.2,7]) {
    const decks=[lower,middle,upper].map(([a,b,c,d])=>smooth(a,b,y)*(1-smooth(c,d,y)));
    const coverage=Math.max(decks[0]*.8,decks[1]*.6,decks[2]*.4);
    const p=Math.max(decks[0],decks[1],decks[2]*.92);
    const expected=coverage<.01||p<.01?0:Math.max((n*(weights[0]+weights[3]+weights[6])*p-(threshold[0]+(threshold[1]-threshold[0])*coverage**threshold[2])-n*erosion)*gain,0);
    assert.ok(Math.abs(cloudDensity(data,[1,y,2],{low:.8,mid:.6,high:.4})-expected)<1e-12,`WGSL twin at altitude ${y}`);
  }
});

test('rain history advances equally at reduced-motion 1Hz and animated 60Hz', () => {
  const slow={wetness:0,film:0},fast={wetness:0,film:0};
  for(let second=0;second<240;second++) {
    const rain=second<150?4:0;
    advanceRainSurface(slow,1,rain);
    for(let frame=0;frame<60;frame++)advanceRainSurface(fast,1/60,rain);
    assert.ok(Math.abs(slow.wetness-fast.wetness)<1e-12,`moisture at second ${second}`);
    assert.ok(Math.abs(slow.film-fast.film)<.0005,`film at second ${second}`);
  }
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(0,4,0);
  const precipitation=createPrecipitation(scene,1847,{light:true});
  precipitation.update({dt:1,rain:4,camera,reducedMotion:true});
  assert.ok(Math.abs(precipitation.surface.wetness-(1-Math.exp(-1/35)))<1e-12);
  precipitation.dispose();
});
