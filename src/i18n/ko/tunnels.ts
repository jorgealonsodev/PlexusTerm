import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "로컬(-L)",
    remote: "원격(-R)",
    dynamic: "동적 SOCKS5(-D)",
  },
  panel: {
    title: "SSH 터널",
    new: "새로 만들기",
    startAll: "모두 시작",
    stopAll: "모두 중지",
    readError: "저장된 터널을 읽을 수 없습니다: {message}. 파일 보호를 위해 편집이 비활성화되었습니다.",
    saveError: "터널을 저장할 수 없습니다: {error}",
    empty: "아직 터널이 없습니다.",
    missingSession: "세션 없음",
    via: "{session} 경유 {tunnel}",
    hint: "다른 주소를 선택하지 않으면 터널은 127.0.0.1에서 수신 대기합니다.",
  },
  state: {
    stopped: "중지됨",
    starting: "시작하는 중…",
    running: "실행 중",
    error: "오류",
  },
  edit: {
    newTitle: "새 SSH 터널",
    editTitle: "터널 편집",
    namePlaceholder: "포트에서 자동 생성",
    type: "유형",
    sshSession: "SSH 세션",
    chooseSession: "저장된 세션 선택…",
    noSessions: "먼저 SSH 세션을 저장하십시오. 터널은 해당 세션의 연결을 사용합니다.",
    listenAddressServer: "서버의 수신 대기 주소",
    listenAddress: "수신 대기 주소",
    exposedRemote: "{host}에서 수신 대기하면 다른 컴퓨터가 서버 포트에 접근할 수 있습니다. 비공개로 유지하려면 127.0.0.1을 사용하십시오.",
    exposedLocal: "{host}에서 수신 대기하면 다른 컴퓨터가 이 터널을 사용할 수 있습니다. 비공개로 유지하려면 127.0.0.1을 사용하십시오.",
    destinationFromHere: "대상(이 컴퓨터 기준)",
    destinationFromServer: "대상(서버 기준)",
    dynamicHint: "응용 프로그램은 이 포트를 SOCKS5 프록시로 사용하며, 연결은 서버가 엽니다.",
  },
  form: {
    chooseSession: "저장된 SSH 세션을 선택하십시오",
    invalidListenPort: "수신 대기 포트는 1에서 65535 사이의 숫자여야 합니다",
    destHostRequired: "대상 호스트를 입력해야 합니다",
    invalidDestPort: "대상 포트는 1에서 65535 사이의 숫자여야 합니다",
  },
  file: {
    invalidJson: "터널 파일이 올바른 JSON이 아닙니다: {error}",
    unsupportedVersion: "지원되지 않는 터널 파일 버전입니다",
    invalidTunnels: "터널 파일에 잘못된 터널이 있습니다",
  },
  launcher: {
    sessionGone: "저장된 세션이 더 이상 존재하지 않습니다. 터널을 편집하여 다른 세션을 선택하십시오.",
    startFailed: "터널을 시작할 수 없습니다: {error}",
  },
};
