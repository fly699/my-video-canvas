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
            className="pointer-events-none fixed z-50 transition-all duration-75"
            style={{ left: screenX, top: screenY }}
          >
            {/* Cursor SVG */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              style={{ filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.5))` }}
            >
              <path
                d="M4 2L16 10L10 11L7 18L4 2Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1"
              />
            </svg>
            {/* Name tag */}
            <div
              className="absolute top-4 left-3 px-2 py-0.5 rounded-full text-[10px] font-medium text-white whitespace-nowrap"
              style={{ background: cursor.color }}
            >
              {cursor.userName}
            </div>
          </div>
        );
      })}
    </>
  );
});
