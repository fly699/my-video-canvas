import { describe, it, expect } from "vitest";
import { displayFileName, storageKeyName } from "./routers/chat";

// 回归：聊天附件的中文文件名此前被 ASCII 过滤成「__.pdf」，无法正常显示/下载。
describe("chat 文件名处理", () => {
  it("displayFileName 保留中文/日文等 Unicode 与扩展名", () => {
    expect(displayFileName("项目报告.pdf")).toBe("项目报告.pdf");
    expect(displayFileName("会议记录 2026.docx")).toBe("会议记录 2026.docx");
    expect(displayFileName("レポート.xlsx")).toBe("レポート.xlsx");
    expect(displayFileName("photo.png")).toBe("photo.png");
  });

  it("displayFileName 只取最后一段，剥离目录（含 Windows 反斜杠）", () => {
    expect(displayFileName("a/b/报告.pdf")).toBe("报告.pdf");
    expect(displayFileName("C:\\Users\\张三\\报告.pdf")).toBe("报告.pdf");
  });

  it("displayFileName 去掉控制字符、限长、空回退 file", () => {
    expect(displayFileName(`报${String.fromCharCode(7)}告.pdf`)).toBe("报告.pdf"); // 内嵌 BEL 控制字符
    expect(displayFileName("")).toBe("file");
    expect(displayFileName("   ")).toBe("file");
    expect(displayFileName("好".repeat(300)).length).toBeLessThanOrEqual(200);
  });

  it("storageKeyName 仅保留 ASCII 安全字符（中文→_），保留扩展名", () => {
    expect(storageKeyName("项目报告.pdf")).toBe("____.pdf"); // 4 个中文字 → 4 个下划线
    expect(storageKeyName("photo-1_v2.png")).toBe("photo-1_v2.png");
    expect(storageKeyName("a/b/c.txt")).toBe("c.txt");
    expect(storageKeyName("")).toBe("file");
  });

  it("展示名与存储键名解耦：同一中文名，展示保中文、键名转 ASCII", () => {
    const raw = "季度总结.pptx";
    expect(displayFileName(raw)).toBe("季度总结.pptx");
    expect(storageKeyName(raw)).toBe("____.pptx");
  });
});
