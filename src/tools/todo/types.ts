export type TodoProject = {
  id: number;
  name: string;
  kind: "inbox" | "project" | string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type TodoColumn = {
  id: number;
  projectId: number;
  title: string;
  sortOrder: number;
  createdAt: number;
};

export type TodoTask = {
  id: number;
  projectId: number;
  columnId: number;
  title: string;
  notes: string;
  priority: string;
  startAt?: number | null;
  endAt?: number | null;
  sortOrder: number;
  completedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  projectName?: string | null;
  columnTitle?: string | null;
};

export type TodoBoardColumn = {
  column: TodoColumn;
  tasks: TodoTask[];
};

export type TodoBoard = {
  project: TodoProject;
  columns: TodoBoardColumn[];
};

export type TodoNavKey = "today" | "completed" | `project:${number}`;

export function getLocalDayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    dayStartMs: start.getTime(),
    dayEndMs: end.getTime(),
  };
}

export function formatTaskDate(ms?: number | null) {
  if (!ms) {
    return "";
  }
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toDayStartMs(dateText: string): number | null {
  if (!dateText) {
    return null;
  }
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

export function toDayEndMs(dateText: string): number | null {
  if (!dateText) {
    return null;
  }
  const date = new Date(`${dateText}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

