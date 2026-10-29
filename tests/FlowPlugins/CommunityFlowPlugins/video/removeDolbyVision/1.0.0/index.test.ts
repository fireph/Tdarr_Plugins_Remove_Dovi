import { promises as fs, Stats } from 'fs';
import { plugin } from
  '../../../../../../FlowPluginsTs/CommunityFlowPlugins/video/removeDolbyVision/1.0.0/index';
import { CLI } from '../../../../../../FlowPluginsTs/FlowHelpers/1.0.0/cliUtils';
import { IpluginInputArgs } from '../../../../../../FlowPluginsTs/FlowHelpers/1.0.0/interfaces/interfaces';
import { IffProbeData, Istreams } from
  '../../../../../../FlowPluginsTs/FlowHelpers/1.0.0/interfaces/synced/IFileObject';

jest.mock('../../../../../../FlowPluginsTs/FlowHelpers/1.0.0/cliUtils');

const video = (profile = 8, compatibility = 1, codec = 'hevc'): Istreams => ({
  index: 0,
  codec_type: 'video',
  codec_name: codec,
  color_transfer: 'smpte2084',
  color_primaries: 'bt2020',
  disposition: { default: 0, forced: 0 },
  side_data_list: [{
    side_data_type: 'DOVI configuration record',
    dv_profile: profile,
    dv_bl_signal_compatibility_id: compatibility,
    bl_present_flag: 1,
    rpu_present_flag: 1,
    el_present_flag: profile === 7 ? 1 : 0,
  }],
});

describe('Remove Dolby Vision', () => {
  let args: IpluginInputArgs;
  let runCli: jest.Mock;
  let inputProbe: IffProbeData | undefined;
  let outputProbe: IffProbeData | undefined;
  let probeError: string;
  let probeExitCode: number;
  let malformedProbe: boolean;
  let cancelled: boolean;
  const mockCLI = CLI as jest.MockedClass<typeof CLI>;
  const remux = () => {
    const call = mockCLI.mock.calls.find(([config]) => config.spawnArgs.includes('-i'));
    if (!call) throw new Error('Expected a remux command');
    return call[0];
  };
  const command = (): string[] => remux().spawnArgs;

  beforeEach(() => {
    jest.clearAllMocks();
    cancelled = false;
    inputProbe = undefined;
    outputProbe = undefined;
    probeError = '';
    probeExitCode = 0;
    malformedProbe = false;
    runCli = jest.fn().mockResolvedValue({ cliExitCode: 0, errorLogFull: [] })
      .mockResolvedValueOnce({ cliExitCode: 0, errorLogFull: ['Bitstream filters:\nfilter_units\ndovi_rpu\n'] });
    mockCLI.mockImplementation((config) => ({
      runCli: config.spawnArgs.includes('-count_packets') ? jest.fn().mockImplementation(() => {
        const source = inputProbe ?? {
          streams: args.inputFileObj.ffProbeData.streams?.map((stream) => ({ ...stream, nb_read_packets: '259' })),
          format: { duration: '10.798' },
        };
        const output = outputProbe ?? {
          ...source,
          streams: source.streams?.map((stream, index) => ({
            ...stream, index, codec_tag_string: '', side_data_list: [],
          })),
        };
        return Promise.resolve({
          cliExitCode: probeExitCode,
          errorLogFull: [probeError, malformedProbe ? '{' : JSON.stringify(
            config.spawnArgs[config.spawnArgs.length - 1] === args.inputFileObj._id ? source : output,
          )],
        });
      }) : runCli,
      get cancelled() { return cancelled; },
    } as unknown as CLI));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 123, isFile: () => true } as Stats);
    args = {
      inputFileObj: { _id: '/media/Movie.mkv', ffProbeData: { streams: [video()] } },
      inputs: {},
      variables: { user: {}, ffmpegCommand: { init: false } },
      workDir: '/cache/work',
      ffmpegPath: '/tdarr/ffmpeg',
      jobLog: jest.fn(),
      updateWorker: jest.fn(),
      logOutcome: jest.fn(),
      logFullCliOutput: false,
      deps: { fsextra: { ensureDirSync: jest.fn() } },
    } as unknown as IpluginInputArgs;
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['HEVC profile 7 MEL/FEL with legacy compatibility', 7, 0, 'hevc'],
    ['HEVC profile 7 HDR10', 7, 1, 'hevc'],
    ['HEVC profile 7 Blu-ray', 7, 6, 'hevc'],
    ['HEVC profile 8.1 HDR10/HDR10+', 8, 1, 'hevc'],
    ['HEVC profile 8.4 HLG', 8, 4, 'hevc'],
    ['AV1 profile 10 HDR10/HDR10+', 10, 1, 'av1'],
    ['AV1 profile 10 HLG', 10, 4, 'av1'],
  ])('removes Dolby Vision from %s', async (_label, profile, compatibility, codec) => {
    args.inputFileObj.ffProbeData.streams = [video(Number(profile), Number(compatibility), String(codec))];
    const result = await plugin(args);
    expect(result.outputNumber).toBe(1);
    expect(result.outputFileObj._id).toMatch(/^\/cache\/work\/\d+\/Movie\.mkv$/);
    expect(result.variables).toBe(args.variables);
    expect(command()).toEqual(expect.arrayContaining(['-map', '0', '-c', 'copy', '-bsf:0']));
    expect(command()).toContain(codec === 'av1' ? 'dovi_rpu=strip=1'
      : 'filter_units=remove_types=62|63,dovi_rpu=strip=1');
    expect(args.logOutcome).toHaveBeenCalledWith('tSuc');
  });

  it.each([
    ['profile 5, even when PQ/BT.2020 tagged', 5, 0, 'hevc'],
    ['profile 8 SDR', 8, 2, 'hevc'],
    ['profile 8 without a compatible base', 8, 0, 'hevc'],
    ['profile 10 without a compatible base', 10, 0, 'av1'],
    ['profile 10 SDR', 10, 2, 'av1'],
    ['unknown future profile', 99, 1, 'hevc'],
    ['unsupported codec', 8, 1, 'h264'],
    ['profile/codec mismatch', 8, 1, 'av1'],
  ])('routes %s to output 3 without running FFmpeg', async (_label, profile, compatibility, codec) => {
    args.inputFileObj.ffProbeData.streams = [video(Number(profile), Number(compatibility), String(codec))];
    const result = await plugin(args);
    expect(result.outputNumber).toBe(3);
    expect(result.outputFileObj).toBe(args.inputFileObj);
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('does not strip an enhancement-layer-only track', async () => {
    const stream = video(7, 6);
    stream.side_data_list[0].bl_present_flag = 0;
    args.inputFileObj.ffProbeData.streams = [stream];
    expect((await plugin(args)).outputNumber).toBe(3);
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('leaves mixed compatible and incompatible Dolby Vision streams unchanged', async () => {
    args.inputFileObj.ffProbeData.streams = [video(), { ...video(5, 0), index: 1 }];
    expect((await plugin(args)).outputNumber).toBe(3);
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('skips ordinary HDR10+, HDR10 and SDR files, including repeat runs after removal', async () => {
    args.inputFileObj.ffProbeData.streams = [{
      ...video(),
      side_data_list: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }],
    }];
    const result = await plugin(args);
    expect(result.outputNumber).toBe(2);
    expect(result.outputFileObj).toBe(args.inputFileObj);
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('treats a Dolby Vision codec tag without profile information as unconfirmed', async () => {
    args.inputFileObj.ffProbeData.streams = [{ ...video(), codec_tag_string: 'dvhe', side_data_list: [] }];
    expect((await plugin(args)).outputNumber).toBe(3);
  });

  it.each(['Main 8', 'Profile 8.1', 'dvhe.08.06'])('uses a MediaInfo fallback with %s', async (profile) => {
    args.inputFileObj.ffProbeData.streams = [{ ...video(), index: 2, side_data_list: [] }];
    args.inputFileObj.mediaInfo = {
      track: [
        { '@type': 'Audio', StreamOrder: '0' },
        {
          '@type': 'Video',
          StreamOrder: '2',
          HDR_Format: 'Dolby Vision / SMPTE ST 2094 App 4',
          HDR_Format_Profile: profile,
          HDR_Format_Compatibility: 'HDR10 / HDR10',
        },
      ],
    } as unknown as IpluginInputArgs['inputFileObj']['mediaInfo'];
    expect((await plugin(args)).outputNumber).toBe(1);
  });

  it('does not borrow HDR10 compatibility from another video track', async () => {
    args.inputFileObj.ffProbeData.streams = [{ ...video(), side_data_list: [], codec_tag_string: 'dvhe' }];
    args.inputFileObj.mediaInfo = {
      track: [{
        '@type': 'Video',
        StreamOrder: '1',
        HDR_Format: 'Dolby Vision',
        HDR_Format_Profile: 'Main 8',
        HDR_Format_Compatibility: 'HDR10',
      }],
    } as unknown as IpluginInputArgs['inputFileObj']['mediaInfo'];
    expect((await plugin(args)).outputNumber).toBe(3);
  });

  it('never overrides an incompatible configuration record using MediaInfo', async () => {
    args.inputFileObj.ffProbeData.streams = [video(8, 0)];
    args.inputFileObj.mediaInfo = {
      track: [{
        '@type': 'Video',
        StreamOrder: '0',
        HDR_Format: 'Dolby Vision',
        HDR_Format_Profile: 'Main 8',
        HDR_Format_Compatibility: 'HDR10',
      }],
    } as unknown as IpluginInputArgs['inputFileObj']['mediaInfo'];
    expect((await plugin(args)).outputNumber).toBe(3);
  });

  it('does not associate MediaInfo with a video when stream identifiers are missing', async () => {
    const stream: Istreams = { ...video(), side_data_list: [], codec_tag_string: 'dvhe' };
    delete stream.index;
    args.inputFileObj.ffProbeData.streams = [stream];
    args.inputFileObj.mediaInfo = {
      track: [{
        '@type': 'Video',
        HDR_Format: 'Dolby Vision',
        HDR_Format_Profile: 'Main 8',
        HDR_Format_Compatibility: 'HDR10',
      }],
    } as unknown as IpluginInputArgs['inputFileObj']['mediaInfo'];
    expect((await plugin(args)).outputNumber).toBe(3);
  });

  it.each([['HDR10', 1], ['Blu-ray compatible', 1], ['', 3]])(
    'requires confirmed HDR compatibility for a profile 7 MediaInfo fallback (%s)', async (compatibility, expected) => {
      args.inputFileObj.ffProbeData.streams = [{ ...video(), side_data_list: [] }];
      args.inputFileObj.mediaInfo = {
        track: [{
          '@type': 'Video',
          StreamOrder: '0',
          HDR_Format: 'Dolby Vision',
          HDR_Format_Profile: 'Main 7',
          HDR_Format_Compatibility: compatibility,
        }],
      } as unknown as IpluginInputArgs['inputFileObj']['mediaInfo'];
      expect((await plugin(args)).outputNumber).toBe(expected);
    },
  );

  it('targets all Dolby Vision videos by output stream position while copying other streams', async () => {
    args.inputFileObj.ffProbeData.streams = [
      {
        index: 0, codec_type: 'audio', codec_name: 'truehd', disposition: { default: 1 },
      },
      {
        index: 2, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 },
      },
      { ...video(), index: 4 },
      {
        index: 5, codec_type: 'subtitle', codec_name: 'subrip', disposition: { forced: 1 },
      },
      { ...video(10, 1, 'av1'), index: 6 },
      { index: 7, codec_type: 'attachment', codec_name: 'ttf' },
    ];
    await plugin(args);
    const cmd = command();
    expect(cmd).toContain('-bsf:2');
    expect(cmd).toContain('-bsf:4');
    expect(cmd).not.toContain('-bsf:1');
    expect(cmd).toEqual(expect.arrayContaining(['-map_metadata', '0', '-map_chapters', '0']));
    expect(cmd.slice(cmd.indexOf('-disposition:2'), cmd.indexOf('-disposition:2') + 2))
      .toEqual(['-disposition:2', '0']);
    expect(cmd.slice(cmd.indexOf('-disposition:3'), cmd.indexOf('-disposition:3') + 2))
      .toEqual(['-disposition:3', 'forced']);
  });

  it.each([['hevc', 8, 'hvc1'], ['av1', 10, 'av01']])(
    'clears Dolby Vision sample entry tags for %s in MP4', async (codec, profile, tag) => {
      args.inputFileObj._id = '/media/Movie.MP4';
      args.inputFileObj.ffProbeData.streams = [video(Number(profile), 1, String(codec))];
      await plugin(args);
      expect(command().slice(command().indexOf('-tag:0'), command().indexOf('-tag:0') + 2))
        .toEqual(['-tag:0', tag]);
    },
  );

  it('passes file names and custom executable paths as arguments without using a shell', async () => {
    args.inputs.ffmpegPath = '/opt/custom ffmpeg/ffmpeg';
    args.inputFileObj._id = '/media/Movie [DV] $HOME; \'quoted\'.mkv';
    await plugin(args);
    expect(remux().cli).toBe(args.inputs.ffmpegPath);
    expect(remux().spawnOpts).toEqual({});
    expect(command()[command().indexOf('-i') + 1]).toBe(args.inputFileObj._id);
  });

  it('requires fresh stream data instead of silently skipping an unscanned file', async () => {
    args.inputFileObj.ffProbeData = {};
    await expect(plugin(args)).rejects.toThrow('Rescan');
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('rejects an active FFmpeg command block instead of silently discarding pending edits', async () => {
    args.variables.ffmpegCommand.init = true;
    await expect(plugin(args)).rejects.toThrow('outside Begin Command');
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('gives an actionable error before remuxing with an older FFmpeg', async () => {
    runCli.mockReset().mockResolvedValue({ cliExitCode: 0, errorLogFull: ['filter_units\n'] });
    await expect(plugin(args)).rejects.toThrow('FFmpeg 7.1+');
    expect(mockCLI).toHaveBeenCalledTimes(1);
    expect(args.deps.fsextra.ensureDirSync).not.toHaveBeenCalled();
  });

  it.each([-1, 1, null])('does not report success on FFmpeg exit %s', async (cliExitCode) => {
    runCli.mockResolvedValue({ cliExitCode, errorLogFull: [] });
    await expect(plugin(args)).rejects.toThrow('FFmpeg failed');
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('does not report success after cancellation even with exit code zero', async () => {
    cancelled = true;
    await expect(plugin(args)).rejects.toThrow('cancelled');
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('does not report success on an empty output', async () => {
    jest.mocked(fs.stat).mockResolvedValue({ size: 0, isFile: () => true } as Stats);
    await expect(plugin(args)).rejects.toThrow('non-empty');
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('fully scans input and output using the sibling Tdarr FFprobe before reporting success', async () => {
    args.ffmpegPath = '/opt/tdarr/tdarr-ffmpeg';
    const result = await plugin(args);
    const probes = mockCLI.mock.calls.filter(([config]) => config.spawnArgs.includes('-count_packets'));
    expect(probes).toHaveLength(2);
    probes.forEach(([config]) => expect(config.cli).toBe('/opt/tdarr/tdarr-ffprobe'));
    expect(probes[0][0].spawnArgs).toContain(args.inputFileObj._id);
    expect(probes[1][0].spawnArgs).toContain(result.outputFileObj._id);
    expect(command()).toContain('-xerror');
  });

  it('uses the explicit FFprobe path when FFmpeg has a custom name', async () => {
    args.inputs.ffmpegPath = '/opt/media tool';
    args.inputs.ffprobePath = '/opt/probe tool';
    await plugin(args);
    const probes = mockCLI.mock.calls.filter(([config]) => config.spawnArgs.includes('-count_packets'));
    probes.forEach(([config]) => {
      expect(config.cli).toBe('/opt/probe tool');
      expect(config.spawnOpts).toEqual({});
    });
  });

  it('requires an explicit FFprobe path when it cannot infer one', async () => {
    args.inputs.ffmpegPath = '/opt/media-tool';
    await expect(plugin(args)).rejects.toThrow('Set the FFprobe Path');
    expect(mockCLI).not.toHaveBeenCalled();
  });

  it('rejects read errors even when FFprobe returns valid JSON and exit code zero', async () => {
    probeError = '[matroska] File ended prematurely\n';
    await expect(plugin(args)).rejects.toThrow('full packet scan');
    expect(mockCLI.mock.calls.some(([config]) => config.spawnArgs.includes('-i'))).toBe(false);
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('gives an actionable error when FFprobe cannot run', async () => {
    probeExitCode = -1;
    await expect(plugin(args)).rejects.toThrow('check FFprobe Path');
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('rejects malformed probe data', async () => {
    malformedProbe = true;
    await expect(plugin(args)).rejects.toThrow('FFprobe validation failed');
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ['missing streams', { format: { duration: '10.798' } }, 'no stream data'],
    ['missing track', { streams: [video(), video()] }, 'stream count changed'],
    ['fewer packets despite unchanged header duration', {
      streams: [{ ...video(), side_data_list: [], nb_read_packets: '135' }], format: { duration: '10.798' },
    }, 'packet count changed'],
    ['missing packet count', {
      streams: [{ ...video(), side_data_list: [] }], format: { duration: '10.798' },
    }, 'packet count changed'],
    ['shorter duration despite equal packet counts', {
      streams: [{ ...video(), side_data_list: [], nb_read_packets: '259' }], format: { duration: '5.627' },
    }, 'duration changed'],
    ['missing duration', { streams: [{ ...video(), side_data_list: [], nb_read_packets: '259' }] },
      'cannot confirm'],
    ['remaining Dolby Vision configuration', {
      streams: [{ ...video(), nb_read_packets: '259' }], format: { duration: '10.798' },
    }, 'Dolby Vision signaling remains'],
    ['remaining Dolby Vision sample entry', {
      streams: [{
        ...video(), side_data_list: [], codec_tag_string: 'dvhe', nb_read_packets: '259',
      }],
      format: { duration: '10.798' },
    }, 'Dolby Vision signaling remains'],
    ['lost HDR transfer function', {
      streams: [{
        ...video(), side_data_list: [], color_transfer: 'bt709', nb_read_packets: '259',
      }],
      format: { duration: '10.798' },
    }, 'color_transfer changed'],
  ])('rejects output with %s after a successful remux exit', async (_label, data, error) => {
    outputProbe = data as IffProbeData;
    await expect(plugin(args)).rejects.toThrow(String(error));
    expect(args.logOutcome).not.toHaveBeenCalled();
  });

  it('accepts small container duration rounding differences', async () => {
    outputProbe = {
      streams: [{ ...video(), side_data_list: [], nb_read_packets: '259' }], format: { duration: '10.799' },
    };
    expect((await plugin(args)).outputNumber).toBe(1);
  });

  it('uses fresh scan results to reject stale compatible-profile metadata', async () => {
    inputProbe = { streams: [video(5, 0)], format: { duration: '10.798' } };
    expect((await plugin(args)).outputNumber).toBe(3);
    expect(mockCLI.mock.calls.some(([config]) => config.spawnArgs.includes('-i'))).toBe(false);
    expect(args.logOutcome).not.toHaveBeenCalled();
  });
});
