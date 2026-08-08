package io.gamedeck.mobile;

public final class RgsxSourceFailureTest {
    private static void expect(int status, String reason, boolean retryable, String messageFragment) {
        RgsxSourceFailure failure = RgsxSourceFailure.forHttpStatus(status);
        if (!reason.equals(failure.reasonCode)) {
            throw new AssertionError(status + " reason: " + failure.reasonCode);
        }
        if (retryable != failure.retryable) {
            throw new AssertionError(status + " retryable: " + failure.retryable);
        }
        if (!failure.message.contains(messageFragment)) {
            throw new AssertionError(status + " message: " + failure.message);
        }
    }

    public static void main(String[] args) {
        expect(401, "android_rgsx_source_authorization_required", false, "requires authorization");
        expect(403, "android_rgsx_source_authorization_required", false, "requires authorization");
        expect(404, "android_rgsx_source_removed", false, "removed");
        expect(410, "android_rgsx_source_removed", false, "removed");
        expect(429, "android_rgsx_source_rate_limited", true, "limiting downloads");
        expect(500, "android_rgsx_source_server_error", true, "HTTP 500");
        expect(503, "android_rgsx_source_server_error", true, "HTTP 503");
        expect(408, "android_rgsx_source_http_408", true, "HTTP 408");
        expect(425, "android_rgsx_source_http_425", true, "HTTP 425");
        expect(451, "android_rgsx_source_http_451", false, "HTTP 451");
        System.out.println("RGSX source failure classification: PASS");
    }
}
