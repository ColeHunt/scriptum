#!/usr/bin/env bun
/**
 * One-off reconciliation report for the Better Auth -> Legion identity cutover.
 *
 * Legion's read API has no `username` field (only `name`, `member_code`,
 * `role`, `team_number`, `groups`, ...), so there is no reliable machine key to
 * join a pre-Legion `user` row against a Legion roster entry — this can only
 * ever be a best-effort NAME match, never an automatic rewrite. This script is
 * read-only: it prints a report and writes nothing. Reconciling an unresolved
 * or ambiguous row (updating `workspaces.user_id` and re-pointing the old
 * `user.id` at the right `member_code`) is a manual, one-row-at-a-time DB edit
 * an operator does after reading the report — not something to automate
 * against production data.
 *
 * Usage:
 *   LEGION_BASE_URL=https://legion.example.org LEGION_API_KEY=... \
 *     bun scripts/migrate-legion-identity.ts [--db path/to/app.db]
 *
 * Run this against a COPY of the real data/app.db first (pass --db), never
 * the live file — see docs/decisions/047-legion-auth-integration.md.
 */
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

type LegionMember = {
	member_code: string;
	name: string;
	role: string;
	team_number: number | null;
	is_active: boolean;
};

function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/gu, " ");
}

async function fetchLegionRoster(
	baseUrl: string,
	apiKey: string,
): Promise<LegionMember[]> {
	const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/members`, {
		headers: { "X-API-Key": apiKey },
	});
	if (!response.ok) {
		throw new Error(
			`Legion roster fetch failed: ${response.status} ${response.statusText}`,
		);
	}
	const body = (await response.json()) as { members: LegionMember[] };
	return body.members;
}

function parseDbPathArg(): string {
	const flagIndex = process.argv.indexOf("--db");
	if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
		return resolve(process.argv[flagIndex + 1] as string);
	}
	return resolve(Bun.env.FRC_DATA_DIR ?? "data", "app.db");
}

async function main(): Promise<void> {
	const legionBaseUrl = Bun.env.LEGION_BASE_URL;
	const legionApiKey = Bun.env.LEGION_API_KEY;
	if (!legionBaseUrl || !legionApiKey) {
		console.error(
			"Set LEGION_BASE_URL and LEGION_API_KEY (a Legion-side API key for this app) to run this report.",
		);
		process.exit(1);
	}

	const dbPath = parseDbPathArg();
	console.log(`Reading local users from ${dbPath}`);
	console.log(`Fetching Legion roster from ${legionBaseUrl}\n`);

	const db = new Database(dbPath, { readonly: true });
	const localUsers = db
		.query("SELECT id, name, email FROM user ORDER BY name")
		.all() as Array<{ id: string; name: string; email: string }>;
	db.close();

	const roster = await fetchLegionRoster(legionBaseUrl, legionApiKey);
	const byNormalizedName = new Map<string, LegionMember[]>();
	for (const member of roster) {
		const key = normalizeName(member.name);
		const bucket = byNormalizedName.get(key) ?? [];
		bucket.push(member);
		byNormalizedName.set(key, bucket);
	}

	console.log(
		`${localUsers.length} local user row(s), ${roster.length} Legion member(s).\n`,
	);

	let resolved = 0;
	let ambiguous = 0;
	let unresolved = 0;

	for (const user of localUsers) {
		const candidates = byNormalizedName.get(normalizeName(user.name)) ?? [];
		if (candidates.length === 1) {
			const match = candidates[0]!;
			resolved += 1;
			console.log(
				`MATCH      ${user.id}  "${user.name}" <${user.email}>  ->  ${match.member_code} (${match.role}${match.team_number ? `, team ${match.team_number}` : ""}${match.is_active ? "" : ", ARCHIVED"})`,
			);
		} else if (candidates.length > 1) {
			ambiguous += 1;
			console.log(
				`AMBIGUOUS  ${user.id}  "${user.name}" <${user.email}>  ->  ${candidates.length} Legion members share this name: ${candidates.map((c) => c.member_code).join(", ")}`,
			);
		} else {
			unresolved += 1;
			console.log(
				`UNRESOLVED ${user.id}  "${user.name}" <${user.email}>  ->  no Legion member with this name`,
			);
		}
	}

	console.log(
		`\n${resolved} matched, ${ambiguous} ambiguous, ${unresolved} unresolved. ` +
			"Nothing was written - reconcile ambiguous/unresolved rows by hand before cutover.",
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
