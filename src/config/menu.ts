export type SectionKey = "basic" | "ops" | "docs" | "todo";
export type ToolKey =
  | "json"
  | "timestamp"
  | "ssh"
  | "redis"
  | "mq"
  | "es"
  | "ocr"
  | "convert"
  | "todo"
  | "settings";

export type MenuSection = {
  key: SectionKey;
  icon: string;
  labelKey: `menu.${SectionKey}.label`;
  descriptionKey: `menu.${SectionKey}.description`;
  items?: Array<{
    key: Exclude<ToolKey, "settings">;
    labelKey: `tools.${Exclude<ToolKey, "settings">}.label`;
    descriptionKey: `tools.${Exclude<ToolKey, "settings">}.description`;
  }>;
  directTool?: {
    key: Exclude<ToolKey, "settings">;
    labelKey: `tools.${Exclude<ToolKey, "settings">}.label`;
    descriptionKey: `tools.${Exclude<ToolKey, "settings">}.description`;
  };
};

export const menuSections: MenuSection[] = [
  {
    key: "basic",
    labelKey: "menu.basic.label",
    descriptionKey: "menu.basic.description",
    icon: "基",
    items: [
      {
        key: "json",
        labelKey: "tools.json.label",
        descriptionKey: "tools.json.description",
      },
      {
        key: "timestamp",
        labelKey: "tools.timestamp.label",
        descriptionKey: "tools.timestamp.description",
      },
    ],
  },
  {
    key: "ops",
    labelKey: "menu.ops.label",
    descriptionKey: "menu.ops.description",
    icon: "运",
    items: [
      {
        key: "ssh",
        labelKey: "tools.ssh.label",
        descriptionKey: "tools.ssh.description",
      },
      {
        key: "redis",
        labelKey: "tools.redis.label",
        descriptionKey: "tools.redis.description",
      },
      {
        key: "mq",
        labelKey: "tools.mq.label",
        descriptionKey: "tools.mq.description",
      },
      {
        key: "es",
        labelKey: "tools.es.label",
        descriptionKey: "tools.es.description",
      },
    ],
  },
  {
    key: "docs",
    labelKey: "menu.docs.label",
    descriptionKey: "menu.docs.description",
    icon: "文",
    items: [
      {
        key: "ocr",
        labelKey: "tools.ocr.label",
        descriptionKey: "tools.ocr.description",
      },
      {
        key: "convert",
        labelKey: "tools.convert.label",
        descriptionKey: "tools.convert.description",
      },
    ],
  },
  {
    key: "todo",
    labelKey: "menu.todo.label",
    descriptionKey: "menu.todo.description",
    icon: "待",
    directTool: {
      key: "todo",
      labelKey: "tools.todo.label",
      descriptionKey: "tools.todo.description",
    },
  },
];

export const toolKeys: ToolKey[] = [
  "json",
  "timestamp",
  "ssh",
  "redis",
  "mq",
  "es",
  "ocr",
  "convert",
  "todo",
  "settings",
];

export function getToolLabelKey(tool: ToolKey): `tools.${ToolKey}.label` {
  return `tools.${tool}.label`;
}

export function getToolDescriptionKey(tool: ToolKey): `tools.${ToolKey}.description` {
  return `tools.${tool}.description`;
}
