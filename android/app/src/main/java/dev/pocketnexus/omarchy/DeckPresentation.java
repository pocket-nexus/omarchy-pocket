package dev.pocketnexus.omarchy;

import android.app.Presentation;
import android.content.Context;
import android.os.Bundle;
import android.view.Display;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * The lower display: the shell's deck in a SurfaceView of the profile's
 * pixels at the display's left edge, and its touch as contacts. A logical
 * size times the density can fall short of the display by a column or two
 * (the Thor's 1239 of 1240, the Duo Lite's 1278 of 1280), which stay black.
 * The window takes no focus, so the controller's keys keep going to the
 * activity.
 */
final class DeckPresentation extends Presentation implements SurfaceHolder.Callback {
    private final Gamepad gamepad;
    private final Handheld handheld;
    private SurfaceView surface;

    DeckPresentation(Context outer, Display display, Gamepad gamepad, Handheld handheld) {
        super(outer, display, R.style.Pocket_Deck);
        this.gamepad = gamepad;
        this.handheld = handheld;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(getContext());
        root.setBackgroundColor(0xff000000);
        surface = new SurfaceView(getContext());
        surface.getHolder().setFixedSize(handheld.bottomWidth, handheld.bottomHeight);
        surface.getHolder().addCallback(this);
        root.addView(surface, new FrameLayout.LayoutParams(handheld.bottomWidth, handheld.bottomHeight, Gravity.START | Gravity.TOP));
        surface.setOnTouchListener((view, event) -> touch(event, view.getWidth(), view.getHeight()));
        setContentView(root);
        MainActivity.immersive(window);
    }

    /** Every contact of the event: moved, lifted or cancelled. */
    private static boolean touch(MotionEvent event, int width, int height) {
        int action = event.getActionMasked();
        int lifted = action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP ? event.getActionIndex() : -1;
        for (int i = 0; i < event.getPointerCount(); i++) {
            int kind = action == MotionEvent.ACTION_CANCEL ? 2 : i == lifted ? 1 : 0;
            Native.touch(event.getPointerId(i), kind, event.getX(i) / width, event.getY(i) / height);
        }
        return true;
    }

    void setBrightness(float level) {
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.screenBrightness = level;
        getWindow().setAttributes(attributes);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (gamepad.key(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (gamepad.motion(event)) return true;
        return super.dispatchGenericMotionEvent(event);
    }

    @Override public void surfaceCreated(SurfaceHolder holder) {}

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        Native.setSurface(1, holder.getSurface());
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        Native.setSurface(1, null);
    }
}
