package dev.pocketnexus.omarchy;

import android.os.Handler;
import android.os.Looper;

/** What the Linux environment is doing, for the activity's overlay and the
 *  service's notification: one line, and a fraction while it installs. */
final class Status {
    enum State { STARTING, MISSING, INSTALLING, RUNNING, FAILED }

    interface Listener {
        void status(State state, String text, float fraction);
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static State state = State.STARTING;
    private static String text = "";
    private static float fraction = -1;
    private static Listener listener;

    private Status() {}

    /** From any thread; the listener hears it on the main thread. */
    static void set(State next, String line, float done) {
        MAIN.post(() -> {
            state = next;
            text = line;
            fraction = done;
            if (listener != null) listener.status(state, text, fraction);
        });
    }

    /** On the main thread: the listener hears the current status at once. */
    static void listen(Listener next) {
        listener = next;
        if (next != null) next.status(state, text, fraction);
    }

    static State state() {
        return state;
    }
}
