# Claude Code long-session freeze investigation

> **Status (0.2.16):** each mechanism below was checked again by an independent reviewer and the confirmed ones were fixed in 0.2.16: output flow control (a pane pauses its session's reader while it has more than 512 KB to parse), a bounded session log written off the main thread, SSH close that no longer waits behind a blocked write, error highlighting bounded by the screen (and the last 1,000 error rows), and file commands off the async runtime and the main thread. Line references below are to the baseline `0602ab6`. The NVIDIA graphics track remains open: it needs evidence from the affected computer.

**Conclusion:** Two source investigations converge on missing consumer-driven terminal-output flow control as the strongest source-level validation priority. The blind repeat also strengthens the conditional session-logging backlog finding and identifies an SSH cancellation-ordering problem. Subsequent user evidence that problems are worse on the NVIDIA-equipped work computer makes platform graphics an equally important parallel investigation track. **None of these mechanisms was reproduced or established as the cause of the reported incident.**

This document preserves the initial investigation, the completed blind repeat, and their comparison. It is a synthesis, not a verbatim archive of agent transcripts. No behavior changes were implemented.

## Scope and evidence baseline

| Item | Evidence |
| --- | --- |
| Reported symptom | PlexusTerm froze during prolonged use of the external Claude Code CLI. |
| Inspected application | PlexusTerm 0.2.15, source baseline `0602ab6`. |
| Initial investigation | Five scoped read-only investigators: transport, rendering, lifecycle, backend blocking, and diagnostics/tests. |
| Completed blind repeat | Five fresh Pi processes, all verified as `openai-codex/gpt-6.1-sol`. |
| Blind isolation | Identical neutral prompts; no initial findings, inherited conversation, investigator-to-investigator communication, memory, repository history, or previous investigation notes. |
| Execution boundaries | No Claude Code execution, application profiling, soak run, or incident-log analysis. |
| Changes | Documentation only; no fixes, configuration changes, or dependency installation. |

A separate blind attempt was stopped at the user's request. Its partial results were not included in the completed repeat or the agreement counts below.

The completed repeat used an explicit model selector, new non-persistent sessions, disabled extensions/context discovery, and only `read`, `grep`, `find`, and `ls`. The parent validated model metadata from actual assistant responses, normal settlement, and process exit codes. All five runs passed those checks with exit code 0.

**Interpretation:** These are independent contexts using the same model and prompt, not statistically independent experiments or diverse-model verification. Agreement strengthens investigation priorities; it does not establish causality.

## Subsequent user evidence: NVIDIA work computer

After the investigations, the user clarified:

> en mi otro equipo del trabajo, que tiene una tarjeta nvidia es donde mas problemas tiene

The NVIDIA-equipped work computer has the most problems. The user subsequently confirmed its operating system and desktop:

> uso mint con xfce

**Confirmed environment:** Linux Mint with XFCE and an NVIDIA graphics card, as reported by the user. The Mint version, display-session type (X11/Wayland), NVIDIA driver version, application build, and runtime settings remain unconfirmed. Do not infer X11 solely from XFCE. This is environment correlation, not a measured GPU diagnosis. Neither clarification was supplied to the completed blind investigators, so their agreement counts are unchanged.

**Interpretation:** Graphics should now be investigated alongside output throughput rather than treated as a low-priority generic possibility. A slower or stalled presentation path could also reduce output-consumption capacity, so graphics and buffering are not mutually exclusive explanations.

The terminal's WebGL addon and the platform webview/compositor are distinct layers. Turning off xterm GPU acceleration does not establish that all platform graphics acceleration is disabled.

For **Linux only**, the current source already implements a specific NVIDIA/WebKitGTK mitigation in `src-tauri/src/platform.rs:37-66`:

- Detection checks for `/proc/driver/nvidia`.
- If none of the three DMABUF override variables is defined, startup sets `WEBKIT_FORCE_DMABUF_RENDERER=1` and `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, selecting a shared-memory frame-transfer path.
- If any override is already defined, the helper leaves the environment unchanged. An existing value, even one disabling a renderer, can therefore bypass the automatic choice.

The source comment describes delayed presentation and typing lag with NVIDIA GPU-buffer transfer. It is evidence of an existing targeted mitigation, **not proof that the current freezes have that cause**. Linux Mint puts this Linux-specific path in scope, but the driver detection and selected frame-transfer environment must still be checked on the affected machine.

The diagnostic log records graphics environment variables, detected graphics cards/drivers, WebGL information, acceleration settings, and frontend/backend heartbeat signals (`src-tauri/src/diaglog.rs:242-262,306-322`; `src/features/diagnostics/useDiagnosticLog.ts:30-47`). See [Diagnostic log](user-guide.md#diagnostic-log) for enabling it. Capture evidence from the affected computer before changing environment variables or drivers; no such changes have been made here.

## Initial investigation

| Candidate | Initial assessment | Important condition |
| --- | --- | --- |
| Output buffering without explicit consumer acknowledgement | Highest priority: unbounded pre-coalescer Rust queue and frontend writes without parsing-completion feedback. | Requires production to exceed downstream consumption. |
| Error-highlighting overhead | Repeated traversal of retained decorations can make ongoing scans history-dependent. | Bounded by retained rows; matching output and normal-buffer operation matter. |
| Automatic Explorer/Git work | DEV-mode output can trigger directory/status refreshes; synchronous filesystem work inside async handlers may occupy runtime workers. | Slow storage, large directories, multiple roots, and feature visibility affect relevance. |
| Input buffering | Local and SSH input channels lack an explicit capacity bound. | Requires continuing input while its consumer falls behind. |
| Session logging | Secondary conditional backlog candidate, not a default cause. | Logging must be enabled and appends must fall behind. |

Relevant source references:

- Output: `src-tauri/src/lib.rs:57-88`, `src-tauri/src/terminal/coalesce.rs:25-65`, `src/features/terminal/TerminalView.tsx:538`.
- Highlighting: `src/features/terminal/errorHighlight.ts:126-165`; default in `src/features/settings/settings.ts:213`.
- Refreshes: `src/features/files/useGitStatus.ts:40-105`, `src/features/local/LocalPanel.tsx:190-207`, `src/features/terminal/gitBranch.ts:64-96`.
- Filesystem handlers: `src-tauri/src/localfs.rs:671-766`.
- Input: `src-tauri/src/pty/mod.rs:157-170,222-229`, `src-tauri/src/ssh/mod.rs:917-954,980-1008`.
- Logging: `src/features/terminal/sessionLog.ts:20-60`.

### Corrections made during the initial investigation

- An unbounded Rust queue does **not** prove unlimited memory growth throughout the entire transport. Installed xterm has a pending-input watermark; native IPC backpressure semantics were not established in that round.
- Rapidly rejected history saves do not themselves accumulate an unresolved promise chain. History uses a one-second debounce and records submitted commands, not every terminal-output chunk.
- Built-in AI suggestions are separate from the external Claude Code CLI. They have per-pane concurrency limits and an eight-second HTTP timeout; no relevant unlimited-request mechanism was established.
- Local Git work uses `spawn_blocking`, with per-hook overlap guards. This is not evidence that Git directly freezes the UI thread.
- No general leak from terminal unmounts or tab changes was established; substantial cleanup exists.

## Blind-repeat results and comparison

Counts indicate investigators that presented a mechanism as a finding, not votes proving an incident cause.

| Mechanism | Blind findings | Comparison with initial investigation |
| --- | --- | --- |
| Missing output-consumption-based flow control | **5/5** | Strongest convergence with the original priority. |
| Slow-storage session-log backlog | **5/5** | Strengthens a previously secondary, opt-in candidate. |
| SSH close queued behind a blocked data write | **3/5** | Adds a specific cancellation/resource-retention mechanism to the original input-queue concern. |
| History-dependent highlighting overhead | **2/5** | Repeated traversal is supported, but practical importance has less agreement. The other three did not establish a standalone highlighting failure. |
| Explorer/Git/filesystem work | Not independently re-established | Not ruled out: the repeat did not comprehensively inspect these subsystems. |

Reviewer-level findings:

| Reviewer | Output flow control | Logging backlog | SSH queued close | Highlighting overhead as a finding |
| --- | --- | --- | --- | --- |
| 1 | Yes | Yes | Yes | No |
| 2 | Yes | Yes | No | Yes |
| 3 | Yes | Yes | No | Yes |
| 4 | Yes | Yes | Yes | No |
| 5 | Yes | Yes | Yes | No |

### 1. Output flow control: primary validation priority

**Configuration:** Normal terminal pipeline, local and SSH; no logging or built-in AI feature is required.

The reachable path is:

```text
PTY/SSH reader -> ChannelSink -> Rust queue -> coalescer
              -> Tauri channel -> TerminalView -> xterm.write
```

`ChannelSink` creates an unbounded Rust channel. The coalescer reduces message frequency using a four-millisecond burst window and approximately 64-KiB batches, but does not limit total pending output. `TerminalView` submits output to xterm without a parsing-completion callback or acknowledgement to the producer.

If production persistently exceeds parsing/delivery capacity, outstanding work can increase. Long duration increases exposure; a short intense burst could produce the same imbalance. Session age alone is not the trigger.

Installed xterm defines a pending-data watermark of `50,000,000` units and rejects a subsequent write when pending data is already above it:

```text
write data discarded, use flow control to avoid losing data
```

For string input, the accounting uses JavaScript string length, not necessarily UTF-8 bytes. The strict comparison permits overshoot; this is an overload guard, not upstream backpressure. Rejected writes can lose output, but recovery is possible if the backlog drains.

References: `src-tauri/src/lib.rs:57-88`, `src-tauri/src/terminal/coalesce.rs:17-65`, `src/features/terminal/TerminalView.tsx:525-542`, and installed `node_modules/@xterm/xterm/src/common/input/WriteBuffer.ts:20,103-106`.

**Dependency counterevidence:** Installed Tauri catches exceptions from a channel receiver and reports them asynchronously, allowing delivery ordering to advance. An xterm overflow therefore does **not** establish a permanently wedged channel message index. See installed `node_modules/@tauri-apps/api/core.js:175-185`.

**Proposed validation:** Measure produced, delivered, and parsed data separately, outstanding queue sizes, overflow errors, and key-to-echo latency. If confirmed, introduce byte-based high/low watermarks and consumption acknowledgements propagated to the reader. Do not discard arbitrary terminal-stream fragments or assume smaller batches solve the problem.

### 2. Session logging: conditional memory-backlog risk

**Configuration:** Explicitly enabled session logging, local or SSH.

The logger flushes approximately every 500 ms and serializes append operations through a promise chain. Each queued continuation retains its batch text. There is no aggregate queued-byte or queued-batch limit.

If an append stalls or sustained storage throughput is insufficient, subsequent batches can remain retained. Stopping logging waits for the chain rather than cancelling a stuck append.

The 4,096-character escape-tail limit and backend per-append 50-MiB limit do not bound the aggregate backlog. Fast storage should keep the queue short; rejected appends stop logging. Slow/unresolved operations, not rapid failures alone, are the relevant condition.

References: `src/features/terminal/sessionLog.ts:20-60`, `src/features/terminal/TerminalView.tsx:1181-1204`, `src-tauri/src/lib.rs:631-645`, and `src-tauri/src/storage.rs:107-119`.

**Proposed validation:** Feed sustained output while deliberately delaying append completion; measure retained queued bytes. A potential fix is a bounded backlog with a visible stop/overflow policy. File rotation is a separate proposal, not an implemented protection.

### 3. SSH cancellation: close can wait behind blocked input

**Configuration:** SSH only; a remote peer must stop accepting input or otherwise leave a data write waiting.

One writer task processes data, resize, and close commands sequentially. While it awaits `writer.data()`, later commands cannot overtake that write. Closing removes the manager entry but queues `Close` behind pending work rather than independently cancelling the current write.

This can delay connection/task cleanup after the pane disappears. Repeated affected sessions could retain resources. It does not explain an exclusively local incident or prove that passive output causes a deadlock.

Counterevidence: SSH reading is separate from writing; connection failure may release the writer; a keepalive is configured. Local close directly attempts to kill its child, so this specific close-ordering mechanism should not be generalized to PTY sessions.

References: `src-tauri/src/ssh/mod.rs:917-954,980-1008`; local contrast at `src-tauri/src/pty/mod.rs:258-266`.

**Proposed validation:** Use an isolated test SSH peer that withholds input-window capacity, queue a large write, then close. Verify timely termination and bounded memory. A potential fix is out-of-band cancellation plus bounded queued input.

### 4. Highlighting: bounded overhead, not an established leak

Highlighting defaults on. Each scan filters retained decorations; scanning additional lines also rebuilds membership from retained markers. Wrapped error rows can cause repeated reconstruction of the same logical line. This can reduce consumption capacity as matching rows accumulate.

However, scans are frame-coalesced, disposed markers are removed, retained history is bounded by the 10,000-line scrollback, and **alternate-buffer scans are skipped**. The latter matters when interpreting full-screen CLI workloads. No standalone highlighting freeze was demonstrated.

References: `src/features/terminal/errorHighlight.ts:126-165,190-209` and `src/features/settings/settings.ts:213`.

**Proposed validation:** Compare scan duration and interaction latency with highlighting on/off, matching/nonmatching output, and known terminal-buffer modes. Optimize retained-marker traversal only if profiling supports its relevance.

## Protections and unsupported diagnoses

Both investigations found reasons not to overstate several explanations:

- Terminal scrollback is explicitly bounded to 10,000 rows; this does not bound pending parser input.
- Local and SSH writers are separated from output readers.
- Frontend teardown clears timers/listeners/observers, disposes terminal resources, and requests backend closure.
- WebGL initialization/context-loss paths have fallback behavior; GPU acceleration defaults off on Linux. No GPU-driver cause was established.
- Built-in AI provider activity is not the execution path of the external Claude Code CLI.
- No inevitable uptime threshold, Claude-specific protocol defect, or universal terminal-resource leak was demonstrated.

## Checks actually performed

The initial investigation ran:

```sh
npm test -- src/features/terminal/errorHighlight.test.ts src/features/terminal/output.test.ts src/features/terminal/TerminalView.test.tsx src/features/diagnostics/useDiagnosticLog.test.ts src/features/terminal/sessionLog.test.ts
```

Result: **5 test files, 163 tests passed, exit code 0**. The runner emitted warnings that canvas `getContext()` is not implemented in the jsdom environment. These tests do not validate real GPU behavior or prolonged output throughput.

The completed blind repeat was static: investigators read source and selected tests, but did not execute tests or the application. Its five successful process exits establish completed investigation runs, not successful application stress tests.

Not performed: Rust tests, production builds, long-duration soak tests, real GPU checks, controlled SSH cancellation tests, deliberately stalled logging tests, or profiling of the reported failure. No failing-session logs were available. Installed dependency behavior may differ from the packaged binary involved in the incident.

## Recommended next step

1. On the NVIDIA work computer (confirmed Linux Mint with XFCE), establish the Mint version, display session (X11/Wayland), GPU/driver version, application build, terminal acceleration setting, local/SSH target, and whether session logging was enabled. Enable the existing diagnostic log and preserve evidence around a freeze.
2. Compare the same application build and representative workload across machines. For Linux, inspect the logged WebKit environment and whether the existing NVIDIA mitigation was selected. Change at most one graphics setting per comparison; do not infer a fully software-rendered webview from the terminal WebGL toggle alone.
3. In parallel, measure end-to-end outstanding output and parser completion. This remains the strongest common source finding and can interact with graphics-related slowdown.
4. Test logging backlog only if logging was enabled, and SSH cancellation only for affected SSH sessions.
5. Profile highlighting in normal-buffer operation; separately investigate Explorer/Git work if the earlier conditions apply.

All experiments and fixes above remain proposals. The report does not authorize implementation or claim that any candidate caused the historical freezes.
