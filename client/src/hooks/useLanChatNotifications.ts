import { useEffect, useRef, useState } from "react";
import type { LanChatMessage } from "../../../shared/types";

/**
 * Tracks unread count + plays a notification sound + fires browser
 * Notification when a new LAN chat message arrives while the user isn't
 * actively looking at the open chat panel.
 *
 *  - `isOpen` = panel is rendered AND not collapsed/hidden
 *  - When tab is backgrounded (document.hidden), still considered "not
 *    looking" even if open.
 */
export function useLanChatNotifications(opts: {
  latestMessage: LanChatMessage | null;
  ownNickname: string | null;
  isOpen: boolean;
}) {
  const { latestMessage, ownNickname, isOpen } = opts;
  const [unread, setUnread] = useState(0);
  const lastIdRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Lazy audio element. We use a tiny inline base64 chime to avoid adding a
  // separate asset file — keeps the bundle simple and the sound deterministic.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (audioRef.current) return;
    // 0.2s 880Hz beep, encoded as base64 WAV. ~3KB — small enough to inline.
    // Generated with: ffmpeg -f lavfi -i "sine=f=880:d=0.18" -ar 8000 chime.wav
    audioRef.current = new Audio(
      "data:audio/wav;base64,UklGRoQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YV4DAACAi5acpaSjnZSJfHBjWE9HQT4+QEZOWGZ0gIyZpqyusKijmZGFeGtfVUtFP0BBR1BcaXSAjJurtL3DwsbBuq+jl4yBd2tlYV9hY2ltcnh+hYyTmZyhpKWmoZ2YkYyEf3lybGdkYV9eXl5gY2ZqcHV6gISJjpKVl5manJ2dnp+goJ+enZyZl5SQjYqHhYJ/fHl3dnNxcG9ub25ubm9vcHFydHV3eHl7fHx9fX5+f4CBgYKDg4SEhYSFhYWFhYWFhYSEhIODgoKBgYCAfn59fHt6eXh3dnV0c3JxcHBvb25ubW1tbW1tbW5ubm9vcHFxcnNzdHV2dnd4eXl6e3x9fX5+f3+AgIGBgoKDg4ODg4ODg4OCgoKBgYGAgH9/f359fX18fHt7e3p6enp6enp6enp6enp6enp6enp7e3t7fHx8fH19fX1+fn5+fn9/f39/gICAgICAgICAgICAgICAgICAgIB/f39/f39/f39/f39/f39/f39/f3+AgICAgIB/f39/f39/f39/f39/f3+A",
    );
    audioRef.current.volume = 0.5;
  }, []);

  // Request notification permission once on mount.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // React to new messages.
  useEffect(() => {
    if (!latestMessage) return;
    // Skip messages we've already processed (latestMessage may be stable
    // across renders).
    if (lastIdRef.current === latestMessage.id) return;
    lastIdRef.current = latestMessage.id;

    // Don't notify on own messages.
    if (ownNickname && latestMessage.nickname === ownNickname) {
      setUnread(0);
      return;
    }

    const looking = isOpen && !document.hidden;
    if (looking) {
      setUnread(0);
      return;
    }

    setUnread((n) => n + 1);
    try {
      audioRef.current?.play().catch(() => {});
    } catch { /* autoplay restrictions — ignore */ }

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`${latestMessage.nickname}`, {
          body: latestMessage.content.slice(0, 120) || (latestMessage.attachments?.length ? "[附件]" : ""),
          icon: "/favicon.ico",
          tag: "lan-chat",
        });
      } catch { /* iOS Safari etc. */ }
    }
  }, [latestMessage, ownNickname, isOpen]);

  // Clear unread when the panel becomes visible.
  useEffect(() => {
    if (isOpen && !document.hidden) setUnread(0);
  }, [isOpen]);

  return { unread, clearUnread: () => setUnread(0) };
}
