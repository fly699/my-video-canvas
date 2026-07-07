import type { TourStep } from "./guideSteps";

/**
 * 聊天工作室的首次进入引导（复用画布 GuidedTour 的 spotlight 视觉，走外部 controller）。
 * 依次引导：装到手机/桌面 → 切换房间 → 返回进画布。目标锚点在 ChatPage 的按钮上补了
 * data-tour；安装按钮在移动端可能不渲染（浏览器不支持 PWA 安装时），GuidedTour 会自动
 * 降级为居中卡，文案已相应说明。
 */
export const CHAT_TOUR_STEPS: TourStep[] = [
  {
    id: "chat-welcome",
    chapter: "聊天工作室",
    icon: "💬",
    title: "欢迎来到聊天工作室",
    body: [
      "这里可以和团队实时聊天、和 AI 助手对话写脚本，还会自动收到你在画布生成的产物通知。",
      "花 20 秒认一下三个关键按钮。可随时点「跳过」。",
    ],
    target: null,
  },
  {
    id: "chat-install",
    chapter: "装到手机 / 桌面",
    icon: "📲",
    title: "装成 App，手机上也能随时用",
    body: [
      "点右上角这个按钮，可把聊天工作室安装为独立应用——手机加到主屏、桌面独立窗口，像原生 App 一样随开随用、收推送更及时。",
    ],
    tip: "若按钮未出现：说明当前浏览器暂不支持安装（需 HTTPS、非无痕），或你已安装过。",
    target: '[data-tour="chat-install"]',
    placement: "bottom",
  },
  {
    id: "chat-rooms",
    chapter: "切换房间",
    icon: "🗂️",
    title: "在这里切换 / 展开房间列表",
    body: [
      "点左上角这个按钮展开会话栏，在大厅、群聊、加密私聊、以及「我的产物通知」之间切换。",
      "手机窄屏下会以抽屉形式滑出，选完自动收起，不挡消息。",
    ],
    target: '[data-tour="chat-rooms-toggle"]',
    placement: "bottom",
  },
  {
    id: "chat-back",
    chapter: "回到画布",
    icon: "↩️",
    title: "返回，进入画布创作",
    body: [
      "点最左上角的返回，回到首页即可进入画布开始创作。你在画布生成的每个产物，都会自动推回这里的「我的产物通知」房。",
    ],
    tip: "随时想再看这份引导，退出重进聊天即可（或清除浏览器数据后首次进入会再弹）。",
    target: '[data-tour="chat-back"]',
    placement: "bottom",
  },
];

export const CHAT_TOUR_DONE_KEY = "avc:chat-tour-done:v1";
