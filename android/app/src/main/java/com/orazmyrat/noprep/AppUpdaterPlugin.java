package com.orazmyrat.noprep;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Downloads a newer APK (from our own GitHub release, never a user-supplied URL) and hands it to
// Android's package installer. There is no silent/automatic install path for a normal app on
// Android, so this still ends in the OS's own "Install this update?" confirmation — the point is
// to replace "leave the app, open a browser, download, find it in Downloads, tap it" with one
// in-app tap.
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    // Play Store installs already get Play's own update flow; offering this APK-swap update
    // there too would have the app fighting Play for who owns the install, which risks the
    // listing. Only a sideloaded (GitHub APK) install should ever see this nudge.
    @PluginMethod
    public void isPlayStoreInstall(PluginCall call) {
        String installer = null;
        try {
            installer = getContext().getPackageManager().getInstallerPackageName(getContext().getPackageName());
        } catch (Exception ignored) {
            // No installer recorded (e.g. adb install) — treat the same as "not Play Store".
        }
        JSObject result = new JSObject();
        result.put("value", "com.android.vending".equals(installer));
        call.resolve(result);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String urlString = call.getString("url");
        if (urlString == null || urlString.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        String scheme = Uri.parse(urlString).getScheme();
        if (!"https".equalsIgnoreCase(scheme)) {
            call.reject("Only https URLs are allowed");
            return;
        }

        new Thread(() -> runDownload(call, urlString)).start();
    }

    private void runDownload(PluginCall call, String urlString) {
        File target = new File(getContext().getCacheDir(), "update.apk");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(urlString).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.connect();

            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                call.reject("Download failed with status " + status);
                return;
            }

            long totalBytes = connection.getContentLength();
            long readBytes = 0;
            int lastPercent = -1;

            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    readBytes += read;
                    if (totalBytes > 0) {
                        int percent = (int) Math.min(100, (readBytes * 100) / totalBytes);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                }
            }

            getActivity().runOnUiThread(() -> {
                try {
                    launchInstaller(target);
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Unable to launch installer", error);
                }
            });
        } catch (Exception error) {
            call.reject("Download failed", error);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void launchInstaller(File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apkFile
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }
}
