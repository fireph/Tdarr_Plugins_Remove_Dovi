import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { plugin } from
  '../../../../../../FlowPluginsTs/CommunityFlowPlugins/video/removeDolbyVision/1.0.0/index';
import { IpluginInputArgs } from '../../../../../../FlowPluginsTs/FlowHelpers/1.0.0/interfaces/interfaces';

// Opt in with real FFmpeg/FFprobe binaries; ordinary unit tests do not download or require media tools.
const ffmpeg = process.env.TDARR_TEST_FFMPEG || '';
const ffprobe = process.env.TDARR_TEST_FFPROBE || '';
const describeMedia = ffmpeg && ffprobe ? describe : describe.skip;
const fixtures = path.resolve(__dirname, '../../../../../sampleData/media/dolbyVision');
const exec = (binary: string, cliArgs: string[]): Buffer => execFileSync(binary, cliArgs, {
  maxBuffer: 32 * 1024 * 1024,
  timeout: 30000,
});
const probe = (file: string, options: string[] = []) => JSON.parse(exec(ffprobe, [
  '-v', 'error', '-of', 'json', ...options, file,
]).toString());
const rawVideo = (file: string, codec: string): Buffer => exec(ffmpeg, [
  '-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy',
  ...(codec === 'hevc' ? ['-bsf:v', 'hevc_mp4toannexb'] : []),
  '-f', codec === 'hevc' ? 'hevc' : 'obu', 'pipe:1',
]);

const hevcUnits = (raw: Buffer): { type: number, data: string }[] => raw.toString('binary')
  // eslint-disable-next-line no-control-regex
  .split(/\x00\x00\x00?\x01/).filter(Boolean).map((nal) => ({
    type: Math.floor(nal.charCodeAt(0) / 2) % 64,
    data: Buffer.from(nal, 'binary').toString('hex'),
  }));

const av1Units = (raw: Buffer): { type: number, data: string, dolby: boolean }[] => {
  const result = [];
  let offset = 0;
  while (offset < raw.length) {
    const start = offset;
    const header = raw[offset];
    offset += 1;
    if (Math.floor(header / 4) % 2) offset += 1;
    if (!(Math.floor(header / 2) % 2)) throw new Error('Expected an OBU size field');
    let size = 0;
    let multiplier = 1;
    let byte: number;
    do {
      byte = raw[offset];
      offset += 1;
      size += (byte % 128) * multiplier;
      multiplier *= 128;
    } while (byte >= 128);
    const type = Math.floor(header / 8) % 16;
    const dolby = type === 5 && raw.subarray(offset, offset + 4).equals(Buffer.from([4, 0xb5, 0, 0x3b]));
    offset += size;
    result.push({ type, dolby, data: raw.subarray(start, offset).toString('hex') });
  }
  return result;
};

describeMedia('Remove Dolby Vision with real media', () => {
  let workDir: string;
  beforeEach(() => { workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdarr-dovi-test-')); });
  afterEach(() => { fs.rmSync(workDir, { recursive: true, force: true }); });

  const makeArgs = (file: string): IpluginInputArgs => ({
    inputFileObj: {
      _id: file,
      ffProbeData: probe(file, ['-show_streams', '-show_format']),
    },
    inputs: {},
    variables: { user: {}, ffmpegCommand: { init: false } },
    workDir,
    ffmpegPath: ffmpeg,
    jobLog: jest.fn(),
    updateWorker: jest.fn(),
    logOutcome: jest.fn(),
    logFullCliOutput: false,
    deps: { fsextra: { ensureDirSync: (dir: string) => fs.mkdirSync(dir, { recursive: true }) } },
  } as unknown as IpluginInputArgs);

  it.each([
    ['hevc-hdr10plus.mkv', 'hevc', 8],
    ['hevc-profile7-fel.mkv', 'hevc', 7],
    ['hevc-profile7-mel.mkv', 'hevc', 7],
    ['av1-hdr10plus.mkv', 'av1', 10],
  ])('removes only Dolby Vision from %s', async (fixture, codec, profile) => {
    const input = path.join(fixtures, String(fixture));
    const original = fs.readFileSync(input);
    const args = makeArgs(input);
    const stream = args.inputFileObj.ffProbeData.streams?.[0];
    expect(stream?.side_data_list).toEqual(expect.arrayContaining([
      expect.objectContaining({ side_data_type: 'DOVI configuration record', dv_profile: profile }),
    ]));
    const result = await plugin(args);
    expect(result.outputNumber).toBe(1);
    const output = result.outputFileObj._id;
    const outputInfo = probe(output, ['-show_streams']);
    expect(outputInfo.streams[0]).toEqual(expect.objectContaining({
      codec_name: codec, color_transfer: 'smpte2084', color_primaries: 'bt2020', color_space: 'bt2020nc',
    }));
    expect(JSON.stringify(outputInfo)).not.toMatch(/DOVI configuration record/);
    const before = rawVideo(input, String(codec));
    const after = rawVideo(output, String(codec));
    if (codec === 'hevc') {
      const inputUnits = hevcUnits(before);
      const outputUnits = hevcUnits(after);
      expect(inputUnits.some((nal) => nal.type === 62)).toBe(true);
      if (profile === 7) expect(inputUnits.some((nal) => nal.type === 63)).toBe(true);
      expect(outputUnits.some((nal) => [62, 63].includes(nal.type))).toBe(false);
      // Compare every encoded picture and every SEI payload, including HDR10+ and static HDR metadata.
      const retain = (nal: { type: number }) => nal.type < 32 || [39, 40].includes(nal.type);
      expect(outputUnits.filter(retain)).toEqual(inputUnits.filter(retain));
    } else {
      const inputUnits = av1Units(before);
      const outputUnits = av1Units(after);
      expect(inputUnits.some((obu) => obu.dolby)).toBe(true);
      expect(outputUnits.some((obu) => obu.dolby)).toBe(false);
      expect(outputUnits).toEqual(inputUnits.filter((obu) => !obu.dolby));
    }
    const frameMetadata = (file: string) => probe(file, [
      '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=side_data_list',
    ]).frames.map((frame: { side_data_list?: { side_data_type: string }[] }) => (
      frame.side_data_list?.filter((data) => /HDR10\+|Mastering display|Content light/.test(data.side_data_type)) || []
    ));
    const inputHdr = frameMetadata(input);
    if (String(fixture).includes('hdr10plus')) expect(JSON.stringify(inputHdr)).toContain('HDR10+');
    expect(frameMetadata(output)).toEqual(inputHdr);
    expect(fs.readFileSync(input)).toEqual(original);
    expect((await plugin(makeArgs(output))).outputNumber).toBe(2);
  });

  it('removes Dolby Vision from MP4 container signaling and video data', async () => {
    const input = path.join(workDir, 'Movie [DV] $literal.mp4');
    exec(ffmpeg, [
      '-v', 'error', '-i', path.join(fixtures, 'hevc-hdr10plus.mkv'),
      '-map', '0', '-c', 'copy', '-strict', 'unofficial', input,
    ]);
    const result = await plugin(makeArgs(input));
    const output = result.outputFileObj._id;
    const info = probe(output, ['-show_streams']);
    expect(info.streams[0].codec_tag_string).toBe('hvc1');
    expect(JSON.stringify(info)).not.toMatch(/DOVI configuration record/);
    expect(hevcUnits(rawVideo(output, 'hevc')).some((nal) => [62, 63].includes(nal.type))).toBe(false);
  });

  it('retains audio, subtitles, attachments, chapters, metadata, dispositions and packet timing', async () => {
    const input = path.join(workDir, 'all streams.mkv');
    const subtitle = path.join(workDir, 'captions.srt');
    const metadata = path.join(workDir, 'metadata.txt');
    const attachment = path.join(workDir, 'attachment.txt');
    fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:01,000\nTest caption\n');
    fs.writeFileSync(attachment, 'Test attachment');
    fs.writeFileSync(metadata, ';FFMETADATA1\ntitle=HDR test\n[CHAPTER]\nTIMEBASE=1/1000\n'
      + 'START=0\nEND=1000\ntitle=First chapter\n');
    exec(ffmpeg, [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
      '-i', path.join(fixtures, 'hevc-hdr10plus.mkv'), '-i', subtitle, '-i', metadata,
      '-map', '0:a', '-map', '1:v', '-map', '2:s', '-map_metadata', '3', '-map_chapters', '3',
      '-c:a', 'flac', '-c:v', 'copy', '-c:s', 'copy', '-metadata:s:a:0', 'language=eng',
      '-metadata:s:a:0', 'title=Audio title', '-metadata:s:s:0', 'language=spa',
      '-disposition:a:0', '0', '-disposition:v:0', '0', '-disposition:s:0', 'forced',
      '-attach', attachment, '-metadata:s:t:0', 'mimetype=text/plain', input,
    ]);
    const result = await plugin(makeArgs(input));
    const output = result.outputFileObj._id;
    const before = probe(input, ['-show_streams', '-show_chapters', '-show_format']);
    const after = probe(output, ['-show_streams', '-show_chapters', '-show_format']);
    expect(after.streams).toHaveLength(before.streams.length);
    before.streams.forEach((stream: Record<string, unknown>, index: number) => {
      ['codec_type', 'codec_name', 'disposition'].forEach((key) => {
        expect(after.streams[index][key]).toEqual(stream[key]);
      });
      // The muxer recalculates DURATION at the container's timestamp precision.
      Object.entries((stream.tags || {}) as Record<string, string>).forEach(([key, value]) => {
        if (key !== 'DURATION') expect(after.streams[index].tags[key]).toBe(value);
      });
    });
    expect(after.chapters).toEqual(before.chapters);
    expect(after.format.tags.title).toBe('HDR test');
    const packets = (file: string, stream: string) => probe(file, [
      '-select_streams', stream, '-show_packets', '-show_data_hash', 'sha256',
      '-show_entries', 'packet=pts,dts,duration,data_hash',
    ]).packets;
    ['a', 's'].forEach((stream) => expect(packets(output, stream)).toEqual(packets(input, stream)));
    const timings = (file: string) => probe(file, [
      '-select_streams', 'v', '-show_packets', '-show_entries', 'packet=pts,dts,duration',
    ]).packets;
    expect(timings(output)).toEqual(timings(input));
    const attachmentHash = (file: string) => probe(file, [
      '-select_streams', 't', '-show_streams', '-show_data_hash', 'sha256',
      '-show_entries', 'stream=extradata_hash',
    ]).streams;
    expect(attachmentHash(output)).toEqual(attachmentHash(input));
  });
});
