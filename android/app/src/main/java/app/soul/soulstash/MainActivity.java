package app.soul.soulstash;

import android.os.Build;
import android.os.Bundle;
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

        super.onCreate(savedInstanceState);

        Window window = getWindow();

        // Notch/cutout support
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        // Full screen / hide system bars
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }

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
        if (hasFocus) {
            Window window = getWindow();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                }
            } else {
                window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                );
            }
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge != null && this.bridge.getWebView() != null) {
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
                }

                @Override
                public android.graphics.Bitmap getDefaultVideoPoster() {
                    // Prevent Android WebView from displaying the giant default play button poster
                    return android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888);
                }
            });

            // Handle download links (APKs, files) by opening external intent
            this.bridge.getWebView().setDownloadListener((downloadUrl, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Download intent error", e);
                }
            });

            // Handle URL navigation
            this.bridge.getWebView().setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();

                    if (request.isForMainFrame()) {
                        boolean isAllowed = url.startsWith("http://localhost") ||
                                            url.startsWith("https://localhost") ||
                                            url.startsWith("capacitor://localhost") ||
                                            url.startsWith("https://soulstash.onrender.com") ||
                                            url.startsWith("content://") ||
                                            url.startsWith("file://");

                        if (!isAllowed) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                            } catch (Exception e) {
                                android.util.Log.e("MainActivity", "External browser intent error", e);
                            }
                            return true;
                        }
                    }

                    return super.shouldOverrideUrlLoading(view, request);
                }
            });
        }
    }
}
