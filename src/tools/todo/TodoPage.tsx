import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../../i18n/I18nProvider";
import {
  formatTaskDate,
  getLocalDayRange,
  toDayEndMs,
  toDayStartMs,
  type TodoBoard,
  type TodoNavKey,
  type TodoProject,
  type TodoTask,
} from "./types";

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "data"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  return fallback;
}

type TaskDraft = {
  title: string;
  notes: string;
  priority: "low" | "medium" | "high";
  startDate: string;
  endDate: string;
  projectId: number | null;
  columnId: number | null;
};

const EMPTY_DRAFT: TaskDraft = {
  title: "",
  notes: "",
  priority: "medium",
  startDate: "",
  endDate: "",
  projectId: null,
  columnId: null,
};

export function TodoPage() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<TodoProject[]>([]);
  const [nav, setNav] = useState<TodoNavKey>("today");
  const [board, setBoard] = useState<TodoBoard | null>(null);
  const [todayTasks, setTodayTasks] = useState<TodoTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<TodoTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projectNameInput, setProjectNameInput] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<number | null>(null);
  const [columnTitleDraft, setColumnTitleDraft] = useState("");
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);

  const inbox = useMemo(() => projects.find((item) => item.kind === "inbox") ?? null, [projects]);
  const normalProjects = useMemo(() => projects.filter((item) => item.kind !== "inbox"), [projects]);

  const activeProjectId = useMemo(() => {
    if (nav === "today" || nav === "completed") {
      return null;
    }
    const id = Number(nav.replace("project:", ""));
    return Number.isFinite(id) ? id : null;
  }, [nav]);

  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  const loadProjects = async () => {
    const items = await invoke<TodoProject[]>("list_todo_projects");
    setProjects(items);
    return items;
  };

  const loadToday = async () => {
    const range = getLocalDayRange();
    const items = await invoke<TodoTask[]>("list_today_tasks", { payload: range });
    setTodayTasks(items);
  };

  const loadCompleted = async () => {
    const items = await invoke<TodoTask[]>("list_completed_tasks");
    setCompletedTasks(items);
  };

  const loadBoard = async (projectId: number) => {
    const next = await invoke<TodoBoard>("get_todo_board", { projectId });
    setBoard(next);
  };

  const refresh = async (target: TodoNavKey = nav) => {
    setLoading(true);
    resetFeedback();
    try {
      await loadProjects();
      // Keep completed badge fresh.
      void loadCompleted().catch(() => undefined);
      if (target === "today") {
        await loadToday();
        setBoard(null);
      } else if (target === "completed") {
        await loadCompleted();
        setBoard(null);
      } else {
        const projectId = Number(target.replace("project:", ""));
        await loadBoard(projectId);
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Todo load failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(nav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  const openCreateTaskModal = (defaults?: Partial<TaskDraft>) => {
    const today = formatTaskDate(Date.now());
    const projectId =
      defaults?.projectId ??
      activeProjectId ??
      inbox?.id ??
      projects[0]?.id ??
      null;

    setEditingTaskId(null);
    setDraft({
      ...EMPTY_DRAFT,
      startDate: today,
      endDate: today,
      projectId,
      columnId: board?.columns[0]?.column.id ?? null,
      ...defaults,
    });
    setTaskModalOpen(true);
  };

  const openEditTaskModal = (task: TodoTask) => {
    setEditingTaskId(task.id);
    setDraft({
      title: task.title,
      notes: task.notes ?? "",
      priority: (task.priority as TaskDraft["priority"]) || "medium",
      startDate: formatTaskDate(task.startAt),
      endDate: formatTaskDate(task.endAt),
      projectId: task.projectId,
      columnId: task.columnId,
    });
    setTaskModalOpen(true);
  };

  const handleCreateProject = async () => {
    const name = projectNameInput.trim();
    if (!name) {
      setError(t("todo.projectNameRequired"));
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      const project = await invoke<TodoProject>("create_todo_project", { payload: { name } });
      setProjectNameInput("");
      setNotice(t("todo.projectCreated"));
      await loadProjects();
      setNav(`project:${project.id}`);
    } catch (createError) {
      setError(getErrorMessage(createError, "Create project failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (project: TodoProject) => {
    if (project.kind === "inbox") {
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      await invoke("delete_todo_project", { id: project.id });
      setNotice(t("todo.projectDeleted"));
      if (nav === `project:${project.id}`) {
        setNav("today");
      } else {
        await refresh(nav);
      }
      await loadProjects();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Delete project failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAdd = async () => {
    const title = quickTitle.trim();
    if (!title) {
      return;
    }

    const today = formatTaskDate(Date.now());
    const isTodayView = nav === "today" || nav === "completed";
    const projectId = isTodayView ? inbox?.id ?? null : activeProjectId;
    if (!projectId) {
      setError(t("todo.noProject"));
      return;
    }

    setLoading(true);
    resetFeedback();
    try {
      await invoke("create_todo_task", {
        payload: {
          projectId,
          title,
          startAt: toDayStartMs(today),
          endAt: toDayEndMs(today),
          priority: "medium",
        },
      });
      setQuickTitle("");
      setNotice(t("todo.taskCreated"));
      await refresh(nav);
    } catch (createError) {
      setError(getErrorMessage(createError, "Create task failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleQuickAdd();
    }
  };

  const handleSaveTask = async (event?: FormEvent) => {
    event?.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError(t("todo.taskTitleRequired"));
      return;
    }
    if (!draft.projectId) {
      setError(t("todo.noProject"));
      return;
    }

    setLoading(true);
    resetFeedback();
    try {
      if (editingTaskId) {
        await invoke("update_todo_task", {
          payload: {
            id: editingTaskId,
            title,
            notes: draft.notes,
            priority: draft.priority,
            startAt: toDayStartMs(draft.startDate),
            endAt: toDayEndMs(draft.endDate),
            projectId: draft.projectId,
            columnId: draft.columnId ?? undefined,
          },
        });
        setNotice(t("todo.taskUpdated"));
      } else {
        await invoke("create_todo_task", {
          payload: {
            projectId: draft.projectId,
            columnId: draft.columnId,
            title,
            notes: draft.notes,
            priority: draft.priority,
            startAt: toDayStartMs(draft.startDate),
            endAt: toDayEndMs(draft.endDate),
          },
        });
        setNotice(t("todo.taskCreated"));
      }
      setTaskModalOpen(false);
      await refresh(nav);
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Save task failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("delete_todo_task", { id: taskId });
      setNotice(t("todo.taskDeleted"));
      setTaskModalOpen(false);
      await refresh(nav);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Delete task failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleRenameColumn = async (columnId: number) => {
    const title = columnTitleDraft.trim();
    if (!title) {
      setEditingColumnId(null);
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      await invoke("rename_todo_column", { payload: { id: columnId, title } });
      setEditingColumnId(null);
      await refresh(nav);
    } catch (renameError) {
      setError(getErrorMessage(renameError, "Rename column failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleAddColumn = async () => {
    if (!activeProjectId) {
      return;
    }
    const title = window.prompt(t("todo.columnNamePrompt"), t("todo.columnDefaultName"));
    if (!title?.trim()) {
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      await invoke("create_todo_column", {
        payload: { projectId: activeProjectId, title: title.trim() },
      });
      await refresh(nav);
    } catch (createError) {
      setError(getErrorMessage(createError, "Create column failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleMoveTask = async (taskId: number, columnId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("move_todo_task", {
        payload: { id: taskId, columnId },
      });
      await refresh(nav);
    } catch (moveError) {
      setError(getErrorMessage(moveError, "Move task failed"));
    } finally {
      setLoading(false);
      setDragTaskId(null);
    }
  };

  const handleCompleteTask = async (taskId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("complete_todo_task", { id: taskId });
      setNotice(t("todo.taskCompleted"));
      if (editingTaskId === taskId) {
        setTaskModalOpen(false);
      }
      await refresh(nav);
    } catch (completeError) {
      setError(getErrorMessage(completeError, "Complete task failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleReopenTask = async (taskId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("reopen_todo_task", { id: taskId });
      setNotice(t("todo.taskReopened"));
      if (editingTaskId === taskId) {
        setTaskModalOpen(false);
      }
      await refresh(nav);
    } catch (reopenError) {
      setError(getErrorMessage(reopenError, "Reopen task failed"));
    } finally {
      setLoading(false);
    }
  };

  const renderTaskCard = (
    task: TodoTask,
    options?: { showProject?: boolean; draggable?: boolean; showCompletedAt?: boolean },
  ) => {
    const isCompleted = Boolean(task.completedAt);
    return (
      <article
        key={task.id}
        className={`todo-card priority-${task.priority || "medium"} ${isCompleted ? "is-completed" : ""}`}
        draggable={Boolean(options?.draggable) && !isCompleted}
        onDragStart={() => setDragTaskId(task.id)}
        onDragEnd={() => setDragTaskId(null)}
      >
        <div className="todo-card-top">
          <button
            type="button"
            className={`todo-complete-btn ${isCompleted ? "is-done" : ""}`}
            title={isCompleted ? t("todo.reopenTask") : t("todo.completeTask")}
            disabled={loading}
            onClick={(event) => {
              event.stopPropagation();
              if (isCompleted) {
                void handleReopenTask(task.id);
              } else {
                void handleCompleteTask(task.id);
              }
            }}
          >
            {isCompleted ? "✓" : ""}
          </button>
          <div className="todo-card-body" onClick={() => openEditTaskModal(task)}>
            <div className="todo-card-title">{task.title}</div>
            {(task.startAt || task.endAt) && (
              <div className="todo-card-meta">
                {formatTaskDate(task.startAt) || "—"} ~ {formatTaskDate(task.endAt) || "—"}
              </div>
            )}
            {options?.showProject && (
              <div className="todo-card-meta">
                {task.projectName || t("todo.unknownProject")} · {task.columnTitle || t("todo.unknownColumn")}
              </div>
            )}
            {options?.showCompletedAt && task.completedAt && (
              <div className="todo-card-meta">
                {t("todo.completedAtLabel")} {formatTaskDate(task.completedAt)}
              </div>
            )}
            {task.notes && <div className="todo-card-notes">{task.notes}</div>}
          </div>
          <button
            type="button"
            className="todo-card-delete"
            title={t("todo.deleteTask")}
            disabled={loading}
            onClick={(event) => {
              event.stopPropagation();
              void handleDeleteTask(task.id);
            }}
          >
            ×
          </button>
        </div>
      </article>
    );
  };

  return (
    <section className="todo-page">
      <div className="todo-shell">
        <aside className="todo-sidebar">
          <button
            type="button"
            className={`todo-nav-item ${nav === "today" ? "is-active" : ""}`}
            onClick={() => setNav("today")}
          >
            <span className="todo-nav-dot is-today" />
            <span>{t("todo.todayNav")}</span>
            <span className="todo-nav-count">{todayTasks.length}</span>
          </button>

          <button
            type="button"
            className={`todo-nav-item ${nav === "completed" ? "is-active" : ""}`}
            onClick={() => setNav("completed")}
          >
            <span className="todo-nav-dot is-completed" />
            <span>{t("todo.completedNav")}</span>
            <span className="todo-nav-count">{completedTasks.length}</span>
          </button>

          {inbox && (
            <button
              type="button"
              className={`todo-nav-item ${nav === `project:${inbox.id}` ? "is-active" : ""}`}
              onClick={() => setNav(`project:${inbox.id}`)}
            >
              <span className="todo-nav-dot is-inbox" />
              <span>{t("todo.inboxNav")}</span>
            </button>
          )}

          <div className="todo-nav-section">
            <div className="todo-nav-section-title">{t("todo.projectsNav")}</div>
            <div className="todo-project-create">
              <input
                className="todo-input"
                value={projectNameInput}
                placeholder={t("todo.projectNamePlaceholder")}
                onChange={(event) => setProjectNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateProject();
                  }
                }}
              />
              <button type="button" className="primary-button todo-mini-btn" onClick={() => void handleCreateProject()}>
                {t("todo.addProject")}
              </button>
            </div>
            <div className="todo-project-list">
              {normalProjects.map((project) => (
                <div
                  key={project.id}
                  className={`todo-project-row ${nav === `project:${project.id}` ? "is-active" : ""}`}
                >
                  <button type="button" className="todo-project-main" onClick={() => setNav(`project:${project.id}`)}>
                    <span className="todo-nav-dot" />
                    <span>{project.name}</span>
                  </button>
                  <button
                    type="button"
                    className="todo-icon-btn"
                    title={t("todo.deleteProject")}
                    onClick={() => void handleDeleteProject(project)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {normalProjects.length === 0 && <div className="todo-empty-inline">{t("todo.noProjects")}</div>}
            </div>
          </div>
        </aside>

        <div className="todo-main">
          <div className="todo-toolbar">
            <div>
              <h2>
                {nav === "today"
                  ? t("todo.todayTitle")
                  : nav === "completed"
                    ? t("todo.completedTitle")
                    : board?.project.kind === "inbox"
                      ? t("todo.inboxTitle")
                      : board?.project.name || t("tools.todo.label")}
              </h2>
              <p>
                {nav === "today"
                  ? t("todo.todayDescription")
                  : nav === "completed"
                    ? t("todo.completedDescription")
                    : board?.project.kind === "inbox"
                      ? t("todo.inboxDescription")
                      : t("todo.boardDescription")}
              </p>
            </div>
            <div className="todo-toolbar-actions">
              <button type="button" className="ghost-button" disabled={loading} onClick={() => void refresh(nav)}>
                {t("todo.refresh")}
              </button>
              {nav !== "completed" && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    openCreateTaskModal(
                      nav === "today"
                        ? {
                            projectId: inbox?.id ?? null,
                            startDate: formatTaskDate(Date.now()),
                            endDate: formatTaskDate(Date.now()),
                          }
                        : {
                            projectId: activeProjectId,
                            startDate: formatTaskDate(Date.now()),
                            endDate: formatTaskDate(Date.now()),
                          },
                    )
                  }
                >
                  {t("todo.addTask")}
                </button>
              )}
            </div>
          </div>

          {error && <div className="todo-alert is-error">{error}</div>}
          {notice && <div className="todo-alert is-success">{notice}</div>}

          {nav !== "completed" && (
            <div className="todo-quick-add">
              <input
                className="todo-input"
                value={quickTitle}
                placeholder={
                  nav === "today" ? t("todo.quickAddTodayPlaceholder") : t("todo.quickAddBoardPlaceholder")
                }
                onChange={(event) => setQuickTitle(event.target.value)}
                onKeyDown={handleQuickKeyDown}
              />
              <button type="button" className="primary-button" disabled={loading} onClick={() => void handleQuickAdd()}>
                {t("todo.quickAdd")}
              </button>
            </div>
          )}

          {nav === "today" ? (
            <div className="todo-today-view">
              <section className="todo-today-group">
                <div className="todo-today-group-title">
                  {t("todo.todayGroup")}
                  <span>{todayTasks.length}</span>
                </div>
                <div className="todo-today-list">
                  {todayTasks.length === 0 ? (
                    <div className="todo-empty-inline">{t("todo.noTodayTasks")}</div>
                  ) : (
                    todayTasks.map((task) => renderTaskCard(task, { showProject: true }))
                  )}
                </div>
              </section>
            </div>
          ) : nav === "completed" ? (
            <div className="todo-today-view">
              <section className="todo-today-group">
                <div className="todo-today-group-title">
                  {t("todo.completedGroup")}
                  <span>{completedTasks.length}</span>
                </div>
                <div className="todo-today-list">
                  {completedTasks.length === 0 ? (
                    <div className="todo-empty-inline">{t("todo.noCompletedTasks")}</div>
                  ) : (
                    completedTasks.map((task) =>
                      renderTaskCard(task, { showProject: true, showCompletedAt: true }),
                    )
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="todo-board-view">
              <div className="todo-board-columns">
                {board?.columns.map((entry) => (
                  <section
                    key={entry.column.id}
                    className="todo-column"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragTaskId != null) {
                        void handleMoveTask(dragTaskId, entry.column.id);
                      }
                    }}
                  >
                    <div className="todo-column-header">
                      {editingColumnId === entry.column.id ? (
                        <input
                          className="todo-input todo-column-input"
                          value={columnTitleDraft}
                          autoFocus
                          onChange={(event) => setColumnTitleDraft(event.target.value)}
                          onBlur={() => void handleRenameColumn(entry.column.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleRenameColumn(entry.column.id);
                            }
                            if (event.key === "Escape") {
                              setEditingColumnId(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="todo-column-title"
                          onClick={() => {
                            setEditingColumnId(entry.column.id);
                            setColumnTitleDraft(entry.column.title);
                          }}
                          title={t("todo.renameColumn")}
                        >
                          {entry.column.title}
                        </button>
                      )}
                      <span className="todo-column-count">{entry.tasks.length}</span>
                    </div>
                    <div className="todo-column-body">
                      {entry.tasks.map((task) => renderTaskCard(task, { draggable: true }))}
                      <button
                        type="button"
                        className="todo-add-in-column"
                        onClick={() =>
                          openCreateTaskModal({
                            projectId: board.project.id,
                            columnId: entry.column.id,
                            startDate: formatTaskDate(Date.now()),
                            endDate: formatTaskDate(Date.now()),
                          })
                        }
                      >
                        + {t("todo.addTask")}
                      </button>
                    </div>
                  </section>
                ))}
                {activeProjectId && (
                  <button type="button" className="todo-add-column" onClick={() => void handleAddColumn()}>
                    + {t("todo.addColumn")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {taskModalOpen && (
        <div className="todo-modal-backdrop" onClick={() => setTaskModalOpen(false)}>
          <form
            className="todo-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void handleSaveTask(event)}
          >
            <div className="todo-modal-header">
              <h3>{editingTaskId ? t("todo.editTaskTitle") : t("todo.createTaskTitle")}</h3>
              <button type="button" className="todo-icon-btn" onClick={() => setTaskModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="todo-modal-body">
              <label className="todo-field">
                <span>{t("todo.taskTitleLabel")}</span>
                <input
                  className="todo-input"
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder={t("todo.taskTitlePlaceholder")}
                  autoFocus
                />
              </label>
              <label className="todo-field">
                <span>{t("todo.taskNotesLabel")}</span>
                <textarea
                  className="todo-textarea"
                  value={draft.notes}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder={t("todo.taskNotesPlaceholder")}
                  rows={3}
                />
              </label>
              <div className="todo-field-grid">
                <label className="todo-field">
                  <span>{t("todo.startDateLabel")}</span>
                  <input
                    type="date"
                    className="todo-input"
                    value={draft.startDate}
                    onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
                  />
                </label>
                <label className="todo-field">
                  <span>{t("todo.endDateLabel")}</span>
                  <input
                    type="date"
                    className="todo-input"
                    value={draft.endDate}
                    onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))}
                  />
                </label>
              </div>
              <div className="todo-field-grid">
                <label className="todo-field">
                  <span>{t("todo.priorityLabel")}</span>
                  <select
                    className="todo-input"
                    value={draft.priority}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        priority: event.target.value as TaskDraft["priority"],
                      }))
                    }
                  >
                    <option value="low">{t("todo.priorityLow")}</option>
                    <option value="medium">{t("todo.priorityMedium")}</option>
                    <option value="high">{t("todo.priorityHigh")}</option>
                  </select>
                </label>
                <label className="todo-field">
                  <span>{t("todo.projectLabel")}</span>
                  <select
                    className="todo-input"
                    value={draft.projectId ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        projectId: event.target.value ? Number(event.target.value) : null,
                        columnId: null,
                      }))
                    }
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.kind === "inbox" ? t("todo.inboxNav") : project.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="todo-modal-actions">
              {editingTaskId && (
                <div className="todo-modal-actions-left">
                  <button
                    type="button"
                    className="ghost-button todo-danger"
                    onClick={() => void handleDeleteTask(editingTaskId)}
                  >
                    {t("todo.deleteTask")}
                  </button>
                  {(() => {
                    const editingTask =
                      todayTasks.find((item) => item.id === editingTaskId) ||
                      completedTasks.find((item) => item.id === editingTaskId) ||
                      board?.columns.flatMap((entry) => entry.tasks).find((item) => item.id === editingTaskId);
                    if (!editingTask) {
                      return null;
                    }
                    return editingTask.completedAt ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void handleReopenTask(editingTaskId)}
                      >
                        {t("todo.reopenTask")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleCompleteTask(editingTaskId)}
                      >
                        {t("todo.completeTask")}
                      </button>
                    );
                  })()}
                </div>
              )}
              <div className="todo-modal-actions-right">
                <button type="button" className="ghost-button" onClick={() => setTaskModalOpen(false)}>
                  {t("todo.cancel")}
                </button>
                <button type="submit" className="primary-button" disabled={loading}>
                  {t("todo.saveTask")}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}




