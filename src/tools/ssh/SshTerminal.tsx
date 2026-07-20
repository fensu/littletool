import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { SshOutputEvent, SshSessionSnapshot } from "./types";

type SshTerminalProps = {
  connectionId: number;
  active: boolean;
  connected: boolean;
  themeMode: "dark" | "light";
};

export function SshTerminal({ connectionId, active, connected, themeMode }: SshTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const connectedRef = useRef(connected);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: UnlistenFn | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frame = 0;

    if (!containerRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme:
        themeMode === "dark"
          ? {
              background: "#0b1220",
              foreground: "#e6edf7",
              cursor: "#7dd3fc",
              selectionBackground: "rgba(125, 211, 252, 0.28)",
            }
          : {
              background: "#111827",
              foreground: "#f8fafc",
              cursor: "#38bdf8",
              selectionBackground: "rgba(56, 189, 248, 0.28)",
            },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;

    const writeStdin = (data: string) => {
      if (!connectedRef.current) {
        return;
      }
      void invoke("write_ssh_stdin", {
        payload: {
          connectionId,
          data,
        },
      }).catch(() => {
        // Session may have disconnected while typing.
      });
    };

    const dataDisposable = term.onData((data) => {
      writeStdin(data);
    });

    const binaryDisposable = term.onBinary((data) => {
      writeStdin(data);
    });

    const resizePty = () => {
      if (!fitRef.current || !termRef.current) {
        return;
      }
      try {
        fitRef.current.fit();
      } catch {
        return;
      }
      const { cols, rows } = termRef.current;
      if (!connectedRef.current || cols < 2 || rows < 1) {
        return;
      }
      void invoke("resize_ssh_pty", {
        payload: {
          connectionId,
          cols,
          rows,
        },
      }).catch(() => {
        // Ignore resize failures during reconnect/disconnect.
      });
    };

    frame = window.requestAnimationFrame(() => {
      resizePty();
    });

    resizeObserver = new ResizeObserver(() => {
      resizePty();
    });
    resizeObserver.observe(containerRef.current);

    void (async () => {
      try {
        const snapshots = await invoke<SshSessionSnapshot[]>("list_ssh_session_snapshots");
        if (disposed || !termRef.current) {
          return;
        }
        const snapshot = snapshots.find((item) => item.connectionId === connectionId);
        if (snapshot?.output) {
          termRef.current.write(snapshot.output);
        }
      } catch {
        // Keep empty terminal if history load fails.
      }

      if (disposed) {
        return;
      }

      try {
        unlistenOutput = await listen<SshOutputEvent>("ssh-output", (event) => {
          if (event.payload.connectionId !== connectionId || !termRef.current) {
            return;
          }
          termRef.current.write(event.payload.data);
        });
      } catch {
        // Event bridge unavailable outside Tauri runtime.
      }
    })();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      dataDisposable.dispose();
      binaryDisposable.dispose();
      if (unlistenOutput) {
        unlistenOutput();
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [connectionId, themeMode]);

  useEffect(() => {
    if (!active || !fitRef.current || !termRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        termRef.current?.focus();
      } catch {
        // Terminal may be mid-dispose.
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [active, connected]);

  return (
    <div
      className={`ssh-terminal-host ${active ? "is-active" : "is-hidden"}`}
      ref={containerRef}
      data-connection-id={connectionId}
    />
  );
}
