import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const COLORS = [
	"#34d399", // emerald-400
	"#60a5fa", // blue-400
	"#fbbf24", // amber-400
	"#f472b6", // pink-400
	"#a78bfa", // violet-400
];

const PARTICLE_COUNT = 140;
const DURATION_MS = 3200;
const GRAVITY = 0.12;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	color: string;
	rotation: number;
	spin: number;
}

function makeParticles(width: number): Particle[] {
	return Array.from({ length: PARTICLE_COUNT }, () => ({
		x: Math.random() * width,
		y: -20 - Math.random() * 200,
		vx: (Math.random() - 0.5) * 4,
		vy: Math.random() * 2 + 1,
		size: Math.random() * 6 + 4,
		color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#34d399",
		rotation: Math.random() * 360,
		spin: (Math.random() - 0.5) * 12,
	}));
}

/**
 * A one-shot confetti burst, portaled to document.body so it always covers
 * the full viewport regardless of any transformed dialog ancestor. Skips the
 * animation entirely under prefers-reduced-motion. Calls `onDone` once the
 * burst finishes (or immediately, if motion is reduced) so callers can clean
 * up without keeping their own timer.
 */
export function Confetti({ onDone }: { onDone?: () => void }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const onDoneRef = useRef(onDone);
	onDoneRef.current = onDone;

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			onDoneRef.current?.();
			return;
		}
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const resize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};
		resize();
		window.addEventListener("resize", resize);

		const particles = makeParticles(canvas.width);
		const start = performance.now();
		let frameId: number;

		const tick = (now: number) => {
			const elapsed = now - start;
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			const fadeStart = DURATION_MS - 600;
			const alpha =
				elapsed > fadeStart ? Math.max(0, 1 - (elapsed - fadeStart) / 600) : 1;

			for (const p of particles) {
				p.vy += GRAVITY;
				p.x += p.vx;
				p.y += p.vy;
				p.rotation += p.spin;

				ctx.save();
				ctx.globalAlpha = alpha;
				ctx.translate(p.x, p.y);
				ctx.rotate((p.rotation * Math.PI) / 180);
				ctx.fillStyle = p.color;
				ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
				ctx.restore();
			}

			if (elapsed < DURATION_MS) {
				frameId = requestAnimationFrame(tick);
			} else {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				onDoneRef.current?.();
			}
		};
		frameId = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(frameId);
			window.removeEventListener("resize", resize);
		};
	}, []);

	return createPortal(
		<canvas
			ref={canvasRef}
			className="pointer-events-none fixed inset-0 z-[100]"
		/>,
		document.body,
	);
}
