// 提示词库的「客户端镜像」：由画布顶层用 trpc.promptLibrary.list 填充（setPromptLibrary），
// useSlashMenu / 提示词库面板用快照读取（避免每个文本框都订阅 tRPC）。镜像 characterConditioning
// 里 setLibraryCharacters 的模式。

export interface PromptLibItem {
  id: number;
  label: string;
  text: string;
  category: string;
  slot: number | null;            // 0..9 占用快捷槽位；否则 null
  slotKind: "prompt" | "category" | null;
  sortOrder: number;
}

let _items: PromptLibItem[] = [];
const _subs = new Set<() => void>();

export function setPromptLibrary(items: PromptLibItem[]): void {
  _items = items;
  _subs.forEach((fn) => fn());
}
export function getPromptLibrary(): PromptLibItem[] { return _items; }
export function subscribePromptLibrary(fn: () => void): () => void { _subs.add(fn); return () => _subs.delete(fn); }

/** 10 个快捷槽位（slot 0..9），按 slot 升序；空槽位为 undefined。 */
export function favoriteSlots(): (PromptLibItem | undefined)[] {
  const out: (PromptLibItem | undefined)[] = Array.from({ length: 10 }, () => undefined);
  for (const it of _items) {
    if (it.slot != null && it.slot >= 0 && it.slot < 10) out[it.slot] = it;
  }
  return out;
}

/** 库里某分类下的提示词（slot 入口的二级菜单用）。 */
export function promptsInCategory(category: string): PromptLibItem[] {
  return _items.filter((it) => it.category === category).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** 全部分类名（去重，保序）。 */
export function allCategories(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of _items) if (it.category && !seen.has(it.category)) { seen.add(it.category); out.push(it.category); }
  return out;
}
