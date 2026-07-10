package com.orazmyrat.noprep;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PublicDownloadsPlugin.class);
        registerPlugin(NativeAudioRecorderPlugin.class);
        registerPlugin(NativeBookStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
