/**
 * Lightweight in-process pub/sub for collaboration events that span the tRPC
 * router layer and the socket.io layer. Currently used to invalidate per-socket
 * role caches when an admin mutation (updateRole / remove / revoke link)
 * changes a user's permissions mid-session — without this, a demoted editor
 * keeps editor-tier broadcast rights on socket events until they reconnect.
 *
 * EventEmitter-based so collaboration.ts (router) doesn't need a reference to
 * the socket.io server instance; the socket setup in _core/index.ts subscribes.
 */
import { EventEmitter } from "events";

interface RoleInvalidatedEvent {
  /** Project whose membership changed. */
  projectId: number;
  /** User whose role/membership changed. When undefined, invalidate the whole
   *  project room (used on bulk operations like project ACL reset). */
  userId?: number;
}

class CollabBus extends EventEmitter {
  emitRoleInvalidated(evt: RoleInvalidatedEvent) {
    this.emit("role:invalidated", evt);
  }
  onRoleInvalidated(listener: (evt: RoleInvalidatedEvent) => void): () => void {
    this.on("role:invalidated", listener);
    return () => this.off("role:invalidated", listener);
  }
}

export const collabBus = new CollabBus();
// Disable listener warning — one listener per Socket.IO connection is expected
// to add up under heavy concurrent collaboration.
collabBus.setMaxListeners(0);
