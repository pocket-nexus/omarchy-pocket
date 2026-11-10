package dev.pocketnexus.omarchy;

import android.view.Surface;

/** libomarchy_pocket.so (host/src/android.rs): the shell's program. */
final class Native {
    static {
        System.loadLibrary("omarchy_pocket");
    }

    private Native() {}

    /** Starts the shell's thread once per process, on the package at
     *  {@code pocket}, talking to omarchy-pocketd at {@code bridge}; the
     *  daemon's absolute paths lie under {@code root}; {@code wifi} answers
     *  PocketJS's system.wifi for the shell. */
    static native void start(String pocket, String bridge, String root, Wifi wifi);

    /** A display's surface: 0 the upper display, 1 the lower; null when it
     *  goes away. Returns once the shell's thread has taken it. */
    static native void setSurface(int display, Surface surface);

    /** PocketJS buttons ({@link Gamepad}'s bits) down or up. */
    static native void button(int bits, boolean down);

    /** Both sticks, each axis -1..1. */
    static native void sticks(float lx, float ly, float rx, float ry);

    /** A contact on the lower display, x and y 0..1 across its view:
     *  action 0 down or moved, 1 lifted, 2 cancelled. */
    static native void touch(int pointer, int action, float x, float y);

    /** A line for the shell as if omarchy-pocketd had sent it (JSON). */
    static native void shellEvent(String line);

    static native void stop();

    /** Unpacks the Linux root's .tar.zst into {@code root}, telling
     *  {@code listener} the compressed bytes read; null, or the failure. */
    static native String installRoot(String archive, String root, Linux.Progress listener);
}
