// LD_PRELOAD shim for Rockchip libmali under Hyprland 0.56 (spike only).
//
// Hyprland's CHyprOpenGLImpl (src/render/OpenGL.cpp) has two assumptions that
// libmali breaks:
//  - it loads eglDebugMessageControlKHR unconditionally and aborts when it is
//    missing, though it only calls it with EGL_KHR_debug;
//  - it enters the EGL-device path when eglQueryDevicesEXT was NOT loaded and
//    then calls it through a null pointer.
// The shim advertises EGL_EXT_device_enumeration/query on the client extension
// string and answers their lookups with "no devices", so Hyprland takes its GBM
// path, and answers eglDebugMessageControlKHR with a no-op.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef void (*proc_t)(void);
typedef unsigned int EGLBoolean;
typedef int32_t EGLint;
typedef void *EGLDisplay;

#define EGL_EXTENSIONS 0x3055

static int32_t debug_message_control(void *callback, const intptr_t *attribs) {
  (void)callback;
  (void)attribs;
  return 0x3000; // EGL_SUCCESS
}

static EGLBoolean query_devices(EGLint max, void **devices, EGLint *count) {
  (void)max;
  (void)devices;
  *count = 0;
  return 1;
}

static const char *query_device_string(void *device, EGLint name) {
  (void)device;
  (void)name;
  return 0;
}

static EGLBoolean query_display_attrib(EGLDisplay dpy, EGLint attribute, intptr_t *value) {
  (void)dpy;
  (void)attribute;
  (void)value;
  return 0;
}

static void *next(const char *name) { return dlsym(RTLD_NEXT, name); }

proc_t eglGetProcAddress(const char *name) {
  static proc_t (*real)(const char *);
  if (!real) real = (proc_t (*)(const char *))next("eglGetProcAddress");
  proc_t p = real ? real(name) : 0;
  if (getenv("POCKET_EGL_SHIM_TRACE")) fprintf(stderr, "[egl-shim] %s -> %p\n", name, (void *)p);
  if (p) return p;
  if (!strcmp(name, "eglDebugMessageControlKHR")) return (proc_t)debug_message_control;
  if (!strcmp(name, "eglQueryDevicesEXT")) return (proc_t)query_devices;
  if (!strcmp(name, "eglQueryDeviceStringEXT")) return (proc_t)query_device_string;
  if (!strcmp(name, "eglQueryDisplayAttribEXT")) return (proc_t)query_display_attrib;
  return 0;
}

const char *eglQueryString(EGLDisplay dpy, EGLint name) {
  static const char *(*real)(EGLDisplay, EGLint);
  static char client[4096];
  if (!real) real = (const char *(*)(EGLDisplay, EGLint))next("eglQueryString");
  const char *s = real(dpy, name);
  if (dpy || name != EGL_EXTENSIONS || !s) return s;
  if (!client[0]) snprintf(client, sizeof client, "%s EGL_EXT_device_enumeration EGL_EXT_device_query", s);
  return client;
}
