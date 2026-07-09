import type { MessageSchema } from "../types";

export const enUS: MessageSchema = {
  app: {
    name: "LittleTool",
    subtitle: "Lightweight Developer Toolbox",
    topbarThemeDark: "Dark theme",
    topbarThemeLight: "Light theme",
  },
  common: {
    comingSoon: "Coming soon",
    expand: "Expand",
    collapse: "Collapse",
    input: "Input",
    output: "Output",
    clear: "Clear",
    copy: "Copy",
    copied: "Copied",
    indent: "Indent",
    format: "Format",
    minify: "Minify",
    validate: "Validate",
  },
  json: {
    valid: "Valid JSON",
    invalidPrefix: "Parse error: ",
    inputPlaceholder: "Paste JSON here...",
    outputPlaceholder: "Formatted output will appear here...",
  },
  timestamp: {
    forwardTitle: "Timestamp to Date Time",
    inputLabel: "Timestamp",
    inputPlaceholder: "Enter a timestamp, for example 1783580932",
    unitLabel: "Unit",
    unitSeconds: "Seconds (s)",
    unitMilliseconds: "Milliseconds (ms)",
    convertAction: "Convert",
    timezoneLabel: "Time zone",
    resultLabel: "Date Time",
    referenceNow: "Current local machine time",
    localClockHint:
      "Conversion uses the local system clock and built-in time zone data. A frontend-only app cannot self-correct time inside an intranet.",
    emptyError: "Enter a timestamp.",
    invalidError: "The timestamp must be an integer.",
    rangeError: "The timestamp is out of range.",
    timezoneError: "The selected time zone is unavailable.",
    reverseTitle: "Date Time to Timestamp",
    reverseInputLabel: "Date Time",
    reverseInputPlaceholder: "Enter YYYY-MM-DD HH:mm:ss",
    reverseTimestampLabel: "Timestamp",
    reverseSecondsLabel: "Timestamp (s)",
    reverseMillisecondsLabel: "Timestamp (ms)",
    fillNowAction: "Use current time",
    reverseHint:
      "The input is interpreted in the selected time zone. Supported formats: YYYY-MM-DD HH:mm:ss or YYYY-MM-DDTHH:mm:ss.",
    reverseEmptyError: "Enter a date time.",
    reverseInvalidError: "Invalid date time format. Use YYYY-MM-DD HH:mm:ss.",
  },
  settings: {
    title: "Interface Settings",
    description: "Theme and interface preferences",
    intro:
      "Keep it dependency-light and lightweight first. Theme and language switching are provided as the base layer.",
    themeGroup: "Theme",
    themeDarkTitle: "Dark Theme",
    themeDarkDesc: "Comfortable for long sessions",
    themeLightTitle: "Light Theme",
    themeLightDesc: "Brighter for office-style workflows",
    languageGroup: "Language",
    aboutGroup: "Tool Description",
    aboutText:
      "LittleTool is a lightweight desktop toolbox for development and operations work, focused on fast access to high-frequency utilities with a clear UI, sensible defaults, and minimal dependencies.",
    updaterGroup: "Updates",
    updaterCurrentVersion: "Current version",
    updaterTargetVersion: "Available version",
    updaterChecking: "Checking for updates...",
    updaterLatest: "You are already on the latest version.",
    updaterAvailable: "A new version is available and can be downloaded now.",
    updaterIdle: "No update check has been run yet.",
    updaterInstall: "Download and install update",
    updaterRetry: "Check again",
    updaterInstalling: "Downloading and installing update...",
    updaterInstalled: "The update package has been processed. Restart the app when prompted.",
    updaterError: "Update check or installation failed.",
    updaterUnavailable:
      "No update result is available in the current environment. This usually only works inside the Tauri desktop app.",
  },
  languages: {
    "zh-CN": {
      label: "Chinese",
      description: "Default language for the app",
      short: "ZH",
    },
    "en-US": {
      label: "English",
      description: "Built-in English UI copy",
      short: "EN",
    },
  },
  menu: {
    basic: {
      label: "Basic Tools",
      description: "Common development utilities",
    },
    ops: {
      label: "Ops Tools",
      description: "Middleware inspection and management",
    },
    docs: {
      label: "Document Tools",
      description: "OCR and format conversion",
    },
    todo: {
      label: "Todo",
      description: "Lightweight task tracking",
    },
    settings: {
      label: "Settings",
      description: "Theme and interface preferences",
    },
  },
  tools: {
    json: {
      label: "JSON Tool",
      description: "Format, minify, and validate JSON",
    },
    timestamp: {
      label: "Timestamp Converter",
      description: "Convert between timestamps and dates",
    },
    redis: {
      label: "Redis Manager",
      description: "Inspect keys and run common actions",
    },
    mq: {
      label: "MQ Manager",
      description: "Pull, rollback, and publish messages",
    },
    es: {
      label: "ES Manager",
      description: "Index queries and document search",
    },
    ocr: {
      label: "OCR",
      description: "Extract text from images",
    },
    convert: {
      label: "Format Converter",
      description: "Convert DOCX / PDF / Markdown",
    },
    todo: {
      label: "Todo",
      description: "Lightweight task tracking",
    },
    settings: {
      label: "Settings",
      description: "Theme and interface preferences",
    },
  },
};
