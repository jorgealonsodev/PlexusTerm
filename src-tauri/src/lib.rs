mod ai;
mod diag;
mod diaglog;
mod dropdown;
mod git;
mod history;
mod launch;
mod links;
mod localfs;
mod mosh;
mod platform;
mod project;
mod pty;
mod screen_color;
mod secrets;
mod serial;
mod sftp;
mod share;
mod ssh;
mod storage;
mod telnet;
mod terminal;
mod tools;
mod tunnels;
mod updates;
mod usage;
mod zmodem;

use mosh::{MoshLauncher, MoshRequest};
use pty::{PtyError, PtyManager, SpawnRequest};
use secrets::{KeyringStore, SecretError, SharedSecrets};
use serial::{SerialError, SerialManager, SerialRequest};
use sftp::SftpError;
use ssh::{ConnectRequest, PasswordStorage, ProxiedTarget, ShellOptions, SshError, SshManager};
use storage::StorageError;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use telnet::{TelnetError, TelnetManager, TelnetRequest};
use terminal::{TerminalSink, coalesce};
use tunnels::{StatusUpdate, TunnelDefinition, TunnelError, TunnelManager};

/// Events streamed to the frontend for one terminal session.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum TerminalEvent {
    /// First event: the session's share tap, to share it (`share_start`).
    Tap(u64),
    Output(String),
    /// Output of a shared session with its number, in one event so a snapshot never claims output
    /// the pane has not been given yet.
    SharedOutput {
        data: String,
        seq: u64,
    },
    Exit(Option<u32>),
    /// Instead of `Exit`: the connection went away under an SSH session (no exit status,
    /// no close), which the pane reconnects. A live share of the pane ends like on an exit.
    Lost,
    /// A ZMODEM file transfer's offer or progress (see [`zmodem`]).
    Zmodem(zmodem::Notice),
    /// Last event of a window whose tab moves to another one ([`terminal_detach`]): everything
    /// sent before it is the window's, everything after goes to the next window.
    Detached,
}

/// Where a session's events go: the window showing it, or, while its tab moves to another window
/// (between [`terminal_detach`] and [`terminal_attach`]), a queue the next window receives first.
#[derive(Default)]
struct Route {
    state: std::sync::Mutex<RouteState>,
}

#[derive(Default)]
struct RouteState {
    channel: Option<Channel<TerminalEvent>>,
    held: std::collections::VecDeque<TerminalEvent>,
    held_bytes: usize,
    /// The session ended: its exit is sent (or held), and the route leaves the registry once a
    /// window has it.
    ended: bool,
}

/// Output held for a moving tab at most; beyond it the oldest output is dropped (a move takes a
/// moment, a program printing this much meanwhile only loses what scrolled away first).
const HELD_MAX_BYTES: usize = 8 * 1024 * 1024;

fn event_bytes(event: &TerminalEvent) -> usize {
    match event {
        TerminalEvent::Output(text) | TerminalEvent::SharedOutput { data: text, .. } => text.len(),
        _ => 0,
    }
}

impl Route {
    /// Sends `event` to the window, or holds it while none has the session. `Err` when the
    /// window is gone without letting the session go.
    fn send(&self, event: TerminalEvent) -> Result<(), ()> {
        let mut state = self.state.lock().unwrap();
        if let Some(channel) = &state.channel {
            return channel.send(event).map_err(|_| ());
        }
        state.held_bytes += event_bytes(&event);
        state.held.push_back(event);
        while state.held_bytes > HELD_MAX_BYTES {
            let Some(index) = state.held.iter().position(|e| event_bytes(e) > 0) else {
                break;
            };
            let dropped = state
                .held
                .remove(index)
                .map(|e| event_bytes(&e))
                .unwrap_or(0);
            state.held_bytes -= dropped;
        }
        Ok(())
    }
}

impl Route {
    /// Sends (or holds) the session's last event and marks it over, in one step: a move cannot
    /// start between them and take a session that already ended.
    fn end(&self, event: TerminalEvent) -> Result<(), ()> {
        let mut state = self.state.lock().unwrap();
        state.ended = true;
        if let Some(channel) = &state.channel {
            return channel.send(event).map_err(|_| ());
        }
        state.held.push_back(event);
        Ok(())
    }
}

/// The routes of the running sessions, by share tap.
type Routes = std::sync::Mutex<std::collections::HashMap<u64, std::sync::Arc<Route>>>;

fn routes() -> &'static Routes {
    static ROUTES: std::sync::OnceLock<Routes> = std::sync::OnceLock::new();
    ROUTES.get_or_init(Default::default)
}

/// The tab of share tap `tap`'s session leaves its window: from now on its events are held for
/// the window that attaches it next. False when no such session runs.
#[tauri::command]
fn terminal_detach(tap: u64) -> bool {
    let Some(route) = routes().lock().unwrap().get(&tap).cloned() else {
        return false;
    };
    {
        let mut state = route.state.lock().unwrap();
        // Already moving (a second move would wait for a `detached` that never comes), or over.
        if state.ended {
            return false;
        }
        let Some(channel) = state.channel.take() else {
            return false;
        };
        let _ = channel.send(TerminalEvent::Detached);
    }
    diaglog::info(&format!("terminal tap {tap}: detached from its window"));
    true
}

/// A window takes the session of share tap `tap`: it gets the tap, then what was held for it in
/// order, then the session's events as they come. Reading resumes (the new pane pauses it again
/// when it has too much to draw).
#[tauri::command]
fn terminal_attach(tap: u64, on_event: Channel<TerminalEvent>) -> Result<(), String> {
    let route = routes()
        .lock()
        .unwrap()
        .get(&tap)
        .cloned()
        .ok_or_else(|| format!("No terminal session {tap} to attach"))?;
    let ended = {
        let mut state = route.state.lock().unwrap();
        let _ = on_event.send(TerminalEvent::Tap(tap));
        while let Some(event) = state.held.pop_front() {
            let _ = on_event.send(event);
        }
        state.held_bytes = 0;
        state.channel = Some(on_event);
        state.ended
    };
    if ended {
        routes().lock().unwrap().remove(&tap);
    }
    terminal::flow::gates().set_paused(tap, false);
    diaglog::info(&format!("terminal tap {tap}: attached to a window"));
    Ok(())
}

/// Sends a session's events to the webview through a thread that gathers bursts of output
/// (see [`terminal::coalesce`]). Each batch goes through the session's share tap first, so a
/// shared tab's viewers get the output in the order the pane renders it.
///
/// The session's reader waits on its flow gate while the pane asks to pause (`terminal_flow`,
/// keyed by the share tap id it gets first): sending never blocks, so without it a program that
/// prints faster than the terminal parses piles its output up in the webview.
struct ChannelSink {
    tx: std::sync::mpsc::Sender<coalesce::Event>,
    flow: std::sync::Arc<terminal::FlowGate>,
    /// The session's share tap, which names it in the diagnostic log.
    tap: u64,
    /// Set by [`ChannelSink::loss_reporter`]: the exit that follows is sent as `Lost`.
    lost: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// The session's ZMODEM link, which its reader's output goes through (see [`zmodem`]).
    zmodem: Option<std::sync::Arc<std::sync::Mutex<zmodem::Link>>>,
}

impl ChannelSink {
    /// A sink whose session can carry ZMODEM transfers (every kind but Mosh); the session's
    /// writer is given with [`zmodem::set_writer`] once it exists.
    fn with_zmodem(channel: Channel<TerminalEvent>) -> Self {
        let mut sink = Self::new(channel);
        let tx = sink.tx.clone();
        sink.zmodem = Some(zmodem::register(
            sink.tap,
            std::sync::Arc::new(move |out| {
                let _ = tx.send(match out {
                    zmodem::Out::Text(text) => coalesce::Event::Output(text),
                    zmodem::Out::Notice(notice) => coalesce::Event::Zmodem(notice),
                });
            }),
        ));
        sink
    }

    fn new(channel: Channel<TerminalEvent>) -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        let (tap_id, tap) = share::taps().register();
        let flow = std::sync::Arc::new(terminal::FlowGate::new());
        terminal::flow::gates().register(tap_id, &flow);
        let _ = channel.send(TerminalEvent::Tap(tap_id));
        let route = std::sync::Arc::new(Route::default());
        route.state.lock().unwrap().channel = Some(channel);
        routes().lock().unwrap().insert(tap_id, route.clone());
        let gate = flow.clone();
        let lost = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let was_lost = lost.clone();
        std::thread::spawn(move || {
            coalesce::forward(rx, |event| match event {
                coalesce::Event::Output(text) => {
                    diag::mark("S", text.len());
                    let sent = route.send(match tap.output(text.as_bytes()) {
                        Some(seq) => TerminalEvent::SharedOutput { data: text, seq },
                        None => TerminalEvent::Output(text),
                    });
                    // No webview to catch up any more: never hold the reader back again.
                    if sent.is_err() {
                        gate.close();
                    }
                }
                coalesce::Event::Zmodem(notice) => {
                    let _ = route.send(TerminalEvent::Zmodem(notice));
                }
                coalesce::Event::Exit(code) => {
                    gate.close();
                    tap.exited();
                    let _ = route.end(if was_lost.load(std::sync::atomic::Ordering::SeqCst) {
                        TerminalEvent::Lost
                    } else {
                        TerminalEvent::Exit(code)
                    });
                }
            });
            // The session is over, with an exit or without one (a failed connect, a serial port
            // closed): its route goes once a window has its end; while the tab moves, the next
            // window takes it ([`terminal_attach`]).
            let attached = {
                let mut state = route.state.lock().unwrap();
                state.ended = true;
                state.channel.is_some()
            };
            if attached {
                routes().lock().unwrap().remove(&tap_id);
            }
        });
        Self {
            tx,
            flow,
            tap: tap_id,
            lost,
            zmodem: None,
        }
    }

    /// What `SshManager::connect_reporting_loss` calls when the connection is lost, just
    /// before the exit, which then reaches the pane as `Lost`.
    fn loss_reporter(&self) -> impl FnOnce() + Send + 'static {
        let lost = self.lost.clone();
        move || lost.store(true, std::sync::atomic::Ordering::SeqCst)
    }
}

impl TerminalSink for ChannelSink {
    fn data(&self, text: String) {
        let _ = self.tx.send(coalesce::Event::Output(text));
    }
    fn exit(&self, code: Option<u32>) {
        let _ = self.tx.send(coalesce::Event::Exit(code));
    }
    fn flow(&self) -> Option<std::sync::Arc<terminal::FlowGate>> {
        Some(self.flow.clone())
    }
    fn decoder(&self) -> terminal::Decoder {
        match &self.zmodem {
            Some(link) => terminal::Decoder::Zmodem(link.clone()),
            None => terminal::Decoder::default(),
        }
    }
}

impl Drop for ChannelSink {
    /// The session is over (its reader dropped the sink): a transfer still running stops.
    fn drop(&mut self) {
        if self.zmodem.is_some() {
            zmodem::unregister(self.tap);
        }
    }
}

/// Turns ZMODEM detection on or off (Settings → Terminal → ZMODEM transfers).
#[tauri::command]
fn zmodem_enabled(enabled: bool) {
    zmodem::set_enabled(enabled);
}

/// Accepts the receive offer of share tap `tap`'s session: files go into `folder`.
#[tauri::command]
async fn zmodem_receive(tap: u64, folder: String) -> Result<(), String> {
    diaglog::info(&format!("terminal tap {tap}: ZMODEM receive accepted"));
    tauri::async_runtime::spawn_blocking(move || zmodem::receive(tap, folder.into()))
        .await
        .map_err(|e| e.to_string())?
}

/// Accepts the send offer of share tap `tap`'s session: `paths` are sent in order.
#[tauri::command]
async fn zmodem_send(tap: u64, paths: Vec<String>) -> Result<(), String> {
    diaglog::info(&format!(
        "terminal tap {tap}: ZMODEM send of {} file(s) accepted",
        paths.len()
    ));
    let paths = paths.into_iter().map(std::path::PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || zmodem::send(tap, paths))
        .await
        .map_err(|e| e.to_string())?
}

/// Declines the offer of share tap `tap`'s session, or stops its running transfer.
#[tauri::command]
fn zmodem_cancel(tap: u64) -> Result<(), String> {
    zmodem::cancel(tap)
}

/// Tabs handed to the windows opened for them, by window label, until each window takes its own.
#[derive(Default)]
struct Handoffs {
    next: std::sync::atomic::AtomicU32,
    waiting: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

/// Label prefix of the windows a tab is moved to; the main window is "main".
const TAB_WINDOW_PREFIX: &str = "tab-";

/// Opens a new PlexusTerm window for a tab moved out of another one; `handoff` (the tab and its
/// sessions, as the frontend wrote it) waits for the new window ([`window_handoff_take`]).
#[tauri::command]
async fn window_open_tab(
    handoff: String,
    title: Option<String>,
    app: AppHandle,
    handoffs: State<'_, Handoffs>,
) -> Result<(), String> {
    let n = handoffs
        .next
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;
    let label = format!("{TAB_WINDOW_PREFIX}{n}");
    handoffs
        .waiting
        .lock()
        .unwrap()
        .insert(label.clone(), handoff);
    let built =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(title.unwrap_or_else(|| "PlexusTerm".into()))
            .inner_size(1200.0, 760.0)
            .build();
    if let Err(e) = built {
        handoffs.waiting.lock().unwrap().remove(&label);
        diaglog::warn(&format!("window for a moved tab failed to open: {e}"));
        return Err(e.to_string());
    }
    diaglog::info(&format!("window {label} opened for a moved tab"));
    Ok(())
}

/// The tab handed to the calling window, once; None for the main window or a window started
/// without one.
#[tauri::command]
fn window_handoff_take(
    window: tauri::WebviewWindow,
    handoffs: State<'_, Handoffs>,
) -> Option<String> {
    handoffs.waiting.lock().unwrap().remove(window.label())
}

/// Asks a moved tab's window to close its tabs (their sessions end with them) before it goes.
const MOVED_WINDOW_CLOSE_EVENT: &str = "moved-window-close-requested";

#[derive(Debug, PartialEq, Eq)]
enum CloseAction {
    Close,
    /// A moved tab's window: its tabs close first, then it closes itself ([`window_close_self`]),
    /// so no session is left running without a window.
    CloseTabsFirst,
    /// The main window with a live share: the user confirms quitting.
    ConfirmQuit,
}

/// What closing window `label` does; `must_confirm_quit` is asked only for the main window.
fn close_action(label: &str, must_confirm_quit: impl FnOnce() -> bool) -> CloseAction {
    if label.starts_with(TAB_WINDOW_PREFIX) {
        CloseAction::CloseTabsFirst
    } else if must_confirm_quit() {
        CloseAction::ConfirmQuit
    } else {
        CloseAction::Close
    }
}

/// Closes the calling window once its tabs are closed (a moved tab's window).
#[tauri::command]
fn window_close_self(window: tauri::WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with(TAB_WINDOW_PREFIX) {
        return Err("Only a moved tab's window closes itself".into());
    }
    // Destroyed, not closed: closing would ask the window to close its tabs again.
    window.destroy().map_err(|e| e.to_string())
}

/// Pauses (or resumes) reading the session of share tap `tap` while its pane has too much output
/// still to parse. A session already gone is ignored.
#[tauri::command]
fn terminal_flow(tap: u64, paused: bool, pending: Option<u64>) {
    match terminal::flow::gates().set_paused(tap, paused).flatten() {
        Some(terminal::flow::PauseNote::Long(long)) => diaglog::warn(&format!(
            "terminal tap {tap}: output reading paused for {:.0} s, {} KB still to draw",
            long.as_secs_f64(),
            pending.unwrap_or(0) / 1024
        )),
        Some(terminal::flow::PauseNote::Over(long)) => diaglog::info(&format!(
            "terminal tap {tap}: output reading resumed after {:.1} s",
            long.as_secs_f64()
        )),
        None => {}
    }
}

#[tauri::command]
fn pty_spawn(
    request: SpawnRequest,
    on_event: Channel<TerminalEvent>,
    ptys: State<'_, PtyManager>,
    app: AppHandle,
) -> Result<u32, PtyError> {
    let sink = ChannelSink::with_zmodem(on_event);
    let tap = sink.tap;
    let result = ptys.spawn(request, sink);
    match &result {
        Ok(id) => {
            let id = *id;
            zmodem::set_writer(
                tap,
                std::sync::Arc::new(move |bytes: &[u8]| {
                    app.state::<PtyManager>()
                        .write(id, bytes)
                        .map_err(|e| e.to_string())
                }),
            );
            diaglog::info(&format!("local terminal {id} opened (tap {tap})"))
        }
        Err(e) => diaglog::warn(&format!("local terminal failed to open: {e}")),
    }
    result
}

#[tauri::command]
fn pty_write(id: u32, data: String, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.write(id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(id: u32, cols: u16, rows: u16, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.resize(id, cols, rows)
}

/// The git branch of a local folder (short commit when detached), or null outside a repository.
/// Reads the repository files; no `git` process is started.
#[tauri::command]
async fn git_branch(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || git::branch_of(std::path::Path::new(&path)))
        .await
        .ok()
        .flatten()
}

/// The branches the repository of a local folder can switch to (empty outside one).
#[tauri::command]
async fn git_branches(path: String) -> git::Branches {
    tauri::async_runtime::spawn_blocking(move || git::branches_of(std::path::Path::new(&path)))
        .await
        .unwrap_or_default()
}

/// Switches the repository of a local folder to `branch` with `git switch`; git's message when it refuses.
#[tauri::command]
async fn git_switch(path: String, branch: String) -> Result<(), String> {
    diaglog::info(&format!("git switch to {branch} in {path}"));
    let result = tauri::async_runtime::spawn_blocking(move || {
        git::switch_branch(std::path::Path::new(&path), &branch)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(e) = &result {
        diaglog::warn(&format!("git switch failed: {e}"));
    }
    result
}

/// The git branch of a folder on the server of SSH session `id`, read with one `git` command over
/// the existing connection; null outside a repository, without git, or when the command fails.
#[tauri::command]
async fn ssh_git_branch(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<Option<String>, ()> {
    let Some(command) = git::remote_command(&path) else {
        return Ok(None);
    };
    Ok(ssh
        .exec(id, &command)
        .await
        .ok()
        .and_then(|output| git::parse_remote(&output)))
}

/// The git status of the files under a local folder (paths relative to it), for colouring the
/// Explorer like VS Code; empty outside a repository, without git, or when git fails.
/// The repository of a local file or folder: its folder, branch and whether it has changes.
#[tauri::command]
async fn git_repo(path: String) -> Option<git::RepoInfo> {
    tauri::async_runtime::spawn_blocking(move || git::repo_of(std::path::Path::new(&path)))
        .await
        .ok()
        .flatten()
}

/// A local file's text in its repository's last commit, for the viewer's changed lines; null when
/// it is not in one.
#[tauri::command]
async fn git_head_text(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || git::head_text_of(std::path::Path::new(&path)))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn git_status(path: String) -> Vec<git::StatusEntry> {
    tauri::async_runtime::spawn_blocking(move || git::status_of(std::path::Path::new(&path)))
        .await
        .unwrap_or_default()
}

/// The git status of the files under a folder on the server of SSH session `id`, read with one
/// read-only `git` command over the existing connection; empty when it cannot be read.
#[tauri::command]
async fn ssh_git_status(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<Vec<git::StatusEntry>, ()> {
    let Some(command) = git::remote_status_command(&path) else {
        return Ok(Vec::new());
    };
    Ok(ssh
        .exec(id, &command)
        .await
        .map(|output| git::parse_status(output.as_bytes()))
        .unwrap_or_default())
}

/// The working folder of a local terminal's shell, or null when it cannot be read.
#[tauri::command]
async fn pty_cwd(id: u32, ptys: State<'_, PtyManager>) -> Result<Option<String>, PtyError> {
    ptys.cwd(id)
}

/// The working folder of the program in a local terminal's foreground, else of its shell.
#[tauri::command]
async fn pty_program_cwd(id: u32, ptys: State<'_, PtyManager>) -> Result<Option<String>, PtyError> {
    ptys.program_cwd(id)
}

#[tauri::command]
fn pty_close(id: u32, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    diaglog::info(&format!("local terminal {id} closed"));
    ptys.close(id)
}

#[tauri::command]
fn serial_list_ports() -> Vec<String> {
    serial::list_ports()
}

/// Wake On LAN (Tools menu): sends the magic packet for `mac`; the broadcast address and
/// port default to 255.255.255.255 and 9.
#[tauri::command]
async fn wol_send(mac: String, broadcast: Option<String>, port: Option<u16>) -> Result<(), String> {
    let mac = tools::wol::parse_mac(&mac)?;
    let broadcast = match broadcast.as_deref().map(str::trim) {
        None | Some("") => std::net::Ipv4Addr::BROADCAST,
        Some(text) => text
            .parse()
            .map_err(|_| "Broadcast address must be an IPv4 address".to_string())?,
    };
    let port = port.unwrap_or(tools::wol::DEFAULT_PORT);
    if port == 0 {
        return Err("Port must be a number between 1 and 65535".into());
    }
    tools::wol::send(mac, broadcast, port)
        .await
        .map_err(|err| format!("Could not send the packet: {err}"))
}

/// The shells local terminals can run, and the default one (Settings and local sessions list them).
#[tauri::command]
fn shells() -> platform::Shells {
    platform::shells()
}

/// Whether a newer PlexusTerm release is published on GitHub.
#[tauri::command]
async fn update_check() -> Result<updates::UpdateCheck, String> {
    updates::check().await
}

/// Installs only the official asset matching this running installation.
#[tauri::command]
async fn update_install(
    on_progress: Channel<updates::install::Progress>,
) -> Result<updates::install::Outcome, String> {
    updates::install::install(move |progress| {
        on_progress
            .send(progress)
            .map_err(|_| "Update progress channel closed; update cancelled".into())
    })
    .await
}

/// `"linux"`, `"windows"` or `"macos"`, so the frontend can adapt platform-specific texts.
#[tauri::command]
fn platform() -> &'static str {
    platform::name()
}

#[tauri::command]
fn serial_open(
    request: SerialRequest,
    on_event: Channel<TerminalEvent>,
    serial: State<'_, SerialManager>,
    app: AppHandle,
) -> Result<u32, SerialError> {
    let sink = ChannelSink::with_zmodem(on_event);
    let tap = sink.tap;
    let id = serial.open(request, sink)?;
    zmodem::set_writer(
        tap,
        std::sync::Arc::new(move |bytes: &[u8]| {
            app.state::<SerialManager>()
                .write(id, bytes)
                .map_err(|e| e.to_string())
        }),
    );
    Ok(id)
}

#[tauri::command]
fn serial_write(
    id: u32,
    data: String,
    serial: State<'_, SerialManager>,
) -> Result<(), SerialError> {
    serial.write(id, data.as_bytes())
}

#[tauri::command]
fn serial_close(id: u32, serial: State<'_, SerialManager>) -> Result<(), SerialError> {
    serial.close(id)
}

#[tauri::command]
async fn telnet_connect(
    request: TelnetRequest,
    on_event: Channel<TerminalEvent>,
    telnet: State<'_, TelnetManager>,
    app: AppHandle,
) -> Result<u32, TelnetError> {
    let sink = ChannelSink::with_zmodem(on_event);
    let tap = sink.tap;
    let id = telnet.connect(request, sink).await?;
    // Telnet escapes the bytes (IAC, CR) like typed input, both ways.
    zmodem::set_writer(
        tap,
        std::sync::Arc::new(move |bytes: &[u8]| {
            app.state::<TelnetManager>()
                .write(id, bytes)
                .map_err(|e| e.to_string())
        }),
    );
    Ok(id)
}

#[tauri::command]
fn telnet_write(
    id: u32,
    data: String,
    telnet: State<'_, TelnetManager>,
) -> Result<(), TelnetError> {
    telnet.write(id, data.as_bytes())
}

#[tauri::command]
fn telnet_resize(
    id: u32,
    cols: u16,
    rows: u16,
    telnet: State<'_, TelnetManager>,
) -> Result<(), TelnetError> {
    telnet.resize(id, cols, rows)
}

#[tauri::command]
fn telnet_close(id: u32, telnet: State<'_, TelnetManager>) -> Result<(), TelnetError> {
    telnet.close(id)
}

/// Starts `mosh-server` over SSH (login rules and `storage` as for `ssh_connect`) and
/// runs `mosh-client` in a PTY; the returned id is driven with the `pty_*` commands.
#[tauri::command]
async fn mosh_connect(
    request: MoshRequest,
    storage: Option<PasswordStorage>,
    on_event: Channel<TerminalEvent>,
    mosh: State<'_, MoshLauncher>,
    ssh: State<'_, SshManager>,
    ptys: State<'_, PtyManager>,
) -> Result<u32, SshError> {
    mosh.connect(&ssh, &ptys, request, storage, ChannelSink::new(on_event))
        .await
}

/// `storage` saves the typed password in the keyring (or forgets the saved one) once logged in;
/// `options` (absent: none) forwards the agent, keeps the shell in tmux and reaches the server
/// through a proxy command (see `ShellOptions`).
#[tauri::command]
async fn ssh_connect(
    request: ConnectRequest,
    options: Option<ShellOptions>,
    storage: Option<PasswordStorage>,
    on_event: Channel<TerminalEvent>,
    ssh: State<'_, SshManager>,
    app: AppHandle,
) -> Result<u32, SshError> {
    let target = format!("{}@{}:{}", request.username, request.host, request.port);
    let options = options.unwrap_or_default();
    // The command itself is never logged: it may hold a token.
    let via = match options.proxy_command.as_deref().map(str::trim) {
        Some(command) if !command.is_empty() => " through a proxy command",
        _ => "",
    };
    diaglog::info(&format!("ssh connecting to {target}{via}"));
    let sink = ChannelSink::with_zmodem(on_event);
    let tap = sink.tap;
    let on_lost = sink.loss_reporter();
    let result = ssh
        .connect_reporting_loss(request, options, storage, sink, on_lost)
        .await;
    match &result {
        Ok(id) => {
            let id = *id;
            zmodem::set_writer(
                tap,
                std::sync::Arc::new(move |bytes: &[u8]| {
                    app.state::<SshManager>()
                        .write(id, bytes)
                        .map_err(|e| e.to_string())
                }),
            );
            diaglog::info(&format!("ssh session {id} opened to {target}"))
        }
        Err(e) => diaglog::warn(&format!("ssh to {target} failed: {e}")),
    }
    result
}

/// Whether a system keyring (Secret Service) can hold saved passwords.
#[tauri::command]
async fn secret_available(secrets: State<'_, SharedSecrets>) -> Result<bool, ()> {
    Ok(secrets::run(&secrets, |s| Ok(s.available()))
        .await
        .unwrap_or(false))
}

/// Whether a password is saved for the session; the password itself never leaves the backend.
#[tauri::command]
async fn secret_exists(
    session_id: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<bool, SecretError> {
    secrets::run(&secrets, move |s| {
        Ok(s.available() && s.get(&session_id)?.is_some())
    })
    .await
}

#[tauri::command]
async fn secret_delete(
    session_id: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<(), SecretError> {
    secrets::run(&secrets, move |s| s.delete(&session_id)).await
}

#[tauri::command]
fn ssh_write(id: u32, data: String, ssh: State<'_, SshManager>) -> Result<(), SshError> {
    ssh.write(id, data.as_bytes())
}

#[tauri::command]
fn ssh_resize(id: u32, cols: u16, rows: u16, ssh: State<'_, SshManager>) -> Result<(), SshError> {
    ssh.resize(id, cols, rows)
}

/// How long a probed SSH server has to answer before its session counts as lost.
const SSH_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Whether SSH session `id`'s server still answers; one that does not is ended as lost (the
/// pane reconnects it). Asked when the network comes back.
#[tauri::command]
async fn ssh_probe(id: u32, ssh: State<'_, SshManager>) -> Result<bool, SshError> {
    ssh.probe(id, SSH_PROBE_TIMEOUT).await
}

#[tauri::command]
fn ssh_close(
    id: u32,
    ssh: State<'_, SshManager>,
    copies: State<'_, sftp::edit::TempFiles>,
) -> Result<(), SshError> {
    // Temporary copies opened from the SFTP browser go with their session.
    copies.remove(id);
    diaglog::info(&format!("ssh session {id} closed"));
    ssh.close(id)
}

/// The working folder of an SSH session's remote shell, or null when the server cannot tell.
#[tauri::command]
async fn ssh_shell_cwd(id: u32, ssh: State<'_, SshManager>) -> Result<Option<String>, SshError> {
    ssh::cwd::shell_cwd(&ssh, id).await
}

#[tauri::command]
async fn sftp_home(id: u32, ssh: State<'_, SshManager>) -> Result<String, SftpError> {
    sftp::home(&*ssh.sftp(id).await?).await
}

#[tauri::command]
async fn sftp_list(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<Vec<sftp::Entry>, SftpError> {
    sftp::list(&*ssh.sftp(id).await?, &path).await
}

/// A remote file's text (or a folder's listing) to attach to an AI question.
#[tauri::command]
async fn sftp_read_text(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<localfs::TextFile, SftpError> {
    sftp::read_text(&*ssh.sftp(id).await?, &path).await
}

/// A remote image for the Markdown preview, as raw bytes.
#[tauri::command]
async fn sftp_read_image(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<tauri::ipc::Response, SftpError> {
    sftp::read_image(&*ssh.sftp(id).await?, &path)
        .await
        .map(tauri::ipc::Response::new)
}

/// A remote text file for the file viewer.
#[tauri::command]
async fn sftp_view_text(
    id: u32,
    path: String,
    encoding: Option<String>,
    ssh: State<'_, SshManager>,
) -> Result<localfs::TextFile, SftpError> {
    sftp::view_text(&*ssh.sftp(id).await?, &path, encoding.as_deref()).await
}

#[tauri::command]
async fn sftp_download(
    id: u32,
    remote: String,
    local: String,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::download(&*ssh.sftp(id).await?, &remote, local.as_ref()).await
}

/// Returns the remote path of the uploaded file.
#[tauri::command]
async fn sftp_upload(
    id: u32,
    local: String,
    remote_dir: String,
    ssh: State<'_, SshManager>,
) -> Result<String, SftpError> {
    sftp::upload(&*ssh.sftp(id).await?, local.as_ref(), &remote_dir).await
}

#[tauri::command]
async fn sftp_mkdir(id: u32, path: String, ssh: State<'_, SshManager>) -> Result<(), SftpError> {
    sftp::mkdir(&*ssh.sftp(id).await?, &path).await
}

#[tauri::command]
async fn sftp_create_file(
    id: u32,
    path: String,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::create_file(&*ssh.sftp(id).await?, &path).await
}

#[tauri::command]
async fn sftp_remove(
    id: u32,
    path: String,
    is_dir: bool,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::remove(&*ssh.sftp(id).await?, &path, is_dir).await
}

#[tauri::command]
async fn sftp_rename(
    id: u32,
    from: String,
    to: String,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::rename(&*ssh.sftp(id).await?, &from, &to).await
}

/// Moves a remote file or folder into another folder; returns its new path.
#[tauri::command]
async fn sftp_move(
    id: u32,
    from: String,
    dir: String,
    ssh: State<'_, SshManager>,
) -> Result<String, SftpError> {
    sftp::move_into(&*ssh.sftp(id).await?, &from, &dir).await
}

/// Saves the file viewer's text over a remote file that still holds `expected`.
#[tauri::command]
async fn sftp_write_text(
    id: u32,
    path: String,
    expected: String,
    content: String,
    encoding: Option<String>,
    expected_encoding: Option<String>,
    ssh: State<'_, SshManager>,
) -> Result<(), SftpError> {
    sftp::write_text(
        &*ssh.sftp(id).await?,
        &path,
        &expected,
        &content,
        encoding.as_deref(),
        expected_encoding.as_deref(),
    )
    .await
}

const SESSIONS_FILE: &str = "sessions.json";
const TUNNELS_FILE: &str = "tunnels.json";

fn config_path(app: &AppHandle, file: &str) -> Result<std::path::PathBuf, StorageError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| StorageError::Io(err.to_string()))?;
    Ok(dir.join(file))
}

/// Runs file work on the blocking pool, off the main thread where a sync command runs (a slow disk
/// would hold up the window). Only for reads and one-off writes: the `*_save` commands stay sync,
/// because the main thread runs them in the order they were sent and a newer save can never be
/// overwritten by an older one finishing later.
async fn on_disk<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, StorageError> + Send + 'static,
) -> Result<T, StorageError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| StorageError::Io(err.to_string()))?
}

#[tauri::command]
async fn sessions_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, SESSIONS_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn sessions_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, SESSIONS_FILE)?, &contents)
}

/// The tabs open when PlexusTerm last ran, reopened at startup (no passwords: see tabsPersist.ts).
const TABS_STATE_FILE: &str = "tabs.json";

#[tauri::command]
async fn tabs_state_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, TABS_STATE_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn tabs_state_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, TABS_STATE_FILE)?, &contents)
}

/// The named tab sets (copies of the open tabs, without secrets); local to this computer.
const TAB_SETS_FILE: &str = "tab-sets.json";

#[tauri::command]
async fn tab_sets_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, TAB_SETS_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn tab_sets_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, TAB_SETS_FILE)?, &contents)
}

/// When each session and folder last changed or was deleted, for the sync of sessions.
const SESSIONS_SYNC_STATE_FILE: &str = "sessions-sync.json";

#[tauri::command]
async fn sessions_sync_state_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, SESSIONS_SYNC_STATE_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn sessions_sync_state_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, SESSIONS_SYNC_STATE_FILE)?, &contents)
}

/// The sessions file in the folder the user syncs; None when no computer wrote it yet.
#[tauri::command]
async fn sessions_sync_read(folder: String) -> Result<Option<String>, StorageError> {
    on_disk(move || storage::load(&storage::sync_file(&folder)?)).await
}

/// Replaces the sessions file in the synced folder at once (a sync service never sees half of it).
#[tauri::command]
async fn sessions_sync_write(folder: String, contents: String) -> Result<(), StorageError> {
    on_disk(move || storage::save(&storage::sync_file(&folder)?, &contents)).await
}

/// When each shared setting last changed, for the sync of settings.
const SETTINGS_SYNC_STATE_FILE: &str = "settings-sync.json";

#[tauri::command]
async fn settings_sync_state_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, SETTINGS_SYNC_STATE_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn settings_sync_state_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, SETTINGS_SYNC_STATE_FILE)?, &contents)
}

/// The settings file in the folder the user syncs; None when no computer wrote it yet.
#[tauri::command]
async fn settings_sync_read(folder: String) -> Result<Option<String>, StorageError> {
    on_disk(move || {
        storage::load(&storage::sync_file_named(
            &folder,
            storage::SETTINGS_SYNC_FILE,
        )?)
    })
    .await
}

/// Replaces the settings file in the synced folder at once.
#[tauri::command]
async fn settings_sync_write(folder: String, contents: String) -> Result<(), StorageError> {
    on_disk(move || {
        storage::save(
            &storage::sync_file_named(&folder, storage::SETTINGS_SYNC_FILE)?,
            &contents,
        )
    })
    .await
}

/// Upper bound for files picked for import (a sessions .ini file is a few kilobytes).
const IMPORT_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
async fn import_read_file(path: String) -> Result<Vec<u8>, StorageError> {
    on_disk(move || storage::read_bounded(std::path::Path::new(&path), IMPORT_MAX_BYTES)).await
}

#[tauri::command]
async fn tunnels_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, TUNNELS_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn tunnels_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, TUNNELS_FILE)?, &contents)
}

const MACROS_FILE: &str = "macros.json";

#[tauri::command]
async fn macros_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, MACROS_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn macros_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, MACROS_FILE)?, &contents)
}

/// The AI conversations kept after closing PlexusTerm (Settings → AI); a private file.
const AI_CHATS_FILE: &str = "ai-chats.json";

#[tauri::command]
async fn ai_chats_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, AI_CHATS_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn ai_chats_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, AI_CHATS_FILE)?, &contents)
}

const SETTINGS_FILE: &str = "settings.json";

#[tauri::command]
async fn settings_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = config_path(&app, SETTINGS_FILE)?;
    on_disk(move || storage::load(&path)).await
}

#[tauri::command]
fn settings_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    storage::save(&config_path(&app, SETTINGS_FILE)?, &contents)
}

/// Upper bound for terminal output written to a file in one call (saved scrollback or a log batch).
const TEXT_FILE_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// Saves terminal output to a file the user picked in the save dialog.
#[tauri::command]
async fn save_text_file(path: String, contents: String) -> Result<(), StorageError> {
    on_disk(move || {
        storage::write_text(std::path::Path::new(&path), &contents, TEXT_FILE_MAX_BYTES)
    })
    .await
}

/// Appends a batch of session log output to the file the user picked.
#[tauri::command]
async fn append_text_file(path: String, contents: String) -> Result<(), StorageError> {
    // One append at a time (the session log waits for each), so order is kept off the main thread.
    on_disk(move || {
        storage::append_text(std::path::Path::new(&path), &contents, TEXT_FILE_MAX_BYTES)
    })
    .await
}

/// Upper bound for a session recording opened in the player (S6).
const RECORDING_MAX_BYTES: u64 = 100 * 1024 * 1024;

/// Reads an asciicast recording the user picked, for the player.
#[tauri::command]
async fn read_recording_file(path: String) -> Result<String, StorageError> {
    on_disk(move || storage::read_text_bounded(std::path::Path::new(&path), RECORDING_MAX_BYTES))
        .await
}

/// Event carrying every tunnel status change.
const TUNNEL_STATUS_EVENT: &str = "tunnel-status";

/// `target` is the tunnel's saved session, with the typed password or a reference
/// to the saved one, and its proxy command if it has one; `storage` works as for `ssh_connect`.
#[tauri::command]
async fn tunnel_start(
    tunnel: TunnelDefinition,
    target: ProxiedTarget,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    tunnels: State<'_, TunnelManager>,
) -> Result<(), TunnelError> {
    let ProxiedTarget {
        target,
        proxy_command,
    } = target;
    tunnels
        .start_proxied(tunnel, target, proxy_command, trusted_fingerprint, storage)
        .await
}

#[tauri::command]
async fn tunnel_stop(id: String, tunnels: State<'_, TunnelManager>) -> Result<(), ()> {
    tunnels.stop(&id).await;
    Ok(())
}

#[tauri::command]
fn tunnel_statuses(tunnels: State<'_, TunnelManager>) -> Vec<StatusUpdate> {
    tunnels.statuses()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    platform::tune_webkit();
    let secrets: SharedSecrets = std::sync::Arc::new(KeyringStore::default());
    let tunnel_secrets = secrets.clone();
    let launch = launch::LaunchWorkspace::from_args();
    // A workspace file goes to an open PlexusTerm when there is one; this launch then ends.
    if launch.forwarded() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(links::plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Handoffs::default())
        .manage(PtyManager::default())
        .manage(SerialManager::default())
        .manage(TelnetManager::default())
        .manage(MoshLauncher::default())
        .manage(tools::scan::ScanManager::default())
        .manage(sftp::edit::TempFiles::default())
        .manage(SshManager::for_current_user().with_secrets(secrets.clone()))
        .manage(secrets)
        .manage(ai::AiClient::default())
        .manage(share::ShareManager::default())
        .manage(share::watch::Watches::default())
        .manage(launch)
        .manage(dropdown::DropDown::default())
        .setup(move |app| {
            launch::listen(app.handle().clone());
            if let Ok(dir) = app.path().app_config_dir() {
                if let Err(e) = app
                    .state::<PtyManager>()
                    .set_scripts_dir(dir.join("shell-integration"))
                {
                    diaglog::warn(&format!("shell integration scripts not written: {e}"));
                }
                app.state::<share::ShareManager>().set_dir(dir);
            }
            let handle = app.handle().clone();
            app.manage(
                TunnelManager::for_current_user(move |update| {
                    let _ = handle.emit(TUNNEL_STATUS_EVENT, update);
                })
                .with_secrets(tunnel_secrets),
            );
            Ok(())
        })
        // Closing the window with shared tabs asks first ("Stop sharing and quit?").
        .on_window_event(|window, event| {
            // As with a single window, closing the main one quits PlexusTerm: the windows of moved
            // tabs (and their sessions) go with it instead of running on without it.
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                window.app_handle().exit(0);
                return;
            }
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            let label = window.label();
            let confirm = || window.state::<share::ShareManager>().must_confirm_quit();
            match close_action(label, confirm) {
                CloseAction::Close => {}
                CloseAction::CloseTabsFirst => {
                    api.prevent_close();
                    let _ = window.emit_to(label, MOVED_WINDOW_CLOSE_EVENT, ());
                }
                CloseAction::ConfirmQuit => {
                    api.prevent_close();
                    let _ = window.emit_to(label, share::commands::QUIT_REQUESTED_EVENT, ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            terminal_flow,
            terminal_detach,
            terminal_attach,
            window_open_tab,
            window_handoff_take,
            window_close_self,
            zmodem_enabled,
            zmodem_receive,
            zmodem_send,
            zmodem_cancel,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            pty_cwd,
            pty_program_cwd,
            serial_list_ports,
            platform,
            shells,
            update_check,
            update_install,
            serial_open,
            serial_write,
            serial_close,
            telnet_connect,
            telnet_write,
            telnet_resize,
            telnet_close,
            mosh_connect,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_close,
            ssh_probe,
            ssh_shell_cwd,
            ssh_git_branch,
            git_branch,
            ssh_git_status,
            git_status,
            git_head_text,
            git_repo,
            secret_available,
            secret_exists,
            secret_delete,
            sftp_home,
            sftp_list,
            sftp_read_text,
            sftp_view_text,
            sftp_read_image,
            sftp_download,
            sftp_upload,
            sftp_mkdir,
            sftp_create_file,
            sftp_remove,
            sftp_rename,
            sftp_move,
            sftp_write_text,
            sessions_load,
            sessions_save,
            tabs_state_load,
            tabs_state_save,
            tab_sets_load,
            tab_sets_save,
            sessions_sync_state_load,
            sessions_sync_state_save,
            sessions_sync_read,
            sessions_sync_write,
            settings_sync_state_load,
            settings_sync_state_save,
            settings_sync_read,
            settings_sync_write,
            import_read_file,
            tunnels_load,
            tunnels_save,
            tunnel_start,
            tunnel_stop,
            tunnel_statuses,
            settings_load,
            settings_save,
            macros_load,
            macros_save,
            ai_chats_load,
            ai_chats_save,
            save_text_file,
            append_text_file,
            read_recording_file,
            wol_send,
            history::history_load,
            history::history_save,
            ai::ai_key_status,
            ai::ai_key_save,
            ai::ai_key_delete,
            ai::usage_key_status,
            ai::usage_key_save,
            ai::usage_key_delete,
            ai::ai_complete,
            ai::ai_assist,
            ai::ai_opencode_models,
            ai::ai_opencode_go_usage,
            usage::usage_claude,
            usage::usage_codex,
            usage::usage_agy,
            ai::models::ai_models,
            tools::keygen::keygen_generate,
            tools::keygen::keygen_save,
            tools::keygen::keygen_install,
            tools::keygen::keygen_discard,
            tools::keygen::keygen_load,
            tools::keygen::keygen_update,
            tools::keygen::keygen_save_public,
            tools::keygen::keygen_save_private,
            tools::keygen::keygen_export_ppk,
            tools::scan::scan_ports,
            tools::scan::scan_network,
            tools::scan::scan_stop,
            tools::monitor::monitor_sample,
            sftp::commands::sftp_chmod,
            sftp::commands::sftp_edit,
            sftp::commands::sftp_edit_upload,
            sftp::commands::sftp_compare,
            sftp::commands::sftp_discard_copies,
            localfs::local_home,
            localfs::local_list,
            localfs::local_stat,
            localfs::local_mkdir,
            localfs::local_create_file,
            localfs::local_rename,
            localfs::local_remove,
            localfs::local_chmod,
            localfs::local_open,
            localfs::local_read_text,
            localfs::local_view_text,
            localfs::local_read_image,
            diag::diag_latency_log,
            git_branches,
            git_switch,
            diaglog::diag_log_configure,
            diaglog::diag_log_default_dir,
            diaglog::diag_heartbeat,
            diaglog::diag_log,
            localfs::local_write_text,
            localfs::local_move,
            localfs::local_copy,
            project::project_colors_get,
            project::project_color_set,
            screen_color::screen_color_pick,
            launch::launch_workspace_take,
            launch::launch_folder_take,
            share::commands::share_start,
            share::commands::share_command,
            share::commands::share_quit,
            share::commands::share_crashed,
            share::commands::share_audit_log,
            share::commands::share_token_status,
            share::commands::share_token_save,
            share::commands::share_token_delete,
            share::commands::share_build_hash,
            share::commands::view_resolve,
            share::commands::view_start,
            share::commands::view_input,
            share::commands::view_close,
            dropdown::dropdown_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tauri::ipc::InvokeResponseBody;

    /// A sink whose events arrive, as the JSON the webview gets, on the returned receiver.
    fn sink() -> (ChannelSink, std::sync::mpsc::Receiver<String>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                let _ = tx.send(json);
            }
            Ok(())
        });
        (ChannelSink::new(channel), rx)
    }

    /// The last event sent, once the sink's thread ended (it ends after the exit).
    fn last_event(rx: std::sync::mpsc::Receiver<String>) -> String {
        let mut last = String::new();
        while let Ok(json) = rx.recv_timeout(Duration::from_secs(5)) {
            last = json;
        }
        last
    }

    #[test]
    fn a_lost_connection_reaches_the_pane_as_lost() {
        let (sink, rx) = sink();
        sink.data("output".into());
        (sink.loss_reporter())();
        sink.exit(None);
        drop(sink);
        assert_eq!(last_event(rx), r#"{"event":"lost"}"#);
    }

    #[test]
    fn a_transfer_offer_reaches_the_pane_after_the_output_before_it() {
        let (tx, rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                let _ = tx.send(json);
            }
            Ok(())
        });
        zmodem::set_enabled(true);
        let sink = ChannelSink::with_zmodem(channel);
        let mut decoder = sink.decoder();
        // What `sz` prints first: "rz", then ZRQINIT.
        let text = decoder.push(b"rz\r**\x18B00000000000000\r\x8a\x11");
        assert_eq!(text, "");
        sink.exit(Some(0));
        drop(decoder);
        drop(sink);
        let mut events = Vec::new();
        while let Ok(json) = rx.recv_timeout(Duration::from_secs(5)) {
            events.push(json);
        }
        assert_eq!(
            events[1..],
            [
                r#"{"event":"output","data":"rz\r"}"#.to_string(),
                r#"{"event":"zmodem","data":{"phase":"offer","direction":"receive"}}"#.to_string(),
                r#"{"event":"exit","data":0}"#.to_string(),
            ]
        );
    }

    /// A channel whose events arrive, as JSON, on the returned receiver.
    fn channel() -> (Channel<TerminalEvent>, std::sync::mpsc::Receiver<String>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                let _ = tx.send(json);
            }
            Ok(())
        });
        (channel, rx)
    }

    /// The text of the output events among `events`, joined (bursts may be gathered).
    fn output_of(events: &[String]) -> String {
        events
            .iter()
            .filter_map(|json| serde_json::from_str::<serde_json::Value>(json).ok())
            .filter(|v| v["event"] == "output")
            .map(|v| v["data"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    fn drain(rx: &std::sync::mpsc::Receiver<String>) -> Vec<String> {
        let mut events = Vec::new();
        while let Ok(json) = rx.recv_timeout(Duration::from_millis(500)) {
            events.push(json);
        }
        events
    }

    #[test]
    fn output_while_detached_is_held_and_reaches_the_window_attached_next_in_order() {
        let (sink, old) = sink();
        let tap = sink.tap;
        sink.data("a".into());
        // The first window drew "a" before the tab left it.
        while !output_of(&[old.recv_timeout(Duration::from_secs(5)).unwrap()]).contains('a') {}
        assert!(terminal_detach(tap));
        sink.data("b".into());
        sink.data("c".into());
        let (next, new) = channel();
        terminal_attach(tap, next).unwrap();
        sink.data("d".into());
        sink.exit(Some(0));
        drop(sink);
        let events = drain(&new);
        assert_eq!(
            events.first().map(String::as_str),
            Some(format!(r#"{{"event":"tap","data":{tap}}}"#).as_str())
        );
        assert_eq!(output_of(&events), "bcd");
        assert_eq!(
            events.last().map(String::as_str),
            Some(r#"{"event":"exit","data":0}"#)
        );
        // The first window got the end of its stream, then nothing more.
        let rest = drain(&old);
        assert_eq!(output_of(&rest), "");
        assert_eq!(
            rest.last().map(String::as_str),
            Some(r#"{"event":"detached"}"#)
        );
    }

    #[test]
    fn an_exit_while_detached_reaches_the_window_attached_next() {
        let (sink, _old) = sink();
        let tap = sink.tap;
        assert!(terminal_detach(tap));
        sink.data("bye".into());
        sink.exit(Some(2));
        drop(sink);
        std::thread::sleep(Duration::from_millis(200));
        let (next, new) = channel();
        terminal_attach(tap, next).unwrap();
        let events = drain(&new);
        assert_eq!(output_of(&events), "bye");
        assert_eq!(
            events.last().map(String::as_str),
            Some(r#"{"event":"exit","data":2}"#)
        );
        // Delivered: the session is gone and cannot be attached again.
        assert!(terminal_attach(tap, channel().0).is_err());
    }

    #[test]
    fn a_session_that_is_not_running_cannot_be_detached_or_attached() {
        assert!(!terminal_detach(u64::MAX));
        assert!(terminal_attach(u64::MAX, channel().0).is_err());
    }

    #[test]
    fn many_outputs_racing_repeated_moves_are_neither_lost_nor_duplicated() {
        let (sink, first) = sink();
        let tap = sink.tap;
        let sink = std::sync::Arc::new(sink);
        let writer = {
            let sink = sink.clone();
            std::thread::spawn(move || {
                for i in 0..20000 {
                    sink.data(format!("{i},"));
                }
            })
        };
        let mut receivers = vec![first];
        for _ in 0..50 {
            std::thread::sleep(Duration::from_micros(300));
            assert!(terminal_detach(tap));
            let (next, rx) = channel();
            terminal_attach(tap, next).unwrap();
            receivers.push(rx);
        }
        writer.join().unwrap();
        sink.exit(Some(0));
        drop(sink);
        let mut all = String::new();
        let n = receivers.len();
        for (k, rx) in receivers.iter().enumerate() {
            let events = drain(rx);
            all.push_str(&output_of(&events));
            if k + 1 < n {
                assert_eq!(
                    events.last().map(String::as_str),
                    Some(r#"{"event":"detached"}"#),
                    "window {k}"
                );
            } else {
                assert_eq!(
                    events.last().map(String::as_str),
                    Some(r#"{"event":"exit","data":0}"#)
                );
            }
        }
        let expected: String = (0..20000).map(|i| format!("{i},")).collect();
        assert_eq!(all.len(), expected.len());
        assert!(
            all == expected,
            "output lost, duplicated or reordered across moves"
        );
        assert!(
            !routes().lock().unwrap().contains_key(&tap),
            "route left after exit"
        );
    }

    #[test]
    fn a_session_whose_sink_drops_without_an_exit_leaves_no_route_behind() {
        // A failed connect (ssh/pty/serial/telnet) or a serial port closed by the user drops the
        // sink without an exit event: at baseline the channel went away with the thread.
        let (sink, _rx) = sink();
        let tap = sink.tap;
        drop(sink);
        std::thread::sleep(Duration::from_millis(300));
        assert!(
            !routes().lock().unwrap().contains_key(&tap),
            "route of tap {tap} leaked"
        );
    }

    #[test]
    fn held_output_is_capped_at_8_mib_keeping_the_newest() {
        let (sink, _old) = sink();
        let tap = sink.tap;
        assert!(terminal_detach(tap));
        let chunk = "x".repeat(64 * 1024);
        for _ in 0..(9 * 16) {
            sink.data(chunk.clone());
        }
        sink.data("END".into());
        std::thread::sleep(Duration::from_millis(500));
        let (next, rx) = channel();
        terminal_attach(tap, next).unwrap();
        sink.exit(Some(0));
        drop(sink);
        let out = output_of(&drain(&rx));
        assert!(out.len() <= HELD_MAX_BYTES, "held {} bytes", out.len());
        assert!(out.ends_with("END"));
    }

    #[test]
    fn a_session_already_detached_cannot_be_detached_again() {
        let (sink, _old) = sink();
        let tap = sink.tap;
        assert!(terminal_detach(tap));
        // A second move would wait for a `detached` that never comes.
        assert!(!terminal_detach(tap));
        terminal_attach(tap, channel().0).unwrap();
        assert!(terminal_detach(tap));
    }

    #[test]
    fn a_moved_tabs_window_closes_its_tabs_first_and_only_the_main_window_confirms_a_share() {
        assert_eq!(
            close_action("tab-3", || panic!("never asked")),
            CloseAction::CloseTabsFirst
        );
        assert_eq!(close_action("main", || true), CloseAction::ConfirmQuit);
        assert_eq!(close_action("main", || false), CloseAction::Close);
    }

    #[test]
    fn an_exit_still_reaches_the_pane_as_exit() {
        let (sink, rx) = sink();
        let _unused = sink.loss_reporter();
        sink.exit(Some(3));
        drop(sink);
        assert_eq!(last_event(rx), r#"{"event":"exit","data":3}"#);
    }
}
