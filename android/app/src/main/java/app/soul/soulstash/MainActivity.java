package app.soul.soulstash;

import android.os.Build;
import android.graphics.Color;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.content.Intent;
import android.net.Uri;
import android.view.KeyEvent;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private float currentScale = 1.0f;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register plugin BEFORE super.onCreate
        registerPlugin(ZoomPlugin.class);
        registerPlugin(NativeTapPlugin.class);
        registerPlugin(ApkUpdaterPlugin.class);

        super.onCreate(savedInstanceState);

        Window window = getWindow();

        // Notch/cutout support
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        // Status bar (time / battery / network) is always visible on a dark background; only the
        // navigation bar is hidden (swipe to reveal it).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        }
        applySystemBars();

        // Back button - navigate web history instead of closing app
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function(){var event=new CustomEvent('soulstash:native-back',{cancelable:true});return window.dispatchEvent(event);})()",
                        handled -> {
                            if ("false".equals(handled)) return;
                            if (webView.canGoBack()) {
                                webView.goBack();
                            } else {
                                setEnabled(false);
                                getOnBackPressedDispatcher().onBackPressed();
                            }
                        }
                    );
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().post(new Runnable() {
                    @Override
                    public void run() {
                        bridge.getWebView().evaluateJavascript(
                            "(function(){var event=new CustomEvent('soulstash:native-back',{cancelable:true});return window.dispatchEvent(event);})()",
                            handled -> {
                                if ("false".equals(handled)) {
                                    // Event was consumed/handled by SPA player back handler
                                    return;
                                }
                                if (bridge.getWebView().canGoBack()) {
                                    bridge.getWebView().goBack();
                                }
                            }
                        );
                    }
                });
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    // Called from ZoomPlugin to update scale
    public void setFullscreenScale(float scale) {
        currentScale = scale;
        runOnUiThread(() -> {
            if (customView != null) {
                customView.setScaleX(scale);
                customView.setScaleY(scale);
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-apply on every focus gain (after dialogs, keyboard, app switching) so the bars never drift.
        if (hasFocus && customView == null) {
            applySystemBars();
        }
    }

    private void applySystemBars() {
        Window window = getWindow();
        int barColor = Color.parseColor("#090A0C");
        window.setStatusBarColor(barColor);
        window.setNavigationBarColor(barColor);
        window.getDecorView().setBackgroundColor(barColor);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        controller.show(WindowInsetsCompat.Type.statusBars());
        controller.hide(WindowInsetsCompat.Type.navigationBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            // Popups must reach onCreateWindow (blocked below), and scripts may not open windows on their own.
            android.webkit.WebSettings webSettings = this.bridge.getWebView().getSettings();
            webSettings.setSupportMultipleWindows(true);
            webSettings.setJavaScriptCanOpenWindowsAutomatically(false);

            // Handle iframe fullscreen (Android native) by extending Capacitor's BridgeWebChromeClient
            this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public void onShowCustomView(View view, CustomViewCallback callback) {
                    customView = view;
                    customViewCallback = callback;

                    // Apply current scale
                    view.setScaleX(currentScale);
                    view.setScaleY(currentScale);

                    // Hide system bars in fullscreen
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowInsetsController controller = getWindow().getInsetsController();
                        if (controller != null) {
                            controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                            controller.setSystemBarsBehavior(
                                WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                            );
                        }
                    }

                    // Add fullscreen view to window
                    ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
                    view.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    ));
                    decorView.addView(view);
                }

                @Override
                public void onHideCustomView() {
                    if (customView != null) {
                        ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
                        decorView.removeView(customView);
                        customView = null;
                    }
                    if (customViewCallback != null) {
                        customViewCallback.onCustomViewHidden();
                        customViewCallback = null;
                    }
                    // Leaving video fullscreen: bring the status bar back.
                    applySystemBars();
                }

                @Override
                public android.graphics.Bitmap getDefaultVideoPoster() {
                    // Prevent Android WebView from displaying the giant default play button poster
                    return android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888);
                }

                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                    // Embedded players open popups and new tabs for ads and external links. Never create the
                    // window, so nothing is handed to Capacitor (which would open the browser).
                    android.util.Log.w("MainActivity", "Blocked popup window request");
                    return false;
                }
            });

            // Downloads: only the app's own hosts may hand a file to Android. Anything else (for example a
            // download started by an ad inside an embedded player) is dropped, so no open-with prompt appears.
            this.bridge.getWebView().setDownloadListener((downloadUrl, userAgent, contentDisposition, mimetype, contentLength) -> {
                if (!isTrustedDownloadHost(downloadUrl)) {
                    android.util.Log.w("MainActivity", "Blocked download from " + downloadUrl);
                    return;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Download intent error", e);
                }
            });

            // URL navigation: nothing is ever opened outside the app.
            //  - Main frame: only the app's own pages load. Any other URL is dropped (no browser, no chooser).
            //  - Embedded frames (players): http/https pages load inside the frame itself, including redirects
            //    and link clicks. Other schemes (intent:, market:, mailto:, tel:, app deep links) are dropped.
            this.bridge.getWebView().setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String url = uri.toString();

                    if (request.isForMainFrame()) {
                        if (isAppUrl(url)) {
                            return super.shouldOverrideUrlLoading(view, request);
                        }
                        android.util.Log.w("MainActivity", "Blocked main-frame navigation to " + url);
                        return true;
                    }

                    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                    if (scheme.equals("http") || scheme.equals("https") || scheme.equals("about")
                            || scheme.equals("blob") || scheme.equals("data")) {
                        return false;
                    }
                    android.util.Log.w("MainActivity", "Blocked frame navigation to " + url);
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    // Only used by very old WebViews that give no frame information: stay inside the app.
                    if (isAppUrl(url)) {
                        return super.shouldOverrideUrlLoading(view, url);
                    }
                    android.util.Log.w("MainActivity", "Blocked navigation to " + url);
                    return true;
                }
            });
        }
    }

    // Pages that belong to the app itself. Everything else is never opened outside the app.
    private static boolean isAppUrl(String url) {
        return url.startsWith("http://localhost") ||
               url.startsWith("https://localhost") ||
               url.startsWith("capacitor://localhost") ||
               url.startsWith("https://soulstash.onrender.com") ||
               url.startsWith("content://") ||
               url.startsWith("file://");
    }

    // Hosts allowed to hand a downloaded file to Android (app updates and the app's own servers).
    private static boolean isTrustedDownloadHost(String url) {
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return false;
            host = host.toLowerCase();
            return host.equals("localhost")
                || host.equals("soulstash.onrender.com")
                || host.equals("soulstash-backend.onrender.com")
                || host.equals("github.com")
                || host.endsWith(".githubusercontent.com");
        } catch (Exception e) {
            return false;
        }
    }
}
