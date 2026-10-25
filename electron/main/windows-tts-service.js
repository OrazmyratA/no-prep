// Offline text-to-speech with the voices built into Windows (the "OneCore" voices from Settings →
// Time & language → Speech, reached through the Windows Runtime API from PowerShell). The last
// resort when the online voices fail: plainer than them, but free, offline and always there.
// Which languages exist depends on the PC (stock Windows has English; others come with language
// packs), so a language without a voice is reported, never read out with another language's voice.
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const RUN_TIMEOUT_MS = 30_000;

// Runs with the input in environment variables (NP_TTS_*): text from a UTF-8 file, so no quoting
// or code page can damage it. Prints the voice list as JSON, or writes the WAV file.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
if ($env:NP_TTS_MODE -eq 'list') {
  ConvertTo-Json -Compress @($voices | ForEach-Object { @{ id = $_.Id; name = $_.DisplayName; language = $_.Language } })
  exit 0
}
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = $voices | Where-Object { $_.Id -eq $env:NP_TTS_VOICE } | Select-Object -First 1
$text = [IO.File]::ReadAllText($env:NP_TTS_TEXT, [Text.Encoding]::UTF8)
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($env:NP_TTS_OUT, $bytes)
`;
const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');

class NoVoiceForLanguageError extends Error {
  constructor(language) {
    super(`No Windows voice is installed for ${language}.`);
    this.code = 'NO_VOICE_FOR_LANGUAGE';
    this.language = language;
  }
}

function createWindowsTtsService() {
  let voicesPromise = null;
  let queue = Promise.resolve();

  const available = process.platform === 'win32';

  function runScript(env) {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED_SCRIPT],
        { env: { ...process.env, ...env }, timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(String(stderr || error.message || 'Windows speech failed.').trim().slice(0, 300)));
          else resolve(String(stdout || ''));
        }
      );
    });
  }

  function getVoices() {
    if (!voicesPromise) {
      voicesPromise = runScript({ NP_TTS_MODE: 'list' })
        .then((out) => {
          const parsed = JSON.parse(out.trim() || '[]');
          return (Array.isArray(parsed) ? parsed : [parsed]).filter((voice) => voice?.id && voice?.language);
        })
        .catch((error) => {
          voicesPromise = null;
          throw error;
        });
    }
    return voicesPromise;
  }

  /** Exact locale first (en-GB), then the same language (en-US for en-GB); never another language. */
  async function pickVoice(language) {
    const wanted = String(language || 'en-US').trim().toLowerCase().replace('_', '-');
    const primary = wanted.split('-')[0];
    const voices = await getVoices();
    return voices.find((voice) => voice.language.toLowerCase() === wanted)
      || voices.find((voice) => voice.language.toLowerCase().split('-')[0] === primary)
      || null;
  }

  async function synthesizeOnce(text, language) {
    const voice = await pickVoice(language);
    if (!voice) throw new NoVoiceForLanguageError(language);
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'noprep-tts-'));
    try {
      const textFile = path.join(dir, 'text.txt');
      const outFile = path.join(dir, 'speech.wav');
      await fsp.writeFile(textFile, text, 'utf8');
      await runScript({ NP_TTS_MODE: 'speak', NP_TTS_VOICE: voice.id, NP_TTS_TEXT: textFile, NP_TTS_OUT: outFile });
      const audio = await fsp.readFile(outFile);
      if (!audio.length) throw new Error('Windows speech returned no audio.');
      return { audioBase64: audio.toString('base64'), mimeType: 'audio/wav', voice: voice.name };
    } finally {
      fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** One clip at a time: each one starts PowerShell, and a batch of them at once would swamp a weak PC. */
  function synthesizeSpeech(input) {
    const text = String(input?.text || '').trim();
    if (!available) return Promise.reject(new Error('Windows voices are only available on Windows.'));
    if (!text) return Promise.resolve({ audioBase64: '', mimeType: 'audio/wav', voice: '' });
    const run = queue.then(() => synthesizeOnce(text, input?.language));
    queue = run.catch(() => {});
    return run;
  }

  return { available, synthesizeSpeech, getVoices };
}

module.exports = { createWindowsTtsService, NoVoiceForLanguageError };
