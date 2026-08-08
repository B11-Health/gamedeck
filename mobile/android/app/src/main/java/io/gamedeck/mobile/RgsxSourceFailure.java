package io.gamedeck.mobile;

import java.net.HttpURLConnection;

final class RgsxSourceFailure {
    final String reasonCode;
    final String message;
    final boolean retryable;

    private RgsxSourceFailure(String reasonCode, String message, boolean retryable) {
        this.reasonCode = reasonCode;
        this.message = message;
        this.retryable = retryable;
    }

    static RgsxSourceFailure forHttpStatus(int status) {
        if (status == HttpURLConnection.HTTP_UNAUTHORIZED
                || status == HttpURLConnection.HTTP_FORBIDDEN) {
            return new RgsxSourceFailure(
                "android_rgsx_source_authorization_required",
                "This catalog source requires authorization and is not currently available in GameDeck.",
                false
            );
        }
        if (status == HttpURLConnection.HTTP_NOT_FOUND
                || status == HttpURLConnection.HTTP_GONE) {
            return new RgsxSourceFailure(
                "android_rgsx_source_removed",
                "This catalog file has been removed or is no longer available from its source.",
                false
            );
        }
        if (status == 429) {
            return new RgsxSourceFailure(
                "android_rgsx_source_rate_limited",
                "The catalog source is temporarily limiting downloads. Try again later.",
                true
            );
        }
        if (status >= 500 && status <= 599) {
            return new RgsxSourceFailure(
                "android_rgsx_source_server_error",
                "The catalog source is temporarily unavailable (HTTP " + status + "). Try again later.",
                true
            );
        }
        return new RgsxSourceFailure(
            "android_rgsx_source_http_" + status,
            "The catalog source rejected this download (HTTP " + status + ").",
            status == HttpURLConnection.HTTP_CLIENT_TIMEOUT || status == 425
        );
    }
}
