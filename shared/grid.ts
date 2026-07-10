// ── Grid storyboard presets ───────────────────────────────────────────────────
// LibTV-style one-click "grid storyboard" starters: generate ONE sheet image laid
// out as rows×cols panels, then slice it into N storyboard keyframes. These presets
// are the single source of truth for both the generation prompt and the slice
// geometry, shared by client UI + server. Pure & dependency-free → unit-tested.

export interface GridPreset {
  id: string;
  label: string;
  rows: number;
  cols: number;
  /** Aspect ratio of the WHOLE sheet (so generation produces proportional cells). */
  sheetAspect: string;
  /** Appended to the user's subject to turn it into a grid-sheet prompt. */
  promptSuffix: string;
}

export const GRID_PRESETS: GridPreset[] = [
  {
    id: "grid9", label: "多机位九宫格", rows: 3, cols: 3, sheetAspect: "1:1",
    promptSuffix:
      "presented as a 3x3 storyboard grid sheet (9 equal panels, thin clean gridlines), nine consecutive cinematic shots of the same scene from different camera angles and moments, consistent characters, lighting and art style across all panels",
  },
  {
    id: "grid25", label: "25 宫格连贯分镜", rows: 5, cols: 5, sheetAspect: "1:1",
    promptSuffix:
      "presented as a 5x5 storyboard grid sheet (25 equal panels, thin clean gridlines), twenty-five sequential cinematic shots telling the scene beat by beat, consistent characters, lighting and art style across all panels",
  },
  {
    id: "turnaround", label: "角色三视图", rows: 1, cols: 3, sheetAspect: "3:1",
    promptSuffix:
      "character turnaround reference sheet, three equal panels side by side: front view, side view and back view of the same character, identical design, neutral A-pose, plain neutral background, consistent proportions and outfit",
  },
  {
    id: "plot4", label: "剧情推演四宫格", rows: 2, cols: 2, sheetAspect: "1:1",
    promptSuffix:
      "presented as a 2x2 storyboard grid sheet (4 equal panels, thin clean gridlines), four sequential story-beat shots showing how the scene develops, consistent characters, lighting and art style across all panels",
  },
  {
    // 阶段四 4.1 设定图套件：角色表情九宫格（同一角色 9 种表情，切分后可作
    // 角色库参考图/对白镜头的表情基准）。
    id: "expressions", label: "表情九宫格", rows: 3, cols: 3, sheetAspect: "1:1",
    promptSuffix:
      "character expression reference sheet as a 3x3 grid (9 equal panels, thin clean gridlines): the same character's head-and-shoulders portrait with nine different facial expressions — neutral, happy, sad, angry, surprised, afraid, disgusted, shy, determined — identical face, hairstyle and outfit in every panel, plain neutral background, consistent art style",
  },
];

export function getGridPreset(id?: string): GridPreset | undefined {
  return GRID_PRESETS.find((p) => p.id === id);
}

/** Number of cells a preset slices into. */
export function gridCellCount(preset: GridPreset): number {
  return preset.rows * preset.cols;
}

/** Compose the full sheet-generation prompt from a subject + preset. */
export function buildGridPrompt(subject: string, preset: GridPreset): string {
  const s = subject.trim();
  return s ? `${s}, ${preset.promptSuffix}` : preset.promptSuffix;
}
