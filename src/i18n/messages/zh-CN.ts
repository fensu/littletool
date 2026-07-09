export const zhCN = {
  app: {
    name: "LittleTool",
    subtitle: "轻量开发工具箱",
    topbarThemeDark: "深色风格",
    topbarThemeLight: "白色风格",
  },
  common: {
    comingSoon: "即将支持",
    expand: "展开",
    collapse: "收起",
    input: "输入",
    output: "输出",
    clear: "清空",
    copy: "复制",
    copied: "已复制",
    indent: "缩进",
    format: "格式化",
    minify: "压缩",
    validate: "校验",
  },
  json: {
    valid: "JSON 格式有效",
    invalidPrefix: "解析错误：",
    inputPlaceholder: "在此粘贴 JSON 数据...",
    outputPlaceholder: "格式化结果将显示在此...",
  },
  settings: {
    title: "界面设置",
    description: "主题与界面偏好配置",
    intro: "保持零依赖、轻量化的前提下，先提供主题和语言切换。",
    themeGroup: "主题风格",
    themeDarkTitle: "深色风格",
    themeDarkDesc: "适合长时间查看工具面板",
    themeLightTitle: "白色风格",
    themeLightDesc: "更明亮，适合白底办公场景",
    languageGroup: "界面语言",
    aboutGroup: "工具描述",
    aboutText:
      "LittleTool 是一个面向开发与运维场景的轻量桌面工具箱，聚焦高频小工具的快速使用，默认中文，支持基础 i18n，强调开箱即用、界面清晰和尽量少依赖。",
  },
  languages: {
    "zh-CN": {
      label: "中文",
      description: "默认语言，适合日常使用",
      short: "ZH",
    },
    "en-US": {
      label: "English",
      description: "Built-in English copy for i18n",
      short: "EN",
    },
  },
  menu: {
    basic: {
      label: "基础工具",
      description: "常用开发辅助工具",
    },
    ops: {
      label: "运维工具",
      description: "常见中间件管理与查看",
    },
    docs: {
      label: "文档工具",
      description: "文本识别与格式转换",
    },
    todo: {
      label: "待办任务",
      description: "轻量任务管理与记录",
    },
    settings: {
      label: "设置",
      description: "主题与界面偏好配置",
    },
  },
  tools: {
    json: {
      label: "JSON 工具",
      description: "格式化、压缩、验证 JSON",
    },
    timestamp: {
      label: "时间戳转换",
      description: "时间戳与日期时间互转",
    },
    redis: {
      label: "Redis 管理",
      description: "查看键值、执行常用操作",
    },
    mq: {
      label: "MQ 管理",
      description: "拉取、回退、发送消息",
    },
    es: {
      label: "ES 管理",
      description: "索引查询与文档检索",
    },
    ocr: {
      label: "OCR 识别",
      description: "图片文字提取与识别",
    },
    convert: {
      label: "格式转换",
      description: "DOCX / PDF / Markdown 转换",
    },
    todo: {
      label: "待办任务",
      description: "轻量任务管理与记录",
    },
    settings: {
      label: "设置",
      description: "主题与界面偏好配置",
    },
  },
} as const;
