export type CommandStep = {
  id: number;
  runbookId: number;
  sortOrder: number;
  title: string;
  command: string;
  note: string;
};

export type CommandRunbookSummary = {
  id: number;
  seedKey?: string | null;
  title: string;
  category: string;
  problem: string;
  source: string;
  stepCount: number;
  updatedAt: number;
};

export type CommandRunbook = {
  id: number;
  seedKey?: string | null;
  title: string;
  category: string;
  problem: string;
  contentMd: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  steps: CommandStep[];
};

export type StepDraft = {
  title: string;
  command: string;
  note: string;
};
