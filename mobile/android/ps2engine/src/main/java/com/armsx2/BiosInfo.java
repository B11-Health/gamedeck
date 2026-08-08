package com.armsx2;

import java.util.Locale;

/** JNI value object used by the embedded PCSX2-derived engine. */
public final class BiosInfo {
    public final int version;
    public final int region;
    public final String description;
    public final String zone;

    public BiosInfo(int version, int region, String description, String zone) {
        this.version = version;
        this.region = region;
        this.description = description == null ? "" : description;
        this.zone = zone == null ? "" : zone;
    }

    public String getVersionString() {
        return String.format(Locale.US, "v%d.%02d", (version >> 8) & 0xff, version & 0xff);
    }

    public String getRegionFlag() {
        switch (region) {
            case 0: return "JP";
            case 1: return "US";
            case 2: return "EU";
            case 4: return "HK";
            case 6: return "CN";
            case 8: return "DEV";
            case 9: return "TEST";
            default: return "GLOBAL";
        }
    }
}
