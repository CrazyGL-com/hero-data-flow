import * as React from 'react';
interface StageProps {
    rootRef: React.RefObject<HTMLElement | null>;
    size: {
        width: number;
        height: number;
        dpr: number;
    };
    input: {
        x: number;
        y: number;
        active: boolean;
    };
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
export default function FlowStage(props: StageProps): import("react/jsx-runtime").JSX.Element;
export {};
