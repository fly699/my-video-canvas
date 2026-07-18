// #224 批2c：原生支持「联网搜索」的对话模型清单（前后端共享单一事实源）。
// 只收【官方文档明确声明】的模型，不按同族猜测：
//  - kie_gpt_5_2：docs/kie-api.md · /gpt-5-2/v1/chat/completions，tools=[{type:"function",function:{name:"web_search"}}]
//  - kie_gpt_5_4：docs/kie-api.md · /codex/v1/responses，tools=[{type:"web_search"}]（与 function calling 互斥）
// UI 用它给模型下拉加 🌐 标注；服务端 kieWebSearchSupported 据此判定。
export const NATIVE_WEB_SEARCH_LLMS: readonly string[] = ["kie_gpt_5_2", "kie_gpt_5_4"];

/** UI 提示文案（注明哪些模型原生联网，其它模型的回退行为）。 */
export const WEB_SEARCH_MODELS_HINT =
  "原生联网搜索模型：GPT 5.2 / GPT 5.4（kie，🌐 标注）。选择其它提炼模型也能用联网搜索——搜索阶段会自动改由支持的渠道执行，仅「整理」阶段用你所选的模型。";
