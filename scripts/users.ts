#!/usr/bin/env bun
/**
 * User listing CLI.
 *
 * Usage:
 *   bun scripts/users.ts list
 *
 * Requires a running database at FRC_DB_PATH (default: data/app.db). Role is
 * not settable here — it's recomputed on every request from the signed-in
 * member's Legion `fabrica-admin` group membership (see
 * apps/control/src/legion/session.ts), so grant/revoke admin access in
 * Legion's own /admin/groups instead.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const dbPath =
	Bun.env.FRC_DB_PATH ?? resolve(Bun.env.FRC_DATA_DIR ?? "data", "app.db");

function getDb(): Database {
	try {
		return new Database(dbPath);
	} catch (_err) {
		console.error(`Cannot open database at ${dbPath}. Is the path correct?`);
		process.exit(1);
	}
}

type UserRow = {
	id: string;
	name: string;
	email: string;
	role: string | null;
	slug: string | null;
};

const [command] = process.argv.slice(2);

const db = getDb();
try {
	switch (command) {
		case "list": {
			const users = db
				.query("SELECT id, name, email, role, slug FROM user ORDER BY name")
				.all() as UserRow[];
			if (users.length === 0) {
				console.log("No users in the database.");
			} else {
				console.log(
					`${"Username".padEnd(35)} ${"Name".padEnd(20)} ${"Role".padEnd(8)} Slug`,
				);
				console.log("-".repeat(80));
				for (const u of users) {
					console.log(
						`${u.email.padEnd(35)} ${u.name.padEnd(20)} ${(u.role ?? "student").padEnd(8)} ${u.slug ?? ""}`,
					);
				}
				console.log(`\n${users.length} user(s) total.`);
			}
			break;
		}

		default:
			console.error("Usage: bun scripts/users.ts list");
			process.exit(1);
	}
} finally {
	db.close();
}
