// Reproduce Hyprland's CHyprOpenGLImpl::initEGL on the GBM path and report
// which context attributes let a surfaceless eglMakeCurrent succeed.
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <fcntl.h>
#include <gbm.h>
#include <stdio.h>
#include <string.h>

static void try(EGLDisplay d, const char *label, const EGLint *attrs) {
  EGLContext c = eglCreateContext(d, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, attrs);
  if (c == EGL_NO_CONTEXT) { printf("%-28s create failed 0x%x\n", label, eglGetError()); return; }
  EGLBoolean ok = eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, c);
  EGLint err = eglGetError();
  const char *ext = ok ? (const char *)glGetString(GL_EXTENSIONS) : 0;
  printf("%-28s makeCurrent=%d err=0x%x version=%s ext=%s\n", label, ok, err,
         ok ? (const char *)glGetString(GL_VERSION) : "-", ext ? (strstr(ext, "GL_EXT_texture_format_BGRA8888") ? "has-BGRA8888" : "no-BGRA8888") : "NULL");
  eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroyContext(d, c);
}

int main(int argc, char **argv) {
  const char *node = argc > 1 ? argv[1] : "/dev/dri/renderD128";
  int fd = open(node, O_RDWR | O_CLOEXEC);
  struct gbm_device *gbm = gbm_create_device(fd);
  printf("node=%s fd=%d gbm=%p backend=%s\n", node, fd, (void *)gbm, gbm ? gbm_device_get_backend_name(gbm) : "-");
  PFNEGLGETPLATFORMDISPLAYEXTPROC gpd = (void *)eglGetProcAddress("eglGetPlatformDisplayEXT");
  EGLDisplay d = gpd(EGL_PLATFORM_GBM_KHR, gbm, NULL);
  EGLint maj, min;
  printf("display=%p init=%d %d.%d\n", d, eglInitialize(d, &maj, &min), maj, min);
  printf("display ext: %s\n", eglQueryString(d, EGL_EXTENSIONS));
  eglBindAPI(EGL_OPENGL_ES_API);
  EGLint v32[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2, EGL_NONE};
  EGLint v30[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE};
  EGLint prio[] = {EGL_CONTEXT_PRIORITY_LEVEL_IMG, EGL_CONTEXT_PRIORITY_HIGH_IMG, EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2, EGL_NONE};
  EGLint rob[] = {EGL_CONTEXT_OPENGL_RESET_NOTIFICATION_STRATEGY_EXT, EGL_LOSE_CONTEXT_ON_RESET_EXT, EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2, EGL_NONE};
  EGLint hypr[] = {EGL_CONTEXT_PRIORITY_LEVEL_IMG, EGL_CONTEXT_PRIORITY_HIGH_IMG, EGL_CONTEXT_OPENGL_RESET_NOTIFICATION_STRATEGY_EXT, EGL_LOSE_CONTEXT_ON_RESET_EXT,
                   EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2, EGL_NONE};
  try(d, "gles3.2", v32);
  try(d, "gles3.0", v30);
  try(d, "gles3.2+priority", prio);
  try(d, "gles3.2+robustness", rob);
  try(d, "hyprland (prio+robust+3.2)", hypr);
  return 0;
}
