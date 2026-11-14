package dev.pocketnexus.omarchy;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.view.Display;

/**
 * The handhelds the app runs on, by their host profiles
 * (android/handhelds/&lt;id&gt;/pocket.host.json): each display's surface in
 * pixels, the logical size times the profile's raster density. The library
 * carries every profile and the app carries a shell package and applets for
 * each (assets/handhelds/&lt;id&gt;/); {@link #detect} chooses one at the start.
 */
enum Handheld {
    /** 1920 x 1080 over 1240 x 1080: 640 x 360 points over 413 x 360 */
    AYN_THOR("ayn-thor", "AYN Thor", 1920, 1080, 1239, 1080),
    /** 1920 x 1080 over 1280 x 960: 640 x 360 points over 426 x 320 */
    RETROID_POCKET_DUO_LITE("retroid-pocket-duo-lite", "Retroid Pocket Duo Lite", 1920, 1080, 1278, 960);

    /** the profile's id: the shell's ui.__host, the root's OMARCHY_POCKET_HANDHELD */
    final String id;
    /** Android's Build.MODEL on the handheld */
    final String model;
    final int topWidth, topHeight, bottomWidth, bottomHeight;
    /** the profile's raster density, shared by both displays */
    static final int DENSITY = 3;

    Handheld(String id, String model, int topWidth, int topHeight, int bottomWidth, int bottomHeight) {
        this.id = id;
        this.model = model;
        this.topWidth = topWidth;
        this.topHeight = topHeight;
        this.bottomWidth = bottomWidth;
        this.bottomHeight = bottomHeight;
    }

    /** Where its shell package and applets are in the app's assets. */
    String assets() {
        return "handhelds/" + id;
    }

    private static Handheld detected;

    /** The handheld by Build.MODEL; on another device, the one whose lower
     *  surface fits a presentation display best, so both surfaces show
     *  whole. */
    static synchronized Handheld detect(Context context) {
        if (detected != null) return detected;
        for (Handheld h : values()) {
            if (h.model.equalsIgnoreCase(Build.MODEL)) return detected = h;
        }
        Handheld best = AYN_THOR;
        DisplayManager displays = context.getSystemService(DisplayManager.class);
        Display[] lower = displays != null ? displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION) : new Display[0];
        if (lower.length > 0) {
            Display.Mode mode = lower[0].getMode();
            int w = Math.max(mode.getPhysicalWidth(), mode.getPhysicalHeight());
            int h = Math.min(mode.getPhysicalWidth(), mode.getPhysicalHeight());
            long bestWaste = Long.MAX_VALUE;
            for (Handheld candidate : values()) {
                if (candidate.bottomWidth > w || candidate.bottomHeight > h) continue;
                long waste = (long) w * h - (long) candidate.bottomWidth * candidate.bottomHeight;
                if (waste < bestWaste) {
                    bestWaste = waste;
                    best = candidate;
                }
            }
        }
        return detected = best;
    }
}
