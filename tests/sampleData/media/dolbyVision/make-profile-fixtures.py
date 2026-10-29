"""Rebuild the synthetic profile 5 and HLG fixtures; see README.md for provenance.

Requires FFmpeg with libx265 and dovi_rpu, plus the pinned upstream profile5.bin
and profile84.bin RPU assets in --rpu-dir. Tests use the committed media files and
do not run this script or download anything.
"""

import argparse
import pathlib
import re
import subprocess
import tempfile


def units(data):
    return [nal for nal in re.split(b"\x00\x00\x00?\x01", data) if nal]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--rpu-dir", type=pathlib.Path, required=True)
    parser.add_argument("--output-dir", type=pathlib.Path, default=pathlib.Path(__file__).parent)
    args = parser.parse_args()

    def ffmpeg(*options):
        subprocess.run([args.ffmpeg, "-v", "error", "-nostdin", "-n", *map(str, options)], check=True)

    with tempfile.TemporaryDirectory(prefix="tdarr-dovi-fixtures-") as directory:
        work = pathlib.Path(directory)
        for name, rpu_name, transfer, full_range, extension in [
            ("hevc-profile5", "profile5.bin", "2", "full", "mp4"),
            ("hevc-hlg", "profile84.bin", "arib-std-b67", "limited", "mov"),
        ]:
            raw = work / f"{name}.hevc"
            colors = "colorprim=2:transfer=2:colormatrix=2" if transfer == "2" else "colorprim=9:transfer=18:colormatrix=9"
            # These are metadata/routing fixtures, not visually mastered Dolby Vision content.
            ffmpeg("-f", "lavfi", "-i", "testsrc2=size=96x64:rate=24", "-frames:v", "8",
                   "-pix_fmt", "yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast",
                   "-x265-params", f"bframes=0:keyint=8:pools=1:frame-threads=1:log-level=error:range={full_range}:{colors}",
                   "-color_primaries", "2" if transfer == "2" else "bt2020", "-color_trc", transfer,
                   "-colorspace", "2" if transfer == "2" else "bt2020nc", raw)
            rpu = b"\x7c\x01" + units((args.rpu_dir / rpu_name).read_bytes())[0]
            injected = bytearray()
            for nal in units(raw.read_bytes()):
                injected += b"\0\0\0\1" + nal
                if ((nal[0] >> 1) & 63) < 32:
                    injected += b"\0\0\0\1" + rpu
            raw.write_bytes(injected)
            ffmpeg("-r", "24", "-i", raw, "-c", "copy", "-tag:v", "hvc1",
                   "-bsf:v", "dovi_rpu=compression=none", "-strict", "unofficial",
                   # FFmpeg's native MOV muxer does not write Dolby Vision records. Use the
                   # ISO BMFF muxer with a QuickTime brand to include the profile 8.4 record.
                   *(["-f", "mp4", "-brand", "qt  "] if extension == "mov" else []),
                   args.output_dir / f"{name}.{extension}")

    # Prepare with FFmpeg 8: Jellyfin 7.1.4 drops the P5 container record during remux.
    ffmpeg("-i", pathlib.Path(__file__).parent / "hevc-hdr10plus.mkv",
           "-i", args.output_dir / "hevc-profile5.mp4", "-map", "0:v", "-map", "1:v",
           "-t", "0.333", "-c", "copy", "-strict", "unofficial", args.output_dir / "hevc-mixed-profiles.mkv")


if __name__ == "__main__":
    main()
