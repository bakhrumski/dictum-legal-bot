'use strict';

/**
 * The length of an uploaded recording, measured on the server (2026-10-20
 * review: /api/voice/transcribe took the client's durationSec for both the
 * 30-minute limit and the cost estimate, so durationSec=0 let hours of audio
 * through). ffmpeg (ffmpeg-static, already used for Telegram TTS) reads the
 * container's duration; a browser recording (WebM/Opus from MediaRecorder)
 * often has none, so the file is then decoded to the null sink and the last
 * "time=" is taken. Returns seconds, or null when it cannot be measured.
 */

const { spawn } = require('child_process');

function ffmpegPath() {
  try { return require('ffmpeg-static') || null; } catch (_) { return null; }
}

const toSec = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

function run(bin, args, input, timeoutMs) {
  return new Promise((resolve) => {
    let err = '';
    let done = false;
    const p = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} finish(null); }, timeoutMs);
    p.stderr.on('data', (d) => { if (err.length < 200000) err += d.toString(); });
    p.on('error', () => finish(null));
    p.on('close', () => finish(err));
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}

async function probeAudioSeconds(buffer, { timeoutMs = 25000, bin = ffmpegPath() } = {}) {
  if (!bin || !buffer || !buffer.length) return null;
  // 1. the container's own duration
  const head = await run(bin, ['-hide_banner', '-i', 'pipe:0'], buffer, Math.min(timeoutMs, 10000));
  const d = head && /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/u.exec(head);
  if (d) return toSec(d[1], d[2], d[3]);
  // 2. none (a browser recording): decode to the null sink, take the last time=
  const full = await run(bin, ['-hide_banner', '-nostats', '-progress', 'pipe:2', '-i', 'pipe:0', '-f', 'null', '-'], buffer, timeoutMs);
  if (!full) return null;
  const times = [...full.matchAll(/out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/gu)];
  if (times.length) { const t = times[times.length - 1]; return toSec(t[1], t[2], t[3]); }
  const legacy = [...full.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/gu)];
  if (legacy.length) { const t = legacy[legacy.length - 1]; return toSec(t[1], t[2], t[3]); }
  return null;
}

module.exports = { probeAudioSeconds, ffmpegPath };
