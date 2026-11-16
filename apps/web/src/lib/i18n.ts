/**
 * Platform UI i18n (D12/D15): Chinese/English dictionaries for platform
 * chrome only. Agent application content stays in the builder's language.
 */
export type Locale = "zh" | "en";

const messages = {
  zh: {
    "nav.hub": "应用中心",
    "nav.tasks": "我的任务",
    "nav.files": "我的文件",
    "nav.studio": "构建工作台",
    "nav.admin": "管理",
    "nav.logout": "退出",
    "hub.title": "应用中心",
    "hub.empty": "暂无可用应用",
    "hub.search": "搜索应用…",
    "app.run": "开始任务",
    "app.input": "任务输入",
    "app.submit": "提交任务",
    "task.title": "任务详情",
    "task.state": "状态",
    "task.continue": "继续修改",
    "task.continuePlaceholder": "输入修改要求…",
    "task.cancel": "取消任务",
    "task.artifacts": "成果",
    "task.messages": "对话记录",
    "tasks.title": "我的任务",
    "tasks.empty": "还没有任务",
    "files.title": "我的文件",
    "files.empty": "暂无文件",
    "files.download": "下载",
    "login.title": "登录 Forgegent",
    "login.email": "邮箱",
    "login.password": "密码",
    "login.submit": "登录",
    "common.loading": "加载中…",
    "common.error": "出错了",
    "common.back": "返回",
  },
  en: {
    "nav.hub": "Hub",
    "nav.tasks": "My Tasks",
    "nav.files": "My Files",
    "nav.studio": "Studio",
    "nav.admin": "Admin",
    "nav.logout": "Sign out",
    "hub.title": "App Hub",
    "hub.empty": "No apps available yet",
    "hub.search": "Search apps…",
    "app.run": "Start task",
    "app.input": "Task input",
    "app.submit": "Submit task",
    "task.title": "Task detail",
    "task.state": "State",
    "task.continue": "Continue",
    "task.continuePlaceholder": "Describe your change…",
    "task.cancel": "Cancel task",
    "task.artifacts": "Artifacts",
    "task.messages": "Messages",
    "tasks.title": "My Tasks",
    "tasks.empty": "No tasks yet",
    "files.title": "My Files",
    "files.empty": "No files",
    "files.download": "Download",
    "login.title": "Sign in to Forgegent",
    "login.email": "Email",
    "login.password": "Password",
    "login.submit": "Sign in",
    "common.loading": "Loading…",
    "common.error": "Something went wrong",
    "common.back": "Back",
  },
} as const;

export type MessageKey = keyof (typeof messages)["zh"];

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.zh[key] ?? key;
}

export function localeFromCookie(value: string | undefined | null): Locale {
  return value === "en" ? "en" : "zh";
}

export const TASK_STATE_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    pending: "排队中",
    starting: "启动中",
    running: "执行中",
    waiting_input: "等待输入",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  },
  en: {
    pending: "Queued",
    starting: "Starting",
    running: "Running",
    waiting_input: "Waiting for input",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
  },
};
