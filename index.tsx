import * as React from 'react';
import CrazyGLWrapper, {
	useContent,
	useHeroReady,
	type HeroComponentProps,
} from '@crazygl/core';
import metadata from './metadata.json';
import './style.css';

/* ─────────────────────────────────────────────────────────────────────────
   Screenshot with Animated Data Flow.

   Concept
     A product screenshot sits centered, tilted slightly forward (~10°).
     Around it, glowing particles stream OUTWARD from pre-defined anchor
     points on the screenshot's perimeter and interior — corners, mid-
     edges, plus a few interior "node" points. Each particle is paired
     with an animated connection line back to its origin anchor; lines
     fade out as the particle drifts further than `lineMaxDistance`. The
     overall read is "data flowing through the product" — analytics, AI,
     CRM, automation.

   Physics statement
     - Particles: pure ballistic — `position += velocity * dt; velocity *=
       0.98`. Velocities seeded outward from each anchor with a bias
       toward the screen plane (xy) and a small forward Z kick so a few
       particles drift toward the camera. Each particle has a finite
       lifespan (2–4s) and recycles in-place when expired.
     - Lines: a separate `LineSegments` geometry with one segment per
       particle: `(origin, currentPosition)`. Per-vertex colors carry an
       alpha that falls off with distance from the origin so far-drifting
       particles drop their leash naturally.
     - Cursor flow: pointer is raycast onto a plane at z=0 (the screen
       plane). When active, particles get a small velocity nudge toward
       the cursor each frame (proportional to `cursorAttract`). Extra
       particles are also spawned at the anchor nearest the cursor.
     - Reduced motion: emission and integration freeze; the last frame's
       particle positions render as a static field.
     - No postprocess. Bloom is faked via additive blending on bright
       emissive colors.

   References
     - Three.js Points + custom LineSegments. The Constellation hero
       (canvas2D variant) uses a similar "node + neighbour-link" idea.
     - `THREE.AdditiveBlending` + `sizeAttenuation: true` for the soft
       glow look, per the skill catalog's particle-field section.
   ───────────────────────────────────────────────────────────────────────── */

const FlowStage = React.lazy(() => import('./FlowStage'));

type ContentAlign = 'start' | 'center' | 'end';

function DataFlowHero(props: HeroComponentProps) {
	const {
		size,
		input,
		seed,
		reducedMotion,
		rootRef,
		// Screenshot
		screenshot = 'https://crazygl.com/samples/screenshot-dashboard-dark.avif',
		screenAspect = 1.6,
		screenScale = 1.5,
		screenTilt = 10,
		screenBrightness = 0.25,
		screenshotX = 0,
		screenshotY = 0,
		// Flow
		particleCount = 600,
		particleColor = '#56e3ff',
		accentColor = '#ffb45a',
		flowSpeed = 0.7,
		particleSize = 0.04,
		emissionRate = 1.0,
		// Lines
		showLines = true,
		lineOpacity = 0.35,
		lineMaxDistance = 1.5,
		// Cursor
		cursorAttract = 0.5,
		cursorBurst = true,
		// Background
		bgTop = '#0a1020',
		bgBottom = '#03050c',
		ambientStars = true,
		// Layout
		contentAlign = 'start' as ContentAlign,
		paddingX = 64,
		paddingY = 48,
	} = props as any;

	const content = useContent(props);
	useHeroReady(props);
	const [mounted, setMounted] = React.useState(false);
	React.useEffect(() => setMounted(true), []);

	const align: React.CSSProperties =
		contentAlign === 'end'
			? { justifyContent: 'flex-end', textAlign: 'right' }
			: contentAlign === 'center'
				? { justifyContent: 'center', textAlign: 'center' }
				: { justifyContent: 'flex-start', textAlign: 'left' };

	return (
		<>
			<crazygl-stage
				style={
					{
						position: 'absolute',
						inset: 0,
						zIndex: 0,
						overflow: 'hidden',
						// Subtle radial center brightening on top of the linear gradient
						// gives a halo behind the screenshot.
						background:
							`radial-gradient(ellipse at center, ${hexMix(bgTop, '#ffffff', 0.07)} 0%, ${bgTop} 45%, ${bgBottom} 100%)`,
					} as React.CSSProperties
				}
			>
				{mounted ? (
					<React.Suspense fallback={null}>
						<FlowStage
							rootRef={rootRef}
							size={size}
							input={input}
							seed={seed}
							reducedMotion={reducedMotion}
							screenshot={screenshot}
							screenAspect={screenAspect}
							screenScale={screenScale}
							screenTilt={screenTilt}
							screenBrightness={screenBrightness}
							screenshotX={screenshotX}
							screenshotY={screenshotY}
							particleCount={particleCount}
							particleColor={particleColor}
							accentColor={accentColor}
							flowSpeed={flowSpeed}
							particleSize={particleSize}
							emissionRate={emissionRate}
							showLines={showLines}
							lineOpacity={lineOpacity}
							lineMaxDistance={lineMaxDistance}
							cursorAttract={cursorAttract}
							cursorBurst={cursorBurst}
							ambientStars={ambientStars}
						/>
					</React.Suspense>
				) : null}
			</crazygl-stage>
			<crazygl-content
				style={
					{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						zIndex: 1,
						pointerEvents: 'none',
						padding: `${paddingY}px ${paddingX}px`,
						...align,
					} as React.CSSProperties
				}
			>
				<div className="crazygl-df-content">{content.node}</div>
			</crazygl-content>
		</>
	);
}

/* Tiny color blend — used to brighten the radial center of the background. */
function hexMix(a: string, b: string, t: number): string {
	const pa = parseHex(a);
	const pb = parseHex(b);
	const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
	const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
	const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
	return `rgb(${r}, ${g}, ${bl})`;
}
function parseHex(h: string): [number, number, number] {
	const s = h.replace('#', '');
	const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
	const n = parseInt(f, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export { metadata };
export default function DataFlow(props: any) {
	return <CrazyGLWrapper hero={DataFlowHero} metadata={metadata as any} {...props} />;
}
