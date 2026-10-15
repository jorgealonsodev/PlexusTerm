mod pty;

use pty::{PtyError, PtyManager, PtySink, SpawnRequest};
use tauri::State;
use tauri::ipc::Channel;

/// Events streamed to the frontend for one terminal session.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum PtyEvent {
    Output(String),
    Exit(Option<u32>),
}

struct ChannelSink(Channel<PtyEvent>);

impl PtySink for ChannelSink {
    fn data(&self, text: String) {
        let _ = self.0.send(PtyEvent::Output(text));
    }
    fn exit(&self, code: Option<u32>) {
        let _ = self.0.send(PtyEvent::Exit(code));
    }
}

#[tauri::command]
fn pty_spawn(
    request: SpawnRequest,
    on_event: Channel<PtyEvent>,
    ptys: State<'_, PtyManager>,
) -> Result<u32, PtyError> {
    ptys.spawn(request, ChannelSink(on_event))
}

#[tauri::command]
fn pty_write(id: u32, data: String, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.write(id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(id: u32, cols: u16, rows: u16, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.resize(id, cols, rows)
}

#[tauri::command]
fn pty_close(id: u32, ptys: State<'_, PtyManager>) -> Result<(), PtyError> {
    ptys.close(id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
