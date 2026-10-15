import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useDialogs } from "../dialogs/DialogProvider";
import { basename } from "./remotePath";
import { describeSftpError, EDIT_SAVED_EVENT, sftp, type EditSaved } from "./sftpClient";

/**
 * Uploads temporary copies opened from the SFTP browser each time they are saved, for every
 * SSH session, whether or not its SFTP panel is shown. The first save of each file asks.
 */
export function EditUploads({ onNotice }: { onNotice: (text: string) => void }) {
  const confirmed = useRef(new Set<string>());
  const notice = useRef(onNotice);
  notice.current = onNotice;
  const dialogs = useRef(useDialogs());

  useEffect(() => {
    const onSaved = async ({ id, remote }: EditSaved) => {
      const name = basename(remote);
      const key = `${id}:${remote}`;
      if (!confirmed.current.has(key)) {
        const upload = await dialogs.current.confirm({
          message: `${name} was saved. Upload it to ${remote}?`,
          confirmLabel: "Upload",
        });
        if (!upload) return;
        confirmed.current.add(key);
      }
      try {
        await sftp.editUpload(id, remote);
        notice.current(`Uploaded ${name} to ${remote}.`);
      } catch (err) {
        notice.current(`Could not upload ${name}: ${describeSftpError(err)}`);
      }
    };
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      listen<EditSaved>(EDIT_SAVED_EVENT, ({ payload }) => void onSaved(payload))
        .then((stop) => (disposed ? stop() : (unlisten = stop)))
        .catch(() => {});
    } catch {
      // Not running inside Tauri: no saved-copy events.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}
