import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import packageJson from "../package.json";
import { getToolDescriptionKey, getToolLabelKey, menuSections, type SectionKey, type ToolKey } from "./config/menu";
import { locales as supportedLocales } from "./i18n/config";
import { useI18n } from "./i18n/I18nProvider";
import { SshPage } from "./tools/ssh/SshPage";
import { TodoPage } from "./tools/todo/TodoPage";
import { CmdsPage } from "./tools/cmds/CmdsPage";
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
type UpdateInfo = NonNullable<Awaited<ReturnType<typeof check>>>;

const THEME_STORAGE_KEY = "littletool-theme";
const APP_VERSION = packageJson.version;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
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
const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Africa/Abidjan",
] as const;

function getSupportedTimezones() {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };

  if (typeof intlWithSupportedValues.supportedValuesOf === "function") {
    return intlWithSupportedValues.supportedValuesOf("timeZone");
  }

  return [...FALLBACK_TIMEZONES];
}

function formatDateTime(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  return formatter.format(date).replace(" ", " ");
}

function getZoneOffsetLabel(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date);

  return parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";
}

function getDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const getValue = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: getValue("year"),
    month: getValue("month"),
    day: getValue("day"),
    hour: getValue("hour"),
    minute: getValue("minute"),
    second: getValue("second"),
  };
}

function parseDateTimeInput(value: string) {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const parsed = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };

  if (
    parsed.month < 1 ||
    parsed.month > 12 ||
    parsed.day < 1 ||
    parsed.day > 31 ||
    parsed.hour > 23 ||
    parsed.minute > 59 ||
    parsed.second > 59
  ) {
    return null;
  }

  return parsed;
}

function zonedDateTimeToTimestamp(value: string, timeZone: string) {
  const parsed = parseDateTimeInput(value);

  if (!parsed) {
    return null;
  }

  const utcGuess = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
  );

  const guessDate = new Date(utcGuess);
  const zonedParts = getDateTimeParts(guessDate, timeZone);
  const desiredLocalMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
  );
  const guessedLocalMs = Date.UTC(
    zonedParts.year,
    zonedParts.month - 1,
    zonedParts.day,
    zonedParts.hour,
    zonedParts.minute,
    zonedParts.second,
  );

  const timestampMs = utcGuess + (desiredLocalMs - guessedLocalMs);
  const verified = getDateTimeParts(new Date(timestampMs), timeZone);

  if (
    verified.year !== parsed.year ||
    verified.month !== parsed.month ||
    verified.day !== parsed.day ||
    verified.hour !== parsed.hour ||
    verified.minute !== parsed.minute ||
    verified.second !== parsed.second
  ) {
    return null;
  }

  return timestampMs;
}

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
  const [timestampCopied, setTimestampCopied] = useState<"" | "datetime" | "timestamp">("");
  const [timestampInput, setTimestampInput] = useState("1783580932");
  const [timestampUnit, setTimestampUnit] = useState<"s" | "ms">("s");
  const [selectedTimezone, setSelectedTimezone] = useState(DEFAULT_TIMEZONE);
  const [convertedTime, setConvertedTime] = useState("2026-07-09 07:08:52");
  const [timestampError, setTimestampError] = useState("");
  const [dateTimeInput, setDateTimeInput] = useState("2026-07-09 15:08:52");
  const [reverseUnit, setReverseUnit] = useState<"s" | "ms">("s");
  const [convertedTimestamp, setConvertedTimestamp] = useState("1783570932");
  const [dateTimeError, setDateTimeError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateError, setUpdateError] = useState("");
  const [timezones] = useState<string[]>(() => getSupportedTimezones());
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
    if (!timestampCopied) {
      return;
    }

    const timer = window.setTimeout(() => setTimestampCopied(""), 2000);
    return () => window.clearTimeout(timer);
  }, [timestampCopied]);

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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
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

  const handleCopyText = async (value: string, target: "datetime" | "timestamp") => {
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setTimestampCopied(target);
  };

  const handleTimestampConvert = () => {
    const normalized = timestampInput.trim();

    if (!normalized) {
      setConvertedTime("");
      setTimestampError(t("timestamp.emptyError"));
      return;
    }

    if (!/^-?\d+$/.test(normalized)) {
      setConvertedTime("");
      setTimestampError(t("timestamp.invalidError"));
      return;
    }

    const rawValue = Number(normalized);
    const timestampValue = timestampUnit === "s" ? rawValue * 1000 : rawValue;
    const date = new Date(timestampValue);

    if (Number.isNaN(date.getTime())) {
      setConvertedTime("");
      setTimestampError(t("timestamp.rangeError"));
      return;
    }

    try {
      setConvertedTime(formatDateTime(date, selectedTimezone));
      setTimestampError("");
    } catch {
      setConvertedTime("");
      setTimestampError(t("timestamp.timezoneError"));
    }
  };

  const handleDateTimeConvert = () => {
    const normalized = dateTimeInput.trim();

    if (!normalized) {
      setConvertedTimestamp("");
      setDateTimeError(t("timestamp.reverseEmptyError"));
      return;
    }

    const timestampMs = zonedDateTimeToTimestamp(normalized, selectedTimezone);

    if (timestampMs === null || Number.isNaN(timestampMs)) {
      setConvertedTimestamp("");
      setDateTimeError(t("timestamp.reverseInvalidError"));
      return;
    }

    setConvertedTimestamp(
      reverseUnit === "ms" ? String(timestampMs) : String(Math.floor(timestampMs / 1000)),
    );
    setDateTimeError("");
  };

  const handleFillCurrentDateTime = () => {
    const current = formatDateTime(now, selectedTimezone);
    setDateTimeInput(current);
    setDateTimeError("");
  };

  useEffect(() => {
    handleTimestampConvert();
    handleDateTimeConvert();
  }, [selectedTimezone, reverseUnit]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const renderTimestampPage = () => (
    <section className="timestamp-page">
      <div className="timestamp-layout">
        <div className="timestamp-now-card">
          <div className="timestamp-result-label">{t("timestamp.referenceNow")}</div>
          <strong>{formatDateTime(now, localTimezone)}</strong>
          <span className="timestamp-offset">
            {localTimezone} · {getZoneOffsetLabel(now, localTimezone)}
          </span>
        </div>

        <div className="timestamp-card">
          <div className="timestamp-card-title">{t("timestamp.forwardTitle")}</div>
          <div className="timestamp-grid timestamp-grid-forward">
            <div className="timestamp-field">
              <label htmlFor="timestamp-input">{t("timestamp.inputLabel")}</label>
              <input
                id="timestamp-input"
                className="timestamp-input"
                value={timestampInput}
                placeholder={t("timestamp.inputPlaceholder")}
                onChange={(event) => {
                  setTimestampInput(event.target.value);
                  setTimestampError("");
                }}
              />
            </div>

            <div className="timestamp-field">
              <label htmlFor="timestamp-unit">{t("timestamp.unitLabel")}</label>
              <select
                id="timestamp-unit"
                className="timestamp-select"
                value={timestampUnit}
                onChange={(event) => setTimestampUnit(event.target.value as "s" | "ms")}
              >
                <option value="s">{t("timestamp.unitSeconds")}</option>
                <option value="ms">{t("timestamp.unitMilliseconds")}</option>
              </select>
            </div>

            <button type="button" className="primary-button timestamp-convert-button" onClick={handleTimestampConvert}>
              {t("timestamp.convertAction")}
            </button>

            <div className="timestamp-field">
              <label htmlFor="timestamp-output">{t("timestamp.resultLabel")}</label>
              <div className="timestamp-result-input-group">
                <input id="timestamp-output" className="timestamp-input" value={convertedTime} readOnly />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void handleCopyText(convertedTime, "datetime");
                  }}
                  disabled={!convertedTime}
                >
                  {timestampCopied === "datetime" ? t("common.copied") : t("common.copy")}
                </button>
              </div>
            </div>

            <div className="timestamp-field">
              <label htmlFor="timestamp-timezone">{t("timestamp.timezoneLabel")}</label>
              <select
                id="timestamp-timezone"
                className="timestamp-select"
                value={selectedTimezone}
                onChange={(event) => setSelectedTimezone(event.target.value)}
              >
                {timezones.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`timestamp-message ${timestampError ? "is-error" : ""}`}>
            {timestampError || `${selectedTimezone} · ${getZoneOffsetLabel(now, selectedTimezone)}`}
          </div>
        </div>

        <div className="timestamp-card">
          <div className="timestamp-card-title">{t("timestamp.reverseTitle")}</div>
          <div className="timestamp-grid timestamp-grid-reverse">
            <button
              type="button"
              className="secondary-button timestamp-now-button"
              onClick={handleFillCurrentDateTime}
            >
              {t("timestamp.fillNowAction")}
            </button>

            <div className="timestamp-field">
              <label htmlFor="datetime-input">{t("timestamp.reverseInputLabel")}</label>
              <input
                id="datetime-input"
                className="timestamp-input"
                value={dateTimeInput}
                placeholder={t("timestamp.reverseInputPlaceholder")}
                onChange={(event) => {
                  setDateTimeInput(event.target.value);
                  setDateTimeError("");
                }}
              />
            </div>

            <button
              type="button"
              className="primary-button timestamp-convert-button"
              onClick={handleDateTimeConvert}
            >
              {t("timestamp.convertAction")}
            </button>

            <div className="timestamp-field">
              <label htmlFor="reverse-unit">{t("timestamp.unitLabel")}</label>
              <select
                id="reverse-unit"
                className="timestamp-select"
                value={reverseUnit}
                onChange={(event) => setReverseUnit(event.target.value as "s" | "ms")}
              >
                <option value="s">{t("timestamp.unitSeconds")}</option>
                <option value="ms">{t("timestamp.unitMilliseconds")}</option>
              </select>
            </div>

            <div className="timestamp-field">
              <label htmlFor="reverse-output">{t("timestamp.reverseTimestampLabel")}</label>
              <div className="timestamp-result-input-group">
                <input id="reverse-output" className="timestamp-input" value={convertedTimestamp} readOnly />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void handleCopyText(convertedTimestamp, "timestamp");
                  }}
                  disabled={!convertedTimestamp}
                >
                  {timestampCopied === "timestamp" ? t("common.copied") : t("common.copy")}
                </button>
              </div>
            </div>

            <div className="timestamp-field">
              <label htmlFor="reverse-timezone">{t("timestamp.timezoneLabel")}</label>
              <select
                id="reverse-timezone"
                className="timestamp-select"
                value={selectedTimezone}
                onChange={(event) => setSelectedTimezone(event.target.value)}
              >
                {timezones.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={`timestamp-message ${dateTimeError ? "is-error" : ""}`}>
            {dateTimeError || `${selectedTimezone} · ${getZoneOffsetLabel(now, selectedTimezone)}`}
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
        {activeTool === "timestamp" && renderTimestampPage()}
        {activeTool === "ssh" && <SshPage themeMode={theme} />}
        {activeTool === "todo" && <TodoPage />}
        {activeTool === "cmds" && <CmdsPage />}
        {activeTool === "settings" && renderSettingsPage()}
        {activeTool !== "json" &&
          activeTool !== "timestamp" &&
          activeTool !== "ssh" &&
          activeTool !== "todo" &&
          activeTool !== "cmds" &&
          activeTool !== "settings" &&
          renderPlaceholder()}
      </main>
    </div>
  );
}

export default App;






