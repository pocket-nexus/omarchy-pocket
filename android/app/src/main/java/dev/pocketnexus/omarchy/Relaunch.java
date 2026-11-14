package dev.pocketnexus.omarchy;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.Intent;
import android.os.Bundle;
import android.view.Display;

/**
 * Starts the stage on the upper display. {@link MainActivity}, started on
 * another display (a launcher on the lower one: the Duo Lite's and the
 * Thor's both show one there), starts this and removes its own task; this
 * one, in a task of its own and with no window, starts it again on display
 * 0 and finishes. MainActivity is singleTask, so starting it from itself
 * would only hand the running instance a new intent on the display it is on.
 */
public final class Relaunch extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent stage = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(stage, ActivityOptions.makeBasic().setLaunchDisplayId(Display.DEFAULT_DISPLAY).toBundle());
        finish();
    }
}
