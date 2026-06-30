// 防御浏览器「自动翻译」导致的 React 崩溃（removeChild/insertBefore 报错）。
//
// 手机/桌面浏览器的整页翻译（Chrome/Edge/三星浏览器、Google/Microsoft 翻译等）会把
// 文本节点包进 <font> 等元素、就地替换 DOM 子树。React 仍持有原始文本节点的引用，下次
// 协调更新时调用 parent.removeChild(原节点) / parent.insertBefore(..., 原节点)，但该节点
// 已被翻译器移走、不再是 parent 的直接子节点 → 抛出 DOMException：
//   "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."
// （中文环境即「未能在"节点"上执行"removeChild"：被移除的节点不是该节点的子节点」），
// 触发全局 ErrorBoundary，整页白屏。
//
// 业界通行修复（facebook/react#11538）：把 Node.prototype 的 removeChild/insertBefore 包一层
// 守卫——当目标/参照节点的父节点已不是 this 时，安全降级（直接返回，不抛异常），让 React 的
// 协调继续走下去而非崩溃。仅在父子关系已被第三方破坏时生效，正常路径行为完全不变。
//
// 必须在任何 React 渲染之前执行（main.tsx 首行 import）。

export function installDomTranslationGuard(): void {
  if (typeof Node !== "function" || !Node.prototype) return;
  const proto = Node.prototype as unknown as {
    removeChild: <T extends Node>(child: T) => T;
    insertBefore: <T extends Node>(node: T, ref: Node | null) => T;
    __i18nGuardInstalled?: boolean;
  };
  if (proto.__i18nGuardInstalled) return;
  proto.__i18nGuardInstalled = true;

  const origRemoveChild = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      // 翻译器已把该节点移走：降级为 noop，返回入参，避免 React 协调崩溃。
      if (child.parentNode) {
        try { return origRemoveChild.call(child.parentNode, child) as T; } catch { /* fall through */ }
      }
      return child;
    }
    return origRemoveChild.call(this, child) as T;
  };

  const origInsertBefore = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      // 参照节点已被翻译器移走：退化为 append 到 this 末尾，保持节点入树而不抛异常。
      try { return origInsertBefore.call(this, node, null) as T; } catch { return node; }
    }
    return origInsertBefore.call(this, node, ref) as T;
  };
}
