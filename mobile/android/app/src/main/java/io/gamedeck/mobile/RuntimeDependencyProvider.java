package io.gamedeck.mobile;

/** Supplies launch dependencies without exposing provider-specific setup to the player. */
interface RuntimeDependencyProvider {
    interface Callback {
        void onProgress(String phase, int progress, String message);
        void onComplete(boolean ready, String message);
    }

    /** Returns true when the request was accepted synchronously or queued asynchronously. */
    boolean ensureFirmware(String systemId, Callback callback);
}
