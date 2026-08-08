#include <dlfcn.h>
#include <stdbool.h>
#include <stdio.h>

struct retro_system_info {
    const char *library_name;
    const char *library_version;
    const char *valid_extensions;
    bool need_fullpath;
    bool block_extract;
};

typedef unsigned (*retro_api_version_t)(void);
typedef void (*retro_get_system_info_t)(struct retro_system_info *);

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s core.so\n", argv[0]);
        return 64;
    }
    dlerror();
    void *handle = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (handle == NULL) {
        fprintf(stderr, "DLOPEN_FAIL\t%s\n", dlerror());
        return 2;
    }
    dlerror();
    retro_api_version_t api = (retro_api_version_t)dlsym(handle, "retro_api_version");
    retro_get_system_info_t info_fn = (retro_get_system_info_t)dlsym(handle, "retro_get_system_info");
    const char *symbol_error = dlerror();
    if (symbol_error != NULL || api == NULL || info_fn == NULL) {
        fprintf(stderr, "SYMBOL_FAIL\t%s\n", symbol_error == NULL ? "missing required symbol" : symbol_error);
        dlclose(handle);
        return 3;
    }
    struct retro_system_info info = {0};
    unsigned version = api();
    info_fn(&info);
    printf("PASS\tapi=%u\tname=%s\tversion=%s\textensions=%s\tfullpath=%d\textract=%d\n",
        version,
        info.library_name == NULL ? "" : info.library_name,
        info.library_version == NULL ? "" : info.library_version,
        info.valid_extensions == NULL ? "" : info.valid_extensions,
        info.need_fullpath ? 1 : 0,
        info.block_extract ? 1 : 0);
    dlclose(handle);
    return version == 1 ? 0 : 4;
}
