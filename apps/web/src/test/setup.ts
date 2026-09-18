import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Default RAF/CAF — jsdom omits these. Tests that need finer control should
// override via vi.spyOn(window, "requestAnimationFrame").
if (typeof globalThis.requestAnimationFrame !== "function") {
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number =>
		setTimeout(() => cb(performance.now()), 16) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number): void =>
		clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

// jsdom doesn't implement matchMedia. Defaults to "doesn't match" - tests
// that care (e.g. prefers-reduced-motion) should override via
// vi.stubGlobal("matchMedia", ...).
if (typeof globalThis.matchMedia !== "function") {
	globalThis.matchMedia = (query: string): MediaQueryList =>
		({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as unknown as MediaQueryList;
}

afterEach(() => {
	cleanup();
});
