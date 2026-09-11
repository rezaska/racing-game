// Tests for the glTF car loader.
//
// Separate from sim.test.mjs on purpose: that file must never import three.js,
// and this one has to. Resolvable in Node because vendor/three carries a
// package.json and node_modules/three symlinks to it.
//
//   node test/model.test.mjs

import * as THREE from 'three';
const { findWheels, findBodyMaterial } = await import('../src/gfx/carload.js');

let fails = 0;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(`${c ? '  PASS' : '  FAIL'}  ${m}${x ? '  ' + x : ''}`); };

function fakeCar(names, matNames = []) {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc3333 });
  bodyMat.name = matNames[0] || 'Mat.001';
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 4.4), bodyMat);
  body.name = names[0];
  body.position.y = 0.75;
  car.add(body);

  const glass = new THREE.MeshStandardMaterial({ color: 0x111111 });
  glass.name = matNames[1] || 'Glass';
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.8), glass);
  cab.position.y = 1.3;
  car.add(cab);

  [[-0.8, -1.3], [0.8, -1.3], [-0.8, 1.3], [0.8, 1.3]].forEach(([x, z], i) => {
    const g = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16);
    g.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    w.name = names[i + 1];
    w.position.set(x, 0.34, z);
    car.add(w);
  });
  car.updateMatrixWorld(true);
  return car;
}

console.log('\n== Wheel detection ==');
{
  // Most downloaded models do not name their parts helpfully, so falling back
  // to geometry is the difference between "works" and "reject the model".
  const found = findWheels(fakeCar(['Circle.001', 'Circle.002', 'Circle.003', 'Circle.004', 'Circle.005']));
  const front = found.filter((w) => w.front).length;
  ok(found.length === 4, 'finds four wheels with unhelpful part names', `${found.length} found`);
  ok(front === 2, 'splits front from rear correctly', `${front} front, ${found.length - front} rear`);

  const named = findWheels(fakeCar(['body', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']));
  ok(named.length === 4, 'uses the names when a model provides them', `${named.length} found`);

  // A car modelled as one merged mesh genuinely cannot be solved. It must
  // report nothing rather than inventing wheels out of body panels.
  const merged = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.4), new THREE.MeshStandardMaterial());
  m.name = 'Car';
  m.position.y = 0.6;
  merged.add(m);
  merged.updateMatrixWorld(true);
  ok(findWheels(merged).length === 0, 'reports no wheels for a single merged mesh');
}

console.log('\n== Body material ==');
{
  const byName = findBodyMaterial(fakeCar(['body', 'w1', 'w2', 'w3', 'w4'], ['Body_Color', 'Glass']));
  ok([...byName].some((m) => m.name === 'Body_Color'), 'matches a body material by name');

  // Fallback: the largest material that is not glass, rubber, lights or trim.
  const byArea = findBodyMaterial(fakeCar(['a', 'b', 'c', 'd', 'e'], ['Mat.001', 'Glass']));
  ok(byArea.size === 1, 'falls back to the largest non-glass material', `${byArea.size} chosen`);
  ok(![...byArea].some((m) => /glass/i.test(m.name)), 'never picks the glass as bodywork');
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}\n`);
process.exit(fails ? 1 : 0);
