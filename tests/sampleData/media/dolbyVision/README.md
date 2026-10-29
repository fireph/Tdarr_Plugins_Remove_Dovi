# Dolby Vision regression fixtures

These are small, synthetic metadata test clips derived from quietvoid's MIT-licensed
test assets, not samples from a user's media library. The license for both source
projects is reproduced in [LICENSE.txt](LICENSE.txt).

Sources, retrieved on 2026-10-28:

- [dovi_tool at 41dae646193c12de152333ff5dbc33579cb9ef4a](https://github.com/quietvoid/dovi_tool/tree/41dae646193c12de152333ff5dbc33579cb9ef4a/assets):
  `hevc_tests/regular.hevc`, `hevc_tests/regular_start_code_4_muxed_el.hevc`,
  `tests/fel_orig.bin`, `tests/mel_orig.bin`, `tests/profile5.bin`, and `tests/profile84.bin`.
- [hdr10plus_tool at 82cb01ba387184476dbf5fa3bddebf0a345693d7](https://github.com/quietvoid/hdr10plus_tool/tree/82cb01ba387184476dbf5fa3bddebf0a345693d7/assets):
  `hevc_tests/regular.hevc`.

Preparation used dovi_tool 2.3.4 and FFmpeg 8.1.3. Runtime requires FFmpeg and
FFprobe; dovi_tool is only used in fixture preparation. Tools are not included in
this directory.

| File | Preparation |
| --- | --- |
| `hevc-hdr10plus.mkv` | Extract RPUs from dovi_tool's `regular.hevc`, inject them into hdr10plus_tool's `regular.hevc`, then remux via MP4 into MKV. Add the profile 8.1 configuration record with `dovi_rpu=compression=none`. |
| `hevc-profile7-fel.mkv` | Replace each RPU in the interleaved EL fixture with `fel_orig.bin` (adding the HEVC NAL header), keep 12 frames, and remux via MP4. Set its Dolby Vision configuration to profile 7 with EL present and compatibility ID 6, then remux to MKV. |
| `hevc-profile7-mel.mkv` | As above, using `mel_orig.bin`. The inherited EL payload is a test payload, not a claim of a visually mastered MEL title. |
| `av1-hdr10plus.mkv` | Encode 8 frames of the combined fixture with libsvtav1 and Dolby Vision enabled. Insert a valid HDR10+ ITU-T T.35 metadata OBU from the HEVC fixture into each temporal unit, then remux with a profile 10 compatibility-ID-1 configuration record. |
| `hevc-profile5.mp4` | Encode 8 synthetic 96×64 frames with unspecified color tags and full range, insert the upstream profile 5 RPU after each picture, and generate a profile 5 / compatibility-ID-0 record. Tests must leave the file unchanged. This is a routing fixture, not visually mastered IPTPQc2 content. |
| `hevc-hlg.mov` | Encode 8 synthetic 96×64 frames with HLG/BT.2020 VUI, insert upstream profile 8.4 RPUs, and mux with a matching configuration record. Use the MP4 muxer with QuickTime branding because FFmpeg's MOV muxer does not write Dolby Vision records. This tests the MOV extension and HLG metadata; it is not an iPhone capture. |
| `hevc-mixed-profiles.mkv` | Combine the first 333 ms of the HEVC HDR10+ fixture with the profile 5 fixture using FFmpeg 8.1.3. Both video tracks retain their Dolby Vision records. Tests must leave the whole file unchanged. |

To recreate the last three fixtures, download `profile5.bin` and `profile84.bin`
from the pinned dovi_tool revision above into a temporary directory, then run:

```sh
python3 tests/sampleData/media/dolbyVision/make-profile-fixtures.py \
  --ffmpeg /path/to/ffmpeg-8 --rpu-dir /path/to/downloaded-rpus --output-dir /path/to/empty-directory
```

The script requires libx265 and does not download anything. Use FFmpeg 8 for
preparation: Jellyfin 7.1.4 drops the profile 5 container record when remuxing the
synthetic clip, which would invalidate the mixed-profile input. The committed
fixtures allow both versions to test against the same profile records and payloads.

The raw HEVC to MP4 preparation synthesizes timestamps. The regression tests check
that the plugin retains those input timestamps; these clips do not certify every
real-world muxing layout or playback device.

Tests compare all retained HEVC picture and SEI bytes, all retained AV1 OBUs, and
the decoded HDR metadata of every frame. They also check removal of Dolby Vision
container records, RPUs and interleaved EL units. MP4 tests cover HEVC and AV1 with
HDR10+. A three-video-track test strips HEVC and AV1 while preserving an ordinary
HDR10+ track. Profile 5 and mixed-profile inputs must route unchanged to output 3.
A separate remux test adds audio, subtitles, an attachment and chapters and checks
their preservation. Truncation regressions cover both a damaged source and a
deliberately shortened but playable output whose FFmpeg process exits zero.

To run the media tests from the repository root, supply FFmpeg/FFprobe paths:

```sh
TDARR_TEST_FFMPEG=/path/to/ffmpeg TDARR_TEST_FFPROBE=/path/to/ffprobe \
  npm run test:flows -- --runInBand removeDolbyVision
```

Verified with Jellyfin FFmpeg/FFprobe **7.1.4-3** (Tdarr's Linux amd64 build as of
2026-10-28) and FFmpeg/FFprobe **8.1.3**. The dedicated GitHub Actions workflow
downloads the pinned Jellyfin package, checks its SHA-256, and runs this suite.
Local tests never download anything.

FFmpeg must include `dovi_rpu`, `filter_units`, the HEVC/AV1 decoders, the `lavfi`
input and the FLAC encoder. The tests skip when the paths are not provided and do
not download anything.
