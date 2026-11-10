package dev.pocketnexus.omarchy;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.ScanResult;
import android.net.wifi.SupplicantState;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSuggestion;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import java.lang.ref.WeakReference;
import java.net.Inet4Address;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * PocketJS's system.wifi (vendor/pocketjs/contracts/spec/wifi.ts) on Android:
 * what the shell's Wi-Fi panel reads and asks, answered by WifiManager.
 * libomarchy_pocket.so calls it from the shell's thread (host/src/android.rs
 * AndroidWifi). status() serves the WifiStatus the Wi-Fi broadcasts keep
 * current; an action returns at once and its outcome shows in later reads.
 *
 * The app targets Android 9 (targetSdk 28), where an app may still turn the
 * radio on and off, join a network with its passphrase, list and connect
 * through the system's saved networks, disconnect, and forget the networks
 * it added. Built for Android 10 or later it may not: join goes through
 * Android's "add network" dialog, and the rest is Android's own Wi-Fi panel
 * (openSettings), which WifiStatus.error names.
 *
 * Android lists networks and names the connected one to apps with location
 * access, with location on: the first scan asks for it on the upper display.
 */
final class Wifi {
    private static final String TAG = "omarchy-pocket-wifi";
    /** a scan's results are taken as final after this long */
    private static final long SCAN_TIMEOUT_MS = 12_000;
    private static Wifi instance;

    private final Context context;
    private final WifiManager wifi;
    private final ConnectivityManager connectivity;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** Android 9's Wi-Fi APIs answer this app (targetSdk 28) */
    private final boolean legacy;
    private WeakReference<Activity> activity = new WeakReference<>(null);

    private volatile String status = "{\"state\":\"off\",\"ssid\":\"\",\"strength\":0,\"address\":\"\",\"saved\":[],\"error\":\"\",\"networks\":[]}";
    private volatile boolean scanning;
    private volatile String error = "";
    /** the network the last join or connect asked for, until it connects: a refused passphrase names it */
    private volatile String joining = "";
    /** the saved networks' ids, by slot, as the last status listed them */
    private volatile List<Integer> savedIds = Collections.emptyList();
    private volatile List<String> savedSsids = Collections.emptyList();
    private boolean refreshPending;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            String action = intent.getAction();
            if (WifiManager.SCAN_RESULTS_AVAILABLE_ACTION.equals(action)) scanning = false;
            // the network a join or connect asked for refused its passphrase
            @SuppressWarnings("deprecation")
            boolean refused = WifiManager.SUPPLICANT_STATE_CHANGED_ACTION.equals(action)
                    && intent.getIntExtra(WifiManager.EXTRA_SUPPLICANT_ERROR, 0) == WifiManager.ERROR_AUTHENTICATING;
            if (refused && !joining.isEmpty()) error = "Wrong password for " + joining;
            refresh();
        }
    };

    static synchronized Wifi get(Context context) {
        if (instance == null) instance = new Wifi(context.getApplicationContext());
        return instance;
    }

    private Wifi(Context context) {
        this.context = context;
        wifi = context.getSystemService(WifiManager.class);
        connectivity = context.getSystemService(ConnectivityManager.class);
        legacy = context.getApplicationInfo().targetSdkVersion <= Build.VERSION_CODES.P;
        IntentFilter filter = new IntentFilter();
        filter.addAction(WifiManager.WIFI_STATE_CHANGED_ACTION);
        filter.addAction(WifiManager.NETWORK_STATE_CHANGED_ACTION);
        filter.addAction(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION);
        filter.addAction(WifiManager.RSSI_CHANGED_ACTION);
        filter.addAction(WifiManager.SUPPLICANT_STATE_CHANGED_ACTION);
        filter.addAction(LocationManager.MODE_CHANGED_ACTION);
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        refresh();
    }

    /** The activity on the upper display: permission requests and Android's dialogs open over it. */
    void attach(Activity a) {
        activity = new WeakReference<>(a);
        refresh();
    }

    /** Location access was granted or refused. */
    void permissionChanged() {
        if (located()) scan();
        refresh();
    }

    // ---- the contract's ops, from the shell's thread ----

    String status() {
        return status;
    }

    boolean setEnabled(boolean on) {
        if (!legacy) return settings("Android turns Wi-Fi on and off in its Wi-Fi panel");
        @SuppressWarnings("deprecation")
        boolean done = wifi.setWifiEnabled(on);
        return act(done, "Android refused to turn Wi-Fi " + (on ? "on" : "off"));
    }

    boolean scan() {
        if (!located()) {
            askLocation();
            return act(false, locationError());
        }
        @SuppressWarnings("deprecation")
        boolean started = wifi.startScan();
        // Android allows four scans in two minutes; a refused one still has the last results
        scanning = started;
        if (started) main.postDelayed(() -> {
            scanning = false;
            refresh();
        }, SCAN_TIMEOUT_MS);
        error = "";
        refresh();
        return true;
    }

    boolean join(String ssid, String passphrase) {
        if (!legacy) return suggest(ssid, passphrase);
        WifiConfiguration config = new WifiConfiguration();
        config.SSID = quote(ssid);
        String capabilities = capabilitiesOf(ssid);
        if (capabilities.contains("EAP")) return settings(ssid + " signs in with an account: join it in Android's Wi-Fi panel");
        if (passphrase.isEmpty()) {
            // a secured network saved with no key could never connect
            if (secured(capabilities)) return act(false, ssid + " needs its password");
            config.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
        } else if (capabilities.contains("SAE") && !capabilities.contains("PSK") && Build.VERSION.SDK_INT >= 30) {
            config.setSecurityParams(WifiConfiguration.SECURITY_TYPE_SAE);
            config.preSharedKey = quote(passphrase);
        } else {
            config.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK);
            config.preSharedKey = quote(passphrase);
        }
        @SuppressWarnings("deprecation")
        int id = wifi.addNetwork(config);
        // a network Android saved for itself keeps its own passphrase
        if (id == -1) id = savedIdOf(ssid);
        if (id == -1) return act(false, "Android refused to save " + ssid);
        joining = ssid;
        return act(enable(id), "Android refused to connect to " + ssid);
    }

    boolean connect(int slot) {
        if (!legacy) return settings("Android connects to saved networks in its Wi-Fi panel");
        List<Integer> ids = savedIds;
        if (slot < 0 || slot >= ids.size()) return false;
        joining = savedSsids.get(slot);
        return act(enable(ids.get(slot)), "Android refused to connect to " + savedSsids.get(slot));
    }

    boolean forget(int slot) {
        if (!legacy) return settings("Android forgets networks in its Wi-Fi panel");
        List<Integer> ids = savedIds;
        if (slot < 0 || slot >= ids.size()) return false;
        @SuppressWarnings("deprecation")
        boolean removed = wifi.removeNetwork(ids.get(slot));
        if (!removed) return settings("Android saved " + savedSsids.get(slot) + " itself: forget it in Android's Wi-Fi panel");
        return act(true, "");
    }

    boolean disconnect() {
        if (!legacy) return settings("Android leaves networks in its Wi-Fi panel");
        @SuppressWarnings("deprecation")
        boolean done = wifi.disconnect();
        return act(done, "Android refused to disconnect");
    }

    boolean openSettings() {
        Activity a = activity.get();
        Intent intent = new Intent(Settings.Panel.ACTION_WIFI);
        main.post(() -> {
            try {
                if (a != null) a.startActivity(intent);
                else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (RuntimeException e) {
                Log.w(TAG, "the Wi-Fi panel", e);
            }
        });
        return true;
    }

    // ---- the work behind them ----

    /** An action's outcome: its error when refused, and a fresh status. */
    private boolean act(boolean done, String refused) {
        error = done ? "" : refused;
        refresh();
        return done;
    }

    /** An op only Android's own Wi-Fi panel does: the reason, and the panel. */
    private boolean settings(String reason) {
        openSettings();
        return act(false, reason);
    }

    @SuppressWarnings("deprecation")
    private boolean enable(int id) {
        wifi.disconnect();
        boolean enabled = wifi.enableNetwork(id, true);
        wifi.reconnect();
        return enabled;
    }

    /** Android 10 and later: Android's "add network" dialog saves and joins it. */
    private boolean suggest(String ssid, String passphrase) {
        Activity a = activity.get();
        if (a == null || Build.VERSION.SDK_INT < 30) return settings("Join " + ssid + " in Android's Wi-Fi panel");
        WifiNetworkSuggestion.Builder builder = new WifiNetworkSuggestion.Builder().setSsid(ssid);
        if (!passphrase.isEmpty()) {
            if (capabilitiesOf(ssid).contains("SAE") && !capabilitiesOf(ssid).contains("PSK")) builder.setWpa3Passphrase(passphrase);
            else builder.setWpa2Passphrase(passphrase);
        }
        ArrayList<WifiNetworkSuggestion> list = new ArrayList<>();
        list.add(builder.build());
        Bundle extras = new Bundle();
        extras.putParcelableArrayList(Settings.EXTRA_WIFI_NETWORK_LIST, list);
        main.post(() -> a.startActivity(new Intent(Settings.ACTION_WIFI_ADD_NETWORKS).putExtras(extras)));
        return act(true, "");
    }

    private boolean located() {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        LocationManager location = context.getSystemService(LocationManager.class);
        return location == null || location.isLocationEnabled();
    }

    private String locationError() {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return "Android lists Wi-Fi networks to apps with location access: allow it on the upper screen";
        }
        return "Android lists Wi-Fi networks with location on: turn it on in Android's quick settings";
    }

    private void askLocation() {
        Activity a = activity.get();
        if (a == null || context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) return;
        main.post(() -> a.requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, MainActivity.ASK_LOCATION));
    }

    private static String quote(String s) {
        return "\"" + s + "\"";
    }

    private static String unquote(String s) {
        if (s == null) return "";
        return s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"") ? s.substring(1, s.length() - 1) : s;
    }

    private String capabilitiesOf(String ssid) {
        if (!located()) return "";
        try {
            for (ScanResult r : wifi.getScanResults()) if (ssid.equals(r.SSID)) return r.capabilities;
        } catch (SecurityException ignored) {
        }
        return "";
    }

    /** A scan's capabilities that ask for a key. */
    private static boolean secured(String caps) {
        return caps.contains("WEP") || caps.contains("PSK") || caps.contains("EAP") || caps.contains("SAE");
    }

    private int savedIdOf(String ssid) {
        List<String> ssids = savedSsids;
        int at = ssids.indexOf(ssid);
        return at >= 0 ? savedIds.get(at) : -1;
    }

    /** 0..3 bars, as the contract counts them. */
    @SuppressWarnings("deprecation")
    private static int bars(int rssi) {
        return WifiManager.calculateSignalLevel(rssi, 4);
    }

    /** 0..100, as NetworkManager reports signal: -100 dBm to -50 dBm. */
    private static int signal(int rssi) {
        return Math.max(0, Math.min(100, 2 * (rssi + 100)));
    }

    /** Builds the status again on the main thread, once for a burst of changes. */
    void refresh() {
        if (refreshPending) return;
        refreshPending = true;
        main.post(() -> {
            refreshPending = false;
            try {
                status = build().toString();
            } catch (JSONException | RuntimeException e) {
                Log.w(TAG, "status", e);
            }
        });
    }

    @SuppressWarnings("deprecation")
    private JSONObject build() throws JSONException {
        JSONObject out = new JSONObject();
        int radio = wifi.getWifiState();
        WifiInfo info = wifi.getConnectionInfo();
        SupplicantState supplicant = info != null ? info.getSupplicantState() : SupplicantState.DISCONNECTED;
        boolean on = radio == WifiManager.WIFI_STATE_ENABLED;
        String state;
        if (!on) state = "off";
        else if (supplicant == SupplicantState.COMPLETED && info.getNetworkId() != -1) state = "connected";
        else if (supplicant == SupplicantState.ASSOCIATING || supplicant == SupplicantState.ASSOCIATED || supplicant == SupplicantState.AUTHENTICATING
                || supplicant == SupplicantState.FOUR_WAY_HANDSHAKE || supplicant == SupplicantState.GROUP_HANDSHAKE) state = "connecting";
        else state = "idle";
        String ssid = info != null && !"idle".equals(state) && !"off".equals(state) ? unquote(info.getSSID()) : "";
        if (ssid.contains("<unknown ssid>")) ssid = "";
        if ("connected".equals(state)) joining = "";
        out.put("state", state);
        out.put("ssid", ssid);
        out.put("strength", "connected".equals(state) ? bars(info.getRssi()) : 0);
        out.put("address", address());

        // the saved networks Android lists to this app: every one at targetSdk 28 with location access
        List<Integer> ids = new ArrayList<>();
        List<String> ssids = new ArrayList<>();
        JSONArray saved = new JSONArray();
        if (legacy && located()) {
            try {
                List<WifiConfiguration> configs = wifi.getConfiguredNetworks();
                if (configs != null) {
                    for (WifiConfiguration c : configs) {
                        String name = unquote(c.SSID);
                        if (name.isEmpty() || ssids.contains(name)) continue;
                        saved.put(new JSONObject().put("slot", ids.size()).put("ssid", name));
                        ids.add(c.networkId);
                        ssids.add(name);
                    }
                }
            } catch (SecurityException e) {
                Log.w(TAG, "saved networks", e);
            }
        }
        savedIds = ids;
        savedSsids = ssids;
        out.put("saved", saved);

        // the last scan: one entry per SSID, the strongest, the connected one first
        JSONArray networks = new JSONArray();
        if (on && located()) {
            Map<String, ScanResult> best = new HashMap<>();
            try {
                for (ScanResult r : wifi.getScanResults()) {
                    if (r.SSID == null || r.SSID.isEmpty()) continue;
                    ScanResult seen = best.get(r.SSID);
                    if (seen == null || r.level > seen.level) best.put(r.SSID, r);
                }
            } catch (SecurityException e) {
                Log.w(TAG, "scan results", e);
            }
            List<ScanResult> sorted = new ArrayList<>(best.values());
            final String connected = ssid;
            sorted.sort((a, b) -> a.SSID.equals(connected) ? -1 : b.SSID.equals(connected) ? 1 : b.level - a.level);
            for (ScanResult r : sorted) {
                String caps = r.capabilities == null ? "" : r.capabilities;
                networks.put(new JSONObject()
                        .put("ssid", r.SSID)
                        .put("strength", bars(r.level))
                        .put("signal", signal(r.level))
                        .put("secure", secured(caps))
                        .put("saved", ssids.contains(r.SSID) || r.SSID.equals(connected)));
            }
        }
        out.put("networks", networks);
        out.put("scanning", scanning);
        String shown = error;
        if (shown.isEmpty() && on && !located()) shown = locationError();
        out.put("error", shown);
        return out;
    }

    /** The Wi-Fi network's IPv4 address. */
    private String address() {
        for (Network n : connectivity.getAllNetworks()) {
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(n);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            LinkProperties link = connectivity.getLinkProperties(n);
            if (link == null) continue;
            for (LinkAddress a : link.getLinkAddresses()) if (a.getAddress() instanceof Inet4Address) return a.getAddress().getHostAddress();
        }
        return "";
    }
}
