// PocketJS's system.wifi for the browser host (vendor/pocketjs/contracts/spec/
// wifi.ts): the Network panel reads it as it reads Android's WifiManager on
// the AYN Thor or NetworkManager on the RG DS Plus. The networks are a
// fixture; nothing leaves the page.
const NETWORKS = [
  { ssid: "Pocket", signal: 78, secure: true },
  { ssid: "Cafe", signal: 52, secure: false },
  { ssid: "Library", signal: 31, secure: true },
];
const bars = (signal) => (signal >= 75 ? 3 : signal >= 50 ? 2 : signal >= 25 ? 1 : 0);

export function createWifi({ onChange = () => {} } = {}) {
  let enabled = true;
  let ssid = "Pocket";
  let saved = ["Pocket"];
  let scanning = false;
  let error = "";
  const changed = () => onChange(enabled && ssid ? ssid : "");
  const status = () => {
    const now = enabled ? NETWORKS.find((n) => n.ssid === ssid) : undefined;
    return {
      state: !enabled ? "off" : now ? "connected" : "idle",
      ssid: now?.ssid ?? "",
      strength: bars(now?.signal ?? 0),
      address: now ? "10.0.0.8" : "",
      saved: saved.map((s, slot) => ({ slot, ssid: s })),
      error,
      scanning,
      networks: enabled ? NETWORKS.map((n) => ({ ssid: n.ssid, strength: bars(n.signal), secure: n.secure, signal: n.signal, saved: saved.includes(n.ssid) })) : [],
    };
  };
  const join = (name) => {
    error = "";
    ssid = name;
    if (!saved.includes(name)) saved = [name, ...saved];
    changed();
    return true;
  };
  return {
    status: () => JSON.stringify(status()),
    setEnabled(on) {
      enabled = on;
      error = "";
      changed();
      return true;
    },
    connect(slot) {
      if (!enabled || !saved[slot]) return false;
      return join(saved[slot]);
    },
    scan() {
      if (!enabled) return false;
      scanning = true;
      setTimeout(() => (scanning = false), 1200);
      return true;
    },
    join(name, passphrase) {
      const network = NETWORKS.find((n) => n.ssid === name);
      if (!enabled || !network) return false;
      if (network.secure && passphrase.length < 8) {
        error = `${name} needs its password (8 characters or more)`;
        return false;
      }
      return join(name);
    },
    forget(slot) {
      const name = saved[slot];
      if (name === undefined) return false;
      saved = saved.filter((s) => s !== name);
      if (ssid === name) ssid = "";
      changed();
      return true;
    },
    disconnect() {
      ssid = "";
      changed();
      return true;
    },
  };
}
