import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "本地 (-L)",
    remote: "远程 (-R)",
    dynamic: "动态 SOCKS5 (-D)",
  },
  panel: {
    title: "SSH 隧道",
    new: "新建",
    startAll: "全部启动",
    stopAll: "全部停止",
    readError: "无法读取已保存的隧道：{message}。为保护该文件，已禁用编辑。",
    saveError: "无法保存隧道：{error}",
    empty: "尚无隧道。",
    missingSession: "会话缺失",
    via: "{tunnel}，经由 {session}",
    hint: "除非选择其他地址，否则隧道在 127.0.0.1 上监听。",
  },
  state: {
    stopped: "已停止",
    starting: "正在启动…",
    running: "正在运行",
    error: "错误",
  },
  edit: {
    newTitle: "新建 SSH 隧道",
    editTitle: "编辑隧道",
    namePlaceholder: "根据端口自动生成",
    type: "类型",
    sshSession: "SSH 会话",
    chooseSession: "选择已保存的会话…",
    noSessions: "请先保存一个 SSH 会话；隧道使用其连接。",
    listenAddressServer: "服务器上的监听地址",
    listenAddress: "监听地址",
    exposedRemote: "在 {host} 上监听会让其他机器访问服务器端口。使用 127.0.0.1 可保持私有。",
    exposedLocal: "在 {host} 上监听会让其他机器使用此隧道。使用 127.0.0.1 可保持私有。",
    destinationFromHere: "目标（从本机访问）",
    destinationFromServer: "目标（从服务器访问）",
    dynamicHint: "应用程序将此端口用作 SOCKS5 代理；由服务器建立连接。",
  },
  form: {
    chooseSession: "请选择已保存的 SSH 会话",
    invalidListenPort: "监听端口必须是 1 到 65535 之间的数字",
    destHostRequired: "目标主机为必填项",
    invalidDestPort: "目标端口必须是 1 到 65535 之间的数字",
  },
  file: {
    invalidJson: "隧道文件不是有效的 JSON：{error}",
    unsupportedVersion: "不支持的隧道文件版本",
    invalidTunnels: "隧道文件包含无效的隧道",
  },
  launcher: {
    sessionGone: "其保存的会话已不存在；请编辑该隧道以选择其他会话。",
    startFailed: "无法启动隧道：{error}",
  },
};
