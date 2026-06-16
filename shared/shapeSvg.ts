// 形状 → SVG。前端预览与后端导出共用同一份几何，保证 WYSIWYG。
// 形状在 w×h(像素) 的画框内生成；导出按目标分辨率光栅化(resvg)，预览用 data-URL <img>。

export type ShapeType =
  | "rect" | "roundRect" | "circle" | "ellipse" | "triangle" | "diamond"
  | "pentagon" | "hexagon" | "star" | "heart" | "arrow" | "line";

export type FillType = "solid" | "linear" | "radial" | "pattern";
export type PatternKind = "dots" | "stripes" | "grid" | "checker";

export interface ShapeSpec {
  type: ShapeType;
  w?: number; h?: number;          // 画框尺寸（占画布 0..1，仅排版用；本函数用像素）
  fill?: boolean;                  // true=填充，false=仅描边
  color?: string;                  // 主色（填充色或描边色）
  color2?: string;                 // 渐变第二色
  fillType?: FillType;             // 填充方式
  pattern?: PatternKind;           // 图案类型（fillType=pattern）
  lineWidth?: number;              // 描边宽度(px @ 输出分辨率)
  opacity?: number;                // 0..1
  radius?: number;                 // 圆角矩形圆角 / 星形内径比(0..1)
  svg?: string;                    // 自定义 SVG（优先于 type；PR2）
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
function safeColor(c: string | undefined, fallback: string): string {
  const v = (c ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$|^[a-zA-Z]{3,20}$/.test(v) ? v : fallback;
}

/** 正多边形顶点（内接于 cx,cy 半径 rx,ry 的椭圆，从顶端起、可加旋转相位）。 */
function polyPoints(cx: number, cy: number, rx: number, ry: number, n: number, phase = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i * 2 * Math.PI) / n;
    pts.push(`${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** 星形顶点（外/内半径交替，count 个角）。 */
function starPoints(cx: number, cy: number, rx: number, ry: number, count: number, innerRatio: number): string {
  const pts: string[] = [];
  for (let i = 0; i < count * 2; i++) {
    const outer = i % 2 === 0;
    const a = -Math.PI / 2 + (i * Math.PI) / count;
    const r = outer ? 1 : innerRatio;
    pts.push(`${(cx + rx * r * Math.cos(a)).toFixed(2)},${(cy + ry * r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** 生成形状主体元素（不含 svg 外壳/defs）。geomFill 为 fill 属性值（颜色或 url(#id)）。 */
function shapeBody(s: ShapeSpec, w: number, h: number, sw: number, geomFill: string, strokeAttr: string): string {
  const cx = w / 2, cy = h / 2;
  const ix = sw / 2, rx = (w - sw) / 2, ry = (h - sw) / 2; // inset by half stroke so stroke fits inside
  const common = `fill="${geomFill}" ${strokeAttr}`;
  switch (s.type) {
    case "rect": return `<rect x="${ix}" y="${ix}" width="${w - sw}" height="${h - sw}" ${common}/>`;
    case "roundRect": {
      const r = Math.max(0, Math.min(0.5, s.radius ?? 0.18)) * Math.min(w, h);
      return `<rect x="${ix}" y="${ix}" width="${w - sw}" height="${h - sw}" rx="${r.toFixed(2)}" ${common}/>`;
    }
    case "ellipse": return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${common}/>`;
    case "circle": { const r = Math.min(rx, ry); return `<circle cx="${cx}" cy="${cy}" r="${r}" ${common}/>`; }
    case "triangle": return `<polygon points="${cx},${ix} ${w - ix},${h - ix} ${ix},${h - ix}" ${common}/>`;
    case "diamond": return `<polygon points="${cx},${ix} ${w - ix},${cy} ${cx},${h - ix} ${ix},${cy}" ${common}/>`;
    case "pentagon": return `<polygon points="${polyPoints(cx, cy, rx, ry, 5)}" ${common}/>`;
    case "hexagon": return `<polygon points="${polyPoints(cx, cy, rx, ry, 6)}" ${common}/>`;
    case "star": return `<polygon points="${starPoints(cx, cy, rx, ry, 5, Math.max(0.2, Math.min(0.9, s.radius ?? 0.45)))}" ${common}/>`;
    case "heart": {
      // 居中爱心路径，按画框缩放。
      const W = w - sw, H = h - sw, ox = ix, oy = ix;
      const X = (t: number) => (ox + t * W).toFixed(2), Y = (t: number) => (oy + t * H).toFixed(2);
      return `<path d="M ${X(0.5)} ${Y(0.3)} C ${X(0.5)} ${Y(0.1)} ${X(0.1)} ${Y(0.05)} ${X(0.1)} ${Y(0.35)} C ${X(0.1)} ${Y(0.6)} ${X(0.4)} ${Y(0.78)} ${X(0.5)} ${Y(0.95)} C ${X(0.6)} ${Y(0.78)} ${X(0.9)} ${Y(0.6)} ${X(0.9)} ${Y(0.35)} C ${X(0.9)} ${Y(0.05)} ${X(0.5)} ${Y(0.1)} ${X(0.5)} ${Y(0.3)} Z" ${common}/>`;
    }
    case "arrow": {
      const W = w - sw, H = h - sw, ox = ix, oy = ix;
      const X = (t: number) => (ox + t * W).toFixed(2), Y = (t: number) => (oy + t * H).toFixed(2);
      return `<polygon points="${X(0)},${Y(0.32)} ${X(0.55)},${Y(0.32)} ${X(0.55)},${Y(0.1)} ${X(1)},${Y(0.5)} ${X(0.55)},${Y(0.9)} ${X(0.55)},${Y(0.68)} ${X(0)},${Y(0.68)}" ${common}/>`;
    }
    case "line": return `<line x1="${ix}" y1="${cy}" x2="${w - ix}" y2="${cy}" ${strokeAttr}/>`;
    default: return `<rect x="${ix}" y="${ix}" width="${w - sw}" height="${h - sw}" ${common}/>`;
  }
}

/** 生成填充用的 <defs>（渐变/图案），返回 [defs, fillRef]。 */
function buildFill(s: ShapeSpec, color: string): { defs: string; ref: string } {
  const c2 = safeColor(s.color2, "#ffffff");
  if (s.fillType === "linear") {
    return { defs: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`, ref: "url(#g)" };
  }
  if (s.fillType === "radial") {
    return { defs: `<radialGradient id="g"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${c2}"/></radialGradient>`, ref: "url(#g)" };
  }
  if (s.fillType === "pattern") {
    const k = s.pattern ?? "dots";
    let tile = "";
    if (k === "dots") tile = `<rect width="16" height="16" fill="${c2}"/><circle cx="8" cy="8" r="3.2" fill="${color}"/>`;
    else if (k === "stripes") tile = `<rect width="16" height="16" fill="${c2}"/><rect width="8" height="16" fill="${color}"/>`;
    else if (k === "grid") tile = `<rect width="16" height="16" fill="${c2}"/><path d="M0 0H16M0 0V16" stroke="${color}" stroke-width="2"/>`;
    else tile = `<rect width="16" height="16" fill="${c2}"/><rect width="8" height="8" fill="${color}"/><rect x="8" y="8" width="8" height="8" fill="${color}"/>`; // checker
    return { defs: `<pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse">${tile}</pattern>`, ref: "url(#g)" };
  }
  return { defs: "", ref: color };
}

/** 形状 → 完整 SVG 字符串（w×h 像素画框）。自定义 svg 优先。 */
export function shapeToSvg(s: ShapeSpec, w: number, h: number): string {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (s.svg && s.svg.trim()) {
    const op = Math.max(0, Math.min(1, s.opacity ?? 1));
    let inner = s.svg.trim();
    if (/^<svg[\s>]/i.test(inner)) {
      // 完整 <svg>：去掉根标签的固定 width/height，改成 100% 并按自身 viewBox 缩放填满画框。
      inner = inner.replace(/<svg([^>]*)>/i, (_m, attrs: string) =>
        `<svg${attrs.replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`);
    } else {
      // 裸元素（无 <svg>）：按 0 0 100 100 视框包裹（与占位示例/AI 约定一致），缩放填满。
      inner = `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" opacity="${op}">${inner}</svg>`;
  }
  const color = safeColor(s.color, "#FFD400");
  const filled = s.fill !== false;
  const sw = Math.max(0, s.lineWidth ?? (filled ? 0 : 6));
  const op = Math.max(0, Math.min(1, s.opacity ?? 1));
  const { defs, ref } = filled ? buildFill(s, color) : { defs: "", ref: "none" };
  // 描边：仅描边时用主色；填充时若 lineWidth>0 也描边（深一点的同色边，简化为主色）。
  const strokeOn = !filled || (filled && (s.lineWidth ?? 0) > 0);
  const strokeAttr = strokeOn ? `stroke="${filled ? color : color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"` : `stroke="none"`;
  const body = shapeBody(s, W, H, strokeOn ? sw : 0, ref, strokeAttr);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" opacity="${op}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
}

/** 预览用：形状 → data-URL（<img src> 直接渲染，按画框等比铺满，描边不畸变）。 */
export function shapeToDataUrl(s: ShapeSpec, w = 600, h = 600): string {
  return "data:image/svg+xml," + encodeURIComponent(shapeToSvg(s, w, h));
}

void esc; // reserved for custom-svg sanitization in PR2
