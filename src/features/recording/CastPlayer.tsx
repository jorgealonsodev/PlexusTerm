import { useEffect, useRef, useState } from "react";
import { Terminal, type FontWeight } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Pause, Play, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useT } from "../../i18n/i18n";
import { boldWeight, cssFontFamily, DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import { themeById } from "../terminal/themes";
import { CastError, createCastPlayer, formatTime, parseCast, type Cast, type CastPlayer as Player } from "./cast";

/** The speeds offered, as times the recorded pace. */
export const SPEEDS = [1, 2, 4] as const;
/** How often the time and the progress bar follow the playback, in milliseconds. */
const PROGRESS_MS = 200;

interface CastPlayerProps {
  /** The `.cast` file, for its name. */
  path: string;
  /** Reads the file's text. */
  load: () => Promise<string>;
  settings?: TerminalSettings;
  onClose: () => void;
}

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; cast: Cast };

const basename = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * A read-only pane that plays an asciicast v2 recording (S6) in a terminal of the recorded size:
 * play/pause, speed, a progress bar to seek with and the time. Nothing typed reaches anything, and
 * what the recording prints cannot answer back or open links.
 */
export function CastPlayer({ path, load, settings = DEFAULT_SETTINGS, onClose }: CastPlayerProps) {
  const t = useT();
  const name = basename(path);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    let live = true;
    load().then(
      (text) => {
        if (!live) return;
        try {
          setLoaded({ state: "ok", cast: parseCast(text) });
        } catch (err) {
          const error = err instanceof CastError ? err.message : String(err);
          setLoaded({ state: "error", message: t("terminal.player.malformed", { error }) });
        }
      },
      (err) => {
        if (live) setLoaded({ state: "error", message: t("terminal.player.readError", { error: String(err) }) });
      },
    );
    return () => {
      live = false;
    };
    // The pane is remounted for another file (its key changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cast = loaded.state === "ok" ? loaded.cast : null;
  useEffect(() => {
    const host = hostRef.current;
    if (!cast || !host) return;
    const term = new Terminal({
      cols: cast.width,
      rows: cast.height,
      disableStdin: true,
      cursorBlink: false,
      fontFamily: cssFontFamily(settings.fontFamily),
      fontSize: settings.fontSize,
      fontWeight: settings.fontWeight as FontWeight,
      fontWeightBold: boldWeight(settings.fontWeight) as FontWeight,
      lineHeight: settings.lineHeight,
      scrollback: 10000,
      theme: themeById(settings.theme).theme,
      // A recording's hyperlinks (OSC 8) are not opened: the file may come from anywhere.
      linkHandler: { activate: () => {} },
      // Unicode11Addon and `term.unicode` are proposed API.
      allowProposedApi: true,
    });
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);
    const player = createCastPlayer(cast, {
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      reset: () => term.reset(),
      onChange: () => {
        setPlaying(player.playing());
        setPosition(player.position());
      },
    });
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
      term.dispose();
    };
    // Settings apply to the next recording opened; this one keeps its look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setPosition(playerRef.current?.position() ?? 0), PROGRESS_MS);
    return () => clearInterval(timer);
  }, [playing]);

  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.playing()) player.pause();
    else player.play();
  };
  const chooseSpeed = (value: number) => {
    setSpeed(value);
    playerRef.current?.setSpeed(value);
  };
  const seek = (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seek(seconds);
    setPosition(player.position());
  };

  return (
    <section className="viewer cast-player" aria-label={t("terminal.player.label")}>
      <header className="viewer__header">
        <h2 className="viewer__name" title={path}>
          {name}
        </h2>
        <button
          type="button"
          className="viewer__close"
          aria-label={t("terminal.player.close")}
          title={t("terminal.player.close")}
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      {loaded.state === "loading" && <p className="sidebar__note">{t("terminal.player.loading")}</p>}
      {loaded.state === "error" && (
        <p className="sidebar__note form-error" role="alert">
          {loaded.message}
        </p>
      )}
      {cast && (
        <>
          <div className="cast-player__screen" style={{ background: themeById(settings.theme).theme.background }}>
            <div className="cast-player__host" ref={hostRef} />
          </div>
          <div className="pane-footer cast-player__controls" role="toolbar" aria-label={t("terminal.player.label")}>
            <button
              type="button"
              className="viewer__close cast-player__play"
              aria-label={playing ? t("terminal.player.pause") : t("terminal.player.play")}
              title={playing ? t("terminal.player.pause") : t("terminal.player.play")}
              onClick={toggle}
            >
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </button>
            <input
              type="range"
              className="cast-player__progress"
              aria-label={t("terminal.player.position")}
              min={0}
              max={cast.duration}
              step="any"
              value={Math.min(position, cast.duration)}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span className="cast-player__time">
              {formatTime(position)} / {formatTime(cast.duration)}
            </span>
            <div className="viewer__modes cast-player__speeds" role="radiogroup" aria-label={t("terminal.player.speed")}>
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={speed === value}
                  className={`viewer__mode${speed === value ? " viewer__mode--on" : ""}`}
                  onClick={() => chooseSpeed(value)}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
