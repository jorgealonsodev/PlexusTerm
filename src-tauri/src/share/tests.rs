use std::net::SocketAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use plexusterm_relay::{Config, Limits, Timings, serve};
use plexusterm_share_client::viewer::{self, Event, ViewerEngine};
use plexusterm_share_protocol::content::{Access, ClientId};
use plexusterm_share_protocol::link::parse_share_url;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

use super::*;

const TOKEN: &str = "test-token-0123456789";
const WAIT: Duration = Duration::from_secs(10);

#[test]
fn relay_urls_need_tls_except_on_this_computer() {
    assert_eq!(
        sharer_endpoint("wss://relay.example.com/").unwrap(),
        "wss://relay.example.com/v1/sharer"
    );
    assert_eq!(
        sharer_endpoint(" ws://127.0.0.1:8080 ").unwrap(),
        "ws://127.0.0.1:8080/v1/sharer"
    );
    assert!(sharer_endpoint("ws://localhost").is_ok());
    for bad in [
        "ws://relay.example.com",
        "https://relay.example.com",
        "wss://",
        "",
        "wss://a b",
    ] {
        assert!(
            matches!(sharer_endpoint(bad), Err(ShareError::BadRelayUrl)),
            "{bad}"
        );
    }
}

#[test]
fn viewer_origins_need_https_except_on_this_computer() {
    assert_eq!(
        viewer_origin("https://view.example.com/").unwrap(),
        "https://view.example.com"
    );
    assert_eq!(
        viewer_origin("http://localhost:5173").unwrap(),
        "http://localhost:5173"
    );
    for bad in [
        "http://view.example.com",
        "view.example.com",
        "https://",
        "http://localhost.evil.com",
    ] {
        assert!(
            matches!(viewer_origin(bad), Err(ShareError::BadViewerOrigin)),
            "{bad}"
        );
    }
}

#[test]
fn every_expiry_ends_within_12_hours_with_a_margin() {
    let now = 1_000_000;
    assert_eq!(Expiry::OneHour.at(now), now + 3600);
    assert_eq!(Expiry::TwelveHours.at(now), now + 12 * 3600 - 60);
    assert_eq!(Expiry::WhenStopped.at(now), now + 12 * 3600 - 60);
}

#[test]
fn commands_and_events_have_the_shapes_the_frontend_uses() {
    let snapshot: Command = serde_json::from_str(
        r#"{"cmd":"snapshot","viewer":3,"coversSeq":7,"screen":null,"full":"x"}"#,
    )
    .unwrap();
    assert_eq!(
        snapshot,
        Command::Snapshot {
            viewer: 3,
            covers_seq: 7,
            screen: None,
            full: "x".into()
        }
    );
    let expiry: Command = serde_json::from_str(r#"{"cmd":"expiry","expiry":"oneHour"}"#).unwrap();
    assert_eq!(
        expiry,
        Command::Expiry {
            expiry: Expiry::OneHour
        }
    );
    let stop: Command = serde_json::from_str(r#"{"cmd":"viewOnly"}"#).unwrap();
    assert_eq!(stop, Command::ViewOnly);

    let event = serde_json::to_value(ShareEvent::Ended {
        kind: EndKind::ProgramExited,
        code: None,
    })
    .unwrap();
    assert_eq!(
        event,
        serde_json::json!({ "event": "ended", "data": { "kind": "programExited", "code": null } })
    );
    let event = serde_json::to_value(ShareEvent::Unreachable { retry_in: 4 }).unwrap();
    assert_eq!(
        event,
        serde_json::json!({ "event": "unreachable", "data": { "retryIn": 4 } })
    );
}

#[test]
fn qr_codes_are_svg() {
    let svg = qr_svg("https://view.example.com/s/abc#def");
    assert!(svg.contains("<svg"), "{svg}");
}

#[test]
fn a_tab_cannot_be_shared_twice_nor_after_it_closed() {
    let manager = ShareManager::default();
    let request = |tap| StartRequest {
        tap,
        tab: "t".into(),
        relay_url: "ws://127.0.0.1:9".into(),
        viewer_origin: "http://localhost".into(),
        accesses: vec![Access::View],
        expiry: Expiry::OneHour,
        cols: 80,
        rows: 24,
        view_needs_approval: true,
        record_input: false,
        block_lid: false,
    };
    let (closed, tap) = taps().register();
    drop(tap);
    assert!(matches!(
        manager.start(request(closed), TOKEN.into(), |_| {}),
        Err(ShareError::UnknownTab)
    ));
    assert!(matches!(
        manager.start(request(closed), " ".into(), |_| {}),
        Err(ShareError::NoToken)
    ));
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn relay() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = Config {
        listen: addr,
        tokens: vec![TOKEN.into()],
        trust_proxy: false,
        limits: Limits::default(),
        timings: Timings::default(),
    };
    tokio::spawn(serve(listener, config));
    addr
}

async fn next_event(events: &mut UnboundedReceiver<ShareEvent>) -> ShareEvent {
    tokio::time::timeout(WAIT, events.recv())
        .await
        .expect("no share event")
        .expect("share events closed")
}

async fn until_event(
    events: &mut UnboundedReceiver<ShareEvent>,
    pred: impl Fn(&ShareEvent) -> bool,
) -> ShareEvent {
    loop {
        let event = next_event(events).await;
        if pred(&event) {
            return event;
        }
    }
}

struct TestViewer {
    engine: ViewerEngine,
    ws: Ws,
    screen: Vec<u8>,
}

impl TestViewer {
    async fn join(addr: SocketAddr, url: &str) -> Self {
        let link = parse_share_url(url).unwrap();
        let engine = ViewerEngine::new(link.share_id, &link.secret.unwrap(), ClientId::random());
        let (ws, _) = connect_async(format!("ws://{addr}/v1/viewer"))
            .await
            .unwrap();
        Self {
            engine,
            ws,
            screen: Vec::new(),
        }
    }

    async fn apply(&mut self, actions: Vec<viewer::Action>) -> Vec<Event> {
        let mut events = Vec::new();
        for action in actions {
            match action {
                viewer::Action::Text(t) => self.ws.send(Message::Text(t.into())).await.unwrap(),
                viewer::Action::Binary(b) => self.ws.send(Message::Binary(b.into())).await.unwrap(),
                viewer::Action::Event(Event::Write(data)) => {
                    self.screen.extend_from_slice(&data);
                    events.push(Event::Write(data));
                }
                viewer::Action::Event(e) => events.push(e),
            }
        }
        events
    }

    async fn until(&mut self, pred: impl Fn(&Event, &[u8]) -> bool) {
        loop {
            let msg = tokio::time::timeout(WAIT, self.ws.next())
                .await
                .expect("viewer timed out")
                .expect("viewer connection closed")
                .unwrap();
            let actions = match msg {
                Message::Text(t) => self.engine.on_text(&t),
                Message::Binary(b) => self.engine.on_binary(&b),
                _ => continue,
            };
            for event in self.apply(actions).await {
                if pred(&event, &self.screen) {
                    return;
                }
            }
        }
    }

    async fn type_keys(&mut self, keys: &[u8]) {
        let action = self.engine.input(keys).expect("viewer cannot type");
        self.apply(vec![action]).await;
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Share → join → approve → snapshot → live output → typing → Stop, through a real relay.
#[tokio::test(flavor = "multi_thread")]
async fn a_shared_tab_reaches_a_viewer_and_takes_its_keys() {
    let addr = relay().await;
    let dir = tempfile::tempdir().unwrap();
    let manager = ShareManager::default();
    manager.set_dir(dir.path().to_path_buf());
    let (tap_id, tap) = taps().register();
    // Output before the share is not numbered.
    assert_eq!(tap.output(b"private"), None);

    let (tx, mut events) = unbounded_channel();
    let id = manager
        .start(
            StartRequest {
                tap: tap_id,
                tab: "build".into(),
                relay_url: format!("ws://{addr}"),
                viewer_origin: "http://localhost".into(),
                accesses: vec![Access::View, Access::Type],
                expiry: Expiry::OneHour,
                cols: 80,
                rows: 24,
                view_needs_approval: true,
                record_input: false,
                block_lid: false,
            },
            TOKEN.into(),
            move |event| {
                let _ = tx.send(event);
            },
        )
        .unwrap();
    assert!(matches!(
        manager.start(
            StartRequest {
                tap: tap_id,
                tab: "build".into(),
                relay_url: format!("ws://{addr}"),
                viewer_origin: "http://localhost".into(),
                accesses: vec![Access::View],
                expiry: Expiry::OneHour,
                cols: 80,
                rows: 24,
                view_needs_approval: true,
                record_input: false,
                block_lid: false,
            },
            TOKEN.into(),
            |_| {}
        ),
        Err(ShareError::AlreadyShared)
    ));

    let ShareEvent::Live { links, .. } = next_event(&mut events).await else {
        panic!("the share did not go live");
    };
    assert_eq!(
        links.iter().map(|l| l.access).collect::<Vec<_>>(),
        vec![Access::View, Access::Type]
    );
    assert!(
        links
            .iter()
            .all(|l| l.url.starts_with("http://localhost/s/") && l.qr.contains("<svg"))
    );
    let typing = &links.iter().find(|l| l.access == Access::Type).unwrap().url;

    let seq = tap
        .output(b"before-join")
        .expect("shared output is numbered");

    let mut viewer = TestViewer::join(addr, typing).await;
    viewer.until(|e, _| *e == Event::Waiting).await;
    let ShareEvent::JoinRequest { viewer: asking } =
        until_event(&mut events, |e| matches!(e, ShareEvent::JoinRequest { .. })).await
    else {
        unreachable!()
    };
    assert_eq!((asking.number, asking.access), (1, Access::Type));
    manager
        .command(
            id,
            Command::Allow {
                viewer: asking.viewer,
            },
        )
        .unwrap();
    let ShareEvent::ViewerJoined { rejoined, .. } = until_event(&mut events, |e| {
        matches!(e, ShareEvent::ViewerJoined { .. })
    })
    .await
    else {
        unreachable!()
    };
    assert!(!rejoined);
    let ShareEvent::SnapshotRequest { viewer: wanted } = until_event(&mut events, |e| {
        matches!(e, ShareEvent::SnapshotRequest { .. })
    })
    .await
    else {
        unreachable!()
    };
    manager
        .command(
            id,
            Command::Snapshot {
                viewer: wanted,
                covers_seq: seq,
                screen: Some("SCREEN".into()),
                full: "HISTORY+SCREEN".into(),
            },
        )
        .unwrap();
    viewer
        .until(|_, screen| contains(screen, b"HISTORY+SCREEN"))
        .await;
    assert!(!contains(&viewer.screen, b"private"));

    tap.output(b"live-output");
    viewer
        .until(|_, screen| contains(screen, b"live-output"))
        .await;

    viewer.type_keys(b"ls\r").await;
    let ShareEvent::Input { data, .. } =
        until_event(&mut events, |e| matches!(e, ShareEvent::Input { .. })).await
    else {
        unreachable!()
    };
    assert_eq!(data, "ls\r");

    manager.command(id, Command::Stop).unwrap();
    viewer.until(|e, _| matches!(e, Event::Ended(_))).await;
    let ended = until_event(&mut events, |e| matches!(e, ShareEvent::Ended { .. })).await;
    assert_eq!(
        ended,
        ShareEvent::Ended {
            kind: EndKind::Stopped,
            code: None
        }
    );
    // The tab can be shared again, the crash marker is gone and the audit log tells the story.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(tap.output(b"after"), None);
    assert!(manager.take_crashed().is_empty());
    let log = audit::read(&manager.audit_path().unwrap()).unwrap();
    let kinds: Vec<_> = log
        .iter()
        .map(|e| e["event"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(kinds, ["start", "joinRequest", "approved", "input", "end"]);
    assert_eq!(log[3]["bytes"], 3);
    assert!(
        log[3].get("text").is_none(),
        "typed text is not recorded by default"
    );
}

/// The program exits: the share ends as "programExited".
#[tokio::test(flavor = "multi_thread")]
async fn the_share_ends_when_the_shared_program_exits() {
    let addr = relay().await;
    let manager = ShareManager::default();
    let (tap_id, tap) = taps().register();
    let (tx, mut events) = unbounded_channel();
    manager
        .start(
            StartRequest {
                tap: tap_id,
                tab: "t".into(),
                relay_url: format!("ws://{addr}"),
                viewer_origin: "http://localhost".into(),
                accesses: vec![Access::View],
                expiry: Expiry::WhenStopped,
                cols: 80,
                rows: 24,
                view_needs_approval: false,
                record_input: false,
                block_lid: false,
            },
            TOKEN.into(),
            move |event| {
                let _ = tx.send(event);
            },
        )
        .unwrap();
    until_event(&mut events, |e| matches!(e, ShareEvent::Live { .. })).await;
    tap.exited();
    let ended = until_event(&mut events, |e| matches!(e, ShareEvent::Ended { .. })).await;
    assert_eq!(
        ended,
        ShareEvent::Ended {
            kind: EndKind::ProgramExited,
            code: None
        }
    );
}

/// A wrong relay token is refused and the share ends with the relay's code.
#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_token_ends_the_share_as_refused() {
    let addr = relay().await;
    let manager = ShareManager::default();
    let (tap_id, _tap) = taps().register();
    let (tx, mut events) = unbounded_channel();
    manager
        .start(
            StartRequest {
                tap: tap_id,
                tab: "t".into(),
                relay_url: format!("ws://{addr}"),
                viewer_origin: "http://localhost".into(),
                accesses: vec![Access::View],
                expiry: Expiry::OneHour,
                cols: 80,
                rows: 24,
                view_needs_approval: true,
                record_input: false,
                block_lid: false,
            },
            "wrong-token-0123456789".into(),
            move |event| {
                let _ = tx.send(event);
            },
        )
        .unwrap();
    let ended = until_event(&mut events, |e| matches!(e, ShareEvent::Ended { .. })).await;
    assert_eq!(
        ended,
        ShareEvent::Ended {
            kind: EndKind::Refused,
            code: Some("unauthorized".into())
        }
    );
}

/// View only joins are let in without asking when the setting is off.
#[tokio::test(flavor = "multi_thread")]
async fn view_only_joins_can_skip_approval() {
    let addr = relay().await;
    let manager = ShareManager::default();
    let (tap_id, _tap) = taps().register();
    let (tx, mut events) = unbounded_channel();
    manager
        .start(
            StartRequest {
                tap: tap_id,
                tab: "t".into(),
                relay_url: format!("ws://{addr}"),
                viewer_origin: "http://localhost".into(),
                accesses: vec![Access::View],
                expiry: Expiry::OneHour,
                cols: 80,
                rows: 24,
                view_needs_approval: false,
                record_input: false,
                block_lid: false,
            },
            TOKEN.into(),
            move |event| {
                let _ = tx.send(event);
            },
        )
        .unwrap();
    let ShareEvent::Live { links, .. } =
        until_event(&mut events, |e| matches!(e, ShareEvent::Live { .. })).await
    else {
        unreachable!()
    };
    let mut viewer = TestViewer::join(addr, &links[0].url).await;
    viewer
        .until(|e, _| {
            matches!(
                e,
                Event::Joined {
                    access: Access::View,
                    ..
                }
            )
        })
        .await;
    let joined = until_event(&mut events, |e| {
        matches!(
            e,
            ShareEvent::ViewerJoined { .. } | ShareEvent::JoinRequest { .. }
        )
    })
    .await;
    assert!(
        matches!(
            joined,
            ShareEvent::ViewerJoined {
                rejoined: false,
                ..
            }
        ),
        "{joined:?}"
    );
}
