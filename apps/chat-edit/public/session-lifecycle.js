const SESSION_POINTER = "scrambo-transcript-session";
const SESSION_KEY_PREFIXES = ["scrambo-transcript-messages-"];

export function findStoredSessionIds(storage, limit = 25) {
  const ids = [];
  const active = storage.getItem(SESSION_POINTER);
  if (active) ids.push(active);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) ?? "";
    for (const prefix of SESSION_KEY_PREFIXES) {
      if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
  }
  return [...new Set(ids.filter((id) => /^sess_[A-Za-z0-9_-]+$/.test(id)))].slice(0, limit);
}

export function sessionDialogCopy(session) {
  if (!session || session.state === "closed") {
    return { replacing: false, warning: "", submitLabel: "Create" };
  }
  return {
    replacing: true,
    warning: `Scrambo permits one active session per API token. Creating this session will close “${session.project}” first.`,
    submitLabel: "Close current & create",
  };
}
