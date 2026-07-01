<sub>*Hero made by [@ybouane](https://x.com/ybouane).*</sub>
<p align="center">
  <img src="https://crazygl.com/heroes/hero-data-flow/banner-full.png" alt="Screenshot with Animated Data Flow" width="640">
</p>

# @crazygl/hero-data-flow

Glowing particles and connection lines stream out from a tilted product screenshot, suggesting live data moving through the UI. Built for analytics, CRM, automation, AI agents and database products.

## Demo
[Screenshot with Animated Data Flow](https://crazygl.com/hero/data-flow)

## Install

```bash
npm install @crazygl/hero-data-flow
```

## Usage

```tsx
import DataFlow from '@crazygl/hero-data-flow';

export default function Hero() {
	return (
		<DataFlow
			screenshot="/img/dashboard.avif"
			particleColor="#56e3ff"
			accentColor="#ffb45a"
			flowSpeed={0.7}
		/>
	);
}
```

## Customise

- **Screenshot** — `screenshot` (the centerpiece capture), plus `screenAspect`, `screenScale`, `screenTilt`, `screenBrightness`, `screenshotX/Y` to frame it.
- **Flow** — `particleCount`, `particleColor`, `accentColor`, `flowSpeed`, `particleSize`, `emissionRate`.
- **Lines** — `showLines`, `lineOpacity`, `lineMaxDistance` (how far a particle drifts before its tether fades).
- **Cursor** — `cursorAttract` bends the stream toward the pointer; `cursorBurst` spawns extra particles near the cursor.
- **Background** — `bgTop` / `bgBottom` gradient, `ambientStars` depth layer; `contentAlign` for the copy.

## Best for

- Analytics, BI, and customer-data (CRM) platforms.
- AI agent products and real-time / automation tools.
- Database and infra startups where "live data moving through the product" is the pitch.



This hero is part of [CrazyGL](https://crazygl.com), a collection of production-ready WebGL, canvas, 3D, and typography effects. Every CrazyGL hero ships with an agent-ready `SKILL.md` file that helps developers and coding agents adapt the effect into custom landing pages and interactive experiences.
