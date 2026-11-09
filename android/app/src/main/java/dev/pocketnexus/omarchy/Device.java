package dev.pocketnexus.omarchy;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.FileObserver;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import java.io.File;
import java.net.Inet4Address;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Android's side of what the shell shows and asks of the device, in place
 * of systemd, NetworkManager, PipeWire and BlueZ on the RG DS Plus
 * (daemon/android.ts):
 *
 * - the battery, the network, the media volume, Bluetooth and the screens'
 *   brightness go into the root's android.json at each change, which
 *   omarchy-pocketd reads into SystemState;
 * - each file omarchy-pocketd drops into android-commands is run and removed:
 *   the media volume, mute, brightness, a settings panel, a URL;
 * - the volume keys step the media volume by 5% and show Omarchy's OSD;
 * - the screen going off tells the shell `sleep`, and it locks, as Omarchy
 *   does before a suspend.
 */
final class Device {
    interface Brightness {
        /** the brightness both windows ask for, 0..1, or -1 for the system's */
        void set(float level);
    }

    private static final String SPEAKER = "󰕾"; // U+F057E
    private static final String MUTED = "󰝟"; // U+F075F

    private final Context context;
    private final Brightness brightness;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioManager audio;
    private final ConnectivityManager connectivity;
    private final WifiManager wifi;
    private JSONObject battery = null;
    private float windowBrightness = -1;
    private FileObserver commands;
    private boolean writePending;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_BATTERY_CHANGED.equals(action)) battery = battery(intent);
            if (Intent.ACTION_SCREEN_OFF.equals(action)) Native.shellEvent("{\"event\":\"sleep\"}");
            changed();
        }
    };

    private final ConnectivityManager.NetworkCallback network = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network n) { networkChanged(); }
        @Override public void onLost(Network n) { networkChanged(); }
        @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { changed(); }
        @Override public void onLinkPropertiesChanged(Network n, LinkProperties l) { networkChanged(); }
    };

    /** Another network or its name servers: the root's resolv.conf follows. */
    private void networkChanged() {
        if (Linux.installed(context)) Assets.write(new File(Linux.root(context), "etc/resolv.conf"), Linux.resolvConf(context));
        changed();
    }

    Device(Context context, Brightness brightness) {
        this.context = context.getApplicationContext();
        this.brightness = brightness;
        audio = context.getSystemService(AudioManager.class);
        connectivity = context.getSystemService(ConnectivityManager.class);
        wifi = context.getSystemService(WifiManager.class);
    }

    void start() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_BATTERY_CHANGED);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction("android.media.VOLUME_CHANGED_ACTION");
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        filter.addAction(WifiManager.WIFI_STATE_CHANGED_ACTION);
        Intent sticky = context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        if (sticky != null) battery = battery(sticky);
        connectivity.registerDefaultNetworkCallback(network, main);
        File dir = new File(Linux.stateFile(context).getParentFile(), "android-commands");
        dir.mkdirs();
        commands = new FileObserver(dir, FileObserver.MOVED_TO | FileObserver.CLOSE_WRITE) {
            @Override
            public void onEvent(int event, String name) {
                if (name != null && name.endsWith(".json") && !name.startsWith(".")) main.post(() -> run(new File(dir, name)));
            }
        };
        commands.startWatching();
        // commands left from before the app started
        File[] waiting = dir.listFiles();
        if (waiting != null) for (File f : waiting) if (f.getName().endsWith(".json") && !f.getName().startsWith(".")) run(f);
        changed();
    }

    void stop() {
        try {
            context.unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
        }
        try {
            connectivity.unregisterNetworkCallback(network);
        } catch (IllegalArgumentException ignored) {
        }
        if (commands != null) commands.stopWatching();
    }

    // ---- the state file ----

    /** A change: the state file is written once for a burst of them. */
    void changed() {
        if (writePending) return;
        writePending = true;
        main.postDelayed(() -> {
            writePending = false;
            write();
        }, 100);
    }

    private static JSONObject battery(Intent intent) {
        int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        if (level < 0 || scale <= 0) return null;
        try {
            return new JSONObject()
                    .put("percent", Math.round(level * 100f / scale))
                    .put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
        } catch (JSONException e) {
            return null;
        }
    }

    private int volumePercent() {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max > 0 ? Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max) : 0;
    }

    private boolean muted() {
        return audio.isStreamMute(AudioManager.STREAM_MUSIC) || audio.getStreamVolume(AudioManager.STREAM_MUSIC) == 0;
    }

    private int brightnessPercent() {
        if (windowBrightness >= 0) return Math.round(windowBrightness * 100);
        try {
            return Math.round(Settings.System.getInt(context.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) * 100f / 255);
        } catch (Settings.SettingNotFoundException e) {
            return -1;
        }
    }

    private JSONObject state() throws JSONException {
        JSONObject out = new JSONObject();
        out.put("battery", battery == null ? JSONObject.NULL : battery);
        Network active = connectivity.getActiveNetwork();
        NetworkCapabilities caps = active != null ? connectivity.getNetworkCapabilities(active) : null;
        LinkProperties link = active != null ? connectivity.getLinkProperties(active) : null;
        JSONObject net = new JSONObject().put("kind", "none").put("name", "").put("signal", JSONObject.NULL);
        if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
            net.put("kind", "ethernet").put("name", "Ethernet");
        } else if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            // the SSID is Android's to give apps with location access only
            String name = "Wi-Fi";
            int signal = -1;
            if (caps.getTransportInfo() instanceof WifiInfo info) {
                String ssid = info.getSSID();
                if (ssid != null && !ssid.contains("unknown ssid")) name = ssid.replaceAll("^\"|\"$", "");
                signal = Math.round(wifi.calculateSignalLevel(info.getRssi()) * 100f / Math.max(1, wifi.getMaxSignalLevel()));
            }
            net.put("kind", "wifi").put("name", name).put("signal", signal >= 0 ? signal : JSONObject.NULL);
        }
        out.put("network", net);
        out.put("wifi", wifi.isWifiEnabled());
        String address = "";
        if (link != null) for (LinkAddress a : link.getLinkAddresses()) if (a.getAddress() instanceof Inet4Address) address = a.getAddress().getHostAddress();
        out.put("address", address);
        out.put("audio", new JSONObject().put("volume", volumePercent()).put("muted", muted()));
        BluetoothManager bm = context.getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = bm != null ? bm.getAdapter() : null;
        if (adapter == null) out.put("bluetooth", JSONObject.NULL);
        else {
            boolean on;
            try {
                on = adapter.isEnabled();
            } catch (SecurityException e) {
                on = false;
            }
            out.put("bluetooth", new JSONObject().put("powered", on));
        }
        int b = brightnessPercent();
        out.put("brightness", b >= 0 ? b : JSONObject.NULL);
        return out;
    }

    private void write() {
        File file = Linux.stateFile(context);
        try {
            File partial = new File(file.getPath() + ".partial");
            Assets.write(partial, state().toString());
            if (!partial.renameTo(file)) Log.w(MainActivity.TAG, "could not place " + file);
        } catch (JSONException e) {
            Log.w(MainActivity.TAG, "the device's state", e);
        }
    }

    // ---- the volume keys ----

    /** A volume key: the media volume up or down by 5%, and the OSD. */
    void volumeKey(int direction) {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int now = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        int step = Math.max(1, Math.round(max * 0.05f));
        int next = Math.max(0, Math.min(max, now + direction * step));
        if (direction > 0 && audio.isStreamMute(AudioManager.STREAM_MUSIC)) audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, next, 0);
        osd();
        changed();
    }

    /** Omarchy's volume OSD (daemon/volume-keys.ts levelOsd) for the media volume. */
    private void osd() {
        int percent = volumePercent();
        boolean muted = muted();
        try {
            JSONObject osd = new JSONObject()
                    .put("icon", muted ? MUTED : SPEAKER)
                    .put("value", percent)
                    .put("max", 100)
                    .put("progressText", muted ? "Muted" : percent + "%");
            Native.shellEvent(new JSONObject().put("event", "osd").put("osd", osd).toString());
        } catch (JSONException ignored) {
        }
    }

    // ---- commands from omarchy-pocketd ----

    private void run(File file) {
        String text = Assets.read(file);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
        if (text.isEmpty()) return;
        try {
            JSONObject c = new JSONObject(text);
            switch (c.optString("command")) {
                case "volume": {
                    int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(c.getInt("percent") / 100f * max), 0);
                    break;
                }
                case "mute": {
                    Object muted = c.opt("muted");
                    int how = "toggle".equals(muted) ? AudioManager.ADJUST_TOGGLE_MUTE : Boolean.TRUE.equals(muted) ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
                    audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, how, 0);
                    osd();
                    break;
                }
                case "brightness":
                    windowBrightness = Math.max(0.05f, Math.min(1f, c.getInt("percent") / 100f));
                    brightness.set(windowBrightness);
                    break;
                case "settings":
                    open(settings(c.optString("panel")));
                    break;
                case "open":
                    open(new Intent(Intent.ACTION_VIEW, Uri.parse(c.getString("url"))));
                    break;
                default:
                    Log.w(MainActivity.TAG, "unknown command " + text);
            }
        } catch (JSONException e) {
            Log.w(MainActivity.TAG, "command " + text, e);
        }
        changed();
    }

    private static Intent settings(String panel) {
        switch (panel) {
            case "wifi": return new Intent(Settings.Panel.ACTION_WIFI);
            case "internet": return new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY);
            case "bluetooth": return new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            case "sound": return new Intent(Settings.Panel.ACTION_VOLUME);
            case "display": return new Intent(Settings.ACTION_DISPLAY_SETTINGS);
            case "battery": return new Intent(Intent.ACTION_POWER_USAGE_SUMMARY);
            default: return new Intent(Settings.ACTION_SETTINGS);
        }
    }

    private void open(Intent intent) {
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException e) {
            Log.w(MainActivity.TAG, "opening " + intent, e);
        }
    }
}
