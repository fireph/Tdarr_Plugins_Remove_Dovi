import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { plugin } from
  '../../../../../../FlowPluginsTs/CommunityFlowPlugins/video/removeDolbyVision/1.0.0/index';
import * as cliUtils from '../../../../../../FlowPluginsTs/FlowHelpers/1.0.0/cliUtils';
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
const rawVideo = (file: string, codec: string, stream = 'v:0'): Buffer => exec(ffmpeg, [
  '-v', 'error', '-i', file, '-map', `0:${stream}`, '-c', 'copy',
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

const frameMetadata = (file: string, stream = 'v:0') => probe(file, [
  '-select_streams', stream, '-show_frames', '-show_entries', 'frame=side_data_list',
]).frames.map((frame: { side_data_list?: { side_data_type: string }[] }) => (
  frame.side_data_list?.filter((data) => /HDR10\+|Mastering display|Content light/.test(data.side_data_type)) || []
));

const expectPreservedVideo = (input: string, output: string, codec: string, stream = 'v:0') => {
  const before = rawVideo(input, codec, stream);
  const after = rawVideo(output, codec, stream);
  if (codec === 'hevc') {
    const inputUnits = hevcUnits(before);
    const outputUnits = hevcUnits(after);
    expect(inputUnits.some((nal) => nal.type === 62)).toBe(true);
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
  expect(frameMetadata(output, stream)).toEqual(frameMetadata(input, stream));
};

describeMedia('Remove Dolby Vision with real media', () => {
  let workDir: string;
  beforeEach(() => { workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdarr-dovi-test-')); });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const makeArgs = (file: string): IpluginInputArgs => ({
    inputFileObj: {
      _id: file,
      ffProbeData: probe(file, ['-show_streams', '-show_format']),
    },
    inputs: { ffprobePath: ffprobe },
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
    if (profile === 7) {
      expect(hevcUnits(rawVideo(input, 'hevc')).some((nal) => nal.type === 63)).toBe(true);
    }
    expectPreservedVideo(input, output, String(codec));
    if (String(fixture).includes('hdr10plus')) expect(JSON.stringify(frameMetadata(input))).toContain('HDR10+');
    expect(fs.readFileSync(input)).toEqual(original);
    expect((await plugin(makeArgs(output))).outputNumber).toBe(2);
  });

  it.each([['hevc', 'hvc1'], ['av1', 'av01']])('preserves HDR10+ when stripping %s in MP4', async (codec, tag) => {
    const input = path.join(workDir, 'Movie [DV] $literal.mp4');
    exec(ffmpeg, [
      '-v', 'error', '-i', path.join(fixtures, `${codec}-hdr10plus.mkv`),
      '-map', '0', '-c', 'copy', '-strict', 'unofficial', input,
    ]);
    const result = await plugin(makeArgs(input));
    expect(result.outputNumber).toBe(1);
    const output = result.outputFileObj._id;
    const info = probe(output, ['-show_streams']);
    expect(info.streams[0].codec_tag_string).toBe(tag);
    expect(JSON.stringify(info)).not.toMatch(/DOVI configuration record/);
    expect(JSON.stringify(frameMetadata(input))).toContain('HDR10+');
    expectPreservedVideo(input, output, codec);
  });

  it('routes a profile 5 MP4 with actual RPU payloads to output 3 without modifying it', async () => {
    const input = path.join(fixtures, 'hevc-profile5.mp4');
    const original = fs.readFileSync(input);
    const args = makeArgs(input);
    expect(args.inputFileObj.ffProbeData.streams?.[0].side_data_list).toEqual(expect.arrayContaining([
      expect.objectContaining({ dv_profile: 5, dv_bl_signal_compatibility_id: 0 }),
    ]));
    expect(hevcUnits(rawVideo(input, 'hevc')).filter((nal) => nal.type === 62)).toHaveLength(8);
    const result = await plugin(args);
    expect(result.outputNumber).toBe(3);
    expect(result.outputFileObj).toBe(args.inputFileObj);
    expect(fs.readFileSync(input)).toEqual(original);
    expect(fs.readdirSync(workDir)).toEqual([]);
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('preserves HLG and encoded pictures when removing profile 8.4 from MOV', async () => {
    const input = path.join(fixtures, 'hevc-hlg.mov');
    const original = fs.readFileSync(input);
    const args = makeArgs(input);
    expect(args.inputFileObj.ffProbeData.streams?.[0].side_data_list).toEqual(expect.arrayContaining([
      expect.objectContaining({ dv_profile: 8, dv_bl_signal_compatibility_id: 4 }),
    ]));
    const result = await plugin(args);
    expect(result.outputNumber).toBe(1);
    const info = probe(result.outputFileObj._id, ['-show_streams']);
    expect(info.streams[0]).toEqual(expect.objectContaining({
      color_transfer: 'arib-std-b67', color_primaries: 'bt2020', color_space: 'bt2020nc', codec_tag_string: 'hvc1',
    }));
    expect(JSON.stringify(info)).not.toMatch(/DOVI configuration record/);
    expectPreservedVideo(input, result.outputFileObj._id, 'hevc');
    expect(fs.readFileSync(input)).toEqual(original);
    expect((await plugin(makeArgs(result.outputFileObj._id))).outputNumber).toBe(2);
  });

  it('processes both HEVC and AV1 Dolby Vision tracks while preserving a third ordinary HDR track', async () => {
    const input = path.join(workDir, 'multiple videos.mkv');
    exec(ffmpeg, [
      '-v', 'error', '-i', path.join(fixtures, 'hevc-hdr10plus.mkv'),
      '-i', path.join(fixtures, 'av1-hdr10plus.mkv'),
      '-map', '0:v', '-map', '1:v', '-map', '0:v', '-c', 'copy',
      '-bsf:v:2', 'filter_units=remove_types=62|63,dovi_rpu=strip=1',
      '-metadata:s:v:0', 'title=HEVC HDR10+', '-metadata:s:v:1', 'title=AV1 HDR10+',
      '-metadata:s:v:2', 'title=Ordinary HDR10+', '-disposition:v:0', '0',
      '-disposition:v:1', 'default', '-disposition:v:2', '0', input,
    ]);
    const original = fs.readFileSync(input);
    const before = probe(input, ['-show_streams']);
    expect(before.streams).toHaveLength(3);
    expect(JSON.stringify(before.streams[2])).not.toContain('DOVI configuration record');
    const result = await plugin(makeArgs(input));
    expect(result.outputNumber).toBe(1);
    const output = result.outputFileObj._id;
    const after = probe(output, ['-show_streams']);
    expect(after.streams).toHaveLength(3);
    expect(JSON.stringify(after)).not.toContain('DOVI configuration record');
    before.streams.forEach((stream: { tags: { title: string }, disposition: unknown }, index: number) => {
      expect(after.streams[index].tags.title).toBe(stream.tags.title);
      expect(after.streams[index].disposition).toEqual(stream.disposition);
      expect(JSON.stringify(frameMetadata(input, `v:${index}`))).toContain('HDR10+');
      expect(frameMetadata(output, `v:${index}`)).toEqual(frameMetadata(input, `v:${index}`));
    });
    expectPreservedVideo(input, output, 'hevc', 'v:0');
    expectPreservedVideo(input, output, 'av1', 'v:1');
    expect(rawVideo(output, 'hevc', 'v:2')).toEqual(rawVideo(input, 'hevc', 'v:2'));
    expect(fs.readFileSync(input)).toEqual(original);
  });

  it('leaves an entire mixed-profile file unchanged when one track is Dolby Vision-only', async () => {
    const input = path.join(fixtures, 'hevc-mixed-profiles.mkv');
    const original = fs.readFileSync(input);
    const args = makeArgs(input);
    expect(args.inputFileObj.ffProbeData.streams?.[0].side_data_list).toEqual(expect.arrayContaining([
      expect.objectContaining({ dv_profile: 8, dv_bl_signal_compatibility_id: 1 }),
    ]));
    expect(args.inputFileObj.ffProbeData.streams?.[1].side_data_list).toEqual(expect.arrayContaining([
      expect.objectContaining({ dv_profile: 5, dv_bl_signal_compatibility_id: 0 }),
    ]));
    const result = await plugin(args);
    expect(result.outputNumber).toBe(3);
    expect(result.outputFileObj).toBe(args.inputFileObj);
    expect(fs.readFileSync(input)).toEqual(original);
    expect(fs.readdirSync(workDir)).toEqual([]);
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('rejects a truncated source whose container still advertises the original duration', async () => {
    const input = path.join(workDir, 'truncated.mkv');
    const fixture = fs.readFileSync(path.join(fixtures, 'hevc-hdr10plus.mkv'));
    const truncated = fixture.subarray(0, Math.floor(fixture.length / 2));
    fs.writeFileSync(input, truncated);
    const args = makeArgs(input);
    expect(Number(args.inputFileObj.ffProbeData.format?.duration)).toBeGreaterThan(10);
    await expect(plugin(args)).rejects.toThrow('FFprobe validation failed');
    expect(args.logOutcome).not.toHaveBeenCalled();
    expect(fs.readFileSync(input)).toEqual(truncated);
    expect(fs.readdirSync(workDir)).toEqual(['truncated.mkv']);
  });

  it('rejects a shortened remux even when FFmpeg exits zero and the output is playable', async () => {
    const input = path.join(fixtures, 'hevc-hdr10plus.mkv');
    const original = fs.readFileSync(input);
    const ActualCLI = cliUtils.CLI;
    let remuxExit: number | undefined;
    let output = '';
    jest.spyOn(cliUtils, 'CLI').mockImplementation((config) => {
      const cli = new ActualCLI(config);
      const run = cli.runCli;
      const remuxing = config.spawnArgs.includes('-i');
      if (remuxing) {
        output = config.outputFilePath;
        config.spawnArgs.splice(config.spawnArgs.length - 1, 0, '-t', '5');
      }
      cli.runCli = async () => {
        const result = await run();
        if (remuxing) remuxExit = result.cliExitCode;
        return result;
      };
      return cli;
    });
    const args = makeArgs(input);
    await expect(plugin(args)).rejects.toThrow('packet count changed');
    expect(remuxExit).toBe(0);
    expect(fs.statSync(output).size).toBeGreaterThan(0);
    expect(Number(probe(output, ['-show_format']).format.duration)).toBeLessThan(6);
    expect(args.logOutcome).not.toHaveBeenCalled();
    expect(fs.readFileSync(input)).toEqual(original);
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
