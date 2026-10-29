# Dolby Vision regression fixtures

These are small, synthetic metadata test clips derived from quietvoid's MIT-licensed
test assets, not samples from a user's media library. The license for both source
projects is reproduced in [LICENSE.txt](LICENSE.txt).

Sources, retrieved on 2026-10-28:

- [dovi_tool at 41dae646193c12de152333ff5dbc33579cb9ef4a](https://github.com/quietvoid/dovi_tool/tree/41dae646193c12de152333ff5dbc33579cb9ef4a/assets):
  `hevc_tests/regular.hevc`, `hevc_tests/regular_start_code_4_muxed_el.hevc`,
  `tests/fel_orig.bin`, and `tests/mel_orig.bin`.
- [hdr10plus_tool at 82cb01ba387184476dbf5fa3bddebf0a345693d7](https://github.com/quietvoid/hdr10plus_tool/tree/82cb01ba387184476dbf5fa3bddebf0a345693d7/assets):
  `hevc_tests/regular.hevc`.

Preparation used dovi_tool 2.3.4 and FFmpeg 8.1.3. The tools are not required at
plugin runtime (except FFmpeg), and are not included in this directory.

| File | Preparation |
| --- | --- |
| `hevc-hdr10plus.mkv` | Extract RPUs from dovi_tool's `regular.hevc`, inject them into hdr10plus_tool's `regular.hevc`, then remux via MP4 into MKV. Add the profile 8.1 configuration record with `dovi_rpu=compression=none`. |
| `hevc-profile7-fel.mkv` | Replace each RPU in the interleaved EL fixture with `fel_orig.bin` (adding the HEVC NAL header), keep 12 frames, and remux via MP4. Set its Dolby Vision configuration to profile 7 with EL present and compatibility ID 6, then remux to MKV. |
| `hevc-profile7-mel.mkv` | As above, using `mel_orig.bin`. The inherited EL payload is a test payload, not a claim of a visually mastered MEL title. |
| `av1-hdr10plus.mkv` | Encode 8 frames of the combined fixture with libsvtav1 and Dolby Vision enabled. Insert a valid HDR10+ ITU-T T.35 metadata OBU from the HEVC fixture into each temporal unit, then remux with a profile 10 compatibility-ID-1 configuration record. |

The raw HEVC to MP4 preparation synthesizes timestamps. The regression tests check
that the plugin retains those input timestamps; these clips do not certify every
real-world muxing layout or playback device.

Tests compare all retained HEVC picture and SEI bytes, all retained AV1 OBUs, and
the decoded HDR metadata of every frame. They also check removal of Dolby Vision
container records, RPUs and interleaved EL units. A separate remux test adds audio,
subtitles, an attachment and chapters and checks their preservation.

To run the media tests from the repository root, supply FFmpeg/FFprobe paths:

```sh
TDARR_TEST_FFMPEG=/path/to/ffmpeg TDARR_TEST_FFPROBE=/path/to/ffprobe \
  npm run test:flows -- --runInBand removeDolbyVision
```

FFmpeg must include `dovi_rpu`, `filter_units`, the HEVC/AV1 decoders, the `lavfi`
input and the FLAC encoder. The tests skip when the paths are not provided and do
not download anything.
