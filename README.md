<p align="center">
  <img src="https://s7.gifyu.com/images/GifCroppedTran.gif"/>
</p>

# Tdarr_Plugins_Remove_Dovi

This repo adds **Remove Dolby Vision**, a Tdarr Flow plugin that removes Dolby
Vision while retaining the compatible HDR base layer, including **HDR10+ dynamic
metadata**. It runs on an unmodified Tdarr Node using FFmpeg; `dovi_tool` and a
custom node fork are not required.

## Install and use

1. Copy the entire compiled
   [`removeDolbyVision/1.0.0`](FlowPlugins/CommunityFlowPlugins/video/removeDolbyVision/1.0.0)
   directory into your server's plugins directory at
   `FlowPlugins/LocalFlowPlugins/video/removeDolbyVision/1.0.0/`.
   Keep this directory structure so the plugin can load Tdarr's standard helpers.
   Use the compiled JavaScript, not the TypeScript source. Refresh the Flows UI.
2. Add **Remove Dolby Vision** from the local Flow plugins. It runs its own remux;
   place it outside **Begin Command / Execute** blocks. Tdarr 2.11.01+ is required.
3. Use FFmpeg **7.1 or newer** with `dovi_rpu` and `filter_units` bitstream filters.
   The plugin checks these before processing. Leave **FFmpeg Path** empty to use
   the node's configured executable, or enter another executable's absolute path
   on each worker (inside the container when using Docker). No quotes or arguments
   are needed. A stock node can use a newer FFmpeg without modifying node code.
4. Connect **Input File → Remove Dolby Vision**. Output **1** is a new working
   file; connect it to your usual validation steps and **Replace Original File**.
   Output **2** means no Dolby Vision was detected. Output **3** means the file
   could not be safely processed; inspect the job log. Outputs 2 and 3 return the
   unchanged input and do not need a replacement step.

For an initial trial, use **Copy to Directory** on output 1 to inspect the result
before enabling replacement. The plugin itself never overwrites the input.
Allow cache space for one remuxed copy of the input file.

## Supported video

| Codec / Dolby Vision variant | Retained base layer |
| --- | --- |
| HEVC profile 7, MEL or FEL, in a single video track | HDR10, including HDR10+ when present |
| HEVC profile 8 with compatibility ID 1 (8.1) | HDR10, including HDR10+ when present |
| HEVC profile 8 with compatibility ID 4 (8.4) | HLG |
| AV1 profile 10 with compatibility ID 1 | HDR10, including HDR10+ when present |
| AV1 profile 10 with compatibility ID 4 | HLG |

All compatible Dolby Vision video streams in a file are processed, even when the
video is not the first stream. The container extension, other video streams,
audio, subtitles, attachments, chapters, track metadata and dispositions are
carried through using FFmpeg stream copy. No audio or video is re-encoded. If
FFmpeg cannot remux a stream into the original container, the job fails instead
of silently dropping it. FFmpeg may regenerate muxer bookkeeping tags such as
the encoder name and duration; arbitrary container-specific metadata is subject
to FFmpeg's muxer support.

Profile 5, SDR-compatible profiles, unknown profiles, and separate-track
enhancement layers go to output 3. If any Dolby Vision track is unsupported, the
whole file is left unchanged. This is not a universal converter for every Dolby
Vision layout: a confirmed HDR base layer is required. Stripping profile 5 alone
does not turn its proprietary color representation into HDR10. For profile 7 FEL,
the enhancement layer is intentionally discarded; the original HDR10 base is
retained, without rendering the Dolby Vision enhancements into it.

Detection uses FFprobe's Dolby Vision configuration record, with a MediaInfo
fallback matched by stream index. MediaInfo must identify the Dolby Vision
profile and compatible HDR format for that fallback. Filenames and PQ/BT.2020
color tags alone are not treated as proof of a compatible Dolby Vision base.
Rescan files if Tdarr has stale or incomplete metadata.

## How HDR10+ is preserved

For HEVC, the filter chain is:

```text
filter_units=remove_types=62|63,dovi_rpu=strip=1
```

Only Dolby Vision RPU and enhancement-layer NAL units (62 and 63) are removed.
HEVC SEI NAL units **39 and 40 are retained**: these carry HDR10 static metadata
and HDR10+ dynamic metadata. `dovi_rpu` also removes the container's Dolby Vision
configuration record, which filtering NAL units alone would leave behind. MP4
and MOV video sample entries are reset to `hvc1` or `av01` as appropriate.

For AV1, `dovi_rpu=strip=1` removes Dolby's metadata OBUs while retaining the other
metadata. The remux operates directly on the source container, avoiding a raw
video extraction/reinsertion step that would require reconstructing timestamps.

References: [FFmpeg bitstream filters](https://ffmpeg.org/ffmpeg-bitstream-filters.html#dovi_005frpu),
[dovi_tool](https://github.com/quietvoid/dovi_tool), and the
[Tdarr Dolby Vision plugin examples](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi).

## Develop this plugin

The source is
[`FlowPluginsTs/CommunityFlowPlugins/video/removeDolbyVision/1.0.0/index.ts`](FlowPluginsTs/CommunityFlowPlugins/video/removeDolbyVision/1.0.0/index.ts).
Install dependencies with `npm ci`, compile with `npx tsc`, and run its tests with:

```sh
npm run test:flows -- --runInBand removeDolbyVision
```

To also run the actual media preservation tests, set `TDARR_TEST_FFMPEG` and
`TDARR_TEST_FFPROBE` to your executables before running that command. See the
[test fixture provenance and instructions](tests/sampleData/media/dolbyVision/README.md).

The upstream plugin repository's general development instructions follow.

---

# Tdarr_Plugins

Visit the docs for more info:
https://docs.tdarr.io/docs/plugins/basics

### Development

#### 1. Install NodeJS v22 via nvm

nvm (Node Version Manager) lets you install and switch between Node.js versions.

- macOS / Linux: follow the install instructions at https://github.com/nvm-sh/nvm (copy the `curl` command from that page and paste it into your terminal). Then **close and reopen your terminal**.
- Windows: install nvm-windows instead from https://github.com/coreybutler/nvm-windows/releases (download `nvm-setup.exe` and run it).

Then install and use Node 22:

```
nvm install 22
nvm use 22
```

Verify:

```
node -v
npm -v
```

You should see a version starting with `v22.`.

#### 2. Clone this repo

In your terminal, navigate to where you want the code (for example your home folder or `C:/`), then run:

```
git clone https://github.com/HaveAGitGat/Tdarr_Plugins.git
cd Tdarr_Plugins
```

#### 3. Install dependencies

From inside the `Tdarr_Plugins` folder:

`npm install`

#### 4. Common commands

Run ESLint (auto-fix code style issues):

`npm run lint:fix`

Check plugins using some extra custom rules:

`npm run checkPlugins`

Run tests:

`npm run test`

Run flow plugin tests:

`npm run test:flows`

# Steps to write a Tdarr Flow plugin:

1. Clone this repo (see step 2 above if you haven't already).
2. Open a terminal and set the `pluginsDir` env variable to the location where you cloned this repo. Use the command that matches your OS / shell:
   - macOS / Linux: `export pluginsDir=/path/to/Tdarr_Plugins`
   - Windows (PowerShell): `$env:pluginsDir="C:/Tdarr_Plugins"`
   - Windows (Command Prompt): `set pluginsDir=C:/Tdarr_Plugins`

   Then, **in the same terminal** (so it inherits the env variable), start Tdarr Server or Tdarr Node by running its executable. For example:
   - macOS / Linux: `./Tdarr_Server` or `./Tdarr_Node`
   - Windows: `Tdarr_Server.exe` or `Tdarr_Node.exe`

   The env variable only applies to processes started from that same terminal session. If you close the terminal, you will need to set the variable again before starting Tdarr.

3. Browse the typescript plugins here https://github.com/HaveAGitGat/Tdarr_Plugins/tree/master/FlowPluginsTs/CommunityFlowPlugins and edit one locally, or create a new one.
4. Install TypeScript globally with `npm i -g typescript@5.9.3`, then run `tsc` from the repo folder to compile your changes. `tsc` reads the TypeScript sources from `FlowPluginsTs/` and writes the compiled JavaScript into `FlowPlugins/` (the folder Tdarr actually loads). Do not edit files under `FlowPlugins/` directly, they will be overwritten on the next `tsc` run.
5. Refresh the browser and Tdarr will pick up the changes.

Note: `pluginsDir` directories that contain a `.git` folder (such as when cloning this repo) will cause Tdarr to skip plugin updates, to prevent overwriting your development changes.
