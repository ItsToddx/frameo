#!/bin/sh
set -eu
REELBEAM_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
REELBEAM_BUILD="$REELBEAM_ROOT/.media-build"
REELBEAM_SOURCE_VERSION=9.0.2
mkdir -p "$REELBEAM_BUILD" "$REELBEAM_ROOT/resources/bin" "$REELBEAM_ROOT/resources/licenses"
if [ "$(uname -s)" != Darwin ]; then
  echo 'macOS media build requires Apple command line tools. On Linux set REELBEAM_FFMPEG/FFPROBE to system tools for tests.'
  exit 1
fi
if [ ! -d "$REELBEAM_BUILD/ffmpeg-$REELBEAM_SOURCE_VERSION" ]; then
  if [ -n "${REELBEAM_SOURCE_ARCHIVE:-}" ]; then
    cp "$REELBEAM_SOURCE_ARCHIVE" "$REELBEAM_BUILD/ffmpeg.tar.xz"
  else
    curl --fail --location "https://ffmpeg.org/releases/ffmpeg-$REELBEAM_SOURCE_VERSION.tar.xz" --output "$REELBEAM_BUILD/ffmpeg.tar.xz"
  fi
  echo "8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e  $REELBEAM_BUILD/ffmpeg.tar.xz" | shasum -a 256 -c -
  tar -xf "$REELBEAM_BUILD/ffmpeg.tar.xz" -C "$REELBEAM_BUILD"
fi
cd "$REELBEAM_BUILD/ffmpeg-$REELBEAM_SOURCE_VERSION"
# Standalone LGPL executables. H.264 uses the macOS VideoToolbox encoder;
# captions are rasterized by the host, so external font/GPL libraries are unnecessary.
./configure --prefix="$REELBEAM_BUILD/install" --disable-doc --disable-debug --disable-ffplay \
  --disable-autodetect --disable-everything --enable-ffmpeg --enable-ffprobe \
  --enable-zlib --enable-videotoolbox --enable-audiotoolbox --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,avi,image2,mp3,wav,aac,flac,ogg \
  --enable-muxer=mp4,mov,image2,null,wav,ipod,rawvideo,f32le \
  --enable-parser=h264,hevc,vp8,vp9,av1,aac,mpegaudio,mpeg4video,png,opus,vorbis \
  --enable-decoder=pcm_u8,rawvideo,wrapped_avframe,mpeg4,h264,hevc,vp8,vp9,av1,aac,mp3,flac,opus,vorbis,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,png,mjpeg,webp,bmp,tiff \
  --enable-encoder=wrapped_avframe,h264_videotoolbox,aac,png,mjpeg,pcm_s16le,pcm_f32le,rawvideo,mpeg4 \
  --enable-filter=color,anullsrc,trim,atrim,setpts,asetpts,fps,scale,pad,setsar,overlay,aresample,aformat,volume,adelay,amix,format,null,anull,sine,concat,select,crop,geq,nullsrc \
  --enable-indev=lavfi --enable-swscale --enable-swresample
make -j "${REELBEAM_BUILD_JOBS:-6}" ffmpeg ffprobe
cp ffmpeg ffprobe "$REELBEAM_ROOT/resources/bin/"
cp COPYING.LGPLv2.1 COPYING.LGPLv3 LICENSE.md "$REELBEAM_ROOT/resources/licenses/"
./ffmpeg -version > "$REELBEAM_ROOT/resources/licenses/ffmpeg-build.txt"
shasum -a 256 ffmpeg ffprobe > "$REELBEAM_ROOT/resources/licenses/ffmpeg-binaries.sha256"
echo 'Native FFmpeg and FFprobe built. Distribute the corresponding source archive and this build script alongside release assets.'
