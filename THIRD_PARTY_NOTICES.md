# Third-Party Notices

本项目的部分功能移植/借鉴了以下第三方开源项目，特此致谢并保留其许可证声明。

---

## video-use (browser-use/video-use)

- 项目：https://github.com/browser-use/video-use
- 许可证：MIT License
- 版权：Copyright (c) 2026 Browser Use

**移植范围**：AI 智能剪辑（独立视频剪辑器 `/editor`）——包括调色预设
（`subtle` / `neutral_punch` / `warm_cinematic`，数值取自其 `helpers/grade.py`），
以及「词级转录 → LLM 出 EDL → 去口头禅/按词切/淡入淡出/逐词字幕」的剪辑思路。
实现已适配本项目的 `EditorDoc` / `videoComposer` 架构，非逐行复制。

```
MIT License

Copyright (c) 2026 Browser Use

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
