import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  WorkforceActor,
  WorkforceActorState,
  WorkforceCapability,
} from "./client";
import "./WorkforceThreeScene.css";

interface WorkforceThreeSceneProps {
  actors: WorkforceActor[];
  selectedId: string | null;
  cameraMode: "overview" | "focus";
  reduced: boolean;
  label: string;
  hint: string;
  unavailable: string;
  onSelectActor: (actorId: string) => void;
  onUnavailable: () => void;
}

interface Seat3D {
  x: number;
  z: number;
  zone: "lead" | "build" | "create" | "evidence" | "delivery";
}

const SEATS_3D: readonly Seat3D[] = [
  { x: 0, z: 0.2, zone: "lead" },
  { x: -5.7, z: -3.3, zone: "build" },
  { x: -3.6, z: -3.3, zone: "build" },
  { x: -5.7, z: -1.1, zone: "build" },
  { x: -3.6, z: -1.1, zone: "build" },
  { x: 3.6, z: -3.3, zone: "create" },
  { x: 5.7, z: -3.3, zone: "create" },
  { x: 3.6, z: -1.1, zone: "create" },
  { x: 5.7, z: -1.1, zone: "create" },
  { x: -5.7, z: 1.6, zone: "evidence" },
  { x: -3.6, z: 1.6, zone: "evidence" },
  { x: -5.7, z: 3.8, zone: "evidence" },
  { x: -3.6, z: 3.8, zone: "evidence" },
  { x: 3.6, z: 1.6, zone: "delivery" },
  { x: 5.7, z: 1.6, zone: "delivery" },
  { x: 3.6, z: 3.8, zone: "delivery" },
  { x: 5.7, z: 3.8, zone: "delivery" },
  { x: -7.6, z: -3.3, zone: "build" },
  { x: 7.6, z: -3.3, zone: "create" },
  { x: -7.6, z: 1.6, zone: "evidence" },
  { x: 7.6, z: 1.6, zone: "delivery" },
  { x: -7.6, z: 3.8, zone: "evidence" },
  { x: 7.6, z: 3.8, zone: "delivery" },
  { x: 0, z: 3.9, zone: "delivery" },
];

const CAPABILITY_VISUALS: Record<WorkforceCapability, { color: number; zone: Seat3D["zone"] }> = {
  orchestration: { color: 0xff655c, zone: "lead" },
  files: { color: 0xd9c29b, zone: "evidence" },
  code: { color: 0xf3a83b, zone: "build" },
  browser: { color: 0x4d91e8, zone: "build" },
  research: { color: 0x63b9ee, zone: "evidence" },
  design: { color: 0xaa7be8, zone: "create" },
  office: { color: 0x7885e5, zone: "create" },
  communication: { color: 0x52b8b1, zone: "delivery" },
  other: { color: 0xa3aaa8, zone: "delivery" },
};

const STATE_COLORS: Record<WorkforceActorState, number> = {
  queued: 0xf3a83b,
  working: 0xff655c,
  waiting: 0xefb85c,
  paused: 0xb4aaa2,
  blocked: 0xef716a,
  completed: 0x79c999,
  failed: 0xef716a,
  cancelled: 0x777d7c,
};

const OVERVIEW_POSITION = new Vector3(11.6, 10.2, 15.4);
const OVERVIEW_TARGET = new Vector3(0, 0.7, 0.2);
const FRAME_INTERVAL = 1000 / 30;

interface ActorRig {
  actorId: string;
  capability: WorkforceCapability;
  group: Group;
  character: Group;
  rightArm: Group;
  screenMaterial: MeshStandardMaterial;
  stateMaterial: MeshStandardMaterial;
  selectionMaterial: MeshStandardMaterial;
  state: WorkforceActorState;
  phase: number;
}

interface OfficeRuntime {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  office: Group;
  rigs: Map<string, ActorRig>;
  raycaster: Raycaster;
  pointer: Vector2;
  cameraGoal: Vector3;
  targetGoal: Vector3;
  cameraAnimating: boolean;
  reduced: boolean;
  visible: boolean;
  hasWorkingActors: boolean;
  lastFrameAt: number;
  raf: number;
  requestRender: () => void;
  dispose: () => void;
}

function material(color: number, emissive = 0x000000): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.45 : 0,
    metalness: 0.34,
    roughness: 0.62,
  });
}

function box(width: number, height: number, depth: number, color: number, emissive = 0x000000): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material(color, emissive));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(radiusTop: number, radiusBottom: number, height: number, color: number, segments = 16): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material(color),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function labelSprite(text: string, accent = "#8f9899", scale = 1): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(11, 14, 16, 0.88)";
    context.fillRect(3, 20, 506, 88);
    context.strokeStyle = "rgba(121, 132, 133, 0.55)";
    context.lineWidth = 3;
    context.strokeRect(3, 20, 506, 88);
    context.fillStyle = accent;
    context.fillRect(3, 20, 12, 88);
    context.fillStyle = "#f3eee7";
    context.font = "700 34px Avenir Next, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 263, 65, 456);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.35 * scale, 0.59 * scale, 1);
  return sprite;
}

function addRoomLabel(room: Group, text: string, position: Vector3, color: string, scale = 1): void {
  const sprite = labelSprite(text, color, scale);
  sprite.position.copy(position);
  room.add(sprite);
}

function createPlant(): Group {
  const plant = new Group();
  const pot = cylinder(0.25, 0.34, 0.48, 0x252b2d, 12);
  pot.position.y = 0.24;
  plant.add(pot);
  for (let index = 0; index < 5; index++) {
    const leaf = new Mesh(new ConeGeometry(0.22, 0.86, 6), material(index % 2 ? 0x496f58 : 0x315542));
    leaf.position.set(Math.sin(index * 1.7) * 0.18, 0.86 + (index % 2) * 0.13, Math.cos(index * 1.7) * 0.18);
    leaf.rotation.z = Math.sin(index) * 0.36;
    plant.add(leaf);
  }
  return plant;
}

function createRoom(): Group {
  const room = new Group();
  room.name = "Hara Agent Office";

  const floor = new Mesh(
    new PlaneGeometry(20, 13),
    new MeshStandardMaterial({ color: 0x141a1c, metalness: 0.2, roughness: 0.84, side: DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);

  const grid = new GridHelper(20, 20, 0x394244, 0x252c2e);
  const gridMaterial = grid.material as Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.48;
  grid.position.y = 0.012;
  room.add(grid);

  const backWall = box(20, 6.4, 0.18, 0x171d20);
  backWall.position.set(0, 3.2, -6.45);
  room.add(backWall);
  const sideWall = box(0.18, 6.4, 13, 0x111719);
  sideWall.position.set(-10.05, 3.2, 0);
  room.add(sideWall);

  const windowMaterial = new MeshStandardMaterial({
    color: 0x19313a,
    emissive: 0x245166,
    emissiveIntensity: 0.28,
    metalness: 0.18,
    roughness: 0.25,
  });
  for (const x of [-6.7, -3.9, 3.9, 6.7]) {
    const window = new Mesh(new PlaneGeometry(2.25, 2.45), windowMaterial.clone());
    window.position.set(x, 3.45, -6.34);
    room.add(window);
    const divider = box(0.035, 2.45, 0.03, 0x66818a);
    divider.position.set(x, 3.45, -6.27);
    room.add(divider);
  }

  const sign = labelSprite("HARA / LIVE WORKFORCE", "#ff655c", 1.38);
  sign.position.set(0, 4.55, -6.18);
  room.add(sign);

  const standupTop = new Mesh(new CylinderGeometry(1.3, 1.3, 0.16, 32), material(0x303739));
  standupTop.position.set(0, 1.04, 0.1);
  standupTop.castShadow = true;
  room.add(standupTop);
  const standupBase = cylinder(0.28, 0.52, 1, 0x202729, 18);
  standupBase.position.set(0, 0.5, 0.1);
  room.add(standupBase);
  const standupSignal = new Mesh(
    new TorusGeometry(0.78, 0.025, 8, 48),
    new MeshStandardMaterial({ color: 0xff655c, emissive: 0xff655c, emissiveIntensity: 1.1 }),
  );
  standupSignal.rotation.x = Math.PI / 2;
  standupSignal.position.set(0, 1.14, 0.1);
  room.add(standupSignal);

  const lounge = box(2.2, 0.64, 0.82, 0x282e31);
  lounge.position.set(-7.45, 0.4, -5.2);
  room.add(lounge);
  const loungeBack = box(2.2, 0.72, 0.18, 0x333a3d);
  loungeBack.position.set(-7.45, 0.82, -5.57);
  room.add(loungeBack);

  const plantOne = createPlant();
  plantOne.position.set(8.8, 0, -5.55);
  room.add(plantOne);
  const plantTwo = createPlant();
  plantTwo.position.set(-9.15, 0, 5.35);
  room.add(plantTwo);

  addRoomLabel(room, "BUILD", new Vector3(-4.65, 0.055, -5.05), "#f3a83b", 0.76);
  addRoomLabel(room, "CREATE", new Vector3(4.65, 0.055, -5.05), "#aa7be8", 0.76);
  addRoomLabel(room, "EVIDENCE", new Vector3(-4.65, 0.055, 5.45), "#63b9ee", 0.76);
  addRoomLabel(room, "DELIVERY", new Vector3(4.65, 0.055, 5.45), "#52b8b1", 0.76);
  return room;
}

function createTool(capability: WorkforceCapability, accent: number): Group {
  const tool = new Group();
  const accentMaterial = material(accent, accent);
  accentMaterial.emissiveIntensity = 0.38;
  const metal = material(0xaeb5b5);

  if (capability === "code") {
    const handle = new Mesh(new CylinderGeometry(0.035, 0.035, 0.58, 8), material(0x9b6b43));
    handle.rotation.z = -0.55;
    const head = new Mesh(new BoxGeometry(0.36, 0.16, 0.18), metal);
    head.position.set(-0.15, 0.25, 0);
    head.rotation.z = -0.55;
    tool.add(handle, head);
  } else if (capability === "browser" || capability === "communication") {
    const headset = new Mesh(new TorusGeometry(0.23, 0.045, 8, 24, Math.PI), accentMaterial);
    headset.rotation.z = Math.PI;
    tool.add(headset);
  } else if (capability === "research") {
    const lens = new Mesh(new TorusGeometry(0.16, 0.035, 8, 24), accentMaterial);
    const handle = new Mesh(new CylinderGeometry(0.025, 0.025, 0.34, 8), metal);
    handle.position.set(0.16, -0.18, 0);
    handle.rotation.z = -0.7;
    tool.add(lens, handle);
  } else if (capability === "design") {
    const palette = new Mesh(new SphereGeometry(0.22, 16, 12), accentMaterial);
    palette.scale.set(1.25, 0.72, 0.28);
    const brush = new Mesh(new CylinderGeometry(0.022, 0.022, 0.48, 8), material(0xcda36c));
    brush.position.set(0.18, 0.12, 0);
    brush.rotation.z = 0.7;
    tool.add(palette, brush);
  } else if (capability === "files") {
    const folder = new Mesh(new BoxGeometry(0.42, 0.28, 0.12), accentMaterial);
    const tab = new Mesh(new BoxGeometry(0.19, 0.08, 0.13), accentMaterial.clone());
    tab.position.set(-0.1, 0.17, 0);
    tool.add(folder, tab);
  } else if (capability === "office") {
    const page = new Mesh(new BoxGeometry(0.32, 0.42, 0.055), accentMaterial);
    const line = new Mesh(new BoxGeometry(0.18, 0.025, 0.02), metal);
    line.position.set(0, 0.06, 0.04);
    tool.add(page, line);
  } else if (capability === "orchestration") {
    const baton = new Mesh(new CylinderGeometry(0.03, 0.04, 0.54, 8), accentMaterial);
    baton.rotation.z = -0.8;
    tool.add(baton);
  } else {
    const token = new Mesh(new SphereGeometry(0.18, 12, 10), accentMaterial);
    tool.add(token);
  }

  tool.position.set(0.58, 1.32, -0.38);
  tool.rotation.y = -0.2;
  return tool;
}

function createActorRig(actor: WorkforceActor): ActorRig {
  const accent = CAPABILITY_VISUALS[actor.capability].color;
  const group = new Group();
  group.userData.actorId = actor.actorId;

  const desk = new Group();
  const desktop = box(1.72, 0.12, 0.72, 0x31383a);
  desktop.position.y = 1.02;
  desk.add(desktop);
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.23, 0.23]) {
      const leg = box(0.08, 0.94, 0.08, 0x444c4e);
      leg.position.set(x, 0.52, z);
      desk.add(leg);
    }
  }
  const monitor = box(0.72, 0.46, 0.08, 0x151a1c);
  monitor.position.set(0, 1.43, -0.1);
  desk.add(monitor);
  const screenMaterial = new MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.72,
    metalness: 0.05,
    roughness: 0.4,
  });
  const screen = new Mesh(new PlaneGeometry(0.59, 0.33), screenMaterial);
  screen.position.set(0, 1.43, -0.055);
  desk.add(screen);
  const stand = box(0.08, 0.3, 0.08, 0x596164);
  stand.position.set(0, 1.17, -0.1);
  desk.add(stand);
  group.add(desk);

  const character = new Group();
  character.position.set(0, 1.08, -0.56);
  const body = new Mesh(new SphereGeometry(0.31, 20, 14), material(0x171a1c));
  body.scale.set(0.86, 1.18, 0.72);
  body.position.y = 0.48;
  character.add(body);
  const head = new Mesh(new SphereGeometry(0.36, 24, 16), material(0x1b1e20));
  head.scale.set(1.06, 0.9, 0.88);
  head.position.y = 1.08;
  character.add(head);
  for (const x of [-0.25, 0.25]) {
    const ear = new Mesh(new ConeGeometry(0.12, 0.23, 10), material(0x24282a));
    ear.position.set(x, 1.4, -0.02);
    ear.rotation.z = x < 0 ? -0.35 : 0.35;
    character.add(ear);
    const eye = new Mesh(
      new SphereGeometry(0.046, 12, 8),
      new MeshStandardMaterial({ color: 0xf7f3ea, emissive: 0xf7f3ea, emissiveIntensity: 1.35 }),
    );
    eye.position.set(x * 0.58, 1.1, 0.31);
    character.add(eye);
  }
  const chest = new Mesh(
    new RingGeometry(0.1, 0.14, 4),
    new MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.85, side: DoubleSide }),
  );
  chest.position.set(0, 0.5, 0.25);
  chest.rotation.z = Math.PI / 4;
  character.add(chest);
  const leftArm = new Group();
  const leftArmMesh = new Mesh(new CylinderGeometry(0.055, 0.065, 0.46, 8), material(0x222628));
  leftArmMesh.rotation.z = -0.18;
  leftArm.add(leftArmMesh);
  leftArm.position.set(-0.35, 0.58, 0);
  character.add(leftArm);
  const rightArm = new Group();
  const rightArmMesh = new Mesh(new CylinderGeometry(0.055, 0.065, 0.46, 8), material(0x222628));
  rightArmMesh.rotation.z = 0.18;
  rightArm.add(rightArmMesh);
  rightArm.position.set(0.35, 0.58, 0);
  character.add(rightArm);
  group.add(character);
  group.add(createTool(actor.capability, accent));

  const stateMaterial = new MeshStandardMaterial({
    color: STATE_COLORS[actor.state],
    emissive: STATE_COLORS[actor.state],
    emissiveIntensity: 0.82,
    transparent: true,
    opacity: 0.74,
    side: DoubleSide,
  });
  const stateRing = new Mesh(new RingGeometry(0.69, 0.76, 40), stateMaterial);
  stateRing.rotation.x = -Math.PI / 2;
  stateRing.position.y = 0.025;
  group.add(stateRing);
  const selectionMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: accent,
    emissiveIntensity: 1.2,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
  });
  const selectionRing = new Mesh(new RingGeometry(0.86, 0.91, 48), selectionMaterial);
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.035;
  group.add(selectionRing);

  const caption = labelSprite(
    actor.kind === "root" ? "HARA LEAD" : actor.capability.toUpperCase(),
    `#${accent.toString(16).padStart(6, "0")}`,
    0.72,
  );
  caption.position.set(0, 2.66, -0.08);
  group.add(caption);
  group.traverse((child) => {
    child.userData.actorId = actor.actorId;
  });
  return {
    actorId: actor.actorId,
    capability: actor.capability,
    group,
    character,
    rightArm,
    screenMaterial,
    stateMaterial,
    selectionMaterial,
    state: actor.state,
    phase: [...actor.actorId].reduce((value, character) => value + character.charCodeAt(0), 0) % 628 / 100,
  };
}

function stableActorHash(actorId: string): number {
  let value = 2166136261;
  for (const character of actorId) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const resource = object as Object3D & {
      geometry?: { dispose: () => void };
      material?: Material | Material[];
    };
    resource.geometry?.dispose();
    const materials = Array.isArray(resource.material) ? resource.material : resource.material ? [resource.material] : [];
    for (const current of materials) {
      const mapped = current as Material & { map?: { dispose: () => void } | null };
      mapped.map?.dispose();
      current.dispose();
    }
  });
}

function positionActors(runtime: OfficeRuntime, actors: WorkforceActor[]): void {
  const remaining = [...SEATS_3D];
  const positioned = actors
    .slice(0, SEATS_3D.length)
    .sort((left, right) => {
      if (left.kind === "root" && right.kind !== "root") return -1;
      if (right.kind === "root" && left.kind !== "root") return 1;
      return stableActorHash(left.actorId) - stableActorHash(right.actorId)
        || left.actorId.localeCompare(right.actorId);
    });
  positioned.forEach((actor) => {
    const visual = CAPABILITY_VISUALS[actor.capability];
    const desiredZone = actor.kind === "root" ? "lead" : visual.zone;
    const matchingIndices = remaining
      .map((seat, index) => seat.zone === desiredZone ? index : -1)
      .filter((index) => index >= 0);
    const seatIndex = matchingIndices.length > 0
      ? matchingIndices[stableActorHash(actor.actorId) % matchingIndices.length]
      : stableActorHash(actor.actorId) % remaining.length;
    const [seat] = remaining.splice(seatIndex, 1);
    let rig = runtime.rigs.get(actor.actorId);
    if (rig && rig.capability !== actor.capability) {
      runtime.office.remove(rig.group);
      disposeObject(rig.group);
      runtime.rigs.delete(actor.actorId);
      rig = undefined;
    }
    if (!rig) {
      rig = createActorRig(actor);
      runtime.rigs.set(actor.actorId, rig);
      runtime.office.add(rig.group);
    }
    rig.group.position.set(seat.x, 0, seat.z);
    rig.state = actor.state;
    const stateColor = STATE_COLORS[actor.state];
    rig.stateMaterial.color.setHex(stateColor);
    rig.stateMaterial.emissive.setHex(stateColor);
    rig.stateMaterial.opacity = actor.state === "cancelled" ? 0.28 : 0.74;
    const accent = CAPABILITY_VISUALS[actor.capability].color;
    rig.screenMaterial.color.setHex(accent);
    rig.screenMaterial.emissive.setHex(actor.state === "failed" || actor.state === "blocked" ? stateColor : accent);
    rig.screenMaterial.emissiveIntensity = actor.state === "working" ? 1.05 : 0.5;
  });

  const liveIds = new Set(positioned.map((actor) => actor.actorId));
  for (const [actorId, rig] of runtime.rigs) {
    if (liveIds.has(actorId)) continue;
    runtime.office.remove(rig.group);
    disposeObject(rig.group);
    runtime.rigs.delete(actorId);
  }
  runtime.hasWorkingActors = actors.some((actor) => actor.state === "working");
}

function selectActor(runtime: OfficeRuntime, actorId: string | null): void {
  for (const rig of runtime.rigs.values()) {
    rig.selectionMaterial.opacity = rig.actorId === actorId ? 0.94 : 0;
  }
}

function moveCamera(
  runtime: OfficeRuntime,
  mode: "overview" | "focus",
  selectedId: string | null,
  reduced: boolean,
): void {
  const selected = selectedId ? runtime.rigs.get(selectedId) : undefined;
  if (mode === "focus" && selected) {
    runtime.cameraGoal.set(
      selected.group.position.x + 2.8,
      3.7,
      selected.group.position.z + 4.35,
    );
    runtime.targetGoal.set(selected.group.position.x, 1.05, selected.group.position.z);
  } else {
    runtime.cameraGoal.copy(OVERVIEW_POSITION);
    runtime.targetGoal.copy(OVERVIEW_TARGET);
  }
  runtime.reduced = reduced;
  if (reduced) {
    runtime.camera.position.copy(runtime.cameraGoal);
    runtime.controls.target.copy(runtime.targetGoal);
    runtime.cameraAnimating = false;
  } else {
    runtime.cameraAnimating = true;
  }
  runtime.requestRender();
}

function createRuntime(host: HTMLDivElement, label: string, selectRef: { current: (actorId: string) => void }): OfficeRuntime {
  const width = Math.max(host.clientWidth, 320);
  const height = Math.max(host.clientHeight, 320);
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", label);
  renderer.domElement.tabIndex = 0;
  host.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x090c0e);
  scene.fog = new Fog(0x090c0e, 15, 30);
  const camera = new PerspectiveCamera(42, width / height, 0.1, 80);
  camera.position.copy(OVERVIEW_POSITION);
  camera.lookAt(OVERVIEW_TARGET);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(OVERVIEW_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 4.5;
  controls.maxDistance = 25;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = true;
  controls.screenSpacePanning = false;

  scene.add(new HemisphereLight(0xbddce5, 0x090a0b, 1.75));
  const keyLight = new DirectionalLight(0xffeee3, 2.2);
  keyLight.position.set(7, 11, 9);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 10;
  keyLight.shadow.camera.bottom = -10;
  scene.add(keyLight);
  const haraLight = new PointLight(0xff655c, 18, 13, 2);
  haraLight.position.set(0, 3.2, -1.7);
  scene.add(haraLight);
  const coolLight = new PointLight(0x4d91e8, 10, 12, 2);
  coolLight.position.set(-6, 3.6, 2.5);
  scene.add(coolLight);

  const office = createRoom();
  scene.add(office);
  const runtime: OfficeRuntime = {
    scene,
    camera,
    renderer,
    controls,
    office,
    rigs: new Map<string, ActorRig>(),
    raycaster: new Raycaster(),
    pointer: new Vector2(),
    cameraGoal: OVERVIEW_POSITION.clone(),
    targetGoal: OVERVIEW_TARGET.clone(),
    cameraAnimating: false,
    reduced: false,
    visible: true,
    hasWorkingActors: false,
    lastFrameAt: 0,
    raf: 0,
    requestRender: () => undefined,
    dispose: () => undefined,
  };

  const renderFrame = (time: number) => {
    runtime.raf = 0;
    if (!runtime.visible) return;
    if (runtime.lastFrameAt && time - runtime.lastFrameAt < FRAME_INTERVAL) {
      runtime.requestRender();
      return;
    }
    runtime.lastFrameAt = time;
    let active = false;
    if (runtime.cameraAnimating) {
      runtime.camera.position.lerp(runtime.cameraGoal, 0.105);
      runtime.controls.target.lerp(runtime.targetGoal, 0.115);
      if (
        runtime.camera.position.distanceTo(runtime.cameraGoal) < 0.025
        && runtime.controls.target.distanceTo(runtime.targetGoal) < 0.018
      ) {
        runtime.camera.position.copy(runtime.cameraGoal);
        runtime.controls.target.copy(runtime.targetGoal);
        runtime.cameraAnimating = false;
      } else {
        active = true;
      }
    }
    if (!runtime.reduced) {
      for (const rig of runtime.rigs.values()) {
        if (rig.state !== "working") {
          rig.character.position.y = 1.08;
          rig.character.rotation.y = 0;
          rig.rightArm.rotation.z = 0;
          continue;
        }
        const beat = time * 0.0045 + rig.phase;
        rig.character.position.y = 1.08 + Math.sin(beat) * 0.045;
        rig.character.rotation.y = Math.sin(beat * 0.58) * 0.045;
        rig.rightArm.rotation.z = Math.sin(beat * 1.7) * 0.28;
        rig.screenMaterial.emissiveIntensity = 0.88 + Math.sin(beat) * 0.24;
        active = true;
      }
    }
    const controlsChanged = runtime.controls.update();
    runtime.renderer.render(runtime.scene, runtime.camera);
    if (active || controlsChanged || (runtime.hasWorkingActors && !runtime.reduced)) runtime.requestRender();
  };
  runtime.requestRender = () => {
    if (!runtime.visible || runtime.raf) return;
    runtime.raf = window.requestAnimationFrame(renderFrame);
  };

  const resize = () => {
    const nextWidth = Math.max(host.clientWidth, 320);
    const nextHeight = Math.max(host.clientHeight, 320);
    runtime.camera.aspect = nextWidth / nextHeight;
    runtime.camera.updateProjectionMatrix();
    runtime.renderer.setSize(nextWidth, nextHeight, false);
    runtime.requestRender();
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  resizeObserver?.observe(host);
  if (!resizeObserver) window.addEventListener("resize", resize);

  const visibilityChanged = () => {
    runtime.visible = !document.hidden && host.isConnected;
    if (runtime.visible) runtime.requestRender();
    else if (runtime.raf) {
      window.cancelAnimationFrame(runtime.raf);
      runtime.raf = 0;
    }
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  const intersectionObserver = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(([entry]) => {
        runtime.visible = Boolean(entry?.isIntersecting) && !document.hidden;
        if (runtime.visible) runtime.requestRender();
        else if (runtime.raf) {
          window.cancelAnimationFrame(runtime.raf);
          runtime.raf = 0;
        }
      }, { threshold: 0.01 });
  intersectionObserver?.observe(host);

  controls.addEventListener("start", () => {
    runtime.cameraAnimating = false;
  });
  controls.addEventListener("change", runtime.requestRender);

  let pointerDown: { x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) {
      pointerDown = null;
      return;
    }
    pointerDown = null;
    const rect = renderer.domElement.getBoundingClientRect();
    runtime.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    runtime.raycaster.setFromCamera(runtime.pointer, runtime.camera);
    const [hit] = runtime.raycaster.intersectObjects([...runtime.rigs.values()].map((rig) => rig.group), true);
    let object: Object3D | null = hit?.object ?? null;
    while (object && typeof object.userData.actorId !== "string") object = object.parent;
    if (object && typeof object.userData.actorId === "string") selectRef.current(object.userData.actorId);
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  runtime.dispose = () => {
    if (runtime.raf) window.cancelAnimationFrame(runtime.raf);
    resizeObserver?.disconnect();
    if (!resizeObserver) window.removeEventListener("resize", resize);
    intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", visibilityChanged);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    controls.dispose();
    disposeObject(scene);
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  runtime.requestRender();
  return runtime;
}

export default function WorkforceThreeScene({
  actors,
  selectedId,
  cameraMode,
  reduced,
  label,
  hint,
  unavailable,
  onSelectActor,
  onUnavailable,
}: WorkforceThreeSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<OfficeRuntime | null>(null);
  const selectRef = useRef(onSelectActor);
  const unavailableRef = useRef(onUnavailable);
  const [failed, setFailed] = useState(false);
  selectRef.current = onSelectActor;
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      const runtime = createRuntime(host, label, selectRef);
      runtimeRef.current = runtime;
      const contextLost = (event: Event) => {
        event.preventDefault();
        setFailed(true);
        unavailableRef.current();
      };
      runtime.renderer.domElement.addEventListener("webglcontextlost", contextLost);
      return () => {
        runtime.renderer.domElement.removeEventListener("webglcontextlost", contextLost);
        runtimeRef.current = null;
        runtime.dispose();
      };
    } catch {
      setFailed(true);
      unavailableRef.current();
    }
  }, [label]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    positionActors(runtime, actors);
    selectActor(runtime, selectedId);
    moveCamera(runtime, cameraMode, selectedId, reduced);
    runtime.requestRender();
  }, [actors, cameraMode, reduced, selectedId]);

  if (failed) {
    return <div className="workforce-three-failed" role="status">{unavailable}</div>;
  }

  return (
    <div className="workforce-three" data-renderer="webgl">
      <div ref={hostRef} className="workforce-three-canvas" />
      <div className="workforce-three-runtime" aria-hidden>
        <span><i />WEBGL / LOCAL</span>
        <b>{hint}</b>
      </div>
    </div>
  );
}
