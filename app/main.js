import './style.css'

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { Matrix, solve } from 'ml-matrix';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// constance
const aspectRatio = window.innerWidth / window.innerHeight;

// scene, camera, renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
});

// helper
const controls = new OrbitControls(camera, renderer.domElement);
const gridHelper = new THREE.GridHelper(500, 50);

// selector
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// loader
const loader = new STLLoader();

// variables
let mesh;
let hit;
let hitList = [];
let boxList = [];
let cubeList = [];
let posList = {};
let indexList = new Set();
let connectedIndex = [];
let intersects;
let onDrag;
let gui;
let selector;
let sphere;
let m = {};
let radius;
let keyCount = 0;
let queue = [];
let femurMesh;
let startingPoint = null;
let boundingBox;
let labels = [];
let minSize = 2000;

// femur vertex positions and normals
let femurPos = [];
let femurNor = [];

// data input
const form = document.querySelector('form');
const fileInput = document.querySelector('input[type="file"]');

// 
init();
animate();

function init() {
  // light
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 1);
  hemiLight.position.set(0, 100, 0);
  scene.add(hemiLight);

  // renderer, camera, grid
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.position.setZ(100);
  scene.add(gridHelper);
  gridHelper.material.visible = false;

  // selector
  const selectorGeometry = new THREE.SphereGeometry(0.1, 32, 32);
  const selectorMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
  selector = new THREE.Mesh(selectorGeometry, selectorMaterial);
  scene.add(selector);
  raycaster.params.Points.threshold = 0.5;

  // GUI
  document.body.id = "body";
  initGui();

  // Listener
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onWindowResize);

  form.addEventListener('submit', onSubmitData);
}

function onSubmitData(event) {
  event.preventDefault();
  let url = URL.createObjectURL(fileInput.files[0]);

  loader.load(url, function (geometry) {
    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      side: 2
    });
    geometry = BufferGeometryUtils.mergeVertices(geometry);
    geometry.computeVertexNormals();
    mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.name = 'Import';
    const count = geometry.attributes.position.count;
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    scene.add(mesh);
    document.getElementById("app").style.display = "block";

    // compute bounding box
    let boundingBoxCenter = new THREE.Box3();
    mesh.geometry.computeBoundingBox();
    boundingBoxCenter.setFromBufferAttribute(geometry.getAttribute('position'));

    // set center to origin
    let center = new THREE.Vector3();
    boundingBoxCenter.getCenter(center);
    const offset = center.clone().negate();
    geometry.translate(offset.x, offset.y, offset.z);

    const angle = -1 * (Math.PI / 2); // -90 degrees in radians
    const matrixX = new THREE.Matrix4().makeRotationX(angle);
    geometry.applyMatrix4(matrixX);
  });

}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;
  onDrag = true;
}

function onPointerDown(event) {
  onDrag = false;
}

function onKeyDown(event) {
  switch (event.key) {
    case "Backspace":
      if (hitList.length > 0) {
        hitList.pop();
        scene.remove(cubeList[cubeList.length - 1]);
        cubeList.pop();
        if (hitList.length < 5) {
          boxList.pop();
        }
        if (hitList.length < 4) {
          scene.remove(sphere);
        }
      }
      break;
    case "Enter":
      if (hitList.length <= 4) return;
      document.getElementById("loading").style.display = "block";
      document.getElementById("app").style.display = "none";
      setTimeout(() => {
        calculateNewMesh();
        document.getElementById("loading").style.display = "none";
        document.getElementById("app").style.display = "block";
      }, 10);
      break;
    case "l":
      calculateSections();
      break;
  }
}

function onClick(event) {
  if (document.activeElement.id == "") return; // for gui
  if (onDrag) return;
  if (document.activeElement.id == "file") return;
  // activate raycaster
  if (mesh != null) {
    raycaster.setFromCamera(pointer, camera);
    intersects = raycaster.intersectObject(mesh);
    if (intersects.length > 0) {
      hit = selector.position.copy(intersects[0].point);
    } else {
      hit = null;
    }
  }
  // copy hit values and not the reference
  if (hit !== null) {
    hitList.push({ ...hit });
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshPhongMaterial({
        color: 0xff0000
      })
    )
    cube.position.x = hit.x;
    cube.position.y = hit.y;
    cube.position.z = hit.z;
    const box = new THREE.Box3().setFromObject(cube);
    if (hitList.length >= 5) boxList.push(box);
    cubeList.push(cube);
    scene.add(cube);
  }
  if (hitList.length == 4) calculateSphere();
}

function calculateNewMesh() {
  let tmpNor = [];
  let tmpPos = [];
  prepareData(tmpNor, tmpPos);
  setIndexList(labels);
  let meshPos = new Array(labels.length).fill().map(() => []);
  let meshNor = new Array(labels.length).fill().map(() => []);
  let label = null;
  let femurLabel = null;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].has(startingPoint)) {
      femurLabel = i;
    }
  }
  for (let i = 0; i < tmpPos.length; i += 9) {
    let searchIndex = posList[`${tmpPos[i]} ${tmpPos[i + 1]} ${tmpPos[i + 2]}`];
    let count = 0;
    for (let j = 0; j < labels.length; j++) {
      if (labels[j].has(searchIndex)) {
        label = j;
        j = labels.length;
      } else {
        count++;
        if (count >= labels.length) {
          label = -1;
        }
      }
    }
    if (label !== null && label >= 0) {
      if (label == femurLabel) {
        femurPos.push(tmpPos[i], tmpPos[i + 1], tmpPos[i + 2]);
        femurPos.push(tmpPos[i + 3], tmpPos[i + 4], tmpPos[i + 5]);
        femurPos.push(tmpPos[i + 6], tmpPos[i + 7], tmpPos[i + 8]);
        femurNor.push(tmpNor[i], tmpNor[i + 1], tmpNor[i + 2]);
        femurNor.push(tmpNor[i + 3], tmpNor[i + 4], tmpNor[i + 5]);
        femurNor.push(tmpNor[i + 6], tmpNor[i + 7], tmpNor[i + 8]);
      } else {
        meshPos[label].push(tmpPos[i], tmpPos[i + 1], tmpPos[i + 2]);
        meshPos[label].push(tmpPos[i + 3], tmpPos[i + 4], tmpPos[i + 5]);
        meshPos[label].push(tmpPos[i + 6], tmpPos[i + 7], tmpPos[i + 8]);
        meshNor[label].push(tmpNor[i], tmpNor[i + 1], tmpNor[i + 2]);
        meshNor[label].push(tmpNor[i + 3], tmpNor[i + 4], tmpNor[i + 5]);
        meshNor[label].push(tmpNor[i + 6], tmpNor[i + 7], tmpNor[i + 8]);
      }
    }
  }
  for (let i = 0; i < meshPos.length; i++) {
    if (i !== femurLabel) {
      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(meshPos[i]), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(meshNor[i]), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));

      let color = geometry.attributes.color;
      const count = geometry.attributes.position.count
      for (let j = 0; j < count; j++) {
        color.setXYZ(j, 1, 1, 1);
      }

      let material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: 2
      });
      let labeldMesh = new THREE.Mesh(geometry, material);
      labeldMesh.name = 'Label_' + i;
      if (!meshPos[i].length / 3 < minSize) {
        scene.add(labeldMesh);
      }
    }
  }

  let femurGeometry = new THREE.BufferGeometry();
  femurGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(femurNor), 3));
  femurGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(femurPos), 3));
  let femurMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFA500,
    side: 2,
    transparent: true,
    opacity: 0.4
  });
  femurMesh = new THREE.Mesh(femurGeometry, femurMaterial);
  femurMesh.name = 'FermurMesh';

  scene.remove(sphere);
  scene.remove(mesh);
  scene.add(femurMesh);

  resetPoints();
}

function resetPoints() {
  for (let i = 0; i < cubeList.length; i++) {
    scene.remove(cubeList[i]);
  }
  cubeList = [];
  boxList = [];
  hitList = [];
  if (sphere) {
    scene.remove(sphere);
  }
}

function generateColor() {
  return `#${(Math.random() * 0xfffff * 1000000).toString(16).slice(0, 6)
    }`;
};

function calculateSphere() {
  let leftSide = new Matrix([
    [1, hitList[0].x, hitList[0].y, hitList[0].z],
    [1, hitList[1].x, hitList[1].y, hitList[1].z],
    [1, hitList[2].x, hitList[2].y, hitList[2].z],
    [1, hitList[3].x, hitList[3].y, hitList[3].z]
  ]);
  let rightSide = Matrix.columnVector([calcRight(hitList[0]), calcRight(hitList[1]), calcRight(hitList[2]), calcRight(hitList[3])]);
  let solved = solve(leftSide, rightSide);
  // calculate midPoint and radius
  m = { x: -(solved.data[1][0] / 2), y: -(solved.data[2][0] / 2), z: -(solved.data[3][0] / 2) };
  radius = Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z - solved.data[0][0]);
  sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius),
    new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6
    })
  )
  sphere.position.x = m.x;
  sphere.position.y = m.y;
  sphere.position.z = m.z;
  scene.add(sphere);
}

function prepareData(tmpNor, tmpPos) {
  let meshNormals = mesh.geometry.getAttribute('normal');
  let meshPositions = mesh.geometry.getAttribute('position');
  let index = mesh.geometry.index;
  radius *= sphere.scale.x;
  for (let i = 0; i < index.count; i += 3) {
    let ia = index.array[i];
    let ib = index.array[i + 1];
    let ic = index.array[i + 2];
    let nor1 = new THREE.Vector3(meshNormals.array[ia * 3], meshNormals.array[ia * 3 + 1], meshNormals.array[ia * 3 + 2]);
    let nor2 = new THREE.Vector3(meshNormals.array[ib * 3], meshNormals.array[ib * 3 + 1], meshNormals.array[ib * 3 + 2]);
    let nor3 = new THREE.Vector3(meshNormals.array[ic * 3], meshNormals.array[ic * 3 + 1], meshNormals.array[ic * 3 + 2]);
    let pos1 = new THREE.Vector3(meshPositions.array[ia * 3], meshPositions.array[ia * 3 + 1], meshPositions.array[ia * 3 + 2]);
    let pos2 = new THREE.Vector3(meshPositions.array[ib * 3], meshPositions.array[ib * 3 + 1], meshPositions.array[ib * 3 + 2]);
    let pos3 = new THREE.Vector3(meshPositions.array[ic * 3], meshPositions.array[ic * 3 + 1], meshPositions.array[ic * 3 + 2])
    let key1 = `${pos1.x} ${pos1.y} ${pos1.z}`;
    let key2 = `${pos2.x} ${pos2.y} ${pos2.z}`;
    let key3 = `${pos3.x} ${pos3.y} ${pos3.z}`;
    posToIndex(key1, key2, key3);
    // seperate femur head positions
    if (calcDistance(m, radius, pos1) || calcDistance(m, radius, pos2) || calcDistance(m, radius, pos3)) {
      femurNor.push(nor1.x, nor1.y, nor1.z, nor2.x, nor2.y, nor2.z, nor3.x, nor3.y, nor3.z);
      femurPos.push(pos1.x, pos1.y, pos1.z, pos2.x, pos2.y, pos2.z, pos3.x, pos3.y, pos3.z);
    } else {
      tmpNor.push(nor1.x, nor1.y, nor1.z, nor2.x, nor2.y, nor2.z, nor3.x, nor3.y, nor3.z);
      tmpPos.push(pos1.x, pos1.y, pos1.z, pos2.x, pos2.y, pos2.z, pos3.x, pos3.y, pos3.z);
      setConnectedIndex(key1, key2, key3);
      // get starting point
      if (startingPoint === null) {
        for (let box3 of boxList) {
          if (box3.containsPoint(pos1) || box3.containsPoint(pos2) || box3.containsPoint(pos3)) {
            startingPoint = posList[key1];
          }
        }
      }
    }
  }
}

function setIndexList(labels) {
  let visited = new Set();
  for (let i = 0; i < connectedIndex.length; i++) {
    if (!visited.has(i)) {
      queue.push(i);
      while (queue.length > 0) {
        let current = queue.shift();
        if (!visited.has(current)) {
          indexList.add(current);
          visited.add(current);
          for (let next of connectedIndex[current]) {
            if (!visited.has(next)) {
              queue.push(next);
            }
          }
        }
      }
      if (indexList.size > minSize) {
        labels.push(indexList);
      }
      indexList = new Set();
    }
  }
}

function posToIndex(key1, key2, key3) {
  if (!(key1 in posList)) {
    posList[key1] = keyCount;
    connectedIndex[keyCount] = new Set();
    keyCount++;
  }
  if (!(key2 in posList)) {
    posList[key2] = keyCount;
    connectedIndex[keyCount] = new Set();
    keyCount++;
  }
  if (!(key3 in posList)) {
    posList[key3] = keyCount;
    connectedIndex[keyCount] = new Set();
    keyCount++;
  }
}

function setConnectedIndex(key1, key2, key3) {
  connectedIndex[posList[key1]].add(posList[key2]);
  connectedIndex[posList[key1]].add(posList[key3]);
  connectedIndex[posList[key2]].add(posList[key1]);
  connectedIndex[posList[key2]].add(posList[key3]);
  connectedIndex[posList[key3]].add(posList[key1]);
  connectedIndex[posList[key3]].add(posList[key2]);
}

function calcDistance(center, radius, point) {
  let x1 = Math.pow((point.x - center.x), 2);
  let y1 = Math.pow((point.y - center.y), 2);
  let z1 = Math.pow((point.z - center.z), 2);
  let distance = (x1 + y1 + z1);
  if (distance <= (radius * radius)) {
    return true;
  } else {
    return false;
  }
}

function calcRight(hit) {
  return (hit.x * hit.x + hit.y * hit.y + hit.z * hit.z) * -1;
}

function calculateSections() {
  for (let i = 0; i < scene.children.length; i++) {
    if (scene.children[i].name.startsWith("Label")) {
      let obj = scene.children[i];

      const objPosCount = obj.geometry.attributes.position.count;
      obj.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(objPosCount * 3), 3));

      boundingBox = new THREE.Box3();
      obj.geometry.computeBoundingBox();
      boundingBox = obj.geometry.boundingBox;
      boundingBox.setFromBufferAttribute(obj.geometry.getAttribute('position'));
      const helper = new THREE.Box3Helper(boundingBox, 0xffff00);
      scene.add(helper);

      let minPosterior = new THREE.Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z);
      let maxPosterior = new THREE.Vector3(boundingBox.max.x, boundingBox.max.y, sphere.position.z);
      const posterior = new THREE.Box3(minPosterior, maxPosterior);

      let minAnterior = new THREE.Vector3(boundingBox.min.x, boundingBox.min.y, sphere.position.z);
      let maxAnterior = new THREE.Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z);
      const anterior = new THREE.Box3(minAnterior, maxAnterior);

      let lPoints = obj.geometry.attributes.position;
      let color = obj.geometry.attributes.color;
      const count = obj.geometry.attributes.position.count
      for (let i = 0; i < count; i++) {
        if (posterior.containsPoint(new THREE.Vector3(lPoints.array[i * 3], lPoints.array[i * 3 + 1], lPoints.array[i * 3 + 2]))) {
          color.setXYZ(i, 1, 1, 0);
        } else if (anterior.containsPoint(new THREE.Vector3(lPoints.array[i * 3], lPoints.array[i * 3 + 1], lPoints.array[i * 3 + 2]))) {
          color.setXYZ(i, 1, 0.5, 0);
        }
      }
      obj.material.vertexColors = true;
      obj.geometry.attributes.color.needsUpdate = true;
    }
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function initGui() {
  gui = new GUI();
  gui.domElement.id = "gui";

  const param = {
    'Sphere Scale': 1,
    'Show Femur': true,
    'Grid': false,
    'Calculate': function () {
      if (hitList.length <= 4) return;
      document.getElementById("loading").style.display = "block";
      document.getElementById("app").style.display = "none";
      setTimeout(() => {
        calculateNewMesh();
        document.getElementById("loading").style.display = "none";
        document.getElementById("app").style.display = "block";
      }, 10);
    },
    'Show Sections': function () {
      calculateSections();
    },
    'Reset Points': function () {
      resetPoints();
    },
    'Minimum Mesh Size': minSize,
  };

  gui.add(param, 'Sphere Scale', 0.7, 1.3).onChange(function (val) {
    if (sphere != null) {
      sphere.scale.setScalar(val);
    }
  });
  gui.add(param, 'Show Femur').onChange(function (val) {
    if (femurMesh != null) {
      femurMesh.material.visible = val;
    }
  });
  gui.add(param, 'Reset Points');
  const folder = gui.addFolder('Calculations');
  folder.add(param, 'Calculate');
  folder.add(param, 'Show Sections');
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  render();
}

function render() {
  renderer.render(scene, camera);
}