package com.orazmyrat.noprep;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.util.Base64;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

@CapacitorPlugin(
    name = "NativeAudioRecorder",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class NativeAudioRecorderPlugin extends Plugin {
    private MediaRecorder recorder;
    private File outputFile;

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasMicrophonePermission()) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }

        startRecorder(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (call == null) {
            return;
        }

        if (hasMicrophonePermission()) {
            startRecorder(call);
        } else {
            call.reject("Microphone permission was not granted");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (recorder == null || outputFile == null) {
            call.reject("Recording has not started");
            return;
        }

        try {
            recorder.stop();
            releaseRecorder();

            byte[] bytes = readFile(outputFile);
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            result.put("mimeType", "audio/mp4");
            result.put("extension", "m4a");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to stop audio recording", error);
        } finally {
            deleteOutputFile();
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        releaseRecorder();
        deleteOutputFile();
        call.resolve();
    }

    private void startRecorder(PluginCall call) {
        if (recorder != null) {
            call.reject("Recording is already in progress");
            return;
        }

        try {
            outputFile = File.createTempFile("no-prep-recording-", ".m4a", getContext().getCacheDir());
            recorder = createRecorder(outputFile);
            recorder.prepare();
            recorder.start();
            call.resolve();
        } catch (Exception error) {
            releaseRecorder();
            deleteOutputFile();
            call.reject("Unable to start audio recording", error);
        }
    }

    private boolean hasMicrophonePermission() {
        return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("deprecation")
    private MediaRecorder createRecorder(File file) {
        MediaRecorder mediaRecorder = new MediaRecorder();
        mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        mediaRecorder.setAudioSamplingRate(44100);
        mediaRecorder.setAudioEncodingBitRate(128000);
        mediaRecorder.setOutputFile(file.getAbsolutePath());
        return mediaRecorder;
    }

    private byte[] readFile(File file) throws IOException {
        long length = file.length();
        if (length <= 0 || length > Integer.MAX_VALUE) {
            throw new IOException("Invalid audio file size");
        }

        byte[] bytes = new byte[(int) length];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }

            if (offset != bytes.length) {
                throw new IOException("Could not read complete audio file");
            }
        }

        return bytes;
    }

    private void releaseRecorder() {
        if (recorder == null) {
            return;
        }

        try {
            recorder.release();
        } catch (Exception ignored) {
            // Recorder cleanup should not hide the original recording error.
        } finally {
            recorder = null;
        }
    }

    private void deleteOutputFile() {
        if (outputFile != null && outputFile.exists()) {
            outputFile.delete();
        }
        outputFile = null;
    }
}
