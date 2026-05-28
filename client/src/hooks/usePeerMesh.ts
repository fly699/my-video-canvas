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
}

const RTC_CONFIG: RTCConfiguration = {
  // No STUN/TURN — same-LAN only by user's product choice. Host
  // candidates suffice when both peers are on the same subnet.
  iceServers: [],
};

export function usePeerMesh({ socket, mySessionId, myNickname, desiredPeers, onMessage }: UsePeerMeshOpts) {
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const [peers, setPeers] = useState<MeshPeer[]>([]);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

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
      publishState();
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        dropPeer(peerInfo.sessionId);
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit("webrtc:ice", { to: peerInfo.sessionId, candidate: e.candidate.toJSON() });
      }
    };
    pc.ondatachannel = (e) => {
      attachDc(peerInfo.sessionId, e.channel);
    };

    return entry;
  }, [socket, publishState, dropPeer]);

  const attachDc = useCallback((sessionId: string, dc: RTCDataChannel) => {
    const entry = peersRef.current.get(sessionId);
    if (!entry) return;
    entry.dc = dc;
    dc.onopen = () => {
      entry.ready = true;
      publishState();
    };
    dc.onclose = () => {
      entry.ready = false;
      publishState();
    };
    dc.onmessage = (ev) => {
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
      const peerInfo = desiredPeers.find((p) => p.sessionId === d.from);
      if (!peerInfo) return; // unknown peer
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
    peersRef.current.forEach((entry) => {
      if (entry.dc && entry.dc.readyState === "open") {
        try { entry.dc.send(json); } catch { /* drop */ }
      }
    });
  }, []);

  /** Broadcast a binary file as chunked DataChannel messages. The
   *  receiver pieces it back together by transferId. Respects
   *  bufferedAmount backpressure so we don't overflow the channel. */
  const broadcastChunked = useCallback(async (
    transferId: string,
    meta: { name: string; mimeType: string; size: number; kind: "file-meta" },
    blob: Blob,
    onProgress?: (sentBytes: number) => void,
  ) => {
    // 1. Announce metadata so receivers can prep state + UI.
    broadcast({ ...meta, transferId });
    // 2. Stream chunks. Chromium SCTP recommends ≤16 KB per message
    //    even though the spec allows 64 KB. Stay safe.
    const CHUNK = 16 * 1024;
    const HIGH_WATER = 512 * 1024;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let offset = 0;
    let seq = 0;
    while (offset < buf.length) {
      const slice = buf.slice(offset, offset + CHUNK);
      // base64 — DataChannel.send() supports ArrayBuffer too, but
      // JSON-wrapping keeps message dispatch uniform with text messages.
      let bin = "";
      for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
      const b64 = btoa(bin);
      const msg = JSON.stringify({ kind: "file-chunk", transferId, seq, data: b64 });
      await Promise.all(Array.from(peersRef.current.values()).map(async (entry) => {
        if (!entry.dc || entry.dc.readyState !== "open") return;
        // Backpressure: wait if buffer is getting full.
        while (entry.dc.bufferedAmount > HIGH_WATER) {
          await new Promise((r) => setTimeout(r, 20));
        }
        try { entry.dc.send(msg); } catch { /* drop */ }
      }));
      offset += CHUNK;
      seq++;
      onProgress?.(Math.min(offset, buf.length));
    }
    // 3. Send completion marker.
    broadcast({ kind: "file-end", transferId });
  }, [broadcast]);

  void myNickname; // kept for potential identity payload — unused here
  return { peers, broadcast, broadcastChunked };
}
