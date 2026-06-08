import type { CharacterNodeData } from "../../../shared/types";

/** Chinese labels for the AI-recognizable character/scene fields (preview dialog). */
export const RECOGNITION_FIELD_LABELS: Record<string, string> = {
  // person
  name: "角色名", role: "身份/职业", gender: "性别", age: "年龄",
  appearance: "外貌", personality: "性格", outfit: "服装", signature: "标志特征",
  // scene
  sceneName: "场景名", locationType: "地点类型", sceneDescription: "场景描述",
  atmosphere: "氛围", timeOfDay: "时间",
};

export interface RecognitionFieldRow {
  key: string;
  label: string;
  current: string;
  recognized: string;
  /** Pre-checked when the recognized value is non-empty AND differs from the current
   *  value — so identical values (no-ops) start unchecked. */
  defaultChecked: boolean;
}

/** Build the preview rows shown in the AI-recognition dialog: pair each recognized field
 *  with the character's current value, skip empty recognized values, and default-check the
 *  ones that would actually change something. Pure / unit-testable. */
export function buildRecognitionRows(
  payload: CharacterNodeData,
  fields: Record<string, string>,
): RecognitionFieldRow[] {
  const rows: RecognitionFieldRow[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    const recognized = (raw ?? "").trim();
    if (!recognized) continue;
    const current = (((payload as Record<string, unknown>)[key] as string | undefined) ?? "").trim();
    rows.push({
      key,
      label: RECOGNITION_FIELD_LABELS[key] ?? key,
      current,
      recognized,
      defaultChecked: recognized !== current,
    });
  }
  return rows;
}
