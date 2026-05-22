import { memo, useCallback, useRef, useState } from "react";
import { BaseNode } from "../BaseNode";
import { useCanvasStore } from "../../../hooks/useCanvasStore";
import type { CharacterNodeData, CharacterKind } from "../../../../../shared/types";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { User, Mountain, Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";

interface Props {
  id: string;
  selected?: boolean;
  data: {
    nodeType: "character";
    title: string;
    payload: CharacterNodeData;
    projectId: number;
  };
}

const accent = "oklch(0.66 0.18 140)";
const accentA = (a: number) => `oklch(0.66 0.18 140 / ${a})`;
const BORDER_DEFAULT = "var(--c-bd2)";
const BORDER_ACCENT = accentA(0.5);

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 12,
  background: "var(--c-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: BORDER_DEFAULT,
  borderRadius: 8,
  color: "var(--c-t1)",
  outline: "none",
  transition: "border-color 150ms ease",
  lineHeight: 1.5,
  fontFamily: "var(--font-sans)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--c-t4)",
  display: "block",
  marginBottom: 5,
};

const LOCATION_TYPES = ["室内", "室外", "城市", "自然", "历史", "科幻", "奇幻", "水下"];
const ATMOSPHERES = ["明亮", "昏暗", "神秘", "浪漫", "紧张", "宁静", "史诗"];
const TIME_OF_DAY = ["清晨", "上午", "正午", "下午", "黄昏", "夜晚", "深夜"];

const KINDS: { id: CharacterKind; label: string; icon: React.ReactNode }[] = [
  { id: "person", label: "人物",   icon: <User style={{ width: 12, height: 12 }} /> },
  { id: "scene",  label: "场景",   icon: <Mountain style={{ width: 12, height: 12 }} /> },
];

export const CharacterNode = memo(function CharacterNode({ id, selected, data }: Props) {
  const { updateNodeData } = useCanvasStore();
  const payload = data.payload;
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const kind: CharacterKind = payload.characterKind ?? "person";

  const update = useCallback(
    (key: keyof CharacterNodeData, value: unknown) => updateNodeData(id, { [key]: value }),
    [id, updateNodeData],
  );

  const uploadMutation = trpc.upload.uploadImage.useMutation({
    onSuccess: (result) => {
      updateNodeData(id, { referenceImageUrl: result.url, referenceStorageKey: result.storageKey });
      setUploading(false);
      toast.success("参考图已上传");
    },
    onError: (err) => { setUploading(false); toast.error("上传失败：" + err.message); },
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("图片不能超过 16MB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ base64, mimeType: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Tag selector helper
  const TagPicker = ({ label, options, value, onChange }: {
    label: string;
    options: string[];
    value?: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(value === opt ? undefined : opt)}
            className="nodrag px-2 py-0.5 rounded text-[10px] transition-all"
            style={{
              background: value === opt ? accentA(0.15) : "var(--c-input)",
              border: `1px solid ${value === opt ? accentA(0.4) : "var(--c-bd2)"}`,
              color: value === opt ? accent : "var(--c-t3)",
              cursor: "pointer",
              fontWeight: value === opt ? 600 : 400,
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <BaseNode id={id} selected={selected} nodeType="character" title={data.title} minHeight={160} resizable>
      <div className="flex flex-col gap-3 p-3.5">

        {/* Kind toggle */}
        <div
          className="flex gap-0.5 p-0.5 rounded-lg"
          style={{ background: "var(--c-input)", border: "1px solid var(--c-bd1)" }}
        >
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => update("characterKind", k.id)}
              className="nodrag flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: kind === k.id ? accentA(0.18) : "transparent",
                border: `1px solid ${kind === k.id ? accentA(0.40) : "transparent"}`,
                color: kind === k.id ? accent : "var(--c-t3)",
                cursor: "pointer",
              }}
            >
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>

        {/* ── Reference image ── */}
        <div>
          <label style={labelStyle}>参考图</label>
          {payload.referenceImageUrl ? (
            <div className="relative rounded-lg overflow-hidden" style={{ border: `1px solid ${accentA(0.3)}` }}>
              <img
                src={payload.referenceImageUrl}
                alt="参考图"
                className="w-full object-cover"
                style={{ maxHeight: 140 }}
              />
              <div className="absolute top-1.5 right-1.5 flex gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="nodrag p-1 rounded transition-all"
                  style={{ background: "oklch(0.08 0.006 260 / 0.85)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)" }}
                  title="替换图片"
                >
                  <Upload style={{ width: 11, height: 11 }} />
                </button>
                <button
                  onClick={() => updateNodeData(id, { referenceImageUrl: undefined, referenceStorageKey: undefined })}
                  className="nodrag p-1 rounded transition-all"
                  style={{ background: "oklch(0.08 0.006 260 / 0.85)", border: "1px solid var(--c-bd3)", color: "var(--c-t2)" }}
                  title="清除图片"
                >
                  <X style={{ width: 11, height: 11 }} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="nodrag flex items-center justify-center gap-2 w-full py-4 rounded-lg transition-all"
              style={{
                background: accentA(0.05),
                border: `1.5px dashed ${accentA(0.30)}`,
                color: "var(--c-t3)",
                cursor: uploading ? "not-allowed" : "pointer",
              }}
            >
              {uploading
                ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                : <ImageIcon style={{ width: 16, height: 16 }} />}
              <span style={{ fontSize: 11 }}>{uploading ? "上传中..." : "上传参考图（可选）"}</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        {/* ── 人物 (Person) fields ── */}
        {kind === "person" && (
          <>
            <div className="flex gap-2">
              <div className="flex-1">
                <label style={labelStyle}>姓名</label>
                <input
                  type="text"
                  placeholder="角色姓名"
                  value={payload.name ?? ""}
                  onChange={(e) => update("name", e.target.value)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
              <div style={{ width: 100 }}>
                <label style={labelStyle}>性别</label>
                <select
                  value={payload.gender ?? ""}
                  onChange={(e) => update("gender", e.target.value)}
                  className="nodrag"
                  style={{ ...fieldStyle, cursor: "pointer" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                >
                  <option value="">不限</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="中性">中性</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label style={labelStyle}>职业 / 角色定位</label>
                <input
                  type="text"
                  placeholder="主角、侦探、教授..."
                  value={payload.role ?? ""}
                  onChange={(e) => update("role", e.target.value)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
              <div style={{ width: 80 }}>
                <label style={labelStyle}>年龄</label>
                <input
                  type="text"
                  placeholder="25岁"
                  value={payload.age ?? ""}
                  onChange={(e) => update("age", e.target.value)}
                  className="nodrag"
                  style={fieldStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>外貌特征</label>
              <textarea
                placeholder="身高、发色、眼神、服装风格..."
                value={payload.appearance ?? ""}
                onChange={(e) => update("appearance", e.target.value)}
                rows={2}
                className="nodrag"
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <div>
              <label style={labelStyle}>性格特征</label>
              <textarea
                placeholder="开朗、内敛、冷静、热情..."
                value={payload.personality ?? ""}
                onChange={(e) => update("personality", e.target.value)}
                rows={2}
                className="nodrag"
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
          </>
        )}

        {/* ── 场景 (Scene) fields ── */}
        {kind === "scene" && (
          <>
            <div>
              <label style={labelStyle}>场景名称</label>
              <input
                type="text"
                placeholder="废弃工厂、霓虹都市、古代宫廷..."
                value={payload.sceneName ?? ""}
                onChange={(e) => update("sceneName", e.target.value)}
                className="nodrag"
                style={fieldStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
            <TagPicker
              label="地点类型"
              options={LOCATION_TYPES}
              value={payload.locationType}
              onChange={(v) => update("locationType", v)}
            />
            <TagPicker
              label="时间"
              options={TIME_OF_DAY}
              value={payload.timeOfDay}
              onChange={(v) => update("timeOfDay", v)}
            />
            <TagPicker
              label="氛围"
              options={ATMOSPHERES}
              value={payload.atmosphere}
              onChange={(v) => update("atmosphere", v)}
            />
            <div>
              <label style={labelStyle}>场景描述</label>
              <textarea
                placeholder="详细描述场景的视觉元素、光线、质感..."
                value={payload.sceneDescription ?? ""}
                onChange={(e) => update("sceneDescription", e.target.value)}
                rows={3}
                className="nodrag"
                style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
              />
            </div>
          </>
        )}

        {/* Notes (shared) */}
        {selected && (
          <div>
            <label style={labelStyle}>补充备注</label>
            <textarea
              placeholder="其他需要记录的信息..."
              value={payload.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              rows={2}
              className="nodrag"
              style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = BORDER_ACCENT; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_DEFAULT; }}
            />
          </div>
        )}

      </div>
    </BaseNode>
  );
});
