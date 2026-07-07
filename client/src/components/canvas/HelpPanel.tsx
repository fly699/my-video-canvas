import { useState, useEffect, useRef, useCallback } from "react";
import { X, ChevronRight, BookOpen, Search, Copy, Check, Plus, ArrowLeft } from "lucide-react";
import type { NodeType } from "../../../../shared/types";
import {
  HELP_SECTIONS,
  getHelpSectionByNodeType,
  type HelpSection,
  type HelpBlock,
} from "../../lib/helpContent";

// ── Helpers ────────────────────────────────────────────────────────────────────

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          background: "oklch(0.80 0.20 80 / 0.35)",
          color: "inherit",
          borderRadius: 2,
          padding: "0 1px",
        }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
      {highlight(text.slice(idx + query.length), query)}
    </>
  );
}

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyBtn({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard unavailable (HTTP / permission denied) — fail silently */ });
  }, [text]);
  return (
    <button
      onClick={handle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 4,
        background: copied ? "oklch(0.65 0.20 140 / 0.12)" : "var(--c-elevated)",
        border: `1px solid ${copied ? "oklch(0.65 0.20 140 / 0.35)" : "var(--c-bd3)"}`,
        color: copied ? "oklch(0.70 0.18 140)" : "var(--c-t4)",
        cursor: "pointer",
        transition: "all 180ms",
        flexShrink: 0,
        lineHeight: 1,
      }}
      title={label}
    >
      {copied
        ? <Check style={{ width: 10, height: 10 }} />
        : <Copy style={{ width: 10, height: 10 }} />}
      {copied ? "已复制" : label}
    </button>
  );
}

// ── Individual block renderers ─────────────────────────────────────────────────

function KvRow({ k, v, query }: { k: string; v: string; query: string }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="flex items-start gap-2 py-0.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "monospace",
          padding: "1px 6px",
          borderRadius: 4,
          background: "var(--c-elevated)",
          border: "1px solid var(--c-bd3)",
          color: "oklch(0.72 0.12 285)",
          whiteSpace: "nowrap",
          alignSelf: "flex-start",
          lineHeight: "1.5",
        }}
      >
        {highlight(k, query)}
      </span>
      <span
        className="text-xs flex-1 leading-relaxed"
        style={{ color: "var(--c-t3)", minWidth: 0 }}
      >
        {highlight(v, query)}
      </span>
      <div style={{ opacity: hover ? 1 : 0, transition: "opacity 150ms", flexShrink: 0 }}>
        <CopyBtn text={v} label="复制值" />
      </div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="relative group/code">
      <pre
        style={{
          fontSize: 11,
          borderRadius: 8,
          padding: "10px 12px",
          paddingRight: 70,
          overflowX: "auto",
          background: "var(--c-elevated)",
          border: "1px solid var(--c-bd3)",
          color: "oklch(0.72 0.12 285)",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {text}
      </pre>
      <div
        style={{
          position: "absolute",
          top: 6,
          right: 8,
        }}
      >
        <CopyBtn text={text} />
      </div>
    </div>
  );
}

function HelpBlockView({ block, query = "" }: { block: HelpBlock; query?: string }) {
  if (block.type === "h3") return null; // handled by CollapsibleGroup

  if (block.type === "p") {
    return (
      <p className="text-xs leading-relaxed" style={{ color: "var(--c-t2)" }}>
        {highlight(block.text, query)}
      </p>
    );
  }
  if (block.type === "tip") {
    return (
      <div
        className="flex gap-2 rounded-lg p-2.5"
        style={{
          background: "oklch(0.68 0.22 285 / 0.07)",
          border: "1px solid oklch(0.68 0.22 285 / 0.2)",
        }}
      >
        <span style={{ flexShrink: 0 }}>💡</span>
        <span className="text-xs leading-relaxed" style={{ color: "var(--c-t2)" }}>
          {highlight(block.text, query)}
        </span>
      </div>
    );
  }
  if (block.type === "warn") {
    return (
      <div
        className="flex gap-2 rounded-lg p-2.5"
        style={{
          background: "oklch(0.68 0.20 60 / 0.07)",
          border: "1px solid oklch(0.68 0.20 60 / 0.25)",
        }}
      >
        <span style={{ flexShrink: 0 }}>⚠️</span>
        <span className="text-xs leading-relaxed" style={{ color: "var(--c-t2)" }}>
          {highlight(block.text, query)}
        </span>
      </div>
    );
  }
  if (block.type === "steps") {
    return (
      <ol className="flex flex-col gap-1.5 pl-0 list-none">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--c-t2)" }}>
            <span
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "oklch(0.68 0.22 285 / 0.13)",
                color: "oklch(0.78 0.18 285)",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              {i + 1}
            </span>
            <span>{highlight(item, query)}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === "kv") {
    return (
      <div className="flex flex-col gap-1">
        {block.rows.map(([k, v], i) => (
          <KvRow key={i} k={k} v={v} query={query} />
        ))}
      </div>
    );
  }
  if (block.type === "code") {
    return <CodeBlock text={block.text} />;
  }
  return null;
}

// ── Collapsible group (h3 → collapsible subsection) ──────────────────────────

function CollapsibleGroup({
  heading,
  blocks,
  defaultOpen,
  query,
}: {
  heading?: string;
  blocks: HelpBlock[];
  defaultOpen: boolean;
  query: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      {heading && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 py-1.5 text-left select-none"
          style={{ cursor: "pointer" }}
        >
          <ChevronRight
            style={{
              width: 11,
              height: 11,
              flexShrink: 0,
              color: "var(--c-t4)",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 200ms ease",
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: open ? "oklch(0.72 0.15 285)" : "var(--c-t4)",
              transition: "color 200ms",
            }}
          >
            {highlight(heading, query)}
          </span>
        </button>
      )}
      <div
        style={{
          overflow: "hidden",
          maxHeight: open ? 9999 : 0,
          opacity: open ? 1 : 0,
          transition: "max-height 200ms ease, opacity 200ms ease",
          paddingLeft: heading ? 16 : 0,
        }}
      >
        <div className="flex flex-col gap-2 pb-1">
          {blocks.map((block, i) => (
            <HelpBlockView key={i} block={block} query={query} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Parse content into groups ─────────────────────────────────────────────────

function groupContent(content: HelpBlock[]) {
  const groups: { heading?: string; blocks: HelpBlock[] }[] = [];
  let current: { heading?: string; blocks: HelpBlock[] } = { blocks: [] };
  for (const block of content) {
    if (block.type === "h3") {
      if (current.blocks.length > 0 || current.heading !== undefined) {
        groups.push(current);
      }
      current = { heading: block.text, blocks: [] };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.blocks.length > 0 || current.heading !== undefined) {
    groups.push(current);
  }
  return groups;
}

// ── Section detail view ───────────────────────────────────────────────────────

function SectionView({
  section,
  onBack,
  onClose,
  onAddNode,
  query,
}: {
  section: HelpSection;
  onBack: () => void;
  onClose: () => void;
  onAddNode?: (nodeType: NodeType) => void;
  query: string;
}) {
  const groups = groupContent(section.content);
  const accentColor = section.nodeType
    ? `oklch(0.65 0.20 ${nodeTypeHue(section.nodeType)})`
    : "oklch(0.68 0.22 285)";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-3 py-2.5 flex-shrink-0"
        style={{
          borderBottom: "1px solid var(--c-bd1)",
          background: `${accentColor.replace(")", " / 0.05)")}`,
        }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-1.5 py-1 rounded transition-all text-xs"
          style={{ color: "var(--c-t4)", flexShrink: 0 }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
          }}
        >
          <ArrowLeft style={{ width: 11, height: 11 }} />
          <span style={{ fontSize: 10 }}>目录</span>
        </button>

        <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{section.emoji}</span>
        <span
          className="text-sm font-semibold flex-1 leading-tight truncate"
          style={{ color: "var(--c-t1)" }}
        >
          {section.title}
        </span>

        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 transition-all"
          style={{ color: "var(--c-t4)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
          }}
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* "Add to canvas" pill */}
      {section.nodeType && onAddNode && (
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--c-bd1)" }}
        >
          <button
            onClick={() => onAddNode(section.nodeType!)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: `${accentColor.replace(")", " / 0.12)")}`,
              border: `1px solid ${accentColor.replace(")", " / 0.35)")}`,
              color: accentColor,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.8";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
          >
            <Plus style={{ width: 12, height: 12 }} />
            添加此节点到画布
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5">
        {groups.map((group, i) => (
          <CollapsibleGroup
            key={i}
            heading={group.heading}
            blocks={group.blocks}
            defaultOpen={i === 0 || !group.heading}
            query={query}
          />
        ))}
        <div className="h-4" />
      </div>
    </div>
  );
}

function nodeTypeHue(nodeType: NodeType): number {
  const hues: Partial<Record<NodeType, number>> = {
    script: 240, storyboard: 160, prompt: 300, image_gen: 330, asset: 60,
    video_task: 25, ai_chat: 200, note: 90, audio: 340, post_process: 190,
    group: 260, character: 140, clip: 55, merge: 270, subtitle: 170,
    overlay: 30, subtitle_motion: 175, smart_cut: 65, pose_control: 310,
    voice_clone: 350, lip_sync: 220, avatar: 290,
    comfyui_image: 100, comfyui_video: 50, comfyui_workflow: 140,
  };
  return hues[nodeType] ?? 285;
}

// ── ToC ───────────────────────────────────────────────────────────────────────

const TOC_GROUPS = [
  { label: "画布基础", ids: ["canvas-basics", "workflow-runner", "connection-rules"] },
  { label: "界面与协作", ids: ["ui-panels", "themes-appearance", "canvas-agent-chat", "collaboration", "lan-chat"] },
  { label: "内容创作节点", ids: ["node-script", "node-storyboard", "node-prompt", "node-image-gen", "node-asset", "node-note", "node-character", "node-group"] },
  { label: "AI 生成节点", ids: ["node-video-task", "node-ai-chat", "node-audio", "node-voice-clone", "node-lip-sync", "node-avatar"] },
  { label: "视频处理节点", ids: ["node-clip", "node-merge", "node-subtitle", "node-overlay", "node-subtitle-motion", "node-smart-cut", "node-post-process", "node-pose-control"] },
  { label: "ComfyUI 集成", ids: ["node-comfyui-image", "node-comfyui-video", "node-comfyui-workflow", "comfyui-setup", "comfyui-params-reference", "comfyui-workflow-advanced", "comfyui-troubleshoot"] },
  { label: "系统配置", ids: ["server-env-config", "admin-guide", "api-interface-config", "claude-bridge"] },
  { label: "进阶指南", ids: ["workflow-examples"] },
];

function SectionItem({
  section,
  onClick,
  query,
}: {
  section: HelpSection;
  onClick: () => void;
  query: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-all"
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
      <span className="text-xs flex-1 leading-snug">
        {highlight(section.title, query)}
      </span>
      <ChevronRight style={{ width: 10, height: 10, flexShrink: 0, color: "var(--c-t4)" }} />
    </button>
  );
}

// ── Main HelpPanel ────────────────────────────────────────────────────────────

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  activeNodeType?: NodeType | null;
  onAddNode?: (nodeType: NodeType) => void;
}

export function HelpPanel({ open, onClose, activeNodeType, onAddNode }: HelpPanelProps) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Tracks the section id that the auto-jump effect set, so we only reset on a
  // no-help node when the user hasn't manually navigated away from it.
  const autoJumpedSectionRef = useRef<string | null>(null);
  const activeSectionIdRef = useRef<string | null>(null);
  useEffect(() => { activeSectionIdRef.current = activeSectionId; }, [activeSectionId]);

  const activeSection = activeSectionId
    ? HELP_SECTIONS.find((s) => s.id === activeSectionId)
    : null;

  // Reset transient state when the panel closes so it opens fresh next time.
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setActiveSectionId(null);
      autoJumpedSectionRef.current = null;
    }
  }, [open]);

  // Auto-jump to node section when panel opens / node selection changes
  useEffect(() => {
    if (!open || !activeNodeType) return;
    const section = getHelpSectionByNodeType(activeNodeType);
    if (section) {
      setActiveSectionId(section.id);
      autoJumpedSectionRef.current = section.id;
    } else if (activeSectionIdRef.current !== null && activeSectionIdRef.current === autoJumpedSectionRef.current) {
      // The current view was set by a prior auto-jump and the new node has no
      // help entry — fall back to ToC. If the user has manually navigated since
      // the last auto-jump, preserve their reading position.
      setActiveSectionId(null);
      autoJumpedSectionRef.current = null;
    }
  }, [activeNodeType, open]);

  // Search filter
  const filteredSections = searchQuery.trim()
    ? HELP_SECTIONS.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.content.some((b) => {
          if (b.type === "p" || b.type === "h3" || b.type === "tip" || b.type === "warn")
            return b.text.toLowerCase().includes(searchQuery.toLowerCase());
          if (b.type === "steps")
            return b.items.some((i) => i.toLowerCase().includes(searchQuery.toLowerCase()));
          if (b.type === "kv")
            return b.rows.some(([k, v]) =>
              k.toLowerCase().includes(searchQuery.toLowerCase()) ||
              v.toLowerCase().includes(searchQuery.toLowerCase())
            );
          return false;
        })
      )
    : null;

  return (
    <div
      className="fixed top-0 right-0 h-full z-40 flex flex-col"
      style={{
        width: 340,
        background: "color-mix(in oklch, var(--c-base) 97%, transparent)",
        backdropFilter: "blur(28px)",
        borderLeft: "1px solid var(--c-bd2)",
        boxShadow: "-8px 0 40px oklch(0 0 0 / 0.28)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        pointerEvents: open ? "auto" : "none",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {activeSection ? (
        <SectionView
          section={activeSection}
          onBack={() => setActiveSectionId(null)}
          onClose={onClose}
          onAddNode={onAddNode}
          query={searchQuery}
        />
      ) : (
        /* ── ToC ── */
        <div className="flex flex-col h-full">
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--c-bd1)" }}
          >
            <BookOpen style={{ width: 14, height: 14, color: "oklch(0.68 0.22 285)" }} />
            <span className="text-sm font-semibold flex-1" style={{ color: "var(--c-t1)" }}>
              操作指南
            </span>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded flex items-center justify-center transition-all"
              style={{ color: "var(--c-t4)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--c-elevated)";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--c-t4)";
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* Search */}
          <div
            className="px-3 py-2 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--c-bd1)" }}
          >
            <div className="relative">
              <Search
                style={{
                  width: 12,
                  height: 12,
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--c-t4)",
                  pointerEvents: "none",
                }}
              />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索指南内容..."
                className="w-full pl-7 pr-8 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--c-elevated)",
                  border: "1px solid var(--c-bd3)",
                  color: "var(--c-t1)",
                  transition: "border-color 150ms",
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.68 0.22 285 / 0.5)";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--c-bd3)";
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded flex items-center justify-center"
                  style={{ color: "var(--c-t4)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--c-bd2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <X style={{ width: 10, height: 10 }} />
                </button>
              )}
            </div>
            {searchQuery && (
              <p className="text-[10px] mt-1.5" style={{ color: "var(--c-t4)" }}>
                {filteredSections?.length ?? 0} 个结果
              </p>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto py-1.5">
            {filteredSections ? (
              filteredSections.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs" style={{ color: "var(--c-t4)" }}>
                  未找到匹配内容
                </div>
              ) : (
                <div className="px-2">
                  {filteredSections.map((section) => (
                    <SectionItem
                      key={section.id}
                      section={section}
                      onClick={() => setActiveSectionId(section.id)}
                      query={searchQuery}
                    />
                  ))}
                </div>
              )
            ) : (
              TOC_GROUPS.map((group) => (
                <div key={group.label} className="mb-0.5">
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
                          query=""
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
            className="px-4 py-2 flex-shrink-0 text-[10px] text-center"
            style={{ borderTop: "1px solid var(--c-bd1)", color: "var(--c-t4)" }}
          >
            选中节点时自动跳转对应指南
          </div>
        </div>
      )}
    </div>
  );
}

// ── Node help trigger (small ? button for BaseNode header) ────────────────────

export function NodeHelpTrigger({
  nodeType,
  onOpenHelp,
}: {
  nodeType: NodeType;
  onOpenHelp: (sectionId: string) => void;
}) {
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
