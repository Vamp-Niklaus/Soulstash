package app.soul.soulstash;

import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeTap")
public class NativeTapPlugin extends Plugin {
    @PluginMethod
    public void tap(PluginCall call) {
        final float x = call.getFloat("x", 0f);
        final float y = call.getFloat("y", 0f);
        getActivity().runOnUiThread(() -> {
            View root = getActivity().getWindow().getDecorView();
            long t = SystemClock.uptimeMillis();
            MotionEvent down = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0);
            MotionEvent up   = MotionEvent.obtain(t, t + 60, MotionEvent.ACTION_UP, x, y, 0);
            root.dispatchTouchEvent(down);
            root.dispatchTouchEvent(up);
            down.recycle();
            up.recycle();
            call.resolve(new JSObject().put("ok", true));
        });
    }
}
