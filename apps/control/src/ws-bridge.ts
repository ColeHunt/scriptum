import type { BridgeConnection } from "@frc-fabrica/contracts";

/**
 * Fields every per-workspace bridge entry shares. Subclasses extend this with
 * their own protocol state (driver-station snapshot, NT4 topic maps, etc.).
 */
export type BridgeEntryBase<W> = {
	workspaceId: W;
	upstreamUrl: string;
	socket: WebSocket | null;
	connection: BridgeConnection;
	connected: boolean;
	stale: boolean;
	lastMessageAt: string | null;
	error: string | null;
};

/**
 * Shared connection-lifecycle scaffolding for the per-workspace WebSocket
 * bridges (`HalSimBridge`, `Nt4AutoChooserBridge`). It owns the `entries` map,
 * the URL-change-aware entry lifecycle, and the socket wiring — including the
 * `entry.socket !== socket` stale-guard that is the first line of every
 * listener. The protocol- and strategy-specific behaviour lives in the hooks.
 *
 * The reconnect strategy is deliberately a hook: `HalSimBridge` overrides
 * {@link onSocketClosed} to schedule exponential backoff, while
 * `Nt4AutoChooserBridge` leaves it poll-driven (the frontend's ~1s poll
 * re-calls `ensureConnected`). Do not unify these — the divergence is the whole
 * reason the previous duplicated scaffolding drifted. A third bridge should
 * `extends ReconnectingWsBridge` and implement these hooks.
 */
export abstract class ReconnectingWsBridge<
	W,
	Entry extends BridgeEntryBase<W>,
> {
	protected readonly entries = new Map<W, Entry>();

	/** Build a fresh entry (default snapshot + protocol state). */
	protected abstract createEntry(workspaceId: W, upstreamUrl: string): Entry;

	/**
	 * Construct the upstream socket. NT4 passes subprotocols and sets
	 * `binaryType`; HALSim uses a plain socket.
	 */
	protected abstract createSocket(entry: Entry): WebSocket;

	/** Open-event handshake: HALSim sends the DS frame; NT4 publishes + subscribes. */
	protected abstract onSocketOpen(entry: Entry): void;

	/** Decode/apply an inbound message frame. */
	protected abstract onSocketMessage(entry: Entry, data: unknown): void;

	/**
	 * Reconnect strategy hook, invoked from the close listener *after* the base
	 * has torn the socket down (nulled, `connection="disconnected"`,
	 * `error=event.reason`). HALSim overrides this to override the connection
	 * state and schedule backoff; NT4 only logs and stays poll-driven (no
	 * reconnect). Default is a no-op.
	 */
	protected onSocketClosed(_entry: Entry, _event: CloseEvent): void {}

	/** Error-event hook: record a protocol-appropriate error string. */
	protected onSocketError(_entry: Entry): void {}

	/**
	 * Return the existing entry for the workspace, disconnecting and recreating
	 * it if the upstream URL changed, and creating one if absent.
	 */
	protected ensureEntry(workspaceId: W, upstreamUrl: string): Entry {
		let entry = this.entries.get(workspaceId);
		if (entry && entry.upstreamUrl !== upstreamUrl) {
			this.disconnect(workspaceId);
			entry = undefined;
		}
		if (!entry) {
			entry = this.createEntry(workspaceId, upstreamUrl);
			this.entries.set(workspaceId, entry);
		}
		return entry;
	}

	/**
	 * Open a socket for the entry and wire the four listeners. Every listener's
	 * first line is the `entry.socket !== socket` stale-guard so a late callback
	 * from a superseded socket can never mutate the live entry.
	 */
	protected open(entry: Entry): void {
		entry.connection = "reconnecting";
		entry.connected = false;
		entry.stale = entry.lastMessageAt !== null;
		entry.error = null;

		const socket = this.createSocket(entry);
		entry.socket = socket;

		socket.addEventListener("open", () => {
			if (entry.socket !== socket) return;
			this.onSocketOpen(entry);
		});

		socket.addEventListener("message", (event) => {
			if (entry.socket !== socket) return;
			this.onSocketMessage(entry, event.data);
		});

		socket.addEventListener("close", (event) => {
			if (entry.socket !== socket) return;
			entry.socket = null;
			entry.connection = "disconnected";
			entry.connected = false;
			entry.stale = true;
			entry.error = event.reason || null;
			this.onSocketClosed(entry, event);
		});

		socket.addEventListener("error", () => {
			if (entry.socket !== socket) return;
			this.onSocketError(entry);
		});
	}

	/** Tear down the workspace's socket and mark the entry disconnected. */
	disconnect(workspaceId: W): void {
		const entry = this.entries.get(workspaceId);
		if (!entry) return;
		const socket = entry.socket;
		entry.socket = null;
		entry.connection = "disconnected";
		entry.connected = false;
		entry.stale = true;
		if (socket && socket.readyState !== WebSocket.CLOSED) {
			socket.close();
		}
	}

	/** Disconnect every workspace and drop all entries. */
	close(): void {
		for (const workspaceId of this.entries.keys()) {
			this.disconnect(workspaceId);
		}
		this.entries.clear();
	}
}
