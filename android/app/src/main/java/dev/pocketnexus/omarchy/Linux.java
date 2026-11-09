package dev.pocketnexus.omarchy;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;

/**
 * The app's Linux environment: the RG DS Plus image's Arch Linux ARM root
 * with Omarchy (tools/android.ts rootfs), installed into the app's files and
 * run under proot (Termux's, in the native library directory as
 * libproot.so). Its first process is android/linux/start.sh as the Omarchy
 * user, which becomes omarchy-pocketd; the shell's bridge reaches it through
 * the root's /run/user/1000/omarchy-pocket/bridge.sock.
 */
final class Linux {
    /** The archive's name, in the app's external files directory (adb push
     *  writes there without any permission) or chosen with the picker. */
    static final String ARCHIVE = "omarchy-pocket-root.tar.zst";
    /** omarchy-pocketd's names for daemon/shim.ts in /usr/local/bin */
    private static final String[] SHIMS = {"hyprctl", "uwsm", "uwsm-app", "omarchy-pocket-term", "omasnap", "omarchy-launch-screensaver", "wpctl", "xdg-open"};

    private Linux() {}

    static File root(Context context) {
        return new File(context.getFilesDir(), "linux/rootfs");
    }

    /** The Omarchy user's uid and gid in the root's /etc/passwd (1002 in
     *  the RG DS Plus image, after ALARM's alarm and its own builder). */
    static int[] user(Context context) {
        for (String line : Assets.read(new File(root(context), "etc/passwd")).split("\n")) {
            String[] f = line.split(":");
            if (f.length > 3 && f[0].equals("omarchy")) {
                try {
                    return new int[] {Integer.parseInt(f[2]), Integer.parseInt(f[3])};
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return new int[] {1000, 1000};
    }

    /** The root's $XDG_RUNTIME_DIR/omarchy-pocket, as the app sees it. */
    static File runtime(Context context) {
        return new File(root(context), "run/user/" + user(context)[0] + "/omarchy-pocket");
    }

    /** omarchy-pocketd's bridge socket for the shell: a link the app keeps
     *  to the root's $XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock, whose
     *  path holds the Omarchy user's uid. */
    static String bridge(Context context) {
        return new File(context.getFilesDir(), "linux/bridge.sock").getAbsolutePath();
    }

    /** The file the app keeps Android's state in for omarchy-pocketd
     *  (daemon/android.ts). */
    static File stateFile(Context context) {
        return new File(runtime(context), "android.json");
    }

    static File archive(Context context) {
        File dir = context.getExternalFilesDir(null);
        return new File(dir != null ? dir : context.getFilesDir(), ARCHIVE);
    }

    private static File marker(Context context) {
        return new File(root(context), ".omarchy-pocket-root");
    }

    static boolean installed(Context context) {
        return marker(context).exists();
    }

    interface Progress {
        void progress(long read, long total);
    }

    /** Installs the root from the archive, then removes the archive. */
    static void install(Context context, Progress progress) throws IOException {
        File archive = archive(context);
        File root = root(context);
        if (root.exists()) delete(root);
        String failure = Native.installRoot(archive.getAbsolutePath(), root.getAbsolutePath(), progress);
        if (failure != null) throw new IOException(failure);
        Assets.write(marker(context), archive.getName() + "\n");
        if (!archive.delete()) archive.deleteOnExit();
    }

    private static void delete(File file) {
        File[] children = file.isDirectory() && !isLink(file) ? file.listFiles() : null;
        if (children != null) for (File child : children) delete(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private static boolean isLink(File file) {
        try {
            return !file.getCanonicalPath().equals(file.getAbsolutePath());
        } catch (IOException e) {
            return true;
        }
    }

    /**
     * Before each start: Android's name servers as the root's resolv.conf,
     * the runtime directory, and, after an update of the app, the daemon,
     * its start script, its shims and the Thor's applets from the app's
     * assets, so the daemon matches the app whatever root it runs in.
     */
    static void prepare(Context context) throws IOException {
        File root = root(context);
        Assets.write(new File(root, "etc/resolv.conf"), resolvConf(context));
        File runtime = runtime(context);
        if (!runtime.isDirectory() && !runtime.mkdirs()) throw new IOException("cannot make " + runtime);
        File link = new File(bridge(context));
        link.delete();
        try {
            android.system.Os.symlink(new File(runtime, "bridge.sock").getAbsolutePath(), link.getAbsolutePath());
        } catch (android.system.ErrnoException e) {
            throw new IOException("linking the bridge", e);
        }
        new File(root, "tmp").mkdirs();
        File lib = new File(root, "usr/lib/omarchy-pocket");
        lib.mkdirs();
        File stamp = new File(lib, ".app-stamp");
        String current = Long.toString(Assets.stamp(context));
        if (current.equals(Assets.read(stamp))) return;
        for (String name : new String[] {"omarchy-pocketd.js", "ghostty-vt.wasm"}) place(context, "linux/" + name, new File(lib, name), 0644);
        place(context, "linux/start.sh", new File(lib, "start.sh"), 0755);
        File bin = new File(root, "usr/local/bin");
        bin.mkdirs();
        place(context, "linux/shim.js", new File(lib, "shim.js"), 0644);
        for (String name : SHIMS) place(context, "linux/shim.js", new File(bin, name), 0755);
        File applets = new File(root, "usr/share/omarchy-pocket/applets");
        applets.mkdirs();
        String[] names = context.getAssets().list("applets");
        if (names != null) for (String name : names) place(context, "applets/" + name, new File(applets, name), 0644);
        Assets.write(stamp, current);
    }

    /** An asset at {@code out} with {@code mode}: the copy Android writes
     *  is the owner's only. */
    private static void place(Context context, String asset, File out, int mode) throws IOException {
        if (!Assets.place(context, asset, out)) throw new IOException("cannot place " + out);
        try {
            android.system.Os.chmod(out.getAbsolutePath(), mode);
        } catch (android.system.ErrnoException e) {
            throw new IOException("chmod " + out, e);
        }
    }

    /** The active network's name servers, else public ones. */
    static String resolvConf(Context context) {
        StringBuilder out = new StringBuilder("# written by Omarchy Pocket from Android's active network\n");
        List<InetAddress> servers = new ArrayList<>();
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        Network network = cm != null ? cm.getActiveNetwork() : null;
        LinkProperties link = network != null ? cm.getLinkProperties(network) : null;
        if (link != null) servers.addAll(link.getDnsServers());
        for (InetAddress a : servers) out.append("nameserver ").append(a.getHostAddress().replaceAll("%.*$", "")).append('\n');
        if (servers.isEmpty()) out.append("nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
        return out.toString();
    }

    /** proot running start.sh as the Omarchy user (uid 1000) in the root. */
    static ProcessBuilder command(Context context) {
        String lib = context.getApplicationInfo().nativeLibraryDir;
        File root = root(context);
        File tmp = new File(context.getCacheDir(), "proot");
        tmp.mkdirs();
        List<String> argv = new ArrayList<>();
        argv.add(lib + "/libproot.so");
        // no --link2symlink: the app's files take hard links, and its
        // symlinks hold absolute host paths that break when a directory
        // holding them is renamed (omarchy-theme-set renames next-theme)
        argv.add("--kill-on-exit");
        int[] user = user(context);
        argv.add("-i");
        argv.add(user[0] + ":" + user[1]);
        argv.add("-r");
        argv.add(root.getAbsolutePath());
        for (String bind : new String[] {"/dev", "/proc", "/sys", new File(root, "tmp").getAbsolutePath() + ":/dev/shm"}) {
            argv.add("-b");
            argv.add(bind);
        }
        argv.add("-w");
        argv.add("/home/omarchy");
        argv.add("/usr/bin/env");
        argv.add("-i");
        argv.add("HOME=/home/omarchy");
        argv.add("USER=omarchy");
        argv.add("LOGNAME=omarchy");
        argv.add("SHELL=/bin/bash");
        argv.add("TERM=xterm-256color");
        argv.add("LANG=C.UTF-8");
        argv.add("PATH=/usr/local/bin:/usr/bin:/bin");
        argv.add("XDG_RUNTIME_DIR=/run/user/" + user[0]);
        argv.add("TMPDIR=/tmp");
        // daemon/android.ts: Android, not systemd, logind and NetworkManager, holds the device's state
        argv.add("OMARCHY_POCKET_PLATFORM=android");
        // the profile's raster density (android/pocket.host.json): the run-time glyph atlases are baked for it
        argv.add("OMARCHY_POCKET_DENSITY=3");
        argv.add("/usr/bin/bash");
        argv.add("-l");
        argv.add("/usr/lib/omarchy-pocket/start.sh");
        ProcessBuilder builder = new ProcessBuilder(argv);
        builder.environment().clear();
        builder.environment().put("LD_LIBRARY_PATH", lib);
        builder.environment().put("PROOT_LOADER", lib + "/libproot-loader.so");
        builder.environment().put("PROOT_TMP_DIR", tmp.getAbsolutePath());
        builder.environment().put("PATH", "/system/bin");
        builder.redirectErrorStream(true);
        return builder;
    }
}
