package com.orazmyrat.noprep;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "NativeBookStorage")
public class NativeBookStoragePlugin extends Plugin {
    private static final String BOOKS_ROOT = "NoPrep/Books";

    @PluginMethod
    public void importBook(PluginCall call) {
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Import Book")
            .setItems(new CharSequence[]{"Book folder", "Zip package"}, (dialog, which) -> {
                if (which == 0) {
                    startImportBookFolder(call);
                } else {
                    startImportBookPackage(call);
                }
            })
            .setOnCancelListener(dialog -> call.reject("CANCELLED"))
            .show());
    }

    @PluginMethod
    public void importBookFolder(PluginCall call) {
        startImportBookFolder(call);
    }

    @PluginMethod
    public void importBookPackage(PluginCall call) {
        startImportBookPackage(call);
    }

    @PluginMethod
    public void pickAndSaveFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        String[] mimeTypes = mimeTypesFromCall(call);
        intent.setType(mimeTypes.length == 1 ? mimeTypes[0] : "*/*");
        if (mimeTypes.length > 1) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handlePickAndSaveFile");
    }

    private void startImportBookFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleImportBookFolder");
    }

    private void startImportBookPackage(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream"
        });
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handleImportBookPackage");
    }

    private String[] mimeTypesFromCall(PluginCall call) {
        JSArray array = call.getArray("mimeTypes");
        if (array == null || array.length() == 0) {
            return new String[]{"*/*"};
        }
        String[] values = new String[array.length()];
        for (int index = 0; index < array.length(); index++) {
            String value = array.optString(index, "*/*");
            values[index] = value == null || value.trim().isEmpty() ? "*/*" : value;
        }
        return values;
    }

    @ActivityCallback
    private void handlePickAndSaveFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("CANCELLED");
            return;
        }

        try {
            String bookId = sanitizeSegment(call.getString("bookId", ""));
            if (bookId.isEmpty()) {
                call.reject("bookId is required");
                return;
            }

            Uri uri = result.getData().getData();
            String displayName = sanitizeSegment(getDisplayName(uri));
            if (displayName.isEmpty()) {
                displayName = "asset-" + System.currentTimeMillis();
            }

            String relativePath = sanitizeRelativePath(call.getString("relativePath", ""));
            if (relativePath.isEmpty()) {
                String targetDirectory = sanitizeRelativePath(call.getString("targetDirectory", "assets"));
                String filePrefix = sanitizeSegment(call.getString("filePrefix", "asset"));
                relativePath = targetDirectory + "/" + filePrefix + "-" + displayName;
            }

            File destination = new File(bookFolder(bookId), relativePath);
            copyUriToFile(uri, destination);

            JSObject response = new JSObject();
            response.put("relativePath", relativePath);
            response.put("fileName", displayName);
            response.put("mimeType", getContext().getContentResolver().getType(uri));
            response.put("size", destination.length());
            response.put("uri", Uri.fromFile(destination).toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not save selected file.", error);
        }
    }

    @ActivityCallback
    private void handleImportBookFolder(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("CANCELLED");
            return;
        }

        Uri treeUri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // Some providers grant temporary access only. The immediate copy still works.
        }

        try {
            DocumentFile sourceFolder = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (sourceFolder == null || !sourceFolder.isDirectory()) {
                call.reject("Selected item is not a folder.");
                return;
            }

            DocumentFile sourceBookJson = sourceFolder.findFile("book.json");
            if (sourceBookJson == null || !sourceBookJson.isFile()) {
                call.reject("Selected folder does not contain book.json.");
                return;
            }

            String bookJson = readText(sourceBookJson);
            JSONObject book = new JSONObject(bookJson);
            String sourceId = safeString(book.optString("id", ""));
            String bookId = sourceId.isEmpty() ? "book-" + UUID.randomUUID() : sanitizeSegment(sourceId);
            File destinationFolder = uniqueBookFolder(bookId);
            String finalBookId = destinationFolder.getName();

            if (!finalBookId.equals(sourceId)) {
                book.put("id", finalBookId);
            }
            if (!book.has("createdAt")) {
                book.put("createdAt", isoNow());
            }
            book.put("updatedAt", isoNow());

            copyDocumentFolder(sourceFolder, destinationFolder);
            writeText(new File(destinationFolder, "book.json"), book.toString(2));

            JSObject response = registryItem(book, destinationFolder);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not import book folder.", error);
        }
    }

    @ActivityCallback
    private void handleImportBookPackage(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("CANCELLED");
            return;
        }

        File tempFolder = new File(getContext().getCacheDir(), "noprep-book-import-" + System.currentTimeMillis());
        try {
            Uri uri = result.getData().getData();
            unzipUriToFolder(uri, tempFolder);
            File sourceBookJson = findBookJson(tempFolder);
            if (sourceBookJson == null) {
                call.reject("Book package does not contain book.json.");
                return;
            }

            File sourceFolder = sourceBookJson.getParentFile();
            if (sourceFolder == null) {
                call.reject("Book package is not valid.");
                return;
            }

            JSONObject book = new JSONObject(readText(sourceBookJson));
            String sourceId = safeString(book.optString("id", ""));
            String bookId = sourceId.isEmpty() ? "book-" + UUID.randomUUID() : sanitizeSegment(sourceId);
            File destinationFolder = uniqueBookFolder(bookId);
            String finalBookId = destinationFolder.getName();

            if (!finalBookId.equals(sourceId)) {
                book.put("id", finalBookId);
            }
            if (!book.has("createdAt")) {
                book.put("createdAt", isoNow());
            }
            book.put("updatedAt", isoNow());

            copyFileFolder(sourceFolder, destinationFolder);
            writeText(new File(destinationFolder, "book.json"), book.toString(2));
            call.resolve(registryItem(book, destinationFolder));
        } catch (Exception error) {
            call.reject("Could not import book package.", error);
        } finally {
            deleteRecursive(tempFolder);
        }
    }

    private void copyDocumentFolder(DocumentFile sourceFolder, File destinationFolder) throws Exception {
        if (!destinationFolder.exists() && !destinationFolder.mkdirs()) {
            throw new IllegalStateException("Could not create destination folder.");
        }

        DocumentFile[] children = sourceFolder.listFiles();
        for (DocumentFile child : children) {
            String childName = sanitizeSegment(child.getName());
            if (childName.isEmpty()) continue;
            File destination = new File(destinationFolder, childName);
            if (child.isDirectory()) {
                copyDocumentFolder(child, destination);
            } else if (child.isFile()) {
                copyDocumentFile(child, destination);
            }
        }
    }

    private void copyDocumentFile(DocumentFile sourceFile, File destination) throws Exception {
        File parent = destination.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Could not create destination directory.");
        }

        copyUriToFile(sourceFile.getUri(), destination);
    }

    private void copyUriToFile(Uri uri, File destination) throws Exception {
        File parent = destination.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Could not create destination directory.");
        }

        ContentResolver resolver = getContext().getContentResolver();
        try (
            InputStream input = resolver.openInputStream(uri);
            OutputStream output = new FileOutputStream(destination)
        ) {
            if (input == null) {
                throw new IllegalStateException("Could not open selected file.");
            }
            copyStream(input, output);
        }
    }

    private void copyStream(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[1024 * 256];
        int read;
        while ((read = input.read(buffer)) >= 0) {
            output.write(buffer, 0, read);
        }
    }

    private String readText(DocumentFile sourceFile) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(sourceFile.getUri())) {
            if (input == null) {
                throw new IllegalStateException("Could not read book.json.");
            }
            byte[] buffer = new byte[1024 * 16];
            StringBuilder builder = new StringBuilder();
            int read;
            while ((read = input.read(buffer)) >= 0) {
                builder.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
            }
            return builder.toString();
        }
    }

    private void writeText(File file, String content) throws Exception {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Could not create destination directory.");
        }
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String readText(File file) throws Exception {
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[1024 * 16];
            StringBuilder builder = new StringBuilder();
            int read;
            while ((read = input.read(buffer)) >= 0) {
                builder.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
            }
            return builder.toString();
        }
    }

    private void unzipUriToFolder(Uri uri, File destinationFolder) throws Exception {
        if (!destinationFolder.exists() && !destinationFolder.mkdirs()) {
            throw new IllegalStateException("Could not create import folder.");
        }

        String destinationRoot = destinationFolder.getCanonicalPath();
        InputStream rawInput = getContext().getContentResolver().openInputStream(uri);
        if (rawInput == null) {
            throw new IllegalStateException("Could not open package.");
        }
        try (
            InputStream input = rawInput;
            ZipInputStream zip = new ZipInputStream(input)
        ) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String safeName = sanitizeZipEntryName(entry.getName());
                if (safeName.isEmpty()) {
                    zip.closeEntry();
                    continue;
                }
                File target = new File(destinationFolder, safeName).getCanonicalFile();
                if (!target.getCanonicalPath().equals(destinationRoot)
                    && !target.getCanonicalPath().startsWith(destinationRoot + File.separator)) {
                    throw new SecurityException("Unsafe zip entry path.");
                }
                if (entry.isDirectory()) {
                    if (!target.exists() && !target.mkdirs()) {
                        throw new IllegalStateException("Could not create extracted folder.");
                    }
                } else {
                    File parent = target.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        throw new IllegalStateException("Could not create extracted directory.");
                    }
                    try (OutputStream output = new FileOutputStream(target)) {
                        copyStream(zip, output);
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private File findBookJson(File folder) {
        if (folder == null || !folder.exists()) return null;
        File direct = new File(folder, "book.json");
        if (direct.isFile()) return direct;
        File[] children = folder.listFiles();
        if (children == null) return null;
        for (File child : children) {
            if (child.isDirectory()) {
                File found = findBookJson(child);
                if (found != null) return found;
            }
        }
        return null;
    }

    private void copyFileFolder(File sourceFolder, File destinationFolder) throws Exception {
        if (!destinationFolder.exists() && !destinationFolder.mkdirs()) {
            throw new IllegalStateException("Could not create destination folder.");
        }
        File[] children = sourceFolder.listFiles();
        if (children == null) return;
        for (File child : children) {
            File destination = new File(destinationFolder, sanitizeSegment(child.getName()));
            if (child.isDirectory()) {
                copyFileFolder(child, destination);
            } else if (child.isFile()) {
                File parent = destination.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IllegalStateException("Could not create destination directory.");
                }
                try (
                    InputStream input = new java.io.FileInputStream(child);
                    OutputStream output = new FileOutputStream(destination)
                ) {
                    copyStream(input, output);
                }
            }
        }
    }

    private void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }

    private String getDisplayName(Uri uri) {
        String fallback = uri.getLastPathSegment();
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall back to URI segment.
        }
        return fallback == null ? "" : fallback;
    }

    private JSObject registryItem(JSONObject book, File folder) {
        JSObject item = new JSObject();
        item.put("id", book.optString("id", folder.getName()));
        item.put("title", book.optString("title", "Untitled Book"));
        item.put("folderPath", "android-data://" + BOOKS_ROOT + "/" + folder.getName());
        item.put("coverPath", book.optString("cover", ""));
        item.put("pageCount", pageCount(book));
        item.put("sizeBytes", directorySize(folder));
        item.put("createdAt", book.optString("createdAt", isoNow()));
        item.put("updatedAt", book.optString("updatedAt", isoNow()));
        return item;
    }

    private int pageCount(JSONObject book) {
        JSONArray pages = book.optJSONArray("pages");
        return pages == null ? 0 : pages.length();
    }

    private long directorySize(File file) {
        if (file == null || !file.exists()) return 0;
        if (file.isFile()) return file.length();
        long total = 0;
        File[] children = file.listFiles();
        if (children == null) return 0;
        for (File child : children) {
            total += directorySize(child);
        }
        return total;
    }

    private File uniqueBookFolder(String preferredId) {
        File root = new File(getContext().getFilesDir(), BOOKS_ROOT);
        if (!root.exists()) {
            root.mkdirs();
        }

        String safeId = sanitizeSegment(preferredId);
        if (safeId.isEmpty()) {
            safeId = "book-" + UUID.randomUUID();
        }

        File candidate = new File(root, safeId);
        if (!candidate.exists()) {
            return candidate;
        }

        for (int index = 1; index < 1000; index++) {
            candidate = new File(root, safeId + "-" + index);
            if (!candidate.exists()) {
                return candidate;
            }
        }

        return new File(root, safeId + "-" + System.currentTimeMillis());
    }

    private File bookFolder(String bookId) {
        File folder = new File(new File(getContext().getFilesDir(), BOOKS_ROOT), sanitizeSegment(bookId));
        if (!folder.exists()) {
            folder.mkdirs();
        }
        return folder;
    }

    private String sanitizeRelativePath(String value) {
        String input = value == null ? "" : value.trim().replace("\\", "/");
        while (input.contains("..")) {
            input = input.replace("..", "");
        }
        String[] parts = input.split("/");
        StringBuilder builder = new StringBuilder();
        for (String part : parts) {
            String safe = sanitizeSegment(part);
            if (safe.isEmpty()) continue;
            if (builder.length() > 0) builder.append("/");
            builder.append(safe);
        }
        return builder.toString();
    }

    private String sanitizeZipEntryName(String value) {
        return sanitizeRelativePath(value);
    }

    private String sanitizeSegment(String value) {
        String input = value == null ? "" : value.trim();
        input = input.replace("\\", "/");
        input = input.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1F]", "_");
        while (input.contains("..")) {
            input = input.replace("..", "");
        }
        return input;
    }

    private String safeString(String value) {
        return value == null ? "" : value.trim();
    }

    private String isoNow() {
        return java.time.Instant.now().toString();
    }
}
