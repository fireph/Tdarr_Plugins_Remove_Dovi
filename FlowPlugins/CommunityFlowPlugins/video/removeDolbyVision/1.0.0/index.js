"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var path_1 = __importDefault(require("path"));
var fs_1 = require("fs");
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");
var details = function () { return ({
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
}); };
exports.details = details;
var asNumber = function (value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    var result = Number(value);
    return Number.isFinite(result) ? result : undefined;
};
var isMetadata = function (value) { return typeof value === 'object' && value !== null; };
// Match by stream index, not video ordinal: audio, cover art and extra video tracks can precede a video.
var inspectVideo = function (stream, outputIndex, tracks) {
    var _a;
    var sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
    var config = sideData.filter(isMetadata).find(function (data) { return /dovi configuration record/i.test(String(data.side_data_type)); });
    var streamIndex = asNumber(stream.index);
    var track = streamIndex === undefined ? undefined : tracks.find(function (item) { return item['@type'] === 'Video'
        && asNumber(item.StreamOrder) === streamIndex; });
    var hdrFormat = ['HDR_Format', 'HDR_Format_String', 'HDR_Format_Commercial', 'HDR_Format_Compatibility']
        .map(function (key) { var _a; return String((_a = track === null || track === void 0 ? void 0 : track[key]) !== null && _a !== void 0 ? _a : ''); }).join(' ');
    var profileText = "".concat(String((_a = track === null || track === void 0 ? void 0 : track.HDR_Format_Profile) !== null && _a !== void 0 ? _a : ''), " ").concat(hdrFormat);
    var profileMatch = profileText.match(/(?:dvhe|dvh1|dav1)\.(\d+)\./i)
        || profileText.match(/(?:^|\s|\/)Main (\d+)(?:\.|\b)/i)
        || profileText.match(/\bProfile (\d+)(?:\.|\b)/i);
    var profile = config ? asNumber(config.dv_profile) : asNumber(profileMatch === null || profileMatch === void 0 ? void 0 : profileMatch[1]);
    var compatibility = asNumber(config === null || config === void 0 ? void 0 : config.dv_bl_signal_compatibility_id);
    var hasDovi = !!config || /Dolby Vision/i.test(hdrFormat)
        || /^(dvhe|dvh1|dvav|dva1|dav1|dvh11)$/i.test(String(stream.codec_tag_string));
    var hdr = '';
    var reason = '';
    if (hasDovi) {
        if (!['hevc', 'av1'].includes(stream.codec_name)) {
            reason = "unsupported Dolby Vision codec ".concat(stream.codec_name);
        }
        else if (config && asNumber(config.bl_present_flag) !== 1) {
            reason = 'no confirmed base layer in this stream (separate enhancement-layer tracks are unsupported)';
        }
        else if (stream.codec_name === 'hevc' && profile === 7
            && ((config && (compatibility === undefined || [0, 1, 6].includes(compatibility)))
                || (!config && /\bHDR10\b|Blu-ray compatible/i.test(hdrFormat)))) {
            // Profile 7 MEL and FEL both have an HDR10 base layer, even with compatibility ID 0.
            hdr = 'HDR10';
        }
        else if ((stream.codec_name === 'hevc' && profile === 8)
            || (stream.codec_name === 'av1' && profile === 10)) {
            if (compatibility === 1)
                hdr = 'HDR10';
            if (compatibility === 4)
                hdr = 'HLG';
            // MediaInfo is a fallback only. Never override an explicit incompatible configuration record.
            if (!config && /\bHDR10\+?(?:\s+compatible)?\b/i.test(hdrFormat))
                hdr = 'HDR10';
            if (!config && /\bHLG(?:\s+compatible)?\b/i.test(hdrFormat))
                hdr = 'HLG';
        }
        if (!hdr && !reason) {
            reason = "HDR compatibility is not confirmed (profile ".concat(profile !== null && profile !== void 0 ? profile : 'unknown', ",")
                + " compatibility ID ".concat(compatibility !== null && compatibility !== void 0 ? compatibility : 'unknown', "); Dolby Vision-only/SDR bases cannot be stripped to HDR");
        }
    }
    return {
        stream: stream,
        outputIndex: outputIndex,
        hasDovi: hasDovi,
        hdr: hdr,
        reason: reason,
    };
};
// Stream copy should retain every packet in each mapped track. Counting packets reads the whole
// file without decoding it, and catches shortened output even when its header claims the original duration.
var validateOutput = function (input, output) {
    var _a, _b, _c, _d;
    var before = (_a = input.streams) !== null && _a !== void 0 ? _a : [];
    var after = (_b = output.streams) !== null && _b !== void 0 ? _b : [];
    if (before.length !== after.length)
        throw new Error('Output validation failed: stream count changed.');
    before.forEach(function (stream, index) {
        var _a, _b;
        var result = after[index];
        var fail = function (reason) {
            throw new Error("Output validation failed for stream ".concat(index, ": ").concat(reason, "."));
        };
        ['codec_type', 'codec_name', 'width', 'height', 'pix_fmt', 'color_transfer', 'color_primaries', 'color_space']
            .forEach(function (key) {
            if (stream[key] !== undefined && stream[key] !== result[key])
                fail("".concat(key, " changed"));
        });
        if (['video', 'audio', 'subtitle'].includes(stream.codec_type)) {
            // FFprobe reports N/A for an empty track, such as a subtitle track without cues.
            var originalCount = (_a = asNumber(stream.nb_read_packets)) !== null && _a !== void 0 ? _a : 0;
            var resultCount = (_b = asNumber(result.nb_read_packets)) !== null && _b !== void 0 ? _b : 0;
            if (stream.codec_type === 'video' && originalCount === 0)
                fail('no input video packets');
            if (originalCount !== resultCount)
                fail("packet count changed (".concat(originalCount, " to ").concat(resultCount, ")"));
        }
        if (result.codec_type === 'video' && inspectVideo(result, index, []).hasDovi) {
            fail('Dolby Vision signaling remains');
        }
    });
    var beforeDuration = asNumber((_c = input.format) === null || _c === void 0 ? void 0 : _c.duration);
    var afterDuration = asNumber((_d = output.format) === null || _d === void 0 ? void 0 : _d.duration);
    if (!beforeDuration || !afterDuration || beforeDuration < 0 || afterDuration < 0) {
        throw new Error('Output validation failed: cannot confirm input/output duration.');
    }
    // Allow small container rounding differences, never a percentage of a potentially very long movie.
    if (Math.abs(beforeDuration - afterDuration) > 0.25) {
        throw new Error("Output validation failed: duration changed (".concat(beforeDuration, "s to ").concat(afterDuration, "s)."));
    }
};
var plugin = function (args) { return __awaiter(void 0, void 0, void 0, function () {
    var lib, inputs, unchanged, streams, mediaTracks, inspectStreams, videos, unsupported, ffmpegPath, ffprobePath, run, probe, capabilities, filters, needed, source, filename, outputFilePath, cliArgs, output, _a, _b;
    var _c, _d, _e, _f, _g, _h, _j;
    return __generator(this, function (_k) {
        switch (_k.label) {
            case 0:
                lib = require('../../../../../methods/lib')();
                inputs = lib.loadDefaultValues(args.inputs, details);
                unchanged = function (outputNumber) { return ({
                    outputFileObj: args.inputFileObj,
                    outputNumber: outputNumber,
                    variables: args.variables,
                }); };
                streams = (_c = args.inputFileObj.ffProbeData) === null || _c === void 0 ? void 0 : _c.streams;
                if (!Array.isArray(streams) || streams.length === 0) {
                    throw new Error('Remove Dolby Vision requires FFprobe stream data. Rescan the file first.');
                }
                mediaTracks = (_e = (_d = args.inputFileObj.mediaInfo) === null || _d === void 0 ? void 0 : _d.track) !== null && _e !== void 0 ? _e : [];
                inspectStreams = function (items) { return items.map(function (stream, outputIndex) { return inspectVideo(stream, outputIndex, mediaTracks.filter(isMetadata)); }).filter(function (video) { return video.stream.codec_type === 'video' && video.hasDovi; }); };
                videos = inspectStreams(streams);
                if (videos.length === 0) {
                    args.jobLog('No Dolby Vision detected. Leaving the file unchanged.');
                    return [2 /*return*/, unchanged(2)];
                }
                unsupported = videos.filter(function (video) { return !video.hdr; });
                if (unsupported.length > 0) {
                    unsupported.forEach(function (video) { return args.jobLog("Stream ".concat(video.stream.index, ": ").concat(video.reason)); });
                    args.jobLog('Leaving the whole file unchanged; routing to output 3.');
                    return [2 /*return*/, unchanged(3)];
                }
                if ((_f = args.variables.ffmpegCommand) === null || _f === void 0 ? void 0 : _f.init) {
                    throw new Error('Place Remove Dolby Vision outside Begin Command / Execute blocks.');
                }
                ffmpegPath = String((_g = inputs.ffmpegPath) !== null && _g !== void 0 ? _g : '').trim() || args.ffmpegPath;
                if (!ffmpegPath)
                    throw new Error('No FFmpeg executable configured.');
                ffprobePath = String((_h = inputs.ffprobePath) !== null && _h !== void 0 ? _h : '').trim()
                    || path_1.default.join(path_1.default.dirname(ffmpegPath), path_1.default.basename(ffmpegPath).replace(/ffmpeg/i, 'ffprobe'));
                if (ffprobePath === ffmpegPath) {
                    throw new Error('Cannot infer FFprobe executable from FFmpeg Path. Set the FFprobe Path input.');
                }
                run = function (spawnArgs_1) {
                    var args_1 = [];
                    for (var _i = 1; _i < arguments.length; _i++) {
                        args_1[_i - 1] = arguments[_i];
                    }
                    return __awaiter(void 0, __spreadArray([spawnArgs_1], args_1, true), void 0, function (spawnArgs, outputFilePath, executable) {
                        var cli, result, tool;
                        if (outputFilePath === void 0) { outputFilePath = ''; }
                        if (executable === void 0) { executable = ffmpegPath; }
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    cli = new cliUtils_1.CLI({
                                        cli: executable,
                                        spawnArgs: spawnArgs,
                                        spawnOpts: {},
                                        jobLog: args.jobLog,
                                        outputFilePath: outputFilePath,
                                        inputFileObj: args.inputFileObj,
                                        logFullCliOutput: args.logFullCliOutput,
                                        updateWorker: args.updateWorker,
                                        args: args,
                                    });
                                    return [4 /*yield*/, cli.runCli()];
                                case 1:
                                    result = _a.sent();
                                    if (cli.cancelled || result.cliExitCode !== 0) {
                                        tool = executable === ffmpegPath ? 'FFmpeg' : 'FFprobe (check FFprobe Path)';
                                        throw new Error("Remove Dolby Vision: ".concat(tool, " failed or was cancelled (exit ").concat(result.cliExitCode, ").")
                                            + ' See the job log. The source file has not been replaced.');
                                    }
                                    return [2 /*return*/, result];
                            }
                        });
                    });
                };
                probe = function (file) { return __awaiter(void 0, void 0, void 0, function () {
                    var result, data;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, run([
                                    '-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', file,
                                ], '', ffprobePath)];
                            case 1:
                                result = _a.sent();
                                try {
                                    // CLI collects both stdout and stderr. At log level error, anything outside the JSON is
                                    // a read/parse error (even with exit 0), and must fail validation rather than be discarded.
                                    data = JSON.parse(result.errorLogFull.join(''));
                                }
                                catch (_) {
                                    throw new Error('FFprobe validation failed: unreadable media or errors during the full packet scan.'
                                        + ' See the job log.');
                                }
                                if (!data || !Array.isArray(data.streams) || data.streams.length === 0) {
                                    throw new Error('FFprobe validation failed: no stream data returned.');
                                }
                                return [2 /*return*/, data];
                        }
                    });
                }); };
                return [4 /*yield*/, run(['-hide_banner', '-bsfs'])];
            case 1:
                capabilities = _k.sent();
                filters = capabilities.errorLogFull.join('').split(/\s+/);
                needed = ['dovi_rpu'];
                if (videos.some(function (video) { return video.stream.codec_name === 'hevc'; }))
                    needed.push('filter_units');
                if (needed.some(function (filter) { return !filters.includes(filter); })) {
                    throw new Error("FFmpeg needs these bitstream filters: ".concat(needed.join(', '), ".")
                        + ' Configure FFmpeg 7.1+ using this plugin\'s FFmpeg Path input or the node settings.');
                }
                args.jobLog('Scanning every input packet before removing Dolby Vision.');
                return [4 /*yield*/, probe(args.inputFileObj._id)];
            case 2:
                source = _k.sent();
                streams = (_j = source.streams) !== null && _j !== void 0 ? _j : [];
                videos = inspectStreams(streams);
                if (videos.length === 0 || videos.some(function (video) { return !video.hdr; })) {
                    args.jobLog('Fresh FFprobe data does not confirm the expected compatible Dolby Vision tracks.'
                        + ' Rescan the file; leaving it unchanged and routing to output 3.');
                    return [2 /*return*/, unchanged(3)];
                }
                filename = path_1.default.basename(args.inputFileObj._id.replace(/\\/g, '/'));
                if (!path_1.default.extname(filename))
                    throw new Error('The input needs a container file extension.');
                outputFilePath = path_1.default.join((0, fileUtils_1.getPluginWorkDir)(args), filename);
                if (path_1.default.resolve(outputFilePath) === path_1.default.resolve(args.inputFileObj._id)) {
                    throw new Error('The output path must differ from the input path.');
                }
                cliArgs = [
                    '-hide_banner', '-nostdin', '-n', '-xerror', '-i', args.inputFileObj._id,
                    '-map', '0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy',
                ];
                videos.forEach(function (video) {
                    // Do not remove SEI NAL types 39/40: they carry HDR10 static metadata and HDR10+ dynamic metadata.
                    // filter_units also removes RPUs that are not the final NAL in an access unit (older dovi_rpu builds).
                    var filter = video.stream.codec_name === 'hevc'
                        ? 'filter_units=remove_types=62|63,dovi_rpu=strip=1'
                        : 'dovi_rpu=strip=1';
                    cliArgs.push("-bsf:".concat(video.outputIndex), filter);
                    if (['.mp4', '.mov', '.m4v'].includes(path_1.default.extname(filename).toLowerCase())) {
                        cliArgs.push("-tag:".concat(video.outputIndex), video.stream.codec_name === 'hevc' ? 'hvc1' : 'av01');
                    }
                    args.jobLog("Stream ".concat(video.stream.index, ": removing Dolby Vision; preserving ").concat(video.hdr)
                        + ' and any HDR10+ metadata without re-encoding.');
                });
                // Explicit dispositions avoid FFmpeg assigning a default track when the input has none.
                streams.forEach(function (stream, index) {
                    if (isMetadata(stream.disposition)) {
                        var flags = Object.entries(stream.disposition)
                            .filter(function (_a) {
                            var value = _a[1];
                            return asNumber(value) === 1;
                        }).map(function (_a) {
                            var flag = _a[0];
                            return flag;
                        });
                        cliArgs.push("-disposition:".concat(index), flags.join('+') || '0');
                    }
                });
                cliArgs.push(outputFilePath);
                args.updateWorker({ CLIType: ffmpegPath, preset: cliArgs.join(' ') });
                return [4 /*yield*/, run(cliArgs, outputFilePath)];
            case 3:
                _k.sent();
                return [4 /*yield*/, fs_1.promises.stat(outputFilePath)];
            case 4:
                output = _k.sent();
                if (!output.isFile() || output.size === 0) {
                    throw new Error('FFmpeg did not produce a non-empty output file.');
                }
                args.jobLog('Scanning every output packet and checking stream, HDR color, packet count and duration preservation.');
                _a = validateOutput;
                _b = [source];
                return [4 /*yield*/, probe(outputFilePath)];
            case 5:
                _a.apply(void 0, _b.concat([_k.sent()]));
                args.logOutcome('tSuc');
                return [2 /*return*/, {
                        outputFileObj: { _id: outputFilePath },
                        outputNumber: 1,
                        variables: args.variables,
                    }];
        }
    });
}); };
exports.plugin = plugin;
