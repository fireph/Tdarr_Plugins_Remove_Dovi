import path from 'path';
import { promises as fs } from 'fs';
import { CLI } from '../../../../FlowHelpers/1.0.0/cliUtils';
import { getPluginWorkDir } from '../../../../FlowHelpers/1.0.0/fileUtils';
import {
  IpluginDetails,
  IpluginInputArgs,
  IpluginOutputArgs,
} from '../../../../FlowHelpers/1.0.0/interfaces/interfaces';
import { IffProbeData, Istreams } from '../../../../FlowHelpers/1.0.0/interfaces/synced/IFileObject';

const details = (): IpluginDetails => ({
  name: 'Remove Dolby Vision',
  description: 'Remove Dolby Vision from HDR-compatible HEVC/AV1 video without re-encoding.'
    + ' Preserves HDR10, HDR10+ and HLG. Requires FFmpeg with the dovi_rpu bitstream filter (7.1+).'
    + ' Writes a working copy; connect output 1 to Replace Original File when ready.',
  style: { borderColor: 'green' },
  tags: 'video,hdr,dolby vision,hdr10+',
  isStartPlugin: false,
  pType: '',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: 'faVideo',
  inputs: [
    {
      label: 'FFmpeg Path',
      name: 'ffmpegPath',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Leave blank to use the node FFmpeg. Otherwise specify an executable path on the node'
        + ' (inside the container for Docker). No shell quoting or arguments.',
    },
    {
      label: 'FFprobe Path',
      name: 'ffprobePath',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: 'Leave blank to use ffprobe beside FFmpeg (including tdarr-ffprobe).'
        + ' Set an explicit executable path if installed elsewhere. Used to fully scan input and output packets.',
    },
  ],
  outputs: [
    { number: 1, tooltip: 'Dolby Vision removed; output is a new working file' },
    { number: 2, tooltip: 'No Dolby Vision detected; original working file unchanged' },
    { number: 3, tooltip: 'Unsupported or unconfirmed HDR base layer; unchanged (see job log)' },
  ],
});

type Metadata = Record<string, unknown>;
interface VideoInfo {
  stream: Istreams,
  outputIndex: number,
  hasDovi: boolean,
  hdr: string,
  reason: string,
}

const asNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
};

const isMetadata = (value: unknown): value is Metadata => typeof value === 'object' && value !== null;

// Match by stream index, not video ordinal: audio, cover art and extra video tracks can precede a video.
const inspectVideo = (stream: Istreams, outputIndex: number, tracks: Metadata[]): VideoInfo => {
  const sideData: unknown[] = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  const config = sideData.filter(isMetadata).find((data) => /dovi configuration record/i.test(
    String(data.side_data_type),
  ));
  const streamIndex = asNumber(stream.index);
  const track = streamIndex === undefined ? undefined : tracks.find((item) => item['@type'] === 'Video'
    && asNumber(item.StreamOrder) === streamIndex);
  const hdrFormat = ['HDR_Format', 'HDR_Format_String', 'HDR_Format_Commercial', 'HDR_Format_Compatibility']
    .map((key) => String(track?.[key] ?? '')).join(' ');
  const profileText = `${String(track?.HDR_Format_Profile ?? '')} ${hdrFormat}`;
  const profileMatch = profileText.match(/(?:dvhe|dvh1|dav1)\.(\d+)\./i)
    || profileText.match(/(?:^|\s|\/)Main (\d+)(?:\.|\b)/i)
    || profileText.match(/\bProfile (\d+)(?:\.|\b)/i);
  const profile = config ? asNumber(config.dv_profile) : asNumber(profileMatch?.[1]);
  const compatibility = asNumber(config?.dv_bl_signal_compatibility_id);
  const hasDovi = !!config || /Dolby Vision/i.test(hdrFormat)
    || /^(dvhe|dvh1|dvav|dva1|dav1|dvh11)$/i.test(String(stream.codec_tag_string));
  let hdr = '';
  let reason = '';

  if (hasDovi) {
    if (!['hevc', 'av1'].includes(stream.codec_name)) {
      reason = `unsupported Dolby Vision codec ${stream.codec_name}`;
    } else if (config && asNumber(config.bl_present_flag) !== 1) {
      reason = 'no confirmed base layer in this stream (separate enhancement-layer tracks are unsupported)';
    } else if (stream.codec_name === 'hevc' && profile === 7
      && ((config && (compatibility === undefined || [0, 1, 6].includes(compatibility)))
        || (!config && /\bHDR10\b|Blu-ray compatible/i.test(hdrFormat)))) {
      // Profile 7 MEL and FEL both have an HDR10 base layer, even with compatibility ID 0.
      hdr = 'HDR10';
    } else if ((stream.codec_name === 'hevc' && profile === 8)
      || (stream.codec_name === 'av1' && profile === 10)) {
      if (compatibility === 1) hdr = 'HDR10';
      if (compatibility === 4) hdr = 'HLG';
      // MediaInfo is a fallback only. Never override an explicit incompatible configuration record.
      if (!config && /\bHDR10\+?(?:\s+compatible)?\b/i.test(hdrFormat)) hdr = 'HDR10';
      if (!config && /\bHLG(?:\s+compatible)?\b/i.test(hdrFormat)) hdr = 'HLG';
    }
    if (!hdr && !reason) {
      reason = `HDR compatibility is not confirmed (profile ${profile ?? 'unknown'},`
        + ` compatibility ID ${compatibility ?? 'unknown'}); Dolby Vision-only/SDR bases cannot be stripped to HDR`;
    }
  }

  return {
    stream, outputIndex, hasDovi, hdr, reason,
  };
};

// Stream copy should retain every packet in each mapped track. Counting packets reads the whole
// file without decoding it, and catches shortened output even when its header claims the original duration.
const validateOutput = (input: IffProbeData, output: IffProbeData): void => {
  const before = input.streams ?? [];
  const after = output.streams ?? [];
  if (before.length !== after.length) throw new Error('Output validation failed: stream count changed.');
  before.forEach((stream, index) => {
    const result = after[index];
    const fail = (reason: string) => {
      throw new Error(`Output validation failed for stream ${index}: ${reason}.`);
    };
    ['codec_type', 'codec_name', 'width', 'height', 'pix_fmt', 'color_transfer', 'color_primaries', 'color_space']
      .forEach((key) => {
        if (stream[key] !== undefined && stream[key] !== result[key]) fail(`${key} changed`);
      });
    if (['video', 'audio', 'subtitle'].includes(stream.codec_type)) {
      // FFprobe reports N/A for an empty track, such as a subtitle track without cues.
      const originalCount = asNumber(stream.nb_read_packets) ?? 0;
      const resultCount = asNumber(result.nb_read_packets) ?? 0;
      if (stream.codec_type === 'video' && originalCount === 0) fail('no input video packets');
      if (originalCount !== resultCount) fail(`packet count changed (${originalCount} to ${resultCount})`);
    }
    if (result.codec_type === 'video' && inspectVideo(result, index, []).hasDovi) {
      fail('Dolby Vision signaling remains');
    }
  });
  const beforeDuration = asNumber(input.format?.duration);
  const afterDuration = asNumber(output.format?.duration);
  if (!beforeDuration || !afterDuration || beforeDuration < 0 || afterDuration < 0) {
    throw new Error('Output validation failed: cannot confirm input/output duration.');
  }
  // Allow small container rounding differences, never a percentage of a potentially very long movie.
  if (Math.abs(beforeDuration - afterDuration) > 0.25) {
    throw new Error(`Output validation failed: duration changed (${beforeDuration}s to ${afterDuration}s).`);
  }
};

const plugin = async (args: IpluginInputArgs): Promise<IpluginOutputArgs> => {
  const lib = require('../../../../../methods/lib')();
  const inputs = lib.loadDefaultValues(args.inputs, details);
  const unchanged = (outputNumber: number): IpluginOutputArgs => ({
    outputFileObj: args.inputFileObj,
    outputNumber,
    variables: args.variables,
  });
  let streams = args.inputFileObj.ffProbeData?.streams;
  if (!Array.isArray(streams) || streams.length === 0) {
    throw new Error('Remove Dolby Vision requires FFprobe stream data. Rescan the file first.');
  }
  const mediaTracks: unknown[] = args.inputFileObj.mediaInfo?.track ?? [];
  const inspectStreams = (items: Istreams[]) => items.map((stream, outputIndex) => inspectVideo(
    stream, outputIndex, mediaTracks.filter(isMetadata),
  )).filter((video) => video.stream.codec_type === 'video' && video.hasDovi);
  let videos = inspectStreams(streams);

  if (videos.length === 0) {
    args.jobLog('No Dolby Vision detected. Leaving the file unchanged.');
    return unchanged(2);
  }
  const unsupported = videos.filter((video) => !video.hdr);
  if (unsupported.length > 0) {
    unsupported.forEach((video) => args.jobLog(`Stream ${video.stream.index}: ${video.reason}`));
    args.jobLog('Leaving the whole file unchanged; routing to output 3.');
    return unchanged(3);
  }
  if (args.variables.ffmpegCommand?.init) {
    throw new Error('Place Remove Dolby Vision outside Begin Command / Execute blocks.');
  }

  const ffmpegPath = String(inputs.ffmpegPath ?? '').trim() || args.ffmpegPath;
  if (!ffmpegPath) throw new Error('No FFmpeg executable configured.');
  const ffprobePath = String(inputs.ffprobePath ?? '').trim()
    || path.join(path.dirname(ffmpegPath), path.basename(ffmpegPath).replace(/ffmpeg/i, 'ffprobe'));
  if (ffprobePath === ffmpegPath) {
    throw new Error('Cannot infer FFprobe executable from FFmpeg Path. Set the FFprobe Path input.');
  }
  const run = async (spawnArgs: string[], outputFilePath = '', executable = ffmpegPath) => {
    const cli = new CLI({
      cli: executable,
      spawnArgs,
      spawnOpts: {},
      jobLog: args.jobLog,
      outputFilePath,
      inputFileObj: args.inputFileObj,
      logFullCliOutput: args.logFullCliOutput,
      updateWorker: args.updateWorker,
      args,
    });
    const result = await cli.runCli();
    if (cli.cancelled || result.cliExitCode !== 0) {
      const tool = executable === ffmpegPath ? 'FFmpeg' : 'FFprobe (check FFprobe Path)';
      throw new Error(`Remove Dolby Vision: ${tool} failed or was cancelled (exit ${result.cliExitCode}).`
        + ' See the job log. The source file has not been replaced.');
    }
    return result;
  };
  const probe = async (file: string): Promise<IffProbeData> => {
    const result = await run([
      '-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', file,
    ], '', ffprobePath);
    let data: IffProbeData;
    try {
      // CLI collects both stdout and stderr. At log level error, anything outside the JSON is
      // a read/parse error (even with exit 0), and must fail validation rather than be discarded.
      data = JSON.parse(result.errorLogFull.join(''));
    } catch (_) {
      throw new Error('FFprobe validation failed: unreadable media or errors during the full packet scan.'
        + ' See the job log.');
    }
    if (!data || !Array.isArray(data.streams) || data.streams.length === 0) {
      throw new Error('FFprobe validation failed: no stream data returned.');
    }
    return data;
  };

  // Check actual capabilities, since vendors ship different FFmpeg builds under the same version.
  const capabilities = await run(['-hide_banner', '-bsfs']);
  const filters = capabilities.errorLogFull.join('').split(/\s+/);
  const needed = ['dovi_rpu'];
  if (videos.some((video) => video.stream.codec_name === 'hevc')) needed.push('filter_units');
  if (needed.some((filter) => !filters.includes(filter))) {
    throw new Error(`FFmpeg needs these bitstream filters: ${needed.join(', ')}.`
      + ' Configure FFmpeg 7.1+ using this plugin\'s FFmpeg Path input or the node settings.');
  }

  args.jobLog('Scanning every input packet before removing Dolby Vision.');
  const source = await probe(args.inputFileObj._id);
  streams = source.streams ?? [];
  videos = inspectStreams(streams);
  if (videos.length === 0 || videos.some((video) => !video.hdr)) {
    args.jobLog('Fresh FFprobe data does not confirm the expected compatible Dolby Vision tracks.'
      + ' Rescan the file; leaving it unchanged and routing to output 3.');
    return unchanged(3);
  }

  const filename = path.basename(args.inputFileObj._id.replace(/\\/g, '/'));
  if (!path.extname(filename)) throw new Error('The input needs a container file extension.');
  const outputFilePath = path.join(getPluginWorkDir(args), filename);
  if (path.resolve(outputFilePath) === path.resolve(args.inputFileObj._id)) {
    throw new Error('The output path must differ from the input path.');
  }
  const cliArgs = [
    '-hide_banner', '-nostdin', '-n', '-xerror', '-i', args.inputFileObj._id,
    '-map', '0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy',
  ];
  videos.forEach((video) => {
    // Do not remove SEI NAL types 39/40: they carry HDR10 static metadata and HDR10+ dynamic metadata.
    // filter_units also removes RPUs that are not the final NAL in an access unit (older dovi_rpu builds).
    const filter = video.stream.codec_name === 'hevc'
      ? 'filter_units=remove_types=62|63,dovi_rpu=strip=1'
      : 'dovi_rpu=strip=1';
    cliArgs.push(`-bsf:${video.outputIndex}`, filter);
    if (['.mp4', '.mov', '.m4v'].includes(path.extname(filename).toLowerCase())) {
      cliArgs.push(`-tag:${video.outputIndex}`, video.stream.codec_name === 'hevc' ? 'hvc1' : 'av01');
    }
    args.jobLog(`Stream ${video.stream.index}: removing Dolby Vision; preserving ${video.hdr}`
      + ' and any HDR10+ metadata without re-encoding.');
  });
  // Explicit dispositions avoid FFmpeg assigning a default track when the input has none.
  streams.forEach((stream, index) => {
    if (isMetadata(stream.disposition)) {
      const flags = Object.entries(stream.disposition)
        .filter(([, value]) => asNumber(value) === 1).map(([flag]) => flag);
      cliArgs.push(`-disposition:${index}`, flags.join('+') || '0');
    }
  });
  cliArgs.push(outputFilePath);
  args.updateWorker({ CLIType: ffmpegPath, preset: cliArgs.join(' ') });
  await run(cliArgs, outputFilePath);
  const output = await fs.stat(outputFilePath);
  if (!output.isFile() || output.size === 0) {
    throw new Error('FFmpeg did not produce a non-empty output file.');
  }
  args.jobLog('Scanning every output packet and checking stream, HDR color, packet count and duration preservation.');
  validateOutput(source, await probe(outputFilePath));
  args.logOutcome('tSuc');
  return {
    outputFileObj: { _id: outputFilePath },
    outputNumber: 1,
    variables: args.variables,
  };
};

export { details, plugin };
