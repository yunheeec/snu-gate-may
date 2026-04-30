import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

[
  "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
  "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
].forEach((src) => {
  const s = document.createElement("script");
  s.src = src;
  document.head.appendChild(s);
});

const MODEL_SCREEN_X = 0.5,
  MODEL_SCREEN_Y = 0.8,
  MODEL_WORLD_Z = 0,
  MODEL_DROP_Y = -1.1;

// ─── Renderer ──────────────────────────────────────────────
const canvas = document.getElementById("threeCanvas");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
const isMobile = window.innerWidth <= 768;
camera.position.set(0, 3.2, isMobile ? 25 : 16.5);
camera.lookAt(0, 2, 0);
const BG_IMG_W = 5428;
const BG_IMG_H = 3616;
const BG_ANCHOR_Y = 0.73; // 정문 바닥 위치
function buildEnvMap() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(50, 16, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    vertexColors: true,
  });
  const skyColors = [],
    skyPos = skyGeo.attributes.position;
  for (let i = 0; i < skyPos.count; i++) {
    const t = (skyPos.getY(i) + 50) / 100;
    skyColors.push(
      THREE.MathUtils.lerp(0.55, 0.85, t),
      THREE.MathUtils.lerp(0.55, 0.9, t),
      THREE.MathUtils.lerp(0.55, 1.0, t),
    );
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(skyColors, 3));
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  const envSun1 = new THREE.DirectionalLight(0xffffff, 8);
  envSun1.position.set(8, 12, 6);
  envScene.add(envSun1);
  const envSun2 = new THREE.DirectionalLight(0xffd0a0, 4);
  envSun2.position.set(-5, 4, -3);
  envScene.add(envSun2);
  envScene.add(new THREE.AmbientLight(0xccddff, 3));
  const t = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  return t;
}
const envMap = buildEnvMap();
scene.environment = envMap;
scene.environmentIntensity = 1.5;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 5.2);
key.position.set(50, 30, -20);
key.target.position.set(0, 0, 0);
key.castShadow = true;
key.shadow.mapSize.width = key.shadow.mapSize.height = 2048;
Object.assign(key.shadow.camera, {
  left: -25,
  right: 25,
  top: 25,
  bottom: -25,
  near: 0.5,
  far: 80,
});
key.shadow.bias = -0.0004;
scene.add(key);
scene.add(key.target);
const fillLight = new THREE.DirectionalLight(0xd0e8ff, 1.1);
fillLight.position.set(-8, 6, 4);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 0.9);
rimLight.position.set(-4, 8, -10);
scene.add(rimLight);
const topLight = new THREE.DirectionalLight(0xffffff, 1.3);
topLight.position.set(0, 20, 0);
scene.add(topLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.ShadowMaterial({ opacity: 0.32 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

// ─── Gate 상태 ─────────────────────────────────────────────
let gateModel = null,
  gateGroup = null;
const gateOrigPos = new THREE.Vector3(),
  gateOrigRot = new THREE.Euler();
let gateState = "idle";
const gateVelocity = new THREE.Vector3(),
  gateAngularVel = new THREE.Vector3();
let returnTimer = 0;
let isGrabbed = false;
const grabOffset = new THREE.Vector3();
let thumbsShakeTimer = 0,
  thumbsShakeActive = false;
let heartJumpTimer = 0,
  heartJumpActive = false;
let spinTimer = 0,
  spinActive = false;
let isSpinningMode = false;
let spinStartTime = 0;
const SPIN_POKE_DELAY = 250;

function getWorldPositionFromScreen(nx, ny, worldZ = 0) {
  const ndc = new THREE.Vector3(nx * 2 - 1, -(ny * 2 - 1), 0.5);
  ndc.unproject(camera);
  const dir = ndc.sub(camera.position).normalize();
  const dist = (worldZ - camera.position.z) / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(dist));
}
function getAnchorScreenY() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const imgAspect = BG_IMG_W / BG_IMG_H;
  const screenAspect = vw / vh;

  let renderedH, offsetY;

  if (screenAspect > imgAspect) {
    renderedH = vw / imgAspect;
    offsetY = (vh - renderedH) / 2;
  } else {
    renderedH = vh;
    offsetY = 0;
  }

  const anchorPxY = offsetY + renderedH * BG_ANCHOR_Y;
  return anchorPxY / vh;
}

function placeGateAtScreen(
  nx = MODEL_SCREEN_X,
  ny = MODEL_SCREEN_Y,
  worldZ = MODEL_WORLD_Z,
) {
  if (!gateGroup) return;

  const isMobile = window.innerWidth <= 768;
  const anchorY = isMobile ? getAnchorScreenY() : ny; // ← 모바일만 앵커 사용

  const pos = getWorldPositionFromScreen(nx, anchorY, worldZ);
  gateGroup.position.set(pos.x, pos.y + MODEL_DROP_Y, worldZ);
  ground.position.y = gateGroup.position.y;
}

// ─── 파티클 ──────────────────────────────────────────────
const particles = [];
function spawnParticles(pos, color = 0xcccccc, count = 40) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.1 + Math.random() * 0.3,
        0.1 + Math.random() * 0.3,
        0.1 + Math.random() * 0.3,
      ),
      new THREE.MeshStandardMaterial({
        color,
        metalness: 0.9,
        roughness: 0.1,
        envMap,
      }),
    );
    mesh.position
      .copy(pos)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
        ),
      );
    mesh.userData = {
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        Math.random() * 10 + 4,
        (Math.random() - 0.5) * 18,
      ),
      angVel: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      ),
      life: 1.0,
      maxLife: 1.2 + Math.random() * 0.8,
    };
    scene.add(mesh);
    particles.push(mesh);
  }
}

function spawnEmojiParticles(pos, emojis, count = 20) {
  for (let i = 0; i < count; i++) {
    const c2d = document.createElement("canvas");
    c2d.width = c2d.height = 128;
    const ctx2 = c2d.getContext("2d");
    ctx2.font = "80px serif";
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText(emojis[Math.floor(Math.random() * emojis.length)], 64, 64);
    const tex = new THREE.CanvasTexture(c2d);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      }),
    );
    const sc = 0.5 + Math.random() * 0.8;
    sprite.scale.set(sc, sc, sc);
    sprite.position
      .copy(pos)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 6,
          Math.random() * 1,
          (Math.random() - 0.5) * 6,
        ),
      );
    sprite.userData = {
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 8 + 5,
        (Math.random() - 0.5) * 8,
      ),
      life: 1.0,
      maxLife: 1.5 + Math.random() * 1.0,
      isSprite: true,
    };
    scene.add(sprite);
    particles.push(sprite);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.vel.y -= 9 * dt;
    p.position.addScaledVector(p.userData.vel, dt);
    if (!p.userData.isSprite) {
      p.rotation.x += (p.userData.angVel?.x || 0) * dt;
      p.rotation.y += (p.userData.angVel?.y || 0) * dt;
      p.rotation.z += (p.userData.angVel?.z || 0) * dt;
    }
    p.userData.life -= dt / p.userData.maxLife;
    if (p.material) {
      p.material.opacity = Math.max(0, p.userData.life);
      p.material.transparent = true;
    }
    if (p.userData.life <= 0 || p.position.y < -10) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }
}

const shockwaves = [];
function spawnShockwave(pos) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.4, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  mesh.position.copy(pos);
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData = { life: 1.0 };
  scene.add(mesh);
  shockwaves.push(mesh);
}
function updateShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.userData.life -= dt * 1.5;
    const sc = 1 + (1 - s.userData.life) * 6;
    s.scale.set(sc, sc, sc);
    s.material.opacity = s.userData.life * 0.8;
    if (s.userData.life <= 0) {
      scene.remove(s);
      shockwaves.splice(i, 1);
    }
  }
}

// ─── UI ────────────────────────────────────────────────────
const scores = { blast: 0, throw: 0, thumbs: 0, heart: 0, spin: 0 };
function updateScore(k) {
  scores[k]++;
  document.getElementById("cnt-" + k).textContent = scores[k];
}
const gfb = document.getElementById("gestureFeedback");
const statusEl = document.getElementById("status");
const debugEl = document.getElementById("gestureDebug");
const blastChargeEl = document.getElementById("blastCharge");
const blastChargeFillEl = document.getElementById("blastChargeFill");
const sfx = {
  blast: [
    new Audio("./assets/audio/flying.mp3"),
    new Audio("./assets/audio/woman.mp3"),
    new Audio("./assets/audio/man.mp3"),
  ],
  spin: new Audio("./assets/audio/eh.mp3"),
  poke: new Audio("./assets/audio/damngirl.mp3"),
  thumbs: [
    new Audio("./assets/audio/feelinggood.mp3"),
    new Audio("./assets/audio/sensitive.mp3"),
  ],
  heart: [
    new Audio("./assets/audio/lovely.mp3"),
    new Audio("./assets/audio/beautiful.mp3"),
  ],
};
sfx.spinLoop = new Audio("./assets/audio/spin_loop.mp3");
sfx.spinLoop.loop = true;
sfx.spinLoop = new Audio("./assets/audio/spin_loop.mp3");
sfx.spinLoop.loop = true;
sfx.spinLoop.volume = 0.5;

let spinSoundStopped = true;

function stopSpinSound() {
  if (spinSoundStopped) return;
  spinSoundStopped = true;

  sfx.spinLoop.pause();
  sfx.spinLoop.currentTime = 0;
  sfx.spinLoop.src = "";
  sfx.spinLoop.load();

  sfx.spin.pause();
  sfx.spin.currentTime = 0;
  sfx.spin.src = "";
  sfx.spin.load();

  sfx.spinLoop = new Audio("./assets/audio/spin_loop.mp3");
  sfx.spinLoop.loop = true;
  sfx.spinLoop.volume = 0.5;

  sfx.spin = new Audio("./assets/audio/eh.mp3");
}
sfx.spinLoop.volume = 0.5;
function showFeedback(t) {
  gfb.textContent = t;
  gfb.style.opacity = "1";
  setTimeout(() => (gfb.style.opacity = "0"), 900);
}
function setStatus(t) {
  statusEl.textContent = t;
}
function setDebug(t) {
  debugEl.textContent = t;
}
function playSfx(name) {
  let audio = sfx[name];
  if (!audio) return;

  if (Array.isArray(audio)) {
    audio = audio[Math.floor(Math.random() * audio.length)];
  }

  audio.pause();
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// ─── 제스처 액션들 ─────────────────────────────────────────
function doBlast(handX) {
  if (!gateGroup) return;
  updateScore("blast");
  playSfx("blast");
  showFeedback("💥 장풍 발사!");
  const dir = handX > 0.5 ? -1 : 1;
  gateVelocity.set(dir * 18, 6, -25);
  gateAngularVel.set(
    (Math.random() - 0.5) * 4,
    (Math.random() - 0.5) * 4,
    (Math.random() - 0.5) * 3,
  );
  gateState = "blasting";
  spawnParticles(gateGroup.position.clone(), 0xd8d8d8, 50);
  spawnShockwave(gateGroup.position.clone());
  setStatus("💥 장풍 발사!");
  scheduleReturn(2000);
}

function doPokeFly(handX) {
  if (!gateGroup) return;
  playSfx("poke");
  showFeedback("☝️ 톡!");
  const dir = handX > 0.5 ? -1 : 1;

  gateVelocity.set(dir * 12, 9, -28);
  gateAngularVel.set((Math.random() - 0.5) * 5, 8, (Math.random() - 0.5) * 4);

  gateState = "blasting";
  spinActive = false;
  isSpinningMode = false;
  stopSpinSound();

  spawnParticles(gateGroup.position.clone(), 0xffee88, 35);
  spawnShockwave(gateGroup.position.clone());

  setStatus("☝️ 톡! 정문이 날아갔다!");
  scheduleReturn(2000);
}

function doGrab(hwp) {
  if (!gateGroup || isGrabbed) return;
  isGrabbed = true;
  gateState = "grabbed";
  grabOffset.copy(gateGroup.position).sub(hwp);
  setStatus("🤲 잡았다! 빠르게 던지세요!");
}

function doThrow(vel) {
  if (!gateGroup || !isGrabbed) return;
  isGrabbed = false;
  updateScore("throw");
  showFeedback("🚀 던지기!");
  gateVelocity.copy(vel).multiplyScalar(30);
  gateVelocity.y += 8;
  gateAngularVel.set(
    (Math.random() - 0.5) * 6,
    (Math.random() - 0.5) * 6,
    (Math.random() - 0.5) * 4,
  );
  gateState = "blasting";
  spawnParticles(gateGroup.position.clone(), 0xbbbbbb, 30);
  setStatus("🚀 던졌다!");
  scheduleReturn(4000);
}

function doThumbs() {
  if (!gateGroup) return;
  updateScore("thumbs");
  showFeedback("👍 따봉!");
  playSfx("thumbs");
  const center = gateGroup.position.clone().add(new THREE.Vector3(0, 2, 0));
  spawnEmojiParticles(center, ["👍", "⭐", "✨", "💫", "🌟"], 60);
  thumbsShakeActive = true;
  thumbsShakeTimer = 0;
  setStatus("👍 따봉! 정문이 신났다!");
}

function doHeart() {
  if (!gateGroup) return;
  updateScore("heart");
  playSfx("heart");
  showFeedback("🫶 하트!");
  const center = gateGroup.position.clone().add(new THREE.Vector3(0, 2, 0));
  spawnEmojiParticles(center, ["❤️", "💕", "💖", "💗", "🫶", "💝"], 60);
  heartJumpActive = true;
  heartJumpTimer = 0;
  gateVelocity.set(0, 0, 0);
  setStatus("🫶 정문이 사랑을 받고 있다!");
}

function doSpin() {
  if (!gateGroup || gateState === "spinning") return;
  updateScore("spin");
  playSfx("spin");
  showFeedback("☝️ 빙글빙글~");

  spinSoundStopped = false;
  sfx.spinLoop.currentTime = 0;
  sfx.spinLoop.play().catch(() => {});

  gateState = "spinning";
  spinActive = true;
  spinTimer = 0;
  spawnParticles(gateGroup.position.clone(), 0xffee88, 30);
  spawnShockwave(gateGroup.position.clone());
  setStatus("☝️ 빙글빙글~ 검지손가락을 톡 쳐보세요!");
}

function scheduleReturn(ms) {
  setTimeout(() => {
    if (gateGroup && gateState !== "grabbed") {
      thumbsShakeActive = false;
      heartJumpActive = false;
      spinActive = false;
      gateState = "returning";
      stopSpinSound();
      returnTimer = 0;
    }
  }, ms);
}

// ─── GLB 로드 ──────────────────────────────────────────────
const loadFill = document.getElementById("loadFill");
const loadText = document.getElementById("loadText");
const loadingEl = document.getElementById("loading");

new GLTFLoader().load(
  "./assets/models/gate.glb",
  (gltf) => {
    gateModel = gltf.scene;
    gateGroup = new THREE.Group();
    const box = new THREE.Box3().setFromObject(gateModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = (7 / maxDim) * 1.45;
    gateModel.scale.setScalar(scale);
    gateModel.position.set(-center.x * scale, -box.min.y * scale, 0);
    gateModel.rotation.y = Math.PI;
    gateModel.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
        const oldMat = c.material;
        c.material = new THREE.MeshPhysicalMaterial({
          color: 0x8a867f,
          metalness: 0.3,
          roughness: 0.6,
          envMap,
          envMapIntensity: 1.6,
        });
        if (oldMat?.map) c.material.map = oldMat.map;
      }
    });
    gateGroup.add(gateModel);
    scene.add(gateGroup);
    placeGateAtScreen();
    gateOrigPos.copy(gateGroup.position);
    gateOrigRot.copy(gateGroup.rotation);
    loadingEl.style.display = "none";
    setStatus("손을 카메라에 보여주세요! 👋");
    startMediaPipe();
  },
  (p) => {
    const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
    loadFill.style.width = pct + "%";
    loadText.textContent = `모델 로딩 중... ${pct}%`;
  },
  (err) => {
    console.error("GLB 로딩 실패:", err);
    loadText.textContent = "❌ gate.glb 로딩 실패! 콘솔(F12)을 확인하세요.";
    loadText.style.color = "#ff6666";
  },
);

// ─── 애니메이션 루프 ───────────────────────────────────────
let lastTime = performance.now();
const handWorldPos3D = new THREE.Vector3();
const prevHandPos = new THREE.Vector3();
const handVelocity3D = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (gateGroup) {
    if (thumbsShakeActive) {
      thumbsShakeTimer += dt;
      const fade = Math.max(0, 1 - thumbsShakeTimer / 2.5);

      const sway = Math.sin(thumbsShakeTimer * 7.5);
      const hop = Math.pow(Math.abs(sway), 3.6);

      gateGroup.position.x = gateOrigPos.x + sway * 0.5 * fade;
      gateGroup.position.y = gateOrigPos.y + hop * 0.7 * fade;
      gateGroup.rotation.z = sway * 0.4 * fade;

      if (thumbsShakeTimer > 2.5) {
        thumbsShakeActive = false;
        gateGroup.position.copy(gateOrigPos);
        gateGroup.rotation.z = gateOrigRot.z;
      }
    }

    if (heartJumpActive) {
      heartJumpTimer += dt;
      const t = heartJumpTimer;
      if (t < 0.4)
        gateGroup.position.y =
          gateOrigPos.y + Math.sin((t / 0.4) * Math.PI) * 3.5;
      else if (t < 0.8)
        gateGroup.position.y =
          gateOrigPos.y + Math.sin(((t - 0.4) / 0.4) * Math.PI) * 1.8;
      else if (t < 1.1)
        gateGroup.position.y =
          gateOrigPos.y + Math.sin(((t - 0.8) / 0.3) * Math.PI) * 0.7;
      else {
        gateGroup.position.y = gateOrigPos.y;
        heartJumpActive = false;
      }
    }

    if (gateState === "blasting") {
      gateVelocity.y -= 9.8 * dt;
      gateGroup.position.addScaledVector(gateVelocity, dt);
      gateGroup.rotation.x += gateAngularVel.x * dt;
      gateGroup.rotation.y += gateAngularVel.y * dt;
      gateGroup.rotation.z += gateAngularVel.z * dt;
      if (gateGroup.position.y < -15 || gateGroup.position.z < -60)
        gateGroup.position.set(
          gateOrigPos.x,
          gateOrigPos.y - 20,
          gateOrigPos.z,
        );
    } else if (gateState === "spinning") {
      spinTimer += dt;
      gateGroup.rotation.y += dt * 5;
      gateGroup.position.y = gateOrigPos.y + Math.sin(spinTimer * 3) * 0.3;
    } else if (gateState === "grabbed") {
      gateGroup.position.copy(handWorldPos3D).add(grabOffset);
      gateGroup.rotation.y += dt * 1.5;
    } else if (gateState === "returning") {
      returnTimer += dt;
      gateGroup.position.lerp(gateOrigPos, dt * 8);
      gateGroup.rotation.x += (gateOrigRot.x - gateGroup.rotation.x) * dt * 8;
      gateGroup.rotation.y += (gateOrigRot.y - gateGroup.rotation.y) * dt * 8;
      gateGroup.rotation.z += (gateOrigRot.z - gateGroup.rotation.z) * dt * 8;
      if (gateGroup.position.distanceTo(gateOrigPos) < 0.05) {
        gateGroup.position.copy(gateOrigPos);
        gateGroup.rotation.copy(gateOrigRot);
        gateState = "idle";
        setStatus("또 해봐! 👊");
      }
    }
  }

  updateParticles(dt);
  updateShockwaves(dt);
  renderer.render(scene, camera);
}
animate();

// ─── MediaPipe ─────────────────────────────────────────────
const handCanvas = document.getElementById("handCanvas");
const hctx = handCanvas.getContext("2d");
const webcam = document.getElementById("webcam");

function startMediaPipe() {
  const check = setInterval(() => {
    if (typeof Hands !== "undefined" && typeof Camera !== "undefined") {
      clearInterval(check);
      initMP();
    }
  }, 200);
}

function initMP() {
  const hands = new Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.6,
  });
  hands.onResults(onHandResults);
  navigator.mediaDevices
    .getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
    })
    .then((stream) => {
      webcam.srcObject = stream;
      webcam.onloadedmetadata = () => {
        handCanvas.width = webcam.videoWidth;
        handCanvas.height = webcam.videoHeight;
        const mpCam = new Camera(webcam, {
          onFrame: async () => {
            await hands.send({ image: webcam });
          },
          width: 640,
          height: 480,
        });
        mpCam.start();
        setStatus("손을 카메라에 보여주세요! 👋");
      };
    })
    .catch(() => setStatus("카메라 권한을 허용해주세요!"));
}

// ═══════════════════════════════════════════════════════════
//  제스처 인식

// ── 손 크기 계산 (손바닥 너비 = 손목~검지MCP 거리) ─────────
function handSize(lms) {
  // 손목(0)~중지MCP(9) 거리 (normalized 좌표 기준)
  return Math.hypot(lms[0].x - lms[9].x, lms[0].y - lms[9].y);
}

// ── 손가락 상태 ───────────────────────────────────────────
function isFist(lms) {
  return [
    lms[8].y > lms[5].y, // 검지
    lms[12].y > lms[9].y, // 중지
    lms[16].y > lms[13].y, // 약지
    lms[20].y > lms[17].y, // 새끼
  ].every(Boolean);
}

function isOpenPalm(lms) {
  const thumbOpen = lms[4].x < lms[3].x || lms[4].x > lms[3].x;
  const fingersOpen = [
    lms[8].y < lms[6].y,
    lms[12].y < lms[10].y,
    lms[16].y < lms[14].y,
    lms[20].y < lms[18].y,
  ].every(Boolean);
  return fingersOpen; // 4개 손가락 완전히 펼침
}

function isThumbsUp(lms) {
  const thumbTip = lms[4];
  const thumbIP = lms[3];
  const thumbMCP = lms[2];
  const wrist = lms[0];

  const thumbUp =
    thumbTip.y < thumbIP.y &&
    thumbTip.y < thumbMCP.y &&
    wrist.y - thumbTip.y > 0.08;

  const indexFolded = lms[8].y > lms[6].y || lms[8].y > lms[5].y;
  const middleFolded = lms[12].y > lms[10].y || lms[12].y > lms[9].y;
  const ringFolded = lms[16].y > lms[14].y || lms[16].y > lms[13].y;
  const pinkyFolded = lms[20].y > lms[18].y || lms[20].y > lms[17].y;

  const othersFolded = indexFolded && middleFolded && ringFolded && pinkyFolded;

  return thumbUp && othersFolded;
}

function isIndexPointing(lms) {
  const indexUp = lms[8].y < lms[6].y && lms[8].y < lms[5].y;
  const othersFolded = [
    lms[12].y > lms[10].y && lms[12].y > lms[9].y,
    lms[16].y > lms[14].y && lms[16].y > lms[13].y,
    lms[20].y > lms[18].y && lms[20].y > lms[17].y,
  ].every(Boolean);
  const thumbNotUp =
    lms[4].y > lms[3].y || Math.abs(lms[4].x - lms[3].x) < 0.06;
  return indexUp && othersFolded;
}

// ── 장풍: 손바닥 크기로 근접 감지 ───────────────────────────
// 손 크기 히스토리로 빠르게 카메라에 다가오는지 감지
const palmSizeHistory = []; // {size, time}[]
const PALM_HISTORY_MS = 400;

function updatePalmHistory(lms, now) {
  const sz = handSize(lms);
  palmSizeHistory.push({ size: sz, time: now });
  const cutoff = now - PALM_HISTORY_MS;
  while (palmSizeHistory.length > 0 && palmSizeHistory[0].time < cutoff)
    palmSizeHistory.shift();
  return sz;
}

// 장풍 조건: 열린 손바닥이면서 빠르게 카메라에 다가오고 + 손이 충분히 큼
function detectBlast(lms, now) {
  if (!isOpenPalm(lms)) return false;
  const sz = handSize(lms);
  if (sz < 0.18) return false; // 충분히 가까워야 함
  if (palmSizeHistory.length < 3) return false;
  const oldest = palmSizeHistory[0];
  const growRate = (sz - oldest.size) / ((now - oldest.time) / 1000);
  // 빠르게 커지고 있어야 함 (밀어오는 동작)
  return growRate > 0.15;
}

// ── 원 제스처 감지 ────────────────────────────────────────
const indexTrail = []; // {x,y,time}[]
const TRAIL_DURATION = 1400;
const CIRCLE_MIN_POINTS = 16;

function updateIndexTrail(lms, now) {
  const tip = lms[8];
  indexTrail.push({ x: tip.x, y: tip.y, time: now });
  const cutoff = now - TRAIL_DURATION;
  while (indexTrail.length > 0 && indexTrail[0].time < cutoff)
    indexTrail.shift();
}
function detectPoke(lms, now) {
  if (indexTrail.length < 2) return false;

  const current = lms[8]; // 현재 검지 끝
  const prev = indexTrail[indexTrail.length - 2]; // 이전 검지 위치

  // 프레임 간 이동 거리
  const dx = current.x - prev.x;
  const dy = current.y - prev.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  return dist > 0.06;
}

// ── 두손 하트───────────────────────────────
function isTwoHandHeart(lmsArr) {
  if (lmsArr.length < 2) return false;
  const [lms1, lms2] = lmsArr;

  const indexDist = Math.hypot(lms1[8].x - lms2[8].x, lms1[8].y - lms2[8].y);

  const thumbDist = Math.hypot(lms1[4].x - lms2[4].x, lms1[4].y - lms2[4].y);

  const center1 = {
    x: lms1.reduce((s, p) => s + p.x, 0) / lms1.length,
    y: lms1.reduce((s, p) => s + p.y, 0) / lms1.length,
  };
  const center2 = {
    x: lms2.reduce((s, p) => s + p.x, 0) / lms2.length,
    y: lms2.reduce((s, p) => s + p.y, 0) / lms2.length,
  };
  const centerDist = Math.hypot(center1.x - center2.x, center1.y - center2.y);

  return indexDist < 0.16 && thumbDist < 0.18 && centerDist < 0.35;
}

// ── 두손 따봉 ───────────────────────────────
function isTwoHandThumbs(lmsArr) {
  if (lmsArr.length < 2) return false;
  return lmsArr.every((lms) => isThumbsUp(lms));
}

// ── 던지기 상태머신 ──────────────────────────────────────────
// open → [주먹 쥠: grab] → [빠르게 개방: throw]
// 각 손별로 상태 관리
const throwState = { phase: "idle" }; // idle | open_seen | grabbed
let throwGrabTime = 0;
const THROW_GRAB_TIMEOUT = 2000; // ms: grab 후 2초 내 던져야

// ─── 쿨다운 ──────────────────────────────────────────────────
const CD = { blast: 0, grab: 0, thumbs: 0, heart: 0, spin: 0 };
const CD_TIME = {
  blast: 2.0,
  grab: 0.3,
  thumbs: 3.0,
  heart: 3.0,
  spin: 3.0,
};

// 연속 프레임 카운터 (더 안정적인 인식을 위해)
// 각 제스처가 N프레임 연속으로 감지돼야 발동
const frameCount = { thumbs: 0, heart: 0 };
const FRAME_THRESHOLD = { thumbs: 3, heart: 3 }; // N프레임 연속

let prev = {
  fist: false,
  open: false,
  thumbs: false,
  index: false,
  twoHeart: false,
  twoThumbs: false,
};
let frameLock = false;

const getLandmarkPos = (lm) =>
  new THREE.Vector3((0.5 - lm.x) * 14, (0.5 - lm.y) * 10 + 2, 4);
const getCenter = (lms) => ({
  x: lms.reduce((s, l) => s + l.x, 0) / lms.length,
  y: lms.reduce((s, l) => s + l.y, 0) / lms.length,
});

function onHandResults(results) {
  handCanvas.width = webcam.videoWidth || 640;
  handCanvas.height = webcam.videoHeight || 480;
  hctx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  hctx.save();
  hctx.scale(-1, 1);
  hctx.translate(-handCanvas.width, 0);

  const now = performance.now();
  const dt2 = 0.033;
  for (const k in CD) {
    if (CD[k] > 0) CD[k] -= dt2;
  }
  frameLock = false;

  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    if (isGrabbed) {
      isGrabbed = false;
      throwState.phase = "idle";
      gateState = "returning";
      returnTimer = 0;
    }

    // 손이 사라졌는데 빙글 상태면 회전 종료
    if (gateState === "spinning") {
      spinActive = false;
      gateState = "returning";
      returnTimer = 0;

      stopSpinSound();
    }

    isSpinningMode = false;
    throwState.phase = "idle";
    frameCount.thumbs = 0;
    frameCount.heart = 0;
    prev = {
      fist: false,
      open: false,
      thumbs: false,
      index: false,
      twoHeart: false,
      twoThumbs: false,
    };
    indexTrail.length = 0;
    palmSizeHistory.length = 0;
    hctx.restore();
    setStatus("손을 카메라에 보여주세요! 👋");
    blastChargeEl.style.opacity = "0";
    return;
  }

  const allLms = results.multiHandLandmarks;
  for (const lms of allLms) drawHand(lms);

  // ── 두 손 제스처 먼저 (높은 우선순위) ─────────────────
  const twoHeart = isTwoHandHeart(allLms);
  const twoThumbs = isTwoHandThumbs(allLms);

  // 두손 하트: N프레임 연속 유지해야 발동
  if (twoHeart) {
    frameCount.heart++;
  } else {
    frameCount.heart = Math.max(0, frameCount.heart - 2); // 빠르게 감소
  }
  if (
    frameCount.heart >= FRAME_THRESHOLD.heart &&
    CD.heart <= 0 &&
    !frameLock &&
    gateState === "idle"
  ) {
    doHeart();
    CD.heart = CD_TIME.heart;
    frameLock = true;
    frameCount.heart = 0;
  }
  prev.twoHeart = twoHeart;

  // 두손 따봉: N프레임 연속 유지해야 발동
  // 두손 따봉: N프레임 연속 유지해야 발동
  if (twoThumbs) {
    frameCount.thumbs++;
  }

  if (
    !frameLock &&
    frameCount.thumbs >= FRAME_THRESHOLD.thumbs &&
    CD.thumbs <= 0 &&
    gateState === "idle"
  ) {
    doThumbs();
    CD.thumbs = CD_TIME.thumbs;
    frameLock = true;
    frameCount.thumbs = 0;
  }

  prev.twoThumbs = twoThumbs;

  if (
    !frameLock &&
    frameCount.thumbs >= FRAME_THRESHOLD.thumbs &&
    CD.thumbs <= 0 &&
    gateState === "idle"
  ) {
    doThumbs();
    CD.thumbs = CD_TIME.thumbs;
    frameLock = true;
    frameCount.thumbs = 0;
  }

  prev.twoThumbs = twoThumbs;

  // ── 단일 손 제스처 ──────────────────────────────────────
  if (!frameLock && allLms.length > 0) {
    const lms = allLms[0];
    const center = getCenter(lms);
    const worldPos = getLandmarkPos(center);
    handVelocity3D.copy(worldPos).sub(prevHandPos).divideScalar(dt2);
    prevHandPos.copy(worldPos);
    handWorldPos3D.copy(worldPos);

    const fist = isFist(lms);
    const open = isOpenPalm(lms);
    const indexOnly = isIndexPointing(lms);
    const palmSz = updatePalmHistory(lms, now);
    const thumbsUp = isThumbsUp(lms);
    if (thumbsUp && !twoThumbs) {
      frameCount.thumbs++;
    } else if (!twoThumbs) {
      frameCount.thumbs = 0;
    }

    // 빙글 (검지 + 원 감지)
    // 빙글
    if (indexOnly) {
      updateIndexTrail(lms, now);

      if (!isSpinningMode && CD.spin <= 0 && gateState === "idle") {
        isSpinningMode = true;
        spinStartTime = now;
        doSpin();
      }
    } else {
      indexTrail.length = 0;
      isSpinningMode = false;
      blastChargeEl.style.opacity = "0";

      // 이게 중요
      if (gateState === "spinning") {
        spinActive = false;
        gateState = "returning";
        returnTimer = 0;
        stopSpinSound();
      }
    }

    // 톡 감지
    if (
      !frameLock &&
      isSpinningMode &&
      gateState === "spinning" &&
      now - spinStartTime > SPIN_POKE_DELAY
    ) {
      const indexTip = lms[8];

      if (detectPoke(lms, now)) {
        doPokeFly(indexTip.x);

        stopSpinSound();

        CD.blast = CD_TIME.blast;
        isSpinningMode = false;
        indexTrail.length = 0;
        frameLock = true;
        blastChargeEl.style.opacity = "0";
      } else {
        blastChargeEl.style.opacity = "1";
        blastChargeFillEl.style.width = "100%";
      }
    }

    // ── 장풍: 손바닥 밀기 (근접 감지) ───────────────────
    // idle 상태이고 손이 던지기 모션 중이 아닐 때만
    if (
      !frameLock &&
      !isGrabbed &&
      CD.blast <= 0 &&
      gateState === "idle" &&
      !twoHeart &&
      !twoThumbs
    ) {
      if (detectBlast(lms, now)) {
        // 장풍 차지 인디케이터 표시
        const chargeLevel = Math.min(1, (palmSz - 0.18) / 0.12);
        blastChargeEl.style.opacity = "1";
        blastChargeFillEl.style.width = chargeLevel * 100 + "%";
        if (palmSz > 0.25) {
          // 충분히 가까울 때 발사
          doBlast(center.x);
          CD.blast = CD_TIME.blast;
          palmSizeHistory.length = 0;
          blastChargeEl.style.opacity = "0";
          frameLock = true;
        }
      } else {
        blastChargeEl.style.opacity = "0";
      }
    }

    // 디버그
    const throwPhaseStr = throwState.phase;
    const gestureName = fist
      ? "주먹"
      : open
        ? "손바닥"
        : indexOnly
          ? "검지"
          : "기타";
    const blastStatus = detectBlast(lms, now)
      ? `🟡차징(${palmSz.toFixed(2)})`
      : "";
    setDebug(
      `손:${gestureName} | 던지기:${throwPhaseStr} | 상태:${gateState} ${blastStatus} | 따봉:${frameCount.thumbs}f | 하트:${frameCount.heart}f`,
    );

    prev.fist = fist;
    prev.open = open;
    prev.index = indexOnly;
  } else if (!frameLock) {
    blastChargeEl.style.opacity = "0";
  }

  hctx.restore();
}

function drawHand(lms) {
  const W = handCanvas.width,
    H = handCanvas.height;
  const conn = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [0, 9],
    [9, 10],
    [10, 11],
    [11, 12],
    [0, 13],
    [13, 14],
    [14, 15],
    [15, 16],
    [0, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [5, 9],
    [9, 13],
    [13, 17],
  ];
  hctx.strokeStyle = "rgba(200,220,255,0.8)";
  hctx.lineWidth = 2;
  for (const [a, b] of conn) {
    hctx.beginPath();
    hctx.moveTo(lms[a].x * W, lms[a].y * H);
    hctx.lineTo(lms[b].x * W, lms[b].y * H);
    hctx.stroke();
  }
  for (const lm of lms) {
    hctx.beginPath();
    hctx.arc(lm.x * W, lm.y * H, 4, 0, Math.PI * 2);
    hctx.fillStyle = "#c8dcff";
    hctx.fill();
  }
}

window.addEventListener("load", () => {
  const guide = document.getElementById("gestureGuide");
  const h3 = document.querySelector("#gestureGuide h3");
  if (window.innerWidth <= 768) {
    guide.style.width = h3.scrollWidth + 24 + "px";
  }
});

// 모바일 제스처 가이드 드롭다운
document.getElementById("gestureBtn")?.addEventListener("click", () => {
  document.getElementById("gestureModal").classList.add("open");
});

document.getElementById("gestureClose")?.addEventListener("click", () => {
  document.getElementById("gestureModal").classList.remove("open");
});

document.getElementById("gestureModal")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("gestureModal")) {
    document.getElementById("gestureModal").classList.remove("open");
  }
});
