package dev.pocketnexus.omarchy;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

/**
 * Keeps the Linux environment running, in the foreground so Android leaves
 * it alone while the app is in the background: installs the root when an
 * archive is there, then runs proot with start.sh (omarchy-pocketd) and
 * starts it again a second after it exits. Its output goes to logcat
 * (tag omarchy-pocketd) and to files/linux/pocketd.log.
 */
public final class LinuxService extends Service {
    private static final String CHANNEL = "linux";
    private static final int NOTIFICATION = 1;
    private static final String TAG = "omarchy-pocketd";

    private volatile boolean stopping;
    private Thread supervisor;
    private volatile Process process;

    static void start(Context context) {
        context.startForegroundService(new Intent(context, LinuxService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        foreground("Starting the Linux environment");
        if (supervisor == null) {
            supervisor = new Thread(this::supervise, "linux-supervisor");
            supervisor.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        Process p = process;
        if (p != null) p.destroy();
        if (supervisor != null) supervisor.interrupt();
        super.onDestroy();
    }

    private void foreground(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Linux environment", NotificationManager.IMPORTANCE_MIN));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.notification)
                .setContentTitle("Omarchy Pocket")
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION, n);
    }

    private void supervise() {
        if (!Linux.installed(this)) {
            File archive = Linux.archive(this);
            if (!archive.isFile()) {
                Status.set(Status.State.MISSING, "No Linux root installed. Download " + Linux.ARCHIVE + " from " + Linux.RELEASES + ", then press START and choose it.", -1);
                foreground("No Linux root installed");
                return;
            }
            Status.set(Status.State.INSTALLING, "Installing the Linux root", 0);
            foreground("Installing the Linux root");
            try {
                Linux.install(this, (read, total) -> Status.set(Status.State.INSTALLING, "Installing the Linux root", total > 0 ? (float) read / total : -1));
            } catch (IOException e) {
                Log.e(TAG, "installing the root", e);
                Status.set(Status.State.FAILED, "Installing the Linux root failed: " + e.getMessage(), -1);
                foreground("Installing the Linux root failed");
                return;
            }
        }
        int quickExits = 0;
        while (!stopping) {
            long started = System.currentTimeMillis();
            try {
                Linux.prepare(this);
                Status.set(Status.State.RUNNING, "", -1);
                foreground("Linux environment running");
                run();
            } catch (IOException e) {
                Log.e(TAG, "starting the Linux environment", e);
            }
            if (stopping) break;
            // a start that fails at once backs off, up to half a minute
            quickExits = System.currentTimeMillis() - started < 5000 ? quickExits + 1 : 0;
            if (quickExits >= 3) Status.set(Status.State.FAILED, "omarchy-pocketd keeps stopping; see logcat (omarchy-pocketd)", -1);
            try {
                Thread.sleep(Math.min(30_000, 1000L << Math.min(quickExits, 5)));
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    private void run() throws IOException {
        File log = new File(getFilesDir(), "linux/pocketd.log");
        Process p = Linux.command(this).start();
        process = p;
        try (BufferedReader out = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
             Writer file = new FileWriter(log, false)) {
            for (String line; (line = out.readLine()) != null; ) {
                Log.i(TAG, line);
                file.write(line);
                file.write('\n');
                file.flush();
            }
        }
        try {
            Log.w(TAG, "exited with " + p.waitFor());
        } catch (InterruptedException e) {
            p.destroy();
            Thread.currentThread().interrupt();
        }
        process = null;
    }
}
