import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

/**
 * WebRTC mesh manager — for each peer in the same group, opens a
 * RTCPeerConnection + DataChannel. Once connected, messages flow
 * browser-to-browser without touching any server.
 *
 * Signaling (initial SDP/ICE exchange) goes through the lan-chat
 * socket.io namespace — those events are server-relayed but the
 * server never sees the channel payload.
 *
 * Mesh model: every peer connects to every other peer (N² for N
 * participants). Practical up to ~8–10 peers; UI keeps a soft cap.
 *
 * ## Binary frame protocol for file chunks
 *
 * Text frames (JSON string): file-meta, file-end, chat, typing, …
 * Binary frames (ArrayBuffer): file chunk data
 *
 * Binary frame layout:
 *   [0..35]  transferId  — 36 ASCII bytes (UUID)
 *   [36..39] seq         — Uint32 big-endian chunk sequence number
 *   [40..]   data        — raw binary payload (up to 64 KB)
 *
 * Using ArrayBuffer eliminates the 33% base64 overhead and the O(n)
 * String.fromCharCode encode/decode loops from the old JSON approach.
 */

export interface MeshPeer {
  sessionId: string;
  nickname: string;
  color: string;
  connectionState: RTCPeerConnectionState;
  /** True once the DataChannel is open in both directions. */
  ready: boolean;
}

export interface MeshIncomingMessage {
  fromSessionId: string;
  fromNickname: string;
  fromColor: string;
  payload: unknown;
}

/** Peer A < Peer B (string compare) decides who initiates the SDP
 *  offer — avoids glare where both sides offer simultaneously and
 *  neither finishes. */
function shouldInitiate(myId: string, theirId: string): boolean {
  return myId < theirId;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  nickname: string;
  color: string;
  ready: boolean;
  state: RTCPeerConnectionState;
}

interface UsePeerMeshOpts {
  socket: Socket | null;
  mySessionId: string | null;
  myNickname: string;
  /** Latest list of peers in the user's group (excluding self). The hook
   *  reconciles connections against this list — adds new, drops removed. */
  desiredPeers: Array<{ sessionId: string; nickname: string; color: string }>;
  onMessage: (msg: MeshIncomingMessage) => void;
  /** Called when a peer is dropped (disconnect / leave) so the caller
   *  can clean up any in-flight state keyed by that sessionId. */
  onPeerDrop?: (sessionId: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  // Public STUN gives peers their NAT'd reflexive IP so ICE can pair
  // even when two browsers behind the same office NAT are on different
  // /24 subnets (multi-VLAN office WiFi, double-NAT, etc). STUN does
  // NOT relay traffic — it just helps peers learn their own external
  // address. The actual DataChannel still goes peer↔peer; no TURN, so
  // truly cross-LAN scenarios (different ISPs) will still fail
  // gracefully (channel never opens, broadcast becomes a no-op).
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function usePeerMesh({ socket, mySessionId, myNickname, desiredPeers, onMessage, onPeerDrop }: UsePeerMeshOpts) {
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const [peers, setPeers] = useState<MeshPeer[]>([]);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  const onPeerDropRef = useRef(onPeerDrop);
  useEffect(() => { onPeerDropRef.current = onPeerDrop; }, [onPeerDrop]);

  const publishState = useCallback(() => {
    const out: MeshPeer[] = [];
    peersRef.current.forEach((entry, sessionId) => {
      out.push({
        sessionId,
        nickname: entry.nickname,
        color: entry.color,
        connectionState: entry.state,
        ready: entry.ready,
      });
    });
    setPeers(out);
  }, []);

  /** Tear down a peer connection — used on peer leave or full unmount. */
  const dropPeer = useCallback((sessionId: string) => {
    const entry = peersRef.current.get(sessionId);
    if (!entry) return;
    try { entry.dc?.close(); } catch { /* ignore */ }
    try { entry.pc.close(); } catch { /* ignore */ }
    peersRef.current.delete(sessionId);
    publishState();
    onPeerDropRef.current?.(sessionId);
  }, [publishState]);

  /** Open a new RTCPeerConnection toward the given peer. Sets up the
   *  DataChannel (locally if we're the initiator) and wires all the
   *  signaling event handlers. */
  const ensurePeer = useCallback((peerInfo: { sessionId: string; nickname: string; color: string }): PeerEntry => {
    const existing = peersRef.current.get(peerInfo.sessionId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry: PeerEntry = {
      pc,
      dc: null,
      nickname: peerInfo.nickname,
      color: peerInfo.color,
      ready: false,
      state: "new",
    };
    peersRef.current.set(peerInfo.sessionId, entry);

    pc.onconnectionstatechange = () => {
      entry.state = pc.connectionState;
      console.debug("[mesh] pc state ->", peerInfo.sessionId, pc.connectionState);
      publishState();
      // Only tear down on "failed". "closed" is the terminal state after we
      // ourselves called pc.close(), and "disconnected" is a transient state
      // that often recovers on its own — tearing down here turns a momentary
      // ICE blip into a permanent drop and prevents the DataChannel from
      // re-opening once connectivity returns.
      if (pc.connectionState === "failed") {
        dropPeer(peerInfo.sessionId);
      }
    };
    pc.oniceconnectionstatechange = () => {
      console.debug("[mesh] ice state ->", peerInfo.sessionId, pc.iceConnectionState);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit("webrtc:ice", { to: peerInfo.sessionId, candidate: e.candidate.toJSON() });
      }
    };
    pc.ondatachannel = (e) => {
      console.debug("[mesh] ondatachannel from", peerInfo.sessionId);
      attachDc(peerInfo.sessionId, e.channel);
    };

    return entry;
  }, [socket, publishState, dropPeer]);

  const attachDc = useCallback((sessionId: string, dc: RTCDataChannel) => {
    const entry = peersRef.current.get(sessionId);
    if (!entry) return;
    entry.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      console.debug("[mesh] dc open ->", sessionId);
      entry.ready = true;
      publishState();
    };
    dc.onclose = () => {
      console.debug("[mesh] dc close ->", sessionId);
      entry.ready = false;
      publishState();
    };
    dc.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        // Binary frame = file chunk.
        // Layout: [0..35] transferId (36-byte UUID ASCII)
        //         [36..39] seq (Uint32 BE)
        //         [40..]   raw data
        if (ev.data.byteLength < 40) return;
        const transferId = new TextDecoder().decode(new Uint8Array(ev.data, 0, 36));
        const seq = new DataView(ev.data).getUint32(36, false);
        const data = new Uint8Array(ev.data, 40);
        onMessageRef.current({
          fromSessionId: sessionId,
          fromNickname: entry.nickname,
          fromColor: entry.color,
          payload: { kind: "file-chunk", transferId, seq, data },
        });
        return;
      }
      try {
        const payload = JSON.parse(ev.data as string);
        onMessageRef.current({
          fromSessionId: sessionId,
          fromNickname: entry.nickname,
          fromColor: entry.color,
          payload,
        });
      } catch {
        /* malformed payload from peer — drop silently */
      }
    };
  }, [publishState]);

  // Reconcile peer list against desiredPeers on every change.
  useEffect(() => {
    if (!socket || !mySessionId) return;
    const desiredIds = new Set(desiredPeers.map((p) => p.sessionId));

    // Drop peers no longer in the group.
    Array.from(peersRef.current.keys()).forEach((id) => {
      if (!desiredIds.has(id)) dropPeer(id);
    });

    // Open connections to new peers.
    for (const p of desiredPeers) {
      if (peersRef.current.has(p.sessionId)) continue;
      const entry = ensurePeer(p);
      // Use deterministic initiator so only one side offers.
      if (shouldInitiate(mySessionId, p.sessionId)) {
        const dc = entry.pc.createDataChannel("chat");
        attachDc(p.sessionId, dc);
        entry.pc.createOffer()
          .then((offer) => entry.pc.setLocalDescription(offer))
          .then(() => {
            if (entry.pc.localDescription) {
              socket.emit("webrtc:offer", { to: p.sessionId, sdp: entry.pc.localDescription.sdp });
            }
          })
          .catch((err) => console.warn("[mesh] offer failed:", err));
      }
    }
    publishState();
  }, [socket, mySessionId, desiredPeers, ensurePeer, attachDc, dropPeer, publishState]);

  // Signaling event listeners.
  useEffect(() => {
    if (!socket) return;
    const onOffer = async (d: { from: string; sdp: string }) => {
      // Race: a peer's offer can arrive before our presence snapshot lists
      // them in desiredPeers (server fans out offers immediately; the periodic
      // presence broadcast may be slightly delayed). Falling back to a stub
      // peerInfo so we still set up the connection — nickname/color will be
      // overwritten the next time desiredPeers refreshes.
      const peerInfo = desiredPeers.find((p) => p.sessionId === d.from)
        ?? { sessionId: d.from, nickname: "…", color: "oklch(0.6 0.05 270)" };
      console.debug("[mesh] received offer from", d.from);
      const entry = ensurePeer(peerInfo);
      try {
        await entry.pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        if (entry.pc.localDescription) {
          socket.emit("webrtc:answer", { to: d.from, sdp: entry.pc.localDescription.sdp });
        }
      } catch (err) {
        console.warn("[mesh] handle offer failed:", err);
      }
    };
    const onAnswer = async (d: { from: string; sdp: string }) => {
      const entry = peersRef.current.get(d.from);
      if (!entry) return;
      try {
        await entry.pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
      } catch (err) {
        console.warn("[mesh] handle answer failed:", err);
      }
    };
    const onIce = async (d: { from: string; candidate: RTCIceCandidateInit }) => {
      const entry = peersRef.current.get(d.from);
      if (!entry) return;
      try {
        await entry.pc.addIceCandidate(d.candidate);
      } catch (err) {
        console.warn("[mesh] addIceCandidate failed:", err);
      }
    };
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    return () => {
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onIce);
    };
  }, [socket, desiredPeers, ensurePeer]);

  // Unmount cleanup.
  useEffect(() => {
    return () => {
      Array.from(peersRef.current.keys()).forEach(dropPeer);
    };
  }, [dropPeer]);

  /** Broadcast a JSON-serializable payload to every connected peer.
   *  Caller is responsible for chunking large payloads — DataChannel
   *  message size cap on Chromium is ~64 KB. Use `broadcastChunked`
   *  for arbitrary-sized binary. */
  const broadcast = useCallback((payload: unknown) => {
    const json = JSON.stringify(payload);
    let sent = 0;
    let pending = 0;
    peersRef.current.forEach((entry) => {
      if (entry.dc && entry.dc.readyState === "open") {
        try { entry.dc.send(json); sent++; } catch { /* drop */ }
      } else {
        pending++;
      }
    });
    console.debug("[mesh] broadcast — sent:", sent, "pending:", pending);
  }, []);

  /** Broadcast a binary file as chunked DataChannel messages using
   *  native ArrayBuffer frames — no base64, no JSON wrapping for data.
   *
   *  Protocol:
   *    text frame  { kind:"file-meta", transferId, name, mimeType, size }
   *    binary frames  [36-byte UUID][4-byte seq BE][raw data]  × N
   *    text frame  { kind:"file-end", transferId }
   *
   *  Sender reads the blob in 64 KB slices (never loads the whole file
   *  into memory at once) and applies per-peer SCTP backpressure.
   *  Each peer sends independently — a slow peer doesn't block others. */
  const broadcastChunked = useCallback(async (
    transferId: string,
    meta: { name: string; mimeType: string; size: number; kind: "file-meta" },
    blob: Blob,
    onProgress?: (sentBytes: number) => void,
  ) => {
    broadcast({ ...meta, transferId });

    // 64 KB chunks: 4× fewer round-trips vs the old 16 KB with no
    // compatibility risk (Chrome/Firefox tested safe at 64 KB SCTP).
    const CHUNK = 64 * 1024;
    // Stay safely below Chrome's 256 KB SCTP send buffer default.
    const HIGH_WATER = 256 * 1024;

    const idBytes = new TextEncoder().encode(transferId); // 36 ASCII bytes

    // Launch one async sender per peer so a slow peer's backpressure
    // doesn't stall the faster ones.
    const peerList = Array.from(peersRef.current.entries());

    let minOffset = 0; // for progress reporting — min across all peers
    const peerOffsets = new Map(peerList.map(([id]) => [id, 0]));

    const peerTasks = peerList.map(async ([sid, entry]) => {
      let offset = 0;
      let seq = 0;
      while (offset < blob.size) {
        if (!entry.dc || entry.dc.readyState !== "open") break;
        // Read one chunk at a time — no full-file arrayBuffer() allocation.
        const dataLen = Math.min(CHUNK, blob.size - offset);
        const sliceBuf = new Uint8Array(await blob.slice(offset, offset + dataLen).arrayBuffer());

        // Build binary frame: [transferId(36)][seq(4)][data]
        const frame = new Uint8Array(40 + dataLen);
        frame.set(idBytes, 0);
        new DataView(frame.buffer).setUint32(36, seq, false);
        frame.set(sliceBuf, 40);

        // Backpressure: spin until SCTP buffer drains below HIGH_WATER.
        // Re-check readyState in the loop so a channel that closes while
        // we're waiting doesn't spin forever on a buffer that never drains.
        while (entry.dc.bufferedAmount > HIGH_WATER && entry.dc.readyState === "open") {
          await new Promise((r) => setTimeout(r, 10));
        }
        if (entry.dc.readyState !== "open") break;
        try { entry.dc.send(frame.buffer); } catch { /* channel closed mid-send */ }

        offset += dataLen;
        seq++;

        // Update progress using the slowest peer's position.
        peerOffsets.set(sid, offset);
        minOffset = Math.min(...Array.from(peerOffsets.values()));
        onProgress?.(minOffset);
      }
    });

    await Promise.all(peerTasks);
    broadcast({ kind: "file-end", transferId });
  }, [broadcast]);

  void myNickname; // kept for potential identity payload — unused here
  return { peers, broadcast, broadcastChunked };
}
