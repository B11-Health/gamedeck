#define _GNU_SOURCE
#include <jni.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "include/libretro.h"

#define TAG "GameDeckLibretro"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)
#define AUDIO_RING_SHORTS (1u << 19)
#define AUDIO_OUTPUT_RATE 48000.0
#define MAX_VARIABLES 256
#define CORE_OPTION_VALUE_CAPACITY 512
#define MAX_INPUT_DESCRIPTORS 256
#define MAX_PLAYERS 4
#define MAX_KEYS 512
#define PATH_BUFFER 4096
#define AMBIENT_GRID_WIDTH 24u
#define AMBIENT_GRID_HEIGHT 16u
#define AMBIENT_GRID_SIZE (AMBIENT_GRID_WIDTH * AMBIENT_GRID_HEIGHT)
#define AMBIENT_UPDATE_INTERVAL 12u
#define AMBIENT_BLOCK_SIZE 4u

#define LOAD_SYM(name) do { \
    host.name = dlsym(host.core_handle, #name); \
    if (!host.name) { set_error("Core is missing required symbol %s", #name); goto fail; } \
} while (0)

typedef struct {
    char *key;
    char value[CORE_OPTION_VALUE_CAPACITY];
    char *definition;
    char *default_value;
    bool visible;
} core_variable_t;

typedef struct {
    unsigned port;
    unsigned device;
    unsigned index;
    unsigned id;
    char *description;
} input_descriptor_t;

typedef struct {
    void *core_handle;
    void (*retro_init)(void);
    void (*retro_deinit)(void);
    unsigned (*retro_api_version)(void);
    void (*retro_get_system_info)(struct retro_system_info *);
    void (*retro_get_system_av_info)(struct retro_system_av_info *);
    void (*retro_set_environment)(retro_environment_t);
    void (*retro_set_video_refresh)(retro_video_refresh_t);
    void (*retro_set_audio_sample)(retro_audio_sample_t);
    void (*retro_set_audio_sample_batch)(retro_audio_sample_batch_t);
    void (*retro_set_input_poll)(retro_input_poll_t);
    void (*retro_set_input_state)(retro_input_state_t);
    void (*retro_set_controller_port_device)(unsigned, unsigned);
    retro_keyboard_event_t keyboard_callback;
    retro_core_options_update_display_callback_t options_display_callback;
    void (*retro_reset)(void);
    void (*retro_run)(void);
    size_t (*retro_serialize_size)(void);
    bool (*retro_serialize)(void *, size_t);
    bool (*retro_unserialize)(const void *, size_t);
    void (*retro_cheat_reset)(void);
    void (*retro_cheat_set)(unsigned, bool, const char *);
    bool (*retro_load_game)(const struct retro_game_info *);
    void (*retro_unload_game)(void);
    unsigned (*retro_get_region)(void);
    void *(*retro_get_memory_data)(unsigned);
    size_t (*retro_get_memory_size)(unsigned);

    pthread_mutex_t window_mutex;
    ANativeWindow *window;
    EGLDisplay egl_display;
    EGLConfig egl_config;
    EGLContext egl_context;
    EGLSurface egl_window_surface;
    EGLSurface egl_pbuffer_surface;
    struct retro_hw_render_callback hw_render;
    bool hw_render_valid;
    atomic_bool hw_surface_dirty;
    void *gles_handle;
    unsigned video_width;
    unsigned video_height;
    enum retro_pixel_format pixel_format;
    uint32_t ambient_grid[AMBIENT_GRID_SIZE];
    uint8_t *ambient_surface;
    size_t ambient_surface_capacity;
    unsigned ambient_surface_width;
    unsigned ambient_surface_height;
    unsigned ambient_tick;
    int ambient_aspect_micros;
    bool ambient_ready;

    pthread_mutex_t audio_mutex;
    pthread_mutex_t variable_mutex;
    int16_t audio_ring[AUDIO_RING_SHORTS];
    size_t audio_read;
    size_t audio_write;
    size_t audio_count;
    double audio_resample_interval;
    double audio_resample_remaining;
    double audio_resample_left_sum;
    double audio_resample_right_sum;
    double audio_resample_weight;
    unsigned long audio_overruns;

    atomic_bool loaded;
    atomic_bool running;
    atomic_bool paused;
    atomic_bool stop_requested;
    atomic_bool shutdown_requested;
    atomic_int buttons[MAX_PLAYERS][16];
    atomic_int axes[MAX_PLAYERS][6];
    atomic_int keys[MAX_KEYS];
    atomic_int pointer_x[MAX_PLAYERS];
    atomic_int pointer_y[MAX_PLAYERS];
    atomic_int pointer_pressed[MAX_PLAYERS];
    atomic_bool variables_updated;
    atomic_bool options_display_update_pending;

    double fps;
    double sample_rate;
    atomic_int aspect_micros;
    atomic_int viewport_left;
    atomic_int viewport_top;
    atomic_int viewport_right;
    atomic_int viewport_bottom;
    bool need_fullpath;
    bool supports_no_game;
    bool hardware_requested;
    char core_path[PATH_BUFFER];
    char content_path[PATH_BUFFER];
    char system_dir[PATH_BUFFER];
    char save_dir[PATH_BUFFER];
    char save_path[PATH_BUFFER];
    char diagnostic_path[PATH_BUFFER];
    int diagnostic_fd;
    atomic_int diagnostic_stage;
    atomic_ulong frame_count;
    char last_error[1024];
    void *content_data;
    size_t content_size;
    core_variable_t variables[MAX_VARIABLES];
    size_t variable_count;
    input_descriptor_t input_descriptors[MAX_INPUT_DESCRIPTORS];
    size_t input_descriptor_count;
} game_host_t;

static game_host_t host = {
    .window_mutex = PTHREAD_MUTEX_INITIALIZER,
    .audio_mutex = PTHREAD_MUTEX_INITIALIZER,
    .variable_mutex = PTHREAD_MUTEX_INITIALIZER,
    .egl_display = EGL_NO_DISPLAY,
    .egl_context = EGL_NO_CONTEXT,
    .egl_window_surface = EGL_NO_SURFACE,
    .egl_pbuffer_surface = EGL_NO_SURFACE,
    .pixel_format = RETRO_PIXEL_FORMAT_0RGB1555,
    .diagnostic_fd = -1,
};

static void diagnostic_write(const char *phase) {
    if (host.diagnostic_path[0] == '\0') return;
    int fd = open(host.diagnostic_path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return;
    char buffer[256];
    int length = snprintf(buffer, sizeof(buffer),
        "native_stage=%d\nframes=%lu\nphase=%s\n",
        atomic_load(&host.diagnostic_stage),
        atomic_load(&host.frame_count),
        phase ? phase : "unknown");
    if (length > 0) write(fd, buffer, (size_t)length);
    fsync(fd);
    close(fd);
}

static size_t append_uint(char *buffer, size_t offset, unsigned value) {
    char digits[16];
    size_t count = 0;
    do {
        digits[count++] = (char)('0' + (value % 10u));
        value /= 10u;
    } while (value && count < sizeof(digits));
    while (count) buffer[offset++] = digits[--count];
    return offset;
}

static void native_signal_handler(int signal_number) {
    int fd = host.diagnostic_fd;
    if (fd >= 0) {
        char buffer[96];
        size_t offset = 0;
        const char prefix[] = "native_signal=";
        memcpy(buffer + offset, prefix, sizeof(prefix) - 1);
        offset += sizeof(prefix) - 1;
        offset = append_uint(buffer, offset, (unsigned)signal_number);
        const char middle[] = "\nnative_stage=";
        memcpy(buffer + offset, middle, sizeof(middle) - 1);
        offset += sizeof(middle) - 1;
        offset = append_uint(buffer, offset, (unsigned)atomic_load(&host.diagnostic_stage));
        const char frames[] = "\nframes=";
        memcpy(buffer + offset, frames, sizeof(frames) - 1);
        offset += sizeof(frames) - 1;
        offset = append_uint(buffer, offset, (unsigned)atomic_load(&host.frame_count));
        buffer[offset++] = '\n';
        lseek(fd, 0, SEEK_SET);
        ftruncate(fd, 0);
        write(fd, buffer, offset);
        fsync(fd);
    }
    _exit(128 + signal_number);
}

static void install_native_signal_handlers(void) {
    const int signals[] = {SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV};
    for (size_t i = 0; i < sizeof(signals) / sizeof(signals[0]); i++) signal(signals[i], native_signal_handler);
}

static void set_stage(int stage, const char *phase) {
    atomic_store(&host.diagnostic_stage, stage);
    diagnostic_write(phase);
}

static void set_error(const char *format, ...) {
    va_list args;
    va_start(args, format);
    vsnprintf(host.last_error, sizeof(host.last_error), format, args);
    va_end(args);
    LOGE("%s", host.last_error);
}

static void clear_variables_locked(void) {
    for (size_t i = 0; i < host.variable_count; i++) {
        free(host.variables[i].key);
        free(host.variables[i].definition);
        free(host.variables[i].default_value);
        memset(&host.variables[i], 0, sizeof(host.variables[i]));
    }
    host.variable_count = 0;
}

static void clear_variables(void) {
    pthread_mutex_lock(&host.variable_mutex);
    clear_variables_locked();
    pthread_mutex_unlock(&host.variable_mutex);
}

static void clear_input_descriptors_locked(void) {
    for (size_t i = 0; i < host.input_descriptor_count; i++) {
        free(host.input_descriptors[i].description);
        memset(&host.input_descriptors[i], 0, sizeof(host.input_descriptors[i]));
    }
    host.input_descriptor_count = 0;
}

static void clear_input_descriptors(void) {
    pthread_mutex_lock(&host.variable_mutex);
    clear_input_descriptors_locked();
    pthread_mutex_unlock(&host.variable_mutex);
}

static void set_variable_default_locked(const char *key, const char *definition) {
    if (!key || !definition || host.variable_count >= MAX_VARIABLES) return;
    const char *separator = strchr(definition, ';');
    const char *value = separator ? separator + 1 : definition;
    while (*value == ' ') value++;
    size_t length = strcspn(value, "|");
    if (!length) return;
    if (length >= CORE_OPTION_VALUE_CAPACITY) return;
    char *key_copy = strdup(key);
    char *definition_copy = strdup(definition);
    char *default_copy = strndup(value, length);
    if (!key_copy || !definition_copy || !default_copy) {
        free(key_copy);
        free(definition_copy);
        free(default_copy);
        return;
    }
    core_variable_t *slot = &host.variables[host.variable_count++];
    slot->key = key_copy;
    memcpy(slot->value, value, length);
    slot->value[length] = '\0';
    slot->definition = definition_copy;
    slot->default_value = default_copy;
    slot->visible = true;
}

static bool option_value_exists(
        const struct retro_core_option_value *values, const char *requested) {
    if (!values || !requested || !*requested) return false;
    for (size_t i = 0; i < RETRO_NUM_CORE_OPTION_VALUES_MAX && values[i].value; i++) {
        if (!strcmp(values[i].value, requested)) return true;
    }
    return false;
}

static void set_modern_variable_locked(
        const char *key, const char *description,
        const struct retro_core_option_value *values, const char *default_value) {
    if (!key || !*key || !values || !values[0].value || host.variable_count >= MAX_VARIABLES) return;
    const char *title = description && *description ? description : key;
    const char *selected = option_value_exists(values, default_value) ? default_value : values[0].value;
    size_t definition_length = strlen(title) + 3u;
    size_t value_count = 0u;
    for (; value_count < RETRO_NUM_CORE_OPTION_VALUES_MAX && values[value_count].value; value_count++) {
        definition_length += strlen(values[value_count].value) + 1u;
    }
    if (strlen(selected) >= CORE_OPTION_VALUE_CAPACITY) return;
    char *definition = calloc(1u, definition_length + 1u);
    char *key_copy = strdup(key);
    char *default_copy = strdup(selected);
    if (!definition || !key_copy || !default_copy) {
        free(definition);
        free(key_copy);
        free(default_copy);
        return;
    }
    size_t offset = 0u;
    size_t title_length = strlen(title);
    memcpy(definition + offset, title, title_length);
    offset += title_length;
    definition[offset++] = ';';
    definition[offset++] = ' ';
    for (size_t i = 0; i < value_count; i++) {
        if (i) definition[offset++] = '|';
        size_t length = strlen(values[i].value);
        memcpy(definition + offset, values[i].value, length);
        offset += length;
    }
    definition[offset] = '\0';
    core_variable_t *slot = &host.variables[host.variable_count++];
    slot->key = key_copy;
    snprintf(slot->value, sizeof(slot->value), "%s", selected);
    slot->definition = definition;
    slot->default_value = default_copy;
    slot->visible = true;
}

static void set_core_options_v1_locked(const struct retro_core_option_definition *definitions) {
    clear_variables_locked();
    if (!definitions) return;
    for (; definitions->key; definitions++) {
        set_modern_variable_locked(
            definitions->key, definitions->desc, definitions->values, definitions->default_value);
    }
}

static void set_core_options_v2_locked(const struct retro_core_options_v2 *options) {
    clear_variables_locked();
    if (!options || !options->definitions) return;
    const struct retro_core_option_v2_definition *definition = options->definitions;
    for (; definition->key; definition++) {
        const char *description = definition->desc;
        if (definition->category_key && *definition->category_key
            && definition->desc_categorized && *definition->desc_categorized) {
            description = definition->desc_categorized;
        }
        set_modern_variable_locked(
            definition->key, description, definition->values, definition->default_value);
    }
}

static void capture_input_descriptors_locked(const struct retro_input_descriptor *descriptors) {
    clear_input_descriptors_locked();
    if (!descriptors) return;
    for (; descriptors->description && host.input_descriptor_count < MAX_INPUT_DESCRIPTORS; descriptors++) {
        char *description = strdup(descriptors->description);
        if (!description) continue;
        input_descriptor_t *slot = &host.input_descriptors[host.input_descriptor_count++];
        slot->port = descriptors->port;
        slot->device = descriptors->device;
        slot->index = descriptors->index;
        slot->id = descriptors->id;
        slot->description = description;
    }
}

static const char *get_variable(const char *key) {
    if (!key) return NULL;
    const char *result = NULL;
    pthread_mutex_lock(&host.variable_mutex);
    for (size_t i = 0; i < host.variable_count; i++) {
        if (host.variables[i].key && !strcmp(host.variables[i].key, key)) {
            result = host.variables[i].value;
            break;
        }
    }
    pthread_mutex_unlock(&host.variable_mutex);
    return result;
}

static void core_log(enum retro_log_level level, const char *format, ...) {
    int priority = ANDROID_LOG_INFO;
    if (level == RETRO_LOG_ERROR) priority = ANDROID_LOG_ERROR;
    else if (level == RETRO_LOG_WARN) priority = ANDROID_LOG_WARN;
    else if (level == RETRO_LOG_DEBUG) priority = ANDROID_LOG_DEBUG;
    va_list args;
    va_start(args, format);
    __android_log_vprint(priority, TAG, format, args);
    va_end(args);
}

static bool rumble_set(unsigned port, enum retro_rumble_effect effect, uint16_t strength) {
    (void)port;
    (void)effect;
    (void)strength;
    return false;
}


static uintptr_t RETRO_CALLCONV hw_get_current_framebuffer(void) {
    /* The core renders directly to the EGL surface's default framebuffer. */
    return 0;
}

static retro_proc_address_t RETRO_CALLCONV hw_get_proc_address(const char *symbol) {
    if (!symbol || !*symbol) return NULL;
    __eglMustCastToProperFunctionPointerType proc = eglGetProcAddress(symbol);
    if (proc) return (retro_proc_address_t)proc;
    if (!host.gles_handle) host.gles_handle = dlopen("libGLESv2.so", RTLD_NOW | RTLD_LOCAL);
    return host.gles_handle ? (retro_proc_address_t)dlsym(host.gles_handle, symbol) : NULL;
}

static bool hw_context_is_gles(enum retro_hw_context_type type) {
    return type == RETRO_HW_CONTEXT_OPENGLES2 ||
           type == RETRO_HW_CONTEXT_OPENGLES3 ||
           type == RETRO_HW_CONTEXT_OPENGLES_VERSION;
}

static int hw_context_major_version(void) {
    if (host.hw_render.context_type == RETRO_HW_CONTEXT_OPENGLES2) return 2;
    if (host.hw_render.context_type == RETRO_HW_CONTEXT_OPENGLES3) return 3;
    if (host.hw_render.version_major >= 2u && host.hw_render.version_major <= 3u)
        return (int)host.hw_render.version_major;
    return 3;
}

static void configure_hw_window_geometry(ANativeWindow *window);

static bool make_hw_pbuffer_current(void) {
    if (host.egl_display == EGL_NO_DISPLAY || host.egl_context == EGL_NO_CONTEXT ||
        host.egl_pbuffer_surface == EGL_NO_SURFACE) return false;
    return eglMakeCurrent(host.egl_display, host.egl_pbuffer_surface,
                          host.egl_pbuffer_surface, host.egl_context) == EGL_TRUE;
}

static void destroy_hw_context(bool notify_core) {
    if (host.egl_display == EGL_NO_DISPLAY) {
        host.hw_render_valid = false;
        host.hardware_requested = false;
        return;
    }
    if (host.egl_context != EGL_NO_CONTEXT && host.egl_pbuffer_surface != EGL_NO_SURFACE) {
        eglMakeCurrent(host.egl_display, host.egl_pbuffer_surface,
                       host.egl_pbuffer_surface, host.egl_context);
        if (notify_core && host.hw_render_valid && host.hw_render.context_destroy)
            host.hw_render.context_destroy();
    }
    eglMakeCurrent(host.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (host.egl_window_surface != EGL_NO_SURFACE)
        eglDestroySurface(host.egl_display, host.egl_window_surface);
    if (host.egl_pbuffer_surface != EGL_NO_SURFACE)
        eglDestroySurface(host.egl_display, host.egl_pbuffer_surface);
    if (host.egl_context != EGL_NO_CONTEXT)
        eglDestroyContext(host.egl_display, host.egl_context);
    eglTerminate(host.egl_display);
    host.egl_display = EGL_NO_DISPLAY;
    host.egl_config = NULL;
    host.egl_context = EGL_NO_CONTEXT;
    host.egl_window_surface = EGL_NO_SURFACE;
    host.egl_pbuffer_surface = EGL_NO_SURFACE;
    host.hw_render_valid = false;
    host.hardware_requested = false;
    atomic_store(&host.hw_surface_dirty, false);
    if (host.gles_handle) {
        dlclose(host.gles_handle);
        host.gles_handle = NULL;
    }
}

static bool initialize_hw_context(void) {
    if (!host.hardware_requested || !host.hw_render_valid) return true;
    if (!hw_context_is_gles(host.hw_render.context_type)) {
        set_error("GameDeck currently supports OpenGL ES hardware cores; requested context type=%d",
                  (int)host.hw_render.context_type);
        return false;
    }

    const int major = hw_context_major_version();
    host.egl_display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (host.egl_display == EGL_NO_DISPLAY) {
        set_error("Could not acquire Android EGL display (0x%x)", eglGetError());
        return false;
    }
    EGLint egl_major = 0, egl_minor = 0;
    if (!eglInitialize(host.egl_display, &egl_major, &egl_minor)) {
        set_error("Could not initialize Android EGL (0x%x)", eglGetError());
        destroy_hw_context(false);
        return false;
    }
    if (!eglBindAPI(EGL_OPENGL_ES_API)) {
        set_error("Could not bind OpenGL ES API (0x%x)", eglGetError());
        destroy_hw_context(false);
        return false;
    }

    EGLint renderable = major >= 3 ? EGL_OPENGL_ES3_BIT_KHR : EGL_OPENGL_ES2_BIT;
    EGLint config_attributes[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT | EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, renderable,
        EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_BLUE_SIZE, 8,
        EGL_ALPHA_SIZE, 8,
        EGL_DEPTH_SIZE, host.hw_render.depth ? 24 : 0,
        EGL_STENCIL_SIZE, host.hw_render.stencil ? 8 : 0,
        EGL_NONE
    };
    EGLint config_count = 0;
    if (!eglChooseConfig(host.egl_display, config_attributes, &host.egl_config, 1, &config_count) ||
        config_count < 1) {
        set_error("No compatible OpenGL ES %d EGL config (0x%x)", major, eglGetError());
        destroy_hw_context(false);
        return false;
    }

    EGLint context_attributes[7];
    int ci = 0;
#ifdef EGL_CONTEXT_MAJOR_VERSION_KHR
    if (host.hw_render.context_type == RETRO_HW_CONTEXT_OPENGLES_VERSION &&
        host.hw_render.version_major >= 3u) {
        context_attributes[ci++] = EGL_CONTEXT_MAJOR_VERSION_KHR;
        context_attributes[ci++] = (EGLint)host.hw_render.version_major;
        context_attributes[ci++] = EGL_CONTEXT_MINOR_VERSION_KHR;
        context_attributes[ci++] = (EGLint)host.hw_render.version_minor;
    } else
#endif
    {
        context_attributes[ci++] = EGL_CONTEXT_CLIENT_VERSION;
        context_attributes[ci++] = major;
    }
    context_attributes[ci++] = EGL_NONE;
    host.egl_context = eglCreateContext(host.egl_display, host.egl_config,
                                        EGL_NO_CONTEXT, context_attributes);
    if (host.egl_context == EGL_NO_CONTEXT) {
        set_error("Could not create OpenGL ES %d context (0x%x)", major, eglGetError());
        destroy_hw_context(false);
        return false;
    }

    const EGLint pbuffer_attributes[] = {
        EGL_WIDTH, host.video_width > 0u ? (EGLint)host.video_width : 1,
        EGL_HEIGHT, host.video_height > 0u ? (EGLint)host.video_height : 1,
        EGL_NONE
    };
    host.egl_pbuffer_surface = eglCreatePbufferSurface(host.egl_display, host.egl_config,
                                                       pbuffer_attributes);
    if (host.egl_pbuffer_surface == EGL_NO_SURFACE) {
        set_error("Could not create bootstrap EGL pbuffer (0x%x)", eglGetError());
        destroy_hw_context(false);
        return false;
    }

    /* Hardware cores that render to framebuffer 0 must see the real game-sized window
     * framebuffer during context_reset(). A 1x1 pbuffer here makes cores such as PPSSPP
     * initialize their default viewport against the wrong target, which can leave the
     * game drawing into only one corner of the visible SurfaceView. */
    pthread_mutex_lock(&host.window_mutex);
    ANativeWindow *bootstrap_window = host.window;
    if (bootstrap_window) ANativeWindow_acquire(bootstrap_window);
    pthread_mutex_unlock(&host.window_mutex);

    bool reset_on_window = false;
    if (bootstrap_window) {
        configure_hw_window_geometry(bootstrap_window);
        host.egl_window_surface = eglCreateWindowSurface(
            host.egl_display, host.egl_config,
            (EGLNativeWindowType)(uintptr_t)bootstrap_window, NULL);
        ANativeWindow_release(bootstrap_window);
        if (host.egl_window_surface != EGL_NO_SURFACE &&
            eglMakeCurrent(host.egl_display, host.egl_window_surface,
                           host.egl_window_surface, host.egl_context) == EGL_TRUE) {
            reset_on_window = true;
        }
    }
    if (!reset_on_window && !make_hw_pbuffer_current()) {
        set_error("Could not bind bootstrap EGL target (0x%x)", eglGetError());
        destroy_hw_context(false);
        return false;
    }

    if (host.hw_render.context_reset) host.hw_render.context_reset();
    eglMakeCurrent(host.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    atomic_store(&host.hw_surface_dirty, !reset_on_window);
    LOGI("OpenGL ES hardware context ready: requested=%d version=%u.%u EGL=%d.%d",
         (int)host.hw_render.context_type, host.hw_render.version_major,
         host.hw_render.version_minor, egl_major, egl_minor);
    return true;
}

static void configure_hw_window_geometry(ANativeWindow *window) {
    if (!window) return;
    int width = host.video_width > 0u ? (int)host.video_width : 0;
    int height = host.video_height > 0u ? (int)host.video_height : 0;
    if (!host.hardware_requested || width <= 0 || height <= 0) {
        ANativeWindow_setBuffersGeometry(window, 0, 0, WINDOW_FORMAT_RGBA_8888);
        return;
    }
    /* Hardware libretro cores commonly render to their base viewport in the default FBO.
     * Give that FBO the core's native geometry; SurfaceView then scales the completed buffer
     * into GameDeck's centered aspect-fit game rectangle instead of leaving it at GL origin. */
    ANativeWindow_setBuffersGeometry(window, width, height, WINDOW_FORMAT_RGBA_8888);
}

static bool bind_hw_window_surface(void) {
    if (!host.hardware_requested || host.egl_display == EGL_NO_DISPLAY ||
        host.egl_context == EGL_NO_CONTEXT) return false;

    bool dirty = atomic_exchange(&host.hw_surface_dirty, false);
    if (dirty || host.egl_window_surface == EGL_NO_SURFACE) {
        pthread_mutex_lock(&host.window_mutex);
        ANativeWindow *window = host.window;
        if (window) ANativeWindow_acquire(window);
        pthread_mutex_unlock(&host.window_mutex);
        if (!window) {
            if (host.egl_window_surface != EGL_NO_SURFACE) {
                eglMakeCurrent(host.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
                eglDestroySurface(host.egl_display, host.egl_window_surface);
                host.egl_window_surface = EGL_NO_SURFACE;
            }
            return make_hw_pbuffer_current();
        }
        configure_hw_window_geometry(window);
        eglMakeCurrent(host.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (host.egl_window_surface != EGL_NO_SURFACE) {
            eglDestroySurface(host.egl_display, host.egl_window_surface);
            host.egl_window_surface = EGL_NO_SURFACE;
        }
        host.egl_window_surface = eglCreateWindowSurface(host.egl_display, host.egl_config,
                                                         (EGLNativeWindowType)(uintptr_t)window, NULL);
        ANativeWindow_release(window);
        if (host.egl_window_surface == EGL_NO_SURFACE) {
            set_error("Could not create EGL window surface (0x%x)", eglGetError());
            return false;
        }
    }
    if (!eglMakeCurrent(host.egl_display, host.egl_window_surface,
                        host.egl_window_surface, host.egl_context)) {
        set_error("Could not bind EGL window surface (0x%x)", eglGetError());
        return false;
    }
    return true;
}

static bool environment_callback(unsigned command, void *data) {
    switch (command) {
        case RETRO_ENVIRONMENT_GET_CAN_DUPE:
            *(bool *)data = true;
            return true;
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
            enum retro_pixel_format requested = *(enum retro_pixel_format *)data;
            if (requested != RETRO_PIXEL_FORMAT_0RGB1555 &&
                requested != RETRO_PIXEL_FORMAT_RGB565 &&
                requested != RETRO_PIXEL_FORMAT_XRGB8888) {
                return false;
            }
            host.pixel_format = requested;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
            *(const char **)data = host.system_dir;
            return true;
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
            *(const char **)data = host.save_dir;
            return true;
#ifdef RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY
        case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY:
            *(const char **)data = host.system_dir;
            return true;
#endif
        case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
            host.supports_no_game = *(bool *)data;
            return true;
        case RETRO_ENVIRONMENT_SET_VARIABLES: {
            const struct retro_variable *variables = data;
            pthread_mutex_lock(&host.variable_mutex);
            clear_variables_locked();
            if (variables) {
                for (; variables->key && variables->value; variables++) {
                    set_variable_default_locked(variables->key, variables->value);
                }
            }
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        }
        case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
            if (data) *(unsigned *)data = 2u;
            return data != NULL;
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS: {
            pthread_mutex_lock(&host.variable_mutex);
            set_core_options_v1_locked((const struct retro_core_option_definition *)data);
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        }
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL: {
            const struct retro_core_options_intl *options = data;
            const struct retro_core_option_definition *definitions = options
                ? (options->local ? options->local : options->us) : NULL;
            pthread_mutex_lock(&host.variable_mutex);
            set_core_options_v1_locked(definitions);
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        }
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2: {
            pthread_mutex_lock(&host.variable_mutex);
            set_core_options_v2_locked((const struct retro_core_options_v2 *)data);
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        }
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL: {
            const struct retro_core_options_v2_intl *options = data;
            const struct retro_core_options_v2 *selected = options
                ? (options->local ? options->local : options->us) : NULL;
            pthread_mutex_lock(&host.variable_mutex);
            set_core_options_v2_locked(selected);
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        }
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY: {
            const struct retro_core_option_display *display = data;
            if (!display || !display->key) return false;
            pthread_mutex_lock(&host.variable_mutex);
            for (size_t i = 0; i < host.variable_count; i++) {
                if (host.variables[i].key && !strcmp(host.variables[i].key, display->key)) {
                    host.variables[i].visible = display->visible;
                    break;
                }
            }
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        }
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK: {
            const struct retro_core_options_update_display_callback *callback = data;
            host.options_display_callback = callback ? callback->callback : NULL;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE: {
            struct retro_variable *variable = data;
            variable->value = get_variable(variable->key);
            return variable->value != NULL;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
            *(bool *)data = atomic_exchange(&host.variables_updated, false);
            return true;
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: {
            struct retro_log_callback *callback = data;
            callback->log = core_log;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_RUMBLE_INTERFACE: {
            struct retro_rumble_interface *rumble = data;
            rumble->set_rumble_state = rumble_set;
            return true;
        }
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
            pthread_mutex_lock(&host.variable_mutex);
            capture_input_descriptors_locked((const struct retro_input_descriptor *)data);
            pthread_mutex_unlock(&host.variable_mutex);
            return true;
        case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK: {
            const struct retro_keyboard_callback *keyboard = data;
            host.keyboard_callback = keyboard ? keyboard->callback : NULL;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_LANGUAGE:
            *(unsigned *)data = RETRO_LANGUAGE_ENGLISH;
            return true;
        case RETRO_ENVIRONMENT_GET_USERNAME:
            *(const char **)data = "GameDeck";
            return true;
        case RETRO_ENVIRONMENT_GET_PREFERRED_HW_RENDER:
            *(unsigned *)data = RETRO_HW_CONTEXT_OPENGLES3;
            return true;
        case RETRO_ENVIRONMENT_SET_HW_RENDER: {
            struct retro_hw_render_callback *callback = data;
            if (!callback || !hw_context_is_gles(callback->context_type)) {
                host.hardware_requested = true;
                set_error("Unsupported hardware rendering API requested by core (type=%d)",
                          callback ? (int)callback->context_type : -1);
                return false;
            }
            callback->get_current_framebuffer = hw_get_current_framebuffer;
            callback->get_proc_address = hw_get_proc_address;
            memcpy(&host.hw_render, callback, sizeof(host.hw_render));
            host.hw_render_valid = true;
            host.hardware_requested = true;
            return true;
        }
        case RETRO_ENVIRONMENT_SHUTDOWN:
            atomic_store(&host.shutdown_requested, true);
            return true;
        case RETRO_ENVIRONMENT_SET_GEOMETRY: {
            const struct retro_game_geometry *geometry = data;
            if (geometry) {
                host.video_width = geometry->base_width;
                host.video_height = geometry->base_height;
                double aspect = geometry->aspect_ratio > 0.5f
                    ? geometry->aspect_ratio
                    : geometry->base_height > 0u
                        ? (double)geometry->base_width / (double)geometry->base_height
                        : 0.0;
                if (aspect > 0.5 && aspect < 8.0) {
                    atomic_store(&host.aspect_micros, (int)llround(aspect * 1000000.0));
                }
            }
            return true;
        }
        case RETRO_ENVIRONMENT_SET_MESSAGE:
        case RETRO_ENVIRONMENT_SET_MESSAGE_EXT:
            return true;
        default:
            return false;
    }
}

static inline void write_rgba(uint8_t *target, uint8_t r, uint8_t g, uint8_t b) {
    target[0] = r;
    target[1] = g;
    target[2] = b;
    target[3] = 255;
}

static inline uint8_t clamp_channel(int value) {
    return (uint8_t)(value < 0 ? 0 : value > 255 ? 255 : value);
}

static inline void read_source_rgb(
        const void *data, unsigned width, unsigned height, size_t pitch,
        enum retro_pixel_format format, unsigned x, unsigned y,
        uint8_t *r, uint8_t *g, uint8_t *b) {
    if (x >= width) x = width - 1u;
    if (y >= height) y = height - 1u;
    const uint8_t *row = (const uint8_t *)data + (size_t)y * pitch;
    if (format == RETRO_PIXEL_FORMAT_XRGB8888) {
        uint32_t value = ((const uint32_t *)row)[x];
        *r = (uint8_t)((value >> 16u) & 0xffu);
        *g = (uint8_t)((value >> 8u) & 0xffu);
        *b = (uint8_t)(value & 0xffu);
        return;
    }
    uint16_t value = ((const uint16_t *)row)[x];
    if (format == RETRO_PIXEL_FORMAT_RGB565) {
        *r = (uint8_t)(((value >> 11u) & 0x1fu) * 255u / 31u);
        *g = (uint8_t)(((value >> 5u) & 0x3fu) * 255u / 63u);
        *b = (uint8_t)((value & 0x1fu) * 255u / 31u);
    } else {
        *r = (uint8_t)(((value >> 10u) & 0x1fu) * 255u / 31u);
        *g = (uint8_t)(((value >> 5u) & 0x1fu) * 255u / 31u);
        *b = (uint8_t)((value & 0x1fu) * 255u / 31u);
    }
}

static void reset_ambient(bool release_surface) {
    memset(host.ambient_grid, 0, sizeof(host.ambient_grid));
    host.ambient_tick = 0;
    host.ambient_aspect_micros = 0;
    host.ambient_ready = false;
    if (release_surface) {
        free(host.ambient_surface);
        host.ambient_surface = NULL;
        host.ambient_surface_capacity = 0;
        host.ambient_surface_width = 0;
        host.ambient_surface_height = 0;
    }
}

static void update_ambient_grid(
        const void *data, unsigned width, unsigned height, size_t pitch,
        enum retro_pixel_format format) {
    const unsigned radius_x = width / (AMBIENT_GRID_WIDTH * 3u) > 0u
        ? width / (AMBIENT_GRID_WIDTH * 3u) : 1u;
    const unsigned radius_y = height / (AMBIENT_GRID_HEIGHT * 3u) > 0u
        ? height / (AMBIENT_GRID_HEIGHT * 3u) : 1u;
    const int offsets[3] = {-1, 0, 1};

    for (unsigned gy = 0; gy < AMBIENT_GRID_HEIGHT; gy++) {
        unsigned center_y = (unsigned)(((uint64_t)(gy * 2u + 1u) * height) /
            (AMBIENT_GRID_HEIGHT * 2u));
        if (center_y >= height) center_y = height - 1u;
        for (unsigned gx = 0; gx < AMBIENT_GRID_WIDTH; gx++) {
            unsigned center_x = (unsigned)(((uint64_t)(gx * 2u + 1u) * width) /
                (AMBIENT_GRID_WIDTH * 2u));
            if (center_x >= width) center_x = width - 1u;
            unsigned red = 0u;
            unsigned green = 0u;
            unsigned blue = 0u;
            unsigned samples = 0u;
            for (unsigned oy = 0; oy < 3u; oy++) {
                int sample_y = (int)center_y + offsets[oy] * (int)radius_y;
                if (sample_y < 0) sample_y = 0;
                if ((unsigned)sample_y >= height) sample_y = (int)height - 1;
                for (unsigned ox = 0; ox < 3u; ox++) {
                    int sample_x = (int)center_x + offsets[ox] * (int)radius_x;
                    if (sample_x < 0) sample_x = 0;
                    if ((unsigned)sample_x >= width) sample_x = (int)width - 1;
                    uint8_t r, g, b;
                    read_source_rgb(data, width, height, pitch, format,
                        (unsigned)sample_x, (unsigned)sample_y, &r, &g, &b);
                    red += r;
                    green += g;
                    blue += b;
                    samples++;
                }
            }
            red /= samples;
            green /= samples;
            blue /= samples;
            const unsigned index = gy * AMBIENT_GRID_WIDTH + gx;
            const uint32_t previous = host.ambient_grid[index];
            if (host.ambient_ready) {
                red = (((previous >> 16u) & 0xffu) * 3u + red) / 4u;
                green = (((previous >> 8u) & 0xffu) * 3u + green) / 4u;
                blue = ((previous & 0xffu) * 3u + blue) / 4u;
            }
            host.ambient_grid[index] = (red << 16u) | (green << 8u) | blue;
        }
    }
    host.ambient_ready = true;
}

static bool ensure_ambient_surface(unsigned width, unsigned height) {
    if (!width || !height || (size_t)width > SIZE_MAX / (size_t)height / 4u) return false;
    const size_t required = (size_t)width * (size_t)height * 4u;
    if (required > host.ambient_surface_capacity) {
        uint8_t *next = realloc(host.ambient_surface, required);
        if (!next) return false;
        host.ambient_surface = next;
        host.ambient_surface_capacity = required;
    }
    return true;
}

static inline uint32_t ambient_lookup(unsigned gx, unsigned gy) {
    return host.ambient_grid[gy * AMBIENT_GRID_WIDTH + gx];
}

static bool build_ambient_surface(unsigned width, unsigned height, double source_aspect) {
    if (!host.ambient_ready || !ensure_ambient_surface(width, height)) return false;

    uint32_t *x_lookup = malloc((size_t)width * sizeof(uint32_t));
    uint32_t *y_lookup = malloc((size_t)height * sizeof(uint32_t));
    uint8_t *x_vignette = malloc((size_t)width);
    uint8_t *y_vignette = malloc((size_t)height);
    if (!x_lookup || !y_lookup || !x_vignette || !y_vignette) {
        free(x_lookup);
        free(y_lookup);
        free(x_vignette);
        free(y_vignette);
        return false;
    }

    const double surface_aspect = (double)width / (double)height;
    double u_start = 0.0;
    double v_start = 0.0;
    double u_span = 1.0;
    double v_span = 1.0;
    if (surface_aspect > source_aspect) {
        v_span = source_aspect / surface_aspect;
        v_start = (1.0 - v_span) * 0.5;
    } else {
        u_span = surface_aspect / source_aspect;
        u_start = (1.0 - u_span) * 0.5;
    }

    const int64_t u_start_q16 = (int64_t)llround(u_start *
        (double)(AMBIENT_GRID_WIDTH - 1u) * 65536.0);
    const int64_t u_span_q16 = (int64_t)llround(u_span *
        (double)(AMBIENT_GRID_WIDTH - 1u) * 65536.0);
    const int64_t v_start_q16 = (int64_t)llround(v_start *
        (double)(AMBIENT_GRID_HEIGHT - 1u) * 65536.0);
    const int64_t v_span_q16 = (int64_t)llround(v_span *
        (double)(AMBIENT_GRID_HEIGHT - 1u) * 65536.0);
    const int64_t u_step_q16 = width > 1u ? u_span_q16 / (int64_t)(width - 1u) : 0;
    const int64_t v_step_q16 = height > 1u ? v_span_q16 / (int64_t)(height - 1u) : 0;

    int64_t u_q16 = u_start_q16;
    for (unsigned x = 0; x < width; x++, u_q16 += u_step_q16) {
        int64_t bounded = u_q16;
        const int64_t maximum = (int64_t)(AMBIENT_GRID_WIDTH - 1u) << 16u;
        if (bounded < 0) bounded = 0;
        if (bounded > maximum) bounded = maximum;
        unsigned gx = (unsigned)(bounded >> 16u);
        unsigned fraction = (unsigned)((bounded >> 8u) & 0xffu);
        if (gx >= AMBIENT_GRID_WIDTH - 1u) {
            gx = AMBIENT_GRID_WIDTH - 2u;
            fraction = 255u;
        }
        x_lookup[x] = (gx << 8u) | fraction;
        const unsigned edge = width > 1u
            ? (unsigned)abs((int)(x * 2u) - (int)(width - 1u)) * 24u / (width - 1u)
            : 0u;
        x_vignette[x] = (uint8_t)edge;
    }

    int64_t v_q16 = v_start_q16;
    for (unsigned y = 0; y < height; y++, v_q16 += v_step_q16) {
        int64_t bounded = v_q16;
        const int64_t maximum = (int64_t)(AMBIENT_GRID_HEIGHT - 1u) << 16u;
        if (bounded < 0) bounded = 0;
        if (bounded > maximum) bounded = maximum;
        unsigned gy = (unsigned)(bounded >> 16u);
        unsigned fraction = (unsigned)((bounded >> 8u) & 0xffu);
        if (gy >= AMBIENT_GRID_HEIGHT - 1u) {
            gy = AMBIENT_GRID_HEIGHT - 2u;
            fraction = 255u;
        }
        y_lookup[y] = (gy << 8u) | fraction;
        const unsigned edge = height > 1u
            ? (unsigned)abs((int)(y * 2u) - (int)(height - 1u)) * 31u / (height - 1u)
            : 0u;
        y_vignette[y] = (uint8_t)edge;
    }

    for (unsigned block_y = 0; block_y < height; block_y += AMBIENT_BLOCK_SIZE) {
        const unsigned sample_y = block_y + AMBIENT_BLOCK_SIZE / 2u < height
            ? block_y + AMBIENT_BLOCK_SIZE / 2u : height - 1u;
        const unsigned gy = y_lookup[sample_y] >> 8u;
        const unsigned fy = y_lookup[sample_y] & 0xffu;
        for (unsigned block_x = 0; block_x < width; block_x += AMBIENT_BLOCK_SIZE) {
            const unsigned sample_x = block_x + AMBIENT_BLOCK_SIZE / 2u < width
                ? block_x + AMBIENT_BLOCK_SIZE / 2u : width - 1u;
            const unsigned gx = x_lookup[sample_x] >> 8u;
            const unsigned fx = x_lookup[sample_x] & 0xffu;
            const uint32_t c00 = ambient_lookup(gx, gy);
            const uint32_t c10 = ambient_lookup(gx + 1u, gy);
            const uint32_t c01 = ambient_lookup(gx, gy + 1u);
            const uint32_t c11 = ambient_lookup(gx + 1u, gy + 1u);

            const int r0 = (int)((c00 >> 16u) & 0xffu)
                + (((int)((c10 >> 16u) & 0xffu) - (int)((c00 >> 16u) & 0xffu)) * (int)fx >> 8u);
            const int g0 = (int)((c00 >> 8u) & 0xffu)
                + (((int)((c10 >> 8u) & 0xffu) - (int)((c00 >> 8u) & 0xffu)) * (int)fx >> 8u);
            const int b0 = (int)(c00 & 0xffu)
                + (((int)(c10 & 0xffu) - (int)(c00 & 0xffu)) * (int)fx >> 8u);
            const int r1 = (int)((c01 >> 16u) & 0xffu)
                + (((int)((c11 >> 16u) & 0xffu) - (int)((c01 >> 16u) & 0xffu)) * (int)fx >> 8u);
            const int g1 = (int)((c01 >> 8u) & 0xffu)
                + (((int)((c11 >> 8u) & 0xffu) - (int)((c01 >> 8u) & 0xffu)) * (int)fx >> 8u);
            const int b1 = (int)(c01 & 0xffu)
                + (((int)(c11 & 0xffu) - (int)(c01 & 0xffu)) * (int)fx >> 8u);
            int r = r0 + ((r1 - r0) * (int)fy >> 8u);
            int g = g0 + ((g1 - g0) * (int)fy >> 8u);
            int b = b0 + ((b1 - b0) * (int)fy >> 8u);

            const int luma = (r * 54 + g * 183 + b * 19) >> 8u;
            r = clamp_channel(luma + (r - luma) * 135 / 100);
            g = clamp_channel(luma + (g - luma) * 135 / 100);
            b = clamp_channel(luma + (b - luma) * 135 / 100);
            int shade = 151 - (int)x_vignette[sample_x] - (int)y_vignette[sample_y];
            if (shade < 88) shade = 88;
            const uint8_t red = clamp_channel((r * shade >> 8u) + 2);
            const uint8_t green = clamp_channel((g * shade >> 8u) + 3);
            const uint8_t blue = clamp_channel((b * shade >> 8u) + 5);
            const unsigned end_y = block_y + AMBIENT_BLOCK_SIZE < height
                ? block_y + AMBIENT_BLOCK_SIZE : height;
            const unsigned end_x = block_x + AMBIENT_BLOCK_SIZE < width
                ? block_x + AMBIENT_BLOCK_SIZE : width;
            for (unsigned y = block_y; y < end_y; y++) {
                uint8_t *destination = host.ambient_surface
                    + ((size_t)y * (size_t)width + block_x) * 4u;
                for (unsigned x = block_x; x < end_x; x++) {
                    write_rgba(destination, red, green, blue);
                    destination += 4u;
                }
            }
        }
    }

    free(x_lookup);
    free(y_lookup);
    free(x_vignette);
    free(y_vignette);
    host.ambient_surface_width = width;
    host.ambient_surface_height = height;
    return true;
}

static void copy_ambient_to_window(ANativeWindow_Buffer *buffer, unsigned width, unsigned height) {
    if (host.ambient_surface && host.ambient_surface_width == width &&
        host.ambient_surface_height == height) {
        for (unsigned y = 0; y < height; y++) {
            uint8_t *destination = (uint8_t *)buffer->bits
                + (size_t)y * (size_t)buffer->stride * 4u;
            const uint8_t *source = host.ambient_surface + (size_t)y * (size_t)width * 4u;
            memcpy(destination, source, (size_t)width * 4u);
        }
        return;
    }
    for (unsigned y = 0; y < height; y++) {
        uint8_t *row = (uint8_t *)buffer->bits + (size_t)y * (size_t)buffer->stride * 4u;
        memset(row, 0, (size_t)width * 4u);
    }
}

static inline void darken_pixel(uint8_t *pixel, unsigned factor) {
    pixel[0] = (uint8_t)((unsigned)pixel[0] * factor / 255u);
    pixel[1] = (uint8_t)((unsigned)pixel[1] * factor / 255u);
    pixel[2] = (uint8_t)((unsigned)pixel[2] * factor / 255u);
}

static void draw_viewport_shadow(
        ANativeWindow_Buffer *buffer, unsigned surface_width, unsigned surface_height,
        unsigned offset_x, unsigned offset_y, unsigned viewport_width, unsigned viewport_height) {
    const int shadow = 12;
    const int left = (int)offset_x;
    const int top = (int)offset_y;
    const int right = (int)(offset_x + viewport_width - 1u);
    const int bottom = (int)(offset_y + viewport_height - 1u);
    const int min_x = left - shadow > 0 ? left - shadow : 0;
    const int max_x = right + shadow < (int)surface_width ? right + shadow : (int)surface_width - 1;
    const int min_y = top - shadow > 0 ? top - shadow : 0;
    const int max_y = bottom + shadow < (int)surface_height ? bottom + shadow : (int)surface_height - 1;

    for (int y = min_y; y <= max_y; y++) {
        for (int x = min_x; x <= max_x; x++) {
            if (x >= left && x <= right && y >= top && y <= bottom) continue;
            int dx = x < left ? left - x : x > right ? x - right : 0;
            int dy = y < top ? top - y : y > bottom ? y - bottom : 0;
            int distance = dx > dy ? dx : dy;
            if (distance <= 0 || distance > shadow) continue;
            unsigned factor = (unsigned)(104 + distance * 12);
            if (factor > 248u) factor = 248u;
            uint8_t *pixel = (uint8_t *)buffer->bits
                + ((size_t)y * (size_t)buffer->stride + (size_t)x) * 4u;
            darken_pixel(pixel, factor);
        }
    }
}

static void video_callback(const void *data, unsigned width, unsigned height, size_t pitch) {
    bool first_frame = atomic_load(&host.frame_count) == 0;
    if (first_frame) set_stage(130, "video-enter");
    if (!data || !width || !height) return;
    if (data == RETRO_HW_FRAME_BUFFER_VALID) {
        if (!bind_hw_window_surface()) return;
        host.video_width = width;
        host.video_height = height;
        GLint viewport[4] = {0, 0, 0, 0};
        EGLint surface_width = 0;
        EGLint surface_height = 0;
        if (first_frame) {
            glGetIntegerv(GL_VIEWPORT, viewport);
            eglQuerySurface(host.egl_display, host.egl_window_surface, EGL_WIDTH, &surface_width);
            eglQuerySurface(host.egl_display, host.egl_window_surface, EGL_HEIGHT, &surface_height);
        }
        if (!eglSwapBuffers(host.egl_display, host.egl_window_surface)) {
            EGLint error = eglGetError();
            if (error == EGL_BAD_SURFACE || error == EGL_BAD_NATIVE_WINDOW)
                atomic_store(&host.hw_surface_dirty, true);
            LOGW("eglSwapBuffers failed: 0x%x", error);
            return;
        }
        if (first_frame) {
            char phase[160];
            snprintf(phase, sizeof(phase),
                "video-hardware-egl-complete viewport=%d,%d %dx%d frame=%ux%u window=%dx%d",
                viewport[0], viewport[1], viewport[2], viewport[3], width, height,
                surface_width, surface_height);
            set_stage(134, phase);
        }
        return;
    }

    pthread_mutex_lock(&host.window_mutex);
    ANativeWindow *window = host.window;
    if (!window) {
        pthread_mutex_unlock(&host.window_mutex);
        return;
    }
    ANativeWindow_acquire(window);
    pthread_mutex_unlock(&host.window_mutex);

    if (first_frame) set_stage(131, "video-lock-full-surface");
    ANativeWindow_Buffer buffer;
    if (ANativeWindow_lock(window, &buffer, NULL) != 0) {
        ANativeWindow_release(window);
        return;
    }

    const unsigned surface_width = buffer.width > 0 ? (unsigned)buffer.width : width;
    const unsigned surface_height = buffer.height > 0 ? (unsigned)buffer.height : height;
    const int aspect_micros = atomic_load(&host.aspect_micros);
    const double source_aspect = aspect_micros > 500000
        ? (double)aspect_micros / 1000000.0
        : (double)width / (double)height;

    int margin_left = atomic_load(&host.viewport_left);
    int margin_top = atomic_load(&host.viewport_top);
    int margin_right = atomic_load(&host.viewport_right);
    int margin_bottom = atomic_load(&host.viewport_bottom);
    if (margin_left < 0) margin_left = 0;
    if (margin_top < 0) margin_top = 0;
    if (margin_right < 0) margin_right = 0;
    if (margin_bottom < 0) margin_bottom = 0;
    if ((unsigned)(margin_left + margin_right) >= surface_width - 1u) {
        margin_left = 0;
        margin_right = 0;
    }
    if ((unsigned)(margin_top + margin_bottom) >= surface_height - 1u) {
        margin_top = 0;
        margin_bottom = 0;
    }
    const unsigned available_width = surface_width - (unsigned)margin_left - (unsigned)margin_right;
    const unsigned available_height = surface_height - (unsigned)margin_top - (unsigned)margin_bottom;
    const double surface_aspect = (double)available_width / (double)available_height;

    unsigned viewport_width;
    unsigned viewport_height;
    if (surface_aspect > source_aspect) {
        viewport_height = available_height;
        viewport_width = (unsigned)llround((double)viewport_height * source_aspect);
    } else {
        viewport_width = available_width;
        viewport_height = (unsigned)llround((double)viewport_width / source_aspect);
    }
    if (viewport_width < 1) viewport_width = 1;
    if (viewport_height < 1) viewport_height = 1;
    if (viewport_width > available_width) viewport_width = available_width;
    if (viewport_height > available_height) viewport_height = available_height;

    const unsigned offset_x = (unsigned)margin_left + (available_width - viewport_width) / 2u;
    const unsigned offset_y = (unsigned)margin_top + (available_height - viewport_height) / 2u;

    host.ambient_tick++;
    const bool dimensions_changed = host.ambient_surface_width != surface_width ||
        host.ambient_surface_height != surface_height || host.ambient_aspect_micros != aspect_micros;
    const bool refresh_ambient = !host.ambient_ready ||
        host.ambient_tick % AMBIENT_UPDATE_INTERVAL == 0u;
    if (refresh_ambient) update_ambient_grid(data, width, height, pitch, host.pixel_format);
    if (refresh_ambient || dimensions_changed) {
        if (build_ambient_surface(surface_width, surface_height, source_aspect)) {
            host.ambient_aspect_micros = aspect_micros;
        }
    }
    copy_ambient_to_window(&buffer, surface_width, surface_height);
    draw_viewport_shadow(&buffer, surface_width, surface_height,
        offset_x, offset_y, viewport_width, viewport_height);

    const uint64_t step_x = ((uint64_t)width << 32u) / viewport_width;
    const uint64_t step_y = ((uint64_t)height << 32u) / viewport_height;
    uint64_t source_y_accumulator = 0;

    for (unsigned destination_y = 0; destination_y < viewport_height; destination_y++) {
        unsigned source_y = (unsigned)(source_y_accumulator >> 32u);
        if (source_y >= height) source_y = height - 1u;
        source_y_accumulator += step_y;

        const uint8_t *source = (const uint8_t *)data + (size_t)source_y * pitch;
        uint8_t *destination = (uint8_t *)buffer.bits
            + ((size_t)(destination_y + offset_y) * (size_t)buffer.stride + offset_x) * 4u;
        uint64_t source_x_accumulator = 0;

        if (host.pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
            const uint32_t *pixels = (const uint32_t *)source;
            for (unsigned destination_x = 0; destination_x < viewport_width; destination_x++) {
                unsigned source_x = (unsigned)(source_x_accumulator >> 32u);
                if (source_x >= width) source_x = width - 1u;
                source_x_accumulator += step_x;
                uint32_t value = pixels[source_x];
                write_rgba(destination + destination_x * 4u,
                           (uint8_t)((value >> 16) & 0xff),
                           (uint8_t)((value >> 8) & 0xff),
                           (uint8_t)(value & 0xff));
            }
        } else {
            const uint16_t *pixels = (const uint16_t *)source;
            for (unsigned destination_x = 0; destination_x < viewport_width; destination_x++) {
                unsigned source_x = (unsigned)(source_x_accumulator >> 32u);
                if (source_x >= width) source_x = width - 1u;
                source_x_accumulator += step_x;
                uint16_t value = pixels[source_x];
                uint8_t r, g, b;
                if (host.pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
                    r = (uint8_t)(((value >> 11) & 0x1f) * 255 / 31);
                    g = (uint8_t)(((value >> 5) & 0x3f) * 255 / 63);
                    b = (uint8_t)((value & 0x1f) * 255 / 31);
                } else {
                    r = (uint8_t)(((value >> 10) & 0x1f) * 255 / 31);
                    g = (uint8_t)(((value >> 5) & 0x1f) * 255 / 31);
                    b = (uint8_t)((value & 0x1f) * 255 / 31);
                }
                write_rgba(destination + destination_x * 4u, r, g, b);
            }
        }
    }

    host.video_width = width;
    host.video_height = height;
    if (first_frame) {
        LOGI("Video viewport %ux%u centered in %ux%u with frame-derived ambient fill for %.4f aspect",
             viewport_width, viewport_height, surface_width, surface_height, source_aspect);
        set_stage(133, "video-ambient-fill-scaled-surface");
    }
    ANativeWindow_unlockAndPost(window);
    ANativeWindow_release(window);
    if (first_frame) set_stage(134, "video-complete");
}

static inline int16_t clamp_sample(double value) {
    long rounded = lrint(value);
    if (rounded < -32768L) rounded = -32768L;
    if (rounded > 32767L) rounded = 32767L;
    return (int16_t)rounded;
}

static void write_audio_pair_locked(int16_t left, int16_t right) {
    if (host.audio_count + 2u > AUDIO_RING_SHORTS) {
        host.audio_read = (host.audio_read + 2u) % AUDIO_RING_SHORTS;
        host.audio_count -= 2u;
        host.audio_overruns++;
    }
    host.audio_ring[host.audio_write] = left;
    host.audio_write = (host.audio_write + 1u) % AUDIO_RING_SHORTS;
    host.audio_ring[host.audio_write] = right;
    host.audio_write = (host.audio_write + 1u) % AUDIO_RING_SHORTS;
    host.audio_count += 2u;
}

static void configure_audio_resampler_locked(void) {
    double source_rate = host.sample_rate > 1000.0 ? host.sample_rate : AUDIO_OUTPUT_RATE;
    host.audio_resample_interval = source_rate / AUDIO_OUTPUT_RATE;
    if (host.audio_resample_interval < 0.01) host.audio_resample_interval = 0.01;
    if (host.audio_resample_interval > 1024.0) host.audio_resample_interval = 1024.0;
    host.audio_resample_remaining = host.audio_resample_interval;
    host.audio_resample_left_sum = 0.0;
    host.audio_resample_right_sum = 0.0;
    host.audio_resample_weight = 0.0;
}

static void push_audio(const int16_t *samples, size_t shorts) {
    if (!samples || shorts < 2u) return;
    size_t frames = shorts / 2u;
    pthread_mutex_lock(&host.audio_mutex);
    if (host.audio_resample_interval <= 0.0 || host.audio_resample_remaining <= 0.0) {
        configure_audio_resampler_locked();
    }

    for (size_t frame = 0; frame < frames; frame++) {
        const double left = samples[frame * 2u];
        const double right = samples[frame * 2u + 1u];
        double available = 1.0;
        while (available > 0.0000001) {
            double take = available < host.audio_resample_remaining
                ? available : host.audio_resample_remaining;
            host.audio_resample_left_sum += left * take;
            host.audio_resample_right_sum += right * take;
            host.audio_resample_weight += take;
            host.audio_resample_remaining -= take;
            available -= take;

            if (host.audio_resample_remaining <= 0.0000001) {
                double weight = host.audio_resample_weight > 0.0000001
                    ? host.audio_resample_weight : 1.0;
                write_audio_pair_locked(
                    clamp_sample(host.audio_resample_left_sum / weight),
                    clamp_sample(host.audio_resample_right_sum / weight)
                );
                host.audio_resample_remaining = host.audio_resample_interval;
                host.audio_resample_left_sum = 0.0;
                host.audio_resample_right_sum = 0.0;
                host.audio_resample_weight = 0.0;
            }
        }
    }
    pthread_mutex_unlock(&host.audio_mutex);
}

static void audio_sample_callback(int16_t left, int16_t right) {
    bool first_frame = atomic_load(&host.frame_count) == 0;
    if (first_frame) set_stage(140, "audio-sample-enter");
    int16_t pair[2] = {left, right};
    push_audio(pair, 2);
    if (first_frame) set_stage(141, "audio-sample-complete");
}

static size_t audio_batch_callback(const int16_t *data, size_t frames) {
    bool first_frame = atomic_load(&host.frame_count) == 0;
    if (first_frame) set_stage(142, "audio-batch-enter");
    push_audio(data, frames * 2u);
    if (first_frame) set_stage(143, "audio-batch-complete");
    return frames;
}

static void input_poll_callback(void) {
    if (atomic_load(&host.frame_count) == 0) set_stage(150, "input-poll");
}

static int16_t input_state_callback(unsigned port, unsigned device, unsigned index, unsigned id) {
    if (atomic_load(&host.frame_count) == 0) set_stage(151, "input-state");
    if (port >= MAX_PLAYERS) return 0;
    if (device == RETRO_DEVICE_JOYPAD && id < 16) {
        return atomic_load(&host.buttons[port][id]) ? 1 : 0;
    }
    if (device == RETRO_DEVICE_ANALOG) {
        if (index == RETRO_DEVICE_INDEX_ANALOG_LEFT) {
            if (id == RETRO_DEVICE_ID_ANALOG_X) return (int16_t)atomic_load(&host.axes[port][0]);
            if (id == RETRO_DEVICE_ID_ANALOG_Y) return (int16_t)atomic_load(&host.axes[port][1]);
        } else if (index == RETRO_DEVICE_INDEX_ANALOG_RIGHT) {
            if (id == RETRO_DEVICE_ID_ANALOG_X) return (int16_t)atomic_load(&host.axes[port][2]);
            if (id == RETRO_DEVICE_ID_ANALOG_Y) return (int16_t)atomic_load(&host.axes[port][3]);
        }
    }
    if (device == RETRO_DEVICE_POINTER) {
        if (id == RETRO_DEVICE_ID_POINTER_X) return (int16_t)atomic_load(&host.pointer_x[port]);
        if (id == RETRO_DEVICE_ID_POINTER_Y) return (int16_t)atomic_load(&host.pointer_y[port]);
        if (id == RETRO_DEVICE_ID_POINTER_PRESSED) return atomic_load(&host.pointer_pressed[port]) ? 1 : 0;
    }
    if (device == RETRO_DEVICE_KEYBOARD && id < MAX_KEYS) {
        return atomic_load(&host.keys[id]) ? 1 : 0;
    }
    return 0;
}

static void reset_audio_ring(void) {
    pthread_mutex_lock(&host.audio_mutex);
    host.audio_read = 0;
    host.audio_write = 0;
    host.audio_count = 0;
    host.audio_overruns = 0;
    configure_audio_resampler_locked();
    pthread_mutex_unlock(&host.audio_mutex);
}

static void build_save_path(void) {
    const char *name = strrchr(host.content_path, '/');
    name = name ? name + 1 : host.content_path;
    char base[512];
    snprintf(base, sizeof(base), "%s", name && *name ? name : "game");
    char *dot = strrchr(base, '.');
    if (dot) *dot = '\0';
    snprintf(host.save_path, sizeof(host.save_path), "%s/%s.srm", host.save_dir, base);
}

static void load_save_ram(void) {
    if (!host.retro_get_memory_data || !host.retro_get_memory_size) return;
    void *memory = host.retro_get_memory_data(RETRO_MEMORY_SAVE_RAM);
    size_t size = host.retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
    if (!memory || !size || !host.save_path[0]) return;
    FILE *file = fopen(host.save_path, "rb");
    if (!file) return;
    size_t read = fread(memory, 1, size, file);
    fclose(file);
    LOGI("Loaded %zu/%zu bytes of save RAM", read, size);
}

static void persist_save_ram(void) {
    if (!host.retro_get_memory_data || !host.retro_get_memory_size) return;
    void *memory = host.retro_get_memory_data(RETRO_MEMORY_SAVE_RAM);
    size_t size = host.retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
    if (!memory || !size || !host.save_path[0]) return;
    char temporary[PATH_BUFFER];
    snprintf(temporary, sizeof(temporary), "%s.part", host.save_path);
    FILE *file = fopen(temporary, "wb");
    if (!file) return;
    size_t written = fwrite(memory, 1, size, file);
    fflush(file);
    fsync(fileno(file));
    fclose(file);
    if (written == size) rename(temporary, host.save_path);
    else unlink(temporary);
}

static bool read_content_file(void) {
    FILE *file = fopen(host.content_path, "rb");
    if (!file) {
        set_error("Could not open game content: %s", strerror(errno));
        return false;
    }
    if (fseek(file, 0, SEEK_END) != 0) { fclose(file); return false; }
    long length = ftell(file);
    if (length <= 0 || length > 1024L * 1024L * 1024L) {
        fclose(file);
        set_error("Game content size is unsupported by the embedded frontend");
        return false;
    }
    rewind(file);
    host.content_data = malloc((size_t)length);
    if (!host.content_data) { fclose(file); set_error("Out of memory while loading game content"); return false; }
    host.content_size = fread(host.content_data, 1, (size_t)length, file);
    fclose(file);
    if (host.content_size != (size_t)length) {
        set_error("Could not read complete game content");
        return false;
    }
    return true;
}

static void unload_host(void) {
    if (atomic_load(&host.loaded)) {
        persist_save_ram();
        if (host.hardware_requested) destroy_hw_context(true);
        if (host.retro_unload_game) host.retro_unload_game();
        if (host.retro_deinit) host.retro_deinit();
    } else if (host.hardware_requested || host.egl_display != EGL_NO_DISPLAY) {
        destroy_hw_context(false);
    }
    atomic_store(&host.loaded, false);
    if (host.core_handle) dlclose(host.core_handle);
    host.core_handle = NULL;
    free(host.content_data);
    host.content_data = NULL;
    host.content_size = 0;
    clear_variables();
    clear_input_descriptors();
    host.keyboard_callback = NULL;
    host.options_display_callback = NULL;
    atomic_store(&host.options_display_update_pending, false);
    reset_audio_ring();
}

static bool load_host(void) {
    host.last_error[0] = '\0';
    host.hardware_requested = false;
    host.hw_render_valid = false;
    memset(&host.hw_render, 0, sizeof(host.hw_render));
    atomic_store(&host.hw_surface_dirty, false);
    host.shutdown_requested = false;
    host.keyboard_callback = NULL;
    host.options_display_callback = NULL;
    atomic_store(&host.options_display_update_pending, false);
    set_stage(2, "dlopen-enter");
    host.core_handle = dlopen(host.core_path, RTLD_NOW | RTLD_LOCAL);
    if (!host.core_handle) {
        set_error("Could not load core: %s", dlerror());
        return false;
    }
    LOAD_SYM(retro_init);
    LOAD_SYM(retro_deinit);
    LOAD_SYM(retro_api_version);
    LOAD_SYM(retro_get_system_info);
    LOAD_SYM(retro_get_system_av_info);
    LOAD_SYM(retro_set_environment);
    LOAD_SYM(retro_set_video_refresh);
    LOAD_SYM(retro_set_audio_sample);
    LOAD_SYM(retro_set_audio_sample_batch);
    LOAD_SYM(retro_set_input_poll);
    LOAD_SYM(retro_set_input_state);
    LOAD_SYM(retro_set_controller_port_device);
    LOAD_SYM(retro_reset);
    LOAD_SYM(retro_run);
    LOAD_SYM(retro_serialize_size);
    LOAD_SYM(retro_serialize);
    LOAD_SYM(retro_unserialize);
    LOAD_SYM(retro_cheat_reset);
    LOAD_SYM(retro_cheat_set);
    LOAD_SYM(retro_load_game);
    LOAD_SYM(retro_unload_game);
    LOAD_SYM(retro_get_region);
    LOAD_SYM(retro_get_memory_data);
    LOAD_SYM(retro_get_memory_size);
    set_stage(3, "symbols-ready");

    set_stage(31, "api-version-enter");
    unsigned api_version = host.retro_api_version();
    set_stage(32, "api-version-complete");
    if (api_version != RETRO_API_VERSION) {
        set_error("Libretro API mismatch: core=%u frontend=%u", api_version, RETRO_API_VERSION);
        goto fail;
    }
    set_stage(33, "set-environment-enter");
    host.retro_set_environment(environment_callback);
    set_stage(34, "set-environment-complete");
    host.retro_set_video_refresh(video_callback);
    set_stage(35, "set-video-complete");
    host.retro_set_audio_sample(audio_sample_callback);
    set_stage(36, "set-audio-sample-complete");
    host.retro_set_audio_sample_batch(audio_batch_callback);
    set_stage(37, "set-audio-batch-complete");
    host.retro_set_input_poll(input_poll_callback);
    set_stage(38, "set-input-poll-complete");
    host.retro_set_input_state(input_state_callback);
    set_stage(39, "set-input-state-complete");
    set_stage(4, "retro-init-enter");
    host.retro_init();
    set_stage(5, "retro-init-complete");

    struct retro_system_info info;
    memset(&info, 0, sizeof(info));
    host.retro_get_system_info(&info);
    host.need_fullpath = info.need_fullpath;
    struct retro_game_info game;
    memset(&game, 0, sizeof(game));
    game.path = host.content_path;
    if (!host.need_fullpath) {
        if (!read_content_file()) goto fail_after_init;
        game.data = host.content_data;
        game.size = host.content_size;
    }
    set_stage(6, "retro-load-game-enter");
    if (!host.retro_load_game(&game)) {
        if (host.hardware_requested && !host.last_error[0]) {
            set_error("Core requested unsupported hardware rendering");
        } else if (!host.last_error[0]) {
            set_error("Core rejected the selected game content");
        }
        goto fail_after_init;
    }
    set_stage(7, "retro-load-game-complete");

    /* Resolve AV geometry before creating a hardware context so framebuffer-0 cores are
     * initialized against the real base video size rather than a bootstrap placeholder. */
    struct retro_system_av_info av;
    memset(&av, 0, sizeof(av));
    host.retro_get_system_av_info(&av);
    host.video_width = av.geometry.base_width;
    host.video_height = av.geometry.base_height;
    host.fps = av.timing.fps > 1.0 ? av.timing.fps : 60.0;
    host.sample_rate = av.timing.sample_rate > 1000.0 ? av.timing.sample_rate : 48000.0;
    double aspect = av.geometry.aspect_ratio > 0.5f
        ? av.geometry.aspect_ratio
        : (host.video_height > 0u ? (double)host.video_width / (double)host.video_height : 4.0 / 3.0);
    atomic_store(&host.aspect_micros, (int)llround(aspect * 1000000.0));

    if (host.hardware_requested) {
        set_stage(71, "hardware-context-create-enter");
        if (!initialize_hw_context()) {
            if (host.retro_unload_game) host.retro_unload_game();
            goto fail_after_init;
        }
        set_stage(72, "hardware-context-create-complete");
    }
    for (unsigned port = 0; port < MAX_PLAYERS; port++)
        host.retro_set_controller_port_device(port, RETRO_DEVICE_JOYPAD);
    build_save_path();
    load_save_ram();
    reset_audio_ring();
    atomic_store(&host.loaded, true);
    set_stage(8, "core-loaded");
    LOGI("Loaded core %s at %.3f fps / %.1f Hz source audio -> %.0f Hz output",
         info.library_name ? info.library_name : "unknown", host.fps, host.sample_rate, AUDIO_OUTPUT_RATE);
    return true;

fail_after_init:
    if (host.retro_deinit) host.retro_deinit();
fail:
    if (host.core_handle) dlclose(host.core_handle);
    host.core_handle = NULL;
    free(host.content_data);
    host.content_data = NULL;
    host.content_size = 0;
    clear_variables();
    return false;
}

static void copy_jstring(JNIEnv *env, jstring value, char *target, size_t capacity) {
    target[0] = '\0';
    if (!value) return;
    const char *chars = (*env)->GetStringUTFChars(env, value, NULL);
    if (!chars) return;
    snprintf(target, capacity, "%s", chars);
    (*env)->ReleaseStringUTFChars(env, value, chars);
}

JNIEXPORT jboolean JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeBootstrap(
        JNIEnv *env, jclass clazz, jstring core, jstring content, jstring system_dir, jstring save_dir,
        jstring diagnostic_path) {
    (void)clazz;
    atomic_store(&host.stop_requested, true);
    unload_host();
    for (int port = 0; port < MAX_PLAYERS; port++) {
        for (int i = 0; i < 16; i++) atomic_store(&host.buttons[port][i], 0);
        for (int i = 0; i < 6; i++) atomic_store(&host.axes[port][i], 0);
    }
    copy_jstring(env, core, host.core_path, sizeof(host.core_path));
    copy_jstring(env, content, host.content_path, sizeof(host.content_path));
    copy_jstring(env, system_dir, host.system_dir, sizeof(host.system_dir));
    copy_jstring(env, save_dir, host.save_dir, sizeof(host.save_dir));
    copy_jstring(env, diagnostic_path, host.diagnostic_path, sizeof(host.diagnostic_path));
    if (host.diagnostic_fd >= 0) close(host.diagnostic_fd);
    host.diagnostic_fd = host.diagnostic_path[0]
        ? open(host.diagnostic_path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644)
        : -1;
    atomic_store(&host.diagnostic_stage, 0);
    atomic_store(&host.frame_count, 0);
    atomic_store(&host.aspect_micros, 0);
    atomic_store(&host.viewport_left, 0);
    atomic_store(&host.viewport_top, 0);
    atomic_store(&host.viewport_right, 0);
    atomic_store(&host.viewport_bottom, 0);
    reset_ambient(false);
    install_native_signal_handlers();
    set_stage(0, "native-bootstrap-enter");
    atomic_store(&host.stop_requested, false);
    atomic_store(&host.paused, false);
    return load_host() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetSurface(JNIEnv *env, jclass clazz, jobject surface) {
    (void)clazz;
    ANativeWindow *next = surface ? ANativeWindow_fromSurface(env, surface) : NULL;
    if (next) configure_hw_window_geometry(next);
    pthread_mutex_lock(&host.window_mutex);
    ANativeWindow *previous = host.window;
    host.window = next;
    pthread_mutex_unlock(&host.window_mutex);
    atomic_store(&host.hw_surface_dirty, true);
    if (previous) ANativeWindow_release(previous);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeRun(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    if (!atomic_load(&host.loaded)) return;
    atomic_store(&host.running, true);
    if (host.hardware_requested && !bind_hw_window_surface()) {
        LOGE("Hardware core could not bind GameDeck surface: %s", host.last_error);
        atomic_store(&host.running, false);
        return;
    }
    const double fps = host.fps > 1.0 ? host.fps : 60.0;
    const int64_t frame_ns = (int64_t)(1000000000.0 / fps);
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);
    int save_counter = 0;
    while (!atomic_load(&host.stop_requested) && !atomic_load(&host.shutdown_requested)) {
        if (atomic_load(&host.paused)) {
            struct timespec delay = {.tv_sec = 0, .tv_nsec = 10000000};
            nanosleep(&delay, NULL);
            clock_gettime(CLOCK_MONOTONIC, &next);
            continue;
        }
        if (atomic_exchange(&host.options_display_update_pending, false)) {
            retro_core_options_update_display_callback_t callback = host.options_display_callback;
            if (callback) callback();
        }
        if (atomic_load(&host.frame_count) == 0) set_stage(20, "retro-run-first-enter");
        host.retro_run();
        unsigned long frames = atomic_fetch_add(&host.frame_count, 1) + 1;
        if (frames == 1) set_stage(21, "retro-run-first-complete");
        if (++save_counter >= (int)(fps * 10.0)) {
            persist_save_ram();
            save_counter = 0;
        }
        next.tv_nsec += frame_ns;
        while (next.tv_nsec >= 1000000000L) { next.tv_sec++; next.tv_nsec -= 1000000000L; }
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, NULL);
    }
    persist_save_ram();
    if (host.hardware_requested && host.egl_display != EGL_NO_DISPLAY)
        eglMakeCurrent(host.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    atomic_store(&host.running, false);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativePause(JNIEnv *env, jclass clazz, jboolean paused) {
    (void)env;
    (void)clazz;
    atomic_store(&host.paused, paused == JNI_TRUE);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeStop(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    atomic_store(&host.stop_requested, true);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeRelease(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    atomic_store(&host.stop_requested, true);
    for (int i = 0; i < 200 && atomic_load(&host.running); i++) usleep(5000);
    unload_host();
    pthread_mutex_lock(&host.window_mutex);
    ANativeWindow *window = host.window;
    host.window = NULL;
    pthread_mutex_unlock(&host.window_mutex);
    if (window) ANativeWindow_release(window);
    reset_ambient(true);
    set_stage(90, "native-release-complete");
    if (host.diagnostic_fd >= 0) {
        close(host.diagnostic_fd);
        host.diagnostic_fd = -1;
    }
}

static bool option_contains_value(const char *definition, const char *requested) {
    if (!definition || !requested || !*requested) return false;
    const char *separator = strchr(definition, ';');
    const char *cursor = separator ? separator + 1 : definition;
    while (*cursor == ' ') cursor++;
    while (*cursor) {
        const char *end = strchr(cursor, '|');
        size_t length = end ? (size_t)(end - cursor) : strlen(cursor);
        while (length && cursor[length - 1] == ' ') length--;
        if (strlen(requested) == length && !strncmp(cursor, requested, length)) return true;
        if (!end) break;
        cursor = end + 1;
    }
    return false;
}

static void append_sanitized(char *target, size_t capacity, size_t *offset, const char *value) {
    if (!target || !capacity || !offset || !value) return;
    while (*value && *offset + 1 < capacity) {
        char c = *value++;
        if (c == '\t' || c == '\n' || c == '\r') c = ' ';
        target[(*offset)++] = c;
    }
    target[*offset] = '\0';
}

JNIEXPORT jstring JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeCoreOptions(JNIEnv *env, jclass clazz) {
    (void)clazz;
    size_t capacity = 131072u;
    char *buffer = calloc(1u, capacity);
    if (!buffer) return (*env)->NewStringUTF(env, "");
    size_t offset = 0u;
    pthread_mutex_lock(&host.variable_mutex);
    for (size_t i = 0; i < host.variable_count && offset + 8u < capacity; i++) {
        core_variable_t *slot = &host.variables[i];
        if (!slot->visible) continue;
        append_sanitized(buffer, capacity, &offset, slot->key ? slot->key : "");
        if (offset + 1u < capacity) buffer[offset++] = '\t';
        append_sanitized(buffer, capacity, &offset, slot->value);
        if (offset + 1u < capacity) buffer[offset++] = '\t';
        append_sanitized(buffer, capacity, &offset, slot->definition ? slot->definition : "");
        if (offset + 1u < capacity) buffer[offset++] = '\t';
        append_sanitized(buffer, capacity, &offset, slot->default_value ? slot->default_value : "");
        if (offset + 1u < capacity) buffer[offset++] = '\n';
        buffer[offset] = '\0';
    }
    pthread_mutex_unlock(&host.variable_mutex);
    jstring result = (*env)->NewStringUTF(env, buffer);
    free(buffer);
    return result;
}

JNIEXPORT jstring JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeInputDescriptors(JNIEnv *env, jclass clazz) {
    (void)clazz;
    size_t capacity = 65536u;
    char *buffer = calloc(1u, capacity);
    if (!buffer) return (*env)->NewStringUTF(env, "");
    size_t offset = 0u;
    pthread_mutex_lock(&host.variable_mutex);
    for (size_t i = 0; i < host.input_descriptor_count && offset + 16u < capacity; i++) {
        input_descriptor_t *slot = &host.input_descriptors[i];
        int written = snprintf(buffer + offset, capacity - offset, "%u\t%u\t%u\t%u\t",
            slot->port, slot->device, slot->index, slot->id);
        if (written < 0 || (size_t)written >= capacity - offset) break;
        offset += (size_t)written;
        append_sanitized(buffer, capacity, &offset, slot->description ? slot->description : "");
        if (offset + 1u < capacity) buffer[offset++] = '\n';
        buffer[offset] = '\0';
    }
    pthread_mutex_unlock(&host.variable_mutex);
    jstring result = (*env)->NewStringUTF(env, buffer);
    free(buffer);
    return result;
}

JNIEXPORT jboolean JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetCoreOption(
        JNIEnv *env, jclass clazz, jstring key_value, jstring option_value) {
    (void)clazz;
    if (!key_value || !option_value) return JNI_FALSE;
    const char *key = (*env)->GetStringUTFChars(env, key_value, NULL);
    const char *value = (*env)->GetStringUTFChars(env, option_value, NULL);
    bool changed = false;
    if (key && value) {
        pthread_mutex_lock(&host.variable_mutex);
        for (size_t i = 0; i < host.variable_count; i++) {
            core_variable_t *slot = &host.variables[i];
            if (!slot->key || strcmp(slot->key, key)) continue;
            if (option_contains_value(slot->definition, value)
                && strlen(value) < sizeof(slot->value)) {
                snprintf(slot->value, sizeof(slot->value), "%s", value);
                atomic_store(&host.variables_updated, true);
                atomic_store(&host.options_display_update_pending, true);
                changed = true;
            }
            break;
        }
        pthread_mutex_unlock(&host.variable_mutex);
    }
    if (key) (*env)->ReleaseStringUTFChars(env, key_value, key);
    if (value) (*env)->ReleaseStringUTFChars(env, option_value, value);
    return changed ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetKey(
        JNIEnv *env, jclass clazz, jint key, jboolean pressed) {
    (void)env;
    (void)clazz;
    if (key >= 0 && key < MAX_KEYS) {
        bool down = pressed == JNI_TRUE;
        atomic_store(&host.keys[key], down ? 1 : 0);
        retro_keyboard_event_t callback = host.keyboard_callback;
        if (callback) callback(down, (unsigned)key, 0u, 0u);
    }
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetPointerForPort(
        JNIEnv *env, jclass clazz, jint port, jfloat x, jfloat y, jboolean pressed) {
    (void)env;
    (void)clazz;
    if (port < 0 || port >= MAX_PLAYERS) return;
    float cx = x < -1.0f ? -1.0f : x > 1.0f ? 1.0f : x;
    float cy = y < -1.0f ? -1.0f : y > 1.0f ? 1.0f : y;
    atomic_store(&host.pointer_x[port], (int)(cx * 32767.0f));
    atomic_store(&host.pointer_y[port], (int)(cy * 32767.0f));
    atomic_store(&host.pointer_pressed[port], pressed == JNI_TRUE ? 1 : 0);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetButtonForPort(
        JNIEnv *env, jclass clazz, jint port, jint id, jboolean pressed) {
    (void)env;
    (void)clazz;
    if (port >= 0 && port < MAX_PLAYERS && id >= 0 && id < 16)
        atomic_store(&host.buttons[port][id], pressed == JNI_TRUE ? 1 : 0);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetAxisForPort(
        JNIEnv *env, jclass clazz, jint port, jint axis, jfloat value) {
    (void)env;
    (void)clazz;
    if (port < 0 || port >= MAX_PLAYERS || axis < 0 || axis >= 6) return;
    float clamped = value < -1.0f ? -1.0f : value > 1.0f ? 1.0f : value;
    atomic_store(&host.axes[port][axis], (int)(clamped * 32767.0f));
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetButton(JNIEnv *env, jclass clazz, jint id, jboolean pressed) {
    Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetButtonForPort(env, clazz, 0, id, pressed);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetAxis(JNIEnv *env, jclass clazz, jint axis, jfloat value) {
    Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetAxisForPort(env, clazz, 0, axis, value);
}

JNIEXPORT jint JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeReadAudio(JNIEnv *env, jclass clazz, jshortArray target, jint max_shorts) {
    (void)clazz;
    if (!target || max_shorts <= 0) return 0;
    jsize capacity = (*env)->GetArrayLength(env, target);
    size_t wanted = (size_t)(max_shorts < capacity ? max_shorts : capacity);
    wanted &= ~(size_t)1u;
    jshort *output = (*env)->GetShortArrayElements(env, target, NULL);
    if (!output) return 0;
    pthread_mutex_lock(&host.audio_mutex);
    size_t count = wanted < host.audio_count ? wanted : host.audio_count;
    for (size_t i = 0; i < count; i++) {
        output[i] = host.audio_ring[host.audio_read];
        host.audio_read = (host.audio_read + 1) % AUDIO_RING_SHORTS;
    }
    host.audio_count -= count;
    pthread_mutex_unlock(&host.audio_mutex);
    (*env)->ReleaseShortArrayElements(env, target, output, 0);
    return (jint)count;
}

JNIEXPORT jint JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSampleRate(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return (jint)llround(AUDIO_OUTPUT_RATE);
}

JNIEXPORT void JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeSetViewportInsets(
        JNIEnv *env, jclass clazz, jint left, jint top, jint right, jint bottom) {
    (void)env;
    (void)clazz;
    atomic_store(&host.viewport_left, left < 0 ? 0 : left);
    atomic_store(&host.viewport_top, top < 0 ? 0 : top);
    atomic_store(&host.viewport_right, right < 0 ? 0 : right);
    atomic_store(&host.viewport_bottom, bottom < 0 ? 0 : bottom);
}

JNIEXPORT jfloat JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeVideoAspect(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    int aspect = atomic_load(&host.aspect_micros);
    return aspect > 500000 ? (jfloat)((double)aspect / 1000000.0) : 4.0f / 3.0f;
}

JNIEXPORT jstring JNICALL
Java_io_gamedeck_mobile_GameDeckPlayActivity_nativeLastError(JNIEnv *env, jclass clazz) {
    (void)clazz;
    return (*env)->NewStringUTF(env, host.last_error[0] ? host.last_error : "Unknown embedded runtime error");
}
