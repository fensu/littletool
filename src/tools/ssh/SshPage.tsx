import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "../../i18n/I18nProvider";
import { SshTerminal } from "./SshTerminal";
import {
  DEFAULT_SSH_FORM,
  type SshConnection,
  type SshConnectionForm,
  type SshSessionSnapshot,
  type SshStatusEvent,
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
    try {
      return JSON.stringify(error);
    } catch {
      // ignore
    }
  }
  return fallback;
}

type SshPageProps = {
  themeMode: "dark" | "light";
};

export function SshPage({ themeMode }: SshPageProps) {
  const { t } = useI18n();
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [openTabIds, setOpenTabIds] = useState<number[]>([]);
  const [sessionStatus, setSessionStatus] = useState<Record<number, SshSessionSnapshot>>({});
  const [sessionEpoch, setSessionEpoch] = useState<Record<number, number>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<SshConnectionForm>(DEFAULT_SSH_FORM);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [command, setCommand] = useState("");
  const [broadcast, setBroadcast] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"tabs" | "monitor">("tabs");

  const readyIds = useMemo(
    () =>
      Object.values(sessionStatus)
        .filter((snapshot) => snapshot.connected)
        .map((snapshot) => snapshot.connectionId),
    [sessionStatus],
  );

  const monitorCols = useMemo(() => {
    const count = openTabIds.length;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    return 4;
  }, [openTabIds.length]);

  const resetFeedback = () => {
    setNotice("");
    setError("");
  };

  const loadConnections = async () => {
    setLoading(true);
    resetFeedback();
    try {
      const items = await invoke<SshConnection[]>("list_ssh_connections");
      setConnections(items);
      setActiveId((current) => {
        if (current && items.some((item) => item.id === current)) {
          return current;
        }
        return items[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError, "SSH load failed"));
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshots = async () => {
    try {
      const snapshots = await invoke<SshSessionSnapshot[]>("list_ssh_session_snapshots");
      setSessionStatus(
        snapshots.reduce<Record<number, SshSessionSnapshot>>((accumulator, item) => {
          accumulator[item.connectionId] = item;
          return accumulator;
        }, {}),
      );
    } catch (snapshotError) {
      setError(getErrorMessage(snapshotError, "SSH snapshot load failed"));
    }
  };

  useEffect(() => {
    void loadConnections();
    void loadSnapshots();

    let unlistenStatus: UnlistenFn | undefined;
    void listen<SshStatusEvent>("ssh-status", (event) => {
      const payload = event.payload;
      setSessionStatus((current) => ({
        ...current,
        [payload.connectionId]: {
          connectionId: payload.connectionId,
          connected: payload.connected,
          output: current[payload.connectionId]?.output ?? "",
          error: payload.error ?? null,
          lastUpdatedMs: Date.now(),
        },
      }));
      if (!payload.connected && payload.error) {
        setError(payload.error);
      }
    }).then((unlisten) => {
      unlistenStatus = unlisten;
    });

    return () => {
      if (unlistenStatus) {
        unlistenStatus();
      }
    };
  }, []);

  const openCreateModal = () => {
    setForm(DEFAULT_SSH_FORM);
    resetFeedback();
    setModalOpen(true);
  };

  const openEditModal = (connection: SshConnection) => {
    setForm({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: String(connection.port),
      username: connection.username,
      password: connection.password,
    });
    resetFeedback();
    setModalOpen(true);
  };

  const handleFormChange = (field: keyof SshConnectionForm, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const ensureTabOpen = (connectionId: number) => {
    setOpenTabIds((current) => (current.includes(connectionId) ? current : [...current, connectionId]));
    setActiveId(connectionId);
  };

  const bumpSessionEpoch = (connectionId: number) => {
    setSessionEpoch((current) => ({
      ...current,
      [connectionId]: (current[connectionId] ?? 0) + 1,
    }));
  };

  const handleSaveConnection = async () => {
    if (!form.name.trim() || !form.host.trim() || !form.port.trim() || !form.username.trim() || !form.password.trim()) {
      setError(t("ssh.formInvalid"));
      return;
    }

    setLoading(true);
    resetFeedback();
    try {
      await invoke<SshConnection>("save_ssh_connection", {
        payload: {
          id: form.id,
          name: form.name.trim(),
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username.trim(),
          password: form.password,
        },
      });
      setModalOpen(false);
      setNotice(t("ssh.saveSuccess"));
      await loadConnections();
      await loadSnapshots();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "SSH save failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConnection = async (connectionId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("delete_ssh_connection", { id: connectionId });
      setOpenTabIds((current) => current.filter((id) => id !== connectionId));
      setSessionStatus((current) => {
        const next = { ...current };
        delete next[connectionId];
        return next;
      });
      setNotice(t("ssh.deleteSuccess"));
      await loadConnections();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "SSH delete failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSession = async (connectionId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("open_ssh_session", { id: connectionId });
      bumpSessionEpoch(connectionId);
      ensureTabOpen(connectionId);
      await loadSnapshots();
      setNotice(t("ssh.connectSuccess"));
    } catch (openError) {
      setError(getErrorMessage(openError, "SSH connect failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSession = async (connectionId: number) => {
    setLoading(true);
    resetFeedback();
    try {
      await invoke("close_ssh_session", { id: connectionId });
      setSessionStatus((current) => ({
        ...current,
        [connectionId]: {
          connectionId,
          connected: false,
          output: current[connectionId]?.output ?? "",
          error: null,
          lastUpdatedMs: Date.now(),
        },
      }));
      setNotice(t("ssh.disconnectSuccess"));
    } catch (closeError) {
      setError(getErrorMessage(closeError, "SSH disconnect failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCloseTab = (connectionId: number) => {
    setOpenTabIds((current) => {
      const next = current.filter((id) => id !== connectionId);
      setActiveId((active) => {
        if (active !== connectionId) {
          return active;
        }
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  };

  const handleRunCommand = async () => {
    const nextCommand = command.trim();
    const targetIds = broadcast
      ? readyIds
      : activeId && readyIds.includes(activeId)
        ? [activeId]
        : [];

    if (!nextCommand) {
      setError(t("ssh.runEmptyError"));
      return;
    }

    if (targetIds.length === 0) {
      setError(t("ssh.noTargetError"));
      return;
    }

    setRunning(true);
    resetFeedback();
    try {
      await invoke("run_ssh_command", {
        payload: {
          command: nextCommand,
          connectionIds: targetIds,
        },
      });
      setNotice(t("ssh.runSuccess"));
      setCommand("");
    } catch (runError) {
      setError(getErrorMessage(runError, "SSH run failed"));
    } finally {
      setRunning(false);
    }
  };

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleRunCommand();
  };

  const activeConnection = connections.find((item) => item.id === activeId) ?? null;

  return (
    <section className="ssh-page">
      <div className="ssh-shell ssh-workspace">
        <div className="ssh-toolbar">
          <div>
            <h2>{t("tools.ssh.label")}</h2>
            <p>{t("tools.ssh.description")}</p>
          </div>
          <div className="ssh-toolbar-actions">
            <div className="ssh-view-toggle" role="group" aria-label={t("ssh.viewModeLabel")}>
              <button
                type="button"
                className={`ssh-view-btn ${viewMode === "tabs" ? "is-active" : ""}`}
                onClick={() => setViewMode("tabs")}
                title={t("ssh.viewTabs")}
              >
                {t("ssh.viewTabs")}
              </button>
              <button
                type="button"
                className={`ssh-view-btn ${viewMode === "monitor" ? "is-active" : ""}`}
                onClick={() => setViewMode("monitor")}
                title={t("ssh.viewMonitor")}
              >
                {t("ssh.viewMonitor")}
              </button>
            </div>
            <button type="button" className="primary-button" onClick={openCreateModal}>
              {t("ssh.addConnection")}
            </button>
          </div>
        </div>

        {error && <div className="ssh-alert is-error">{error}</div>}
        {notice && <div className="ssh-alert is-success">{notice}</div>}

        {connections.length === 0 ? (
          <div className="ssh-empty">
            <h3>{t("ssh.emptyTitle")}</h3>
            <p>{t("ssh.emptyDescription")}</p>
          </div>
        ) : (
          <div className={`ssh-main-layout ${viewMode === "monitor" ? "is-monitor" : "is-tabs"}`}>
            <aside className="ssh-session-list">
              <div className="ssh-session-list-header">
                <span>{t("ssh.sessionListTitle")}</span>
                <span className="ssh-session-count">{connections.length}</span>
              </div>
              <div className="ssh-session-list-body">
                {connections.map((connection) => {
                  const isReady = readyIds.includes(connection.id);
                  const isActive = connection.id === activeId;
                  const isOpen = openTabIds.includes(connection.id);
                  return (
                    <article
                      key={connection.id}
                      className={`ssh-session-item ${isActive ? "is-active" : ""} ${isReady ? "is-ready" : ""} ${isOpen ? "is-open" : ""}`}
                      onClick={() => {
                        setActiveId(connection.id);
                        if (isReady || isOpen) {
                          ensureTabOpen(connection.id);
                        }
                      }}
                    >
                      <div className="ssh-session-main">
                        <span className={`ssh-session-dot ${isReady ? "is-ready" : ""}`} />
                        <div className="ssh-session-text">
                          <strong>{connection.name}</strong>
                          <span>
                            {connection.username}@{connection.host}:{connection.port}
                          </span>
                        </div>
                      </div>
                      <div className="ssh-session-item-actions" onClick={(event) => event.stopPropagation()}>
                        {isReady ? (
                          <button
                            type="button"
                            className="ssh-icon-btn"
                            disabled={loading}
                            title={t("ssh.disconnectAction")}
                            onClick={() => void handleCloseSession(connection.id)}
                          >
                            ■
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ssh-icon-btn is-primary"
                            disabled={loading}
                            title={t("ssh.connectAction")}
                            onClick={() => void handleOpenSession(connection.id)}
                          >
                            ▶
                          </button>
                        )}
                        <button
                          type="button"
                          className="ssh-icon-btn"
                          title={t("ssh.editAction")}
                          onClick={() => openEditModal(connection)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="ssh-icon-btn is-danger"
                          disabled={loading}
                          title={t("ssh.deleteAction")}
                          onClick={() => void handleDeleteConnection(connection.id)}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </aside>

            <div className="ssh-terminal-panel">
              {viewMode === "tabs" && (
                <div className="ssh-tab-bar">
                  {openTabIds.length === 0 ? (
                    <div className="ssh-tab-empty">{t("ssh.noOpenTerminal")}</div>
                  ) : (
                    openTabIds.map((tabId) => {
                      const connection = connections.find((item) => item.id === tabId);
                      if (!connection) {
                        return null;
                      }
                      const isReady = readyIds.includes(tabId);
                      return (
                        <button
                          type="button"
                          key={tabId}
                          className={`ssh-tab ${tabId === activeId ? "is-active" : ""}`}
                          onClick={() => setActiveId(tabId)}
                        >
                          <span className={`ssh-tab-dot ${isReady ? "is-ready" : ""}`} />
                          <span>{connection.name}</span>
                          <span
                            className="ssh-tab-close"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCloseTab(tabId);
                            }}
                          >
                            ×
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {viewMode === "monitor" && openTabIds.length > 0 && (
                <div className="ssh-monitor-toolbar">
                  <span>{t("ssh.monitorHint")}</span>
                  <span>
                    {openTabIds.length} {t("ssh.monitorWindows")}
                  </span>
                </div>
              )}

              <div
                className={`ssh-terminal-stage ${viewMode === "monitor" ? "is-monitor" : "is-tabs"}`}
                style={
                  viewMode === "monitor"
                    ? ({ ["--ssh-monitor-cols" as string]: String(monitorCols) } as CSSProperties)
                    : undefined
                }
              >
                {openTabIds.length === 0 ? (
                  <div className="ssh-terminal-placeholder">
                    <h3>{t("ssh.terminalEmptyTitle")}</h3>
                    <p>{t("ssh.terminalEmptyDescription")}</p>
                    {activeConnection && (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={loading}
                        onClick={() => void handleOpenSession(activeConnection.id)}
                      >
                        {t("ssh.connectAction")}
                      </button>
                    )}
                  </div>
                ) : viewMode === "tabs" ? (
                  openTabIds.map((tabId) => (
                    <SshTerminal
                      key={`${tabId}-${sessionEpoch[tabId] ?? 0}`}
                      connectionId={tabId}
                      active={tabId === activeId}
                      connected={readyIds.includes(tabId)}
                      themeMode={themeMode}
                    />
                  ))
                ) : (
                  openTabIds.map((tabId) => {
                    const connection = connections.find((item) => item.id === tabId);
                    const isReady = readyIds.includes(tabId);
                    return (
                      <div
                        key={`pane-${tabId}-${sessionEpoch[tabId] ?? 0}`}
                        className={`ssh-monitor-pane ${tabId === activeId ? "is-active" : ""}`}
                        onMouseDown={() => setActiveId(tabId)}
                      >
                        <div className="ssh-monitor-pane-header">
                          <div className="ssh-monitor-pane-title">
                            <span className={`ssh-tab-dot ${isReady ? "is-ready" : ""}`} />
                            <strong>{connection?.name ?? `#${tabId}`}</strong>
                            <span>
                              {connection
                                ? `${connection.username}@${connection.host}:${connection.port}`
                                : ""}
                            </span>
                          </div>
                          <div className="ssh-monitor-pane-actions">
                            {isReady ? (
                              <button
                                type="button"
                                className="ssh-icon-btn"
                                title={t("ssh.disconnectAction")}
                                disabled={loading}
                                onClick={() => void handleCloseSession(tabId)}
                              >
                                ■
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ssh-icon-btn is-primary"
                                title={t("ssh.connectAction")}
                                disabled={loading}
                                onClick={() => void handleOpenSession(tabId)}
                              >
                                ▶
                              </button>
                            )}
                            <button
                              type="button"
                              className="ssh-icon-btn"
                              title={t("ssh.closeWindow")}
                              onClick={() => handleCloseTab(tabId)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <div className="ssh-monitor-pane-body">
                          <SshTerminal
                            connectionId={tabId}
                            active
                            connected={isReady}
                            themeMode={themeMode}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="ssh-command-bar">
                <div className="ssh-command-field">
                  <label htmlFor="ssh-command">{t("ssh.commandLabel")}</label>
                  <input
                    id="ssh-command"
                    className="timestamp-input"
                    value={command}
                    placeholder={t("ssh.commandPlaceholder")}
                    onChange={(event) => setCommand(event.target.value)}
                    onKeyDown={handleCommandKeyDown}
                  />
                </div>
                <label className="ssh-broadcast-toggle">
                  <input
                    type="checkbox"
                    checked={broadcast}
                    onChange={(event) => setBroadcast(event.target.checked)}
                  />
                  <span>{t("ssh.broadcastLabel")}</span>
                </label>
                <button
                  type="button"
                  className="primary-button ssh-run-button"
                  onClick={() => void handleRunCommand()}
                  disabled={running}
                >
                  {running ? t("ssh.running") : t("ssh.sendAction")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {modalOpen && (
        <div className="ssh-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="ssh-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ssh-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ssh-modal-header">
              <div className="ssh-modal-title-wrap">
                <div className="ssh-modal-badge">SSH</div>
                <div>
                  <h3 id="ssh-modal-title">
                    {form.id ? t("ssh.modalTitleEdit") : t("ssh.modalTitleCreate")}
                  </h3>
                  <p>{t("ssh.modalDescription")}</p>
                </div>
              </div>
              <button
                type="button"
                className="ssh-modal-close"
                aria-label={t("ssh.cancelAction")}
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="ssh-modal-body">
              <section className="ssh-form-section">
                <div className="ssh-form-section-title">{t("ssh.sectionBasic")}</div>
                <div className="ssh-form-grid">
                  <div className="ssh-field ssh-field-span">
                    <label htmlFor="ssh-name">{t("ssh.nameLabel")}</label>
                    <input
                      id="ssh-name"
                      className="ssh-input"
                      value={form.name}
                      placeholder={t("ssh.namePlaceholder")}
                      autoFocus
                      onChange={(event) => handleFormChange("name", event.target.value)}
                    />
                    <span className="ssh-field-hint">{t("ssh.nameHint")}</span>
                  </div>
                </div>
              </section>

              <section className="ssh-form-section">
                <div className="ssh-form-section-title">{t("ssh.sectionServer")}</div>
                <div className="ssh-form-grid ssh-form-grid-server">
                  <div className="ssh-field ssh-field-host">
                    <label htmlFor="ssh-host">{t("ssh.hostLabel")}</label>
                    <input
                      id="ssh-host"
                      className="ssh-input"
                      value={form.host}
                      placeholder={t("ssh.hostPlaceholder")}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => handleFormChange("host", event.target.value)}
                    />
                  </div>
                  <div className="ssh-field ssh-field-port">
                    <label htmlFor="ssh-port">{t("ssh.portLabel")}</label>
                    <input
                      id="ssh-port"
                      className="ssh-input"
                      value={form.port}
                      placeholder={t("ssh.portPlaceholder")}
                      inputMode="numeric"
                      onChange={(event) => handleFormChange("port", event.target.value)}
                    />
                  </div>
                </div>
              </section>

              <section className="ssh-form-section">
                <div className="ssh-form-section-title">{t("ssh.sectionAuth")}</div>
                <div className="ssh-form-grid">
                  <div className="ssh-field">
                    <label htmlFor="ssh-username">{t("ssh.usernameLabel")}</label>
                    <input
                      id="ssh-username"
                      className="ssh-input"
                      value={form.username}
                      placeholder={t("ssh.usernamePlaceholder")}
                      autoComplete="username"
                      onChange={(event) => handleFormChange("username", event.target.value)}
                    />
                  </div>
                  <div className="ssh-field">
                    <label htmlFor="ssh-password">{t("ssh.passwordLabel")}</label>
                    <input
                      id="ssh-password"
                      className="ssh-input"
                      type="password"
                      value={form.password}
                      placeholder={t("ssh.passwordPlaceholder")}
                      autoComplete="current-password"
                      onChange={(event) => handleFormChange("password", event.target.value)}
                    />
                  </div>
                </div>
                <p className="ssh-form-footnote">{t("ssh.authHint")}</p>
              </section>
            </div>

            <div className="ssh-modal-actions">
              <button type="button" className="ghost-button ssh-modal-cancel" onClick={() => setModalOpen(false)}>
                {t("ssh.cancelAction")}
              </button>
              <button
                type="button"
                className="primary-button ssh-modal-save"
                disabled={loading}
                onClick={() => void handleSaveConnection()}
              >
                {loading ? t("ssh.saving") : t("ssh.saveAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}




