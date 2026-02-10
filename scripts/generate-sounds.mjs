import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(__dirname, '..', 'assets', 'sounds');

function writeWav16Mono({ sampleRate, samples }) {
  // 16-bit PCM mono WAV
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');

  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  // samples: float [-1, 1]
  let offset = 44;
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }

  return buffer;
}

function genTone({ sampleRate, durationSec, freqHz, amp = 0.35, attackSec = 0.01, releaseSec = 0.05 }) {
  const n = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // simple ADSR envelope
    const attack = Math.min(1, t / Math.max(attackSec, 1e-6));
    const releaseStart = Math.max(0, durationSec - releaseSec);
    const release = t >= releaseStart ? Math.max(0, (durationSec - t) / Math.max(releaseSec, 1e-6)) : 1;
    const env = attack * release;

    // slight vibrato to make it feel less like a test tone
    const vib = 1 + 0.01 * Math.sin(2 * Math.PI * 5 * t);
    const phase = 2 * Math.PI * (freqHz * vib) * t;
    samples[i] = amp * env * Math.sin(phase);
  }
  return samples;
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function silence(sampleRate, durationSec) {
  return new Float32Array(Math.floor(sampleRate * durationSec));
}

async function main() {
  const sampleRate = 44100;
  await fs.mkdir(outDir, { recursive: true });

  // Deterministic set of "ring" sounds. Keep them short.
  const specs = [
    { id: 'ring1', parts: [{ f: 880, d: 0.14 }, { s: 0.04 }, { f: 1320, d: 0.12 }] },
    { id: 'ring2', parts: [{ f: 660, d: 0.16 }, { s: 0.03 }, { f: 990, d: 0.16 }] },
    { id: 'ring3', parts: [{ f: 1046.5, d: 0.12 }, { s: 0.05 }, { f: 784, d: 0.18 }] },
    { id: 'ring4', parts: [{ f: 523.25, d: 0.18 }, { s: 0.04 }, { f: 783.99, d: 0.12 }] },
    { id: 'ring5', parts: [{ f: 740, d: 0.10 }, { s: 0.03 }, { f: 740, d: 0.10 }, { s: 0.03 }, { f: 1108, d: 0.12 }] },
    { id: 'ring6', parts: [{ f: 988, d: 0.09 }, { s: 0.03 }, { f: 1175, d: 0.09 }, { s: 0.03 }, { f: 1397, d: 0.11 }] },
    { id: 'ring7', parts: [{ f: 392, d: 0.22 }, { s: 0.05 }, { f: 587.33, d: 0.16 }] },
    { id: 'ring8', parts: [{ f: 1200, d: 0.08 }, { s: 0.03 }, { f: 600, d: 0.18 }] },
    { id: 'ring9', parts: [{ f: 830.61, d: 0.12 }, { s: 0.02 }, { f: 830.61, d: 0.12 }, { s: 0.05 }, { f: 1244.5, d: 0.10 }] },
    { id: 'ring10', parts: [{ f: 500, d: 0.10 }, { s: 0.02 }, { f: 750, d: 0.10 }, { s: 0.02 }, { f: 1000, d: 0.10 }] }
  ];

  for (const spec of specs) {
    const chunks = [];
    for (const p of spec.parts) {
      if (p.s) chunks.push(silence(sampleRate, p.s));
      else chunks.push(genTone({ sampleRate, durationSec: p.d, freqHz: p.f }));
    }
    const samples = concat(...chunks);
    const wav = writeWav16Mono({ sampleRate, samples });
    const outPath = path.join(outDir, `${spec.id}.wav`);
    await fs.writeFile(outPath, wav);
  }

  // Small manifest for runtime.
  const manifest = specs.map((s) => ({ id: s.id, file: `assets/sounds/${s.id}.wav` }));
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Generated ${specs.length} sounds in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
