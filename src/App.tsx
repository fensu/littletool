import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import packageJson from "../package.json";
import { getToolDescriptionKey, getToolLabelKey, menuSections, type SectionKey, type ToolKey } from "./config/menu";
import { locales as supportedLocales } from "./i18n/config";
import { useI18n } from "./i18n/I18nProvider";
import "./App.css";

type ThemeMode = "dark" | "light";
type Status = "idle" | "valid" | "error";
type UpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "installing"
  | "installed"
  | "error";

const THEME_STORAGE_KEY = "littletool-theme";
const APP_VERSION = packageJson.version;
type UpdateInfo = NonNullable<Awaited<ReturnType<typeof check>>>;

const sampleJson = `{
  "name": "littletool",
  "version": "1.0.0",
  "tools": ["JSON Tool", "Timestamp Converter", "Redis Manager"],
  "config": {
    "theme": "dark",
    "locale": "zh-CN",
    "lightweight": true
  }
}`;

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

function App() {
  const { locale, setLocale, t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [activeTool, setActiveTool] = useState<ToolKey>("json");
  const [expandedSections, setExpandedSections] = useState<Record<SectionKey, boolean>>({
    basic: true,
    ops: true,
    docs: true,
    todo: true,
  });
  const [input, setInput] = useState(sampleJson);
  const [output, setOutput] = useState("");
  const [indent, setIndent] = useState(2);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateError, setUpdateError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    let cancelled = false;

    const checkForUpdates = async () => {
      setUpdateStatus("checking");
      setUpdateError("");

      try {
        const nextUpdate = await check();
        if (cancelled) {
          return;
        }

        if (nextUpdate) {
          setUpdateInfo(nextUpdate);
          setUpdateStatus("available");
          return;
        }

        setUpdateInfo(null);
        setUpdateStatus("latest");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setUpdateInfo(null);
        setUpdateStatus("error");
        setUpdateError(error instanceof Error ? error.message : "Updater check failed");
      }
    };

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSection = (sectionKey: SectionKey) => {
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const selectTool = (toolKey: ToolKey) => {
    setActiveTool(toolKey);
  };

  const applyJsonResult = (formatter: (value: unknown) => string) => {
    try {
      const parsed = JSON.parse(input);
      setOutput(formatter(parsed));
      setStatus("valid");
      setErrorMsg("");
    } catch (error) {
      setOutput("");
      setStatus("error");
      setErrorMsg(error instanceof Error ? error.message : "JSON parse failed");
    }
  };

  const handleFormat = () => {
    applyJsonResult((parsed) => JSON.stringify(parsed, null, indent));
  };

  const handleMinify = () => {
    applyJsonResult((parsed) => JSON.stringify(parsed));
  };

  const handleValidate = () => {
    applyJsonResult((parsed) => JSON.stringify(parsed, null, indent));
  };

  const handleCopy = async () => {
    if (!output) {
      return;
    }

    await navigator.clipboard.writeText(output);
    setCopied(true);
  };

  const handleReset = () => {
    setInput("");
    setOutput("");
    setStatus("idle");
    setErrorMsg("");
    setCopied(false);
  };

  const handleCheckUpdates = async () => {
    setUpdateStatus("checking");
    setUpdateError("");

    try {
      const nextUpdate = await check();
      if (nextUpdate) {
        setUpdateInfo(nextUpdate);
        setUpdateStatus("available");
        return;
      }

      setUpdateInfo(null);
      setUpdateStatus("latest");
    } catch (error) {
      setUpdateInfo(null);
      setUpdateStatus("error");
      setUpdateError(error instanceof Error ? error.message : "Updater check failed");
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo) {
      return;
    }

    setUpdateStatus("installing");
    setUpdateError("");

    try {
      await updateInfo.downloadAndInstall();
      setUpdateStatus("installed");
    } catch (error) {
      setUpdateStatus("error");
      setUpdateError(error instanceof Error ? error.message : "Updater install failed");
    }
  };

  const renderJsonPage = () => (
    <section className="panel">
      {status !== "idle" && (
        <div className={`status-bar ${status === "valid" ? "is-valid" : "is-error"}`}>
          <span className="status-icon">{status === "valid" ? "✓" : "!"}</span>
          <span>
            {status === "valid" ? t("json.valid") : `${t("json.invalidPrefix")}${errorMsg}`}
          </span>
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-panel">
          <div className="panel-header">
            <span>{t("common.input")}</span>
            <button type="button" className="ghost-button" onClick={handleReset}>
              {t("common.clear")}
            </button>
          </div>
          <textarea
            className="editor"
            value={input}
            spellCheck={false}
            placeholder={t("json.inputPlaceholder")}
            onChange={(event) => {
              setInput(event.target.value);
              setStatus("idle");
              setErrorMsg("");
            }}
          />
        </div>

        <div className="action-column">
          <button type="button" className="primary-button" onClick={handleFormat}>
            {t("common.format")}
          </button>
          <button type="button" className="secondary-button" onClick={handleMinify}>
            {t("common.minify")}
          </button>
          <button type="button" className="secondary-button" onClick={handleValidate}>
            {t("common.validate")}
          </button>
        </div>

        <div className="editor-panel">
          <div className="panel-header">
            <span>{t("common.output")}</span>
            <button
              type="button"
              className="ghost-button"
              onClick={handleCopy}
              disabled={!output}
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <textarea
            className="editor"
            value={output}
            readOnly
            spellCheck={false}
            placeholder={t("json.outputPlaceholder")}
          />
        </div>
      </div>
    </section>
  );

  const renderSettingsPage = () => (
    <section className="settings-page">
      <div className="settings-card">
        <div className="settings-header">
          <div>
            <h2>{t("settings.title")}</h2>
            <p>{t("settings.intro")}</p>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("settings.themeGroup")}</div>
          <div className="theme-grid">
            <button
              type="button"
              className={`theme-option ${theme === "dark" ? "is-selected" : ""}`}
              onClick={() => setTheme("dark")}
            >
              <span className="theme-preview theme-preview-dark" />
              <strong>{t("settings.themeDarkTitle")}</strong>
              <span>{t("settings.themeDarkDesc")}</span>
            </button>
            <button
              type="button"
              className={`theme-option ${theme === "light" ? "is-selected" : ""}`}
              onClick={() => setTheme("light")}
            >
              <span className="theme-preview theme-preview-light" />
              <strong>{t("settings.themeLightTitle")}</strong>
              <span>{t("settings.themeLightDesc")}</span>
            </button>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("settings.languageGroup")}</div>
          <div className="theme-grid">
            {supportedLocales.map((entryLocale) => (
              <button
                type="button"
                key={entryLocale}
                className={`theme-option ${locale === entryLocale ? "is-selected" : ""}`}
                onClick={() => setLocale(entryLocale)}
              >
                <span className="locale-tag">{t(`languages.${entryLocale}.short`)}</span>
                <strong>{t(`languages.${entryLocale}.label`)}</strong>
                <span>{t(`languages.${entryLocale}.description`)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("settings.aboutGroup")}</div>
          <div className="about-card">{t("settings.aboutText")}</div>
        </div>

        <div className="settings-group">
          <div className="settings-group-title">{t("settings.updaterGroup")}</div>
          <div className="about-card updater-card">
            <div className="updater-row">
              <span className="updater-label">{t("settings.updaterCurrentVersion")}</span>
              <strong>{APP_VERSION}</strong>
            </div>
            <div className="updater-row">
              <span className="updater-label">{t("settings.updaterTargetVersion")}</span>
              <strong>{updateInfo?.version ?? "-"}</strong>
            </div>
            <div className={`updater-note updater-note-${updateStatus}`}>
              {updateStatus === "checking" && t("settings.updaterChecking")}
              {updateStatus === "latest" && t("settings.updaterLatest")}
              {updateStatus === "available" && t("settings.updaterAvailable")}
              {updateStatus === "idle" && t("settings.updaterIdle")}
              {updateStatus === "installing" && t("settings.updaterInstalling")}
              {updateStatus === "installed" && t("settings.updaterInstalled")}
              {updateStatus === "error" &&
                (updateError
                  ? `${t("settings.updaterError")} ${updateError}`
                  : t("settings.updaterUnavailable"))}
            </div>
            <div className="updater-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void handleCheckUpdates();
                }}
              >
                {t("settings.updaterRetry")}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!updateInfo || updateStatus === "installing"}
                onClick={() => {
                  void handleInstallUpdate();
                }}
              >
                {t("settings.updaterInstall")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderPlaceholder = () => (
    <section className="placeholder-panel">
      <div className="placeholder-card">
        <div className="placeholder-badge">{t("common.comingSoon")}</div>
        <h2>{t(getToolLabelKey(activeTool))}</h2>
        <p>{t(getToolDescriptionKey(activeTool))}</p>
      </div>
    </section>
  );

  const showJsonActions = activeTool === "json";

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className={`brand ${collapsed ? "brand-collapsed" : ""}`}>
          <div className="brand-mark">&lt;/&gt;</div>
          {!collapsed && (
            <div>
              <div className="brand-title">{t("app.name")}</div>
              <div className="brand-subtitle">{t("app.subtitle")}</div>
            </div>
          )}
        </div>

        <nav className="nav">
          {menuSections.map((section) => {
            const isDirect = Boolean(section.directTool);
            const isExpanded = expandedSections[section.key];
            const childTools = section.items ?? [];
            const isSectionActive = childTools.some((item) => item.key === activeTool);
            const isDirectActive = section.directTool?.key === activeTool;

            return (
              <section className="menu-section" key={section.key}>
                <button
                  type="button"
                  className={`menu-section-trigger ${
                    isSectionActive || isDirectActive ? "is-active" : ""
                  }`}
                  title={collapsed ? t(section.labelKey) : undefined}
                  onClick={() => {
                    if (collapsed) {
                      setCollapsed(false);
                    }

                    if (isDirect && section.directTool) {
                      selectTool(section.directTool.key);
                      return;
                    }

                    toggleSection(section.key);
                  }}
                >
                  <span className="menu-section-icon">{section.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="menu-section-text">
                        <strong>{t(section.labelKey)}</strong>
                        <span>{t(section.descriptionKey)}</span>
                      </span>
                      {!isDirect && <span className="menu-section-arrow">{isExpanded ? "−" : "+"}</span>}
                    </>
                  )}
                </button>

                {!collapsed && !isDirect && isExpanded && (
                  <div className="submenu">
                    {childTools.map((item) => (
                      <button
                        type="button"
                        key={item.key}
                        className={`submenu-item ${item.key === activeTool ? "is-active" : ""}`}
                        onClick={() => selectTool(item.key)}
                      >
                        <span className="submenu-bullet" />
                        <span className="submenu-copy">
                          <strong>{t(item.labelKey)}</strong>
                          <span>{t(item.descriptionKey)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className={`settings-entry ${activeTool === "settings" ? "is-active" : ""}`}
            onClick={() => selectTool("settings")}
          >
            <span className="settings-entry-icon">设</span>
            {!collapsed && <span>{t("menu.settings.label")}</span>}
          </button>
          <button
            type="button"
            className="collapse-button"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? t("common.expand") : t("common.collapse")}
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{t(getToolLabelKey(activeTool))}</h1>
            <p>{t(getToolDescriptionKey(activeTool))}</p>
          </div>
          {showJsonActions ? (
            <div className="topbar-actions">
              <span className="indent-label">{t("common.indent")}</span>
              {[2, 4].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={`chip ${indent === value ? "is-selected" : ""}`}
                  onClick={() => setIndent(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          ) : (
            <div className="topbar-meta">
              <span>{theme === "dark" ? t("app.topbarThemeDark") : t("app.topbarThemeLight")}</span>
            </div>
          )}
        </header>

        {activeTool === "json" && renderJsonPage()}
        {activeTool === "settings" && renderSettingsPage()}
        {activeTool !== "json" && activeTool !== "settings" && renderPlaceholder()}
      </main>
    </div>
  );
}

export default App;
