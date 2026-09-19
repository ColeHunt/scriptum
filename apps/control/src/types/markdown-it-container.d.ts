/**
 * `markdown-it-container` ships no types of its own, and the DefinitelyTyped
 * `@types/markdown-it-container` package types against the old (pre-v15)
 * `@types/markdown-it` shim, which structurally conflicts with `markdown-it`
 * v15's own bundled types - hence this local shim instead, typed directly
 * against what `markdown-it` itself exports.
 */
declare module "markdown-it-container" {
	import type MarkdownIt from "markdown-it";
	import type { RendererRule } from "markdown-it";

	interface MarkdownItContainerOptions {
		validate?: (params: string) => boolean;
		render?: RendererRule;
		marker?: string;
	}

	function markdownItContainer(
		md: MarkdownIt,
		name: string,
		options?: MarkdownItContainerOptions,
	): void;

	export = markdownItContainer;
}
