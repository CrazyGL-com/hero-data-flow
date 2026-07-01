import * as React from 'react';
import * as THREE from 'three';
import { useHeroAnimationFrame, useHeroAssetGate } from '@crazygl/core';

interface StageProps {
	rootRef: React.RefObject<HTMLElement | null>;
	size: { width: number; height: number; dpr: number };
	input: { x: number; y: number; active: boolean };
	seed: number;
	reducedMotion: boolean;
	screenshot: string;
	screenAspect: number;
	screenScale: number;
	screenTilt: number;
	screenBrightness: number;
	screenshotX: number;
	screenshotY: number;
	particleCount: number;
	particleColor: string;
	accentColor: string;
	flowSpeed: number;
	particleSize: number;
	emissionRate: number;
	showLines: boolean;
	lineOpacity: number;
	lineMaxDistance: number;
	cursorAttract: number;
	cursorBurst: boolean;
	ambientStars: boolean;
}

/* ------------------------------------------------------------------------
   Particle pool — pre-allocated Float32Arrays for positions, velocities,
   ages, lifespans, origins, and color indices. The render geometry shares
   the same backing positions buffer; line geometry shares the same backing
   buffer too.

   Pool size is fixed at MAX_PARTICLES, but the particleCount slider sets
   how many of those are actively driven each frame (via setDrawRange).
   ------------------------------------------------------------------------ */
const MAX_PARTICLES = 1200;

/* ------------------------------------------------------------------------
   Anchor definitions. The screenshot is a 2x1 plane in local space (we
   stretch it via mesh.scale.x / .y to honor `screenAspect`). Anchors are
   declared in NORMALISED panel coordinates [-0.5..+0.5] x [-0.5..+0.5];
   the stage multiplies by the live screen size at use-time so they track
   the screenshot when `screenAspect` / `screenScale` change.

   Layout (14 anchors):
     • 4 corners
     • 4 edge midpoints
     • 3 interior cluster nodes (rule-of-thirds-ish)
     • 3 extra mid-quadrant interior nodes for visual density.
   ------------------------------------------------------------------------ */
type Anchor = { u: number; v: number };
const ANCHORS: Anchor[] = [
	// Corners.
	{ u: -0.5, v: -0.5 },
	{ u:  0.5, v: -0.5 },
	{ u:  0.5, v:  0.5 },
	{ u: -0.5, v:  0.5 },
	// Edge midpoints.
	{ u:  0.0, v: -0.5 },
	{ u:  0.5, v:  0.0 },
	{ u:  0.0, v:  0.5 },
	{ u: -0.5, v:  0.0 },
	// Interior cluster nodes.
	{ u: -0.25, v: -0.18 },
	{ u:  0.30, v: -0.05 },
	{ u: -0.05, v:  0.22 },
	// Extra mid-quadrant nodes.
	{ u:  0.18, v:  0.30 },
	{ u: -0.30, v:  0.15 },
	{ u:  0.10, v: -0.30 },
];

/* ------------------------------------------------------------------------
   Build a small star-field geometry for ambient depth.
   ------------------------------------------------------------------------ */
function makeStarField(count: number): THREE.BufferGeometry {
	const positions = new Float32Array(count * 3);
	// Deterministic pseudo-random — index-based hash, no Math.random() so
	// the layout is stable across resizes / reduced-motion mounts.
	for (let i = 0; i < count; i++) {
		const h1 = Math.sin(i * 12.9898) * 43758.5453;
		const h2 = Math.sin(i * 78.233) * 12345.6789;
		const h3 = Math.sin(i * 31.7142) * 9876.5432;
		// Spread across a wide back-plane box — far behind the screenshot.
		positions[i * 3 + 0] = (h1 - Math.floor(h1)) * 16 - 8;
		positions[i * 3 + 1] = (h2 - Math.floor(h2)) * 10 - 5;
		positions[i * 3 + 2] = -3.5 - (h3 - Math.floor(h3)) * 3.0;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	return geo;
}

export default function FlowStage(props: StageProps) {
	const {
		rootRef,
		size,
		input,
		seed,
		reducedMotion,
		screenshot,
		screenAspect,
		screenScale,
		screenTilt,
		screenBrightness,
		screenshotX,
		screenshotY,
		particleCount,
		particleColor,
		accentColor,
		flowSpeed,
		particleSize,
		emissionRate,
		showLines,
		lineOpacity,
		lineMaxDistance,
		cursorAttract,
		cursorBurst,
		ambientStars,
	} = props;

	const [assetReady, setAssetReady] = React.useState(false);
	useHeroAssetGate(assetReady);

	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
	const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
	const sceneRef = React.useRef<THREE.Scene | null>(null);
	const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
	const screenMeshRef = React.useRef<THREE.Mesh | null>(null);
	const screenMatRef = React.useRef<THREE.MeshStandardMaterial | null>(null);
	const screenTexRef = React.useRef<THREE.Texture | null>(null);
	const pointsRef = React.useRef<THREE.Points | null>(null);
	const pointsGeoRef = React.useRef<THREE.BufferGeometry | null>(null);
	const pointsMatRef = React.useRef<THREE.PointsMaterial | null>(null);
	const linesRef = React.useRef<THREE.LineSegments | null>(null);
	const linesGeoRef = React.useRef<THREE.BufferGeometry | null>(null);
	const linesMatRef = React.useRef<THREE.LineBasicMaterial | null>(null);
	const starsRef = React.useRef<THREE.Points | null>(null);

	// Particle pool — allocated ONCE at mount, reused for the lifetime of
	// the component. No per-frame allocations.
	const posRef = React.useRef<Float32Array | null>(null);     // x,y,z per particle
	const velRef = React.useRef<Float32Array | null>(null);     // vx,vy,vz per particle
	const ageRef = React.useRef<Float32Array | null>(null);     // current age (s)
	const lifeRef = React.useRef<Float32Array | null>(null);    // total lifespan (s)
	const originRef = React.useRef<Float32Array | null>(null);  // ox,oy,oz per particle
	const colorRef = React.useRef<Float32Array | null>(null);   // r,g,b per particle (color attribute)
	const lineColorRef = React.useRef<Float32Array | null>(null); // r,g,b,a × 2 verts per particle, but Three's LineBasicMaterial doesn't support per-vertex alpha — we encode alpha into RGB scale instead.
	const linePosRef = React.useRef<Float32Array | null>(null);   // x,y,z × 2 per particle

	// Per-anchor world position cache — recomputed when screen dimensions
	// change so emission spawns at the right place. Allocated in setup.
	const anchorWorldRef = React.useRef<Float32Array | null>(null);

	// Per-anchor emission accumulator — fractional "budget" so fractional
	// emission rates still produce smooth steady streams. Allocated in the
	// one-time setup effect below.
	const emitAccumRef = React.useRef<Float32Array | null>(null);

	// Cursor world position (raycast onto z=0 plane) — set each frame.
	const cursorWorldRef = React.useRef(new THREE.Vector3());
	const cursorActiveRef = React.useRef(false);
	const cursorBurstAccumRef = React.useRef(0);

	// Free-list head: index of next particle to recycle. We walk the pool
	// in a ring and grab the first slot whose age ≥ lifespan (dead).
	const nextSlotRef = React.useRef(0);

	// Deterministic per-particle "random" hash from seed + index. Stable
	// across re-mounts so reduced-motion freezes don't reshuffle the field.
	const hashRef = React.useRef<Float32Array | null>(null);

	// ─────────────────────────────────────────────────────────────────────
	// One-time scene + GL setup.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
			premultipliedAlpha: false,
			powerPreference: 'high-performance',
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.NoToneMapping; // we want additive bloom-like glow
		renderer.toneMappingExposure = 1.0;
		renderer.setClearColor(0x000000, 0);
		rendererRef.current = renderer;

		const scene = new THREE.Scene();
		scene.background = null;
		sceneRef.current = scene;

		const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
		camera.position.set(0, 0.05, 4.2);
		camera.lookAt(0, 0, 0);
		cameraRef.current = camera;

		// Lights — soft so the screenshot reads "lit" rather than blown.
		const key = new THREE.DirectionalLight(0xffffff, 0.55);
		key.position.set(-1.8, 2.2, 3.4);
		scene.add(key);

		const fill = new THREE.HemisphereLight(0xc6d2e6, 0x080910, 0.55);
		scene.add(fill);

		// ── Particle pool allocation. Once, mutate-in-place from here on. ──
		const positions = new Float32Array(MAX_PARTICLES * 3);
		const velocities = new Float32Array(MAX_PARTICLES * 3);
		const ages = new Float32Array(MAX_PARTICLES);
		const lifes = new Float32Array(MAX_PARTICLES);
		const origins = new Float32Array(MAX_PARTICLES * 3);
		const colors = new Float32Array(MAX_PARTICLES * 3);
		const linePositions = new Float32Array(MAX_PARTICLES * 2 * 3);
		const lineColors = new Float32Array(MAX_PARTICLES * 2 * 3);
		const hashes = new Float32Array(MAX_PARTICLES * 4); // 4 stable random floats per particle

		// Initialize all particles as "dead" (age > life) so they get
		// emitted on first frame.
		for (let i = 0; i < MAX_PARTICLES; i++) {
			ages[i] = 999;
			lifes[i] = 1;
			// Stable pseudo-random hash for per-particle variation (color
			// pick, lifespan variance, velocity jitter). Index + seed.
			const s = seed || 1;
			hashes[i * 4 + 0] = fract(Math.sin((i + 1) * 12.9898 + s * 0.0007) * 43758.5453);
			hashes[i * 4 + 1] = fract(Math.sin((i + 1) * 78.2330 + s * 0.0013) * 24634.6345);
			hashes[i * 4 + 2] = fract(Math.sin((i + 1) * 39.3460 + s * 0.0021) * 19928.2331);
			hashes[i * 4 + 3] = fract(Math.sin((i + 1) * 91.6780 + s * 0.0029) * 31415.9265);
		}

		posRef.current = positions;
		velRef.current = velocities;
		ageRef.current = ages;
		lifeRef.current = lifes;
		originRef.current = origins;
		colorRef.current = colors;
		linePosRef.current = linePositions;
		lineColorRef.current = lineColors;
		hashRef.current = hashes;

		// Anchor world cache + emission accumulator. Seed accumulator with a
		// staggered phase (0..0.95) so all anchors don't fire on frame 1.
		anchorWorldRef.current = new Float32Array(ANCHORS.length * 3);
		const emitAccumInit = new Float32Array(ANCHORS.length);
		for (let i = 0; i < ANCHORS.length; i++) {
			emitAccumInit[i] = (i / ANCHORS.length) * 0.95;
		}
		emitAccumRef.current = emitAccumInit;

		// Points geometry — color attribute carries per-particle tint (so we
		// can mix cyan + accent + alpha-via-darken). We use vertexColors on
		// the material; per-particle alpha is faked by scaling the RGB
		// (additive blending makes black = fully transparent).
		const pGeom = new THREE.BufferGeometry();
		pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		pGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		pGeom.setDrawRange(0, 0);
		const pMat = new THREE.PointsMaterial({
			size: particleSize,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			sizeAttenuation: true,
			blending: THREE.AdditiveBlending,
		});
		const points = new THREE.Points(pGeom, pMat);
		points.frustumCulled = false;
		scene.add(points);
		pointsRef.current = points;
		pointsGeoRef.current = pGeom;
		pointsMatRef.current = pMat;

		// Lines geometry — 2 vertices per particle: (origin, current). Same
		// strategy for alpha — RGB scaled by alpha, additive blend.
		const lGeom = new THREE.BufferGeometry();
		lGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
		lGeom.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
		lGeom.setDrawRange(0, 0);
		const lMat = new THREE.LineBasicMaterial({
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const lines = new THREE.LineSegments(lGeom, lMat);
		lines.frustumCulled = false;
		scene.add(lines);
		linesRef.current = lines;
		linesGeoRef.current = lGeom;
		linesMatRef.current = lMat;

		// Ambient star field — a small static back layer. Cheap, large
		// reward in depth perception.
		const starGeom = makeStarField(180);
		const starMat = new THREE.PointsMaterial({
			color: new THREE.Color('#9ab4d4'),
			size: 0.022,
			transparent: true,
			opacity: 0.6,
			depthWrite: false,
			sizeAttenuation: true,
			blending: THREE.AdditiveBlending,
		});
		const stars = new THREE.Points(starGeom, starMat);
		stars.frustumCulled = false;
		scene.add(stars);
		starsRef.current = stars;

		// Screen mesh — sized 2x1 in local space, scaled by screenAspect /
		// screenScale at render time via mesh.scale.
		const screenGeom = new THREE.PlaneGeometry(2, 1);
		const screenMat = new THREE.MeshStandardMaterial({
			color: new THREE.Color(0x101216),
			emissive: new THREE.Color(0xffffff),
			emissiveIntensity: screenBrightness,
			metalness: 0.0,
			roughness: 0.85,
		});
		screenMatRef.current = screenMat;
		const screenMesh = new THREE.Mesh(screenGeom, screenMat);
		screenMesh.position.set(0, 0, 0);
		scene.add(screenMesh);
		screenMeshRef.current = screenMesh;

		return () => {
			renderer.dispose();
			pGeom.dispose();
			pMat.dispose();
			lGeom.dispose();
			lMat.dispose();
			starGeom.dispose();
			starMat.dispose();
			screenGeom.dispose();
			screenMat.dispose();
			screenTexRef.current?.dispose();
			screenTexRef.current = null;
			rendererRef.current = null;
			sceneRef.current = null;
			pointsRef.current = null;
			pointsGeoRef.current = null;
			pointsMatRef.current = null;
			linesRef.current = null;
			linesGeoRef.current = null;
			linesMatRef.current = null;
			starsRef.current = null;
			screenMeshRef.current = null;
			screenMatRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ─────────────────────────────────────────────────────────────────────
	// Resize.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		const renderer = rendererRef.current;
		const camera = cameraRef.current;
		if (!renderer || !camera) return;
		const w = Math.max(1, Math.floor(size.width));
		const h = Math.max(1, Math.floor(size.height));
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}, [size.width, size.height]);

	// ─────────────────────────────────────────────────────────────────────
	// Screen scale / tilt → mesh.scale + rotation. Also recompute the
	// world-space positions of each anchor so emission tracks the screen.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		const mesh = screenMeshRef.current;
		const anchorWorld = anchorWorldRef.current;
		if (!mesh || !anchorWorld) return;
		const aspect = Math.max(0.5, screenAspect);
		// Width fixed at "1.0" before screenScale; height = 1/aspect.
		const baseW = 1.0;
		const sx = baseW * screenScale;
		const sy = (baseW / aspect) * screenScale;
		// PlaneGeometry was built as 2x1 → divide by 2 / 1 respectively.
		mesh.scale.set(sx / 2, sy / 1, 1);
		// Tilt convention: positive = top edge tilts BACK (away from camera),
		// negative = top edge tilts FORWARD (toward camera). Matches the
		// customizer description and the spec wire-up: rotation.x = tilt rad.
		mesh.rotation.set(screenTilt * (Math.PI / 180), 0, 0);
		// User-controlled X/Y offset of the entire screenshot plane.
		mesh.position.set(screenshotX, screenshotY, 0);
		mesh.updateMatrixWorld(true);

		// Recompute anchor world positions. The plane local-space corners
		// run from (-1, -0.5, 0) .. (1, 0.5, 0) (2x1). Anchors are declared
		// in [-0.5..+0.5] u/v of the plane's TEXTURED area, so we map u→
		// localX = u * 2, v→localY = v * 1.
		const tmp = new THREE.Vector3();
		for (let i = 0; i < ANCHORS.length; i++) {
			const a = ANCHORS[i];
			// Local plane coords: localX in [-1, +1], localY in [-0.5, +0.5].
			// (anchor.u in [-0.5, +0.5] → localX in [-1, +1])
			tmp.set(a.u * 2, a.v * 1, 0);
			tmp.applyMatrix4(mesh.matrixWorld);
			anchorWorld[i * 3 + 0] = tmp.x;
			anchorWorld[i * 3 + 1] = tmp.y;
			anchorWorld[i * 3 + 2] = tmp.z;
		}
	}, [screenAspect, screenScale, screenTilt, screenshotX, screenshotY]);

	// ─────────────────────────────────────────────────────────────────────
	// Screen emissive brightness — live update, no rebuild.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		const m = screenMatRef.current;
		if (m) m.emissiveIntensity = screenBrightness;
	}, [screenBrightness]);

	// ─────────────────────────────────────────────────────────────────────
	// Particle / line material live updates.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		const m = pointsMatRef.current;
		if (m) m.size = particleSize;
	}, [particleSize]);

	React.useEffect(() => {
		const l = linesRef.current;
		if (l) l.visible = !!showLines;
	}, [showLines]);

	React.useEffect(() => {
		const s = starsRef.current;
		if (s) s.visible = !!ambientStars;
	}, [ambientStars]);

	// ─────────────────────────────────────────────────────────────────────
	// Particle count → setDrawRange. The pool stays fixed; we just expose
	// fewer of it to render.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		const pGeom = pointsGeoRef.current;
		const lGeom = linesGeoRef.current;
		if (!pGeom || !lGeom) return;
		const n = Math.max(1, Math.min(MAX_PARTICLES, Math.floor(particleCount)));
		pGeom.setDrawRange(0, n);
		lGeom.setDrawRange(0, n * 2);
	}, [particleCount]);

	// ─────────────────────────────────────────────────────────────────────
	// Load the screenshot texture.
	// ─────────────────────────────────────────────────────────────────────
	React.useEffect(() => {
		if (!screenshot) {
			screenTexRef.current?.dispose();
			screenTexRef.current = null;
			const m = screenMatRef.current;
			if (m) {
				m.map = null;
				m.emissiveMap = null;
				m.color.set('#101216');
				m.needsUpdate = true;
			}
			setAssetReady(true);
			return;
		}
		const loader = new THREE.TextureLoader();
		loader.setCrossOrigin('anonymous');
		let cancelled = false;
		loader.load(
			screenshot,
			(tex) => {
				if (cancelled) {
					tex.dispose();
					return;
				}
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.minFilter = THREE.LinearMipmapLinearFilter;
				tex.magFilter = THREE.LinearFilter;
				tex.generateMipmaps = true;
				tex.anisotropy = 8;
				tex.needsUpdate = true;
				screenTexRef.current?.dispose();
				screenTexRef.current = tex;
				const m = screenMatRef.current;
				if (m) {
					m.map = tex;
					m.emissiveMap = tex;
					m.color.set('#ffffff');
					m.needsUpdate = true;
				}
				setAssetReady(true);
			},
			undefined,
			() => {
				// Texture failed — leave the screen dark, no crash.
				setAssetReady(true);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [screenshot]);

	// ─────────────────────────────────────────────────────────────────────
	// Animation frame — particle integration, emission, cursor flow, render.
	// All math is allocation-free.
	// ─────────────────────────────────────────────────────────────────────
	const cursorRayMatRef = React.useRef(new THREE.Vector2());
	const raycasterRef = React.useRef(new THREE.Raycaster());
	const cursorPlaneRef = React.useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
	const tmpVecRef = React.useRef(new THREE.Vector3());

	// Parse user colors → cached Color objects so the per-frame loop doesn't
	// re-parse hex strings.
	const colCyanRef = React.useRef(new THREE.Color());
	const colAccentRef = React.useRef(new THREE.Color());
	React.useEffect(() => { colCyanRef.current.set(particleColor); }, [particleColor]);
	React.useEffect(() => { colAccentRef.current.set(accentColor); }, [accentColor]);

	useHeroAnimationFrame(rootRef, ({ delta }) => {
		const renderer = rendererRef.current;
		const scene = sceneRef.current;
		const camera = cameraRef.current;
		const positions = posRef.current;
		const velocities = velRef.current;
		const ages = ageRef.current;
		const lifes = lifeRef.current;
		const origins = originRef.current;
		const colors = colorRef.current;
		const linePositions = linePosRef.current;
		const lineColors = lineColorRef.current;
		const hashes = hashRef.current;
		const pGeom = pointsGeoRef.current;
		const lGeom = linesGeoRef.current;
		const anchorWorld = anchorWorldRef.current;
		const emitAccum = emitAccumRef.current;
		if (!renderer || !scene || !camera || !positions || !velocities || !ages || !lifes || !origins || !colors || !linePositions || !lineColors || !hashes || !pGeom || !lGeom || !anchorWorld || !emitAccum) return;

		const activeCount = Math.max(1, Math.min(MAX_PARTICLES, Math.floor(particleCount)));
		const dt = reducedMotion ? 0 : Math.min(delta, 0.066);

		// Cursor raycast onto the screen-plane (z=0 plane) — global one-shot
		// per frame, used for both cursor attract and cursor burst.
		const cursorActive = !!input.active;
		cursorActiveRef.current = cursorActive;
		if (cursorActive) {
			// input is 0..1 (top-left origin). Convert to NDC.
			cursorRayMatRef.current.set(
				input.x * 2 - 1,
				-(input.y * 2 - 1),
			);
			raycasterRef.current.setFromCamera(cursorRayMatRef.current, camera);
			const out = tmpVecRef.current;
			const hit = raycasterRef.current.ray.intersectPlane(cursorPlaneRef.current, out);
			if (hit) {
				cursorWorldRef.current.copy(hit);
			} else {
				cursorActiveRef.current = false;
			}
		}

		// ── Emission. Each anchor emits at `emissionRate` per second. ──
		const anchors = anchorWorld;
		const baseLife = 2.5;          // mean lifespan in seconds (range 2..4 via hash)
		const speedScale = flowSpeed;  // outward velocity multiplier
		// Find cursor-nearest anchor for the burst feature.
		let nearestAnchor = -1;
		if (cursorBurst && cursorActiveRef.current) {
			let best = Infinity;
			for (let i = 0; i < ANCHORS.length; i++) {
				const dx = anchors[i * 3 + 0] - cursorWorldRef.current.x;
				const dy = anchors[i * 3 + 1] - cursorWorldRef.current.y;
				const dz = anchors[i * 3 + 2] - cursorWorldRef.current.z;
				const d2 = dx * dx + dy * dy + dz * dz;
				if (d2 < best) {
					best = d2;
					nearestAnchor = i;
				}
			}
		}

		// Per-anchor budget increment.
		if (dt > 0) {
			for (let i = 0; i < ANCHORS.length; i++) {
				emitAccum[i] += emissionRate * dt;
			}
			// Cursor burst — accumulate a separate counter that fires extra
			// emissions on the nearest anchor at ~3x the rate while cursor
			// is over the canvas.
			cursorBurstAccumRef.current += (cursorBurst && cursorActiveRef.current ? emissionRate * 3.0 : 0) * dt;
		}

		// Spawn loop — walk pool ring from nextSlot, find dead slots, and
		// assign new particles to anchors that have budget. Bound by
		// activeCount so disabling particles via slider releases them.
		let scanCount = 0;
		let slot = nextSlotRef.current;
		const maxScan = activeCount * 2;
		while (scanCount < maxScan) {
			// Is there any emission to do?
			let anchorToEmit = -1;
			// Pick the anchor with the highest accumulator that is also ≥ 1.
			let bestBudget = 1.0;
			for (let i = 0; i < ANCHORS.length; i++) {
				if (emitAccum[i] >= bestBudget) {
					bestBudget = emitAccum[i];
					anchorToEmit = i;
				}
			}
			// Cursor burst — prefer the nearest-anchor burst slot if budget.
			let burstUsed = false;
			if (cursorBurstAccumRef.current >= 1.0 && nearestAnchor >= 0) {
				anchorToEmit = nearestAnchor;
				burstUsed = true;
			}
			if (anchorToEmit < 0) break;

			// Is `slot` available (dead)?
			if (ages[slot] < lifes[slot]) {
				// Slot still alive — advance and retry.
				slot = (slot + 1) % activeCount;
				scanCount++;
				continue;
			}

			// Emit at this slot.
			const ax = anchors[anchorToEmit * 3 + 0];
			const ay = anchors[anchorToEmit * 3 + 1];
			const az = anchors[anchorToEmit * 3 + 2];
			origins[slot * 3 + 0] = ax;
			origins[slot * 3 + 1] = ay;
			origins[slot * 3 + 2] = az;
			positions[slot * 3 + 0] = ax;
			positions[slot * 3 + 1] = ay;
			positions[slot * 3 + 2] = az;
			// Outward velocity. Bias outward FROM the screen center, then add
			// a small random jitter and a forward Z kick so a few particles
			// drift toward the camera.
			const dirX = ax;                 // away from origin (screen center)
			const dirY = ay;
			const len = Math.sqrt(dirX * dirX + dirY * dirY) + 1e-4;
			const ox = dirX / len;
			const oy = dirY / len;
			const h0 = hashes[slot * 4 + 0];
			const h3 = hashes[slot * 4 + 3];
			// Reseed two of the hash floats each emission so successive lives
			// have varied trajectories (deterministic but cycling).
			const cyc = ages[slot] + slot * 0.071;
			const r0 = fract(Math.sin(cyc * 12.9898) * 43758.5453);
			const r1 = fract(Math.sin(cyc * 78.233) * 12345.6789);
			const r2 = fract(Math.sin(cyc * 39.346) * 9876.5432);
			// Outward speed 0.4..1.0 (scaled by flowSpeed).
			const sp = (0.4 + r0 * 0.6) * speedScale * (burstUsed ? 1.3 : 1.0);
			// Jitter on the outward direction so the stream isn't perfectly
			// radial.
			const jx = (r1 - 0.5) * 0.45;
			const jy = (r2 - 0.5) * 0.45;
			const vx = (ox + jx) * sp;
			const vy = (oy + jy) * sp;
			// Small Z kick — bias toward the camera so the field has depth.
			// 70% positive (toward camera), 30% backward (behind screen).
			const vz = (h3 < 0.7 ? (0.15 + r0 * 0.25) : -(0.05 + r0 * 0.15)) * speedScale;
			velocities[slot * 3 + 0] = vx;
			velocities[slot * 3 + 1] = vy;
			velocities[slot * 3 + 2] = vz;
			// Lifespan 2..4s.
			lifes[slot] = baseLife + (h0 - 0.5) * 1.5;
			ages[slot] = 0;
			// Color tint is derived per-frame from the stable hash, so we
			// don't have to write to the color buffer here.

			// Consume budget.
			if (burstUsed) {
				cursorBurstAccumRef.current -= 1.0;
			} else {
				emitAccum[anchorToEmit] -= 1.0;
			}
			slot = (slot + 1) % activeCount;
			scanCount++;
		}
		nextSlotRef.current = slot;

		// ── Cursor attract — bend velocity toward the cursor each frame. ──
		const attract = cursorActiveRef.current ? cursorAttract : 0;
		const cx = cursorWorldRef.current.x;
		const cy = cursorWorldRef.current.y;
		const cz = cursorWorldRef.current.z;

		// ── Integrate. Single tight loop over the active range. ──
		const drag = Math.pow(0.98, dt * 60); // ≈ velocity *= 0.98 per 60fps step, frame-rate independent
		const maxDist2 = lineMaxDistance * lineMaxDistance;
		const lineOpacityClamp = Math.max(0, Math.min(1, lineOpacity));
		for (let i = 0; i < activeCount; i++) {
			if (dt > 0) {
				ages[i] += dt;
				// Velocity update — cursor attract (allocation-free).
				if (attract > 0) {
					const dx = cx - positions[i * 3 + 0];
					const dy = cy - positions[i * 3 + 1];
					const dz = cz - positions[i * 3 + 2];
					const r2 = dx * dx + dy * dy + dz * dz;
					if (r2 > 1e-4 && r2 < 4.0) {
						const r = Math.sqrt(r2);
						const falloff = 1 - r / 2.0; // smooth falloff out to 2 world units
						const f = falloff * falloff * attract * 1.4;
						velocities[i * 3 + 0] += (dx / r) * f * dt;
						velocities[i * 3 + 1] += (dy / r) * f * dt;
						velocities[i * 3 + 2] += (dz / r) * f * dt;
					}
				}
				// Drag.
				velocities[i * 3 + 0] *= drag;
				velocities[i * 3 + 1] *= drag;
				velocities[i * 3 + 2] *= drag;
				// Integrate.
				positions[i * 3 + 0] += velocities[i * 3 + 0] * dt;
				positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
				positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
			}

			// Per-particle alpha (life-fade). Faked via RGB scale so the
			// material can stay a vanilla PointsMaterial.
			const life = lifes[i];
			const ageFrac = life > 1e-4 ? ages[i] / life : 1;
			// Ease-in-then-fade alpha curve: rises sharply over the first
			// 10% of life, then linearly fades.
			let alpha = 0;
			if (ageFrac < 1) {
				const rise = Math.min(1, ageFrac * 10);
				const fall = 1 - ageFrac;
				alpha = rise * fall;
			}
			// Tint reconstruction per-frame: we know cyan vs accent from the
			// stable per-particle hash[1] < 0.2, so we don't need a separate
			// base-color buffer surviving across frames. Bound RGB attribute
			// becomes (base × alpha) — additive blending makes black = invisible.
			const useAccent = hashes[i * 4 + 1] < 0.20;
			const tintR = useAccent ? colAccentRef.current.r : colCyanRef.current.r;
			const tintG = useAccent ? colAccentRef.current.g : colCyanRef.current.g;
			const tintB = useAccent ? colAccentRef.current.b : colCyanRef.current.b;
			colors[i * 3 + 0] = tintR * alpha;
			colors[i * 3 + 1] = tintG * alpha;
			colors[i * 3 + 2] = tintB * alpha;

			// Line: vertex 0 = origin, vertex 1 = current position. Line
			// alpha fades by particle distance from origin so a particle
			// that drifts past lineMaxDistance shows no line.
			linePositions[i * 6 + 0] = origins[i * 3 + 0];
			linePositions[i * 6 + 1] = origins[i * 3 + 1];
			linePositions[i * 6 + 2] = origins[i * 3 + 2];
			linePositions[i * 6 + 3] = positions[i * 3 + 0];
			linePositions[i * 6 + 4] = positions[i * 3 + 1];
			linePositions[i * 6 + 5] = positions[i * 3 + 2];
			// Line alpha = age-fade × distance falloff × user opacity.
			// Age fade: quadratic — pow(1 - ageFrac, 2) — so lines visibly
			// dim mid-life and are gone well before the particle expires.
			// Hard-cutoff at 70% of lifespan: past that, lines stop drawing
			// even though the particle remains (avoids the "permanent web"
			// look the user reported as accumulation). Applied EVERY frame
			// (not just at spawn) so existing lines fade in place.
			let ageFadeLine = 0;
			if (ageFrac < 0.7) {
				const k = 1 - ageFrac; // 1 at spawn, 0.3 at cutoff
				ageFadeLine = k * k;   // quadratic
			}
			const dx = positions[i * 3 + 0] - origins[i * 3 + 0];
			const dy = positions[i * 3 + 1] - origins[i * 3 + 1];
			const dz = positions[i * 3 + 2] - origins[i * 3 + 2];
			const d2 = dx * dx + dy * dy + dz * dz;
			const distFalloff = d2 >= maxDist2 ? 0 : (1 - d2 / maxDist2);
			const lineAlpha = ageFadeLine * distFalloff * lineOpacityClamp;
			// Origin vertex: bright (alpha *1.0)
			lineColors[i * 6 + 0] = tintR * lineAlpha;
			lineColors[i * 6 + 1] = tintG * lineAlpha;
			lineColors[i * 6 + 2] = tintB * lineAlpha;
			// Current-position vertex: dimmer (alpha *0.25) — gives the line a tapered look.
			lineColors[i * 6 + 3] = tintR * lineAlpha * 0.25;
			lineColors[i * 6 + 4] = tintG * lineAlpha * 0.25;
			lineColors[i * 6 + 5] = tintB * lineAlpha * 0.25;
		}

		// Mark attribute buffers dirty for the active range.
		(pGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
		(pGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
		(lGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
		(lGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true;

		// (Intentionally no ambient yaw on the screen — the flow particles
		// carry the motion, and rotating the screen would invalidate the
		// world-space anchor cache without per-frame re-projection.)

		renderer.render(scene, camera);
	});

	return (
		<canvas
			ref={canvasRef}
			className="crazygl-df-canvas"
			aria-hidden="true"
		/>
	);
}

/* fract(x) — used for tiny deterministic-noise hashes. Local helper so we
   don't need an extra import. */
function fract(x: number): number {
	return x - Math.floor(x);
}
