import { describe, expect, test } from "bun:test";
import { renderMarkdownDocument } from "../app/preview-markdown";

describe("renderMarkdownDocument", () => {
	test("renders plain markdown with a heading id", () => {
		const html = renderMarkdownDocument("# Hello\n\nSome *text*.", "t");
		expect(html).toContain('<h1 id="hello">Hello</h1>');
		expect(html).toContain("<em>text</em>");
	});

	test("does not execute embedded HTML/script tags", () => {
		const html = renderMarkdownDocument(
			'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
			"t",
		);
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).not.toContain('<img src=x onerror="alert(1)">');
	});

	describe("Docusaurus-style admonitions", () => {
		test("renders each type with its default title when no [title] is given", () => {
			for (const [type, title] of [
				["note", "Note"],
				["tip", "Tip"],
				["info", "Info"],
				["warning", "Warning"],
				["danger", "Danger"],
			]) {
				const html = renderMarkdownDocument(`:::${type}\n\nBody.\n\n:::`, "t");
				expect(html).toContain(`class="admonition admonition-${type}"`);
				expect(html).toContain(`<p class="admonition-title">${title}</p>`);
				expect(html).toContain("<p>Body.</p>");
			}
		});

		test("uses a custom [title] when given, inline-rendered", () => {
			const html = renderMarkdownDocument(
				":::warning[Watch the `colon` here]\n\nBody.\n\n:::",
				"t",
			);
			expect(html).toContain(
				'<p class="admonition-title">Watch the <code>colon</code> here</p>',
			);
		});

		test("falls back to the default title for empty brackets", () => {
			const html = renderMarkdownDocument(":::danger[]\n\nBody.\n\n:::", "t");
			expect(html).toContain('<p class="admonition-title">Danger</p>');
		});

		test("does not treat a similarly-named fence as an admonition", () => {
			// ":::warningish" isn't "warning" (with or without a [title]) - must
			// not validate, or an unrelated custom container name would render
			// as a broken/empty warning box instead of literal text.
			const html = renderMarkdownDocument(":::warningish\n\nBody.\n\n:::", "t");
			expect(html).not.toContain('class="admonition admonition-warning"');
		});

		test("leaves a literal ::: inside inline code alone", () => {
			const html = renderMarkdownDocument("Not admonition: `:::warning`", "t");
			expect(html).toContain("<code>:::warning</code>");
			expect(html).not.toContain('class="admonition admonition-warning"');
		});
	});
});
