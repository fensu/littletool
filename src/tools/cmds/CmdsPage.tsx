import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../../i18n/I18nProvider";
import type { CommandRunbook, CommandRunbookSummary, StepDraft } from "./types";

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

const EMPTY_STEP: StepDraft = { title: "", command: "", note: "" };

export function CmdsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<CommandRunbookSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CommandRunbook | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("自定义");
  const [formProblem, setFormProblem] = useState("");
  const [formSteps, setFormSteps] = useState<StepDraft[]>([{ ...EMPTY_STEP }]);

  const categories = useMemo(() => {
    const set = new Set(items.map((item) => item.category).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.title.toLowerCase().includes(q) ||
        item.problem.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [items, category, keyword]);

  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  const loadList = async (preferredId?: number | null) => {
    const list = await invoke<CommandRunbookSummary[]>("list_command_runbooks");
    setItems(list);
    const nextId =
      preferredId ??
      activeId ??
      list[0]?.id ??
      null;
    if (nextId != null && list.some((item) => item.id === nextId)) {
      setActiveId(nextId);
      const full = await invoke<CommandRunbook>("get_command_runbook", { id: nextId });
      setDetail(full);
    } else if (list[0]) {
      setActiveId(list[0].id);
      const full = await invoke<CommandRunbook>("get_command_runbook", { id: list[0].id });
      setDetail(full);
    } else {
      setActiveId(null);
      setDetail(null);
    }
  };

  const refresh = async (preferredId?: number | null) => {
    setLoading(true);
    resetFeedback();
    try {
      await loadList(preferredId);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Load runbooks failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selectItem = async (id: number) => {
    setActiveId(id);
    setLoading(true);
    resetFeedback();
    try {
      const full = await invoke<CommandRunbook>("get_command_runbook", { id });
      setDetail(full);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Load runbook failed"));
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormTitle("");
    setFormCategory("自定义");
    setFormProblem("");
    setFormSteps([{ ...EMPTY_STEP, title: "1. 命令" }]);
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!detail) {
      return;
    }
    setEditingId(detail.source === "builtin" ? null : detail.id);
    setFormTitle(detail.source === "builtin" ? `${detail.title} (自定义)` : detail.title);
    setFormCategory(detail.category);
    setFormProblem(detail.problem);
    setFormSteps(
      detail.steps.map((step) => ({
        title: step.title,
        command: step.command,
        note: step.note || "",
      })),
    );
    setEditorOpen(true);
  };

  const updateStep = (index: number, field: keyof StepDraft, value: string) => {
    setFormSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, [field]: value } : step)),
    );
  };

  const addStep = () => {
    setFormSteps((current) => [
      ...current,
      { ...EMPTY_STEP, title: `${current.length + 1}. 命令` },
    ]);
  };

  const removeStep = (index: number) => {
    setFormSteps((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  };

  const handleSave = async () => {
    const steps = formSteps
      .map((step) => ({
        title: step.title.trim(),
        command: step.command.trim(),
        note: step.note.trim() || undefined,
      }))
      .filter((step) => step.command);

    if (!formTitle.trim() || !formCategory.trim() || steps.length === 0) {
      setError(t("cmds.formInvalid"));
      return;
    }

    setLoading(true);
    resetFeedback();
    try {
      const saved = await invoke<CommandRunbook>("save_command_runbook", {
        payload: {
          id: editingId,
          title: formTitle.trim(),
          category: formCategory.trim(),
          problem: formProblem.trim(),
          steps,
        },
      });
      setEditorOpen(false);
      setNotice(t("cmds.saveSuccess"));
      await refresh(saved.id);
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Save failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!detail || detail.source === "builtin") {
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      await invoke("delete_command_runbook", { id: detail.id });
      setNotice(t("cmds.deleteSuccess"));
      await refresh(null);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Delete failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!detail) {
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      const markdown = await invoke<string>("export_command_runbook_md", { id: detail.id });
      await navigator.clipboard.writeText(markdown);
      setNotice(t("cmds.exportCopied"));
    } catch (exportError) {
      setError(getErrorMessage(exportError, "Export failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      setError(t("cmds.importEmpty"));
      return;
    }
    setLoading(true);
    resetFeedback();
    try {
      const saved = await invoke<CommandRunbook>("import_command_runbook_md", {
        payload: { contentMd: importText },
      });
      setImportOpen(false);
      setImportText("");
      setNotice(t("cmds.importSuccess"));
      await refresh(saved.id);
    } catch (importError) {
      setError(getErrorMessage(importError, "Import failed"));
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (value: string, successKey: "cmds.copied" | "cmds.exportCopied") => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(t(successKey));
    } catch {
      setError(t("cmds.copyFailed"));
    }
  };

  const copyAllCommands = async () => {
    if (!detail) {
      return;
    }
    const script = detail.steps.map((step) => step.command).join("\n");
    await copyText(script, "cmds.copied");
  };

  return (
    <section className="cmds-page">
      <div className="cmds-shell">
        <aside className="cmds-sidebar">
          <div className="cmds-sidebar-header">
            <strong>{t("cmds.libraryTitle")}</strong>
            <div className="cmds-sidebar-actions">
              <button type="button" className="ghost-button cmds-mini" onClick={() => setImportOpen(true)}>
                {t("cmds.importAction")}
              </button>
              <button type="button" className="primary-button cmds-mini" onClick={openCreate}>
                {t("cmds.addAction")}
              </button>
            </div>
          </div>

          <input
            className="cmds-input"
            value={keyword}
            placeholder={t("cmds.searchPlaceholder")}
            onChange={(event) => setKeyword(event.target.value)}
          />

          <div className="cmds-category-row">
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                className={`cmds-chip ${category === item ? "is-active" : ""}`}
                onClick={() => setCategory(item)}
              >
                {item === "all" ? t("cmds.allCategories") : item}
              </button>
            ))}
          </div>

          <div className="cmds-list">
            {filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`cmds-list-item ${activeId === item.id ? "is-active" : ""}`}
                onClick={() => void selectItem(item.id)}
              >
                <div className="cmds-list-item-top">
                  <strong>{item.title}</strong>
                  <span className={`cmds-source ${item.source}`}>{item.source === "builtin" ? t("cmds.builtin") : t("cmds.custom")}</span>
                </div>
                <div className="cmds-list-item-meta">
                  <span>{item.category}</span>
                  <span>
                    {item.stepCount} {t("cmds.stepsUnit")}
                  </span>
                </div>
                {item.problem && <div className="cmds-list-item-problem">{item.problem}</div>}
              </button>
            ))}
            {filtered.length === 0 && <div className="cmds-empty">{t("cmds.emptyList")}</div>}
          </div>
        </aside>

        <div className="cmds-main">
          <div className="cmds-toolbar">
            <div>
              <h2>{detail?.title || t("tools.cmds.label")}</h2>
              <p>{detail?.problem || t("tools.cmds.description")}</p>
            </div>
            <div className="cmds-toolbar-actions">
              <button type="button" className="ghost-button" disabled={loading} onClick={() => void refresh(activeId)}>
                {t("cmds.refresh")}
              </button>
              {detail && (
                <>
                  <button type="button" className="ghost-button" onClick={() => void copyAllCommands()}>
                    {t("cmds.copyAll")}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => void handleExport()}>
                    {t("cmds.exportAction")}
                  </button>
                  <button type="button" className="ghost-button" onClick={openEdit}>
                    {detail.source === "builtin" ? t("cmds.forkAction") : t("cmds.editAction")}
                  </button>
                  {detail.source !== "builtin" && (
                    <button type="button" className="ghost-button cmds-danger" onClick={() => void handleDelete()}>
                      {t("cmds.deleteAction")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {error && <div className="cmds-alert is-error">{error}</div>}
          {notice && <div className="cmds-alert is-success">{notice}</div>}

          {!detail ? (
            <div className="cmds-empty-main">{t("cmds.emptyDetail")}</div>
          ) : (
            <div className="cmds-detail">
              <div className="cmds-detail-meta">
                <span className="cmds-chip is-active">{detail.category}</span>
                <span className={`cmds-source ${detail.source}`}>
                  {detail.source === "builtin" ? t("cmds.builtin") : t("cmds.custom")}
                </span>
                <span>
                  {detail.steps.length} {t("cmds.stepsUnit")}
                </span>
              </div>

              <section className="cmds-problem-card">
                <h3>{t("cmds.problemTitle")}</h3>
                <p>{detail.problem || t("cmds.noProblem")}</p>
              </section>

              <section className="cmds-steps">
                <h3>{t("cmds.stepsTitle")}</h3>
                {detail.steps.map((step, index) => (
                  <article key={step.id} className="cmds-step-card">
                    <div className="cmds-step-header">
                      <strong>
                        {index + 1}. {step.title || t("cmds.stepFallback")}
                      </strong>
                      <button
                        type="button"
                        className="ghost-button cmds-mini"
                        onClick={() => void copyText(step.command, "cmds.copied")}
                      >
                        {t("cmds.copyCommand")}
                      </button>
                    </div>
                    {step.note && <p className="cmds-step-note">{step.note}</p>}
                    <pre className="cmds-code">{step.command}</pre>
                  </article>
                ))}
              </section>

              <section className="cmds-md-preview">
                <div className="cmds-step-header">
                  <h3>{t("cmds.markdownTitle")}</h3>
                  <button
                    type="button"
                    className="ghost-button cmds-mini"
                    onClick={() => void copyText(detail.contentMd, "cmds.exportCopied")}
                  >
                    {t("cmds.copyMarkdown")}
                  </button>
                </div>
                <pre className="cmds-md-block">{detail.contentMd}</pre>
              </section>
            </div>
          )}
        </div>
      </div>

      {editorOpen && (
        <div className="cmds-modal-backdrop" onClick={() => setEditorOpen(false)}>
          <div className="cmds-modal" onClick={(event) => event.stopPropagation()}>
            <div className="cmds-modal-header">
              <h3>{editingId ? t("cmds.editTitle") : t("cmds.createTitle")}</h3>
              <button type="button" className="todo-icon-btn" onClick={() => setEditorOpen(false)}>
                ×
              </button>
            </div>
            <div className="cmds-modal-body">
              <label className="cmds-field">
                <span>{t("cmds.titleLabel")}</span>
                <input className="cmds-input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
              </label>
              <label className="cmds-field">
                <span>{t("cmds.categoryLabel")}</span>
                <input className="cmds-input" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} />
              </label>
              <label className="cmds-field">
                <span>{t("cmds.problemLabel")}</span>
                <textarea
                  className="cmds-textarea"
                  rows={3}
                  value={formProblem}
                  onChange={(e) => setFormProblem(e.target.value)}
                  placeholder={t("cmds.problemPlaceholder")}
                />
              </label>

              <div className="cmds-steps-editor">
                <div className="cmds-step-header">
                  <strong>{t("cmds.stepsTitle")}</strong>
                  <button type="button" className="ghost-button cmds-mini" onClick={addStep}>
                    {t("cmds.addStep")}
                  </button>
                </div>
                {formSteps.map((step, index) => (
                  <div key={index} className="cmds-step-editor-card">
                    <div className="cmds-step-header">
                      <span>
                        {t("cmds.stepFallback")} {index + 1}
                      </span>
                      <button type="button" className="ghost-button cmds-mini cmds-danger" onClick={() => removeStep(index)}>
                        {t("cmds.removeStep")}
                      </button>
                    </div>
                    <input
                      className="cmds-input"
                      value={step.title}
                      placeholder={t("cmds.stepTitlePlaceholder")}
                      onChange={(e) => updateStep(index, "title", e.target.value)}
                    />
                    <textarea
                      className="cmds-textarea"
                      rows={3}
                      value={step.command}
                      placeholder={t("cmds.stepCommandPlaceholder")}
                      onChange={(e) => updateStep(index, "command", e.target.value)}
                    />
                    <input
                      className="cmds-input"
                      value={step.note}
                      placeholder={t("cmds.stepNotePlaceholder")}
                      onChange={(e) => updateStep(index, "note", e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="cmds-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setEditorOpen(false)}>
                {t("cmds.cancel")}
              </button>
              <button type="button" className="primary-button" disabled={loading} onClick={() => void handleSave()}>
                {t("cmds.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="cmds-modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="cmds-modal" onClick={(event) => event.stopPropagation()}>
            <div className="cmds-modal-header">
              <h3>{t("cmds.importTitle")}</h3>
              <button type="button" className="todo-icon-btn" onClick={() => setImportOpen(false)}>
                ×
              </button>
            </div>
            <div className="cmds-modal-body">
              <p className="cmds-help">{t("cmds.importHelp")}</p>
              <textarea
                className="cmds-textarea"
                rows={14}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={t("cmds.importPlaceholder")}
              />
            </div>
            <div className="cmds-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setImportOpen(false)}>
                {t("cmds.cancel")}
              </button>
              <button type="button" className="primary-button" disabled={loading} onClick={() => void handleImport()}>
                {t("cmds.importConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
