package dev.pocketnexus.omarchy;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.graphics.Typeface;
import android.view.Gravity;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The upper display: the shell's stage in a SurfaceView, the controller's
 * buttons and sticks, and the Presentation on the lower display (the deck,
 * {@link DeckPresentation}). The shell itself runs on a thread of
 * libomarchy_pocket.so that outlives the activity; the activity lends it the
 * two surfaces while it is in the foreground. Their sizes are the handheld's
 * profile's ({@link Handheld}).
 */
public final class MainActivity extends Activity implements SurfaceHolder.Callback, DisplayManager.DisplayListener {
    static final String TAG = "omarchy-pocket";

    private static final int PICK_ROOT = 1;
    /** Wifi's request for location access, which Android lists networks behind */
    static final int ASK_LOCATION = 2;

    private final Gamepad gamepad = new Gamepad();
    private Handheld handheld;
    private DisplayManager displays;
    private DeckPresentation deck;
    private boolean started;
    /** handed over to Relaunch: this instance is going */
    private boolean leaving;
    private Device device;
    /** the brightness both windows ask for, 0..1, or -1 for the system's */
    private float brightness = -1;
    /** the Linux environment's status over the stage while it is not running */
    private TextView statusText;
    private ProgressBar statusBar;
    private FrameLayout statusPane;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (misplaced()) return;
        handheld = Handheld.detect(this);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        SurfaceView stage = new SurfaceView(this);
        stage.getHolder().setFixedSize(handheld.topWidth, handheld.topHeight);
        stage.getHolder().addCallback(this);
        stage.setFocusable(true);
        stage.setFocusableInTouchMode(true);
        FrameLayout root = new FrameLayout(this);
        root.addView(stage, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(statusPane(), new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        setContentView(root);
        immersive(window);
        stage.requestFocus();
        displays = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        String pocket = Assets.shell(this, handheld);
        Wifi wifi = Wifi.get(this);
        wifi.attach(this);
        Native.start(handheld.id, pocket, Linux.bridge(this), Linux.root(this).getAbsolutePath(), wifi);
        LinuxService.start(this);
        device = new Device(this, this::setBrightness);
        device.start();
        started = true;
    }

    /** The stage belongs on the upper display. Started on another one (a
     *  launcher on the lower display), or moved there with its task, it
     *  hands over to {@link Relaunch} and removes its task; true then. */
    private boolean misplaced() {
        if (leaving) return true;
        Display own = getDisplay();
        if (own == null || own.getDisplayId() == Display.DEFAULT_DISPLAY) return false;
        leaving = true;
        // a task of its own (its affinity): this one goes
        startActivity(new Intent(this, Relaunch.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finishAndRemoveTask();
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        misplaced();
    }

    /** A launcher on the lower display, started while the stage runs, hands
     *  this instance the intent and then moves its task there. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        getWindow().getDecorView().post(this::misplaced);
    }

    /** The move to another display arrives as a configuration change. */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration config) {
        super.onConfigurationChanged(config);
        misplaced();
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == ASK_LOCATION) Wifi.get(this).permissionChanged();
    }

    @Override
    protected void onDestroy() {
        if (device != null) device.stop();
        super.onDestroy();
    }

    /** The Power panel's brightness: both windows ask for it while the app is in front. */
    private void setBrightness(float level) {
        brightness = level;
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.screenBrightness = level;
        getWindow().setAttributes(attributes);
        if (deck != null) deck.setBrightness(level);
    }

    /** A band along the stage's bottom edge: what the Linux environment is
     *  doing while it is not running, with the install's progress. */
    private View statusPane() {
        statusPane = new FrameLayout(this);
        statusPane.setBackgroundColor(0xe61a1b26);
        statusPane.setPadding(48, 24, 48, 24);
        statusText = new TextView(this);
        statusText.setTextColor(0xffc0caf5);
        statusText.setTextSize(15);
        statusText.setTypeface(Typeface.MONOSPACE);
        statusPane.addView(statusText, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        statusBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        statusBar.setMax(1000);
        FrameLayout.LayoutParams bar = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 24, Gravity.BOTTOM);
        statusPane.addView(statusBar, bar);
        statusPane.setVisibility(View.GONE);
        return statusPane;
    }

    private void showStatus(Status.State state, String text, float fraction) {
        boolean shown = state == Status.State.MISSING || state == Status.State.INSTALLING || state == Status.State.FAILED;
        statusPane.setVisibility(shown ? View.VISIBLE : View.GONE);
        String percent = fraction >= 0 ? String.format(" %d%%", Math.round(fraction * 100)) : "";
        statusText.setText(text + percent);
        statusText.setPadding(0, 0, 0, fraction >= 0 ? 40 : 0);
        statusBar.setVisibility(fraction >= 0 ? View.VISIBLE : View.GONE);
        if (fraction >= 0) statusBar.setProgress(Math.round(fraction * 1000));
    }

    /** START while no root is installed: choose the archive with the system's picker. */
    private void pickRoot() {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try {
            startActivityForResult(pick, PICK_ROOT);
        } catch (android.content.ActivityNotFoundException e) {
            Log.w(TAG, "no document picker", e);
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_ROOT || result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        Context app = getApplicationContext();
        new Thread(() -> {
            File out = Linux.archive(app);
            File partial = new File(out.getPath() + ".partial");
            long total = -1;
            try (android.content.res.AssetFileDescriptor fd = app.getContentResolver().openAssetFileDescriptor(uri, "r")) {
                if (fd != null) total = fd.getLength();
            } catch (IOException | SecurityException ignored) {
            }
            try (InputStream in = app.getContentResolver().openInputStream(uri); OutputStream o = new FileOutputStream(partial)) {
                if (in == null) throw new IOException("the picker's file cannot be read");
                byte[] buffer = new byte[1 << 20];
                long copied = 0;
                for (int n; (n = in.read(buffer)) > 0; ) {
                    o.write(buffer, 0, n);
                    copied += n;
                    if (total > 0) Status.set(Status.State.INSTALLING, "Copying the archive", (float) copied / total);
                }
            } catch (IOException e) {
                Status.set(Status.State.FAILED, "Copying the archive failed: " + e.getMessage(), -1);
                return;
            }
            if (!partial.renameTo(out)) {
                Status.set(Status.State.FAILED, "Could not place " + out, -1);
                return;
            }
            app.stopService(new Intent(app, LinuxService.class));
            LinuxService.start(app);
        }, "pick-root").start();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (!started) return;
        displays.registerDisplayListener(this, new Handler(Looper.getMainLooper()));
        showDeck();
        Status.listen(this::showStatus);
    }

    @Override
    protected void onStop() {
        if (started) {
            displays.unregisterDisplayListener(this);
            hideDeck();
            Status.listen(null);
        }
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive(getWindow());
    }

    /** The lower display: a presentation display that is not the activity's. */
    private Display deckDisplay() {
        int own = getDisplay() != null ? getDisplay().getDisplayId() : Display.DEFAULT_DISPLAY;
        for (Display d : displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)) {
            if (d.getDisplayId() != own && d.getState() != Display.STATE_OFF) return d;
        }
        return null;
    }

    private void showDeck() {
        Display target = deckDisplay();
        if (deck != null && (target == null || deck.getDisplay().getDisplayId() != target.getDisplayId())) hideDeck();
        if (deck == null && target != null) {
            deck = new DeckPresentation(this, target, gamepad, handheld);
            try {
                deck.show();
                if (brightness >= 0) deck.setBrightness(brightness);
            } catch (WindowManager.InvalidDisplayException e) {
                Log.w(TAG, "the lower display took no presentation", e);
                deck = null;
            }
        }
    }

    private void hideDeck() {
        if (deck != null) {
            deck.dismiss();
            deck = null;
        }
    }

    @Override public void onDisplayAdded(int id) { showDeck(); }
    @Override public void onDisplayRemoved(int id) { showDeck(); }
    @Override public void onDisplayChanged(int id) { showDeck(); }

    static void immersive(Window window) {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    // ---- the upper display's surface ----

    @Override
    public void surfaceCreated(SurfaceHolder holder) {}

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        Native.setSurface(0, holder.getSurface());
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        Native.setSurface(0, null);
    }

    // ---- the controller ----

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BUTTON_START && event.getAction() == KeyEvent.ACTION_UP && Status.state() == Status.State.MISSING) pickRoot();
        if (gamepad.key(event)) return true;
        // the volume keys step the media volume and show Omarchy's OSD
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && device != null) device.volumeKey(code == KeyEvent.KEYCODE_VOLUME_UP ? 1 : -1);
            return true;
        }
        // Back stays in the shell: B is its back
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (gamepad.motion(event)) return true;
        return super.dispatchGenericMotionEvent(event);
    }

    /** The upper display takes no touch. */
    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        return true;
    }
}
