package dev.pocketnexus.omarchy;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** The packages the app carries in its assets, copied to its files once per
 *  install or update: the runtime reads a package from a file. */
final class Assets {
    private Assets() {}

    /** The shell package's path. */
    static String shell(Context context) {
        File out = new File(context.getFilesDir(), "omarchy-pocket.pocket");
        copy(context, "omarchy-pocket.pocket", out);
        return out.getAbsolutePath();
    }

    /** The install's identity: a new APK copies its assets again. */
    static long stamp(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    /** Copies once per install: a stamp beside the file names the install. */
    static void copy(Context context, String asset, File out) {
        long stamp = stamp(context);
        File mark = new File(out.getPath() + ".stamp");
        if (out.exists() && mark.exists() && read(mark).equals(Long.toString(stamp))) return;
        if (place(context, asset, out)) write(mark, Long.toString(stamp));
    }

    /** Copies the asset over {@code out} through a partial file. */
    static boolean place(Context context, String asset, File out) {
        File parent = out.getParentFile();
        if (parent != null) parent.mkdirs();
        File partial = new File(out.getPath() + ".partial");
        try (InputStream in = context.getAssets().open(asset); OutputStream o = new FileOutputStream(partial)) {
            byte[] buffer = new byte[1 << 16];
            for (int n; (n = in.read(buffer)) > 0; ) o.write(buffer, 0, n);
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "copying " + asset, e);
            return false;
        }
        if (!partial.renameTo(out)) {
            Log.e(MainActivity.TAG, "could not place " + out);
            return false;
        }
        return true;
    }

    static String read(File file) {
        try (InputStream in = new java.io.FileInputStream(file)) {
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).trim();
        } catch (IOException e) {
            return "";
        }
    }

    static void write(File file, String text) {
        File parent = file.getParentFile();
        if (parent != null) parent.mkdirs();
        try (OutputStream o = new FileOutputStream(file)) {
            o.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "writing " + file, e);
        }
    }
}
