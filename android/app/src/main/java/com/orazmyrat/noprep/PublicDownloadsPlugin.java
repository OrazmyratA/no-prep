package com.orazmyrat.noprep;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "PublicDownloads")
public class PublicDownloadsPlugin extends Plugin {
    @PluginMethod
    public void saveTextFile(PluginCall call) {
        String filename = call.getString("filename");
        String content = call.getString("content");
        String mimeType = call.getString("mimeType", "application/json");
        String relativePath = call.getString("relativePath", Environment.DIRECTORY_DOWNLOADS);

        if (filename == null || filename.trim().isEmpty()) {
            call.reject("filename is required");
            return;
        }

        if (content == null) {
            call.reject("content is required");
            return;
        }

        try {
            Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveWithMediaStore(filename, content.getBytes(StandardCharsets.UTF_8), mimeType, relativePath)
                : saveLegacyDownload(filename, content.getBytes(StandardCharsets.UTF_8), relativePath);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to save file to Downloads", error);
        }
    }

    @PluginMethod
    public void saveBase64File(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String relativePath = call.getString("relativePath", Environment.DIRECTORY_DOWNLOADS);

        if (filename == null || filename.trim().isEmpty()) {
            call.reject("filename is required");
            return;
        }

        if (data == null) {
            call.reject("data is required");
            return;
        }

        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveWithMediaStore(filename, bytes, mimeType, relativePath)
                : saveLegacyDownload(filename, bytes, relativePath);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to save file to Downloads", error);
        }
    }

    private Uri saveWithMediaStore(String filename, byte[] content, String mimeType, String relativePath) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, sanitizeRelativePath(relativePath));
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IllegalStateException("Could not create Downloads entry");
        }

        try (OutputStream stream = resolver.openOutputStream(uri)) {
            if (stream == null) {
                throw new IllegalStateException("Could not open Downloads entry");
            }
            stream.write(content);
        }

        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return uri;
    }

    private Uri saveLegacyDownload(String filename, byte[] content, String relativePath) throws Exception {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File targetDirectory = legacyDirectory(downloads, relativePath);
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            throw new IllegalStateException("Could not create Downloads directory");
        }

        File file = uniqueFile(targetDirectory, filename);
        try (FileOutputStream stream = new FileOutputStream(file)) {
            stream.write(content);
        }
        return Uri.fromFile(file);
    }

    private String sanitizeRelativePath(String relativePath) {
        String fallback = Environment.DIRECTORY_DOWNLOADS;
        String input = relativePath == null || relativePath.trim().isEmpty() ? fallback : relativePath.trim();
        input = input.replace("\\", "/");
        // Iteratively remove ".." to prevent bypass via "..../" sequences
        String previous;
        do {
            previous = input;
            input = input.replace("..", "");
        } while (!input.equals(previous));
        if (!input.startsWith(Environment.DIRECTORY_DOWNLOADS)) {
            input = Environment.DIRECTORY_DOWNLOADS + "/" + input;
        }
        return input;
    }

    private File legacyDirectory(File downloads, String relativePath) throws java.io.IOException {
        String sanitized = sanitizeRelativePath(relativePath).replace("\\", "/");
        String prefix = Environment.DIRECTORY_DOWNLOADS;
        if (sanitized.equals(prefix)) {
            return downloads;
        }
        String suffix = sanitized.startsWith(prefix + "/") ? sanitized.substring(prefix.length() + 1) : sanitized;
        File resolved = new File(downloads, suffix).getCanonicalFile();
        String downloadsCanonical = downloads.getCanonicalPath();
        if (!resolved.getAbsolutePath().startsWith(downloadsCanonical + File.separator)
                && !resolved.getAbsolutePath().equals(downloadsCanonical)) {
            throw new SecurityException("Path traversal detected");
        }
        return resolved;
    }

    private File uniqueFile(File directory, String filename) {
        File file = new File(directory, filename);
        if (!file.exists()) {
            return file;
        }

        int dotIndex = filename.lastIndexOf('.');
        String base = dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
        String extension = dotIndex > 0 ? filename.substring(dotIndex) : "";

        for (int index = 1; index < 1000; index++) {
            File candidate = new File(directory, base + " (" + index + ")" + extension);
            if (!candidate.exists()) {
                return candidate;
            }
        }

        return new File(directory, base + "-" + System.currentTimeMillis() + extension);
    }
}
