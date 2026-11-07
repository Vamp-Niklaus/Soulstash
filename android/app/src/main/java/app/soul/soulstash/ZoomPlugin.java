package app.soul.soulstash;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ZoomPlugin")
public class ZoomPlugin extends Plugin {

    @PluginMethod
    public void setScale(PluginCall call) {
        float scale = call.getFloat("scale", 1.15f);
        ((MainActivity) getActivity()).setFullscreenScale(scale);
        call.resolve();
    }
}
