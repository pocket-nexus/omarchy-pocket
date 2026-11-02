// pocket-asr: speech to text on the device, with no port open. It loads a
// Paraformer model through sherpa-onnx's C API and stays loaded. Each request on
// stdin is a little-endian u32 sample count and that many S16 samples at 16 kHz;
// each answer on stdout is one line of text. The first line it writes is "ready".
//
//   pocket-asr <model directory>   (model.int8.onnx, tokens.txt)
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "c-api.h"

#define MAX_SAMPLES (16000 * 120)

static int read_all(void *to, size_t size) {
  return fread(to, 1, size, stdin) == size;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: pocket-asr <model directory>\n");
    return 2;
  }
  char model[4096], tokens[4096];
  snprintf(model, sizeof model, "%s/model.int8.onnx", argv[1]);
  snprintf(tokens, sizeof tokens, "%s/tokens.txt", argv[1]);
  SherpaOnnxOfflineRecognizerConfig config;
  memset(&config, 0, sizeof config);
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.paraformer.model = model;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = 3;
  config.model_config.provider = "cpu";
  config.decoding_method = "greedy_search";
  const SherpaOnnxOfflineRecognizer *recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
  if (!recognizer) {
    fprintf(stderr, "pocket-asr: no model in %s\n", argv[1]);
    return 1;
  }
  puts("ready");
  fflush(stdout);
  int16_t *pcm = malloc(MAX_SAMPLES * sizeof *pcm);
  float *samples = malloc(MAX_SAMPLES * sizeof *samples);
  uint32_t count;
  while (read_all(&count, sizeof count)) {
    if (count > MAX_SAMPLES || !read_all(pcm, count * sizeof *pcm)) return 1;
    for (uint32_t i = 0; i < count; i++) samples[i] = pcm[i] / 32768.0f;
    const SherpaOnnxOfflineStream *stream = SherpaOnnxCreateOfflineStream(recognizer);
    SherpaOnnxAcceptWaveformOffline(stream, 16000, samples, (int32_t)count);
    SherpaOnnxDecodeOfflineStream(recognizer, stream);
    const SherpaOnnxOfflineRecognizerResult *result = SherpaOnnxGetOfflineStreamResult(stream);
    for (const char *c = result->text; *c; c++) putchar(*c == '\n' ? ' ' : *c);
    putchar('\n');
    fflush(stdout);
    SherpaOnnxDestroyOfflineRecognizerResult(result);
    SherpaOnnxDestroyOfflineStream(stream);
  }
  SherpaOnnxDestroyOfflineRecognizer(recognizer);
  return 0;
}
