import { memo } from "react";
import type { CollaboratorCursor } from "../../../../shared/types";

interface Props {
  cursors: CollaboratorCursor[];
  viewport: { x: number; y: number; zoom: number };
}

export const CollaboratorCursors = memo(function CollaboratorCursors({ cursors, viewport }: Props) {
  return (
    <>
      {cursors.map((cursor) => {
        const screenX = cursor.x * viewport.zoom + viewport.x;
        const screenY = cursor.y * viewport.zoom + viewport.y;

        return (
          <div
            key={cursor.userId}
            className="pointer-events-none fixed z-50"
            style={{
              left: screenX,
              top: screenY,
              transition: "left 80ms linear, top 80ms linear",
            }}
          >
            {/* Cursor */}
            <svg
              width="18"
              height="22"
              viewBox="0 0 18 22"
              fill="none"
              style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}
            >
              <path
                d="M2 2L14 8.5L9.5 10L7 17L2 2Z"
                fill={cursor.color}
                stroke="rgba(255,255,255,0.8)"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            {/* Name badge */}
            <div
              className="absolute top-4 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white whitespace-nowrap"
              style={{
                background: cursor.color,
                boxShadow: `0 2px 8px ${cursor.color}60`,
                letterSpacing: "0.01em",
              }}
            >
              {cursor.userName}
            </div>
          </div>
        );
      })}
    </>
  );
});
