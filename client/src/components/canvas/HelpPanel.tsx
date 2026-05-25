import { useState, useEffect, useRef } from "react";
import { X, ChevronRight, BookOpen, Search } from "lucide-react";
import type { NodeType } from "../../../../shared/types";
import {
  HELP_SECTIONS,
  getHelpSectionByNodeType,
  type HelpSection,
  type HelpBlock,
  COMFYUI_SECTION_IDS,
} from "../../lib/helpContent";

// ── Block renderer ────────────────────────────────────────────────────────────

function HelpBlockView({ block }: { block: HelpBlock }) {
  if (block.type === "p") {
    return <p className="text-sm leading-relaxed" style={{ color: "var(--c-t2)" }}>{block.text}</p>;
  }
  if (block.type === "h3") {
    return (
      <h3 className="text-xs font-semibold uppercase tracking-wider mt-4 mb-1.5" style={{ color: "var(--c-t4)" }}>
        {block.text}
      </h3>
    );
  }
  if (block.type === "tip") {
    return (
      <div
        className="flex gap-2 p-2.5 rounded-lg text-xs leading-relaxed"
        style={{ background: "oklch(0.68 0.22 285 / 0.08)", border: "1px solid oklch(0.68 0.22 285 / 0.2)", color: "var(--c-t2)" }}
      >
        <span style={{ flexShrink: 0 }}>💡</span>
        <span>{block.text}</span>
      </div>
    );
  }
  if (block.type === "warn") {
    return (
      <div
        className="flex gap-2 p-2.5 rounded-lg text-xs leading-relaxed"
        style={{ background: "oklch(0.68 0.20 60 / 0.08)", border: "1px solid oklch(0.68 0.20 60 / 0.25)", color: "var(--c-t2)" }}
      >
        <span style={{ flexShrink: 0 }}>⚠️</span>
        <span>{block.text}</span>
      </div>
    );
  }
  if (block.type === "steps") {
    return (
      <ol className="flex flex-col gap-1.5 pl-1">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--c-t2)" }}>
            <span
              className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
              style={{ background: "oklch(0.68 0.22 285 / 0.15)", color: "oklch(0.78 0.18 285)" }}
            >
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === "kv") {
    return (
      <div className="flex flex-col gap-1.5">
        {block.rows.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <span
              className="flex-shrink-0 text-xs font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "var(--c-elevated)",
                border: "1px solid var(--c-bd3)",
                color: "oklch(0.72 0.12 285)",
                fontSize: 10,
                lineHeight: "1.4",
                whiteSpace: "nowrap",
                alignSelf: "flex-start",
              }}
            >
              {k}
            </span>
            <span className="text-xs leading-relaxed" style={{ color: "var(--c-t3)" }}>{v}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "code") {
    return (
      <pre
        className="text-xs rounded-lg p-3 overflow-x-auto leading-relaxed"
        style={{
          background: "var(--c-elevated)",
          border: "1px solid var(--c-bd3)",
          color: "oklch(0.72 0.12 285)",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {block.text}
      </pre>
    );
  }
  return null;
}

// ── Section view ──────────────────────────────────────────────────────────────

function SectionView({ section, onClose }: { section: HelpSection; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--c-bd1)" }}
      >
        <span style={{ fontSize: 18 }}>{section.emoji}</span>
        <span className="text-sm font-semibold flex-1 leading-tight" style={{ color: "var(--c-t1)" }}>
          {section.title}
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center transition-all"
          style={{ color: "var(--c-t4)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {section.content.map((block, i) => (
          <HelpBlockView key={i} block={block} />
        ))}
        <div className="h-4" />
      </div>
    </div>
  );
}

// ── Main HelpPanel ────────────────────────────────────────────────────────────

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  /** When a node is selected, auto-navigate to its help section */
  activeNodeType?: NodeType | null;
}

const TOC_GROUPS = [
  {
    label: "画布基础",
    ids: ["canvas-basics", "workflow-runner", "connection-rules"],
  },
  {
    label: "内容创作节点",
    ids: ["node-script", "node-storyboard", "node-prompt", "node-image-gen", "node-asset", "node-note", "node-character"],
  },
  {
    label: "AI 生成节点",
    ids: ["node-video-task", "node-ai-chat", "node-audio", "node-voice-clone", "node-lip-sync", "node-avatar"],
  },
  {
    label: "视频处理节点",
    ids: ["node-clip", "node-merge", "node-subtitle", "node-overlay", "node-subtitle-motion", "node-smart-cut", "node-post-process", "node-pose-control"],
  },
  {
    label: "ComfyUI 集成",
    ids: ["node-comfyui-image", "node-comfyui-video", "node-comfyui-workflow", "comfyui-setup"],
  },
  {
    label: "进阶指南",
    ids: ["workflow-examples"],
  },
];

export function HelpPanel({ open, onClose, activeNodeType }: HelpPanelProps) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const activeSection = activeSectionId ? HELP_SECTIONS.find((s) => s.id === activeSectionId) : null;

  // When a node is selected, jump to its help section
  useEffect(() => {
    if (!open || !activeNodeType) return;
    const section = getHelpSectionByNodeType(activeNodeType);
    if (section) setActiveSectionId(section.id);
  }, [activeNodeType, open]);

  // Filter sections by search
  const filteredSections = searchQuery.trim()
    ? HELP_SECTIONS.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.content.some((b) => {
          if (b.type === "p" || b.type === "h3" || b.type === "tip" || b.type === "warn") return b.text.toLowerCase().includes(searchQuery.toLowerCase());
          if (b.type === "steps") return b.items.some((i) => i.toLowerCase().includes(searchQuery.toLowerCase()));
          if (b.type === "kv") return b.rows.some(([k, v]) => k.toLowerCase().includes(searchQuery.toLowerCase()) || v.toLowerCase().includes(searchQuery.toLowerCase()));
          return false;
        })
      )
    : null;

  if (!open) return null;

  return (
    <div
      className="absolute top-0 right-0 h-full z-40 flex flex-col"
      style={{
        width: 340,
        background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        backdropFilter: "blur(24px)",
        borderLeft: "1px solid var(--c-bd2)",
        boxShadow: "-8px 0 32px oklch(0 0 0 / 0.25)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {activeSection ? (
        <SectionView section={activeSection} onClose={() => setActiveSectionId(null)} />
      ) : (
        // ── ToC ──────────────────────────────────────────────────────────────
        <div className="flex flex-col h-full">
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--c-bd1)" }}
          >
            <BookOpen style={{ width: 14, height: 14, color: "oklch(0.68 0.22 285)" }} />
            <span className="text-sm font-semibold flex-1" style={{ color: "var(--c-t1)" }}>操作指南</span>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded flex items-center justify-center transition-all"
              style={{ color: "var(--c-t4)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t1)"; (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--c-t4)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-bd1)" }}>
            <div className="relative">
              <Search
                style={{ width: 12, height: 12, position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--c-t4)" }}
              />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索指南..."
                className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--c-elevated)",
                  border: "1px solid var(--c-bd3)",
                  color: "var(--c-t1)",
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--c-t4)" }}
                >
                  <X style={{ width: 10, height: 10 }} />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto py-2">
            {filteredSections ? (
              // Search results
              filteredSections.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--c-t4)" }}>
                  未找到匹配的指南
                </div>
              ) : (
                <div className="px-2">
                  {filteredSections.map((section) => (
                    <SectionItem
                      key={section.id}
                      section={section}
                      onClick={() => setActiveSectionId(section.id)}
                    />
                  ))}
                </div>
              )
            ) : (
              // ToC groups
              TOC_GROUPS.map((group) => (
                <div key={group.label} className="mb-1">
                  <div
                    className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--c-t4)" }}
                  >
                    {group.label}
                  </div>
                  <div className="px-2">
                    {group.ids.map((id) => {
                      const section = HELP_SECTIONS.find((s) => s.id === id);
                      if (!section) return null;
                      return (
                        <SectionItem
                          key={id}
                          section={section}
                          onClick={() => setActiveSectionId(id)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            <div className="h-4" />
          </div>

          {/* Footer */}
          <div
            className="px-4 py-2.5 flex-shrink-0 text-[10px] text-center"
            style={{ borderTop: "1px solid var(--c-bd1)", color: "var(--c-t4)" }}
          >
            选中画布节点时自动跳转到对应指南
          </div>
        </div>
      )}
    </div>
  );
}

function SectionItem({ section, onClick }: { section: HelpSection; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all"
      style={{ color: "var(--c-t2)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
        (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.color = "var(--c-t2)";
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{section.emoji}</span>
      <span className="text-xs flex-1 leading-snug">{section.title}</span>
      <ChevronRight style={{ width: 10, height: 10, flexShrink: 0, color: "var(--c-t4)" }} />
    </button>
  );
}

// ── Node help trigger (small ? button shown in BaseNode header) ───────────────

interface NodeHelpTriggerProps {
  nodeType: NodeType;
  onOpenHelp: (sectionId: string) => void;
}

export function NodeHelpTrigger({ nodeType, onOpenHelp }: NodeHelpTriggerProps) {
  const section = getHelpSectionByNodeType(nodeType);
  if (!section) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpenHelp(section.id);
      }}
      className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold transition-all flex-shrink-0"
      style={{
        background: "var(--c-elevated)",
        border: "1px solid var(--c-bd3)",
        color: "var(--c-t4)",
        lineHeight: 1,
      }}
      title={`查看${section.title}帮助`}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.22 285 / 0.15)";
        (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.68 0.22 285 / 0.4)";
        (e.currentTarget as HTMLElement).style.color = "oklch(0.78 0.18 285)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd3)";
        (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
      }}
    >
      ?
    </button>
  );
}
